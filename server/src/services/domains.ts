import type { Request } from 'express';

import { getDomainRuntimeConfig } from '../config/domain-runtime-config.js';
import {
  ensureProvisionedHostSettingsExist,
  listDomainHostSettings,
  listDomains
} from '../db/domains.js';

type SupportedDomain = {
  host: string;
  label: string;
  aliases: string[];
  isDefaultForNewAccounts: boolean;
  linkCount: number;
};

export type ManagedDomain = {
  host: string;
  label: string;
  aliasTargetHost: string | null;
  rootRedirectSlug: string;
  authProviderHost: string | null;
  isDefaultForNewAccounts: boolean;
  linkCount: number;
};

export type ResolvedHost = {
  requestedHost: string | null;
  canonicalHost: string | null;
  matchedAlias: string | null;
};

let cachedDomains: SupportedDomain[] | null = null;
let cachedRootRedirectSlugs: Map<string, string> | null = null;
let cachedAuthProviderHosts: Map<string, string | null> | null = null;
let cacheExpiresAt = 0;
const domainRuntimeConfig = getDomainRuntimeConfig();
const provisionedHosts = domainRuntimeConfig.provisionedHosts;

function compareDomainHosts(leftHost: string, rightHost: string) {
  const leftParts = leftHost.toLowerCase().split('.').reverse();
  const rightParts = rightHost.toLowerCase().split('.').reverse();
  const sharedLength = Math.min(leftParts.length, rightParts.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = leftParts[index]!.localeCompare(rightParts[index]!);
    if (comparison !== 0) {
      return comparison;
    }
  }

  if (leftParts.length !== rightParts.length) {
    return leftParts.length - rightParts.length;
  }

  return leftHost.localeCompare(rightHost);
}

async function loadSupportedDomains() {
  const now = Date.now();
  if (cachedDomains && cachedRootRedirectSlugs && cachedAuthProviderHosts && now < cacheExpiresAt) {
    return cachedDomains;
  }

  await ensureProvisionedHostSettingsExist(provisionedHosts);
  const [domainRows, hostSettings] = await Promise.all([listDomains(), listDomainHostSettings()]);
  const provisionedHostSet = new Set(provisionedHosts);
  const domains = domainRows
    .filter((domain) => provisionedHostSet.has(domain.canonical_host))
    .map((domain) => ({
      host: domain.canonical_host,
      label: domain.label,
      aliases: domain.aliases
        .filter((alias) => provisionedHostSet.has(alias))
        .sort(compareDomainHosts),
      isDefaultForNewAccounts: domain.is_default_for_new_accounts,
      linkCount: domain.link_count
    }))
    .sort((left, right) => compareDomainHosts(left.host, right.host));
  const rootRedirectSlugs = new Map<string, string>();
  const authProviderHosts = new Map<string, string | null>();

  for (const setting of hostSettings) {
    rootRedirectSlugs.set(setting.host, setting.root_redirect_slug);
    authProviderHosts.set(setting.host, setting.auth_provider_host);
  }

  cachedDomains = domains;
  cachedRootRedirectSlugs = rootRedirectSlugs;
  cachedAuthProviderHosts = authProviderHosts;
  cacheExpiresAt = now + 30_000;

  return domains;
}

function sanitizeHost(rawHost: string | undefined): string | null {
  if (!rawHost) {
    return null;
  }

  return rawHost.split(',')[0]?.trim().split(':')[0]?.toLowerCase() ?? null;
}

function normalizeHostValue(rawHost: string | null | undefined) {
  if (!rawHost) {
    return null;
  }

  return rawHost.trim().toLowerCase() || null;
}

async function resolveNormalizedHost(requestedHost: string | null): Promise<ResolvedHost> {
  if (!requestedHost) {
    return {
      requestedHost: null,
      canonicalHost: null,
      matchedAlias: null
    };
  }

  const domains = await loadSupportedDomains();
  const aliasToCanonical = new Map<string, string>();
  for (const domain of domains) {
    aliasToCanonical.set(domain.host, domain.host);
    for (const alias of domain.aliases) {
      aliasToCanonical.set(alias, domain.host);
    }
  }

  const canonicalHost = aliasToCanonical.get(requestedHost) ?? null;
  const matchedAlias = canonicalHost && canonicalHost !== requestedHost ? requestedHost : null;

  return {
    requestedHost,
    canonicalHost,
    matchedAlias
  };
}

