import { findLinkByHostAndSlug, findUnavailableLinkByHostAndSlug, type RedirectLinkRow } from '../db/links.js';
import { getSharedRedisClient } from './shared-redis-client.js';

const staticRedirectLinkCacheTtlMs = 5 * 60_000;
const staticSharedRedirectLinkCacheTtlMs = 60 * 60_000;
const unavailableRedirectCacheTtlMs = 5_000;
const unavailableSharedRedirectCacheTtlMs = 5 * 60_000;
const missingRedirectCacheTtlMs = 5_000;
const missingSharedRedirectCacheTtlMs = 5_000;
const sharedRedirectCacheLockTtlSeconds = 5;
const sharedRedirectCachePollIntervalMs = 50;
const sharedRedirectCachePollAttempts = 10;
const maxRedirectLinkCacheEntries = 2_000;
const sharedRedirectCacheErrorLogIntervalMs = 30_000;

export type UnavailableRedirectLookup = {
  linkId: string;
  reason: 'disabled' | 'expired';
  disabledDestinationUrl: string | null;
  requiresTrackingId: boolean;
};

export type RedirectLookupResult =
  | {
      kind: 'available';
      link: RedirectLinkRow;
    }
  | {
      kind: 'unavailable';
      unavailable: UnavailableRedirectLookup;
    }
  | {
      kind: 'missing';
    };

type RedirectLinkCacheEntry = {
  value: RedirectLookupResult;
  expiresAt: number;
};

const redirectLinkCache = new Map<string, RedirectLinkCacheEntry>();
const pendingRedirectLinkLookups = new Map<string, Promise<RedirectLookupResult>>();
let lastSharedRedirectCacheErrorAt = 0;

function getRedirectLinkCacheKey(canonicalHost: string, slug: string) {
  return `${canonicalHost.toLowerCase()}/${slug.toLowerCase()}`;
}

function getSharedRedirectLinkCacheKey(canonicalHost: string, slug: string) {
  return `redirect-lookup:${getRedirectLinkCacheKey(canonicalHost, slug)}`;
}

function getSharedRedirectLinkLockKey(canonicalHost: string, slug: string) {
  return `redirect-lookup-lock:${getRedirectLinkCacheKey(canonicalHost, slug)}`;
}

function getAvailableRedirectCacheExpiry(link: RedirectLinkRow, cacheTtlMs: number) {
  const now = Date.now();
  const ttlExpiry = !link.has_schedule
    ? now + cacheTtlMs
    : now + (60_000 - (now % 60_000));

  if (!link.expires_at) {
    return ttlExpiry;
  }

  const expiresAtMs = Date.parse(link.expires_at);
  if (Number.isNaN(expiresAtMs)) {
    return ttlExpiry;
  }

  return Math.min(ttlExpiry, expiresAtMs);
}

function getRedirectCacheExpiry(value: RedirectLookupResult) {
  switch (value.kind) {
    case 'available':
      return getAvailableRedirectCacheExpiry(value.link, staticRedirectLinkCacheTtlMs);
    case 'unavailable':
      return Date.now() + unavailableRedirectCacheTtlMs;
    case 'missing':
      return Date.now() + missingRedirectCacheTtlMs;
  }
}

function getSharedRedirectCacheTtlSeconds(value: RedirectLookupResult) {
  switch (value.kind) {
    case 'available': {
      const expiryMs = getAvailableRedirectCacheExpiry(value.link, staticSharedRedirectLinkCacheTtlMs);
      return Math.max(1, Math.ceil((expiryMs - Date.now()) / 1000));
    }
    case 'unavailable':
      return Math.max(1, Math.ceil(unavailableSharedRedirectCacheTtlMs / 1000));
    case 'missing':
      return Math.max(1, Math.ceil(missingSharedRedirectCacheTtlMs / 1000));
  }
}

function setRedirectLinkCacheEntry(key: string, value: RedirectLookupResult) {
  redirectLinkCache.delete(key);
  redirectLinkCache.set(key, {
    value,
    expiresAt: getRedirectCacheExpiry(value)
  });

  if (redirectLinkCache.size <= maxRedirectLinkCacheEntries) {
    return;
  }

  const oldestKey = redirectLinkCache.keys().next().value;
  if (oldestKey) {
    redirectLinkCache.delete(oldestKey);
  }
}

function logSharedRedirectCacheError(operation: string, error: unknown) {
  const now = Date.now();
  if (now - lastSharedRedirectCacheErrorAt < sharedRedirectCacheErrorLogIntervalMs) {
    return;
  }

  lastSharedRedirectCacheErrorAt = now;
  console.error(`Unable to use shared redirect cache during ${operation}.`, { error });
}

async function readSharedRedirectCacheEntry(
  canonicalHost: string,
  slug: string
): Promise<RedirectLookupResult | undefined> {
  const client = await getSharedRedisClient();
  if (!client) {
    return undefined;
  }

  try {
    const payload = await client.get(getSharedRedirectLinkCacheKey(canonicalHost, slug));
    if (!payload) {
      return undefined;
    }

    const parsed = JSON.parse(payload) as RedirectLookupResult;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') {
      return undefined;
    }

    if (parsed.kind === 'available' && parsed.link) {
      return parsed;
    }

    if (
      parsed.kind === 'unavailable' &&
      parsed.unavailable &&
      typeof parsed.unavailable.linkId === 'string'
    ) {
      return parsed;
    }

    if (parsed.kind === 'missing') {
      return parsed;
    }

    return undefined;
  } catch (error) {
    logSharedRedirectCacheError('redis-get', error);
    return undefined;
  }
}

