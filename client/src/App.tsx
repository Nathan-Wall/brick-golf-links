import { Fragment, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Link,
  unstable_usePrompt,
  useBeforeUnload,
  useLocation,
  useNavigate
} from 'react-router-dom';

import { GoogleLoginButton } from './components/GoogleLoginButton';
import {
  createInvite,
  createGroup,
  createLink,
  createLinkPassword,
  createLinkSubtracker,
  deleteGroup,
  deleteLink,
  fetchAnalytics,
  fetchAuthConfig,
  fetchInviteStatus,
  fetchBootstrap,
  fetchDomains,
  fetchGroup,
  fetchGroups,
  fetchInvites,
  fetchLinkAnalytics,
  fetchLinkConfiguration,
  fetchLinks,
  fetchPrivacyPolicyDocument,
  fetchSetupChecklist,
  fetchUserLinkVariables,
  fetchUserLinkVariablesForUser,
  generateUnusedSlug,
  resolveLinkByShortlink,
  fetchUser,
  fetchUsers,
  fetchVersion,
  loginWithEmailCode,
  loginWithGoogle,
  logout,
  requestEmailSignInCode,
  updateDomain,
  updateGroup,
  updateLink,
  updateLinkDisabledState,
  updateLinkConfiguration,
  updateLinkPasswordDisabledState,
  updateLinkSubtrackerDisabledState,
  updatePrivacyPolicyDocument,
  updateUserLinkVariables,
  updateUserLinkVariablesForUser,
  updateUserDomainAccess,
  type AdminGroupDetail,
  type AdminGroupRecord,
  type AdminRegistrationInviteRecord,
  type AdminUserDetail,
  type AdminUserRecord,
  type DomainDefinition,
  type LinkAnalyticsSummary,
  type LinkAnalyticsTimeSeriesGranularity,
  type LinkAnalyticsTimeSeriesPoint,
  type LinkAnalyticsTimeWindow,
  type LinkConfigurationRecord,
  type LinkPasswordRecord,
  type LinkRecord,
  type LinkRotationScheduleRecord,
  type LinkScheduleMode,
  type LinkScheduleRecord,
  type LinkSubtrackerRecord,
  type LinkSortOption,
  type LinkTimeSeriesAnalyticsSummary,
  type ManagedDomainRecord,
  type PrivacyPolicyDocumentRecord,
  type SessionUser,
  type SetupChecklistRecord,
  type UserLinkVariableRecord
} from './lib/api';

type FormState = {
  slug: string;
  canonicalHost: string;
  destinationUrl: string;
  description: string;
  internalOnly: boolean;
  password: string;
};

const emptyForm: FormState = {
  slug: '',
  canonicalHost: '',
  destinationUrl: '',
  description: '',
  internalOnly: false,
  password: ''
};

function hasCreateLinkDraft(form: FormState) {
  return (
    form.slug.trim().length > 0 ||
    (form.destinationUrl.trim().length > 0 &&
      form.destinationUrl.trim() !== defaultDestinationProtocol) ||
    form.description.trim().length > 0 ||
    form.internalOnly ||
    form.password.length > 0
  );
}

const appTitle = '🧱🏌️ Links';
const pageSizeOptions = [20, 50, 100] as const;
const defaultDestinationProtocol = 'https://';
const analyticsTimeWindowOptions: Array<{
  value: LinkAnalyticsTimeWindow;
  label: string;
  summaryLabel: string;
}> = [
  { value: 'all', label: 'All time', summaryLabel: 'all time' },
  { value: '4h', label: 'Last 4 hours', summaryLabel: 'the last 4 hours' },
  { value: '24h', label: 'Last 24 hours', summaryLabel: 'the last 24 hours' },
  { value: '7d', label: 'Last 7 days', summaryLabel: 'the last 7 days' },
  { value: '30d', label: 'Last 30 days', summaryLabel: 'the last 30 days' },
  { value: '90d', label: 'Last 90 days', summaryLabel: 'the last 90 days' }
];
const analyticsTimeWindowValues = new Set<LinkAnalyticsTimeWindow>(
  analyticsTimeWindowOptions.map((option) => option.value)
);
const analyticsTimeWindowStorageKey = 'links.analyticsTimeWindow';
const selectedLinkAnalyticsTimeWindowStorageKey = 'links.selectedLinkAnalyticsTimeWindow';
const destinationVariableSyntaxExample = '{{variable|default}}';
const linkConfigAutoSaveDelayMs = 900;
const shortlinkSlugPattern = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/;
const destinationUrlTemplatePattern =
  /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]{0,63})\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;
const destinationUrlTemplateSampleValues = ['value', 'value.example.com', 'https://example.com'];
const usTimeZoneOptions = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' }
] as const;

type PageSize = (typeof pageSizeOptions)[number];
type LinkListScope = 'mine' | 'listed' | 'all';
type AnalyticsScope = 'mine' | 'all';
type LinkListFilters = {
  searchQuery: string;
  canonicalHost: string;
  sort: LinkSortOption;
};
type DomainRoutingType = 'canonical' | 'auth_via' | 'alias';
type AdminRoute =
  | { view: 'links' }
  | { view: 'setup' }
  | { view: 'variables' }
  | { view: 'analytics' }
  | { view: 'invites' }
  | { view: 'link-config'; linkId: string }
  | { view: 'domains' }
  | { view: 'groups' }
  | { view: 'group-detail'; groupId: string }
  | { view: 'users' }
  | { view: 'user-detail'; userId: string }
  | { view: 'user-variables'; userId: string };

type EditableLinkSchedule = Omit<LinkScheduleRecord, 'id'> & {
  id: number | string;
};

type EditableLinkRotationDestination = {
  id: number | string;
  destinationUrl: string;
};

type EditableLinkRotationSchedule = Omit<LinkRotationScheduleRecord, 'destinations'> & {
  destinations: EditableLinkRotationDestination[];
};

type EditableLinkSubtracker = LinkSubtrackerRecord;
type EditableLinkPassword = LinkPasswordRecord;

type EditableUserLinkVariable = UserLinkVariableRecord & {
  id: number | string;
};

type EditableLinkConfiguration = Omit<
  LinkConfigurationRecord,
  'schedules' | 'rotationSchedule' | 'subtrackers' | 'passwords'
> & {
  schedules: EditableLinkSchedule[];
  rotationSchedule: EditableLinkRotationSchedule | null;
  subtrackers: EditableLinkSubtracker[];
  passwords: EditableLinkPassword[];
};

type ScheduleViewMode = 'visual' | 'edit';
type LinkAvailabilityMode = 'enabled' | 'disabled' | 'expires' | 'waiting-room';

type NotificationTone = 'success' | 'warning' | 'error';
type NotificationState = {
  message: string;
  tone: NotificationTone;
};

type InviteTokenStatus = 'idle' | 'checking' | 'valid' | 'invalid';

type UserLinkVariablesEditorProps = {
  title: string;
  description: ReactNode;
  variables: EditableUserLinkVariable[];
  defaultScheduleTimezone?: string;
  defaultScheduleTimezoneDescription?: ReactNode;
  loading: boolean;
  saving: boolean;
  validationMessage: string | null;
  hasUnsavedChanges: boolean;
  emptyMessage: string;
  onAdd: () => void;
  onChange: (variableId: number | string, field: 'key' | 'value', value: string) => void;
  onDefaultScheduleTimezoneChange?: (value: string) => void;
  onRemove: (variableId: number | string) => void;
  onReset: () => void;
  onSave: () => void | Promise<void>;
  saveLabel?: string;
};

type FloatingActionMenuPosition =
  | {
      top: number;
      right: number;
      bottom?: never;
    }
  | {
      bottom: number;
      right: number;
      top?: never;
    };

type ToolbarDropdownMenu = 'scope' | 'domain' | 'sort' | 'pageSize';

type LinkSortField = 'updated' | 'created' | 'usage' | 'slug' | 'host' | 'destination';

type LinkSortDirection = 'asc' | 'desc';

type ScheduleTimelineSegment = {
  id: string;
  startMinute: number;
  endMinute: number;
  destinationUrl: string;
  isDefault: boolean;
};

function isLinkAnalyticsTimeWindow(value: string | null): value is LinkAnalyticsTimeWindow {
  return value !== null && analyticsTimeWindowValues.has(value as LinkAnalyticsTimeWindow);
}

function getStoredAnalyticsTimeWindow(
  storageKey: string,
  fallback: LinkAnalyticsTimeWindow
): LinkAnalyticsTimeWindow {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return isLinkAnalyticsTimeWindow(storedValue) ? storedValue : fallback;
  } catch {
    return fallback;
  }
}

function storeAnalyticsTimeWindow(storageKey: string, timeWindow: LinkAnalyticsTimeWindow) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, timeWindow);
  } catch {
    // Ignore storage failures and keep the in-memory selection.
  }
}

const linkSortOptions: Array<{
  field: LinkSortField;
  label: string;
  defaultValue: LinkSortOption;
  ascValue: LinkSortOption;
  descValue: LinkSortOption;
}> = [
  {
    field: 'updated',
    label: 'Updated',
    defaultValue: 'updatedDesc',
    ascValue: 'updatedAsc',
    descValue: 'updatedDesc'
  },
  {
    field: 'created',
    label: 'Created',
    defaultValue: 'createdDesc',
    ascValue: 'createdAsc',
    descValue: 'createdDesc'
  },
  {
    field: 'usage',
    label: 'Uses',
    defaultValue: 'usageDesc',
    ascValue: 'usageAsc',
    descValue: 'usageDesc'
  },
  {
    field: 'slug',
    label: 'Slug',
    defaultValue: 'slugAsc',
    ascValue: 'slugAsc',
    descValue: 'slugDesc'
  },
  {
    field: 'host',
    label: 'Host',
    defaultValue: 'hostAsc',
    ascValue: 'hostAsc',
    descValue: 'hostDesc'
  },
  {
    field: 'destination',
    label: 'Destination',
    defaultValue: 'destinationAsc',
    ascValue: 'destinationAsc',
    descValue: 'destinationDesc'
  }
];

function getLinkSortDirection(sortOption: LinkSortOption): LinkSortDirection {
  return sortOption.endsWith('Asc') ? 'asc' : 'desc';
}

function getLinkSortOptionConfig(sortOption: LinkSortOption) {
  return (
    linkSortOptions.find(
      (option) => option.ascValue === sortOption || option.descValue === sortOption
    ) ?? linkSortOptions[0]
  );
}

function getLinkSortOptionValue(
  option: (typeof linkSortOptions)[number],
  direction: LinkSortDirection
): LinkSortOption {
  return direction === 'asc' ? option.ascValue : option.descValue;
}

function getLinkSortDirectionIndicator(direction: LinkSortDirection) {
  return direction === 'asc' ? '↑' : '↓';
}

function getDomainRootRedirectDrafts(managedDomains: ManagedDomainRecord[]) {
  return Object.fromEntries(
    managedDomains.map((domain) => [domain.host, domain.rootRedirectSlug])
  ) as Record<string, string>;
}

function normalizeDomainRootRedirectSlug(value: string | null | undefined) {
  return value?.trim().toLowerCase() || 'admin';
}

function getSafeReturnTo(search: string) {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return null;
  }

  return next;
}

function getInviteToken(search: string) {
  const value = new URLSearchParams(search).get('invite')?.trim() ?? '';
  return /^[A-Za-z0-9_-]{16,200}$/.test(value) ? value : null;
}

function getSearchWithoutParam(search: string, key: string) {
  const params = new URLSearchParams(search);
  params.delete(key);
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : '';
}

function getMissingVariableRedirectKey(search: string) {
  const value = new URLSearchParams(search).get('missingVariable')?.trim().toLowerCase() ?? '';
  return /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : null;
}

function normalizeEmailSignInAddress(value: string) {
  return value.trim().toLowerCase();
}

function normalizeEmailSignInCode(value: string) {
  return value.replace(/\s+/g, '').trim();
}

function getCreateLinkPrefill(search: string) {
  const params = new URLSearchParams(search);
  const slug = params.get('prefillSlug')?.trim().toLowerCase() ?? '';
  const canonicalHost = params.get('prefillCanonicalHost')?.trim().toLowerCase() ?? '';

  if (!slug) {
    return null;
  }

  return {
    slug,
    canonicalHost: canonicalHost || null
  };
}

function createEmptyScheduleEntry(): EditableLinkSchedule {
  return {
    id: `new-${Math.random().toString(36).slice(2, 10)}`,
    startTime: '09:00',
    endTime: '17:00',
    destinationUrl: ''
  };
}

function createEmptyRotationDestination(): EditableLinkRotationDestination {
  return {
    id: `rotation-${Math.random().toString(36).slice(2, 10)}`,
    destinationUrl: ''
  };
}

function getShortUrl(canonicalHost: string, slug: string) {
  return `https://${canonicalHost}/${slug}`;
}

function InlineInfoTooltip({
  label,
  message
}: {
  label: string;
  message: string;
}) {
  return (
    <span className="inline-info-tooltip">
      <button aria-label={label} className="inline-info-tooltip-trigger" type="button">
        <svg
          aria-hidden="true"
          className="inline-info-tooltip-icon"
          viewBox="0 0 24 24"
          focusable="false"
        >
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M16.95 7.05 7.05 16.95"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      </button>
      <span aria-hidden="true" className="inline-info-tooltip-bubble">
        {message}
      </span>
    </span>
  );
}

function InlineInfoTooltipSpacer() {
  return <span aria-hidden="true" className="inline-info-tooltip-spacer" />;
}

function PasswordVisibilityToggle({
  isVisible,
  label,
  onClick
}: {
  isVisible: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="table-icon-button password-visibility-button"
      title={label}
      type="button"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        {isVisible ? (
          <>
            <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </>
        ) : (
          <>
            <path d="M3 3l18 18" />
            <path d="M10.6 6.2A11.2 11.2 0 0 1 12 6c6.2 0 10 6 10 6a18.7 18.7 0 0 1-4 4.5" />
            <path d="M6.7 6.8C3.8 8.7 2 12 2 12s3.8 6 10 6c1.6 0 3-.4 4.2-1" />
            <path d="M14.1 14.2A3 3 0 0 1 9.8 9.9" />
          </>
        )}
      </svg>
    </button>
  );
}

function GenerateSlugButton({
  disabled,
  generating,
  onClick
}: {
  disabled?: boolean;
  generating: boolean;
  onClick: () => void;
}) {
  const label = generating ? 'Generating slug' : 'Generate random slug';

  return (
    <button
      aria-label={label}
      className="slug-generate-button"
      disabled={disabled || generating}
      title={label}
      type="button"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          d="M12 3.5 13.9 8l4.6 1.9-4.6 1.9L12 16.5l-1.9-4.7L5.5 9.9 10.1 8 12 3.5Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M18.5 14.5 19.4 16.6l2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    </button>
  );
}

function getStaticFieldDisplayValue(value: string, emptyLabel = '—') {
  const trimmedValue = value.trim();
  return trimmedValue || emptyLabel;
}

function getMaskedSecretDisplayValue(value: string) {
  return value.trim() ? '••••••••' : '—';
}

function getTrackedShortUrl(
  canonicalHost: string,
  slug: string,
  trackingId: string | null | undefined
) {
  if (!trackingId) {
    return null;
  }

  return `https://${canonicalHost}/${trackingId}/${slug}`;
}

function getAvailableTimeZoneOptions(currentValue: string) {
  if (usTimeZoneOptions.some((option) => option.value === currentValue)) {
    return usTimeZoneOptions;
  }

  return [
    {
      value: currentValue,
      label: `${currentValue} (existing value)`
    },
    ...usTimeZoneOptions
  ];
}

function getRegistrationInviteUrl(token: string) {
  if (typeof window === 'undefined') {
    return `/admin?invite=${encodeURIComponent(token)}`;
  }

  return `${window.location.origin}/admin?invite=${encodeURIComponent(token)}`;
}

function getTimeZoneLabel(timeZone: string) {
  return (
    getAvailableTimeZoneOptions(timeZone).find((option) => option.value === timeZone)?.label ??
    timeZone
  );
}

function getLinkOwnerDefaultScheduleTimezone(
  createdByEmail: string,
  currentUser: SessionUser | null,
  users: AdminUserRecord[]
) {
  const normalizedCreatedByEmail = createdByEmail.trim().toLowerCase();
  if (!normalizedCreatedByEmail) {
    return null;
  }

  if (currentUser?.email.trim().toLowerCase() === normalizedCreatedByEmail) {
    return currentUser.defaultScheduleTimezone;
  }

  return (
    users.find((candidate) => candidate.email.trim().toLowerCase() === normalizedCreatedByEmail)
      ?.default_schedule_timezone ?? null
  );
}

function getAdminRouteFromPath(pathname: string): AdminRoute {
  const userVariablesMatch = pathname.match(/^\/users\/(\d+)\/variables$/);
  if (userVariablesMatch) {
    return {
      view: 'user-variables',
      userId: userVariablesMatch[1]
    };
  }

  const groupDetailMatch = pathname.match(/^\/groups\/(\d+)$/);
  if (groupDetailMatch) {
    return {
      view: 'group-detail',
      groupId: groupDetailMatch[1]
    };
  }

  const linkConfigMatch = pathname.match(/^\/links\/([^/]+)$/);
  if (linkConfigMatch) {
    return {
      view: 'link-config',
      linkId: linkConfigMatch[1]
    };
  }

  const userDetailMatch = pathname.match(/^\/users\/(\d+)$/);
  if (userDetailMatch) {
    return {
      view: 'user-detail',
      userId: userDetailMatch[1]
    };
  }

  if (pathname.startsWith('/analytics')) {
    return { view: 'analytics' };
  }

  if (pathname.startsWith('/invites')) {
    return { view: 'invites' };
  }

  if (pathname.startsWith('/setup')) {
    return { view: 'setup' };
  }

  if (pathname.startsWith('/variables')) {
    return { view: 'variables' };
  }

  if (pathname.startsWith('/domains')) {
    return { view: 'domains' };
  }

  if (pathname.startsWith('/groups')) {
    return { view: 'groups' };
  }

  if (pathname.startsWith('/users')) {
    return { view: 'users' };
  }

  return { view: 'links' };
}

function getCreatableDomains(domains: DomainDefinition[], user: SessionUser | null) {
  const sortDomains = <T extends { host: string }>(values: T[]) =>
    [...values].sort((left, right) => compareDomainHosts(left.host, right.host));

  if (!user) {
    return sortDomains(domains);
  }

  if (user.isSuperAdmin) {
    return sortDomains(domains);
  }

  const allowedHosts = new Set(user.allowedCanonicalHosts);
  return sortDomains(domains.filter((domain) => allowedHosts.has(domain.host)));
}

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

function sortDomainRecordsByHost<T extends { host: string }>(domains: T[]) {
  return [...domains].sort((left, right) => compareDomainHosts(left.host, right.host));
}

function compareRecordsByCreatedAtDesc<
  T extends {
    created_at?: string;
    id: string | number;
  }
>(left: T, right: T) {
  const leftCreatedAtMs = Date.parse(left.created_at ?? '');
  const rightCreatedAtMs = Date.parse(right.created_at ?? '');

  if (!Number.isNaN(leftCreatedAtMs) || !Number.isNaN(rightCreatedAtMs)) {
    if (Number.isNaN(leftCreatedAtMs)) {
      return 1;
    }

    if (Number.isNaN(rightCreatedAtMs)) {
      return -1;
    }

    if (leftCreatedAtMs !== rightCreatedAtMs) {
      return rightCreatedAtMs - leftCreatedAtMs;
    }
  }

  return String(right.id).localeCompare(String(left.id), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function normalizeEmailDomainsFromDraft(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((part) => part.trim().toLowerCase().replace(/^@+/, ''))
        .filter((part) => part.length > 0)
    )
  ];
}

function getEditableLinkDomains(
  domains: DomainDefinition[],
  user: SessionUser | null,
  currentCanonicalHost: string | null
) {
  const editableDomains = user?.isSuperAdmin ? domains : getCreatableDomains(domains, user);

  if (!currentCanonicalHost || editableDomains.some((domain) => domain.host === currentCanonicalHost)) {
    return editableDomains;
  }

  return sortDomainRecordsByHost([
    {
      host: currentCanonicalHost,
      label: currentCanonicalHost,
      aliases: []
    },
    ...editableDomains
  ]);
}

function getVisibleDomainRoutingTargets(
  domains: DomainDefinition[],
  managedDomains: ManagedDomainRecord[],
  user: SessionUser | null,
  currentDomainHost: string,
  currentTargetHost: string | null
) {
  const availableTargets = user?.isSuperAdmin
    ? managedDomains.filter((domain) => domain.host !== currentDomainHost)
    : getCreatableDomains(domains, user)
        .filter((domain) => domain.host !== currentDomainHost)
        .map((domain) => ({
          host: domain.host,
          label: domain.label,
          aliasTargetHost: null,
          rootRedirectSlug: 'admin',
          authProviderHost: null,
          isDefaultForNewAccounts: domain.isDefaultForNewAccounts ?? false,
          linkCount: domain.linkCount ?? 0
        } satisfies ManagedDomainRecord));

  if (!currentTargetHost || availableTargets.some((domain) => domain.host === currentTargetHost)) {
    return sortDomainRecordsByHost(availableTargets);
  }

  const currentTarget =
    managedDomains.find((domain) => domain.host === currentTargetHost) ??
    domains.find((domain) => domain.host === currentTargetHost);

  if (!currentTarget) {
    return sortDomainRecordsByHost(availableTargets);
  }

  return sortDomainRecordsByHost([
    ...availableTargets,
    'aliasTargetHost' in currentTarget
      ? currentTarget
      : {
          host: currentTarget.host,
          label: currentTarget.label,
          aliasTargetHost: null,
          rootRedirectSlug: 'admin',
          authProviderHost: null,
          isDefaultForNewAccounts: currentTarget.isDefaultForNewAccounts ?? false,
          linkCount: currentTarget.linkCount ?? 0
        }
  ]);
}

function getManagedShortlinkReference(
  destinationUrl: string,
  domains: DomainDefinition[]
): { canonicalHost: string; slug: string } | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(destinationUrl);
  } catch {
    return null;
  }

  const host = parsedUrl.hostname.toLowerCase();
  const matchedDomain = domains.find(
    (domain) => domain.host.toLowerCase() === host || domain.aliases.some((alias) => alias.toLowerCase() === host)
  );

  if (!matchedDomain) {
    return null;
  }

  const slug = parsedUrl.pathname.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();

  if (!slug) {
    return null;
  }

  return {
    canonicalHost: matchedDomain.host.toLowerCase(),
    slug
  };
}

function getDomainRoutingType(domain: ManagedDomainRecord): DomainRoutingType {
  if (domain.aliasTargetHost) {
    return 'alias';
  }

  if (domain.authProviderHost) {
    return 'auth_via';
  }

  return 'canonical';
}

function formatDestinationLabel(url: string) {
  return url.startsWith('https://') ? url.slice('https://'.length) : url;
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function getAnalyticsWindowLabel(timeWindow: LinkAnalyticsTimeWindow) {
  return (
    analyticsTimeWindowOptions.find((option) => option.value === timeWindow)?.summaryLabel ??
    'all time'
  );
}

function getAnalyticsTimeSeriesLabel(granularity: LinkAnalyticsTimeSeriesGranularity) {
  switch (granularity) {
    case 'tenMinutes':
      return 'Views per 10 minutes';
    case 'hour':
      return 'Views per hour';
    case 'day':
      return 'Views per day';
    case 'week':
      return 'Views per week';
    case 'month':
      return 'Views per month';
  }
}

function formatAnalyticsTimeSeriesAxisLabel(
  bucketStart: string,
  granularity: LinkAnalyticsTimeSeriesGranularity
) {
  const date = new Date(bucketStart);

  switch (granularity) {
    case 'tenMinutes':
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit'
      }).format(date);
    case 'hour':
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric' }).format(date);
    case 'day':
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
    case 'week':
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
    case 'month':
      return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(date);
  }
}

function formatAnalyticsTimeSeriesTooltipLabel(
  bucketStart: string,
  granularity: LinkAnalyticsTimeSeriesGranularity
) {
  const date = new Date(bucketStart);

  switch (granularity) {
    case 'tenMinutes':
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(date);
    case 'hour':
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric'
      }).format(date);
    case 'day':
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(date);
    case 'week': {
      const weekEnd = new Date(date);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      return `${new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric'
      }).format(date)} - ${new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(weekEnd)}`;
    }
    case 'month':
      return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
  }
}

function shouldShowAnalyticsAxisLabel(index: number, total: number) {
  if (total <= 1 || index === 0 || index === total - 1) {
    return true;
  }

  const step = Math.max(1, Math.ceil(total / 6));
  return index % step === 0;
}