export function invalidateDomainCache() {
  cachedDomains = null;
  cachedRootRedirectSlugs = null;
  cachedAuthProviderHosts = null;
  cacheExpiresAt = 0;
}

export function isProvisionedHost(host: string) {
  return provisionedHosts.includes(host.toLowerCase());
}

export async function resolveRequestedHost(request: Request): Promise<ResolvedHost> {
  const forwardedHost = sanitizeHost(request.headers['x-forwarded-host'] as string | undefined);
  const host = sanitizeHost(request.headers.host);
  return await resolveNormalizedHost(forwardedHost ?? host);
}

export async function resolveConfiguredHost(rawHost: string | null | undefined): Promise<ResolvedHost> {
  return await resolveNormalizedHost(normalizeHostValue(rawHost));
}

export async function getSupportedDomains() {
  return await loadSupportedDomains();
}

export async function getRootRedirectSlugForHost(host: string) {
  await loadSupportedDomains();
  return cachedRootRedirectSlugs?.get(host.toLowerCase()) ?? 'admin';
}

export async function getAuthProviderHostForHost(host: string) {
  await loadSupportedDomains();
  return cachedAuthProviderHosts?.get(host.toLowerCase()) ?? null;
}

export async function getDefaultCanonicalHosts() {
  const domains = await loadSupportedDomains();
  return domains
    .filter((domain) => domain.isDefaultForNewAccounts)
    .map((domain) => domain.host);
}

function extractEmailDomain(email: string) {
  const trimmedEmail = email.trim().toLowerCase();
  const atIndex = trimmedEmail.lastIndexOf('@');

  if (atIndex === -1 || atIndex === trimmedEmail.length - 1) {
    return null;
  }

  return trimmedEmail.slice(atIndex + 1);
}

function hostMatchesEmailDomain(host: string, emailDomain: string) {
  return host === emailDomain || host.endsWith(`.${emailDomain}`);
}

export async function getInitialCanonicalHostsForEmail(email: string) {
  const domains = await loadSupportedDomains();
  const emailDomain = extractEmailDomain(email);
  const canonicalHosts = new Set(
    domains
      .filter((domain) => domain.isDefaultForNewAccounts)
      .map((domain) => domain.host)
  );

  if (!emailDomain) {
    return [...canonicalHosts];
  }

  for (const domain of domains) {
    if (
      hostMatchesEmailDomain(domain.host, emailDomain) ||
      domain.aliases.some((alias) => hostMatchesEmailDomain(alias, emailDomain))
    ) {
      canonicalHosts.add(domain.host);
    }
  }

  return [...canonicalHosts];
}

export async function getManagedDomains() {
  const domains = await loadSupportedDomains();
  const rootRedirectSlugs = cachedRootRedirectSlugs ?? new Map<string, string>();
  const managedDomains = new Map<string, ManagedDomain>();

  for (const domain of domains) {
    managedDomains.set(domain.host, {
      host: domain.host,
      label: domain.label,
      aliasTargetHost: null,
      rootRedirectSlug: rootRedirectSlugs.get(domain.host) ?? 'admin',
      authProviderHost: cachedAuthProviderHosts?.get(domain.host) ?? null,
      isDefaultForNewAccounts: domain.isDefaultForNewAccounts,
      linkCount: domain.linkCount
    });

    for (const alias of domain.aliases) {
      managedDomains.set(alias, {
        host: alias,
        label: alias,
        aliasTargetHost: domain.host,
        rootRedirectSlug: rootRedirectSlugs.get(alias) ?? 'admin',
        authProviderHost: cachedAuthProviderHosts?.get(alias) ?? null,
        isDefaultForNewAccounts: false,
        linkCount: 0
      });
    }
  }

  for (const host of provisionedHosts) {
    if (!managedDomains.has(host)) {
      managedDomains.set(host, {
        host,
        label: host,
        aliasTargetHost: null,
        rootRedirectSlug: rootRedirectSlugs.get(host) ?? 'admin',
        authProviderHost: cachedAuthProviderHosts?.get(host) ?? null,
        isDefaultForNewAccounts: false,
        linkCount: 0
      });
    }
  }

  return [...managedDomains.values()].sort((left, right) => compareDomainHosts(left.host, right.host));
}