async function writeSharedRedirectCacheEntry(
  canonicalHost: string,
  slug: string,
  value: RedirectLookupResult
) {
  const client = await getSharedRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.set(getSharedRedirectLinkCacheKey(canonicalHost, slug), JSON.stringify(value), {
      EX: getSharedRedirectCacheTtlSeconds(value)
    });
  } catch (error) {
    logSharedRedirectCacheError('redis-set', error);
  }
}

async function deleteSharedRedirectCacheEntry(canonicalHost: string, slug: string) {
  const client = await getSharedRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.del(getSharedRedirectLinkCacheKey(canonicalHost, slug));
  } catch (error) {
    logSharedRedirectCacheError('redis-del', error);
  }
}

async function tryAcquireSharedRedirectLookupLock(canonicalHost: string, slug: string) {
  const client = await getSharedRedisClient();
  if (!client) {
    return false;
  }

  try {
    const result = await client.set(getSharedRedirectLinkLockKey(canonicalHost, slug), '1', {
      EX: sharedRedirectCacheLockTtlSeconds,
      NX: true
    });
    return result === 'OK';
  } catch (error) {
    logSharedRedirectCacheError('redis-lock', error);
    return false;
  }
}

async function waitForSharedRedirectCacheFill(canonicalHost: string, slug: string) {
  for (let attempt = 0; attempt < sharedRedirectCachePollAttempts; attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, sharedRedirectCachePollIntervalMs);
    });

    const shared = await readSharedRedirectCacheEntry(canonicalHost, slug);
    if (shared !== undefined) {
      return shared;
    }
  }

  return undefined;
}

async function loadRedirectLookupFromDatabase(
  canonicalHost: string,
  slug: string
): Promise<RedirectLookupResult> {
  const availableLink = await findLinkByHostAndSlug(canonicalHost, slug);
  if (availableLink) {
    return {
      kind: 'available',
      link: availableLink
    };
  }

  const unavailableLink = await findUnavailableLinkByHostAndSlug(canonicalHost, slug);
  if (unavailableLink) {
    return {
      kind: 'unavailable',
      unavailable: unavailableLink
    };
  }

  return {
    kind: 'missing'
  };
}

export async function findCachedRedirectLink(canonicalHost: string, slug: string) {
  const normalizedHost = canonicalHost.toLowerCase();
  const normalizedSlug = slug.toLowerCase();
  const key = getRedirectLinkCacheKey(normalizedHost, normalizedSlug);
  const cached = redirectLinkCache.get(key);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    redirectLinkCache.delete(key);
    redirectLinkCache.set(key, cached);
    return cached.value;
  }

  if (cached) {
    redirectLinkCache.delete(key);
  }

  const pendingLookup = pendingRedirectLinkLookups.get(key);
  if (pendingLookup) {
    return await pendingLookup;
  }

  const lookupPromise = (async () => {
    const sharedValue = await readSharedRedirectCacheEntry(normalizedHost, normalizedSlug);
    if (sharedValue !== undefined) {
      setRedirectLinkCacheEntry(key, sharedValue);
      return sharedValue;
    }

    const holdsLock = await tryAcquireSharedRedirectLookupLock(normalizedHost, normalizedSlug);
    if (!holdsLock) {
      const waitedSharedValue = await waitForSharedRedirectCacheFill(normalizedHost, normalizedSlug);
      if (waitedSharedValue !== undefined) {
        setRedirectLinkCacheEntry(key, waitedSharedValue);
        return waitedSharedValue;
      }
    }

    const loadedValue = await loadRedirectLookupFromDatabase(normalizedHost, normalizedSlug);
    setRedirectLinkCacheEntry(key, loadedValue);
    await writeSharedRedirectCacheEntry(normalizedHost, normalizedSlug, loadedValue);
    return loadedValue;
  })().finally(() => {
    pendingRedirectLinkLookups.delete(key);
  });

  pendingRedirectLinkLookups.set(key, lookupPromise);
  return await lookupPromise;
}

export async function invalidateCachedRedirectLink(canonicalHost: string, slug: string) {
  const normalizedHost = canonicalHost.toLowerCase();
  const normalizedSlug = slug.toLowerCase();
  const key = getRedirectLinkCacheKey(normalizedHost, normalizedSlug);
  redirectLinkCache.delete(key);
  pendingRedirectLinkLookups.delete(key);
  await deleteSharedRedirectCacheEntry(normalizedHost, normalizedSlug);
}

export async function primeCachedRedirectLink(link: RedirectLinkRow) {
  const key = getRedirectLinkCacheKey(link.canonical_host, link.slug);
  pendingRedirectLinkLookups.delete(key);
  const value: RedirectLookupResult = {
    kind: 'available',
    link
  };
  setRedirectLinkCacheEntry(key, value);
  await writeSharedRedirectCacheEntry(link.canonical_host, link.slug, value);
}
