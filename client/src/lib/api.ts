export type DomainDefinition = {
  host: string;
  label: string;
  aliases: string[];
  isDefaultForNewAccounts?: boolean;
  linkCount?: number;
};

export type SessionUser = {
  email: string;
  name: string;
  picture: string | null;
  isSuperAdmin: boolean;
  allowedCanonicalHosts: string[];
  administeredDomainHosts: string[];
  defaultScheduleTimezone: string;
};

export type UserLinkVariableRecord = {
  key: string;
  value: string;
};

export type LinkScheduleMode = 'windows' | 'rotation';

export type LinkRecord = {
  id: string;
  slug: string;
  canonical_host: string;
  destination_url: string;
  disabled_destination_url: string | null;
  waiting_room_enabled: boolean;
  expires_at: string | null;
  description: string | null;
  internal_only: boolean;
  is_listed: boolean;
  is_disabled: boolean;
  requires_tracking_id: boolean;
  has_password: boolean;
  usage_count: number;
  schedule_timezone: string;
  schedule_mode: LinkScheduleMode;
  created_by_email: string;
  created_at: string;
  updated_at: string;
  has_schedule?: boolean;
  current_destination_url?: string;
};

export type LinkScheduleRecord = {
  id: string;
  startTime: string;
  endTime: string;
  destinationUrl: string;
};

export type LinkRotationDestinationRecord = {
  id: string;
  destinationUrl: string;
};

export type LinkRotationScheduleRecord = {
  intervalMinutes: number;
  destinations: LinkRotationDestinationRecord[];
};

export type LinkSubtrackerRecord = {
  id: string;
  name: string;
  trackingId: string;
  isDisabled: boolean;
  usageCount: number;
  created_at: string;
};

export type LinkPasswordRecord = {
  id: string;
  name: string;
  password: string;
  isDisabled: boolean;
  usageCount: number;
  created_at: string;
};

export type LinkConfigurationRecord = Omit<
  LinkRecord,
  'schedule_timezone' | 'schedule_mode' | 'disabled_destination_url' | 'expires_at'
> & {
  hasLegacyPasswordPrompt?: boolean;
  rememberPasswordAccess: boolean;
  scheduleTimezone: string;
  scheduleMode: LinkScheduleMode;
  disabledDestinationUrl: string | null;
  expiresAt: string | null;
  subtrackers: LinkSubtrackerRecord[];
  passwords: LinkPasswordRecord[];
  schedules: LinkScheduleRecord[];
  rotationSchedule: LinkRotationScheduleRecord | null;
};

export type LinkPage = {
  links: LinkRecord[];
  page: number;
  pageSize: number;
  totalLinks: number;
  totalPages: number;
};

export type LinkAnalyticsOverview = {
  totalLinks: number;
  totalUses: number;
  publicLinks: number;
  internalLinks: number;
  scheduledLinks: number;
  staticLinks: number;
};

export type LinkAnalyticsDomainBreakdown = {
  canonicalHost: string;
  linkCount: number;
  totalUses: number;
};

export type LinkAnalyticsCreatorBreakdown = {
  email: string;
  linkCount: number;
  totalUses: number;
};

export type LinkAnalyticsSummary = {
  overview: LinkAnalyticsOverview;
  topLinks: LinkRecord[];
  domainBreakdown: LinkAnalyticsDomainBreakdown[];
  creatorBreakdown: LinkAnalyticsCreatorBreakdown[];
  timeSeries: LinkAnalyticsTimeSeries;
};

export type LinkTimeSeriesAnalyticsSummary = {
  overview: {
    totalUses: number;
  };
  timeSeries: LinkAnalyticsTimeSeries;
};

export type LinkAnalyticsTimeWindow = 'all' | '4h' | '24h' | '7d' | '30d' | '90d';
export type LinkAnalyticsTimeSeriesGranularity = 'tenMinutes' | 'hour' | 'day' | 'week' | 'month';

export type LinkAnalyticsTimeSeriesPoint = {
  bucketStart: string;
  totalUses: number;
};

export type LinkAnalyticsTimeSeries = {
  granularity: LinkAnalyticsTimeSeriesGranularity;
  points: LinkAnalyticsTimeSeriesPoint[];
};

