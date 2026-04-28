import { createHash } from 'node:crypto';

import type { Request } from 'express';
import { getSharedRedisClient } from './shared-redis-client.js';

const redirectOpenDedupeWindowSeconds = 15;
const redirectOpenDedupeWindowMs = redirectOpenDedupeWindowSeconds * 1_000;
const maxLocalRecentRedirectOpenEntries = 10_000;
const sharedRedirectOpenDedupeErrorLogIntervalMs = 30_000;

const recentRedirectOpenKeys = new Map<string, number>();
let lastSharedRedirectOpenDedupeErrorAt = 0;

function getHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function getUserAgent(request: Request) {
  return getHeaderValue(request.headers['user-agent']);
}

function getClientIp(request: Request) {
  const cfConnectingIp = getHeaderValue(request.headers['cf-connecting-ip']);
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  const xRealIp = getHeaderValue(request.headers['x-real-ip']);
  if (xRealIp) {
    return xRealIp.trim();
  }

  const xForwardedFor = getHeaderValue(request.headers['x-forwarded-for']);
  if (xForwardedFor) {
    const forwardedIp = xForwardedFor
      .split(',')
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (forwardedIp) {
      return forwardedIp;
    }
  }

  return request.socket.remoteAddress?.trim() ?? null;
}

function buildRedirectOpenDedupeKey(
  request: Request,
  linkId: string | number,
  subtrackerId?: string | number,
  passwordId?: string | number
) {
  const clientIp = getClientIp(request);
  if (!clientIp) {
    return null;
  }

  const dedupeScope =
    passwordId && subtrackerId
      ? `subtracker:${String(subtrackerId)}:password:${String(passwordId)}`
      : passwordId
        ? `password:${String(passwordId)}`
        : subtrackerId
          ? `subtracker:${String(subtrackerId)}`
          : `link:${String(linkId)}`;
  const userAgent = getUserAgent(request) ?? '';
  const fingerprint = createHash('sha256')
    .update(`${dedupeScope}\n${clientIp.toLowerCase()}\n${userAgent.toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
  const windowBucket = Math.floor(Date.now() / redirectOpenDedupeWindowMs);

  return `redirect-open-dedupe:${dedupeScope}:${windowBucket}:${fingerprint}`;
}

function pruneRecentRedirectOpenKeys(now: number) {
  for (const [key, expiresAt] of recentRedirectOpenKeys) {
    if (expiresAt > now && recentRedirectOpenKeys.size <= maxLocalRecentRedirectOpenEntries) {
      break;
    }

    if (expiresAt <= now || recentRedirectOpenKeys.size > maxLocalRecentRedirectOpenEntries) {
      recentRedirectOpenKeys.delete(key);
    }
  }
}

function hasRecentRedirectOpenKey(key: string, now: number) {
  const expiresAt = recentRedirectOpenKeys.get(key);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= now) {
    recentRedirectOpenKeys.delete(key);
    return false;
  }

  return true;
}

function rememberRecentRedirectOpenKey(key: string, now: number) {
  recentRedirectOpenKeys.set(key, now + redirectOpenDedupeWindowMs);
  pruneRecentRedirectOpenKeys(now);
}

function logSharedRedirectOpenDedupeError(operation: string, error: unknown) {
  const now = Date.now();
  if (now - lastSharedRedirectOpenDedupeErrorAt < sharedRedirectOpenDedupeErrorLogIntervalMs) {
    return;
  }

  lastSharedRedirectOpenDedupeErrorAt = now;
  console.error(`Unable to use shared redirect-open dedupe during ${operation}.`, { error });
}

async function claimSharedRedirectOpenKey(key: string) {
  const client = await getSharedRedisClient();
  if (!client) {
    return null;
  }

  try {
    return (
      (await client.set(key, '1', {
        EX: redirectOpenDedupeWindowSeconds,
        NX: true
      })) === 'OK'
    );
  } catch (error) {
    logSharedRedirectOpenDedupeError('redis-set', error);
    return null;
  }
}

export async function isLikelyDuplicateRedirectOpen(
  request: Request,
  linkId: string | number,
  subtrackerId?: string | number,
  passwordId?: string | number
) {
  if (request.sessionUser) {
    return false;
  }

  const key = buildRedirectOpenDedupeKey(request, linkId, subtrackerId, passwordId);
  if (!key) {
    return false;
  }

  const now = Date.now();
  if (hasRecentRedirectOpenKey(key, now)) {
    return true;
  }

  rememberRecentRedirectOpenKey(key, now);

  const didClaimSharedKey = await claimSharedRedirectOpenKey(key);
  if (didClaimSharedKey === null) {
    return false;
  }

  return !didClaimSharedKey;
}