function AnalyticsTimeSeriesChart({
  timeWindow,
  timeSeries
}: {
  timeWindow: LinkAnalyticsTimeWindow;
  timeSeries: {
    granularity: LinkAnalyticsTimeSeriesGranularity;
    points: LinkAnalyticsTimeSeriesPoint[];
  };
}) {
  if (timeSeries.points.length === 0) {
    return (
      <p>
        {timeWindow === 'all'
          ? 'No time-series analytics are available yet.'
          : 'No time-series analytics are available in this window yet.'}
      </p>
    );
  }

  const maxUses = Math.max(...timeSeries.points.map((point) => point.totalUses), 1);
  const gridTemplateColumns = `repeat(${timeSeries.points.length}, minmax(0, 1fr))`;
  const minWidth = `${Math.max(320, timeSeries.points.length * 24)}px`;

  return (
    <div className="analytics-chart">
      <div className="analytics-chart-header">
        <span className="analytics-label">{getAnalyticsTimeSeriesLabel(timeSeries.granularity)}</span>
        <strong>{formatCount(maxUses)} max</strong>
      </div>
      <div className="analytics-chart-scroll">
        <div
          className="analytics-chart-bars"
          style={{ gridTemplateColumns, minWidth }}
          role="img"
          aria-label={`${getAnalyticsTimeSeriesLabel(timeSeries.granularity)} chart`}
        >
          {timeSeries.points.map((point) => {
            const height = point.totalUses === 0 ? 0 : Math.max(4, getPercentage(point.totalUses, maxUses));
            const tooltipLabel = formatAnalyticsTimeSeriesTooltipLabel(
              point.bucketStart,
              timeSeries.granularity
            );

            return (
              <div className="analytics-chart-column" key={point.bucketStart}>
                <div
                  className="analytics-chart-bar-track"
                  title={`${tooltipLabel}: ${formatCount(point.totalUses)} uses`}
                >
                  <div className="analytics-chart-bar" style={{ height: `${height}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="analytics-chart-axis" style={{ gridTemplateColumns, minWidth }}>
          {timeSeries.points.map((point, index) => (
            <span key={`${point.bucketStart}-label`}>
              {shouldShowAnalyticsAxisLabel(index, timeSeries.points.length)
                ? formatAnalyticsTimeSeriesAxisLabel(point.bucketStart, timeSeries.granularity)
                : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function getPercentage(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return (value / total) * 100;
}

function normalizeDestinationInputValue(value: string) {
  if (!value.startsWith(defaultDestinationProtocol)) {
    return value;
  }

  const remainder = value.slice(defaultDestinationProtocol.length);
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(remainder) ? remainder : value;
}

let nextUserLinkVariableDraftId = 1;

function createEditableUserLinkVariables(
  variables: UserLinkVariableRecord[]
): EditableUserLinkVariable[] {
  return variables.map((variable, index) => ({
    id: `${variable.key}-${index}`,
    ...variable
  }));
}

function createEmptyUserLinkVariable(): EditableUserLinkVariable {
  const draftId = nextUserLinkVariableDraftId;
  nextUserLinkVariableDraftId += 1;

  return {
    id: `draft-link-variable-${draftId}`,
    key: '',
    value: ''
  };
}

function getUserLinkVariablesSnapshot(variables: EditableUserLinkVariable[]) {
  return JSON.stringify(
    variables.map((variable) => ({
      key: variable.key.trim().toLowerCase(),
      value: variable.value.trim()
    }))
  );
}

function getUserLinkVariableValidationMessage(variables: EditableUserLinkVariable[]) {
  const seenKeys = new Set<string>();

  for (const variable of variables) {
    const key = variable.key.trim().toLowerCase();
    const value = variable.value.trim();

    if (!key && !value) {
      continue;
    }

    if (!key) {
      return 'Each variable needs a key.';
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) {
      return 'Variable keys must start with a letter and use letters, numbers, hyphens, or underscores.';
    }

    if (!value) {
      return `Variable "${key}" needs a value.`;
    }

    if (seenKeys.has(key)) {
      return `Variable "${key}" is defined more than once.`;
    }

    seenKeys.add(key);
  }

  return null;
}

function UserLinkVariablesEditor({
  title,
  description,
  variables,
  defaultScheduleTimezone,
  defaultScheduleTimezoneDescription,
  loading,
  saving,
  validationMessage,
  hasUnsavedChanges,
  emptyMessage,
  onAdd,
  onChange,
  onDefaultScheduleTimezoneChange,
  onRemove,
  onReset,
  onSave,
  saveLabel = 'Save variables'
}: UserLinkVariablesEditorProps) {
  return (
    <>
      <div className="table-toolbar">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="ghost-button" type="button" onClick={onAdd}>
          Add variable
        </button>
      </div>

      {loading && variables.length === 0 ? (
        <p>Loading variables...</p>
      ) : variables.length === 0 ? (
        <p>{emptyMessage}</p>
      ) : (
        <div className="link-variable-list">
          {variables.map((variable) => (
            <div className="link-variable-row" key={variable.id}>
              <label>
                <span>Key</span>
                <input
                  placeholder="directory_id"
                  value={variable.key}
                  onChange={(event) => onChange(variable.id, 'key', event.target.value)}
                />
              </label>
              <label>
                <span>Value</span>
                <input
                  placeholder="guest"
                  value={variable.value}
                  onChange={(event) => onChange(variable.id, 'value', event.target.value)}
                />
              </label>
              <button className="ghost-button" type="button" onClick={() => onRemove(variable.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {defaultScheduleTimezone && onDefaultScheduleTimezoneChange ? (
        <div className="link-variable-settings">
          <label className="schedule-timezone-field">
            <span>Timezone</span>
            <select
              value={defaultScheduleTimezone}
              onChange={(event) => onDefaultScheduleTimezoneChange(event.target.value)}
            >
              {getAvailableTimeZoneOptions(defaultScheduleTimezone).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {defaultScheduleTimezoneDescription ? (
            <p className="meta-note">{defaultScheduleTimezoneDescription}</p>
          ) : null}
        </div>
      ) : null}

      {validationMessage ? <div className="error-banner">{validationMessage}</div> : null}

      <div className="detail-actions link-variable-actions">
        <button
          className="table-action-button"
          disabled={!hasUnsavedChanges || saving}
          type="button"
          onClick={onReset}
        >
          Cancel changes
        </button>
        <button
          className="primary-button"
          disabled={saving || !hasUnsavedChanges || Boolean(validationMessage)}
          type="button"
          onClick={() => void onSave()}
        >
          {saving ? 'Saving...' : saveLabel}
        </button>
      </div>
    </>
  );
}

function parseScheduleMinute(time: string) {
  if (time === '24:00') {
    return 24 * 60;
  }

  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatScheduleMinute(minute: number) {
  const normalizedMinute = minute === 24 * 60 ? 0 : minute;
  const hours = Math.floor(normalizedMinute / 60);
  const minutes = normalizedMinute % 60;
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  const twelveHour = hours % 12 || 12;
  return `${twelveHour}:${String(minutes).padStart(2, '0')} ${meridiem}`;
}

type RotationOccurrence = {
  startMinuteTotal: number;
  endMinuteTotal: number;
  isCurrent: boolean;
};

function getUpcomingRotationOccurrence(
  slotStartMinute: number,
  intervalMinutes: number,
  cycleMinutes: number,
  currentMinute: number
): RotationOccurrence | null {
  if (intervalMinutes <= 0 || cycleMinutes <= 0) {
    return null;
  }

  let occurrenceStartMinute = slotStartMinute;

  if (currentMinute >= slotStartMinute) {
    const cyclesSinceStart = Math.floor((currentMinute - slotStartMinute) / cycleMinutes);
    occurrenceStartMinute += cyclesSinceStart * cycleMinutes;
  }

  const occurrenceEndMinute = occurrenceStartMinute + intervalMinutes;
  const isCurrent =
    currentMinute >= occurrenceStartMinute && currentMinute < occurrenceEndMinute;

  if (isCurrent) {
    return {
      startMinuteTotal: occurrenceStartMinute,
      endMinuteTotal: occurrenceEndMinute,
      isCurrent: true
    };
  }

  if (occurrenceStartMinute <= currentMinute) {
    occurrenceStartMinute += cycleMinutes;
  }

  return {
    startMinuteTotal: occurrenceStartMinute,
    endMinuteTotal: occurrenceStartMinute + intervalMinutes,
    isCurrent: false
  };
}

function formatRotationOccurrenceMinute(totalMinute: number) {
  const dayOffset = Math.floor(totalMinute / (24 * 60));
  const minuteOfDay = totalMinute % (24 * 60);
  const timeLabel = formatScheduleMinute(minuteOfDay);

  if (dayOffset === 0) {
    return timeLabel;
  }

  if (dayOffset === 1) {
    return `Tomorrow ${timeLabel}`;
  }

  return `+${dayOffset}d ${timeLabel}`;
}

function formatRotationOccurrenceLabel(occurrence: RotationOccurrence | null) {
  if (!occurrence) {
    return null;
  }

  return `${formatRotationOccurrenceMinute(occurrence.startMinuteTotal)} - ${formatRotationOccurrenceMinute(occurrence.endMinuteTotal)}`;
}

function getCurrentMinuteOfDay(timeZone: string, dateInput: Date | number = Date.now()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

  return hour * 60 + minute;
}

function buildScheduleTimeline(config: EditableLinkConfiguration): ScheduleTimelineSegment[] {
  const sortedSchedules = [...config.schedules]
    .map((schedule, index) => ({
      id: `${schedule.id ?? index}`,
      startMinute: parseScheduleMinute(schedule.startTime),
      endMinute: parseScheduleMinute(schedule.endTime),
      destinationUrl: schedule.destinationUrl
    }))
    .filter((schedule) => schedule.endMinute > schedule.startMinute)
    .sort((left, right) => left.startMinute - right.startMinute);

  const timeline: ScheduleTimelineSegment[] = [];
  let cursor = 0;

  for (const schedule of sortedSchedules) {
    if (schedule.startMinute > cursor) {
      timeline.push({
        id: `default-${cursor}-${schedule.startMinute}`,
        startMinute: cursor,
        endMinute: schedule.startMinute,
        destinationUrl: config.destination_url,
        isDefault: true
      });
    }

    timeline.push({
      id: schedule.id,
      startMinute: Math.max(cursor, schedule.startMinute),
      endMinute: schedule.endMinute,
      destinationUrl: schedule.destinationUrl,
      isDefault: false
    });
    cursor = Math.max(cursor, schedule.endMinute);
  }

  if (cursor < 24 * 60) {
    timeline.push({
      id: `default-${cursor}-1440`,
      startMinute: cursor,
      endMinute: 24 * 60,
      destinationUrl: config.destination_url,
      isDefault: true
    });
  }

  if (timeline.length === 0) {
    return [
      {
        id: 'default-full-day',
        startMinute: 0,
        endMinute: 24 * 60,
        destinationUrl: config.destination_url,
        isDefault: true
      }
    ];
  }

  return timeline;
}

function buildRotationTimeline(config: EditableLinkConfiguration): ScheduleTimelineSegment[] {
  const intervalMinutes = config.rotationSchedule?.intervalMinutes ?? 0;
  const destinations = config.rotationSchedule?.destinations ?? [];

  if (intervalMinutes <= 0 || destinations.length === 0) {
    return [];
  }

  return destinations.map((destination, index) => ({
    id: `${destination.id ?? index}`,
    startMinute: index * intervalMinutes,
    endMinute: (index + 1) * intervalMinutes,
    destinationUrl: destination.destinationUrl,
    isDefault: false
  }));
}

function hasConfiguredScheduleEntries(config: EditableLinkConfiguration | null) {
  if (!config) {
    return false;
  }

  if (config.scheduleMode === 'rotation') {
    return Boolean(config.rotationSchedule?.destinations.length);
  }

  return config.schedules.length > 0;
}

function hasTrackedLinkSettings(config: EditableLinkConfiguration | null) {
  if (!config) {
    return false;
  }

  return config.requires_tracking_id || config.subtrackers.length > 0;
}

function hasPasswordProtection(
  config: Pick<EditableLinkConfiguration, 'hasLegacyPasswordPrompt' | 'passwords'>
) {
  return Boolean(
    (config.hasLegacyPasswordPrompt ?? false) ||
      config.passwords.some((password) => !password.isDisabled)
  );
}

function cloneEditableLinkConfiguration(
  config: EditableLinkConfiguration | LinkConfigurationRecord
): EditableLinkConfiguration {
  return {
    ...config,
    schedules: config.schedules.map((schedule) => ({ ...schedule })),
    subtrackers: config.subtrackers.map((subtracker) => ({ ...subtracker })),
    passwords: config.passwords.map((password) => ({ ...password })),
    rotationSchedule: config.rotationSchedule
      ? {
          intervalMinutes: config.rotationSchedule.intervalMinutes,
          destinations: config.rotationSchedule.destinations.map((destination) => ({
            ...destination
          }))
        }
      : null
  };
}

function getLinkConfigurationSnapshot(config: EditableLinkConfiguration | null) {
  if (!config) {
    return null;
  }

  return JSON.stringify({
    id: config.id,
    canonicalHost: config.canonical_host,
    slug: config.slug,
    destinationUrl: config.destination_url,
    description: config.description ?? '',
    internalOnly: config.internal_only,
    hasPassword: hasPasswordProtection(config),
    hasLegacyPasswordPrompt: config.hasLegacyPasswordPrompt ?? false,
    rememberPasswordAccess: config.rememberPasswordAccess,
    isListed: config.is_listed,
    requiresTrackingId: config.requires_tracking_id,
    waitingRoomEnabled: config.waiting_room_enabled,
    disabledDestinationUrl: config.disabledDestinationUrl ?? '',
    expirationAt: config.expiresAt ?? '',
    scheduleTimezone: config.scheduleTimezone,
    scheduleMode: config.scheduleMode,
    isDisabled: config.is_disabled,
    subtrackers: config.subtrackers.map((subtracker) => ({
      id: subtracker.id,
      name: subtracker.name,
      trackingId: subtracker.trackingId,
      isDisabled: subtracker.isDisabled,
      usageCount: subtracker.usageCount,
    })),
    passwords: config.passwords.map((password) => ({
      id: password.id,
      name: password.name,
      password: password.password,
      isDisabled: password.isDisabled,
      usageCount: password.usageCount
    })),
    schedules: config.schedules.map((schedule) => ({
      id: schedule.id,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      destinationUrl: schedule.destinationUrl
    })),
    rotationSchedule: config.rotationSchedule
      ? {
          intervalMinutes: config.rotationSchedule.intervalMinutes,
          destinations: config.rotationSchedule.destinations.map((destination) => ({
            id: destination.id,
            destinationUrl: destination.destinationUrl
          }))
        }
      : null
  });
}

function isAbsoluteUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function hasWellFormedDestinationUrlTemplates(destinationUrl: string) {
  const strippedValue = destinationUrl.replace(destinationUrlTemplatePattern, '');
  return !strippedValue.includes('{{') && !strippedValue.includes('}}');
}

function replaceDestinationUrlTemplates(
  destinationUrl: string,
  resolveValue: (key: string, fallbackValue: string | null) => string
) {
  return destinationUrl.replace(
    destinationUrlTemplatePattern,
    (_match, key: string, fallbackValue?: string) =>
      resolveValue(key.toLowerCase(), fallbackValue !== undefined ? fallbackValue.trim() : null)
  );
}

function isConfiguredDestinationUrl(destinationUrl: string) {
  if (!hasWellFormedDestinationUrlTemplates(destinationUrl)) {
    return false;
  }

  return destinationUrlTemplateSampleValues.some((sampleValue) =>
    isAbsoluteUrl(
      replaceDestinationUrlTemplates(
        destinationUrl,
        (_key, fallbackValue) => fallbackValue ?? sampleValue
      )
    )
  );
}

function getLinkConfigurationDraftSnapshot(
  config: EditableLinkConfiguration | null,
  availabilityMode: LinkAvailabilityMode
) {
  if (!config) {
    return null;
  }

  return JSON.stringify({
    configuration: getLinkConfigurationSnapshot(config),
    availabilityMode
  });
}

function normalizeEditableLinkPasswords(passwords: EditableLinkPassword[]) {
  return passwords.map((password) => ({
    id: typeof password.id === 'string' && /^\d+$/.test(password.id) ? password.id : undefined,
    name: password.name.trim(),
    password: password.password.trim(),
    isDisabled: password.isDisabled
  }));
}

function getDestinationUrlValidationMessage(label: string, destinationUrl: string) {
  const trimmedDestinationUrl = destinationUrl.trim();
  if (!trimmedDestinationUrl || !isConfiguredDestinationUrl(trimmedDestinationUrl)) {
    return `${label} must be a valid URL. Variables use ${destinationVariableSyntaxExample} or {{name}}.`;
  }

  return null;
}

function getLinkConfigurationValidationMessage(
  config: EditableLinkConfiguration | null,
  availabilityMode: LinkAvailabilityMode
) {
  if (!config) {
    return null;
  }

  if (!config.canonical_host.trim()) {
    return 'Host is required.';
  }

  const trimmedSlug = config.slug.trim();
  if (!trimmedSlug) {
    return 'Slug is required.';
  }

  if (!shortlinkSlugPattern.test(trimmedSlug)) {
    return 'Slug can only contain letters, numbers, periods, underscores, hyphens, and forward slashes between segments.';
  }

  const destinationValidationMessage = getDestinationUrlValidationMessage(
    'Destination URL',
    config.destination_url
  );
  if (destinationValidationMessage) {
    return destinationValidationMessage;
  }

  if ((config.description ?? '').trim().length > 500) {
    return 'Description must be 500 characters or fewer.';
  }

  if ((config.disabledDestinationUrl ?? '').trim()) {
    const disabledDestinationValidationMessage = getDestinationUrlValidationMessage(
      'Disabled destination URL',
      config.disabledDestinationUrl ?? ''
    );
    if (disabledDestinationValidationMessage) {
      return disabledDestinationValidationMessage;
    }
  }

  if (availabilityMode === 'expires' && !config.expiresAt) {
    return 'Expiration is required when availability is set to Expires.';
  }

  if (
    config.requires_tracking_id &&
    !config.subtrackers.some((subtracker) => !subtracker.isDisabled)
  ) {
    return 'Add at least one active tagged link before requiring tracking IDs.';
  }

  if (config.subtrackers.some((subtracker) => subtracker.name.trim().length === 0)) {
    return 'Each tagged link needs a name.';
  }

  const normalizedPasswords = normalizeEditableLinkPasswords(config.passwords);
  if (normalizedPasswords.some((password) => !password.name || !password.password)) {
    return 'Each password needs both a name and a password.';
  }

  if (
    normalizedPasswords.length > 0 &&
    new Set(normalizedPasswords.map((password) => password.password)).size !==
      normalizedPasswords.length
  ) {
    return 'Each password must be unique.';
  }

  if (config.scheduleMode === 'rotation') {
    const destinations = config.rotationSchedule?.destinations ?? [];
    if (destinations.length === 0) {
      return 'Add at least one rotation destination when rotation mode is configured.';
    }

    for (const destination of destinations) {
      const rotationDestinationValidationMessage = getDestinationUrlValidationMessage(
        'Rotation destination URL',
        destination.destinationUrl
      );
      if (rotationDestinationValidationMessage) {
        return rotationDestinationValidationMessage;
      }
    }

    const rotationIntervalMinutes = config.rotationSchedule?.intervalMinutes ?? null;
    if (rotationIntervalMinutes === null) {
      return 'Rotation interval is required when rotation destinations are configured.';
    }

    if (rotationIntervalMinutes * destinations.length > 24 * 60) {
      return 'Rotation schedules must fit within a 24-hour day.';
    }

    return null;
  }

  const sortedSchedules = [...config.schedules]
    .map((schedule) => ({
      startMinute: parseScheduleMinute(schedule.startTime),
      endMinute: parseScheduleMinute(schedule.endTime),
      destinationUrl: schedule.destinationUrl
    }))
    .sort((left, right) => left.startMinute - right.startMinute);

  for (const schedule of sortedSchedules) {
    const scheduledDestinationValidationMessage = getDestinationUrlValidationMessage(
      'Scheduled destination URL',
      schedule.destinationUrl
    );
    if (scheduledDestinationValidationMessage) {
      return scheduledDestinationValidationMessage;
    }

    if (schedule.endMinute <= schedule.startMinute) {
      return 'Each scheduled destination must end after it starts.';
    }
  }

  for (let index = 1; index < sortedSchedules.length; index += 1) {
    const previousSchedule = sortedSchedules[index - 1];
    const currentSchedule = sortedSchedules[index];

    if (currentSchedule.startMinute < previousSchedule.endMinute) {
      return 'Scheduled destinations cannot overlap.';
    }
  }

  return null;
}

function isExpiredAt(expiresAt: string | null) {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
}

function getDateTimePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(date);
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: Number(partValue('year')),
    month: Number(partValue('month')),
    day: Number(partValue('day')),
    hour: Number(partValue('hour')),
    minute: Number(partValue('minute')),
    second: Number(partValue('second'))
  };
}

function formatDateTimeLocalValue(isoValue: string | null, timeZone: string) {
  if (!isoValue) {
    return '';
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = getDateTimePartsInTimeZone(date, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getDateTimePartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function parseDateTimeLocalValue(value: string, timeZone: string) {
  if (!value) {
    return null;
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const guessUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  );

  let candidateUtcMs = guessUtcMs;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    candidateUtcMs = guessUtcMs - getTimeZoneOffsetMs(new Date(candidateUtcMs), timeZone);
  }

  const candidateDate = new Date(candidateUtcMs);
  if (Number.isNaN(candidateDate.getTime())) {
    return null;
  }

  return candidateDate.toISOString();
}

function formatExpirationLabel(expiresAt: string, timeZone?: string) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return expiresAt;
  }

  return date.toLocaleString(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: timeZone ? 'short' : undefined
  });
}

function formatExpirationCountdown(expiresAt: string, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return null;
  }

  let remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) {
    return null;
  }

  const units = [
    { label: 'year', ms: 365 * 24 * 60 * 60 * 1_000 },
    { label: 'month', ms: 30 * 24 * 60 * 60 * 1_000 },
    { label: 'day', ms: 24 * 60 * 60 * 1_000 },
    { label: 'hour', ms: 60 * 60 * 1_000 },
    { label: 'minute', ms: 60 * 1_000 }
  ];
  const parts: string[] = [];

  for (const unit of units) {
    if (parts.length === 2) {
      break;
    }

    const count = Math.floor(remainingMs / unit.ms);
    if (count <= 0) {
      continue;
    }

    parts.push(`${count} ${unit.label}${count === 1 ? '' : 's'}`);
    remainingMs -= count * unit.ms;
  }

  if (parts.length === 0) {
    return 'less than a minute';
  }

  return parts.join(' ');
}

function getScheduleSegmentProgressPercent(
  startMinute: number,
  endMinute: number,
  activeMinute: number | null
) {
  if (activeMinute === null || endMinute <= startMinute) {
    return 0;
  }

  return ((activeMinute - startMinute) / (endMinute - startMinute)) * 100;
}

function formatRemainingMinutes(totalMinutes: number) {
  if (totalMinutes <= 0) {
    return 'less than a minute';
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} day${days === 1 ? '' : 's'}`);
  }

  if (hours > 0 && parts.length < 2) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  }

  if (minutes > 0 && parts.length < 2) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

function getDefaultExpirationIso() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  date.setSeconds(0, 0);
  return date.toISOString();
}

function getLinkAvailabilityMode(input: {
  is_disabled: boolean;
  expiresAt: string | null;
  waiting_room_enabled?: boolean;
}): LinkAvailabilityMode {
  if (input.is_disabled) {
    return 'disabled';
  }

  if (input.expiresAt) {
    return 'expires';
  }

  if (input.waiting_room_enabled) {
    return 'waiting-room';
  }

  return 'enabled';
}

function hasConfiguredAvailabilitySettings(
  config: Pick<
    EditableLinkConfiguration,
    'disabledDestinationUrl' | 'is_disabled' | 'expiresAt' | 'waiting_room_enabled'
  > | null,
  availabilityMode?: LinkAvailabilityMode
) {
  if (!config) {
    return false;
  }

  return (
    (availabilityMode ?? getLinkAvailabilityMode(config)) !== 'enabled' ||
    (config.disabledDestinationUrl ?? '').trim().length > 0
  );
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminRoute = getAdminRouteFromPath(location.pathname);
  const selectedRouteUserId =
    adminRoute.view === 'user-detail' || adminRoute.view === 'user-variables'
      ? adminRoute.userId
      : null;
  const selectedRouteGroupId = adminRoute.view === 'group-detail' ? adminRoute.groupId : null;
  const selectedRouteLinkId = adminRoute.view === 'link-config' ? adminRoute.linkId : null;
  const [domains, setDomains] = useState<DomainDefinition[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [managedDomains, setManagedDomains] = useState<ManagedDomainRecord[]>([]);
  const [domainRootRedirectDrafts, setDomainRootRedirectDrafts] = useState<Record<string, string>>(
    {}
  );
  const [setupChecklist, setSetupChecklist] = useState<SetupChecklistRecord | null>(null);
  const [privacyPolicyDocument, setPrivacyPolicyDocument] =
    useState<PrivacyPolicyDocumentRecord | null>(null);
  const [privacyPolicyMarkdown, setPrivacyPolicyMarkdown] = useState('');
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [groups, setGroups] = useState<AdminGroupRecord[]>([]);
  const [invites, setInvites] = useState<AdminRegistrationInviteRecord[]>([]);
  const [analytics, setAnalytics] = useState<LinkAnalyticsSummary | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [selectedUserAllowedHosts, setSelectedUserAllowedHosts] = useState<string[]>([]);
  const [selectedUserDefaultScheduleTimezone, setSelectedUserDefaultScheduleTimezone] =
    useState('America/Chicago');
  const [selectedGroup, setSelectedGroup] = useState<AdminGroupDetail | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState('');
  const [selectedGroupMemberUserIds, setSelectedGroupMemberUserIds] = useState<string[]>([]);
  const [selectedGroupAllowedHosts, setSelectedGroupAllowedHosts] = useState<string[]>([]);
  const [selectedGroupDomainAdministrationHosts, setSelectedGroupDomainAdministrationHosts] =
    useState<string[]>([]);
  const [selectedGroupAutoMemberEmailDomainsText, setSelectedGroupAutoMemberEmailDomainsText] =
    useState('');
  const [selectedLinkConfig, setSelectedLinkConfig] = useState<EditableLinkConfiguration | null>(null);
  const [selectedLinkAnalytics, setSelectedLinkAnalytics] =
    useState<LinkTimeSeriesAnalyticsSummary | null>(null);
  const [selectedLinkAvailabilityMode, setSelectedLinkAvailabilityMode] =
    useState<LinkAvailabilityMode>('enabled');
  const [googleClientId, setGoogleClientId] = useState('');
  const [emailCodeEnabled, setEmailCodeEnabled] = useState(false);
  const [showEmailSignInForm, setShowEmailSignInForm] = useState(false);
  const [emailSignInAddress, setEmailSignInAddress] = useState('');
  const [emailSignInCode, setEmailSignInCode] = useState('');
  const [emailCodeRequested, setEmailCodeRequested] = useState(false);
  const [requestingEmailCode, setRequestingEmailCode] = useState(false);
  const [verifyingEmailCode, setVerifyingEmailCode] = useState(false);
  const [emailCodeExpiresInMinutes, setEmailCodeExpiresInMinutes] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isCreateLinkSectionExpanded, setIsCreateLinkSectionExpanded] = useState(() =>
    Boolean(getCreateLinkPrefill(location.search))
  );
  const [loading, setLoading] = useState(true);
  const [linksLoading, setLinksLoading] = useState(false);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [setupChecklistLoading, setSetupChecklistLoading] = useState(false);
  const [privacyPolicyLoading, setPrivacyPolicyLoading] = useState(false);
  const [privacyPolicyLoadError, setPrivacyPolicyLoadError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [selectedUserLoading, setSelectedUserLoading] = useState(false);
  const [selectedGroupLoading, setSelectedGroupLoading] = useState(false);
  const [selectedLinkConfigLoading, setSelectedLinkConfigLoading] = useState(false);
  const [selectedLinkAnalyticsLoading, setSelectedLinkAnalyticsLoading] = useState(false);
  const [userLinkVariablesLoading, setUserLinkVariablesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLinkAnalyticsError, setSelectedLinkAnalyticsError] = useState<string | null>(null);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [inviteTokenStatus, setInviteTokenStatus] = useState<InviteTokenStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [generatingCreateSlug, setGeneratingCreateSlug] = useState(false);
  const [savingUserLinkVariables, setSavingUserLinkVariables] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editingCanonicalHost, setEditingCanonicalHost] = useState('');
  const [editingSlug, setEditingSlug] = useState('');
  const [editingDestinationUrl, setEditingDestinationUrl] = useState('');
  const [generatingEditingSlugLinkId, setGeneratingEditingSlugLinkId] = useState<string | null>(null);
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);
  const [togglingLinkDisabledId, setTogglingLinkDisabledId] = useState<string | null>(null);
  const [togglingLinkInternalId, setTogglingLinkInternalId] = useState<string | null>(null);
  const [copiedPasswordId, setCopiedPasswordId] = useState<string | null>(null);
  const [copiedTrackedSubtrackerId, setCopiedTrackedSubtrackerId] = useState<string | null>(null);
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null);
  const [editingSubtrackerId, setEditingSubtrackerId] = useState<string | null>(null);
  const [openActionMenuLinkId, setOpenActionMenuLinkId] = useState<string | null>(null);
  const [openActionMenuPosition, setOpenActionMenuPosition] =
    useState<FloatingActionMenuPosition | null>(null);
  const [savingDomainHost, setSavingDomainHost] = useState<string | null>(null);
  const [savingPrivacyPolicy, setSavingPrivacyPolicy] = useState(false);
  const [savingSelectedUser, setSavingSelectedUser] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [savingSelectedGroup, setSavingSelectedGroup] = useState(false);
  const [deletingSelectedGroup, setDeletingSelectedGroup] = useState(false);
  const [savingLinkConfig, setSavingLinkConfig] = useState(false);
  const [generatingLinkConfigSlug, setGeneratingLinkConfigSlug] = useState(false);
  const [linkConfigAutoSaveError, setLinkConfigAutoSaveError] = useState<string | null>(null);
  const [linkConfigAutoSaveFailedSnapshot, setLinkConfigAutoSaveFailedSnapshot] =
    useState<string | null>(null);
  const [addingPassword, setAddingPassword] = useState(false);
  const [addingSubtracker, setAddingSubtracker] = useState(false);
  const [togglingPasswordId, setTogglingPasswordId] = useState<string | null>(null);
  const [togglingSubtrackerId, setTogglingSubtrackerId] = useState<string | null>(null);
  const [scheduleViewMode, setScheduleViewMode] = useState<ScheduleViewMode>('visual');
  const [isDescriptionEditorVisible, setIsDescriptionEditorVisible] = useState(false);
  const [isAvailabilitySectionExpanded, setIsAvailabilitySectionExpanded] = useState(false);
  const [isPasswordLinksSectionExpanded, setIsPasswordLinksSectionExpanded] = useState(false);
  const [isScheduleSectionExpanded, setIsScheduleSectionExpanded] = useState(false);
  const [isTrackedLinksSectionExpanded, setIsTrackedLinksSectionExpanded] = useState(false);
  const [appBuildId, setAppBuildId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [mineLinkCount, setMineLinkCount] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [openToolbarDropdown, setOpenToolbarDropdown] = useState<ToolbarDropdownMenu | null>(null);
  const [linkListScope, setLinkListScope] = useState<LinkListScope>('mine');
  const [linkListCanonicalHost, setLinkListCanonicalHost] = useState('');
  const [analyticsScope, setAnalyticsScope] = useState<AnalyticsScope>('mine');
  const [analyticsTimeWindow, setAnalyticsTimeWindow] = useState<LinkAnalyticsTimeWindow>(() =>
    getStoredAnalyticsTimeWindow(analyticsTimeWindowStorageKey, '30d')
  );
  const [selectedLinkAnalyticsTimeWindow, setSelectedLinkAnalyticsTimeWindow] =
    useState<LinkAnalyticsTimeWindow>(() =>
      getStoredAnalyticsTimeWindow(selectedLinkAnalyticsTimeWindowStorageKey, '24h')
    );
  const [newPasswordName, setNewPasswordName] = useState('');
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newInviteLabel, setNewInviteLabel] = useState('');
  const [newInviteGroupId, setNewInviteGroupId] = useState('');
  const [showCreateLinkPassword, setShowCreateLinkPassword] = useState(false);
  const [showNewPasswordValue, setShowNewPasswordValue] = useState(false);
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Set<string>>(() => new Set());
  const [userLinkVariables, setUserLinkVariables] = useState<EditableUserLinkVariable[]>([]);
  const [userLinkVariablesDefaultScheduleTimezone, setUserLinkVariablesDefaultScheduleTimezone] =
    useState('America/Chicago');
  const [newSubtrackerName, setNewSubtrackerName] = useState('');
  const [isLinkSearchExpanded, setIsLinkSearchExpanded] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<LinkSortOption>('updatedDesc');
  const [totalLinks, setTotalLinks] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const notificationTimeoutRef = useRef<number | null>(null);
  const emailSignInAddressInputRef = useRef<HTMLInputElement | null>(null);
  const emailSignInCodeInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedShortlinkTargetRef = useRef(new Map<string, string | null>());
  const actionMenuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const linkSearchInputRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusLinkSearchRef = useRef(false);
  const createLinkSectionTouchedRef = useRef(false);
  const createLinkSectionAutoSizedRef = useRef(false);
  const createLinkPrefillAppliedRef = useRef(false);
  const savedUserLinkVariablesRef = useRef<UserLinkVariableRecord[]>([]);
  const savedUserLinkVariablesSnapshotRef = useRef<string>('[]');
  const savedUserLinkVariablesDefaultScheduleTimezoneRef = useRef('America/Chicago');
  const savedPrivacyPolicyMarkdownRef = useRef('');
  const privacyPolicyMarkdownRef = useRef('');
  const savedSelectedLinkConfigRef = useRef<EditableLinkConfiguration | null>(null);
  const savedSelectedLinkAvailabilityModeRef = useRef<LinkAvailabilityMode>('enabled');
  const savedSelectedLinkConfigSnapshotRef = useRef<string | null>(null);
  const selectedLinkConfigDraftSnapshotRef = useRef<string | null>(null);
  const selectedRouteLinkIdRef = useRef<string | null>(selectedRouteLinkId);
  const returnTo = getSafeReturnTo(location.search);
  const inviteToken = getInviteToken(location.search);
  const effectiveInviteToken = inviteTokenStatus === 'invalid' ? null : inviteToken;
  const missingVariableRedirectKey = getMissingVariableRedirectKey(location.search);
  const createLinkPrefill = getCreateLinkPrefill(location.search);
  const createLinkHasDraft = hasCreateLinkDraft(form) || submitting;

  const creatableDomains = getCreatableDomains(domains, user);
  const linkListDomainOptions = user?.isSuperAdmin
    ? sortDomainRecordsByHost(domains)
    : creatableDomains;
  const showLinkListDomainFilter = linkListDomainOptions.length > 1;
  const linkListFilters: LinkListFilters = {
    searchQuery,
    canonicalHost: linkListCanonicalHost,
    sort: sortOption
  };
  const isLinkConfigPage = adminRoute.view === 'link-config';
  const isSetupPage = adminRoute.view === 'setup';
  const isVariablesPage = adminRoute.view === 'variables';
  const isAnalyticsPage = adminRoute.view === 'analytics';
  const isDomainsPage = adminRoute.view === 'domains';
  const isGroupsPage = adminRoute.view === 'groups';
  const isGroupDetailPage = adminRoute.view === 'group-detail';
  const isInvitesPage = adminRoute.view === 'invites';
  const isUsersPage = adminRoute.view === 'users';
  const isUserDetailPage = adminRoute.view === 'user-detail';
  const isUserVariablesPage = adminRoute.view === 'user-variables';
  const isAllLinksView = linkListScope === 'all';
  const isListedLinksView = linkListScope === 'listed';
  const isAllAnalyticsView = analyticsScope === 'all';
  const selectedLinkListScopeLabel = isAllLinksView
    ? 'All links'
    : isListedLinksView
      ? 'Listed links'
      : 'Your links';
  const selectedLinkListDomainLabel = linkListCanonicalHost || 'Domain';
  const isDefaultLinkListScope = linkListScope === 'mine';
  const isDefaultLinkListDomain = !linkListCanonicalHost;
  const selectedSortOption = getLinkSortOptionConfig(sortOption);
  const selectedSortDirection = getLinkSortDirection(sortOption);
  const isDefaultLinkListSort = sortOption === 'updatedDesc';
  const isDefaultLinkListPageSize = pageSize === pageSizeOptions[0];
  const userEmail = user?.email ?? null;
  const userIsSuperAdmin = user?.isSuperAdmin ?? false;
  const administeredDomainHostsDependencyKey = [...(user?.administeredDomainHosts ?? [])]
    .sort()
    .join('\n');
  const administeredDomainHostSet = new Set(user?.administeredDomainHosts ?? []);
  const canViewDomainsPage = Boolean(user && (user.isSuperAdmin || administeredDomainHostSet.size > 0));
  const canEditManagedDomain = (domain: ManagedDomainRecord) =>
    userIsSuperAdmin || (administeredDomainHostSet.has(domain.host) && !domain.isDefaultForNewAccounts);
  const adminNavItems = userIsSuperAdmin
    ? [
        {
          label: 'Links',
          to: '/',
          isActive: adminRoute.view === 'links' || isLinkConfigPage
        },
        {
          label: 'Analytics',
          to: '/analytics',
          isActive: isAnalyticsPage
        },
        {
          label: 'Domains',
          to: '/domains',
          isActive: isDomainsPage
        },
        {
          label: 'Users',
          to: '/users',
          isActive: isUsersPage || isUserDetailPage || isUserVariablesPage
        },
        {
          label: 'Groups',
          to: '/groups',
          isActive: isGroupsPage || isGroupDetailPage
        },
        {
          label: 'Invites',
          to: '/invites',
          isActive: isInvitesPage
        },
        {
          label: 'Variables',
          to: '/variables',
          isActive: isVariablesPage
        },
        {
          label: 'Setup',
          to: '/setup',
          isActive: isSetupPage
        }
      ]
    : [
        {
          label: 'Links',
          to: '/',
          isActive: adminRoute.view === 'links' || isLinkConfigPage
        },
        {
          label: 'Analytics',
          to: '/analytics',
          isActive: isAnalyticsPage
        },
        ...(canViewDomainsPage
          ? [
              {
                label: 'Domains',
                to: '/domains',
                isActive: isDomainsPage
              }
            ]
          : []),
        {
          label: 'Variables',
          to: '/variables',
          isActive: isVariablesPage
        }
      ];
  const linkConfigDomains = getEditableLinkDomains(
    domains,
    user,
    selectedLinkConfig?.canonical_host ?? null
  );
  const routedSelectedUser =
    selectedRouteUserId && selectedUser?.id === selectedRouteUserId ? selectedUser : null;
  const selectedLinkShortUrl = selectedLinkConfig
    ? getShortUrl(selectedLinkConfig.canonical_host, selectedLinkConfig.slug)
    : null;
  const selectedLinkHasPasswordProtection = selectedLinkConfig
    ? hasPasswordProtection(selectedLinkConfig)
    : false;
  const selectedLinkIsExpired = selectedLinkConfig
    ? isExpiredAt(selectedLinkConfig.expiresAt)
    : false;
  const selectedLinkExpirationCountdown =
    selectedLinkConfig?.expiresAt && !selectedLinkIsExpired
      ? formatExpirationCountdown(selectedLinkConfig.expiresAt, currentTimeMs)
      : null;
  const showUnavailableDestinationField =
    selectedLinkAvailabilityMode === 'disabled' || selectedLinkAvailabilityMode === 'expires';
  const hasAvailabilitySettings = hasConfiguredAvailabilitySettings(
    selectedLinkConfig,
    selectedLinkAvailabilityMode
  );
  const hasPasswordLinksConfigured = Boolean(selectedLinkConfig?.passwords.length);
  const hasScheduledOverrides = hasConfiguredScheduleEntries(selectedLinkConfig);
  const hasTrackedLinksConfigured = hasTrackedLinkSettings(selectedLinkConfig);
  const selectedLinkConfigDraftSnapshot = getLinkConfigurationDraftSnapshot(
    selectedLinkConfig,
    selectedLinkAvailabilityMode
  );
  const sortedSelectedLinkSubtrackers = selectedLinkConfig
    ? [...selectedLinkConfig.subtrackers].sort(compareRecordsByCreatedAtDesc)
    : [];
  const sortedSelectedLinkPasswords = selectedLinkConfig
    ? [...selectedLinkConfig.passwords].sort(compareRecordsByCreatedAtDesc)
    : [];
  const linkConfigValidationMessage =
    adminRoute.view === 'link-config'
      ? getLinkConfigurationValidationMessage(selectedLinkConfig, selectedLinkAvailabilityMode)
      : null;
  const scheduleTimeline = selectedLinkConfig
    ? selectedLinkConfig.scheduleMode === 'rotation'
      ? buildRotationTimeline(selectedLinkConfig)
      : buildScheduleTimeline(selectedLinkConfig)
    : [];
  const selectedLinkEffectiveScheduleTimezone = selectedLinkConfig
    ? selectedLinkConfig.scheduleMode === 'rotation'
      ? getLinkOwnerDefaultScheduleTimezone(selectedLinkConfig.created_by_email, user, users) ??
        selectedLinkConfig.scheduleTimezone
      : selectedLinkConfig.scheduleTimezone
    : null;
  const showScheduleTimezoneField = Boolean(
    selectedLinkConfig &&
      selectedLinkConfig.scheduleMode === 'windows' &&
      hasScheduledOverrides
  );
  const activeScheduleMinute =
    selectedLinkConfig && selectedLinkEffectiveScheduleTimezone
      ? getCurrentMinuteOfDay(selectedLinkEffectiveScheduleTimezone, currentTimeMs)
      : null;
  const hasUnsavedLinkConfigChanges =
    adminRoute.view === 'link-config' &&
    ((selectedLinkConfig !== null &&
      getLinkConfigurationSnapshot(selectedLinkConfig) !==
        savedSelectedLinkConfigSnapshotRef.current) ||
      selectedLinkAvailabilityMode !== savedSelectedLinkAvailabilityModeRef.current);
  const hasUnsavedDomainChanges =
    adminRoute.view === 'domains' &&
    managedDomains.some(
      (domain) =>
        normalizeDomainRootRedirectSlug(
          domainRootRedirectDrafts[domain.host] ?? domain.rootRedirectSlug
        ) !== normalizeDomainRootRedirectSlug(domain.rootRedirectSlug)
    );
  const userLinkVariablesValidationMessage = getUserLinkVariableValidationMessage(userLinkVariables);
  const hasUnsavedUserLinkVariableChanges =
    getUserLinkVariablesSnapshot(userLinkVariables) !== savedUserLinkVariablesSnapshotRef.current ||
    (adminRoute.view === 'variables' &&
      userLinkVariablesDefaultScheduleTimezone !==
        savedUserLinkVariablesDefaultScheduleTimezoneRef.current);
  const privacyPolicyValidationMessage =
    privacyPolicyMarkdown.trim().length === 0 ? 'Privacy policy markdown is required.' : null;
  const hasUnsavedPrivacyPolicyChanges =
    privacyPolicyMarkdown !== savedPrivacyPolicyMarkdownRef.current;
  const scheduleSettingsCount = selectedLinkConfig
    ? selectedLinkConfig.scheduleMode === 'rotation'
      ? selectedLinkConfig.rotationSchedule?.destinations.length ?? 0
      : selectedLinkConfig.schedules.length
    : 0;
  const passwordLinksCount = selectedLinkConfig?.passwords.length ?? 0;
  const trackedLinksCount = selectedLinkConfig?.subtrackers.length ?? 0;
  const collapsedScheduleSummary = hasScheduledOverrides
    ? selectedLinkConfig?.scheduleMode === 'rotation'
      ? `${scheduleSettingsCount} rotation destination${scheduleSettingsCount === 1 ? '' : 's'} configured`
      : `${scheduleSettingsCount} scheduled override${scheduleSettingsCount === 1 ? '' : 's'} configured`
    : 'No scheduled destinations configured';
  const collapsedTrackedLinksSummary = hasTrackedLinksConfigured
    ? `${trackedLinksCount} tagged link${trackedLinksCount === 1 ? '' : 's'}${selectedLinkConfig?.requires_tracking_id ? ' · tracking ID required' : ''}`
    : 'No tagged links configured';
  const collapsedPasswordsSummary = hasPasswordLinksConfigured
    ? `${passwordLinksCount} password${passwordLinksCount === 1 ? '' : 's'} configured`
    : 'No passwords configured';
  const collapsedAvailabilitySummary =
    selectedLinkAvailabilityMode === 'waiting-room'
      ? 'Waiting room active'
      : selectedLinkAvailabilityMode === 'disabled'
      ? hasAvailabilitySettings && selectedLinkConfig?.disabledDestinationUrl
        ? 'Disabled · unavailable redirect configured'
        : 'Disabled'
      : selectedLinkAvailabilityMode === 'expires'
        ? `${
            selectedLinkExpirationCountdown
              ? `Expires in ${selectedLinkExpirationCountdown}`
              : selectedLinkConfig?.expiresAt
                ? `Expires on ${formatDateTimeLocalValue(
                    selectedLinkConfig.expiresAt,
                    selectedLinkConfig.scheduleTimezone
                  ).replace('T', ' ')}`
                : 'Expires automatically'
          }${
            (selectedLinkConfig?.disabledDestinationUrl ?? '').trim().length > 0
              ? ' · unavailable redirect configured'
              : ''
          }`
        : (selectedLinkConfig?.disabledDestinationUrl ?? '').trim().length > 0
          ? 'Available · unavailable redirect configured'
          : 'No availability restrictions configured';
  const linkConfigAutoSaveStatus =
    !isLinkConfigPage || !selectedLinkConfig
      ? null
      : savingLinkConfig
        ? {
            tone: 'saving' as const,
            message: 'Saving changes...'
          }
        : linkConfigValidationMessage
          ? {
              tone: 'warning' as const,
              message: linkConfigValidationMessage
            }
          : linkConfigAutoSaveError
            ? {
                tone: 'error' as const,
                message: `Auto-save failed. ${linkConfigAutoSaveError}`
              }
            : hasUnsavedLinkConfigChanges
              ? {
                  tone: 'saving' as const,
                  message: 'Changes pending save...'
                }
              : {
                  tone: 'success' as const,
                  message: 'All changes saved.'
                };
  const groupMemberOptions = [...users].sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base'
    });
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.email.localeCompare(right.email, undefined, {
      sensitivity: 'base'
    });
  });
  selectedRouteLinkIdRef.current = selectedRouteLinkId;
  selectedLinkConfigDraftSnapshotRef.current = selectedLinkConfigDraftSnapshot;
  privacyPolicyMarkdownRef.current = privacyPolicyMarkdown;

  function applyBootstrapState(bootstrap: Awaited<ReturnType<typeof fetchBootstrap>>) {
    setDomains(sortDomainRecordsByHost(bootstrap.supportedDomains));
    setUser(bootstrap.user);
    setAppBuildId(bootstrap.appBuildId);
    setForm((current) => ({
      ...current,
      canonicalHost:
        current.canonicalHost ||
        bootstrap.canonicalHost ||
        bootstrap.supportedDomains[0]?.host ||
        ''
    }));
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [bootstrap, authConfig] = await Promise.all([fetchBootstrap(), fetchAuthConfig()]);
      applyBootstrapState(bootstrap);
      setGoogleClientId(authConfig.googleClientId ?? '');
      setEmailCodeEnabled(authConfig.emailCodeEnabled);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load app.');
    } finally {
      setLoading(false);
    }
  }

  function clearNotification() {
    if (notificationTimeoutRef.current !== null) {
      window.clearTimeout(notificationTimeoutRef.current);
      notificationTimeoutRef.current = null;
    }

    setNotification(null);
  }

  function showNotification(tone: NotificationTone, message: string, duration?: number) {
    if (notificationTimeoutRef.current !== null) {
      window.clearTimeout(notificationTimeoutRef.current);
    }

    const nextNotification = { tone, message };
    const timeoutMs = duration ?? (tone === 'error' ? 6500 : tone === 'warning' ? 5500 : 4500);
    setNotification(nextNotification);
    notificationTimeoutRef.current = window.setTimeout(() => {
      setNotification((current) =>
        current?.message === message && current.tone === tone ? null : current
      );
      notificationTimeoutRef.current = null;
    }, timeoutMs);
  }

  function removeInviteTokenFromUrl() {
    if (!inviteToken) {
      return;
    }

    navigate(
      {
        pathname: location.pathname,
        search: getSearchWithoutParam(location.search, 'invite'),
        hash: location.hash
      },
      { replace: true }
    );
  }

  function shouldMarkInviteTokenInvalid(error: unknown) {
    return (
      error instanceof Error &&
      error.message === 'This invite link is invalid or has already been used.'
    );
  }

  async function requestGeneratedSlug(canonicalHost: string, linkId?: string) {
    if (!canonicalHost) {
      throw new Error('Select a host before generating a slug.');
    }

    const response = await generateUnusedSlug(canonicalHost, linkId);
    return response.slug;
  }

  function applyUserLinkVariablesState(variables: UserLinkVariableRecord[]) {
    setUserLinkVariables(createEditableUserLinkVariables(variables));
    savedUserLinkVariablesRef.current = variables.map((variable) => ({ ...variable }));
    savedUserLinkVariablesSnapshotRef.current = getUserLinkVariablesSnapshot(
      createEditableUserLinkVariables(variables)
    );
  }

  function applyCurrentUserLinkVariablesState(
    variables: UserLinkVariableRecord[],
    defaultScheduleTimezone: string
  ) {
    applyUserLinkVariablesState(variables);
    setUserLinkVariablesDefaultScheduleTimezone(defaultScheduleTimezone);
    savedUserLinkVariablesDefaultScheduleTimezoneRef.current = defaultScheduleTimezone;
  }

  function applyPrivacyPolicyDocumentState(document: PrivacyPolicyDocumentRecord) {
    setPrivacyPolicyDocument(document);
    setPrivacyPolicyMarkdown(document.markdown);
    setPrivacyPolicyLoadError(null);
    savedPrivacyPolicyMarkdownRef.current = document.markdown;
  }

  function clearPrivacyPolicyDocumentState() {
    setPrivacyPolicyDocument(null);
    setPrivacyPolicyMarkdown('');
    setPrivacyPolicyLoadError(null);
    savedPrivacyPolicyMarkdownRef.current = '';
  }

  function clearUserLinkVariablesState() {
    setUserLinkVariables([]);
    savedUserLinkVariablesRef.current = [];
    savedUserLinkVariablesSnapshotRef.current = '[]';
    const fallbackDefaultScheduleTimezone = user?.defaultScheduleTimezone ?? 'America/Chicago';
    setUserLinkVariablesDefaultScheduleTimezone(fallbackDefaultScheduleTimezone);
    savedUserLinkVariablesDefaultScheduleTimezoneRef.current = fallbackDefaultScheduleTimezone;
  }

  function setActionMenuButtonRef(linkId: string, element: HTMLButtonElement | null) {
    if (element) {
      actionMenuButtonRefs.current.set(linkId, element);
      return;
    }

    actionMenuButtonRefs.current.delete(linkId);
  }

  function updateOpenActionMenuPosition(linkId: string) {
    const button = actionMenuButtonRefs.current.get(linkId);
    if (!button) {
      setOpenActionMenuPosition(null);
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportPadding = 12;
    const menuGap = 8;
    const estimatedMenuHeight = 152;
    const right = Math.max(viewportPadding, window.innerWidth - rect.right);
    const canOpenUpward = rect.top - estimatedMenuHeight - menuGap >= viewportPadding;
    const shouldOpenUpward =
      rect.bottom + estimatedMenuHeight + menuGap > window.innerHeight - viewportPadding &&
      canOpenUpward;

    if (shouldOpenUpward) {
      setOpenActionMenuPosition({
        bottom: window.innerHeight - rect.top + menuGap,
        right
      });
      return;
    }

    setOpenActionMenuPosition({
      top: Math.max(
        viewportPadding,
        Math.min(rect.bottom + menuGap, window.innerHeight - estimatedMenuHeight - viewportPadding)
      ),
      right
    });
  }

  async function loadLinksPage(
    page: number,
    pageSizeValue: PageSize,
    scope: LinkListScope,
    filters: LinkListFilters
  ) {
    setLinksLoading(true);
    setError(null);

    try {
      const linkPage = await fetchLinks(page, pageSizeValue, scope, filters);
      setLinks(linkPage.links);
      setCurrentPage(linkPage.page);
      setPageSize(linkPage.pageSize as PageSize);
      if (scope === 'mine') {
        setMineLinkCount(linkPage.totalLinks);
      }
      setTotalLinks(linkPage.totalLinks);
      setTotalPages(linkPage.totalPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load links.');
    } finally {
      setLinksLoading(false);
    }
  }

  async function loadUserLinkVariables() {
    setUserLinkVariablesLoading(true);
    setError(null);
    clearUserLinkVariablesState();

    try {
      const response = await fetchUserLinkVariables();
      applyCurrentUserLinkVariablesState(response.variables, response.defaultScheduleTimezone);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load link variables.');
      clearUserLinkVariablesState();
    } finally {
      setUserLinkVariablesLoading(false);
    }
  }

  async function loadUserLinkVariablesForUser(userId: string) {
    setUserLinkVariablesLoading(true);
    setError(null);
    clearUserLinkVariablesState();

    try {
      const response = await fetchUserLinkVariablesForUser(userId);
      applyUserLinkVariablesState(response.variables);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load link variables.');
      clearUserLinkVariablesState();
    } finally {
      setUserLinkVariablesLoading(false);
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    setError(null);

    try {
      const response = await fetchUsers();
      setUsers(response.users);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadGroups() {
    setGroupsLoading(true);
    setError(null);

    try {
      const response = await fetchGroups();
      setGroups(response.groups);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load groups.');
    } finally {
      setGroupsLoading(false);
    }
  }

  async function loadInvites() {
    setInvitesLoading(true);
    setError(null);

    try {
      const response = await fetchInvites();
      setInvites(response.invites);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load invites.');
    } finally {
      setInvitesLoading(false);
    }
  }

  async function loadAnalytics(scope: AnalyticsScope, timeWindow: LinkAnalyticsTimeWindow) {
    setAnalyticsLoading(true);
    setError(null);

    try {
      const response = await fetchAnalytics(scope, timeWindow);
      setAnalytics(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load analytics.');
    } finally {
      setAnalyticsLoading(false);
    }
  }

  function applyManagedDomainsState(nextManagedDomains: ManagedDomainRecord[]) {
    const sortedManagedDomains = sortDomainRecordsByHost(nextManagedDomains);
    setManagedDomains(sortedManagedDomains);
    setDomainRootRedirectDrafts(getDomainRootRedirectDrafts(sortedManagedDomains));
  }

  async function loadManagedDomains() {
    setDomainsLoading(true);
    setError(null);

    try {
      const response = await fetchDomains();
      applyManagedDomainsState(response.domains);
      setDomains(sortDomainRecordsByHost(response.supportedDomains));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load domains.');
    } finally {
      setDomainsLoading(false);
    }
  }

  async function loadSetupChecklist() {
    setSetupChecklistLoading(true);
    setError(null);

    try {
      const response = await fetchSetupChecklist();
      setSetupChecklist(response);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Unable to load the setup checklist.'
      );
      setSetupChecklist(null);
    } finally {
      setSetupChecklistLoading(false);
    }
  }

  async function loadPrivacyPolicyDocument() {
    setPrivacyPolicyLoading(true);
    setPrivacyPolicyLoadError(null);

    try {
      const response = await fetchPrivacyPolicyDocument();
      if (privacyPolicyMarkdownRef.current !== savedPrivacyPolicyMarkdownRef.current) {
        return;
      }

      applyPrivacyPolicyDocumentState(response.document);
    } catch (loadError) {
      if (privacyPolicyMarkdownRef.current !== savedPrivacyPolicyMarkdownRef.current) {
        setPrivacyPolicyLoadError(
          loadError instanceof Error ? loadError.message : 'Unable to load the privacy policy.'
        );
        return;
      }

      setPrivacyPolicyDocument(null);
      setPrivacyPolicyMarkdown('');
      savedPrivacyPolicyMarkdownRef.current = '';
      setPrivacyPolicyLoadError(
        loadError instanceof Error ? loadError.message : 'Unable to load the privacy policy.'
      );
    } finally {
      setPrivacyPolicyLoading(false);
    }
  }

  async function loadSelectedUser(userId: string) {
    setSelectedUserLoading(true);
    setError(null);

    try {
      const response = await fetchUser(userId);
      setSelectedUser(response.user);
      setSelectedUserAllowedHosts(response.user.directAllowedCanonicalHosts);
      setSelectedUserDefaultScheduleTimezone(response.user.default_schedule_timezone);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load user.');
      setSelectedUser(null);
      setSelectedUserAllowedHosts([]);
      setSelectedUserDefaultScheduleTimezone('America/Chicago');
    } finally {
      setSelectedUserLoading(false);
    }
  }

  async function loadSelectedGroup(groupId: string) {
    setSelectedGroupLoading(true);
    setError(null);

    try {
      const response = await fetchGroup(groupId);
      setSelectedGroup(response.group);
      setSelectedGroupName(response.group.name);
      setSelectedGroupMemberUserIds(response.group.member_user_ids);
      setSelectedGroupAllowedHosts(response.group.allowed_canonical_hosts);
      setSelectedGroupDomainAdministrationHosts(response.group.domain_administration_hosts);
      setSelectedGroupAutoMemberEmailDomainsText(
        response.group.auto_member_email_domains.join('\n')
      );
      setGroups((current) => {
        const nextGroups = current.some((group) => group.id === response.group.id)
          ? current.map((group) => (group.id === response.group.id ? response.group : group))
          : [...current, response.group];

        return nextGroups.sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        );
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load group.');
      setSelectedGroup(null);
      setSelectedGroupName('');
      setSelectedGroupMemberUserIds([]);
      setSelectedGroupAllowedHosts([]);
      setSelectedGroupDomainAdministrationHosts([]);
      setSelectedGroupAutoMemberEmailDomainsText('');
    } finally {
      setSelectedGroupLoading(false);
    }
  }

  async function loadSelectedLinkConfig(linkId: string) {
    setSelectedLinkConfigLoading(true);
    setError(null);
    setLinkConfigAutoSaveError(null);
    setLinkConfigAutoSaveFailedSnapshot(null);
    setNewPasswordName('');
    setNewPasswordValue('');
    setShowNewPasswordValue(false);
    setVisiblePasswordIds(new Set());
    setNewSubtrackerName('');
    setCopiedPasswordId(null);
    setCopiedTrackedSubtrackerId(null);
    setEditingPasswordId(null);
    setEditingSubtrackerId(null);

    try {
      const response = await fetchLinkConfiguration(linkId);
      const nextConfig = cloneEditableLinkConfiguration(response.link);
      const nextHasScheduledOverrides = hasConfiguredScheduleEntries(nextConfig);
      const nextAvailabilityMode = getLinkAvailabilityMode(nextConfig);
      setIsDescriptionEditorVisible((nextConfig.description ?? '').trim().length > 0);
      setScheduleViewMode(nextHasScheduledOverrides ? 'visual' : 'edit');
      setIsAvailabilitySectionExpanded(
        hasConfiguredAvailabilitySettings(nextConfig, nextAvailabilityMode)
      );
      setIsPasswordLinksSectionExpanded(nextConfig.passwords.length > 0);
      setIsScheduleSectionExpanded(nextHasScheduledOverrides);
      setIsTrackedLinksSectionExpanded(hasTrackedLinkSettings(nextConfig));
      setSelectedLinkConfig(nextConfig);
      setSelectedLinkAvailabilityMode(nextAvailabilityMode);
      savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextConfig);
      savedSelectedLinkAvailabilityModeRef.current = nextAvailabilityMode;
      savedSelectedLinkConfigSnapshotRef.current = getLinkConfigurationSnapshot(nextConfig);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load link configuration.');
      setSelectedLinkConfig(null);
      setSelectedLinkAvailabilityMode('enabled');
      setIsDescriptionEditorVisible(false);
      setIsAvailabilitySectionExpanded(false);
      setIsPasswordLinksSectionExpanded(false);
      setIsScheduleSectionExpanded(false);
      setIsTrackedLinksSectionExpanded(false);
      setLinkConfigAutoSaveError(null);
      setLinkConfigAutoSaveFailedSnapshot(null);
      setEditingPasswordId(null);
      setEditingSubtrackerId(null);
      savedSelectedLinkConfigRef.current = null;
      savedSelectedLinkAvailabilityModeRef.current = 'enabled';
      savedSelectedLinkConfigSnapshotRef.current = null;
    } finally {
      setSelectedLinkConfigLoading(false);
    }
  }

  async function loadSelectedLinkAnalytics(linkId: string, timeWindow: LinkAnalyticsTimeWindow) {
    setSelectedLinkAnalyticsLoading(true);
    setSelectedLinkAnalyticsError(null);
    setSelectedLinkAnalytics(null);

    try {
      const response = await fetchLinkAnalytics(linkId, timeWindow);
      setSelectedLinkAnalytics(response.analytics);
    } catch (loadError) {
      setSelectedLinkAnalyticsError(
        loadError instanceof Error ? loadError.message : 'Unable to load link analytics.'
      );
      setSelectedLinkAnalytics(null);
    } finally {
      setSelectedLinkAnalyticsLoading(false);
    }
  }

  useEffect(() => {
    document.title = appTitle;
  }, []);

  useEffect(() => {
    storeAnalyticsTimeWindow(analyticsTimeWindowStorageKey, analyticsTimeWindow);
  }, [analyticsTimeWindow]);

  useEffect(() => {
    storeAnalyticsTimeWindow(
      selectedLinkAnalyticsTimeWindowStorageKey,
      selectedLinkAnalyticsTimeWindow
    );
  }, [selectedLinkAnalyticsTimeWindow]);

  const shouldWarnAboutUnsavedChanges =
    hasUnsavedLinkConfigChanges || hasUnsavedDomainChanges || hasUnsavedPrivacyPolicyChanges;

  useBeforeUnload((event) => {
    if (!shouldWarnAboutUnsavedChanges) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  });

  unstable_usePrompt({
    when: ({ currentLocation, nextLocation }) =>
      shouldWarnAboutUnsavedChanges &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
    message: "You have changes that haven't been saved yet. Leave this page anyway?"
  });

  useEffect(() => {
    setLinkConfigAutoSaveError((current) => (current ? null : current));
    setLinkConfigAutoSaveFailedSnapshot((current) =>
      current && current !== selectedLinkConfigDraftSnapshot ? null : current
    );
  }, [selectedLinkConfigDraftSnapshot, selectedRouteLinkId]);

  useEffect(() => {
    if (adminRoute.view === 'link-config') {
      return;
    }

    setLinkConfigAutoSaveError(null);
    setLinkConfigAutoSaveFailedSnapshot(null);
  }, [adminRoute.view]);

  useEffect(() => {
    setOpenToolbarDropdown(null);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!inviteToken || user) {
      setInviteTokenStatus('idle');
      return;
    }

    let cancelled = false;
    setInviteTokenStatus('checking');

    void fetchInviteStatus(inviteToken)
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.isAvailable) {
          setInviteTokenStatus('valid');
          return;
        }

        setInviteTokenStatus('invalid');
      })
      .catch(() => {
        if (!cancelled) {
          setInviteTokenStatus('idle');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inviteToken, user]);

  useEffect(() => () => {
    if (notificationTimeoutRef.current !== null) {
      window.clearTimeout(notificationTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!openActionMenuLinkId) {
      setOpenActionMenuPosition(null);
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        setOpenActionMenuLinkId(null);
        return;
      }

      if (target.closest('.table-action-menu, .table-action-dropdown')) {
        return;
      }

      setOpenActionMenuLinkId(null);
    }

    const updatePosition = () => updateOpenActionMenuPosition(openActionMenuLinkId);
    updatePosition();

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openActionMenuLinkId]);

  useEffect(() => {
    if (!openToolbarDropdown) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('.toolbar-dropdown-control')) {
        return;
      }

      setOpenToolbarDropdown(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenToolbarDropdown(null);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openToolbarDropdown]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!user || returnTo) {
      return;
    }

    if (adminRoute.view === 'setup') {
      if (user.isSuperAdmin) {
        void loadSetupChecklist();
        void loadPrivacyPolicyDocument();
      }
      return;
    }

    if (adminRoute.view === 'domains') {
      if (user.isSuperAdmin || user.administeredDomainHosts.length > 0) {
        void loadManagedDomains();
      }
      return;
    }

    if (adminRoute.view === 'groups') {
      if (user.isSuperAdmin) {
        void loadGroups();
      }
      return;
    }

    if (adminRoute.view === 'invites') {
      if (user.isSuperAdmin) {
        void loadInvites();
        void loadGroups();
      }
      return;
    }

    if (adminRoute.view === 'users') {
      if (user.isSuperAdmin) {
        void loadUsers();
      }
      return;
    }

    if (adminRoute.view === 'user-detail') {
      if (user.isSuperAdmin) {
        void loadSelectedUser(selectedRouteUserId!);
      }
      return;
    }

    if (adminRoute.view === 'user-variables') {
      if (user.isSuperAdmin) {
        void loadSelectedUser(selectedRouteUserId!);
        void loadUserLinkVariablesForUser(selectedRouteUserId!);
      }
      return;
    }

    if (adminRoute.view === 'group-detail') {
      if (user.isSuperAdmin) {
        void loadSelectedGroup(selectedRouteGroupId!);
        void loadUsers();
        void loadManagedDomains();
      }
      return;
    }

    if (adminRoute.view === 'variables') {
      void loadUserLinkVariables();
      return;
    }

    if (adminRoute.view === 'link-config') {
      void loadSelectedLinkConfig(selectedRouteLinkId!);
      return;
    }

    if (adminRoute.view === 'analytics') {
      void loadAnalytics(analyticsScope, analyticsTimeWindow);
      return;
    }

    void loadLinksPage(currentPage, pageSize, linkListScope, linkListFilters);
  }, [
    adminRoute.view,
    currentPage,
    analyticsTimeWindow,
    analyticsScope,
    linkListScope,
    linkListCanonicalHost,
    pageSize,
    returnTo,
    searchQuery,
    selectedRouteGroupId,
    selectedRouteLinkId,
    selectedRouteUserId,
    sortOption,
    userEmail,
    userIsSuperAdmin,
    administeredDomainHostsDependencyKey
  ]);

  useEffect(() => {
    if (!user || returnTo || adminRoute.view !== 'variables' || !missingVariableRedirectKey) {
      return;
    }

    showNotification(
      'warning',
      `Add a value for "${missingVariableRedirectKey}" to continue with that link.`
    );

    const params = new URLSearchParams(location.search);
    params.delete('missingVariable');
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : ''
      },
      { replace: true }
    );
  }, [
    adminRoute.view,
    location.pathname,
    location.search,
    missingVariableRedirectKey,
    navigate,
    returnTo,
    user
  ]);

  useEffect(() => {
    if (!user || returnTo) {
      return;
    }

    if (adminRoute.view !== 'link-config' || !selectedRouteLinkId) {
      setSelectedLinkAnalytics(null);
      setSelectedLinkAnalyticsError(null);
      setSelectedLinkAnalyticsLoading(false);
      return;
    }

    void loadSelectedLinkAnalytics(selectedRouteLinkId, selectedLinkAnalyticsTimeWindow);
  }, [adminRoute.view, returnTo, selectedLinkAnalyticsTimeWindow, selectedRouteLinkId, user]);

  useEffect(() => {
    if (
      !isLinkConfigPage ||
      !selectedRouteLinkId ||
      !selectedLinkConfig ||
      !selectedLinkConfigDraftSnapshot ||
      selectedLinkConfigLoading ||
      savingLinkConfig ||
      !hasUnsavedLinkConfigChanges ||
      Boolean(linkConfigValidationMessage) ||
      linkConfigAutoSaveFailedSnapshot === selectedLinkConfigDraftSnapshot
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistLinkConfigurationDraft({
        linkId: selectedRouteLinkId,
        config: selectedLinkConfig,
        availabilityMode: selectedLinkAvailabilityMode,
        draftSnapshot: selectedLinkConfigDraftSnapshot
      });
    }, linkConfigAutoSaveDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    hasUnsavedLinkConfigChanges,
    isLinkConfigPage,
    linkConfigAutoSaveFailedSnapshot,
    linkConfigValidationMessage,
    savingLinkConfig,
    selectedLinkAvailabilityMode,
    selectedLinkConfig,
    selectedLinkConfigDraftSnapshot,
    selectedLinkConfigLoading,
    selectedRouteLinkId
  ]);

  useEffect(() => {
    if (!user?.isSuperAdmin && analyticsScope === 'all') {
      setAnalyticsScope('mine');
    }
  }, [analyticsScope, user]);

  useEffect(() => {
    if (!user?.isSuperAdmin && linkListScope === 'all') {
      setLinkListScope('mine');
    }
  }, [linkListScope, user]);

  useEffect(() => {
    if (!linkListCanonicalHost) {
      return;
    }

    if (!showLinkListDomainFilter) {
      setLinkListCanonicalHost('');
      return;
    }

    if (linkListDomainOptions.some((domain) => domain.host === linkListCanonicalHost)) {
      return;
    }

    setLinkListCanonicalHost('');
  }, [linkListCanonicalHost, linkListDomainOptions, showLinkListDomainFilter]);

  useEffect(() => {
    const shouldTickClock =
      adminRoute.view === 'link-config' &&
      Boolean(
        (selectedLinkConfig?.expiresAt && !selectedLinkIsExpired) ||
          selectedLinkConfig?.schedules.length ||
          selectedLinkConfig?.rotationSchedule?.destinations.length
      );

    if (!shouldTickClock) {
      return;
    }

    setCurrentTimeMs(Date.now());
    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    adminRoute.view,
    selectedLinkConfig?.expiresAt,
    selectedLinkConfig?.rotationSchedule?.destinations.length,
    selectedLinkConfig?.schedules.length,
    selectedLinkIsExpired
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  useEffect(() => {
    if (!searchInput && !searchQuery) {
      return;
    }

    setIsLinkSearchExpanded(true);
  }, [searchInput, searchQuery]);

  useEffect(() => {
    if (!isLinkSearchExpanded || !shouldFocusLinkSearchRef.current) {
      return;
    }

    linkSearchInputRef.current?.focus();
    shouldFocusLinkSearchRef.current = false;
  }, [isLinkSearchExpanded]);

  useEffect(() => {
    if (!user) {
      return;
    }

    if (creatableDomains.length === 0) {
      if (form.canonicalHost) {
        setForm((current) => ({ ...current, canonicalHost: '' }));
      }
      return;
    }

    const hasCurrentSelection = creatableDomains.some((domain) => domain.host === form.canonicalHost);
    if (!hasCurrentSelection) {
      setForm((current) => ({
        ...current,
        canonicalHost: creatableDomains[0]?.host ?? ''
      }));
    }
  }, [creatableDomains, form.canonicalHost, user]);

  useEffect(() => {
    if (adminRoute.view !== 'links') {
      createLinkSectionTouchedRef.current = false;
      createLinkSectionAutoSizedRef.current = false;
      return;
    }

    if (Boolean(createLinkPrefill) || createLinkHasDraft) {
      setIsCreateLinkSectionExpanded(true);
      return;
    }

    if (
      createLinkSectionTouchedRef.current ||
      createLinkSectionAutoSizedRef.current ||
      mineLinkCount === null
    ) {
      return;
    }

    createLinkSectionAutoSizedRef.current = true;
    setIsCreateLinkSectionExpanded(mineLinkCount < 8);
  }, [adminRoute.view, createLinkHasDraft, createLinkPrefill, mineLinkCount]);

  useEffect(() => {
    if (
      loading ||
      createLinkPrefillAppliedRef.current ||
      adminRoute.view !== 'links' ||
      !createLinkPrefill
    ) {
      return;
    }

    createLinkPrefillAppliedRef.current = true;

    const nextCanonicalHost =
      (createLinkPrefill.canonicalHost &&
      creatableDomains.some((domain) => domain.host === createLinkPrefill.canonicalHost)
        ? createLinkPrefill.canonicalHost
        : creatableDomains[0]?.host) ?? '';

    setForm({
      ...emptyForm,
      canonicalHost: nextCanonicalHost,
      slug: createLinkPrefill.slug
    });
    setIsCreateLinkSectionExpanded(true);

    const params = new URLSearchParams(window.location.search);
    params.delete('prefillCanonicalHost');
    params.delete('prefillSlug');

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [adminRoute.view, createLinkPrefill, creatableDomains, loading]);

  useEffect(() => {
    if (!appBuildId) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const version = await fetchVersion();
        if (version.appBuildId !== appBuildId) {
          if (
            hasUnsavedLinkConfigChanges ||
            hasUnsavedDomainChanges ||
            hasUnsavedPrivacyPolicyChanges
          ) {
            return;
          }

          window.location.reload();
          return;
        }

        const bootstrap = await fetchBootstrap();
        applyBootstrapState(bootstrap);
      } catch {
        // Ignore transient version-check failures and try again later.
      }
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    appBuildId,
    hasUnsavedDomainChanges,
    hasUnsavedLinkConfigChanges,
    hasUnsavedPrivacyPolicyChanges
  ]);

  useEffect(() => {
    if (!showEmailSignInForm) {
      return;
    }

    const targetInput = emailCodeRequested
      ? emailSignInCodeInputRef.current
      : emailSignInAddressInputRef.current;
    targetInput?.focus();
  }, [emailCodeRequested, showEmailSignInForm]);

  async function handleGoogleCredential(credential: string) {
    clearNotification();

    try {
      const response = await loginWithGoogle(credential, effectiveInviteToken);
      setUser(response.user);

      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }

      if (inviteToken) {
        removeInviteTokenFromUrl();
      }
    } catch (loginError) {
      if (shouldMarkInviteTokenInvalid(loginError)) {
        setInviteTokenStatus('invalid');
      }
      showNotification('error', loginError instanceof Error ? loginError.message : 'Login failed.');
    }
  }

  async function handleRequestEmailCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setShowEmailSignInForm(true);

    const normalizedEmail = normalizeEmailSignInAddress(emailSignInAddress);
    if (!normalizedEmail) {
      showNotification('error', 'Enter your email address.');
      return;
    }

    setRequestingEmailCode(true);
    clearNotification();

    try {
      const response = await requestEmailSignInCode(normalizedEmail, effectiveInviteToken);
      setEmailSignInAddress(response.email);
      setEmailCodeRequested(true);
      setEmailSignInCode('');
      setEmailCodeExpiresInMinutes(response.expiresInMinutes);
      showNotification(
        'success',
        `Code sent to ${response.email}. It expires in ${response.expiresInMinutes} minutes.`
      );
    } catch (requestError) {
      if (shouldMarkInviteTokenInvalid(requestError)) {
        setInviteTokenStatus('invalid');
      }
      showNotification(
        'error',
        requestError instanceof Error ? requestError.message : 'Unable to send a sign-in code.'
      );
    } finally {
      setRequestingEmailCode(false);
    }
  }

  function handleEmailSignInAddressChange(value: string) {
    const normalizedCurrentEmail = normalizeEmailSignInAddress(emailSignInAddress);
    const normalizedNextEmail = normalizeEmailSignInAddress(value);

    setEmailSignInAddress(value);

    if (emailCodeRequested && normalizedCurrentEmail !== normalizedNextEmail) {
      setEmailCodeRequested(false);
      setEmailSignInCode('');
      setEmailCodeExpiresInMinutes(null);
    }
  }

  async function handleVerifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = normalizeEmailSignInAddress(emailSignInAddress);
    const normalizedCode = normalizeEmailSignInCode(emailSignInCode);

    if (!normalizedEmail) {
      showNotification('error', 'Enter your email address.');
      return;
    }

    if (!normalizedCode) {
      showNotification('error', 'Enter the 6-digit code from your email.');
      return;
    }

    setVerifyingEmailCode(true);
    clearNotification();

    try {
      const response = await loginWithEmailCode(
        normalizedEmail,
        normalizedCode,
        effectiveInviteToken
      );
      setUser(response.user);
      setShowEmailSignInForm(false);
      setEmailCodeRequested(false);
      setEmailSignInCode('');
      setEmailCodeExpiresInMinutes(null);

      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }

      if (inviteToken) {
        removeInviteTokenFromUrl();
      }
    } catch (loginError) {
      if (shouldMarkInviteTokenInvalid(loginError)) {
        setInviteTokenStatus('invalid');
      }
      showNotification(
        'error',
        loginError instanceof Error ? loginError.message : 'Unable to sign in with email.'
      );
    } finally {
      setVerifyingEmailCode(false);
    }
  }

  function handleOpenEmailSignIn() {
    setShowEmailSignInForm(true);
    clearNotification();
  }

  function handleCancelEmailSignIn() {
    setShowEmailSignInForm(false);
    setEmailSignInAddress('');
    setEmailSignInCode('');
    setEmailCodeRequested(false);
    setEmailCodeExpiresInMinutes(null);
    clearNotification();
  }

  function handleAddUserLinkVariable() {
    setUserLinkVariables((current) => [...current, createEmptyUserLinkVariable()]);
  }

  function handleChangeUserLinkVariable(
    variableId: number | string,
    field: 'key' | 'value',
    value: string
  ) {
    setUserLinkVariables((current) =>
      current.map((variable) =>
        variable.id === variableId
          ? {
              ...variable,
              [field]: value
            }
          : variable
      )
    );
  }

  function handleRemoveUserLinkVariable(variableId: number | string) {
    setUserLinkVariables((current) => current.filter((variable) => variable.id !== variableId));
  }

  function handleResetUserLinkVariables() {
    applyUserLinkVariablesState(savedUserLinkVariablesRef.current);
    setUserLinkVariablesDefaultScheduleTimezone(
      savedUserLinkVariablesDefaultScheduleTimezoneRef.current
    );
  }

  function handleResetPrivacyPolicy() {
    setPrivacyPolicyMarkdown(savedPrivacyPolicyMarkdownRef.current);
  }

  async function handleSaveUserLinkVariables() {
    if (userLinkVariablesValidationMessage) {
      showNotification('error', userLinkVariablesValidationMessage);
      return;
    }

    setSavingUserLinkVariables(true);
    clearNotification();

    try {
      const nextVariables = userLinkVariables
        .map((variable) => ({
          key: variable.key.trim(),
          value: variable.value.trim()
        }))
        .filter((variable) => variable.key.length > 0 || variable.value.length > 0);
      if (adminRoute.view === 'user-variables' && selectedRouteUserId) {
        const response = await updateUserLinkVariablesForUser(selectedRouteUserId, nextVariables);
        applyUserLinkVariablesState(response.variables);
        showNotification('success', 'User destination variables updated.');
        return;
      }

      const response = await updateUserLinkVariables({
        variables: nextVariables,
        defaultScheduleTimezone: userLinkVariablesDefaultScheduleTimezone
      });

      applyCurrentUserLinkVariablesState(response.variables, response.defaultScheduleTimezone);
      setUser((current) =>
        current
          ? {
              ...current,
              defaultScheduleTimezone: response.defaultScheduleTimezone
            }
          : current
      );
      setUsers((current) =>
        user
          ? current.map((account) =>
              account.email.toLowerCase() === user.email.toLowerCase()
                ? {
                    ...account,
                    default_schedule_timezone: response.defaultScheduleTimezone
                  }
                : account
            )
          : current
      );
      showNotification('success', 'Your destination settings updated.');
    } catch (saveError) {
      showNotification(
        'error',
        saveError instanceof Error ? saveError.message : 'Unable to update link variables.'
      );
    } finally {
      setSavingUserLinkVariables(false);
    }
  }

  async function handleSavePrivacyPolicy() {
    if (privacyPolicyValidationMessage) {
      showNotification('error', privacyPolicyValidationMessage);
      return;
    }

    setSavingPrivacyPolicy(true);
    clearNotification();

    try {
      const response = await updatePrivacyPolicyDocument(privacyPolicyMarkdown);
      applyPrivacyPolicyDocumentState(response.document);
      showNotification('success', 'Privacy policy updated.');
    } catch (saveError) {
      showNotification(
        'error',
        saveError instanceof Error ? saveError.message : 'Unable to update the privacy policy.'
      );
    } finally {
      setSavingPrivacyPolicy(false);
    }
  }

  async function handleGenerateCreateSlug() {
    setGeneratingCreateSlug(true);

    try {
      const slug = await requestGeneratedSlug(form.canonicalHost);
      setForm((current) => ({ ...current, slug }));
    } catch (generateError) {
      showNotification(
        'error',
        generateError instanceof Error
          ? generateError.message
          : 'Unable to generate an unused slug.'
      );
    } finally {
      setGeneratingCreateSlug(false);
    }
  }

  async function handleGenerateSelectedLinkConfigSlug() {
    if (!selectedLinkConfig) {
      showNotification('error', 'Link configuration is still loading.');
      return;
    }

    setGeneratingLinkConfigSlug(true);

    try {
      const slug = await requestGeneratedSlug(
        selectedLinkConfig.canonical_host,
        selectedLinkConfig.id
      );
      setSelectedLinkConfig((current) => (current ? { ...current, slug } : current));
    } catch (generateError) {
      showNotification(
        'error',
        generateError instanceof Error
          ? generateError.message
          : 'Unable to generate an unused slug.'
      );
    } finally {
      setGeneratingLinkConfigSlug(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    clearNotification();

    try {
      const response = await createLink({
        slug: form.slug,
        canonicalHost: form.canonicalHost,
        destinationUrl: form.destinationUrl,
        description: form.description,
        internalOnly: form.internalOnly,
        password: form.password.length > 0 ? form.password : undefined
      });

      setForm((current) => ({
        ...emptyForm,
        canonicalHost: current.canonicalHost
      }));
      setShowCreateLinkPassword(false);
      createLinkSectionTouchedRef.current = true;
      setIsCreateLinkSectionExpanded(false);

      if (currentPage !== 1) {
        setCurrentPage(1);
      } else {
        await loadLinksPage(1, pageSize, linkListScope, linkListFilters);
      }

      const shortUrl = getShortUrl(response.link.canonical_host, response.link.slug);

      try {
        await navigator.clipboard.writeText(shortUrl);
        showNotification(
          'success',
          form.password.length > 0
            ? `Copied ${shortUrl} to your clipboard. Visitors will be prompted for the password.`
            : `Copied ${shortUrl} to your clipboard.`
        );
      } catch {
        showNotification('error', `Link created, but unable to copy ${shortUrl}.`);
      }
    } catch (submitError) {
      showNotification(
        'error',
        submitError instanceof Error ? submitError.message : 'Unable to create link.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setShowEmailSignInForm(false);
    setEmailSignInAddress('');
    setEmailSignInCode('');
    setEmailCodeRequested(false);
    setEmailCodeExpiresInMinutes(null);
    setLinks([]);
    setManagedDomains([]);
    setDomainRootRedirectDrafts({});
    setSetupChecklist(null);
    setSetupChecklistLoading(false);
    clearPrivacyPolicyDocumentState();
    setPrivacyPolicyLoading(false);
    setSavingPrivacyPolicy(false);
    setUsers([]);
    setAnalytics(null);
    setSelectedUser(null);
    setSelectedUserAllowedHosts([]);
    setSelectedUserDefaultScheduleTimezone('America/Chicago');
    setSelectedLinkConfig(null);
    setSelectedLinkAnalytics(null);
    setSelectedLinkAnalyticsLoading(false);
    setSelectedLinkAnalyticsError(null);
    setGeneratingCreateSlug(false);
    setGeneratingLinkConfigSlug(false);
    setGeneratingEditingSlugLinkId(null);
    setAddingPassword(false);
    setAddingSubtracker(false);
    setTogglingPasswordId(null);
    setTogglingSubtrackerId(null);
    setCopiedPasswordId(null);
    setCopiedTrackedSubtrackerId(null);
    setIsDescriptionEditorVisible(false);
    setIsAvailabilitySectionExpanded(false);
    setIsPasswordLinksSectionExpanded(false);
    setIsScheduleSectionExpanded(false);
    setIsTrackedLinksSectionExpanded(false);
    setNewPasswordName('');
    setNewPasswordValue('');
    setNewSubtrackerName('');
    setUserLinkVariablesLoading(false);
    setSavingUserLinkVariables(false);
    setUserLinkVariables([]);
    savedUserLinkVariablesRef.current = [];
    savedUserLinkVariablesSnapshotRef.current = '[]';
    setUserLinkVariablesDefaultScheduleTimezone('America/Chicago');
    savedUserLinkVariablesDefaultScheduleTimezoneRef.current = 'America/Chicago';
    setSelectedLinkAvailabilityMode('enabled');
    setMineLinkCount(null);
    savedSelectedLinkConfigRef.current = null;
    savedSelectedLinkAvailabilityModeRef.current = 'enabled';
    savedSelectedLinkConfigSnapshotRef.current = null;
    setCurrentPage(1);
    setLinkListScope('mine');
    setAnalyticsScope('mine');
    setSearchInput('');
    setSearchQuery('');
    setSortOption('updatedDesc');
    setTotalLinks(0);
    setTotalPages(1);
    setCopiedTrackedSubtrackerId(null);
  }

  function handleStartEditing(link: LinkRecord) {
    setOpenActionMenuLinkId(null);
    setEditingLinkId(link.id);
    setEditingCanonicalHost(link.canonical_host);
    setEditingSlug(link.slug);
    setEditingDestinationUrl(link.destination_url);
    setGeneratingEditingSlugLinkId(null);
    clearNotification();
  }

  function handleCancelEditing() {
    setOpenActionMenuLinkId(null);
    setEditingLinkId(null);
    setEditingCanonicalHost('');
    setEditingSlug('');
    setEditingDestinationUrl('');
    setGeneratingEditingSlugLinkId(null);
    setSavingLinkId(null);
  }

  async function handleGenerateEditingSlug(linkId: string) {
    setGeneratingEditingSlugLinkId(linkId);

    try {
      const slug = await requestGeneratedSlug(editingCanonicalHost, linkId);
      setEditingSlug(slug);
    } catch (generateError) {
      showNotification(
        'error',
        generateError instanceof Error
          ? generateError.message
          : 'Unable to generate an unused slug.'
      );
    } finally {
      setGeneratingEditingSlugLinkId((current) => (current === linkId ? null : current));
    }
  }

  async function handleSaveEditing(linkId: string) {
    setSavingLinkId(linkId);
    setOpenActionMenuLinkId(null);
    clearNotification();
    const existingLink = links.find((link) => link.id === linkId) ?? null;

    try {
      await updateLink(linkId, {
        slug: editingSlug,
        canonicalHost: editingCanonicalHost,
        destinationUrl: editingDestinationUrl || undefined
      });

      await loadLinksPage(currentPage, pageSize, linkListScope, linkListFilters);
      showNotification('success', 'Link updated.');
      handleCancelEditing();
    } catch (saveError) {
      showNotification(
        'error',
        saveError instanceof Error ? saveError.message : 'Unable to update link.'
      );
      setSavingLinkId(null);
    }
  }

  async function handleCopyShortlink(linkId: string, shortUrl: string) {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopiedLinkId(linkId);
      clearNotification();

      window.setTimeout(() => {
        setCopiedLinkId((current) => (current === linkId ? null : current));
      }, 1_500);
    } catch {
      showNotification('error', 'Unable to copy shortlink.');
    }
  }

  async function handleOpenManagedDestinationConfig(destinationUrl: string) {
    const shortlinkReference = getManagedShortlinkReference(destinationUrl, domains);
    if (!shortlinkReference) {
      window.open(destinationUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const cacheKey = `${shortlinkReference.canonicalHost}/${shortlinkReference.slug}`;
    const cachedLinkId = resolvedShortlinkTargetRef.current.get(cacheKey);
    if (cachedLinkId) {
      navigate(`/links/${encodeURIComponent(cachedLinkId)}`);
      return;
    }

    if (cachedLinkId === null) {
      window.open(destinationUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      const response = await resolveLinkByShortlink(
        shortlinkReference.canonicalHost,
        shortlinkReference.slug
      );
      resolvedShortlinkTargetRef.current.set(cacheKey, response.linkId);

      if (response.linkId) {
        navigate(`/links/${encodeURIComponent(response.linkId)}`);
        return;
      }
    } catch {
      // Fall through to opening the destination if resolution fails.
    }

    window.open(destinationUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleDeleteLink(link: LinkRecord) {
    setOpenActionMenuLinkId(null);
    const confirmed = window.confirm(
      `Delete ${link.canonical_host}/${link.slug}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingLinkId(link.id);
    clearNotification();

    try {
      await deleteLink(link.id);

      const nextTotalLinks = Math.max(0, totalLinks - 1);
      const nextTotalPages = Math.max(1, Math.ceil(nextTotalLinks / pageSize));
      const nextPage = Math.min(currentPage, nextTotalPages);

      if (nextPage !== currentPage) {
        setCurrentPage(nextPage);
      } else {
        await loadLinksPage(currentPage, pageSize, linkListScope, linkListFilters);
      }

      if (editingLinkId === link.id) {
        handleCancelEditing();
      }

      showNotification('success', 'Link deleted.');
    } catch (deleteError) {
      showNotification(
        'error',
        deleteError instanceof Error ? deleteError.message : 'Unable to delete link.'
      );
    } finally {
      setDeletingLinkId(null);
    }
  }

  async function handleToggleLinkDisabled(link: { id: string; is_disabled: boolean }) {
    setTogglingLinkDisabledId(link.id);
    setOpenActionMenuLinkId(null);
    clearNotification();

    try {
      const response = await updateLinkDisabledState(link.id, !link.is_disabled);
      setLinks((current) =>
        current.map((currentLink) =>
          currentLink.id === link.id
            ? {
                ...currentLink,
                is_disabled: response.link.is_disabled,
                updated_at: response.link.updated_at
              }
            : currentLink
        )
      );
      setSelectedLinkConfig((current) =>
        current && current.id === link.id
          ? (() => {
              const nextConfig = {
                ...current,
                is_disabled: response.link.is_disabled,
                updated_at: response.link.updated_at
              };
              const savedConfig = savedSelectedLinkConfigRef.current;
              if (savedConfig && savedConfig.id === link.id) {
                const nextSavedConfig = {
                  ...savedConfig,
                  is_disabled: response.link.is_disabled,
                  updated_at: response.link.updated_at
                };
                const nextSavedAvailabilityMode = getLinkAvailabilityMode(nextSavedConfig);
                setSelectedLinkAvailabilityMode(nextSavedAvailabilityMode);
                savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextSavedConfig);
                savedSelectedLinkAvailabilityModeRef.current = nextSavedAvailabilityMode;
                savedSelectedLinkConfigSnapshotRef.current =
                  getLinkConfigurationSnapshot(nextSavedConfig);
              }
              return nextConfig;
            })()
          : current
      );
      showNotification('success', response.link.is_disabled ? 'Link disabled.' : 'Link enabled.');
    } catch (toggleError) {
      showNotification(
        'error',
        toggleError instanceof Error ? toggleError.message : 'Unable to update link state.'
      );
    } finally {
      setTogglingLinkDisabledId(null);
    }
  }

  async function handleToggleLinkInternal(link: LinkRecord) {
    setTogglingLinkInternalId(link.id);
    setOpenActionMenuLinkId(null);
    clearNotification();

    try {
      const response = await updateLink(link.id, {
        slug: link.slug,
        canonicalHost: link.canonical_host,
        destinationUrl: link.destination_url,
        internalOnly: !link.internal_only
      });

      setLinks((current) =>
        current.map((currentLink) =>
          currentLink.id === link.id
            ? {
                ...currentLink,
                internal_only: response.link.internal_only,
                updated_at: response.link.updated_at
              }
            : currentLink
        )
      );
      setSelectedLinkConfig((current) =>
        current && current.id === link.id
          ? (() => {
              const nextConfig = {
                ...current,
                internal_only: response.link.internal_only,
                updated_at: response.link.updated_at
              };
              const savedConfig = savedSelectedLinkConfigRef.current;
              if (savedConfig && savedConfig.id === link.id) {
                const nextSavedConfig = {
                  ...savedConfig,
                  internal_only: response.link.internal_only,
                  updated_at: response.link.updated_at
                };
                savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextSavedConfig);
                savedSelectedLinkConfigSnapshotRef.current =
                  getLinkConfigurationSnapshot(nextSavedConfig);
              }
              return nextConfig;
            })()
          : current
      );
      showNotification(
        'success',
        response.link.internal_only ? 'Link is now internal.' : 'Link is now public.'
      );
    } catch (toggleError) {
      showNotification(
        'error',
        toggleError instanceof Error ? toggleError.message : 'Unable to update link visibility.'
      );
    } finally {
      setTogglingLinkInternalId(null);
    }
  }

  function handleLinkConfigChange(
    field:
      | 'canonical_host'
      | 'description'
      | 'destination_url'
      | 'disabledDestinationUrl'
      | 'expiresAt'
      | 'internal_only'
      | 'is_listed'
      | 'rememberPasswordAccess'
      | 'requires_tracking_id'
      | 'scheduleTimezone'
      | 'slug',
    value: string | boolean | null
  ) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            [field]:
              field === 'destination_url' || field === 'disabledDestinationUrl'
                ? normalizeDestinationInputValue(String(value))
                : value
          }
        : current
    );
  }

  function handleScheduleEntryChange(
    scheduleId: number | string,
    field: keyof Omit<EditableLinkSchedule, 'id'>,
    value: string
  ) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            schedules: current.schedules.map((schedule) =>
              schedule.id === scheduleId
                ? {
                    ...schedule,
                    [field]:
                      field === 'destinationUrl'
                        ? normalizeDestinationInputValue(value)
                        : value
                  }
                : schedule
            )
          }
        : current
    );
  }

  function handleChangeScheduleMode(mode: LinkScheduleMode) {
    setScheduleViewMode('edit');
    setSelectedLinkConfig((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        scheduleMode: mode,
        rotationSchedule:
          mode === 'rotation'
            ? (current.rotationSchedule ?? {
                intervalMinutes: 15,
                destinations: [createEmptyRotationDestination()]
              })
            : current.rotationSchedule
      };
    });
  }

  function handleRotationIntervalChange(intervalMinutes: number) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            rotationSchedule: {
              intervalMinutes,
              destinations: current.rotationSchedule?.destinations ?? []
            }
          }
        : current
    );
  }

  function handleRotationDestinationChange(
    destinationId: number | string,
    destinationUrl: string
  ) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            rotationSchedule: current.rotationSchedule
              ? {
                  ...current.rotationSchedule,
                  destinations: current.rotationSchedule.destinations.map((destination) =>
                    destination.id === destinationId
                      ? {
                          ...destination,
                          destinationUrl: normalizeDestinationInputValue(destinationUrl)
                        }
                      : destination
                  )
                }
              : current.rotationSchedule
          }
        : current
    );
  }

  function handleAddRotationDestination() {
    setScheduleViewMode('edit');
    setIsScheduleSectionExpanded(true);
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            scheduleMode: 'rotation',
            rotationSchedule: {
              intervalMinutes: current.rotationSchedule?.intervalMinutes ?? 15,
              destinations: [
                ...(current.rotationSchedule?.destinations ?? []),
                createEmptyRotationDestination()
              ]
            }
          }
        : current
    );
  }

  function handleRemoveRotationDestination(destinationId: number | string) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            rotationSchedule: current.rotationSchedule
              ? {
                  ...current.rotationSchedule,
                  destinations: current.rotationSchedule.destinations.filter(
                    (destination) => destination.id !== destinationId
                  )
                }
              : current.rotationSchedule
          }
        : current
    );
  }

  function handleMoveRotationDestination(destinationId: number | string, direction: -1 | 1) {
    setSelectedLinkConfig((current) => {
      if (!current?.rotationSchedule) {
        return current;
      }

      const currentIndex = current.rotationSchedule.destinations.findIndex(
        (destination) => destination.id === destinationId
      );
      if (currentIndex === -1) {
        return current;
      }

      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.rotationSchedule.destinations.length) {
        return current;
      }

      const nextDestinations = [...current.rotationSchedule.destinations];
      const [movedDestination] = nextDestinations.splice(currentIndex, 1);
      nextDestinations.splice(nextIndex, 0, movedDestination);

      return {
        ...current,
        rotationSchedule: {
          ...current.rotationSchedule,
          destinations: nextDestinations
        }
      };
    });
  }

  function handleDestinationInputFocus(
    value: string,
    updateValue: (nextValue: string) => void
  ) {
    if (!value) {
      updateValue(defaultDestinationProtocol);
    }
  }

  function handleAddScheduleEntry() {
    setScheduleViewMode('edit');
    setIsScheduleSectionExpanded(true);
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            schedules: [...current.schedules, createEmptyScheduleEntry()]
          }
        : current
    );
  }

  function handleRemoveScheduleEntry(scheduleId: number | string) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            schedules: current.schedules.filter((schedule) => schedule.id !== scheduleId)
          }
        : current
    );
  }

  async function handleCreatePassword() {
    if (adminRoute.view !== 'link-config') {
      return;
    }

    setIsPasswordLinksSectionExpanded(true);

    const trimmedName = newPasswordName.trim();
    const trimmedPassword = newPasswordValue.trim();
    if (!trimmedName || !trimmedPassword) {
      showNotification('error', 'Enter a name and password before adding a password.');
      return;
    }

    const savedConfig = savedSelectedLinkConfigRef.current;
    if (!savedConfig) {
      showNotification('error', 'Link configuration is still loading.');
      return;
    }

    setAddingPassword(true);
    clearNotification();

    try {
      const response = await createLinkPassword(adminRoute.linkId, {
        name: trimmedName,
        password: trimmedPassword
      });
      const createdPassword: EditableLinkPassword = response.password;
      const nextHasPassword = true;

      setSelectedLinkConfig((current) =>
        current
          ? {
              ...current,
              has_password: nextHasPassword,
              passwords: [...current.passwords, createdPassword]
            }
          : current
      );

      const nextSavedConfig = {
        ...savedConfig,
        has_password: nextHasPassword,
        passwords: [...savedConfig.passwords, createdPassword]
      };
      savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextSavedConfig);
      savedSelectedLinkConfigSnapshotRef.current = getLinkConfigurationSnapshot(nextSavedConfig);
      setLinks((current) =>
        current.map((link) =>
          link.id === adminRoute.linkId ? { ...link, has_password: nextHasPassword } : link
        )
      );
      setNewPasswordName('');
      setNewPasswordValue('');
      setShowNewPasswordValue(false);
      showNotification('success', 'Password added.');
    } catch (createError) {
      showNotification(
        'error',
        createError instanceof Error ? createError.message : 'Unable to add password.'
      );
    } finally {
      setAddingPassword(false);
    }
  }

  async function handleCreateSubtracker() {
    if (adminRoute.view !== 'link-config') {
      return;
    }

    setIsTrackedLinksSectionExpanded(true);

    const trimmedName = newSubtrackerName.trim();
    if (!trimmedName) {
      showNotification('error', 'Enter a name before adding a tagged link.');
      return;
    }

    const savedConfig = savedSelectedLinkConfigRef.current;
    if (!savedConfig) {
      showNotification('error', 'Link configuration is still loading.');
      return;
    }

    setAddingSubtracker(true);
    clearNotification();

    try {
      const response = await createLinkSubtracker(adminRoute.linkId, trimmedName);
      const createdSubtracker: EditableLinkSubtracker = response.subtracker;

      setSelectedLinkConfig((current) =>
        current
          ? {
              ...current,
              subtrackers: [...current.subtrackers, createdSubtracker]
            }
          : current
      );

      const nextSavedConfig = {
        ...savedConfig,
        subtrackers: [...savedConfig.subtrackers, createdSubtracker]
      };
      savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextSavedConfig);
      savedSelectedLinkConfigSnapshotRef.current = getLinkConfigurationSnapshot(nextSavedConfig);
      setNewSubtrackerName('');

      const trackedShortUrl = getTrackedShortUrl(
        savedConfig.canonical_host,
        savedConfig.slug,
        response.subtracker.trackingId
      );

      if (!trackedShortUrl) {
        showNotification('success', 'Tagged link added.');
        return;
      }

      try {
        await navigator.clipboard.writeText(trackedShortUrl);
        showNotification('success', `Tagged link added and copied ${trackedShortUrl}.`);
      } catch {
        showNotification('warning', `Tagged link added, but unable to copy ${trackedShortUrl}.`);
      }
    } catch (createError) {
      showNotification(
        'error',
        createError instanceof Error ? createError.message : 'Unable to add tagged link.'
      );
    } finally {
      setAddingSubtracker(false);
    }
  }

  function handlePasswordChange(
    passwordId: number | string,
    field: 'name' | 'password',
    value: string
  ) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            passwords: current.passwords.map((password) =>
              password.id === passwordId
                ? {
                    ...password,
                    [field]: value
                  }
                : password
            )
          }
        : current
    );
  }

  function handleSubtrackerChange(
    subtrackerId: number | string,
    field: 'name',
    value: string
  ) {
    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            subtrackers: current.subtrackers.map((subtracker) =>
              subtracker.id === subtrackerId
                ? {
                    ...subtracker,
                    [field]: value
                  }
                : subtracker
            )
          }
        : current
    );
  }

  function handleDeleteSubtracker(subtrackerId: number | string) {
    if (!window.confirm('Delete this tagged link? This cannot be undone.')) {
      return;
    }

    setSelectedLinkConfig((current) =>
      current
        ? {
            ...current,
            subtrackers: current.subtrackers.filter((subtracker) => subtracker.id !== subtrackerId)
          }
        : current
    );

    setCopiedTrackedSubtrackerId((current) =>
      current === String(subtrackerId) ? null : current
    );
    setEditingSubtrackerId((current) => (current === String(subtrackerId) ? null : current));
  }

  function handleDeletePassword(passwordId: number | string) {
    if (!window.confirm('Delete this password? This cannot be undone.')) {
      return;
    }

    setSelectedLinkConfig((current) => {
      if (!current) {
        return current;
      }

      const nextPasswords = current.passwords.filter((password) => password.id !== passwordId);

      return {
        ...current,
        has_password:
          (current.hasLegacyPasswordPrompt ?? false) ||
          nextPasswords.some((password) => !password.isDisabled),
        passwords: nextPasswords
      };
    });

    setCopiedPasswordId((current) => (current === String(passwordId) ? null : current));
    setEditingPasswordId((current) => (current === String(passwordId) ? null : current));
    setVisiblePasswordIds((current) => {
      if (!current.has(String(passwordId))) {
        return current;
      }

      const next = new Set(current);
      next.delete(String(passwordId));
      return next;
    });
  }

  function handleToggleSubtrackerEditing(subtrackerId: number | string) {
    const nextId = String(subtrackerId);
    setEditingSubtrackerId((current) => (current === nextId ? null : nextId));
  }

  function handleTogglePasswordEditing(passwordId: number | string) {
    const nextId = String(passwordId);
    setEditingPasswordId((current) => (current === nextId ? null : nextId));
  }

  function toggleVisiblePassword(passwordId: string) {
    setVisiblePasswordIds((current) => {
      const next = new Set(current);
      if (next.has(passwordId)) {
        next.delete(passwordId);
      } else {
        next.add(passwordId);
      }
      return next;
    });
  }

  async function handleToggleSubtrackerDisabled(
    subtrackerId: number | string,
    nextIsDisabled: boolean
  ) {
    if (
      adminRoute.view !== 'link-config' ||
      typeof subtrackerId !== 'string' ||
      !/^\d+$/.test(subtrackerId)
    ) {
      return;
    }

    setTogglingSubtrackerId(subtrackerId);
    clearNotification();

    try {
      const response = await updateLinkSubtrackerDisabledState(
        adminRoute.linkId,
        subtrackerId,
        nextIsDisabled
      );

      setSelectedLinkConfig((current) =>
        current
          ? {
              ...current,
              subtrackers: current.subtrackers.map((subtracker) =>
                subtracker.id === subtrackerId
                  ? {
                      ...subtracker,
                      isDisabled: response.subtracker.isDisabled
                    }
                  : subtracker
              )
            }
          : current
      );

      const savedConfig = savedSelectedLinkConfigRef.current;
      if (savedConfig) {
        const nextSavedConfig = {
          ...savedConfig,
          subtrackers: savedConfig.subtrackers.map((subtracker) =>
            subtracker.id === subtrackerId
              ? {
                  ...subtracker,
                  isDisabled: response.subtracker.isDisabled
                }
              : subtracker
          )
        };
        savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextSavedConfig);
        savedSelectedLinkConfigSnapshotRef.current = getLinkConfigurationSnapshot(nextSavedConfig);
      }

      showNotification(
        'success',
        response.subtracker.isDisabled ? 'Tagged link disabled.' : 'Tagged link enabled.'
      );
    } catch (updateError) {
      showNotification(
        'error',
        updateError instanceof Error ? updateError.message : 'Unable to update tagged link.'
      );
    } finally {
      setTogglingSubtrackerId((current) => (current === subtrackerId ? null : current));
    }
  }

  async function handleTogglePasswordDisabled(
    passwordId: number | string,
    nextIsDisabled: boolean
  ) {
    if (
      adminRoute.view !== 'link-config' ||
      typeof passwordId !== 'string' ||
      !/^\d+$/.test(passwordId)
    ) {
      return;
    }

    setTogglingPasswordId(passwordId);
    clearNotification();

    try {
      const response = await updateLinkPasswordDisabledState(
        adminRoute.linkId,
        passwordId,
        nextIsDisabled
      );
      const savedConfig = savedSelectedLinkConfigRef.current;
      const nextPasswords = (savedConfig?.passwords ?? []).map((password) =>
        password.id === passwordId
          ? {
              ...password,
              isDisabled: response.password.isDisabled
            }
          : password
      );
      const nextHasPassword = Boolean(
        (savedConfig?.hasLegacyPasswordPrompt ?? false) ||
          nextPasswords.some((password) => !password.isDisabled)
      );

      setSelectedLinkConfig((current) =>
        current
          ? {
              ...current,
              has_password: nextHasPassword,
              passwords: current.passwords.map((password) =>
                password.id === passwordId
                  ? {
                      ...password,
                      isDisabled: response.password.isDisabled
                    }
                  : password
              )
            }
          : current
      );

      if (savedConfig) {
        const nextSavedConfig = {
          ...savedConfig,
          has_password: nextHasPassword,
          passwords: nextPasswords
        };
        savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextSavedConfig);
        savedSelectedLinkConfigSnapshotRef.current = getLinkConfigurationSnapshot(nextSavedConfig);
      }

      setLinks((current) =>
        current.map((link) =>
          link.id === adminRoute.linkId ? { ...link, has_password: nextHasPassword } : link
        )
      );

      showNotification(
        'success',
        response.password.isDisabled ? 'Password disabled.' : 'Password enabled.'
      );
    } catch (updateError) {
      showNotification(
        'error',
        updateError instanceof Error ? updateError.message : 'Unable to update password.'
      );
    } finally {
      setTogglingPasswordId((current) => (current === passwordId ? null : current));
    }
  }

  async function handleCopyTrackedShortlink(subtrackerId: string, shortUrl: string) {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopiedTrackedSubtrackerId(subtrackerId);

      window.setTimeout(() => {
        setCopiedTrackedSubtrackerId((current) => (current === subtrackerId ? null : current));
      }, 1_500);
    } catch {
      showNotification('error', 'Unable to copy tracked shortlink.');
    }
  }

  async function handleCopyPasswordValue(passwordId: string, password: string) {
    try {
      await navigator.clipboard.writeText(password);
      setCopiedPasswordId(passwordId);

      window.setTimeout(() => {
        setCopiedPasswordId((current) => (current === passwordId ? null : current));
      }, 1_500);
    } catch {
      showNotification('error', 'Unable to copy password.');
    }
  }

  function handleChangeLinkAvailabilityMode(mode: LinkAvailabilityMode) {
    setIsAvailabilitySectionExpanded(true);
    setSelectedLinkAvailabilityMode(mode);
    setSelectedLinkConfig((current) => {
      if (!current) {
        return current;
      }

      if (mode === 'enabled') {
        return {
          ...current,
          waiting_room_enabled: false,
          is_disabled: false,
          expiresAt: null
        };
      }

      if (mode === 'disabled') {
        return {
          ...current,
          waiting_room_enabled: false,
          is_disabled: true,
          expiresAt: null
        };
      }

      if (mode === 'waiting-room') {
        return {
          ...current,
          waiting_room_enabled: true,
          is_disabled: false,
          expiresAt: null
        };
      }

      return {
        ...current,
        waiting_room_enabled: false,
        is_disabled: false,
        expiresAt: current.expiresAt ?? getDefaultExpirationIso()
      };
    });
  }

  async function persistLinkConfigurationDraft(input: {
    linkId: string;
    config: EditableLinkConfiguration;
    availabilityMode: LinkAvailabilityMode;
    draftSnapshot: string;
  }) {
    const validationMessage = getLinkConfigurationValidationMessage(
      input.config,
      input.availabilityMode
    );
    if (validationMessage) {
      return;
    }

    const normalizedPasswords = normalizeEditableLinkPasswords(input.config.passwords);

    setSavingLinkConfig(true);
    setLinkConfigAutoSaveError(null);
    setLinkConfigAutoSaveFailedSnapshot(null);

    try {
      const scheduleMode = input.config.scheduleMode;
      const schedules =
        scheduleMode === 'windows'
          ? input.config.schedules.map((schedule) => ({
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              destinationUrl: schedule.destinationUrl
            }))
          : [];
      const rotationIntervalMinutes =
        scheduleMode === 'rotation' ? input.config.rotationSchedule?.intervalMinutes ?? null : null;
      const rotationDestinations =
        scheduleMode === 'rotation'
          ? input.config.rotationSchedule?.destinations.map((destination) => ({
              destinationUrl: destination.destinationUrl
            })) ?? []
          : [];

      const response = await updateLinkConfiguration(input.linkId, {
        slug: input.config.slug,
        canonicalHost: input.config.canonical_host,
        destinationUrl: input.config.destination_url,
        description: input.config.description ?? '',
        internalOnly: input.config.internal_only,
        isListed: input.config.is_listed,
        isDisabled: input.availabilityMode === 'disabled',
        waitingRoomEnabled: input.availabilityMode === 'waiting-room',
        requiresTrackingId: input.config.requires_tracking_id,
        rememberPasswordAccess: input.config.rememberPasswordAccess,
        disabledDestinationUrl: input.config.disabledDestinationUrl,
        expirationAt: input.availabilityMode === 'expires' ? input.config.expiresAt : null,
        scheduleTimezone: input.config.scheduleTimezone,
        scheduleMode,
        schedules,
        rotationIntervalMinutes,
        rotationDestinations,
        subtrackers: input.config.subtrackers.map((subtracker) => ({
          id:
            typeof subtracker.id === 'string' && /^\d+$/.test(subtracker.id)
              ? subtracker.id
              : undefined,
          name: subtracker.name,
          isDisabled: subtracker.isDisabled
        })),
        passwords: normalizedPasswords
      });

      const nextConfig = cloneEditableLinkConfiguration(response.link);
      const nextAvailabilityMode = getLinkAvailabilityMode(nextConfig);

      if (selectedRouteLinkIdRef.current === input.linkId) {
        savedSelectedLinkConfigRef.current = cloneEditableLinkConfiguration(nextConfig);
        savedSelectedLinkAvailabilityModeRef.current = nextAvailabilityMode;
        savedSelectedLinkConfigSnapshotRef.current = getLinkConfigurationSnapshot(nextConfig);

        if (selectedLinkConfigDraftSnapshotRef.current === input.draftSnapshot) {
          setSelectedLinkConfig(nextConfig);
          setSelectedLinkAvailabilityMode(nextAvailabilityMode);
        }
      }

      setLinks((current) =>
        current.map((link) =>
          link.id === response.link.id
            ? {
                ...link,
                canonical_host: response.link.canonical_host,
                slug: response.link.slug,
                destination_url: response.link.destination_url,
                description: response.link.description,
                disabled_destination_url: response.link.disabledDestinationUrl,
                internal_only: response.link.internal_only,
                is_listed: response.link.is_listed,
                is_disabled: response.link.is_disabled,
                waiting_room_enabled: response.link.waiting_room_enabled,
                requires_tracking_id: response.link.requires_tracking_id,
                has_password: response.link.has_password,
                expires_at: response.link.expiresAt,
                schedule_timezone: response.link.scheduleTimezone,
                schedule_mode: response.link.scheduleMode,
                updated_at: response.link.updated_at
              }
            : link
        )
      );
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Unable to update link configuration.';

      if (selectedRouteLinkIdRef.current === input.linkId) {
        setLinkConfigAutoSaveError(message);
        setLinkConfigAutoSaveFailedSnapshot(input.draftSnapshot);
        showNotification('error', message);
      }
    } finally {
      setSavingLinkConfig(false);
    }
  }

  async function handleSaveLinkConfiguration() {
    if (
      adminRoute.view !== 'link-config' ||
      !selectedLinkConfig ||
      !selectedLinkConfigDraftSnapshot
    ) {
      return;
    }

    await persistLinkConfigurationDraft({
      linkId: adminRoute.linkId,
      config: selectedLinkConfig,
      availabilityMode: selectedLinkAvailabilityMode,
      draftSnapshot: selectedLinkConfigDraftSnapshot
    });
  }

  function handleToggleSelectedUserHost(host: string) {
    setSelectedUserAllowedHosts((current) =>
      current.includes(host) ? current.filter((item) => item !== host) : [...current, host]
    );
  }

  function handleToggleSelectedGroupMemberUserId(userId: string) {
    setSelectedGroupMemberUserIds((current) =>
      current.includes(userId) ? current.filter((item) => item !== userId) : [...current, userId]
    );
  }

  function handleToggleSelectedGroupHost(host: string) {
    setSelectedGroupAllowedHosts((current) =>
      current.includes(host) ? current.filter((item) => item !== host) : [...current, host]
    );
  }

  function handleToggleSelectedGroupDomainAdministrationHost(host: string) {
    setSelectedGroupDomainAdministrationHosts((current) =>
      current.includes(host) ? current.filter((item) => item !== host) : [...current, host]
    );
  }

  async function handleCreateGroup() {
    if (!user?.isSuperAdmin) {
      return;
    }

    const trimmedName = newGroupName.trim();
    if (!trimmedName) {
      showNotification('error', 'Enter a group name before creating the group.');
      return;
    }

    setCreatingGroup(true);
    clearNotification();

    try {
      const response = await createGroup(trimmedName);
      setGroups((current) =>
        [...current, response.group].sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        )
      );
      setNewGroupName('');
      navigate(`/groups/${encodeURIComponent(response.group.id)}`);
      showNotification('success', 'Group created.');
    } catch (createError) {
      showNotification(
        'error',
        createError instanceof Error ? createError.message : 'Unable to create group.'
      );
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleCreateInvite() {
    if (!user?.isSuperAdmin) {
      return;
    }

    setCreatingInvite(true);
    clearNotification();

    try {
      const response = await createInvite({
        groupId: newInviteGroupId || null,
        label: newInviteLabel.trim() || null
      });
      setInvites((current) => [response.invite, ...current]);
      setNewInviteLabel('');
      setNewInviteGroupId('');
      showNotification('success', 'Invite created.');
    } catch (createError) {
      showNotification(
        'error',
        createError instanceof Error ? createError.message : 'Unable to create invite.'
      );
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleCopyInviteLink(inviteId: string, inviteTokenValue: string) {
    try {
      await navigator.clipboard.writeText(getRegistrationInviteUrl(inviteTokenValue));
      setCopiedInviteId(inviteId);
      window.setTimeout(() => {
        setCopiedInviteId((current) => (current === inviteId ? null : current));
      }, 1600);
    } catch {
      showNotification('error', 'Unable to copy invite link.');
    }
  }

  async function handleSaveSelectedUserDomainAccess() {
    if (adminRoute.view !== 'user-detail' || !selectedUser) {
      return;
    }

    setSavingSelectedUser(true);
    clearNotification();

    try {
      const response = await updateUserDomainAccess(adminRoute.userId, {
        allowedCanonicalHosts: selectedUserAllowedHosts,
        defaultScheduleTimezone: selectedUserDefaultScheduleTimezone
      });
      setSelectedUser(response.user);
      setSelectedUserAllowedHosts(response.user.directAllowedCanonicalHosts);
      setSelectedUserDefaultScheduleTimezone(response.user.default_schedule_timezone);
      setUsers((current) =>
        current.map((account) =>
          account.id === response.user.id
            ? {
                ...account,
                isSuperAdmin: response.user.isSuperAdmin,
                default_schedule_timezone: response.user.default_schedule_timezone
              }
            : account
        )
      );

      if (user?.email.toLowerCase() === response.user.email.toLowerCase()) {
        setUser((current) =>
          current
            ? {
                ...current,
                allowedCanonicalHosts: response.user.allowedCanonicalHosts,
                defaultScheduleTimezone: response.user.default_schedule_timezone
              }
            : current
        );
      }

      showNotification('success', 'User settings updated.');
    } catch (saveError) {
      showNotification(
        'error',
        saveError instanceof Error ? saveError.message : 'Unable to update user settings.'
      );
    } finally {
      setSavingSelectedUser(false);
    }
  }

  async function handleSaveSelectedGroup() {
    if (adminRoute.view !== 'group-detail' || !selectedGroup) {
      return;
    }

    const trimmedName = selectedGroupName.trim();
    if (!trimmedName) {
      showNotification('error', 'Group name is required.');
      return;
    }

    setSavingSelectedGroup(true);
    clearNotification();

    try {
      const autoMemberEmailDomains = normalizeEmailDomainsFromDraft(
        selectedGroupAutoMemberEmailDomainsText
      );
      const response = await updateGroup(adminRoute.groupId, {
        name: trimmedName,
        memberUserIds: selectedGroupMemberUserIds,
        allowedCanonicalHosts: selectedGroupAllowedHosts,
        domainAdministrationHosts: selectedGroupDomainAdministrationHosts,
        autoMemberEmailDomains
      });

      setSelectedGroup(response.group);
      setSelectedGroupName(response.group.name);
      setSelectedGroupMemberUserIds(response.group.member_user_ids);
      setSelectedGroupAllowedHosts(response.group.allowed_canonical_hosts);
      setSelectedGroupDomainAdministrationHosts(response.group.domain_administration_hosts);
      setSelectedGroupAutoMemberEmailDomainsText(
        response.group.auto_member_email_domains.join('\n')
      );
      setGroups((current) => {
        const nextGroups = current.some((group) => group.id === response.group.id)
          ? current.map((group) => (group.id === response.group.id ? response.group : group))
          : [...current, response.group];

        return nextGroups.sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        );
      });
      showNotification('success', 'Group settings updated.');
    } catch (saveError) {
      showNotification(
        'error',
        saveError instanceof Error ? saveError.message : 'Unable to update group.'
      );
    } finally {
      setSavingSelectedGroup(false);
    }
  }

  async function handleDeleteSelectedGroup() {
    if (adminRoute.view !== 'group-detail' || !selectedGroup) {
      return;
    }

    if (!window.confirm(`Delete the group "${selectedGroup.name}"?`)) {
      return;
    }

    setDeletingSelectedGroup(true);
    clearNotification();

    try {
      await deleteGroup(adminRoute.groupId);
      setGroups((current) => current.filter((group) => group.id !== adminRoute.groupId));
      setSelectedGroup(null);
      setSelectedGroupName('');
      setSelectedGroupMemberUserIds([]);
      setSelectedGroupAllowedHosts([]);
      setSelectedGroupDomainAdministrationHosts([]);
      setSelectedGroupAutoMemberEmailDomainsText('');
      navigate('/groups');
      showNotification('success', 'Group deleted.');
    } catch (deleteError) {
      showNotification(
        'error',
        deleteError instanceof Error ? deleteError.message : 'Unable to delete group.'
      );
    } finally {
      setDeletingSelectedGroup(false);
    }
  }

  async function handleToggleDomainDefault(domain: ManagedDomainRecord) {
    setSavingDomainHost(domain.host);
    clearNotification();

    try {
      const response = await updateDomain({
        canonicalHost: domain.host,
        isDefaultForNewAccounts: !domain.isDefaultForNewAccounts
      });

      applyManagedDomainsState(response.domains);
      setDomains(sortDomainRecordsByHost(response.supportedDomains));
      showNotification('success', 'Domain defaults updated.');
    } catch (updateError) {
      showNotification(
        'error',
        updateError instanceof Error ? updateError.message : 'Unable to update domain.'
      );
    } finally {
      setSavingDomainHost(null);
    }
  }

  async function saveDomainRouting(
    domain: ManagedDomainRecord,
    input: {
      aliasTargetHost: string | null;
      authProviderHost: string | null;
    },
    successMessage: string
  ) {
    setSavingDomainHost(domain.host);
    clearNotification();

    try {
      const response = await updateDomain({
        canonicalHost: domain.host,
        aliasTargetHost: input.aliasTargetHost,
        authProviderHost: input.authProviderHost
      });

      applyManagedDomainsState(response.domains);
      setDomains(sortDomainRecordsByHost(response.supportedDomains));
      showNotification('success', successMessage);

      if (user) {
        const stillAllowedHosts = new Set(
          response.supportedDomains.map((supportedDomain) => supportedDomain.host)
        );
        setUser({
          ...user,
          allowedCanonicalHosts: user.allowedCanonicalHosts.filter((host) => stillAllowedHosts.has(host))
        });
      }
    } catch (updateError) {
      showNotification(
        'error',
        updateError instanceof Error ? updateError.message : 'Unable to update domain routing.'
      );
    } finally {
      setSavingDomainHost(null);
    }
  }

  async function handleChangeDomainType(
    domain: ManagedDomainRecord,
    nextType: DomainRoutingType,
    canonicalTargets: ManagedDomainRecord[],
    authProviderTargets: ManagedDomainRecord[]
  ) {
    if (nextType === getDomainRoutingType(domain)) {
      return;
    }

    if (nextType === 'canonical') {
      await saveDomainRouting(
        domain,
        {
          aliasTargetHost: null,
          authProviderHost: null
        },
        'Domain type updated.'
      );
      return;
    }

    const availableTargets = nextType === 'alias' ? canonicalTargets : authProviderTargets;
    const preferredTarget =
      nextType === 'alias'
        ? domain.aliasTargetHost ?? domain.authProviderHost
        : domain.authProviderHost ?? domain.aliasTargetHost;
    const nextTarget =
      (preferredTarget &&
      availableTargets.some((candidate) => candidate.host === preferredTarget)
        ? preferredTarget
        : availableTargets[0]?.host) ?? null;

    if (!nextTarget) {
      showNotification(
        'error',
        nextType === 'alias'
          ? 'No eligible canonical domains are available for alias mode.'
          : 'No eligible domains are available for Auth via mode.'
      );
      return;
    }

    await saveDomainRouting(
      domain,
      {
        aliasTargetHost: nextType === 'alias' ? nextTarget : null,
        authProviderHost: nextType === 'auth_via' ? nextTarget : null
      },
      'Domain type updated.'
    );
  }

  async function handleChangeDomainTypeTarget(
    domain: ManagedDomainRecord,
    targetHost: string | null
  ) {
    const domainRoutingType = getDomainRoutingType(domain);
    if (domainRoutingType === 'canonical') {
      return;
    }

    const nextTarget = targetHost ?? null;
    const currentTarget =
      domainRoutingType === 'alias' ? domain.aliasTargetHost : domain.authProviderHost;
    if (nextTarget === currentTarget) {
      return;
    }

    await saveDomainRouting(
      domain,
      {
        aliasTargetHost: domainRoutingType === 'alias' ? nextTarget : null,
        authProviderHost: domainRoutingType === 'auth_via' ? nextTarget : null
      },
      domainRoutingType === 'alias' ? 'Alias target updated.' : 'Auth via target updated.'
    );
  }

  function handleChangeDomainRootRedirectDraft(host: string, value: string) {
    setDomainRootRedirectDrafts((current) => ({
      ...current,
      [host]: value
    }));
  }

  async function handleSaveDomainRootRedirect(domain: ManagedDomainRecord) {
    const nextRootRedirectSlug = normalizeDomainRootRedirectSlug(
      domainRootRedirectDrafts[domain.host]
    );

    if (nextRootRedirectSlug === normalizeDomainRootRedirectSlug(domain.rootRedirectSlug)) {
      setDomainRootRedirectDrafts((current) => ({
        ...current,
        [domain.host]: nextRootRedirectSlug
      }));
      return;
    }

    setSavingDomainHost(domain.host);
    clearNotification();

    try {
      const response = await updateDomain({
        canonicalHost: domain.host,
        rootRedirectSlug: nextRootRedirectSlug
      });

      applyManagedDomainsState(response.domains);
      setDomains(sortDomainRecordsByHost(response.supportedDomains));
      showNotification('success', 'Default page updated.');
    } catch (updateError) {
      showNotification(
        'error',
        updateError instanceof Error ? updateError.message : 'Unable to update domain.'
      );
    } finally {
      setSavingDomainHost(null);
    }
  }

  if (loading) {
    return (
      <main className="shell">
        <p>Loading...</p>
      </main>
    );
  }

  const canEditLink = (link: LinkRecord) =>
    Boolean(user && link.created_by_email.toLowerCase() === user.email.toLowerCase()) ||
    Boolean(user?.isSuperAdmin);
  const selectedRotationSchedule = selectedLinkConfig?.rotationSchedule ?? null;
  const rotationIntervalMinutes = selectedRotationSchedule?.intervalMinutes ?? 15;
  const rotationCycleMinutes = rotationIntervalMinutes * (selectedRotationSchedule?.destinations.length ?? 0);
  const activeRotationIndex =
    selectedLinkConfig?.scheduleMode === 'rotation' &&
    selectedRotationSchedule &&
    selectedRotationSchedule.destinations.length > 0 &&
    activeScheduleMinute !== null
      ? Math.floor(activeScheduleMinute / rotationIntervalMinutes) %
        selectedRotationSchedule.destinations.length
      : null;
  const activeRotationProgressPercent =
    selectedLinkConfig?.scheduleMode === 'rotation' &&
    selectedRotationSchedule &&
    selectedRotationSchedule.destinations.length > 0 &&
    activeScheduleMinute !== null
      ? ((activeScheduleMinute % rotationIntervalMinutes) / rotationIntervalMinutes) * 100
      : 0;
  const activeRotationRemainingMinutes =
    selectedLinkConfig?.scheduleMode === 'rotation' &&
    selectedRotationSchedule &&
    selectedRotationSchedule.destinations.length > 0 &&
    activeScheduleMinute !== null
      ? Math.max(0, rotationIntervalMinutes - (activeScheduleMinute % rotationIntervalMinutes))
      : 0;
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Admin</p>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {!user ? (
        <section className="panel auth-panel">
          <h2>Sign in</h2>
          {inviteTokenStatus === 'valid' ? (
            <p className="meta-note auth-helper">
              You've received an invite!
            </p>
          ) : inviteTokenStatus === 'invalid' ? (
            <p className="meta-note auth-helper">
              This invitation has already been used or expired.
            </p>
          ) : null}
          {emailCodeEnabled || googleClientId ? (
            <div className="auth-methods">
              <div className="auth-action-row">
                {googleClientId ? (
                  <div className="auth-google">
                    <GoogleLoginButton
                      clientId={googleClientId}
                      onCredential={handleGoogleCredential}
                    />
                  </div>
                ) : null}

                {emailCodeEnabled ? (
                  <button
                    className="ghost-button auth-email-trigger"
                    type="button"
                    onClick={handleOpenEmailSignIn}
                    disabled={requestingEmailCode || verifyingEmailCode}
                  >
                    Email me a code
                  </button>
                ) : null}
              </div>

              {emailCodeEnabled && showEmailSignInForm ? (
                <form
                  className="email-code-form"
                  onSubmit={emailCodeRequested ? handleVerifyEmailCode : handleRequestEmailCode}
                >
                  <label>
                    Email
                    <input
                      ref={emailSignInAddressInputRef}
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@example.com"
                      type="email"
                      value={emailSignInAddress}
                      onChange={(event) => handleEmailSignInAddressChange(event.target.value)}
                      disabled={requestingEmailCode || verifyingEmailCode}
                    />
                  </label>

                  {emailCodeRequested ? (
                    <label>
                      Code
                      <input
                        ref={emailSignInCodeInputRef}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="123456"
                        value={emailSignInCode}
                        onChange={(event) => setEmailSignInCode(event.target.value)}
                        disabled={requestingEmailCode || verifyingEmailCode}
                      />
                    </label>
                  ) : null}

                  <div className="auth-email-actions">
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={requestingEmailCode || verifyingEmailCode}
                    >
                      {emailCodeRequested
                        ? verifyingEmailCode
                          ? 'Signing in...'
                          : 'Sign in with code'
                        : requestingEmailCode
                          ? 'Sending code...'
                          : 'Send code'}
                    </button>

                    <button
                      className="ghost-button"
                      type="button"
                      onClick={
                        emailCodeRequested
                          ? () => {
                              void handleRequestEmailCode();
                            }
                          : handleCancelEmailSignIn
                      }
                      disabled={requestingEmailCode || verifyingEmailCode}
                    >
                      {emailCodeRequested
                        ? requestingEmailCode
                          ? 'Sending...'
                          : 'Send another code'
                        : 'Cancel'}
                    </button>
                  </div>

                  {emailCodeRequested && emailCodeExpiresInMinutes ? (
                    <p className="meta-note auth-helper">
                      {`Enter the 6-digit code we sent. It expires in ${emailCodeExpiresInMinutes} minutes.`}
                    </p>
                  ) : null}
                </form>
              ) : null}
            </div>
          ) : (
            <p>No sign-in method is configured.</p>
          )}
          <p className="meta-note auth-helper">
            <a href="/app-info/privacy-policy" rel="noreferrer" target="_blank">
              Privacy policy
            </a>
          </p>
        </section>
      ) : (
        <>
          <div className="admin-nav-scroll">
            <nav className="admin-nav" aria-label="Admin sections">
              {adminNavItems.map((item) => (
                <Link
                  className={`admin-nav-link${item.isActive ? ' is-active' : ''}`}
                  key={item.to}
                  to={item.to}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          {adminRoute.view === 'links' ? (
            <section className="panel">
              <div className="split">
                <div className="section-heading">
                  <h2>
                    <button
                    aria-expanded={isCreateLinkSectionExpanded}
                    className="section-heading-button page-section-heading-button"
                    type="button"
                    onClick={() => {
                      createLinkSectionTouchedRef.current = true;
                      setIsCreateLinkSectionExpanded((current) => !current);
                    }}
                  >
                      <span
                        aria-hidden="true"
                        className={`section-heading-icon${isCreateLinkSectionExpanded ? ' is-expanded' : ''}`}
                      >
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                        </svg>
                      </span>
                      <span className="section-heading-title">Create a link</span>
                    </button>
                  </h2>
                </div>
                <div className="user-row">
                  <span>{user.email}</span>
                  <button className="ghost-button" onClick={handleLogout} type="button">
                    Log out
                  </button>
                </div>
              </div>
              <div
                aria-hidden={!isCreateLinkSectionExpanded}
                className={`collapsible-section-body create-link-section-body${isCreateLinkSectionExpanded ? ' is-expanded' : ''}`}
              >
                <div className="collapsible-section-body-inner">
                  {creatableDomains.length === 0 ? (
                    <p>You do not currently have access to create links on any configured domain.</p>
                  ) : (
                    <form className="form-grid" onSubmit={handleSubmit}>
                      <label>
                        <span>Host</span>
                        <select
                          value={form.canonicalHost}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, canonicalHost: event.target.value }))
                          }
                        >
                          {creatableDomains.map((domain) => (
                            <option key={domain.host} value={domain.host}>
                              {domain.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>Slug</span>
                        <div className="input-with-action">
                          <input
                            placeholder="docs"
                            required
                            value={form.slug}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, slug: event.target.value }))
                            }
                          />
                          <GenerateSlugButton
                            disabled={!form.canonicalHost || submitting}
                            generating={generatingCreateSlug}
                            onClick={() => void handleGenerateCreateSlug()}
                          />
                        </div>
                      </label>

                      <label className="wide">
                        <span>Destination URL</span>
                        <input
                          placeholder="https://example.com/wiki"
                          required
                          type="text"
                          value={form.destinationUrl}
                          onFocus={() =>
                            handleDestinationInputFocus(form.destinationUrl, (nextValue) =>
                              setForm((current) => ({ ...current, destinationUrl: nextValue }))
                            )
                          }
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              destinationUrl: normalizeDestinationInputValue(event.target.value)
                            }))
                          }
                        />
                        <span className="meta-note destination-variable-hint">
                          <code>{destinationVariableSyntaxExample}</code>
                        </span>
                      </label>

                      <label className="wide">
                        <span>Description</span>
                        <textarea
                          placeholder="What this shortlink is for"
                          rows={3}
                          value={form.description}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, description: event.target.value }))
                          }
                        />
                      </label>

                      <label className="toggle">
                        <input
                          checked={form.internalOnly}
                          type="checkbox"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              internalOnly: event.target.checked
                            }))
                          }
                        />
                        <span>Make link internal only</span>
                      </label>

                      <label className="wide">
                        <span>Initial password</span>
                        <div className="password-input-row">
                          <input
                            autoComplete="new-password"
                            placeholder="Optional password"
                            type={showCreateLinkPassword ? 'text' : 'password'}
                            value={form.password}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, password: event.target.value }))
                            }
                          />
                          <PasswordVisibilityToggle
                            isVisible={showCreateLinkPassword}
                            label={showCreateLinkPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowCreateLinkPassword((current) => !current)}
                          />
                        </div>
                        <span className="meta-note">
                          Leave blank for a normal shortlink. If set, visitors will be prompted
                          for this password when they open the shortlink.
                        </span>
                      </label>

                      <button className="primary-button" disabled={submitting} type="submit">
                        {submitting ? 'Creating...' : 'Create link'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <section className="panel split">
              <div className="section-heading">
                <h2>
                  {isUserDetailPage
                    ? 'User domain access'
                    : isUserVariablesPage
                      ? 'User destination variables'
                      : isGroupDetailPage
                        ? 'Group settings'
                      : isVariablesPage
                        ? 'Destination variables'
                        : isUsersPage
                          ? 'User accounts'
                          : isGroupsPage
                            ? 'Groups'
                            : isInvitesPage
                              ? 'Invites'
                            : isAnalyticsPage
                              ? 'Analytics'
                              : isSetupPage
                              ? 'Setup checklist'
                            : isLinkConfigPage
                              ? 'Link configuration'
                              : isDomainsPage
                                ? 'Supported hosts'
                                : 'Create a link'}
                </h2>
              </div>
              <div className="user-row">
                <span>{user.email}</span>
                <button className="ghost-button" onClick={handleLogout} type="button">
                  Log out
                </button>
              </div>
            </section>
          )}

          {adminRoute.view === 'link-config' ? (
            <section className="panel">
              <Link className="back-link" to="/">
                ← Back to links
              </Link>

              {selectedLinkConfigLoading && !selectedLinkConfig ? (
                <p>Loading link configuration...</p>
              ) : selectedLinkConfig ? (
                <div className="detail-stack">
                  <div className="detail-metadata">
                    <div>
                      <h2>{`${selectedLinkConfig.canonical_host}/${selectedLinkConfig.slug}`}</h2>
                      <button
                        className="table-action-button detail-copy-button"
                        disabled={!selectedLinkShortUrl}
                        type="button"
                        onClick={() =>
                          selectedLinkShortUrl
                            ? void handleCopyShortlink(
                                selectedLinkConfig.id,
                                selectedLinkShortUrl
                              )
                            : undefined
                        }
                      >
                        {copiedLinkId === selectedLinkConfig.id ? 'Shortlink copied' : 'Copy shortlink'}
                      </button>
                    </div>
                    <div className="detail-badges">
                      {selectedLinkConfig.is_disabled ? (
                        <span className="detail-badge">Disabled</span>
                      ) : null}
                      {selectedLinkIsExpired ? <span className="detail-badge">Expired</span> : null}
                      {selectedLinkConfig.is_listed ? (
                        <span className="detail-badge">Listed</span>
                      ) : null}
                      {selectedLinkConfig.requires_tracking_id ? (
                        <span className="detail-badge">Tracking ID required</span>
                      ) : null}
                      {selectedLinkHasPasswordProtection ? (
                        <span className="detail-badge">Password protected</span>
                      ) : null}
                      {selectedLinkConfig.waiting_room_enabled ? (
                        <span className="detail-badge">Waiting room active</span>
                      ) : null}
                      <span className="detail-badge">
                        {selectedLinkConfig.internal_only ? 'Internal' : 'Public'}
                      </span>
                      {selectedLinkConfig.expiresAt && !selectedLinkIsExpired ? (
                        <span className="detail-badge">
                          Expires{' '}
                          {formatExpirationLabel(
                            selectedLinkConfig.expiresAt,
                            selectedLinkConfig.scheduleTimezone
                          )}
                        </span>
                      ) : null}
                      {selectedLinkExpirationCountdown ? (
                        <span className="detail-badge">
                          In {selectedLinkExpirationCountdown}
                        </span>
                      ) : null}
                      <span className="detail-badge">{selectedLinkConfig.usage_count} uses</span>
                    </div>
                  </div>

                  <section className="analytics-section">
                    <div className="analytics-section-header">
                      <h3>Views over time</h3>
                      <div className="table-filter-control">
                        <select
                          aria-label="Link analytics time window"
                          value={selectedLinkAnalyticsTimeWindow}
                          onChange={(event) =>
                            setSelectedLinkAnalyticsTimeWindow(
                              event.target.value as LinkAnalyticsTimeWindow
                            )
                          }
                        >
                          {analyticsTimeWindowOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="meta-note">
                      {selectedLinkAnalyticsLoading && !selectedLinkAnalytics
                        ? 'Loading link analytics...'
                        : selectedLinkAnalyticsError
                          ? selectedLinkAnalyticsError
                          : selectedLinkAnalytics
                            ? selectedLinkAnalyticsTimeWindow === 'all'
                              ? `${formatCount(selectedLinkAnalytics.overview.totalUses)} total uses across the life of this link.`
                              : `${formatCount(selectedLinkAnalytics.overview.totalUses)} uses in ${getAnalyticsWindowLabel(selectedLinkAnalyticsTimeWindow)}.`
                            : 'No analytics are available yet for this link.'}
                    </p>
                    {selectedLinkAnalytics && !selectedLinkAnalyticsError ? (
                      <AnalyticsTimeSeriesChart
                        timeSeries={selectedLinkAnalytics.timeSeries}
                        timeWindow={selectedLinkAnalyticsTimeWindow}
                      />
                    ) : null}
                  </section>

                  <div className="form-grid">
                    <label>
                      <span>Host</span>
                      <select
                        value={selectedLinkConfig.canonical_host}
                        onChange={(event) =>
                          handleLinkConfigChange('canonical_host', event.target.value)
                        }
                      >
                        {linkConfigDomains.map((domain) => (
                          <option key={domain.host} value={domain.host}>
                            {domain.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Slug</span>
                      <div className="input-with-action">
                        <input
                          required
                          value={selectedLinkConfig.slug}
                          onChange={(event) => handleLinkConfigChange('slug', event.target.value)}
                        />
                        <GenerateSlugButton
                          disabled={!selectedLinkConfig.canonical_host || savingLinkConfig}
                          generating={generatingLinkConfigSlug}
                          onClick={() => void handleGenerateSelectedLinkConfigSlug()}
                        />
                      </div>
                    </label>

                    <label className="wide">
                      <div className="field-label-row">
                        <span>
                          {hasScheduledOverrides ? 'Default destination URL' : 'Destination URL'}
                        </span>
                        <span className="meta-note destination-variable-hint is-inline">
                          <code>{destinationVariableSyntaxExample}</code>
                        </span>
                      </div>
                      <input
                        required
                        type="text"
                        value={selectedLinkConfig.destination_url}
                        onFocus={() =>
                          handleDestinationInputFocus(
                            selectedLinkConfig.destination_url,
                            (nextValue) => handleLinkConfigChange('destination_url', nextValue)
                          )
                        }
                        onChange={(event) =>
                          handleLinkConfigChange('destination_url', event.target.value)
                        }
                        />
                      </label>

                    {isDescriptionEditorVisible ||
                    (selectedLinkConfig.description ?? '').trim().length > 0 ? (
                      <label className="wide">
                        <span>Description</span>
                        <textarea
                          placeholder="What this shortlink is for"
                          rows={3}
                          value={selectedLinkConfig.description ?? ''}
                          onBlur={(event) => {
                            if (event.target.value.trim().length === 0) {
                              setIsDescriptionEditorVisible(false);
                            }
                          }}
                          onChange={(event) =>
                            handleLinkConfigChange('description', event.target.value)
                          }
                        />
                      </label>
                    ) : (
                      <button
                        className="description-placeholder-button"
                        type="button"
                        onClick={() => setIsDescriptionEditorVisible(true)}
                      >
                        <span aria-hidden="true" className="description-placeholder-icon">
                          +
                        </span>
                        <span>Description</span>
                      </button>
                    )}

                    <label className="toggle">
                      <input
                        checked={selectedLinkConfig.internal_only}
                        type="checkbox"
                        onChange={(event) =>
                          handleLinkConfigChange('internal_only', event.target.checked)
                        }
                      />
                      <span>Make link internal only</span>
                    </label>

                    {selectedLinkConfig.hasLegacyPasswordPrompt ? (
                      <p className="meta-note wide">
                        This link still has a legacy typed-password prompt configured. Passwords
                        below are additional prompt-based options and are tracked individually.
                      </p>
                    ) : null}

                    {user.isSuperAdmin ? (
                      <label className="toggle">
                        <input
                          checked={selectedLinkConfig.is_listed}
                          type="checkbox"
                          onChange={(event) =>
                            handleLinkConfigChange('is_listed', event.target.checked)
                          }
                        />
                        <span>Show under Listed Links for regular admins</span>
                      </label>
                    ) : null}

                  </div>

                  <section className="collapsible-link-section">
                    <div className="schedule-header">
                      <div className="schedule-header-content">
                        <div>
                          <button
                            aria-expanded={isAvailabilitySectionExpanded}
                            className="section-heading-button"
                            type="button"
                            onClick={() => setIsAvailabilitySectionExpanded((current) => !current)}
                          >
                            <span
                              aria-hidden="true"
                              className={`section-heading-icon${isAvailabilitySectionExpanded ? ' is-expanded' : ''}`}
                            >
                              <svg viewBox="0 0 24 24" focusable="false">
                                <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                              </svg>
                            </span>
                            <span className="section-heading-title">Availability</span>
                          </button>
                          {!isAvailabilitySectionExpanded ? (
                            <p className="meta-note">{collapsedAvailabilitySummary}.</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div
                      aria-hidden={!isAvailabilitySectionExpanded}
                      className={`collapsible-section-body${isAvailabilitySectionExpanded ? ' is-expanded' : ''}`}
                    >
                      <div className="collapsible-section-body-inner">
                        <div className="form-grid">
                          <div className="wide availability-control">
                            <div
                              className="scope-toggle"
                              role="tablist"
                              aria-label="Link availability"
                            >
                              <button
                                aria-selected={selectedLinkAvailabilityMode === 'enabled'}
                                className={`scope-toggle-button${selectedLinkAvailabilityMode === 'enabled' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => handleChangeLinkAvailabilityMode('enabled')}
                              >
                                Enabled
                              </button>
                              <button
                                aria-selected={selectedLinkAvailabilityMode === 'disabled'}
                                className={`scope-toggle-button${selectedLinkAvailabilityMode === 'disabled' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => handleChangeLinkAvailabilityMode('disabled')}
                              >
                                Disabled
                              </button>
                              <button
                                aria-selected={selectedLinkAvailabilityMode === 'expires'}
                                className={`scope-toggle-button${selectedLinkAvailabilityMode === 'expires' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => handleChangeLinkAvailabilityMode('expires')}
                              >
                                Expires
                              </button>
                              <button
                                aria-selected={selectedLinkAvailabilityMode === 'waiting-room'}
                                className={`scope-toggle-button${selectedLinkAvailabilityMode === 'waiting-room' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => handleChangeLinkAvailabilityMode('waiting-room')}
                              >
                                Waiting Room
                              </button>
                            </div>
                          </div>

                          {selectedLinkAvailabilityMode === 'expires' ? (
                            <label className="wide">
                              <span>
                                Expiration - {getTimeZoneLabel(selectedLinkConfig.scheduleTimezone)}
                              </span>
                              <input
                                type="datetime-local"
                                value={formatDateTimeLocalValue(
                                  selectedLinkConfig.expiresAt,
                                  selectedLinkConfig.scheduleTimezone
                                )}
                                onChange={(event) =>
                                  handleLinkConfigChange(
                                    'expiresAt',
                                    parseDateTimeLocalValue(
                                      event.target.value,
                                      selectedLinkConfig.scheduleTimezone
                                    )
                                  )
                                }
                              />
                              {selectedLinkExpirationCountdown ? (
                                <span className="meta-note">
                                  Expires in {selectedLinkExpirationCountdown}.
                                </span>
                              ) : null}
                            </label>
                          ) : null}

                          {showUnavailableDestinationField ? (
                            <label className="wide">
                              <span>Unavailable redirect URL</span>
                              <input
                                placeholder="https://example.com/unavailable"
                                type="text"
                                value={selectedLinkConfig.disabledDestinationUrl ?? ''}
                                onFocus={() =>
                                  handleDestinationInputFocus(
                                    selectedLinkConfig.disabledDestinationUrl ?? '',
                                    (nextValue) =>
                                      handleLinkConfigChange('disabledDestinationUrl', nextValue)
                                  )
                                }
                                onChange={(event) =>
                                  handleLinkConfigChange(
                                    'disabledDestinationUrl',
                                    event.target.value
                                  )
                                }
                              />
                            </label>
                          ) : null}

                          {selectedLinkAvailabilityMode === 'waiting-room' ? (
                            <p className="meta-note wide">
                              Visitors stay on a holding page until you switch this link back to
                              another availability mode. When you release the waiting room, they
                              are sent to the latest destination.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="collapsible-link-section">
                    <div className="schedule-header">
                      <div className="schedule-header-content">
                        <div>
                          <button
                            aria-expanded={isScheduleSectionExpanded}
                            className="section-heading-button"
                            type="button"
                            onClick={() => setIsScheduleSectionExpanded((current) => !current)}
                          >
                            <span
                              aria-hidden="true"
                              className={`section-heading-icon${isScheduleSectionExpanded ? ' is-expanded' : ''}`}
                            >
                              <svg viewBox="0 0 24 24" focusable="false">
                                <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                              </svg>
                            </span>
                            <span className="section-heading-title">Scheduled destinations</span>
                          </button>
                          {isScheduleSectionExpanded ? (
                            selectedLinkConfig.scheduleMode === 'windows' &&
                            hasScheduledOverrides ? (
                              <p className="meta-note">
                                Times use the selected US timezone and cannot overlap. For overnight
                                behavior, split the window into two rows.
                              </p>
                            ) : null
                          ) : (
                            <p className="meta-note">{collapsedScheduleSummary}.</p>
                          )}
                        </div>
                        {isScheduleSectionExpanded ? (
                          <div className="schedule-header-controls">
                            <div className="mode-toggle" role="tablist" aria-label="Schedule type">
                              <button
                                aria-selected={selectedLinkConfig.scheduleMode === 'windows'}
                                className={`mode-toggle-button${selectedLinkConfig.scheduleMode === 'windows' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => handleChangeScheduleMode('windows')}
                              >
                                Windows
                              </button>
                              <button
                                aria-selected={selectedLinkConfig.scheduleMode === 'rotation'}
                                className={`mode-toggle-button${selectedLinkConfig.scheduleMode === 'rotation' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => handleChangeScheduleMode('rotation')}
                              >
                                Rotation
                              </button>
                            </div>
                            {showScheduleTimezoneField ? (
                              <label className="schedule-timezone-field">
                                <select
                                  aria-label="Schedule timezone"
                                  value={selectedLinkConfig.scheduleTimezone}
                                  onChange={(event) =>
                                    handleLinkConfigChange('scheduleTimezone', event.target.value)
                                  }
                                >
                                  {getAvailableTimeZoneOptions(selectedLinkConfig.scheduleTimezone).map(
                                    (option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    )
                                  )}
                                </select>
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="schedule-header-actions">
                        {isScheduleSectionExpanded ? (
                          hasScheduledOverrides ? (
                            <div className="mode-toggle" role="tablist" aria-label="Schedule view">
                              <button
                                aria-selected={scheduleViewMode === 'visual'}
                                className={`mode-toggle-button${scheduleViewMode === 'visual' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => setScheduleViewMode('visual')}
                              >
                                {selectedLinkConfig.scheduleMode === 'rotation'
                                  ? 'Overview'
                                  : 'Timeline'}
                              </button>
                              <button
                                aria-selected={scheduleViewMode === 'edit'}
                                className={`mode-toggle-button${scheduleViewMode === 'edit' ? ' is-active' : ''}`}
                                type="button"
                                onClick={() => setScheduleViewMode('edit')}
                              >
                                Edit
                              </button>
                              {scheduleViewMode === 'edit' ? (
                                <button
                                  className="ghost-button"
                                  type="button"
                                  onClick={
                                    selectedLinkConfig.scheduleMode === 'rotation'
                                      ? handleAddRotationDestination
                                      : handleAddScheduleEntry
                                  }
                                >
                                  {selectedLinkConfig.scheduleMode === 'rotation'
                                    ? 'Add destination'
                                    : 'Add window'}
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <div className="detail-actions">
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={
                                  selectedLinkConfig.scheduleMode === 'rotation'
                                    ? handleAddRotationDestination
                                    : handleAddScheduleEntry
                                }
                              >
                                {selectedLinkConfig.scheduleMode === 'rotation'
                                  ? 'Add destination'
                                  : 'Add window'}
                              </button>
                            </div>
                          )
                        ) : null}
                      </div>
                    </div>

                    <div
                      aria-hidden={!isScheduleSectionExpanded}
                      className={`collapsible-section-body${isScheduleSectionExpanded ? ' is-expanded' : ''}`}
                    >
                      <div className="collapsible-section-body-inner">
                        {selectedLinkConfig.scheduleMode === 'rotation' ? (
                          <div className="rotation-config">
                            <label className="rotation-interval-field">
                              <span>Rotate every (minutes)</span>
                              <input
                                max={1440}
                                min={1}
                                step={1}
                                type="number"
                                value={rotationIntervalMinutes}
                                onChange={(event) =>
                                  handleRotationIntervalChange(
                                    Math.max(1, Number(event.target.value) || 1)
                                  )
                                }
                              />
                            </label>
                            <span className="meta-note">
                              {selectedRotationSchedule?.destinations.length
                                ? `Each cycle lasts ${formatRemainingMinutes(rotationCycleMinutes)} and restarts at 12:00 AM in ${selectedLinkEffectiveScheduleTimezone ?? selectedLinkConfig.scheduleTimezone}.`
                                : `Choose an interval, then add destinations to rotate in order. The cycle restarts at 12:00 AM in ${selectedLinkEffectiveScheduleTimezone ?? selectedLinkConfig.scheduleTimezone}.`}
                            </span>
                          </div>
                        ) : null}

                        {!hasScheduledOverrides ? (
                          <p className="schedule-empty-state">
                            {selectedLinkConfig.scheduleMode === 'rotation'
                              ? 'No rotation destinations configured.'
                              : 'No scheduled overrides configured.'}
                          </p>
                        ) : scheduleViewMode === 'visual' ? (
                          selectedLinkConfig.scheduleMode === 'rotation' ? (
                            <div className="schedule-static">
                              <div className="rotation-cycle-note">
                                <strong>Cycle length</strong>
                                <span>{formatRemainingMinutes(rotationCycleMinutes)}</span>
                              </div>
                              <div className="schedule-timeline" aria-label="Rotation schedule overview">
                                {scheduleTimeline.map((segment, index) => {
                                  const isActive = activeRotationIndex === index;
                                  const progressPercent = isActive
                                    ? Math.max(0, Math.min(100, activeRotationProgressPercent))
                                    : 0;

                                  return (
                                    <div
                                      key={segment.id}
                                      className={`schedule-segment${isActive ? ' is-active' : ''}`}
                                      style={{ flexGrow: 1 }}
                                      title={`Slot ${index + 1}: ${segment.destinationUrl}`}
                                    >
                                      {isActive ? (
                                        <span
                                          aria-hidden="true"
                                          className="schedule-segment-progress"
                                          style={{ width: `${progressPercent}%` }}
                                        />
                                      ) : null}
                                      <span className="schedule-segment-label">{`Slot ${index + 1}`}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="schedule-segment-list">
                                {scheduleTimeline.map((segment, index) => {
                                  const isActive = activeRotationIndex === index;
                                  const upcomingOccurrence =
                                    activeScheduleMinute !== null
                                      ? getUpcomingRotationOccurrence(
                                          segment.startMinute,
                                          rotationIntervalMinutes,
                                          rotationCycleMinutes,
                                          activeScheduleMinute
                                        )
                                      : null;
                                  const occurrenceLabel =
                                    formatRotationOccurrenceLabel(upcomingOccurrence);

                                  return (
                                    <div
                                      key={`${segment.id}-detail`}
                                      className={`schedule-segment-item${isActive ? ' is-active' : ''}`}
                                    >
                                      <div className="schedule-segment-header">
                                        <strong>
                                          {occurrenceLabel
                                            ? `Slot ${index + 1} · ${occurrenceLabel}`
                                            : `Slot ${index + 1}`}
                                        </strong>
                                        <span className="schedule-segment-badge">
                                          {upcomingOccurrence?.isCurrent
                                            ? 'Current occurrence'
                                            : 'Next occurrence'}
                                        </span>
                                      </div>
                                      <div className="table-link-cell schedule-destination-link-row">
                                        {getManagedShortlinkReference(segment.destinationUrl, domains) ? (
                                          <button
                                            className="table-link table-link-button truncate"
                                            type="button"
                                            onClick={() =>
                                              void handleOpenManagedDestinationConfig(
                                                segment.destinationUrl
                                              )
                                            }
                                          >
                                            {formatDestinationLabel(segment.destinationUrl)}
                                          </button>
                                        ) : (
                                          <a
                                            className="table-link truncate"
                                            href={segment.destinationUrl}
                                            rel="noreferrer"
                                            target="_blank"
                                          >
                                            {formatDestinationLabel(segment.destinationUrl)}
                                          </a>
                                        )}
                                        <a
                                          aria-label="Open destination in new tab"
                                          className="table-icon-link table-external-link"
                                          href={segment.destinationUrl}
                                          rel="noreferrer"
                                          target="_blank"
                                          title="Open destination in new tab"
                                        >
                                          ↗
                                        </a>
                                      </div>
                                      {isActive ? (
                                        <div className="meta-note">
                                          Active now ·{' '}
                                          {formatRemainingMinutes(activeRotationRemainingMinutes)}{' '}
                                          remaining
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="schedule-static">
                              <div className="schedule-axis" aria-hidden="true">
                                <span>12 AM</span>
                                <span>6 AM</span>
                                <span>12 PM</span>
                                <span>6 PM</span>
                                <span>12 AM</span>
                              </div>
                              <div className="schedule-timeline" aria-label="Daily schedule timeline">
                                {scheduleTimeline.map((segment) => {
                                  const duration = Math.max(
                                    1,
                                    segment.endMinute - segment.startMinute
                                  );
                                  const isActive =
                                    activeScheduleMinute !== null &&
                                    segment.startMinute <= activeScheduleMinute &&
                                    segment.endMinute > activeScheduleMinute;
                                  const progressPercent = isActive
                                    ? Math.max(
                                        0,
                                        Math.min(
                                          100,
                                          getScheduleSegmentProgressPercent(
                                            segment.startMinute,
                                            segment.endMinute,
                                            activeScheduleMinute
                                          )
                                        )
                                      )
                                    : 0;

                                  return (
                                    <div
                                      key={segment.id}
                                      className={`schedule-segment${segment.isDefault ? ' is-default' : ''}${isActive ? ' is-active' : ''}`}
                                      style={{ flexGrow: duration }}
                                      title={`${formatScheduleMinute(segment.startMinute)} - ${formatScheduleMinute(segment.endMinute)}: ${segment.destinationUrl}`}
                                    >
                                      {isActive ? (
                                        <span
                                          aria-hidden="true"
                                          className="schedule-segment-progress"
                                          style={{ width: `${progressPercent}%` }}
                                        />
                                      ) : null}
                                      <span className="schedule-segment-label">
                                        {segment.isDefault ? 'Default' : 'Override'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="schedule-segment-list">
                                {scheduleTimeline.map((segment) => {
                                  const isActive =
                                    activeScheduleMinute !== null &&
                                    segment.startMinute <= activeScheduleMinute &&
                                    segment.endMinute > activeScheduleMinute;
                                  const remainingMinutes =
                                    isActive && activeScheduleMinute !== null
                                      ? Math.max(0, segment.endMinute - activeScheduleMinute)
                                      : 0;

                                  return (
                                    <div
                                      key={`${segment.id}-detail`}
                                      className={`schedule-segment-item${segment.isDefault ? ' is-default' : ''}${isActive ? ' is-active' : ''}`}
                                    >
                                      <div className="schedule-segment-header">
                                        <strong>
                                          {formatScheduleMinute(segment.startMinute)} -{' '}
                                          {formatScheduleMinute(segment.endMinute)}
                                        </strong>
                                        <span className="schedule-segment-badge">
                                          {segment.isDefault
                                            ? 'Default destination'
                                            : 'Scheduled override'}
                                        </span>
                                      </div>
                                      <div className="table-link-cell schedule-destination-link-row">
                                        {getManagedShortlinkReference(segment.destinationUrl, domains) ? (
                                          <button
                                            className="table-link table-link-button truncate"
                                            type="button"
                                            onClick={() =>
                                              void handleOpenManagedDestinationConfig(
                                                segment.destinationUrl
                                              )
                                            }
                                          >
                                            {formatDestinationLabel(segment.destinationUrl)}
                                          </button>
                                        ) : (
                                          <a
                                            className="table-link truncate"
                                            href={segment.destinationUrl}
                                            rel="noreferrer"
                                            target="_blank"
                                          >
                                            {formatDestinationLabel(segment.destinationUrl)}
                                          </a>
                                        )}
                                        <a
                                          aria-label="Open destination in new tab"
                                          className="table-icon-link table-external-link"
                                          href={segment.destinationUrl}
                                          rel="noreferrer"
                                          target="_blank"
                                          title="Open destination in new tab"
                                        >
                                          ↗
                                        </a>
                                      </div>
                                      {isActive ? (
                                        <div className="meta-note">
                                          Active now · {formatRemainingMinutes(remainingMinutes)}{' '}
                                          remaining
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )
                        ) : selectedLinkConfig.scheduleMode === 'rotation' ? (
                          <div className="schedule-list">
                            {selectedRotationSchedule?.destinations.map((destination, index) => (
                              <div className="schedule-card rotation-card" key={destination.id}>
                                <div className="rotation-slot-label">{`Slot ${index + 1}`}</div>
                                <label className="wide">
                                  <span>Destination URL</span>
                                  <input
                                    placeholder="https://example.com/"
                                    required
                                    type="text"
                                    value={destination.destinationUrl}
                                    onFocus={() =>
                                      handleDestinationInputFocus(
                                        destination.destinationUrl,
                                        (nextValue) =>
                                          handleRotationDestinationChange(
                                            destination.id,
                                            nextValue
                                          )
                                      )
                                    }
                                    onChange={(event) =>
                                      handleRotationDestinationChange(
                                        destination.id,
                                        event.target.value
                                      )
                                    }
                                  />
                                </label>
                                <div className="schedule-actions rotation-actions">
                                  <button
                                    className="table-action-button"
                                    disabled={index === 0}
                                    type="button"
                                    onClick={() => handleMoveRotationDestination(destination.id, -1)}
                                  >
                                    Up
                                  </button>
                                  <button
                                    className="table-action-button"
                                    disabled={
                                      index ===
                                      (selectedRotationSchedule?.destinations.length ?? 1) - 1
                                    }
                                    type="button"
                                    onClick={() => handleMoveRotationDestination(destination.id, 1)}
                                  >
                                    Down
                                  </button>
                                  <button
                                    className="table-action-button"
                                    type="button"
                                    onClick={() => handleRemoveRotationDestination(destination.id)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="schedule-list">
                            {selectedLinkConfig.schedules.map((schedule) => (
                              <div className="schedule-card" key={schedule.id}>
                                <label>
                                  <span>Start</span>
                                  <input
                                    inputMode="numeric"
                                    pattern="^([01]\\d|2[0-3]):[0-5]\\d$"
                                    placeholder="09:00"
                                    value={schedule.startTime}
                                    onChange={(event) =>
                                      handleScheduleEntryChange(
                                        schedule.id,
                                        'startTime',
                                        event.target.value
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  <span>End</span>
                                  <input
                                    inputMode="numeric"
                                    pattern="^(?:([01]\\d|2[0-3]):[0-5]\\d|24:00)$"
                                    placeholder="17:00"
                                    value={schedule.endTime}
                                    onChange={(event) =>
                                      handleScheduleEntryChange(
                                        schedule.id,
                                        'endTime',
                                        event.target.value
                                      )
                                    }
                                  />
                                </label>
                                <label className="wide">
                                  <span>Destination URL</span>
                                  <input
                                    placeholder="https://example.com/"
                                    required
                                    type="text"
                                    value={schedule.destinationUrl}
                                    onFocus={() =>
                                      handleDestinationInputFocus(
                                        schedule.destinationUrl,
                                        (nextValue) =>
                                          handleScheduleEntryChange(
                                            schedule.id,
                                            'destinationUrl',
                                            nextValue
                                          )
                                      )
                                    }
                                    onChange={(event) =>
                                      handleScheduleEntryChange(
                                        schedule.id,
                                        'destinationUrl',
                                        event.target.value
                                      )
                                    }
                                  />
                                </label>
                                <div className="schedule-actions">
                                  <button
                                    className="table-action-button"
                                    type="button"
                                    onClick={() => handleRemoveScheduleEntry(schedule.id)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="collapsible-link-section">
                    <div className="schedule-header">
                      <div className="schedule-header-content">
                        <div>
                          <button
                            aria-expanded={isTrackedLinksSectionExpanded}
                            className="section-heading-button"
                            type="button"
                            onClick={() => setIsTrackedLinksSectionExpanded((current) => !current)}
                          >
                            <span
                              aria-hidden="true"
                              className={`section-heading-icon${isTrackedLinksSectionExpanded ? ' is-expanded' : ''}`}
                            >
                              <svg viewBox="0 0 24 24" focusable="false">
                                <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                              </svg>
                            </span>
                            <span className="section-heading-title">Tagged links</span>
                          </button>
                          {!isTrackedLinksSectionExpanded ? (
                            <p className="meta-note">{collapsedTrackedLinksSummary}.</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div
                      aria-hidden={!isTrackedLinksSectionExpanded}
                      className={`collapsible-section-body${isTrackedLinksSectionExpanded ? ' is-expanded' : ''}`}
                    >
                      <div className="collapsible-section-body-inner">
                        <div className="subtracker-add-controls">
                          <input
                            className="subtracker-add-input"
                            placeholder="New tagged link name"
                            value={newSubtrackerName}
                            onChange={(event) => setNewSubtrackerName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !addingSubtracker) {
                                event.preventDefault();
                                void handleCreateSubtracker();
                              }
                            }}
                          />
                          <button
                            className="table-action-button"
                            disabled={addingSubtracker || newSubtrackerName.trim().length === 0}
                            type="button"
                            onClick={() => void handleCreateSubtracker()}
                          >
                            {addingSubtracker ? 'Adding...' : 'Add tagged link'}
                          </button>
                        </div>

                        {selectedLinkConfig.subtrackers.length === 0 ? (
                          <p className="meta-note subtracker-empty-note">
                            No tagged variants yet. Add one to generate a separate tagged URL for
                            this shortlink.
                          </p>
                        ) : (
                          <div className="table-wrap">
                            <table className="subtracker-table">
                              <colgroup>
                                <col className="subtracker-column-name" />
                                <col className="subtracker-column-main" />
                                <col className="subtracker-column-uses" />
                                <col className="subtracker-column-actions" />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>ID</th>
                                  <th>Uses</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedSelectedLinkSubtrackers.map((subtracker) => {
                                  const trackedShortUrl = getTrackedShortUrl(
                                    selectedLinkConfig.canonical_host,
                                    selectedLinkConfig.slug,
                                    subtracker.trackingId
                                  );
                                  const isToggling = togglingSubtrackerId === subtracker.id;
                                  const isCopied = copiedTrackedSubtrackerId === subtracker.id;
                                  const isEditing = editingSubtrackerId === String(subtracker.id);

                                  return (
                                    <tr
                                      key={subtracker.id}
                                      className={subtracker.isDisabled ? 'subtracker-row is-disabled' : 'subtracker-row'}
                                    >
                                      <td className="subtracker-name-cell">
                                        <div className="subtracker-name-field">
                                          {subtracker.isDisabled ? (
                                            <InlineInfoTooltip
                                              label="Tagged link disabled. Visits fall back to the main shortlink only."
                                              message="Disabled. Visits fall back to the main shortlink only."
                                            />
                                          ) : (
                                            <InlineInfoTooltipSpacer />
                                          )}
                                          {isEditing ? (
                                            <input
                                              aria-label={`Tagged link name for ${subtracker.trackingId || 'new tagged link'}`}
                                              className="subtracker-name-input"
                                              placeholder="Newsletter footer"
                                              value={subtracker.name}
                                              onChange={(event) =>
                                                handleSubtrackerChange(
                                                  subtracker.id,
                                                  'name',
                                                  event.target.value
                                                )
                                              }
                                            />
                                          ) : (
                                            <span
                                              className={`subtracker-static-value${subtracker.name.trim() ? '' : ' is-empty'}`}
                                              title={subtracker.name.trim() || undefined}
                                            >
                                              {getStaticFieldDisplayValue(subtracker.name)}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td>
                                        <div className="table-link-cell">
                                          <span className="table-link truncate subtracker-url-text">
                                            {subtracker.trackingId}
                                          </span>
                                        </div>
                                      </td>
                                      <td>{formatCount(subtracker.usageCount)}</td>
                                      <td>
                                        <div className="table-action-group">
                                          <button
                                            aria-label={isCopied ? 'Tagged link copied' : 'Copy tagged link'}
                                            className="table-icon-button"
                                            disabled={!trackedShortUrl || subtracker.isDisabled || isToggling}
                                            title={isCopied ? 'Tagged link copied' : 'Copy tagged link'}
                                            type="button"
                                            onClick={() =>
                                              trackedShortUrl
                                                ? void handleCopyTrackedShortlink(
                                                    String(subtracker.id),
                                                    trackedShortUrl
                                                  )
                                                : undefined
                                            }
                                          >
                                            {isCopied ? '✓' : '⧉'}
                                          </button>
                                          <button
                                            aria-label={isEditing ? 'Done editing tagged link' : 'Edit tagged link'}
                                            className="table-icon-button"
                                            disabled={isToggling}
                                            title={isEditing ? 'Done editing tagged link' : 'Edit tagged link'}
                                            type="button"
                                            onClick={() => handleToggleSubtrackerEditing(subtracker.id)}
                                          >
                                            {isEditing ? '✓' : '✎'}
                                          </button>
                                          <button
                                            aria-label={
                                              subtracker.isDisabled
                                                ? 'Enable tagged link'
                                                : 'Disable tagged link'
                                            }
                                            className={
                                              subtracker.isDisabled
                                                ? 'table-icon-button'
                                                : 'table-icon-button is-warning'
                                            }
                                            title={
                                              subtracker.isDisabled
                                                ? 'Enable tagged link'
                                                : 'Disable tagged link'
                                            }
                                            type="button"
                                            disabled={isToggling}
                                            onClick={() =>
                                              void handleToggleSubtrackerDisabled(
                                                subtracker.id,
                                                !subtracker.isDisabled
                                              )
                                            }
                                          >
                                            {isToggling ? '…' : subtracker.isDisabled ? '▶' : '⏸'}
                                          </button>
                                          <button
                                            aria-label="Delete tagged link"
                                            className="table-icon-button is-danger"
                                            disabled={isToggling}
                                            title="Delete tagged link"
                                            type="button"
                                            onClick={() => handleDeleteSubtracker(subtracker.id)}
                                          >
                                            🗑
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <label className="toggle subtracker-require-toggle">
                          <input
                            checked={selectedLinkConfig.requires_tracking_id}
                            type="checkbox"
                            onChange={(event) =>
                              handleLinkConfigChange('requires_tracking_id', event.target.checked)
                            }
                          />
                          <span>Require a tag to use this link</span>
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className="collapsible-link-section">
                    <div className="schedule-header">
                      <div className="schedule-header-content">
                        <div>
                          <button
                            aria-expanded={isPasswordLinksSectionExpanded}
                            className="section-heading-button"
                            type="button"
                            onClick={() =>
                              setIsPasswordLinksSectionExpanded((current) => !current)
                            }
                          >
                            <span
                              aria-hidden="true"
                              className={`section-heading-icon${isPasswordLinksSectionExpanded ? ' is-expanded' : ''}`}
                            >
                              <svg viewBox="0 0 24 24" focusable="false">
                                <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                              </svg>
                            </span>
                            <span className="section-heading-title">Passwords</span>
                          </button>
                          {!isPasswordLinksSectionExpanded ? (
                            <p className="meta-note">{collapsedPasswordsSummary}.</p>
                          ) : (
                            <div>
                              <p className="meta-note section-helper-note">
                                Visitors will be required to enter one of these passwords before
                                being redirected to the destination.
                              </p>
                              <label className="toggle">
                                <input
                                  checked={selectedLinkConfig.rememberPasswordAccess}
                                  type="checkbox"
                                  onChange={(event) =>
                                    handleLinkConfigChange(
                                      'rememberPasswordAccess',
                                      event.target.checked
                                    )
                                  }
                                />
                                <span>Remember visitors with a cookie for 7 days</span>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      aria-hidden={!isPasswordLinksSectionExpanded}
                      className={`collapsible-section-body${isPasswordLinksSectionExpanded ? ' is-expanded' : ''}`}
                    >
                      <div className="collapsible-section-body-inner">
                        <div className="subtracker-add-controls">
                          <input
                            className="subtracker-add-input"
                            placeholder="New password label"
                            value={newPasswordName}
                            onChange={(event) => setNewPasswordName(event.target.value)}
                          />
                          <div className="password-input-row subtracker-add-input">
                            <input
                              autoComplete="new-password"
                              placeholder="Password"
                              type={showNewPasswordValue ? 'text' : 'password'}
                              value={newPasswordValue}
                              onChange={(event) => setNewPasswordValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !addingPassword) {
                                  event.preventDefault();
                                  void handleCreatePassword();
                                }
                              }}
                            />
                            <PasswordVisibilityToggle
                              isVisible={showNewPasswordValue}
                              label={showNewPasswordValue ? 'Hide password' : 'Show password'}
                              onClick={() => setShowNewPasswordValue((current) => !current)}
                            />
                          </div>
                          <button
                            className="table-action-button"
                            disabled={
                              addingPassword ||
                              newPasswordName.trim().length === 0 ||
                              newPasswordValue.trim().length === 0
                            }
                            type="button"
                            onClick={() => void handleCreatePassword()}
                          >
                            {addingPassword ? 'Adding...' : 'Add password'}
                          </button>
                        </div>

                        {selectedLinkConfig.passwords.length === 0 ? (
                          <p className="meta-note subtracker-empty-note">
                            No passwords yet. Add one to require a password before the link opens.
                          </p>
                        ) : (
                          <div className="table-wrap">
                            <table className="subtracker-table">
                              <colgroup>
                                <col className="subtracker-column-name" />
                                <col className="subtracker-column-main" />
                                <col className="subtracker-column-uses" />
                                <col className="subtracker-column-actions" />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Password</th>
                                  <th>Uses</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedSelectedLinkPasswords.map((password) => {
                                  const isToggling = togglingPasswordId === password.id;
                                  const isCopied = copiedPasswordId === password.id;
                                  const passwordId = String(password.id);
                                  const isPasswordVisible = visiblePasswordIds.has(passwordId);
                                  const isEditing = editingPasswordId === passwordId;

                                  return (
                                    <tr
                                      key={password.id}
                                      className={password.isDisabled ? 'subtracker-row is-disabled' : 'subtracker-row'}
                                    >
                                      <td className="subtracker-name-cell">
                                        <div className="subtracker-name-field">
                                          {password.isDisabled ? (
                                            <InlineInfoTooltip
                                              label="Password disabled. This password no longer grants access to the link."
                                              message="Disabled. This password no longer grants access to the link."
                                            />
                                          ) : (
                                            <InlineInfoTooltipSpacer />
                                          )}
                                          {isEditing ? (
                                            <input
                                              aria-label={`Password name for ${password.password || 'new password'}`}
                                              className="subtracker-name-input"
                                              placeholder="Partner portal"
                                              value={password.name}
                                              onChange={(event) =>
                                                handlePasswordChange(
                                                  password.id,
                                                  'name',
                                                  event.target.value
                                                )
                                              }
                                            />
                                          ) : (
                                            <span
                                              className={`subtracker-static-value${password.name.trim() ? '' : ' is-empty'}`}
                                              title={password.name.trim() || undefined}
                                            >
                                              {getStaticFieldDisplayValue(password.name)}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td>
                                        <div className="table-link-cell subtracker-password-cell">
                                          {isEditing ? (
                                            <input
                                              aria-label={`Password for ${password.name}`}
                                              autoComplete="new-password"
                                              className="subtracker-name-input subtracker-password-input"
                                              placeholder="Partner password"
                                              type={isPasswordVisible ? 'text' : 'password'}
                                              value={password.password}
                                              onChange={(event) =>
                                                handlePasswordChange(
                                                  password.id,
                                                  'password',
                                                  event.target.value
                                                )
                                              }
                                            />
                                          ) : (
                                            <span
                                              className={`subtracker-static-value subtracker-password-static${isPasswordVisible ? '' : ' subtracker-static-secret'}${password.password.trim() ? '' : ' is-empty'}`}
                                            >
                                              {isPasswordVisible
                                                ? getStaticFieldDisplayValue(password.password)
                                                : getMaskedSecretDisplayValue(password.password)}
                                            </span>
                                          )}
                                          <PasswordVisibilityToggle
                                            isVisible={isPasswordVisible}
                                            label={
                                              isPasswordVisible ? 'Hide password' : 'Show password'
                                            }
                                            onClick={() => toggleVisiblePassword(passwordId)}
                                          />
                                          <button
                                            aria-label={isCopied ? 'Password copied' : 'Copy password'}
                                            className="table-icon-button"
                                            disabled={isToggling}
                                            title={isCopied ? 'Password copied' : 'Copy password'}
                                            type="button"
                                            onClick={() =>
                                              void handleCopyPasswordValue(
                                                String(password.id),
                                                password.password
                                              )
                                            }
                                          >
                                            {isCopied ? '✓' : '⧉'}
                                          </button>
                                        </div>
                                      </td>
                                      <td>{formatCount(password.usageCount)}</td>
                                      <td>
                                        <div className="table-action-group">
                                          <button
                                            aria-label={isEditing ? 'Done editing password' : 'Edit password'}
                                            className="table-icon-button"
                                            disabled={isToggling}
                                            title={isEditing ? 'Done editing password' : 'Edit password'}
                                            type="button"
                                            onClick={() => handleTogglePasswordEditing(password.id)}
                                          >
                                            {isEditing ? '✓' : '✎'}
                                          </button>
                                          <button
                                            aria-label={
                                              password.isDisabled ? 'Enable password' : 'Disable password'
                                            }
                                            className={
                                              password.isDisabled
                                                ? 'table-icon-button'
                                                : 'table-icon-button is-warning'
                                            }
                                            title={
                                              password.isDisabled ? 'Enable password' : 'Disable password'
                                            }
                                            type="button"
                                            disabled={isToggling}
                                            onClick={() =>
                                              void handleTogglePasswordDisabled(
                                                password.id,
                                                !password.isDisabled
                                              )
                                            }
                                          >
                                            {isToggling ? '…' : password.isDisabled ? '▶' : '⏸'}
                                          </button>
                                          <button
                                            aria-label="Delete password"
                                            className="table-icon-button is-danger"
                                            disabled={isToggling}
                                            title="Delete password"
                                            type="button"
                                            onClick={() => handleDeletePassword(password.id)}
                                          >
                                            🗑
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {linkConfigAutoSaveStatus ? (
                    <div className="detail-actions detail-actions-autosave">
                      <div
                        aria-live="polite"
                        className={`detail-save-status is-${linkConfigAutoSaveStatus.tone}`}
                        role="status"
                      >
                        {linkConfigAutoSaveStatus.message}
                      </div>
                      {linkConfigAutoSaveError &&
                      hasUnsavedLinkConfigChanges &&
                      !savingLinkConfig &&
                      !linkConfigValidationMessage ? (
                        <button
                          className="table-action-button"
                          type="button"
                          onClick={() => void handleSaveLinkConfiguration()}
                        >
                          Retry save
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p>Link not found.</p>
              )}
            </section>
          ) : adminRoute.view === 'user-detail' ? (
            user.isSuperAdmin ? (
              <section className="panel">
                <Link className="back-link" to="/users">
                  ← Back to users
                </Link>

                {selectedUserLoading && !routedSelectedUser ? (
                  <p>Loading user...</p>
                ) : routedSelectedUser ? (
                  <div className="detail-stack">
                    <div className="detail-metadata">
                      <div className="user-cell">
                        {routedSelectedUser.picture_url ? (
                          <img
                            alt=""
                            className="user-avatar"
                            referrerPolicy="no-referrer"
                            src={routedSelectedUser.picture_url}
                          />
                        ) : (
                          <div className="user-avatar user-avatar-fallback" aria-hidden="true">
                            {routedSelectedUser.name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <strong>{routedSelectedUser.name}</strong>
                          <div>{routedSelectedUser.email}</div>
                        </div>
                      </div>
                      <div className="detail-badges">
                        <span className="detail-badge">
                          {routedSelectedUser.isSuperAdmin ? 'Super admin' : 'Standard admin'}
                        </span>
                        <span className="detail-badge">{routedSelectedUser.link_count} links</span>
                      </div>
                    </div>

                    <div>
                      <strong>Groups</strong>
                      <p className="meta-note">
                        Group memberships can grant inherited domain access without assigning that
                        access directly to the user.
                      </p>
                      {routedSelectedUser.groups.length === 0 ? (
                        <p className="meta-note">This user is not in any groups yet.</p>
                      ) : (
                        <div className="detail-badges">
                          {routedSelectedUser.groups.map((group) => (
                            <Link className="detail-badge" key={group.id} to={`/groups/${group.id}`}>
                              {group.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>

                    {routedSelectedUser.inheritedAllowedCanonicalHosts.length > 0 ? (
                      <div>
                        <strong>Inherited domain access</strong>
                        <p className="meta-note">
                          These domains come from the user&apos;s current group memberships.
                        </p>
                        <div className="detail-badges">
                          {routedSelectedUser.inheritedAllowedCanonicalHosts.map((host) => (
                            <span className="detail-badge" key={host}>
                              {host}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <label>
                      <span>Timezone</span>
                      <select
                        value={selectedUserDefaultScheduleTimezone}
                        onChange={(event) => setSelectedUserDefaultScheduleTimezone(event.target.value)}
                      >
                        {getAvailableTimeZoneOptions(selectedUserDefaultScheduleTimezone).map(
                          (option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <div>
                      <strong>Direct domain access</strong>
                      {routedSelectedUser.isSuperAdmin ? (
                        <p className="meta-note">
                          Super admins have access to all configured domains. Direct domain
                          assignments do not affect their current permissions.
                        </p>
                      ) : (
                        <p className="meta-note">
                          Effective access is the union of the direct selections below and any
                          domains inherited from groups.
                        </p>
                      )}
                    </div>

                    {!routedSelectedUser.isSuperAdmin ? (
                      <div className="checkbox-list">
                        {domains.map((domain) => {
                          const checked = selectedUserAllowedHosts.includes(domain.host);

                          return (
                            <label className="checkbox-card" key={domain.host}>
                              <input
                                checked={checked}
                                type="checkbox"
                                onChange={() => handleToggleSelectedUserHost(domain.host)}
                              />
                              <div>
                                <strong>{domain.label}</strong>
                                <div>{domain.host}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="detail-actions">
                      <Link
                        className="table-action-button"
                        to={`/users/${routedSelectedUser.id}/variables`}
                      >
                        Edit destination variables
                      </Link>
                      <button
                        className="primary-button"
                        disabled={savingSelectedUser}
                        type="button"
                        onClick={() => void handleSaveSelectedUserDomainAccess()}
                      >
                        {savingSelectedUser ? 'Saving...' : 'Save settings'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>User not found.</p>
                )}
              </section>
            ) : (
              <section className="panel">
                <h2>User domain access</h2>
                <p>Super admin access is required to view this page.</p>
              </section>
            )
          ) : adminRoute.view === 'group-detail' ? (
            user.isSuperAdmin ? (
              <section className="panel">
                <Link className="back-link" to="/groups">
                  ← Back to groups
                </Link>

                {selectedGroupLoading && !selectedGroup ? (
                  <p>Loading group...</p>
                ) : selectedGroup ? (
                  <div className="detail-stack">
                    <div className="detail-metadata">
                      <div>
                        <strong>{selectedGroup.name}</strong>
                        <div>Group access applies to every current member.</div>
                      </div>
                      <div className="detail-badges">
                        <span className="detail-badge">
                          {selectedGroup.member_count} member
                          {selectedGroup.member_count === 1 ? '' : 's'}
                        </span>
                        <span className="detail-badge">
                          {selectedGroup.domain_count} domain
                          {selectedGroup.domain_count === 1 ? '' : 's'}
                        </span>
                        <span className="detail-badge">
                          {selectedGroup.domain_administration_hosts.length} admin host
                          {selectedGroup.domain_administration_hosts.length === 1 ? '' : 's'}
                        </span>
                        <span className="detail-badge">
                          {selectedGroup.auto_member_email_domains.length} auto email domain
                          {selectedGroup.auto_member_email_domains.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>

                    <label>
                      <span>Group name</span>
                      <input
                        value={selectedGroupName}
                        onChange={(event) => setSelectedGroupName(event.target.value)}
                      />
                    </label>

                    <div>
                      <strong>Members</strong>
                      <p className="meta-note">
                        Users in this group inherit the group&apos;s domain access automatically.
                      </p>
                    </div>

                    {usersLoading && groupMemberOptions.length === 0 ? (
                      <p>Loading users...</p>
                    ) : (
                      <div className="checkbox-list">
                        {groupMemberOptions.map((account) => {
                          const checked = selectedGroupMemberUserIds.includes(account.id);

                          return (
                            <label className="checkbox-card" key={account.id}>
                              <input
                                checked={checked}
                                type="checkbox"
                                onChange={() => handleToggleSelectedGroupMemberUserId(account.id)}
                              />
                              <div>
                                <strong>{account.name}</strong>
                                <div>{account.email}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    <div>
                      <strong>Automatic member email domains</strong>
                      <p className="meta-note">
                        Enter one domain per line. Only future matching users are added when they
                        first register. Existing users are not backfilled.
                      </p>
                    </div>

                    <label>
                      <span>Email domains</span>
                      <textarea
                        placeholder={'team.example.com\nexample.org'}
                        rows={4}
                        value={selectedGroupAutoMemberEmailDomainsText}
                        onChange={(event) =>
                          setSelectedGroupAutoMemberEmailDomainsText(event.target.value)
                        }
                      />
                    </label>

                    <div>
                      <strong>Domain access</strong>
                      <p className="meta-note">
                        Grant domains here to make them available to every member of the group.
                      </p>
                    </div>

                    <div className="checkbox-list">
                      {domains.map((domain) => {
                        const checked = selectedGroupAllowedHosts.includes(domain.host);

                        return (
                          <label className="checkbox-card" key={domain.host}>
                            <input
                              checked={checked}
                              type="checkbox"
                              onChange={() => handleToggleSelectedGroupHost(domain.host)}
                            />
                            <div>
                              <strong>{domain.label}</strong>
                              <div>{domain.host}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <div>
                      <strong>Domain administration</strong>
                      <p className="meta-note">
                        Members with these hosts can see the Domains tab and edit the default page
                        and type for them. Default domain status stays super-admin-only, and current
                        default domains remain read-only unless the person is a super admin.
                      </p>
                    </div>

                    {domainsLoading && managedDomains.length === 0 ? (
                      <p>Loading domains...</p>
                    ) : (
                      <div className="checkbox-list">
                        {managedDomains.map((domain) => {
                          const checked = selectedGroupDomainAdministrationHosts.includes(domain.host);
                          const domainRoutingType = getDomainRoutingType(domain);
                          const routingLabel =
                            domainRoutingType === 'alias'
                              ? `Alias to ${domain.aliasTargetHost}`
                              : domainRoutingType === 'auth_via'
                                ? `Auth via ${domain.authProviderHost}`
                                : 'Canonical';

                          return (
                            <label className="checkbox-card" key={domain.host}>
                              <input
                                checked={checked}
                                type="checkbox"
                                onChange={() =>
                                  handleToggleSelectedGroupDomainAdministrationHost(domain.host)
                                }
                              />
                              <div>
                                <strong>{domain.label}</strong>
                                <div>{domain.host}</div>
                                <div className="meta-note">{routingLabel}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    <div className="detail-actions">
                      <button
                        className="table-action-button"
                        disabled={deletingSelectedGroup || savingSelectedGroup}
                        type="button"
                        onClick={() => void handleDeleteSelectedGroup()}
                      >
                        {deletingSelectedGroup ? 'Deleting...' : 'Delete group'}
                      </button>
                      <button
                        className="primary-button"
                        disabled={savingSelectedGroup || deletingSelectedGroup}
                        type="button"
                        onClick={() => void handleSaveSelectedGroup()}
                      >
                        {savingSelectedGroup ? 'Saving...' : 'Save settings'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>Group not found.</p>
                )}
              </section>
            ) : (
              <section className="panel">
                <h2>Groups</h2>
                <p>Super admin access is required to view this page.</p>
              </section>
            )
          ) : adminRoute.view === 'user-variables' ? (
            user.isSuperAdmin ? (
              <section className="panel">
                <Link className="back-link" to={routedSelectedUser ? `/users/${routedSelectedUser.id}` : '/users'}>
                  ← Back to user settings
                </Link>

                {selectedUserLoading && !routedSelectedUser ? (
                  <p>Loading user...</p>
                ) : routedSelectedUser ? (
                  <div className="detail-stack">
                    <div className="detail-metadata">
                      <div className="user-cell">
                        {routedSelectedUser.picture_url ? (
                          <img
                            alt=""
                            className="user-avatar"
                            referrerPolicy="no-referrer"
                            src={routedSelectedUser.picture_url}
                          />
                        ) : (
                          <div className="user-avatar user-avatar-fallback" aria-hidden="true">
                            {routedSelectedUser.name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <strong>{routedSelectedUser.name}</strong>
                          <div>{routedSelectedUser.email}</div>
                        </div>
                      </div>
                      <div className="detail-badges">
                        <span className="detail-badge">
                          {routedSelectedUser.isSuperAdmin ? 'Super admin' : 'Standard admin'}
                        </span>
                        <span className="detail-badge">{routedSelectedUser.link_count} links</span>
                      </div>
                    </div>

                    <UserLinkVariablesEditor
                      title="Destination variables"
                      description={
                        <>
                          Use <code>{destinationVariableSyntaxExample}</code> in any destination
                          URL to substitute the current viewer&apos;s value. Use{' '}
                          <code>{'{{variable}}'}</code> to require sign-in and a saved value, or{' '}
                          <code>{'{{variable|}}'}</code> to fall back to an empty string.
                        </>
                      }
                      variables={userLinkVariables}
                      loading={userLinkVariablesLoading}
                      saving={savingUserLinkVariables}
                      validationMessage={userLinkVariablesValidationMessage}
                      hasUnsavedChanges={hasUnsavedUserLinkVariableChanges}
                      emptyMessage="No destination variables defined yet for this user."
                      onAdd={handleAddUserLinkVariable}
                      onChange={handleChangeUserLinkVariable}
                      onRemove={handleRemoveUserLinkVariable}
                      onReset={handleResetUserLinkVariables}
                      onSave={handleSaveUserLinkVariables}
                    />
                  </div>
                ) : (
                  <p>User not found.</p>
                )}
              </section>
            ) : (
              <section className="panel">
                <h2>User destination variables</h2>
                <p>Super admin access is required to view this page.</p>
              </section>
            )
          ) : adminRoute.view === 'variables' ? (
            <section className="panel">
              <UserLinkVariablesEditor
                title="Your destination variables"
                description={
                  <>
                    Use <code>{destinationVariableSyntaxExample}</code> in any destination URL to
                    substitute the current viewer&apos;s value. Use <code>{'{{variable}}'}</code>{' '}
                    to require sign-in and a saved value, or <code>{'{{variable|}}'}</code> to
                    fall back to an empty string.
                  </>
                }
                variables={userLinkVariables}
                defaultScheduleTimezone={userLinkVariablesDefaultScheduleTimezone}
                defaultScheduleTimezoneDescription="New scheduled links default to this timezone, and rotation schedules use it."
                loading={userLinkVariablesLoading}
                saving={savingUserLinkVariables}
                validationMessage={userLinkVariablesValidationMessage}
                hasUnsavedChanges={hasUnsavedUserLinkVariableChanges}
                emptyMessage="No destination variables defined yet. Add one to personalize destinations per user."
                onAdd={handleAddUserLinkVariable}
                onChange={handleChangeUserLinkVariable}
                onDefaultScheduleTimezoneChange={setUserLinkVariablesDefaultScheduleTimezone}
                onRemove={handleRemoveUserLinkVariable}
                onReset={handleResetUserLinkVariables}
                onSave={handleSaveUserLinkVariables}
                saveLabel="Save changes"
              />
            </section>
          ) : adminRoute.view === 'analytics' ? (
            <section className="panel">
              <div className="table-toolbar">
                <div>
                  <h2>{isAllAnalyticsView ? 'All link analytics' : 'Your link analytics'}</h2>
                  <p>
                    {analyticsLoading && !analytics
                      ? 'Loading analytics...'
                      : analytics
                        ? analyticsTimeWindow === 'all'
                          ? `${formatCount(analytics.overview.totalUses)} uses across ${formatCount(analytics.overview.totalLinks)} ${isAllAnalyticsView ? 'links' : 'links you can analyze'} all time.`
                          : `${formatCount(analytics.overview.totalUses)} uses across ${formatCount(analytics.overview.totalLinks)} active ${analytics.overview.totalLinks === 1 ? 'link' : 'links'} in ${getAnalyticsWindowLabel(analyticsTimeWindow)}.`
                        : 'No analytics available yet.'}
                  </p>
                </div>
                <div className="table-controls">
                  <div className="table-filter-control">
                    <select
                      aria-label="Analytics time window"
                      value={analyticsTimeWindow}
                      onChange={(event) =>
                        setAnalyticsTimeWindow(event.target.value as LinkAnalyticsTimeWindow)
                      }
                    >
                      {analyticsTimeWindowOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {user.isSuperAdmin ? (
                    <div className="scope-toggle" role="tablist" aria-label="Analytics scope">
                      <button
                        aria-selected={analyticsScope === 'mine'}
                        className={`scope-toggle-button${analyticsScope === 'mine' ? ' is-active' : ''}`}
                        type="button"
                        onClick={() => setAnalyticsScope('mine')}
                      >
                        Your links
                      </button>
                      <button
                        aria-selected={analyticsScope === 'all'}
                        className={`scope-toggle-button${analyticsScope === 'all' ? ' is-active' : ''}`}
                        type="button"
                        onClick={() => setAnalyticsScope('all')}
                      >
                        All links
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {!analytics ? (
                <p>{analyticsLoading ? 'Loading analytics...' : 'No analytics available yet.'}</p>
              ) : (
                <div className="analytics-stack">
                  <div className="analytics-card-grid">
                    <div className="analytics-card">
                      <span className="analytics-label">
                        {analyticsTimeWindow === 'all' ? 'Total uses' : 'Uses in window'}
                      </span>
                      <strong className="analytics-value">
                        {formatCount(analytics.overview.totalUses)}
                      </strong>
                    </div>
                    <div className="analytics-card">
                      <span className="analytics-label">
                        {analyticsTimeWindow === 'all' ? 'Tagged links' : 'Active links'}
                      </span>
                      <strong className="analytics-value">
                        {formatCount(analytics.overview.totalLinks)}
                      </strong>
                    </div>
                  </div>

                  <section className="analytics-section">
                    <div className="analytics-section-header">
                      <h3>Views over time</h3>
                    </div>
                    <AnalyticsTimeSeriesChart
                      timeSeries={analytics.timeSeries}
                      timeWindow={analyticsTimeWindow}
                    />
                  </section>

                  <section className="analytics-section">
                    <div className="analytics-section-header">
                      <h3>Top links</h3>
                    </div>
                    {analytics.topLinks.length === 0 ? (
                      <p>
                        {analyticsTimeWindow === 'all'
                          ? 'No links have recorded any usage yet.'
                          : 'No links have recorded any usage in this window yet.'}
                      </p>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Shortlink</th>
                              <th>Destination</th>
                              <th>Uses</th>
                              {isAllAnalyticsView ? <th>Creator</th> : null}
                            </tr>
                          </thead>
                          <tbody>
                            {analytics.topLinks.map((link) => (
                              <tr key={link.id}>
                                <td>
                                  <div className="table-link-cell analytics-shortlink-row">
                                    <Link className="table-link truncate" to={`/links/${link.id}`}>
                                      {`${link.canonical_host}/${link.slug}`}
                                    </Link>
                                    <a
                                      aria-label="Open shortlink in new tab"
                                      className="table-icon-link table-external-link"
                                      href={`https://${link.canonical_host}/${link.slug}`}
                                      rel="noreferrer"
                                      target="_blank"
                                      title="Open shortlink in new tab"
                                    >
                                      ↗
                                    </a>
                                  </div>
                                </td>
                                <td>
                                  <div className="table-link-cell">
                                    {link.has_schedule ? <span aria-hidden="true">🕒</span> : null}
                                    <a
                                      className="table-link truncate"
                                      href={link.current_destination_url ?? link.destination_url}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      {formatDestinationLabel(
                                        link.current_destination_url ?? link.destination_url
                                      )}
                                    </a>
                                  </div>
                                </td>
                                <td>{formatCount(link.usage_count)}</td>
                                {isAllAnalyticsView ? <td>{link.created_by_email}</td> : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="analytics-section">
                    <div className="analytics-section-header">
                      <h3>Domain performance</h3>
                    </div>
                    {analytics.domainBreakdown.length === 0 ? (
                      <p>
                        {analyticsTimeWindow === 'all'
                          ? 'No link usage has been recorded yet.'
                          : 'No link usage has been recorded in this window yet.'}
                      </p>
                    ) : (
                      <div className="analytics-domain-list">
                        {analytics.domainBreakdown.map((domain) => (
                          <div className="analytics-domain-item" key={domain.canonicalHost}>
                            <div className="analytics-domain-header">
                              <strong>{domain.canonicalHost}</strong>
                              <span>{formatCount(domain.totalUses)} uses</span>
                            </div>
                            <div className="analytics-meter analytics-meter-secondary">
                              <div
                                className="analytics-meter-fill"
                                style={{
                                  width: `${getPercentage(
                                    domain.totalUses,
                                    analytics.overview.totalUses || 1
                                  )}%`
                                }}
                              />
                            </div>
                            <div className="analytics-domain-meta">
                              <span>{formatCount(domain.linkCount)} links</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {user.isSuperAdmin && analyticsScope === 'all' ? (
                    <section className="analytics-section">
                      <div className="analytics-section-header">
                        <h3>Top creators</h3>
                      </div>
                      {analytics.creatorBreakdown.length === 0 ? (
                        <p>
                          {analyticsTimeWindow === 'all'
                            ? 'No creator analytics available yet.'
                            : 'No creator analytics are available in this window yet.'}
                        </p>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Creator</th>
                                <th>Links</th>
                                <th>Total uses</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analytics.creatorBreakdown.map((creator) => (
                                <tr key={creator.email}>
                                  <td>{creator.email}</td>
                                  <td>{formatCount(creator.linkCount)}</td>
                                  <td>{formatCount(creator.totalUses)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  ) : null}
                </div>
              )}
            </section>
          ) : adminRoute.view === 'setup' ? (
            user.isSuperAdmin ? (
              <>
                <section className="panel">
                  <div className="table-toolbar">
                    <div className="table-toolbar-heading">
                      <h2>Setup checklist</h2>
                      <p>
                        {setupChecklistLoading && !setupChecklist
                          ? 'Loading setup checklist...'
                          : setupChecklist
                            ? `${setupChecklist.completedCount} of ${setupChecklist.items.length} checks complete.`
                            : 'Review deploy-time and runtime configuration from one place.'}
                      </p>
                    </div>
                    <button
                      className="ghost-button"
                      disabled={setupChecklistLoading}
                      type="button"
                      onClick={() => void loadSetupChecklist()}
                    >
                      {setupChecklistLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>

                  <p className="meta-note">
                    Environment-backed settings are read-only here. If this page flags a
                    deploy-time warning, update the relevant GitHub variables or secrets and
                    redeploy.
                  </p>

                  {setupChecklistLoading && !setupChecklist ? (
                    <p>Loading setup checklist...</p>
                  ) : setupChecklist ? (
                    <div className="setup-checklist">
                      <div className="detail-badges">
                        <span className="detail-badge">
                          {setupChecklist.completedCount} complete
                        </span>
                        <span className="detail-badge">
                          {setupChecklist.warningCount} warning
                          {setupChecklist.warningCount === 1 ? '' : 's'}
                        </span>
                      </div>

                      {setupChecklist.items.map((item) => (
                        <article
                          key={item.id}
                          className={`setup-checklist-item is-${item.status}`}
                        >
                          <div className="setup-checklist-item-header">
                            <div className="setup-checklist-item-copy">
                              <h3>{item.title}</h3>
                              <p>{item.description}</p>
                            </div>
                            <span
                              className={`detail-badge setup-checklist-status is-${item.status}`}
                            >
                              {item.status === 'complete' ? 'Complete' : 'Needs review'}
                            </span>
                          </div>

                          {item.actionPath && item.actionLabel ? (
                            <div className="setup-checklist-actions">
                              <Link className="ghost-button" to={item.actionPath}>
                                {item.actionLabel}
                              </Link>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p>Unable to load the setup checklist.</p>
                  )}
                </section>

                <section className="panel">
                  <div className="table-toolbar">
                    <div className="table-toolbar-heading">
                      <h2>Privacy policy</h2>
                      <p>
                        Edit the public markdown document shown at{' '}
                        <code>/app-info/privacy-policy</code>.
                      </p>
                    </div>
                    <a
                      className="ghost-button"
                      href="/app-info/privacy-policy"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open public page
                    </a>
                  </div>

                  <p className="meta-note">
                    Saved markdown becomes the live document immediately. Supported formatting
                    includes headings, paragraphs, bullet lists, links, inline code, bold, and
                    italics.
                  </p>

                  {privacyPolicyLoading && !privacyPolicyDocument ? (
                    <p>Loading privacy policy...</p>
                  ) : privacyPolicyLoadError ? (
                    <p>{privacyPolicyLoadError}</p>
                  ) : (
                    <>
                      {privacyPolicyDocument ? (
                        <p className="meta-note">
                          Last updated {new Date(privacyPolicyDocument.updatedAt).toLocaleString()}.
                        </p>
                      ) : null}

                      <label className="privacy-policy-editor">
                        <span>Markdown</span>
                        <textarea
                          rows={20}
                          value={privacyPolicyMarkdown}
                          onChange={(event) => setPrivacyPolicyMarkdown(event.target.value)}
                        />
                      </label>

                      {privacyPolicyValidationMessage ? (
                        <div className="error-banner">{privacyPolicyValidationMessage}</div>
                      ) : null}

                      <div className="detail-actions">
                        <button
                          className="table-action-button"
                          disabled={!hasUnsavedPrivacyPolicyChanges || savingPrivacyPolicy}
                          type="button"
                          onClick={handleResetPrivacyPolicy}
                        >
                          Cancel changes
                        </button>
                        <button
                          className="primary-button"
                          disabled={
                            savingPrivacyPolicy ||
                            !hasUnsavedPrivacyPolicyChanges ||
                            Boolean(privacyPolicyValidationMessage)
                          }
                          type="button"
                          onClick={() => void handleSavePrivacyPolicy()}
                        >
                          {savingPrivacyPolicy ? 'Saving...' : 'Save privacy policy'}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </>
            ) : (
              <section className="panel">
                <h2>Setup checklist</h2>
                <p>Super admin access is required to view this page.</p>
              </section>
            )
          ) : adminRoute.view === 'domains' ? (
            canViewDomainsPage ? (
              <section className="panel">
                <div className="table-toolbar">
                  <div>
                    <h2>Domains</h2>
                    <p>
                      {domainsLoading && managedDomains.length === 0
                        ? 'Loading domains...'
                        : managedDomains.length === 0
                          ? 'No provisioned domains are available.'
                          : `${managedDomains.length} provisioned host${managedDomains.length === 1 ? '' : 's'} available from deployment.`}
                    </p>
                  </div>
                </div>

                <p className="meta-note">
                  <strong>Canonical:</strong> the domain owns its own links.
                  <br />
                  <strong>Auth via:</strong> the domain keeps its own links but routes through
                  another domain for sign-in.
                  <br />
                  <strong>Alias:</strong> the domain points at another domain&apos;s links instead
                  of having its own.
                </p>

                {managedDomains.length === 0 ? (
                  <p>{domainsLoading ? 'Loading domains...' : 'No provisioned domains are available.'}</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Domain</th>
                          <th>Type</th>
                          <th>Domain</th>
                          <th>Default page</th>
                          <th>Links</th>
                          {user.isSuperAdmin ? <th>Default</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {managedDomains.map((domain) => {
                          const domainRoutingType = getDomainRoutingType(domain);
                          const domainIsEditable = canEditManagedDomain(domain);
                          const authProviderTargets = getVisibleDomainRoutingTargets(
                            domains,
                            managedDomains,
                            user,
                            domain.host,
                            domain.aliasTargetHost ?? domain.authProviderHost
                          );
                          const canonicalTargets = user.isSuperAdmin
                            ? authProviderTargets.filter((candidate) => candidate.aliasTargetHost === null)
                            : authProviderTargets;
                          const targetOptions =
                            domainRoutingType === 'alias' ? canonicalTargets : authProviderTargets;
                          const selectedTargetHost =
                            domainRoutingType === 'alias'
                              ? domain.aliasTargetHost
                              : domainRoutingType === 'auth_via'
                                ? domain.authProviderHost
                                : null;
                          const rootRedirectDraft =
                            domainRootRedirectDrafts[domain.host] ?? domain.rootRedirectSlug;
                          const rootRedirectChanged =
                            normalizeDomainRootRedirectSlug(rootRedirectDraft) !==
                            normalizeDomainRootRedirectSlug(domain.rootRedirectSlug);

                          return (
                            <tr key={domain.host}>
                              <td>{domain.label}</td>
                              <td>
                                <select
                                  value={domainRoutingType}
                                  disabled={savingDomainHost === domain.host || !domainIsEditable}
                                  onChange={(event) =>
                                    void handleChangeDomainType(
                                      domain,
                                      event.target.value as DomainRoutingType,
                                      canonicalTargets,
                                      authProviderTargets
                                    )
                                  }
                                >
                                  <option value="canonical">Canonical</option>
                                  <option value="auth_via">Auth via</option>
                                  <option value="alias">Alias</option>
                                </select>
                              </td>
                              <td>
                                {domainRoutingType === 'canonical' ? (
                                  'This domain'
                                ) : (
                                  <select
                                    value={selectedTargetHost ?? ''}
                                    disabled={savingDomainHost === domain.host || !domainIsEditable}
                                    onChange={(event) =>
                                      void handleChangeDomainTypeTarget(
                                        domain,
                                        event.target.value ? event.target.value : null
                                      )
                                    }
                                  >
                                    {targetOptions.map((target) => (
                                      <option key={target.host} value={target.host}>
                                        {target.host}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td>
                                <div className="domain-root-redirect-control">
                                  <span className="domain-root-redirect-prefix">/</span>
                                  <input
                                    className="domain-root-redirect-input"
                                    type="text"
                                    value={rootRedirectDraft}
                                    placeholder="admin"
                                    spellCheck={false}
                                    disabled={savingDomainHost === domain.host || !domainIsEditable}
                                    aria-label={`Default page for ${domain.host}`}
                                    onChange={(event) =>
                                      handleChangeDomainRootRedirectDraft(domain.host, event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key !== 'Enter') {
                                        return;
                                      }

                                      event.preventDefault();
                                      void handleSaveDomainRootRedirect(domain);
                                    }}
                                  />
                                  {rootRedirectChanged ? (
                                    <button
                                      type="button"
                                      className="table-action-button"
                                      disabled={
                                        savingDomainHost === domain.host || !domainIsEditable
                                      }
                                      onClick={() => void handleSaveDomainRootRedirect(domain)}
                                    >
                                      Save
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td>{domain.linkCount}</td>
                              {user.isSuperAdmin ? (
                                <td>
                                  {domain.aliasTargetHost ? (
                                    'N/A'
                                  ) : (
                                    <label className="toggle compact-toggle">
                                      <input
                                        checked={domain.isDefaultForNewAccounts}
                                        disabled={savingDomainHost === domain.host}
                                        type="checkbox"
                                        onChange={() => void handleToggleDomainDefault(domain)}
                                      />
                                      <span>
                                        {domain.isDefaultForNewAccounts ? 'Default' : 'Optional'}
                                      </span>
                                    </label>
                                  )}
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (
              <section className="panel">
                <h2>Domains</h2>
                <p>Domain administration access is required to view this page.</p>
              </section>
            )
          ) : adminRoute.view === 'groups' ? (
            user.isSuperAdmin ? (
              <section className="panel">
                <div className="table-toolbar">
                  <div>
                    <h2>Groups</h2>
                    <p>
                      {groupsLoading && groups.length === 0
                        ? 'Loading groups...'
                        : groups.length === 0
                          ? 'No groups have been created yet.'
                          : `${groups.length} group${groups.length === 1 ? '' : 's'} configured.`}
                    </p>
                  </div>
                </div>

                <div className="subtracker-add-controls">
                  <input
                    className="subtracker-add-input"
                    placeholder="New group name"
                    value={newGroupName}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !creatingGroup) {
                        event.preventDefault();
                        void handleCreateGroup();
                      }
                    }}
                  />
                  <button
                    className="table-action-button"
                    disabled={creatingGroup || newGroupName.trim().length === 0}
                    type="button"
                    onClick={() => void handleCreateGroup()}
                  >
                    {creatingGroup ? 'Creating...' : 'Create group'}
                  </button>
                </div>

                {groups.length === 0 ? (
                  <p>{groupsLoading ? 'Loading groups...' : 'No groups have been created yet.'}</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Members</th>
                          <th>Domains</th>
                          <th>Updated</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => (
                          <tr key={group.id}>
                            <td>
                              <Link className="table-link" to={`/groups/${group.id}`}>
                                {group.name}
                              </Link>
                            </td>
                            <td>{group.member_count}</td>
                            <td>{group.domain_count}</td>
                            <td>{new Date(group.updated_at).toLocaleString()}</td>
                            <td>
                              <div className="table-action-group">
                                <Link
                                  aria-label="Configure group"
                                  className="table-icon-link"
                                  title="Configure group"
                                  to={`/groups/${group.id}`}
                                >
                                  ⚙
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (
              <section className="panel">
                <h2>Groups</h2>
                <p>Super admin access is required to view this page.</p>
              </section>
            )
          ) : adminRoute.view === 'invites' ? (
            user.isSuperAdmin ? (
              <section className="panel">
                <div className="table-toolbar">
                  <div>
                    <h2>Invites</h2>
                    <p>
                      {invitesLoading && invites.length === 0
                        ? 'Loading invites...'
                        : invites.length === 0
                          ? 'No invites have been created yet.'
                          : `${invites.length} invite${invites.length === 1 ? '' : 's'} created.`}
                    </p>
                  </div>
                </div>

                <p className="meta-note">
                  Invite links can be used once to register a new account. If a group is selected,
                  the invited user will join that group during registration. Labels are optional
                  and can be used to track who each invite was sent to.
                </p>

                <div className="subtracker-add-controls">
                  <input
                    className="subtracker-add-input"
                    maxLength={160}
                    placeholder="Label (optional)"
                    type="text"
                    value={newInviteLabel}
                    onChange={(event) => setNewInviteLabel(event.target.value)}
                  />
                  <select
                    className="subtracker-add-input"
                    value={newInviteGroupId}
                    onChange={(event) => setNewInviteGroupId(event.target.value)}
                  >
                    <option value="">No group</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="table-action-button"
                    disabled={creatingInvite}
                    type="button"
                    onClick={() => void handleCreateInvite()}
                  >
                    {creatingInvite ? 'Creating...' : 'Create invite'}
                  </button>
                </div>

                {invites.length === 0 ? (
                  <p>{invitesLoading ? 'Loading invites...' : 'No invites have been created yet.'}</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Label</th>
                          <th>Invite link</th>
                          <th>Group</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((invite) => {
                          const inviteUrl = getRegistrationInviteUrl(invite.token);
                          const isCopied = copiedInviteId === invite.id;

                          return (
                            <tr key={invite.id}>
                              <td>{invite.label ?? '—'}</td>
                              <td>
                                <div className="table-link-cell">
                                  <span className="table-link truncate">{inviteUrl}</span>
                                </div>
                              </td>
                              <td>{invite.groupName ?? '—'}</td>
                              <td>
                                {invite.isUsed ? (
                                  <div className="table-link-stack">
                                    <span>{invite.usedByEmail ?? 'Used'}</span>
                                    <span className="table-link-secondary">
                                      {invite.usedAt
                                        ? new Date(invite.usedAt).toLocaleString()
                                        : 'Used'}
                                    </span>
                                  </div>
                                ) : (
                                  'Unused'
                                )}
                              </td>
                              <td>{new Date(invite.createdAt).toLocaleString()}</td>
                              <td>
                                <div className="table-action-group">
                                  <button
                                    aria-label={isCopied ? 'Invite copied' : 'Copy invite link'}
                                    className="table-icon-button"
                                    title={isCopied ? 'Invite copied' : 'Copy invite link'}
                                    type="button"
                                    onClick={() =>
                                      void handleCopyInviteLink(invite.id, invite.token)
                                    }
                                  >
                                    {isCopied ? '✓' : '⧉'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (
              <section className="panel">
                <h2>Invites</h2>
                <p>Super admin access is required to view this page.</p>
              </section>
            )
          ) : adminRoute.view === 'users' ? (
            user.isSuperAdmin ? (
              <section className="panel">
                <div className="table-toolbar">
                  <div>
                    <h2>Users</h2>
                    <p>
                      {usersLoading && users.length === 0
                        ? 'Loading users...'
                        : users.length === 0
                          ? 'No users have signed in yet.'
                          : `${users.length} user${users.length === 1 ? '' : 's'} found.`}
                    </p>
                  </div>
                </div>

                {users.length === 0 ? (
                  <p>{usersLoading ? 'Loading users...' : 'No users have signed in yet.'}</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Links</th>
                          <th>Updated</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((account) => (
                          <tr key={account.id}>
                            <td>
                              <div className="user-cell">
                                {account.picture_url ? (
                                  <img
                                    alt=""
                                    className="user-avatar"
                                    referrerPolicy="no-referrer"
                                    src={account.picture_url}
                                  />
                                ) : (
                                  <div className="user-avatar user-avatar-fallback" aria-hidden="true">
                                    {account.name.slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                                <Link className="table-link" to={`/users/${account.id}`}>
                                  {account.name}
                                </Link>
                              </div>
                            </td>
                            <td>{account.email}</td>
                            <td>{account.isSuperAdmin ? 'Super admin' : 'Standard admin'}</td>
                            <td>{account.link_count}</td>
                            <td>{new Date(account.updated_at).toLocaleString()}</td>
                            <td>
                              <div className="table-action-group">
                                <Link
                                  aria-label="Configure user"
                                  className="table-icon-link"
                                  title="Configure user"
                                  to={`/users/${account.id}`}
                                >
                                  ⚙
                                </Link>
                                <Link
                                  aria-label="Edit destination variables"
                                  className="table-icon-link"
                                  title="Edit destination variables"
                                  to={`/users/${account.id}/variables`}
                                >
                                  V
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (
              <section className="panel">
                <h2>Users</h2>
                <p>Super admin access is required to view this page.</p>
              </section>
            )
          ) : (
            <>
              <section className="panel">
                <div className="table-toolbar">
                  <div className="table-toolbar-heading">
                    <div className="toolbar-dropdown-control">
                      <button
                        aria-expanded={openToolbarDropdown === 'scope'}
                        aria-haspopup="menu"
                        aria-label="Link scope"
                        className={`toolbar-dropdown-button${isDefaultLinkListScope ? ' is-placeholder' : ''}`}
                        type="button"
                        onClick={() =>
                          setOpenToolbarDropdown((current) =>
                            current === 'scope' ? null : 'scope'
                          )
                        }
                      >
                        <span>{selectedLinkListScopeLabel}</span>
                        <span
                          aria-hidden="true"
                          className={`toolbar-dropdown-icon${openToolbarDropdown === 'scope' ? ' is-expanded' : ''}`}
                        >
                          <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                          </svg>
                        </span>
                      </button>
                      {openToolbarDropdown === 'scope' ? (
                        <div className="toolbar-dropdown-menu" role="menu" aria-label="Link scope">
                          <button
                            aria-checked={linkListScope === 'mine'}
                            className={`toolbar-dropdown-item${linkListScope === 'mine' ? ' is-active' : ''}`}
                            role="menuitemradio"
                            type="button"
                            onClick={() => {
                              setCurrentPage(1);
                              setLinkListScope('mine');
                              setOpenToolbarDropdown(null);
                            }}
                          >
                            Your links
                          </button>
                          <button
                            aria-checked={linkListScope === 'listed'}
                            className={`toolbar-dropdown-item${linkListScope === 'listed' ? ' is-active' : ''}`}
                            role="menuitemradio"
                            type="button"
                            onClick={() => {
                              setCurrentPage(1);
                              setLinkListScope('listed');
                              setOpenToolbarDropdown(null);
                            }}
                          >
                            Listed links
                          </button>
                          {user.isSuperAdmin ? (
                            <button
                              aria-checked={linkListScope === 'all'}
                              className={`toolbar-dropdown-item${linkListScope === 'all' ? ' is-active' : ''}`}
                              role="menuitemradio"
                              type="button"
                              onClick={() => {
                                setCurrentPage(1);
                                setLinkListScope('all');
                                setOpenToolbarDropdown(null);
                              }}
                            >
                              All links
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="table-controls">
                    <div
                      className={`table-search-control${isLinkSearchExpanded ? ' is-expanded' : ''}`}
                    >
                      {isLinkSearchExpanded ? (
                        <div className="table-search-input-wrap">
                          <span aria-hidden="true" className="table-search-icon">
                            <svg viewBox="0 0 24 24" focusable="false">
                              <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79L19 20.49 20.49 19 15.5 14Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z" />
                            </svg>
                          </span>
                          <input
                            ref={linkSearchInputRef}
                            aria-label="Search links"
                            className="table-search-input"
                            placeholder="Search links"
                            type="search"
                            value={searchInput}
                            onBlur={(event) => {
                              if (!event.target.value.trim()) {
                                setIsLinkSearchExpanded(false);
                              }
                            }}
                            onChange={(event) => {
                              setCurrentPage(1);
                              setSearchInput(event.target.value);
                            }}
                          />
                        </div>
                      ) : (
                        <button
                          className="table-search-trigger"
                          type="button"
                          onClick={() => {
                            shouldFocusLinkSearchRef.current = true;
                            setIsLinkSearchExpanded(true);
                          }}
                        >
                          <span aria-hidden="true" className="table-search-icon">
                            <svg viewBox="0 0 24 24" focusable="false">
                              <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79L19 20.49 20.49 19 15.5 14Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z" />
                            </svg>
                          </span>
                          <span>Search links</span>
                        </button>
                      )}
                    </div>
                    <div className="table-select-row links-table-select-row">
                      {showLinkListDomainFilter ? (
                        <div className="toolbar-dropdown-control">
                          <button
                            aria-expanded={openToolbarDropdown === 'domain'}
                            aria-haspopup="menu"
                            aria-label="Filter by domain"
                            className={`toolbar-dropdown-button${isDefaultLinkListDomain ? ' is-placeholder' : ''}`}
                            type="button"
                            onClick={() =>
                              setOpenToolbarDropdown((current) =>
                                current === 'domain' ? null : 'domain'
                              )
                            }
                          >
                            <span>{selectedLinkListDomainLabel}</span>
                            <span
                              aria-hidden="true"
                              className={`toolbar-dropdown-icon${openToolbarDropdown === 'domain' ? ' is-expanded' : ''}`}
                            >
                              <svg viewBox="0 0 24 24" focusable="false">
                                <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                              </svg>
                            </span>
                          </button>
                          {openToolbarDropdown === 'domain' ? (
                            <div
                              className="toolbar-dropdown-menu"
                              role="menu"
                              aria-label="Filter by domain"
                            >
                              <button
                                aria-checked={!linkListCanonicalHost}
                                className={`toolbar-dropdown-item${!linkListCanonicalHost ? ' is-active' : ''}`}
                                role="menuitemradio"
                                type="button"
                                onClick={() => {
                                  setCurrentPage(1);
                                  setLinkListCanonicalHost('');
                                  setOpenToolbarDropdown(null);
                                }}
                              >
                                All domains
                              </button>
                              {linkListDomainOptions.map((domain) => (
                                <button
                                  key={domain.host}
                                  aria-checked={linkListCanonicalHost === domain.host}
                                  className={`toolbar-dropdown-item${linkListCanonicalHost === domain.host ? ' is-active' : ''}`}
                                  role="menuitemradio"
                                  type="button"
                                  onClick={() => {
                                    setCurrentPage(1);
                                    setLinkListCanonicalHost(domain.host);
                                    setOpenToolbarDropdown(null);
                                  }}
                                >
                                  {domain.host}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="toolbar-dropdown-control">
                        <button
                          aria-expanded={openToolbarDropdown === 'sort'}
                          aria-haspopup="menu"
                          aria-label="Sort links"
                          className={`toolbar-dropdown-button${isDefaultLinkListSort ? ' is-placeholder' : ''}`}
                          type="button"
                          onClick={() =>
                            setOpenToolbarDropdown((current) =>
                              current === 'sort' ? null : 'sort'
                            )
                          }
                        >
                          <span>{selectedSortOption.label}</span>
                          <span aria-hidden="true" className="toolbar-dropdown-value-indicator">
                            {getLinkSortDirectionIndicator(selectedSortDirection)}
                          </span>
                          <span
                            aria-hidden="true"
                            className={`toolbar-dropdown-icon${openToolbarDropdown === 'sort' ? ' is-expanded' : ''}`}
                          >
                            <svg viewBox="0 0 24 24" focusable="false">
                              <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                            </svg>
                          </span>
                        </button>
                        {openToolbarDropdown === 'sort' ? (
                          <div className="toolbar-dropdown-menu" role="menu" aria-label="Sort links">
                            {linkSortOptions.map((option) => {
                              const isActiveField = selectedSortOption.field === option.field;
                              const nextSortOption = isActiveField
                                ? getLinkSortOptionValue(
                                    option,
                                    selectedSortDirection === 'asc' ? 'desc' : 'asc'
                                  )
                                : option.defaultValue;

                              return (
                                <button
                                  key={option.field}
                                  aria-checked={isActiveField}
                                  className={`toolbar-dropdown-item${isActiveField ? ' is-active' : ''}`}
                                  role="menuitemradio"
                                  type="button"
                                  onClick={() => {
                                    setCurrentPage(1);
                                    setSortOption(nextSortOption);
                                    setOpenToolbarDropdown(null);
                                  }}
                                >
                                  <span className="toolbar-dropdown-item-content">
                                    <span>{option.label}</span>
                                    {isActiveField ? (
                                      <span
                                        aria-hidden="true"
                                        className="toolbar-dropdown-item-trailing"
                                      >
                                        {getLinkSortDirectionIndicator(selectedSortDirection)}
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className="toolbar-dropdown-control">
                        <button
                          aria-expanded={openToolbarDropdown === 'pageSize'}
                          aria-haspopup="menu"
                          aria-label="Page size"
                          className={`toolbar-dropdown-button${isDefaultLinkListPageSize ? ' is-placeholder' : ''}`}
                          type="button"
                          onClick={() =>
                            setOpenToolbarDropdown((current) =>
                              current === 'pageSize' ? null : 'pageSize'
                            )
                          }
                        >
                          <span>{pageSize}</span>
                          <span
                            aria-hidden="true"
                            className={`toolbar-dropdown-icon${openToolbarDropdown === 'pageSize' ? ' is-expanded' : ''}`}
                          >
                            <svg viewBox="0 0 24 24" focusable="false">
                              <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                            </svg>
                          </span>
                        </button>
                        {openToolbarDropdown === 'pageSize' ? (
                          <div className="toolbar-dropdown-menu" role="menu" aria-label="Page size">
                            {pageSizeOptions.map((option) => (
                              <button
                                key={option}
                                aria-checked={pageSize === option}
                                className={`toolbar-dropdown-item${pageSize === option ? ' is-active' : ''}`}
                                role="menuitemradio"
                                type="button"
                                onClick={() => {
                                  setCurrentPage(1);
                                  setPageSize(option);
                                  setOpenToolbarDropdown(null);
                                }}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="pagination-controls">
                      <button
                        className="pagination-link-button"
                        disabled={linksLoading || currentPage <= 1}
                        type="button"
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      >
                        <span aria-hidden="true" className="pagination-link-icon">
                          ‹
                        </span>
                        Previous
                      </button>
                      <span>{`Page ${currentPage} of ${totalPages}`}</span>
                      <button
                        className="pagination-link-button"
                        disabled={linksLoading || currentPage >= totalPages}
                        type="button"
                        onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      >
                        Next
                        <span aria-hidden="true" className="pagination-link-icon">
                          ›
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {links.length === 0 ? (
                  <p>
                    {linksLoading
                      ? 'Loading links...'
                      : searchQuery
                        ? isListedLinksView
                          ? 'No listed links match the current search.'
                          : 'No links match the current search.'
                        : isListedLinksView
                          ? 'No listed links yet.'
                          : 'No links created yet.'}
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Shortlink</th>
                          <th>Destination</th>
                          <th>Uses</th>
                          <th>Visibility</th>
                          {isAllLinksView ? <th>Creator</th> : null}
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {links.map((link) => {
                          const shortPath = `${link.canonical_host}/${link.slug}`;
                          const shortUrl = `https://${shortPath}`;
                          const hasSchedule = Boolean(link.has_schedule);
                          const isExpired = isExpiredAt(link.expires_at);
                          const willExpire = Boolean(link.expires_at) && !isExpired;
                          const description = (link.description ?? '').trim();
                          const displayedDestination =
                            link.current_destination_url ?? link.destination_url;
                          const displayedDestinationLabel = formatDestinationLabel(displayedDestination);
                          const disabledDestinationLabel = link.disabled_destination_url
                            ? formatDestinationLabel(link.disabled_destination_url)
                            : null;
                          const editableDomains = getEditableLinkDomains(domains, user, link.canonical_host);
                          const isEditing = editingLinkId === link.id;
                          const canEditCurrentLink = canEditLink(link);
                          const hasDescription = description.length > 0;
                          const trailingColumnSpan = isAllLinksView ? 4 : 3;

                          return (
                            <Fragment key={link.id}>
                              <tr
                                className={
                                  hasDescription ? 'table-entry-row has-description' : 'table-entry-row'
                                }
                              >
                              <td>
                                {isEditing ? (
                                  <div className="table-edit-grid">
                                    <select
                                      value={editingCanonicalHost}
                                      onChange={(event) => setEditingCanonicalHost(event.target.value)}
                                    >
                                      {editableDomains.map((domain) => (
                                        <option key={domain.host} value={domain.host}>
                                          {domain.label}
                                        </option>
                                      ))}
                                    </select>
                                    <div className="input-with-action">
                                      <input
                                        value={editingSlug}
                                        onChange={(event) => setEditingSlug(event.target.value)}
                                      />
                                      <GenerateSlugButton
                                        disabled={
                                          !editingCanonicalHost || savingLinkId === link.id
                                        }
                                        generating={generatingEditingSlugLinkId === link.id}
                                        onClick={() => void handleGenerateEditingSlug(link.id)}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="table-link-cell">
                                    <button
                                      aria-label={
                                        copiedLinkId === link.id ? 'Shortlink copied' : 'Copy shortlink'
                                      }
                                      className="copy-icon-button"
                                      title={
                                        copiedLinkId === link.id ? 'Shortlink copied' : 'Copy shortlink'
                                      }
                                      type="button"
                                      onClick={() => void handleCopyShortlink(link.id, shortUrl)}
                                    >
                                      {copiedLinkId === link.id ? '✓' : '⧉'}
                                    </button>
                                    {canEditCurrentLink ? (
                                      <Link
                                        className="table-link truncate"
                                        to={`/links/${encodeURIComponent(link.id)}`}
                                      >
                                        {shortPath}
                                      </Link>
                                    ) : (
                                      <span className="table-link truncate">
                                        {shortPath}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td>
                                {isEditing && !hasSchedule ? (
                                  <input
                                    className="table-input"
                                    type="text"
                                    value={editingDestinationUrl}
                                    onFocus={() =>
                                      handleDestinationInputFocus(
                                        editingDestinationUrl,
                                        setEditingDestinationUrl
                                      )
                                    }
                                    onChange={(event) =>
                                      setEditingDestinationUrl(
                                        normalizeDestinationInputValue(event.target.value)
                                      )
                                    }
                                  />
                                ) : (
                                  (link.is_disabled || isExpired) && link.disabled_destination_url ? (
                                    <div className="table-link-cell table-link-secondary">
                                      <span aria-hidden="true">{link.is_disabled ? '⏻' : '⌛'}</span>
                                      <a
                                        className="table-link truncate"
                                        href={link.disabled_destination_url}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        {disabledDestinationLabel}
                                      </a>
                                    </div>
                                  ) : link.is_disabled ? (
                                    <div className="table-link-cell table-link-secondary">
                                      <span aria-hidden="true">⏻</span>
                                      <span className="table-link table-link-disabled-label truncate">
                                        {displayedDestinationLabel}
                                      </span>
                                    </div>
                                  ) : isExpired ? (
                                    <div className="table-link-cell table-link-secondary">
                                      <span aria-hidden="true">⌛</span>
                                      <span className="table-link table-link-disabled-label truncate">
                                        {displayedDestinationLabel}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="table-link-stack">
                                      <div className="table-link-cell">
                                        {hasSchedule ? <span aria-hidden="true">🕒</span> : null}
                                        {willExpire ? (
                                          <span
                                            aria-label={`Expires ${formatExpirationLabel(link.expires_at!, link.schedule_timezone)}`}
                                            title={`Expires ${formatExpirationLabel(link.expires_at!, link.schedule_timezone)}`}
                                          >
                                            ⏳
                                          </span>
                                        ) : null}
                                        <a
                                          className="table-link truncate"
                                          href={displayedDestination}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          {displayedDestinationLabel}
                                        </a>
                                      </div>
                                    </div>
                                  )
                                )}
                              </td>
                              <td>{link.usage_count}</td>
                              <td>
                                {link.is_disabled
                                  ? 'Disabled'
                                  : isExpired
                                    ? 'Expired'
                                    : link.waiting_room_enabled
                                      ? 'Waiting room'
                                    : link.has_password
                                      ? 'Password'
                                    : link.internal_only
                                      ? 'Internal'
                                      : link.is_listed
                                        ? 'Listed'
                                        : 'Public'}
                              </td>
                              {isAllLinksView ? <td>{link.created_by_email}</td> : null}
                              <td>
                                {canEditCurrentLink ? (
                                  <div className="table-action-group">
                                    {isEditing ? (
                                      <>
                                        <button
                                          className="table-action-button is-primary"
                                          disabled={savingLinkId === link.id}
                                          type="button"
                                          onClick={() => void handleSaveEditing(link.id)}
                                        >
                                          {savingLinkId === link.id ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                          className="table-action-button"
                                          disabled={savingLinkId === link.id}
                                          type="button"
                                          onClick={handleCancelEditing}
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          aria-label={hasSchedule ? 'Edit host and slug' : 'Edit link'}
                                          className="table-icon-button"
                                          title={hasSchedule ? 'Edit host and slug' : 'Edit link'}
                                          type="button"
                                          onClick={() => handleStartEditing(link)}
                                        >
                                          ✎
                                        </button>
                                        <div className="table-action-menu">
                                          <button
                                            aria-expanded={openActionMenuLinkId === link.id}
                                            aria-label="More link actions"
                                            className="table-icon-button"
                                            ref={(element) => setActionMenuButtonRef(link.id, element)}
                                            title="More actions"
                                            type="button"
                                            onClick={() => {
                                              setOpenActionMenuLinkId((current) => {
                                                const nextLinkId = current === link.id ? null : link.id;
                                                if (nextLinkId === null) {
                                                  setOpenActionMenuPosition(null);
                                                }
                                                return nextLinkId;
                                              });
                                            }}
                                          >
                                            ☰
                                          </button>
                                          {openActionMenuLinkId === link.id &&
                                          openActionMenuPosition &&
                                          typeof document !== 'undefined'
                                            ? createPortal(
                                                <div
                                                  className="table-action-dropdown is-floating"
                                                  style={openActionMenuPosition}
                                                >
                                                  <button
                                                    className="table-action-menu-item"
                                                    type="button"
                                                    onClick={() => {
                                                      setOpenActionMenuLinkId(null);
                                                      setOpenActionMenuPosition(null);
                                                      navigate(`/links/${encodeURIComponent(link.id)}`);
                                                    }}
                                                  >
                                                    Configure link
                                                  </button>
                                                  <button
                                                    className="table-action-menu-item"
                                                    disabled={togglingLinkInternalId === link.id}
                                                    type="button"
                                                    onClick={() =>
                                                      void handleToggleLinkInternal(link)
                                                    }
                                                  >
                                                    {togglingLinkInternalId === link.id
                                                      ? link.internal_only
                                                        ? 'Making public...'
                                                        : 'Making internal...'
                                                      : link.internal_only
                                                        ? 'Make public'
                                                        : 'Make internal'}
                                                  </button>
                                                  <button
                                                    className="table-action-menu-item"
                                                    disabled={togglingLinkDisabledId === link.id}
                                                    type="button"
                                                    onClick={() =>
                                                      void handleToggleLinkDisabled(link)
                                                    }
                                                  >
                                                    {togglingLinkDisabledId === link.id
                                                      ? link.is_disabled
                                                        ? 'Enabling...'
                                                        : 'Disabling...'
                                                      : link.is_disabled
                                                        ? 'Enable link'
                                                        : 'Disable link'}
                                                  </button>
                                                  <button
                                                    className="table-action-menu-item is-danger"
                                                    disabled={deletingLinkId === link.id}
                                                    type="button"
                                                    onClick={() => void handleDeleteLink(link)}
                                                  >
                                                    {deletingLinkId === link.id
                                                      ? 'Deleting...'
                                                      : 'Delete link'}
                                                  </button>
                                                </div>,
                                                document.body
                                              )
                                            : null}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ) : null}
                              </td>
                              </tr>
                              {hasDescription ? (
                                <tr className="table-description-row">
                                  <td className="table-description-cell" colSpan={2}>
                                    {description}
                                  </td>
                                  <td
                                    aria-hidden="true"
                                    className="table-description-fill"
                                    colSpan={trailingColumnSpan}
                                  />
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {notification ? (
        <div
          aria-live={notification.tone === 'error' ? 'assertive' : 'polite'}
          className={`notification-toast is-${notification.tone}`}
          role={notification.tone === 'error' ? 'alert' : 'status'}
        >
          {notification.message}
        </div>
      ) : null}
    </main>
  );
}