export type LinkSortOption =
  | 'updatedDesc'
  | 'updatedAsc'
  | 'createdDesc'
  | 'createdAsc'
  | 'usageDesc'
  | 'usageAsc'
  | 'slugAsc'
  | 'slugDesc'
  | 'hostAsc'
  | 'hostDesc'
  | 'destinationAsc'
  | 'destinationDesc';

export type AdminUserRecord = {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  default_schedule_timezone: string;
  created_at: string;
  updated_at: string;
  link_count: number;
  isSuperAdmin: boolean;
};

export type AdminGroupSummary = {
  id: string;
  name: string;
};

export type AdminUserDetail = AdminUserRecord & {
  directAllowedCanonicalHosts: string[];
  inheritedAllowedCanonicalHosts: string[];
  allowedCanonicalHosts: string[];
  groups: AdminGroupSummary[];
};

export type AdminGroupRecord = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  member_count: number;
  domain_count: number;
};

export type AdminGroupDetail = AdminGroupRecord & {
  member_user_ids: string[];
  allowed_canonical_hosts: string[];
  domain_administration_hosts: string[];
  auto_member_email_domains: string[];
};

export type AdminRegistrationInviteRecord = {
  id: string;
  token: string;
  label: string | null;
  groupId: string | null;
  groupName: string | null;
  createdByEmail: string | null;
  usedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  usedAt: string | null;
  isUsed: boolean;
};

export type ManagedDomainRecord = {
  host: string;
  label: string;
  aliasTargetHost: string | null;
  rootRedirectSlug: string;
  authProviderHost: string | null;
  isDefaultForNewAccounts: boolean;
  linkCount: number;
};

export type SetupChecklistStatus = 'complete' | 'warning';

export type SetupChecklistItemRecord = {
  id: string;
  title: string;
  status: SetupChecklistStatus;
  description: string;
  actionLabel: string | null;
  actionPath: string | null;
};

export type SetupChecklistRecord = {
  items: SetupChecklistItemRecord[];
  completedCount: number;
  warningCount: number;
};

export type PrivacyPolicyDocumentRecord = {
  markdown: string;
  createdAt: string;
  updatedAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed for ${path}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function fetchBootstrap() {
  return request<{
    currentHost: string | null;
    canonicalHost: string | null;
    user: SessionUser | null;
    supportedDomains: DomainDefinition[];
    appBuildId: string;
  }>('/api/bootstrap');
}

export function fetchVersion() {
  return request<{
    appBuildId: string;
  }>('/api/version', {
    cache: 'no-store'
  });
}

export function fetchAuthConfig() {
  return request<{
    googleClientId: string | null;
    emailCodeEnabled: boolean;
    allowedEmails: string[];
    allowedEmailDomains: string[];
    allowAllVerifiedGoogleAccounts: boolean;
  }>('/auth/config');
}

export function fetchInviteStatus(inviteToken: string) {
  const params = new URLSearchParams({ inviteToken });
  return request<{ isAvailable: boolean }>(`/auth/invite-status?${params.toString()}`);
}

export function loginWithGoogle(credential: string, inviteToken?: string | null) {
  return request<{ user: SessionUser }>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential, inviteToken: inviteToken ?? undefined })
  });
}

export function requestEmailSignInCode(email: string, inviteToken?: string | null) {
  return request<{ email: string; expiresInMinutes: number }>('/auth/email/request', {
    method: 'POST',
    body: JSON.stringify({ email, inviteToken: inviteToken ?? undefined })
  });
}

export function loginWithEmailCode(email: string, code: string, inviteToken?: string | null) {
  return request<{ user: SessionUser }>('/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code, inviteToken: inviteToken ?? undefined })
  });
}

export function logout() {
  return request<void>('/logout', {
    method: 'POST'
  });
}

export function fetchLinks(
  page: number,
  pageSize: number,
  scope: 'mine' | 'listed' | 'all',
  filters: {
    searchQuery: string;
    canonicalHost: string;
    sort: LinkSortOption;
  }
) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    scope,
    sort: filters.sort
  });

  if (filters.searchQuery) {
    params.set('searchQuery', filters.searchQuery);
  }

  if (filters.canonicalHost) {
    params.set('canonicalHost', filters.canonicalHost);
  }

  return request<LinkPage>(`/api/links?${params.toString()}`);
}

export function fetchUsers() {
  return request<{ users: AdminUserRecord[] }>('/api/users');
}

export function fetchGroups() {
  return request<{ groups: AdminGroupRecord[] }>('/api/groups');
}

export function fetchInvites() {
  return request<{ invites: AdminRegistrationInviteRecord[] }>('/api/invites');
}

export function createInvite(input: { groupId: string | null; label: string | null }) {
  return request<{ invite: AdminRegistrationInviteRecord }>('/api/invites', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function createGroup(name: string) {
  return request<{ group: AdminGroupRecord }>('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

export function fetchUserLinkVariables() {
  return request<{ variables: UserLinkVariableRecord[]; defaultScheduleTimezone: string }>(
    '/api/user-variables'
  );
}

export function updateUserLinkVariables(input: {
  variables: UserLinkVariableRecord[];
  defaultScheduleTimezone: string;
}) {
  return request<{ variables: UserLinkVariableRecord[]; defaultScheduleTimezone: string }>(
    '/api/user-variables',
    {
      method: 'PUT',
      body: JSON.stringify(input)
    }
  );
}

export function fetchUserLinkVariablesForUser(userId: string) {
  return request<{ variables: UserLinkVariableRecord[] }>(
    `/api/users/${encodeURIComponent(userId)}/link-variables`
  );
}

export function updateUserLinkVariablesForUser(
  userId: string,
  variables: UserLinkVariableRecord[]
) {
  return request<{ variables: UserLinkVariableRecord[] }>(
    `/api/users/${encodeURIComponent(userId)}/link-variables`,
    {
      method: 'PUT',
      body: JSON.stringify({ variables })
    }
  );
}

export function fetchAnalytics(scope: 'mine' | 'all', timeWindow: LinkAnalyticsTimeWindow) {
  const params = new URLSearchParams({ scope, timeWindow });
  return request<LinkAnalyticsSummary>(`/api/analytics?${params.toString()}`);
}

export function fetchLinkConfiguration(linkId: string) {
  return request<{ link: LinkConfigurationRecord }>(
    `/api/links/${encodeURIComponent(linkId)}/config`
  );
}

export function fetchLinkAnalytics(linkId: string, timeWindow: LinkAnalyticsTimeWindow) {
  const params = new URLSearchParams({ timeWindow });
  return request<{ analytics: LinkTimeSeriesAnalyticsSummary }>(
    `/api/links/${encodeURIComponent(linkId)}/analytics?${params.toString()}`
  );
}

export function resolveLinkByShortlink(canonicalHost: string, slug: string) {
  const params = new URLSearchParams({ canonicalHost, slug });
  return request<{ linkId: string | null }>(`/api/links/lookup?${params.toString()}`);
}

export function generateUnusedSlug(canonicalHost: string, linkId?: string) {
  const params = new URLSearchParams({ canonicalHost });
  if (linkId) {
    params.set('linkId', linkId);
  }
  return request<{ slug: string }>(`/api/links/generate-slug?${params.toString()}`);
}

export function fetchDomains() {
  return request<{
    domains: ManagedDomainRecord[];
    supportedDomains: DomainDefinition[];
  }>('/api/domains');
}

export function fetchSetupChecklist() {
  return request<SetupChecklistRecord>('/api/setup-checklist');
}

export function fetchPrivacyPolicyDocument() {
  return request<{ document: PrivacyPolicyDocumentRecord }>('/api/privacy-policy');
}

export function updatePrivacyPolicyDocument(markdown: string) {
  return request<{ document: PrivacyPolicyDocumentRecord }>('/api/privacy-policy', {
    method: 'PUT',
    body: JSON.stringify({ markdown })
  });
}

export function fetchUser(userId: string) {
  return request<{ user: AdminUserDetail }>(`/api/users/${userId}`);
}

export function fetchGroup(groupId: string) {
  return request<{ group: AdminGroupDetail }>(`/api/groups/${encodeURIComponent(groupId)}`);
}

export function updateUserDomainAccess(
  userId: string,
  input: {
    allowedCanonicalHosts: string[];
    defaultScheduleTimezone: string;
  }
) {
  return request<{ user: AdminUserDetail }>(`/api/users/${userId}/domain-access`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function updateGroup(
  groupId: string,
  input: {
    name: string;
    memberUserIds: string[];
    allowedCanonicalHosts: string[];
    domainAdministrationHosts: string[];
    autoMemberEmailDomains: string[];
  }
) {
  return request<{ group: AdminGroupDetail }>(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function deleteGroup(groupId: string) {
  return request<void>(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE'
  });
}

export function updateDomain(input: {
  canonicalHost: string;
  isDefaultForNewAccounts?: boolean;
  aliasTargetHost?: string | null;
  authProviderHost?: string | null;
  rootRedirectSlug?: string;
}) {
  return request<{
    domains: ManagedDomainRecord[];
    supportedDomains: DomainDefinition[];
  }>(`/api/domains/${encodeURIComponent(input.canonicalHost)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      isDefaultForNewAccounts: input.isDefaultForNewAccounts,
      aliasTargetHost: input.aliasTargetHost,
      authProviderHost: input.authProviderHost,
      rootRedirectSlug: input.rootRedirectSlug
    })
  });
}

export function createLink(input: {
  slug: string;
  canonicalHost: string;
  destinationUrl: string;
  description?: string;
  internalOnly: boolean;
  password?: string;
}) {
  return request<{ link: LinkRecord }>('/api/links', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateLink(
  linkId: string,
  input: {
    slug: string;
    canonicalHost: string;
    destinationUrl?: string;
    internalOnly?: boolean;
  }
) {
  return request<{ link: LinkRecord }>(`/api/links/${encodeURIComponent(linkId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function deleteLink(linkId: string) {
  return request<void>(`/api/links/${encodeURIComponent(linkId)}`, {
    method: 'DELETE'
  });
}

export function updateLinkDisabledState(linkId: string, isDisabled: boolean) {
  return request<{ link: LinkRecord }>(`/api/links/${encodeURIComponent(linkId)}/disabled`, {
    method: 'PATCH',
    body: JSON.stringify({ isDisabled })
  });
}

export function updateLinkConfiguration(
  linkId: string,
  input: {
    slug: string;
    canonicalHost: string;
    destinationUrl: string;
    description: string;
    internalOnly: boolean;
    isListed: boolean;
    isDisabled: boolean;
    waitingRoomEnabled: boolean;
    requiresTrackingId: boolean;
    rememberPasswordAccess: boolean;
    disabledDestinationUrl: string | null;
    expirationAt: string | null;
    scheduleTimezone: string;
    scheduleMode: LinkScheduleMode;
    schedules: Array<{
      startTime: string;
      endTime: string;
      destinationUrl: string;
    }>;
    rotationIntervalMinutes: number | null;
    rotationDestinations: Array<{
      destinationUrl: string;
    }>;
    subtrackers: Array<{
      id?: string;
      name: string;
      isDisabled?: boolean;
    }>;
    passwords: Array<{
      id?: string;
      name: string;
      password: string;
      isDisabled?: boolean;
    }>;
    password?: string | null;
  }
) {
  return request<{ link: LinkConfigurationRecord }>(
    `/api/links/${encodeURIComponent(linkId)}/config`,
    {
      method: 'PUT',
      body: JSON.stringify(input)
    }
  );
}

export function createLinkPassword(
  linkId: string,
  input: {
    name: string;
    password: string;
  }
) {
  return request<{ password: LinkPasswordRecord }>(
    `/api/links/${encodeURIComponent(linkId)}/passwords`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
}

export function updateLinkPasswordDisabledState(
  linkId: string,
  passwordId: string,
  isDisabled: boolean
) {
  return request<{ password: LinkPasswordRecord }>(
    `/api/links/${encodeURIComponent(linkId)}/passwords/${encodeURIComponent(passwordId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isDisabled })
    }
  );
}

export function createLinkSubtracker(linkId: string, name: string) {
  return request<{ subtracker: LinkSubtrackerRecord }>(
    `/api/links/${encodeURIComponent(linkId)}/subtrackers`,
    {
      method: 'POST',
      body: JSON.stringify({ name })
    }
  );
}

export function updateLinkSubtrackerDisabledState(
  linkId: string,
  subtrackerId: string,
  isDisabled: boolean
) {
  return request<{ subtracker: LinkSubtrackerRecord }>(
    `/api/links/${encodeURIComponent(linkId)}/subtrackers/${encodeURIComponent(subtrackerId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isDisabled })
    }
  );
}
