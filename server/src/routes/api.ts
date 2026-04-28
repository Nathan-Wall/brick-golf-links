import { randomBytes } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import {
  getPrivacyPolicyDocument,
  updatePrivacyPolicyDocument
} from '../db/app-documents.js';
import {
  createCanonicalDomain,
  findDomainHostState,
  setDomainAliasTarget,
  updateDomainAuthProviderHost,
  updateDomainDefaults,
  updateDomainRootRedirectSlug
} from '../db/domains.js';
import {
  createRegistrationInvite,
  listRegistrationInvites
} from '../db/registration-invites.js';
import { getAdminConfig } from '../config/admin-config.js';
import { getAppConfig } from '../config/app-config.js';
import { getAuthConfig } from '../config/auth-config.js';
import { requireAuthenticatedUser } from '../middleware/auth.js';
import {
  createLinkPassword,
  createLinkSubtracker,
  createLink,
  deleteLink,
  findLinkByCanonicalHostAndSlug,
  findLinkByPublicId,
  findLinkConfigurationByPublicId,
  getLinkAnalytics,
  isLinkPathSegmentAvailable,
  listLinks,
  listListedLinks,
  listLinksByCreator,
  replaceLinkConfiguration,
  serializeLink,
  updateLinkPasswordDisabledState,
  updateLinkSubtrackerDisabledState,
  serializePaginatedLinks,
  updateLink,
  updateLinkDisabledState
} from '../db/links.js';
import {
  createGroup,
  deleteGroup as deleteUserGroup,
  findGroupDetailById,
  findGroupById,
  findUserByEmail,
  findUserById,
  getUserDomainAccess,
  getUserEffectiveDomainAdministrationHosts,
  getUserEffectiveDomainAccess,
  getUserGroups,
  getUserInheritedDomainAccess,
  getUserLinkVariables,
  initializeUserDomainAccess,
  listExistingUserIds,
  listGroups,
  listUsers,
  replaceUserDomainAccess,
  replaceUserLinkVariables,
  replaceUserLinkVariablesAndDefaultScheduleTimezone,
  syncAutomaticGroupMembershipsForEmail,
  updateGroupSettings,
  updateUserDefaultScheduleTimezone,
  upsertUser
} from '../db/users.js';
import {
  getInitialCanonicalHostsForEmail,
  getManagedDomains,
  getSupportedDomains,
  invalidateDomainCache,
  isProvisionedHost,
  resolveRequestedHost
} from '../services/domains.js';
import {
  createGeneratedLinkSlug,
  LINK_PUBLIC_ID_LENGTH,
  LINK_PUBLIC_ID_PATTERN
} from '../services/link-public-id.js';
import {
  invalidateCachedRedirectLink,
  primeCachedRedirectLink
} from '../services/redirect-link-cache.js';
import { hashLinkPassword } from '../services/link-passwords.js';
import {
  isConfiguredDestinationUrl,
  normalizeLinkVariables,
  serializeLinkVariables
} from '../services/destination-url-templates.js';
import { isSuperAdminEmail } from '../services/super-admins.js';

const router = Router();
const appConfig = getAppConfig();
const supportedUsTimeZones = new Set([
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu'
]);

const emailDomainPattern =
  /^(?=.{1,255}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/i;

function normalizeEmailDomains(emailDomains: string[]) {
  return [
    ...new Set(
      emailDomains
        .map((emailDomain) => emailDomain.trim().toLowerCase().replace(/^@+/, ''))
        .filter((emailDomain) => emailDomain.length > 0)
    )
  ];
}

const destinationUrlSchema = z
  .string()
  .refine(
    isConfiguredDestinationUrl,
    'Destination URL must be a valid URL. Variables use {{name|default}} or {{name}}.'
  );

const linkPromptPasswordSchema = z.string().min(1).max(200);
const linkPasswordValueSchema = z.string().trim().min(1).max(200);
const linkSlugPattern = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/;

const createLinkSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(linkSlugPattern),
  canonicalHost: z.string().min(1),
  destinationUrl: destinationUrlSchema,
  description: z.string().max(500).optional().transform((value) => value?.trim() || null),
  internalOnly: z.boolean(),
  password: z.preprocess(
    (value) => (typeof value === 'string' && value.length === 0 ? undefined : value),
    linkPasswordValueSchema.optional()
  )
});

const linkIdParamsSchema = z.object({
  linkId: z
    .string()
    .length(LINK_PUBLIC_ID_LENGTH)
    .regex(LINK_PUBLIC_ID_PATTERN)
});

const linkSubtrackerParamsSchema = z.object({
  linkId: z
    .string()
    .length(LINK_PUBLIC_ID_LENGTH)
    .regex(LINK_PUBLIC_ID_PATTERN),
  subtrackerId: z.string().regex(/^\d+$/)
});

const linkPasswordParamsSchema = z.object({
  linkId: z
    .string()
    .length(LINK_PUBLIC_ID_LENGTH)
    .regex(LINK_PUBLIC_ID_PATTERN),
  passwordId: z.string().regex(/^\d+$/)
});

const updateLinkSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(linkSlugPattern),
  canonicalHost: z.string().min(1),
  destinationUrl: destinationUrlSchema.optional(),
  internalOnly: z.boolean().optional()
});

const updateLinkDisabledStateSchema = z.object({
  isDisabled: z.boolean()
});

const startTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const endTimePattern = /^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/;

const linkScheduleSchema = z.object({
  startTime: z.string().regex(startTimePattern, 'Start time must use HH:MM.'),
  endTime: z.string().regex(endTimePattern, 'End time must use HH:MM or 24:00.'),
  destinationUrl: destinationUrlSchema
});

const rotationDestinationSchema = z.object({
  destinationUrl: destinationUrlSchema
});

const linkSubtrackerSchema = z.object({
  id: z.string().regex(/^\d+$/).optional(),
  name: z.string().trim().min(1).max(120),
  isDisabled: z.boolean().optional().default(false)
});

const createLinkSubtrackerSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const updateLinkSubtrackerDisabledStateSchema = z.object({
  isDisabled: z.boolean()
});

const linkPasswordEntrySchema = z.object({
  id: z.string().regex(/^\d+$/).optional(),
  name: z.string().trim().min(1).max(120),
  password: linkPasswordValueSchema,
  isDisabled: z.boolean().optional().default(false)
});

const createLinkPasswordSchema = z.object({
  name: z.string().trim().min(1).max(120),
  password: linkPasswordValueSchema
});

const updateLinkPasswordDisabledStateSchema = z.object({
  isDisabled: z.boolean()
});

const updatePrivacyPolicyDocumentSchema = z.object({
  markdown: z
    .string()
    .max(200_000)
    .refine((value) => value.trim().length > 0, 'Privacy policy markdown is required.')
});

const updateLinkConfigurationSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(linkSlugPattern),
  canonicalHost: z.string().min(1),
  destinationUrl: destinationUrlSchema,
  description: z.string().max(500).optional().transform((value) => value?.trim() || null),
  internalOnly: z.boolean(),
  isListed: z.boolean().optional(),
  isDisabled: z.boolean(),
  waitingRoomEnabled: z.boolean().default(false),
  requiresTrackingId: z.boolean().default(false),
  rememberPasswordAccess: z.boolean().default(true),
  disabledDestinationUrl: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
    destinationUrlSchema.optional()
  ),
  expirationAt: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
    z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Expiration must be a valid datetime.')
      .optional()
  ),
  scheduleTimezone: z.string().min(1),
  scheduleMode: z.enum(['windows', 'rotation']).default('windows'),
  schedules: z.array(linkScheduleSchema).max(48).default([]),
  rotationIntervalMinutes: z
    .preprocess(
      (value) => (value === null || value === undefined || value === '' ? undefined : value),
      z.coerce.number().int().min(1).max(1440).optional()
    )
    .nullable()
    .default(null),
  rotationDestinations: z.array(rotationDestinationSchema).max(96).default([]),
  subtrackers: z.array(linkSubtrackerSchema).max(100).default([]),
  passwords: z.array(linkPasswordEntrySchema).max(100).default([]),
  password: z.preprocess(
    (value) => (typeof value === 'string' && value.length === 0 ? undefined : value),
    linkPromptPasswordSchema.nullable().optional()
  )
});

const updateUserDomainAccessSchema = z.object({
  allowedCanonicalHosts: z.array(z.string().min(1)),
  defaultScheduleTimezone: z.string().min(1)
});

const groupIdParamsSchema = z.object({
  groupId: z.string().regex(/^\d+$/)
});

const groupNameSchema = z.string().trim().min(1).max(120);

const createGroupSchema = z.object({
  name: groupNameSchema
});

const updateGroupSettingsSchema = z.object({
  name: groupNameSchema,
  memberUserIds: z.array(z.string().regex(/^\d+$/)).max(1000),
  allowedCanonicalHosts: z.array(z.string().min(1)).max(500),
  domainAdministrationHosts: z.array(z.string().min(1)).max(500),
  autoMemberEmailDomains: z.array(z.string().min(1)).max(500)
});

const createRegistrationInviteSchema = z.object({
  label: z.preprocess(
    (value) => {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value !== 'string') {
        return value;
      }

      const normalizedValue = value.trim();
      return normalizedValue.length > 0 ? normalizedValue : null;
    },
    z.string().max(160).nullable().default(null)
  ),
  groupId: z.preprocess(
    (value) => (value === null || value === undefined || value === '' ? null : value),
    z.string().regex(/^\d+$/).nullable().default(null)
  )
});

const linkVariableEntrySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  value: z.string().trim().min(1).max(2_000)
});

const userLinkVariablesPayloadSchema = z.object({
  variables: z.array(linkVariableEntrySchema).max(100)
});

const validateUniqueUserLinkVariableKeys = (value: { variables: Array<{ key: string }> }) => {
  const normalizedKeys = value.variables.map((variable) => variable.key.trim().toLowerCase());
  return normalizedKeys.length === new Set(normalizedKeys).size;
};

const updateUserLinkVariablesSchema = userLinkVariablesPayloadSchema.refine(
  validateUniqueUserLinkVariableKeys,
  {
    message: 'Variable keys must be unique.',
    path: ['variables']
  }
);

const updateCurrentUserLinkVariablesSchema = userLinkVariablesPayloadSchema
  .extend({
    defaultScheduleTimezone: z.string().min(1)
  })
  .refine(
    validateUniqueUserLinkVariableKeys,
    {
      message: 'Variable keys must be unique.',
      path: ['variables']
    }
  );

const updateDomainSchema = z
  .object({
    isDefaultForNewAccounts: z.boolean().optional(),
    aliasTargetHost: z.string().min(1).nullable().optional(),
    authProviderHost: z.string().min(1).nullable().optional(),
    rootRedirectSlug: z.preprocess(
      (value) => {
        if (typeof value !== 'string') {
          return value;
        }

        const normalizedValue = value.trim().toLowerCase();
        return normalizedValue.length > 0 ? normalizedValue : 'admin';
      },
      z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-zA-Z0-9._-]+$/)
        .optional()
    )
  })
  .refine(
    (value) =>
      value.isDefaultForNewAccounts !== undefined ||
      value.aliasTargetHost !== undefined ||
      value.authProviderHost !== undefined ||
      value.rootRedirectSlug !== undefined,
    'At least one domain field must be provided.'
  );

const userIdParamsSchema = z.object({
  userId: z.string().regex(/^\d+$/)
});

const domainHostParamsSchema = z.object({
  canonicalHost: z.string().min(1)
});

const listLinksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z
    .coerce.number()
    .int()
    .refine((value) => [20, 50, 100].includes(value), 'Unsupported page size.')
    .default(20),
  scope: z.enum(['mine', 'listed', 'all']).default('mine'),
  searchQuery: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
    z.string().max(200).optional()
  ),
  canonicalHost: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length > 0
        ? value.trim().toLowerCase()
        : undefined,
    z.string().min(1).optional()
  ),
  visibility: z.enum(['all', 'public', 'internal']).default('all'),
  schedule: z.enum(['all', 'static', 'scheduled']).default('all'),
  sort: z
    .enum([
      'updatedDesc',
      'updatedAsc',
      'createdDesc',
      'createdAsc',
      'usageDesc',
      'usageAsc',
      'slugAsc',
      'slugDesc',
      'hostAsc',
      'hostDesc',
      'destinationAsc',
      'destinationDesc'
    ])
    .default('updatedDesc')
});

const linkLookupQuerySchema = z.object({
  canonicalHost: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(linkSlugPattern)
});

const generateLinkSlugQuerySchema = z.object({
  canonicalHost: z.string().min(1),
  linkId: z
    .string()
    .length(LINK_PUBLIC_ID_LENGTH)
    .regex(LINK_PUBLIC_ID_PATTERN)
    .optional()
});

const analyticsQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  timeWindow: z.enum(['all', '4h', '24h', '7d', '30d', '90d']).default('all')
});

const linkAnalyticsQuerySchema = z.object({
  timeWindow: z.enum(['all', '4h', '24h', '7d', '30d', '90d']).default('24h')
});

type BootstrapUser = {
  email: string;
  name: string;
  picture: string | null;
  isSuperAdmin: boolean;
  allowedCanonicalHosts: string[];
  administeredDomainHosts: string[];
  defaultScheduleTimezone: string;
};

type AuthenticatedSessionUser = NonNullable<Express.Request['sessionUser']>;

function parseMinuteOfDay(time: string) {
  if (time === '24:00') {
    return 24 * 60;
  }

  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function isSupportedUsTimeZone(timeZone: string) {
  return supportedUsTimeZones.has(timeZone);
}

function normalizeScheduledDestinations(
  schedules: Array<{
    startTime: string;
    endTime: string;
    destinationUrl: string;
  }>
) {
  const normalizedSchedules = schedules
    .map((schedule) => ({
      startMinute: parseMinuteOfDay(schedule.startTime),
      endMinute: parseMinuteOfDay(schedule.endTime),
      destinationUrl: schedule.destinationUrl,
      startTime: schedule.startTime,
      endTime: schedule.endTime
    }))
    .sort((left, right) => left.startMinute - right.startMinute);

  for (const schedule of normalizedSchedules) {
    if (schedule.endMinute <= schedule.startMinute) {
      throw new Error('Each scheduled destination must end after it starts.');
    }
  }

  for (let index = 1; index < normalizedSchedules.length; index += 1) {
    const previous = normalizedSchedules[index - 1];
    const current = normalizedSchedules[index];

    if (current.startMinute < previous.endMinute) {
      throw new Error('Scheduled destinations cannot overlap.');
    }
  }

  return normalizedSchedules.map(({ startMinute, endMinute, destinationUrl }) => ({
    startMinute,
    endMinute,
    destinationUrl
  }));
}

function normalizeRotationDestinations(
  destinations: Array<{
    destinationUrl: string;
  }>
) {
  return destinations.map((destination) => ({
    destinationUrl: destination.destinationUrl
  }));
}

function hasActiveLinkSubtrackers(
  subtrackers: Array<{
    isDisabled?: boolean;
    is_disabled?: boolean;
  }>
) {
  return subtrackers.some(
    (subtracker) => !(subtracker.isDisabled ?? subtracker.is_disabled ?? false)
  );
}

function hasActiveLinkPasswords(
  passwords: Array<{
    isDisabled?: boolean;
    is_disabled?: boolean;
  }>
) {
  return passwords.some((password) => !(password.isDisabled ?? password.is_disabled ?? false));
}

function hasDuplicateLinkPasswords(
  passwords: Array<{
    password: string;
  }>
) {
  const seen = new Set<string>();

  for (const password of passwords) {
    if (seen.has(password.password)) {
      return true;
    }

    seen.add(password.password);
  }

  return false;
}

function serializeApiLinkConfiguration(
  link: NonNullable<Awaited<ReturnType<typeof findLinkConfigurationByPublicId>>>
) {
  const { schedules, rotation_schedule, subtrackers, passwords } = link;
  const {
    schedule_timezone,
    schedule_mode,
    disabled_destination_url,
    expires_at,
    ...baseLink
  } = serializeLink(link);

  return {
    ...baseLink,
    hasLegacyPasswordPrompt: link.has_legacy_password_prompt,
    rememberPasswordAccess: link.remember_password_access,
    scheduleTimezone: schedule_timezone,
    scheduleMode: schedule_mode,
    disabledDestinationUrl: disabled_destination_url,
    expiresAt: expires_at,
    subtrackers: subtrackers.map((subtracker) => ({
      id: subtracker.id,
      name: subtracker.name,
      trackingId: subtracker.tracking_id,
      isDisabled: subtracker.is_disabled,
      usageCount: subtracker.usage_count,
      created_at: subtracker.created_at
    })),
    passwords: passwords.map((password) => ({
      id: password.id,
      name: password.name,
      password: password.password,
      isDisabled: password.is_disabled,
      usageCount: password.usage_count,
      created_at: password.created_at
    })),
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      destinationUrl: schedule.destination_url
    })),
    rotationSchedule: rotation_schedule
      ? {
          intervalMinutes: rotation_schedule.interval_minutes,
          destinations: rotation_schedule.destinations.map((destination) => ({
            id: destination.id,
            destinationUrl: destination.destination_url
          }))
        }
      : null
  };
}

function serializeRegistrationInvite(invite: Awaited<ReturnType<typeof listRegistrationInvites>>[number]) {
  return {
    id: invite.id,
    token: invite.token,
    label: invite.label,
    groupId: invite.group_id,
    groupName: invite.group_name,
    createdByEmail: invite.created_by_email,
    usedByEmail: invite.used_by_email,
    createdAt: invite.created_at,
    updatedAt: invite.updated_at,
    usedAt: invite.used_at,
    isUsed: invite.used_at !== null
  };
}

function serializeApiLinkTimeSeriesAnalytics(analytics: Awaited<ReturnType<typeof getLinkAnalytics>>) {
  return {
    overview: {
      totalUses: analytics.overview.totalUses
    },
    timeSeries: analytics.timeSeries
  };
}

type SetupChecklistStatus = 'complete' | 'warning';

type SetupChecklistItem = {
  id: string;
  title: string;
  status: SetupChecklistStatus;
  description: string;
  actionLabel: string | null;
  actionPath: string | null;
};

async function buildSetupChecklist(): Promise<{
  items: SetupChecklistItem[];
  completedCount: number;
  warningCount: number;
}> {
  const adminConfig = getAdminConfig();
  const authConfig = getAuthConfig();
  const managedDomains = await getManagedDomains();
  const superAdminCount = adminConfig.superAdminEmails.length;
  const enabledSignInMethods = [
    authConfig.googleClientId ? 'Google' : null,
    authConfig.emailCodeAuth.enabled ? 'email code' : null
  ].filter((value): value is string => value !== null);
  const hasSignInMethod = enabledSignInMethods.length > 0;
  const hasSignInPolicy =
    authConfig.allowAllVerifiedGoogleAccounts ||
    authConfig.allowedEmails.length > 0 ||
    authConfig.allowedEmailDomains.length > 0;
  const relationshipCount = managedDomains.filter(
    (domain) => domain.aliasTargetHost !== null || domain.authProviderHost !== null
  ).length;
  const signInPolicyDescription = authConfig.allowAllVerifiedGoogleAccounts
    ? 'ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS is enabled, so any verified Google account can sign in.'
    : authConfig.allowedEmails.length > 0 && authConfig.allowedEmailDomains.length > 0
      ? `Sign-in currently allows ${authConfig.allowedEmails.length} specific email${authConfig.allowedEmails.length === 1 ? '' : 's'} and ${authConfig.allowedEmailDomains.length} email domain${authConfig.allowedEmailDomains.length === 1 ? '' : 's'}.`
      : authConfig.allowedEmails.length > 0
        ? `Sign-in currently allows ${authConfig.allowedEmails.length} specific email${authConfig.allowedEmails.length === 1 ? '' : 's'}.`
        : authConfig.allowedEmailDomains.length > 0
          ? `Sign-in currently allows ${authConfig.allowedEmailDomains.length} email domain${authConfig.allowedEmailDomains.length === 1 ? '' : 's'}.`
          : 'No allowed emails or email domains are configured, and allow-all is disabled. The app stays deny-all until one of those settings is configured.';
  const items: SetupChecklistItem[] = [
    {
      id: 'super-admins',
      title: 'Super admins configured',
      status: superAdminCount > 0 ? 'complete' : 'warning',
      description:
        superAdminCount > 0
          ? `${superAdminCount} super admin email${superAdminCount === 1 ? '' : 's'} configured through SUPER_ADMIN_EMAILS.`
          : 'No super admin emails are configured in SUPER_ADMIN_EMAILS. Without one, nobody can manage domains and other global settings from the UI.',
      actionLabel: null,
      actionPath: null
    },
    {
      id: 'sign-in-methods',
      title: 'Sign-in methods configured',
      status: hasSignInMethod ? 'complete' : 'warning',
      description: hasSignInMethod
        ? `${enabledSignInMethods.join(' and ')} sign-in ${enabledSignInMethods.length === 1 ? 'is' : 'are'} enabled.`
        : 'No sign-in method is configured. Set GOOGLE_CLIENT_ID for Google sign-in, or configure the email auth SES settings for email codes.',
      actionLabel: null,
      actionPath: null
    },
    {
      id: 'sign-in-policy',
      title: 'Sign-in access configured',
      status: hasSignInPolicy ? 'complete' : 'warning',
      description: signInPolicyDescription,
      actionLabel: null,
      actionPath: null
    },
    {
      id: 'provisioned-hosts',
      title: 'Provisioned hosts reviewed',
      status:
        managedDomains.length === 0 ||
        (managedDomains.length > 1 && relationshipCount === 0)
          ? 'warning'
          : 'complete',
      description:
        managedDomains.length === 0
          ? 'No provisioned hosts are available from the current deployment. Configure DOMAINS_JSON and redeploy before using the app.'
          : managedDomains.length === 1
            ? 'One provisioned host is available, so there are no cross-domain relationships to review.'
            : relationshipCount > 0
              ? `${managedDomains.length} provisioned hosts are available, and ${relationshipCount} host relationship${relationshipCount === 1 ? '' : 's'} are configured through Auth via or Alias.`
              : `${managedDomains.length} provisioned hosts are available and all are still standalone canonical domains. Review the Domains page to confirm whether Canonical, Auth via, or Alias is intended for each host.`,
      actionLabel: managedDomains.length > 1 && relationshipCount === 0 ? 'Review domains' : null,
      actionPath: managedDomains.length > 1 && relationshipCount === 0 ? '/domains' : null
    }
  ];

  return {
    items,
    completedCount: items.filter((item) => item.status === 'complete').length,
    warningCount: items.filter((item) => item.status === 'warning').length
  };
}

async function syncAuthenticatedUserRecord(sessionUser: AuthenticatedSessionUser) {
  const existingUser = await findUserByEmail(sessionUser.email);
  const userRecord = await upsertUser({
    email: sessionUser.email,
    name: sessionUser.name,
    picture: sessionUser.picture
  });
  if (!existingUser) {
    await initializeUserDomainAccess(
      userRecord.id,
      await getInitialCanonicalHostsForEmail(sessionUser.email)
    );
    await syncAutomaticGroupMembershipsForEmail(userRecord.id, sessionUser.email);
  }

  const [allowedCanonicalHosts, administeredDomainHosts] = await Promise.all([
    getUserEffectiveDomainAccess(userRecord.id),
    getUserEffectiveDomainAdministrationHosts(userRecord.id)
  ]);

  return {
    userRecord,
    allowedCanonicalHosts,
    administeredDomainHosts
  };
}

async function getVisibleManagedDomainsForSessionUser(sessionUser: AuthenticatedSessionUser) {
  const managedDomains = await getManagedDomains();

  if (sessionUser.isSuperAdmin) {
    return managedDomains;
  }

  const { administeredDomainHosts } = await syncAuthenticatedUserRecord(sessionUser);
  const administeredDomainHostSet = new Set(administeredDomainHosts);

  return managedDomains.filter((domain) => administeredDomainHostSet.has(domain.host));
}

async function buildAdminUserDetail(
  user: NonNullable<Awaited<ReturnType<typeof findUserById>>>
) {
  const [directAllowedCanonicalHosts, inheritedAllowedCanonicalHosts, allowedCanonicalHosts, groups] =
    await Promise.all([
      getUserDomainAccess(user.id),
      getUserInheritedDomainAccess(user.id),
      getUserEffectiveDomainAccess(user.id),
      getUserGroups(user.id)
    ]);

  return {
    ...user,
    isSuperAdmin: isSuperAdminEmail(user.email),
    directAllowedCanonicalHosts,
    inheritedAllowedCanonicalHosts,
    allowedCanonicalHosts,
    groups,
    defaultScheduleTimezone: user.default_schedule_timezone
  };
}

router.get('/api/bootstrap', async (request, response) => {
  const resolvedHost = await resolveRequestedHost(request);
  const supportedDomains = await getSupportedDomains();
  let user: BootstrapUser | null = null;

  if (request.sessionUser) {
    const { userRecord, allowedCanonicalHosts, administeredDomainHosts } =
      await syncAuthenticatedUserRecord(request.sessionUser);

    user = {
      ...request.sessionUser,
      allowedCanonicalHosts,
      administeredDomainHosts,
      defaultScheduleTimezone: userRecord.default_schedule_timezone
    };
  }

  response.json({
    currentHost: resolvedHost.requestedHost,
    canonicalHost: resolvedHost.canonicalHost,
    user,
    supportedDomains,
    appBuildId: appConfig.appBuildId
  });
});

router.get('/api/version', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({
    appBuildId: appConfig.appBuildId
  });
});

router.get('/api/links', requireAuthenticatedUser, async (request, response) => {
  const parsedQuery = listLinksQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({
      error: 'Invalid list links query.',
      issues: parsedQuery.error.issues
    });
    return;
  }

  if (parsedQuery.data.scope === 'all' && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view all links.' });
    return;
  }

  const listInput = {
    page: parsedQuery.data.page,
    pageSize: parsedQuery.data.pageSize,
    searchQuery: parsedQuery.data.searchQuery,
    canonicalHost: parsedQuery.data.canonicalHost,
    visibility: parsedQuery.data.visibility,
    schedule: parsedQuery.data.schedule,
    sort: parsedQuery.data.sort
  };

  const links =
    parsedQuery.data.scope === 'all'
      ? await listLinks(listInput)
      : parsedQuery.data.scope === 'listed'
        ? await listListedLinks({
            ...listInput,
            allowedCanonicalHosts: request.sessionUser!.isSuperAdmin
              ? undefined
              : (await syncAuthenticatedUserRecord(request.sessionUser!)).allowedCanonicalHosts
          })
        : await listLinksByCreator({
            ...listInput,
            createdByEmail: request.sessionUser!.email
          });

  response.json(serializePaginatedLinks(links));
});

router.get('/api/analytics', requireAuthenticatedUser, async (request, response) => {
  const parsedQuery = analyticsQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({
      error: 'Invalid analytics query.',
      issues: parsedQuery.error.issues
    });
    return;
  }

  if (parsedQuery.data.scope === 'all' && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view all analytics.' });
    return;
  }

  const analytics =
    parsedQuery.data.scope === 'all'
      ? await getLinkAnalytics({ timeWindow: parsedQuery.data.timeWindow })
      : await getLinkAnalytics({
          createdByEmail: request.sessionUser!.email,
          timeWindow: parsedQuery.data.timeWindow
        });

  response.json(analytics);
});

router.get('/api/links/:linkId/config', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    response.status(400).json({
      error: 'Invalid link id.',
      issues: parsedParams.error.issues
    });
    return;
  }

  const link = await findLinkConfigurationByPublicId(parsedParams.data.linkId);
  if (!link) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner = link.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to configure this link.' });
    return;
  }

  response.json({ link: serializeApiLinkConfiguration(link) });
});

router.get('/api/links/:linkId/analytics', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    response.status(400).json({
      error: 'Invalid link id.',
      issues: parsedParams.error.issues
    });
    return;
  }

  const parsedQuery = linkAnalyticsQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({
      error: 'Invalid link analytics query.',
      issues: parsedQuery.error.issues
    });
    return;
  }

  const link = await findLinkByPublicId(parsedParams.data.linkId);
  if (!link) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner = link.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to view link analytics.' });
    return;
  }

  const analytics = await getLinkAnalytics({
    linkId: link.id,
    timeWindow: parsedQuery.data.timeWindow
  });

  response.json({ analytics: serializeApiLinkTimeSeriesAnalytics(analytics) });
});

router.get('/api/links/lookup', requireAuthenticatedUser, async (request, response) => {
  const parsedQuery = linkLookupQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({
      error: 'Invalid link lookup query.',
      issues: parsedQuery.error.issues
    });
    return;
  }

  const link = await findLinkByCanonicalHostAndSlug(
    parsedQuery.data.canonicalHost.toLowerCase(),
    parsedQuery.data.slug.toLowerCase()
  );

  if (!link) {
    response.json({ linkId: null });
    return;
  }

  const isOwner = link.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.json({ linkId: null });
    return;
  }

  response.json({
    linkId: serializeLink(link).id
  });
});

router.get('/api/links/generate-slug', requireAuthenticatedUser, async (request, response) => {
  const parsedQuery = generateLinkSlugQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({
      error: 'Invalid slug generation query.',
      issues: parsedQuery.error.issues
    });
    return;
  }

  const requestedCanonicalHost = parsedQuery.data.canonicalHost.toLowerCase();
  const supportedHosts = new Set((await getSupportedDomains()).map((domain) => domain.host));
  if (!supportedHosts.has(requestedCanonicalHost)) {
    response.status(400).json({ error: 'Unsupported host selected.' });
    return;
  }

  const { allowedCanonicalHosts } = await syncAuthenticatedUserRecord(request.sessionUser!);
  let canGenerateForHost =
    request.sessionUser!.isSuperAdmin || allowedCanonicalHosts.includes(requestedCanonicalHost);

  if (!canGenerateForHost && parsedQuery.data.linkId) {
    const existingLink = await findLinkByPublicId(parsedQuery.data.linkId);
    const isOwner =
      existingLink?.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();

    if (existingLink && isOwner && existingLink.canonical_host === requestedCanonicalHost) {
      canGenerateForHost = true;
    }
  }

  if (!canGenerateForHost) {
    response.status(403).json({ error: 'You do not have access to create links on that host.' });
    return;
  }

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const slug = createGeneratedLinkSlug();
    const isAvailable = await isLinkPathSegmentAvailable(requestedCanonicalHost, slug);
    if (isAvailable) {
      response.json({ slug });
      return;
    }
  }

  response.status(500).json({ error: 'Unable to generate an unused slug right now.' });
});

router.get('/api/users', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view users.' });
    return;
  }

  const users = (await listUsers()).map((user) => ({
    ...user,
    isSuperAdmin: isSuperAdminEmail(user.email)
  }));
  response.json({ users });
});

router.get('/api/groups', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view groups.' });
    return;
  }

  response.json({
    groups: await listGroups()
  });
});

router.post('/api/groups', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to create groups.' });
    return;
  }

  const parsedBody = createGroupSchema.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({
      error: 'Invalid group payload.',
      issues: parsedBody.error.issues
    });
    return;
  }

  try {
    const group = await createGroup(parsedBody.data.name);
    if (!group) {
      response.status(500).json({ error: 'Unable to create group.' });
      return;
    }

    response.status(201).json({ group });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: 'A group with that name already exists.' });
      return;
    }

    response.status(500).json({ error: 'Unable to create group.' });
  }
});

router.get('/api/domains', requireAuthenticatedUser, async (request, response) => {
  const visibleDomains = await getVisibleManagedDomainsForSessionUser(request.sessionUser!);
  if (!request.sessionUser!.isSuperAdmin && visibleDomains.length === 0) {
    response
      .status(403)
      .json({ error: 'Domain administration access is required to view domains.' });
    return;
  }

  const supportedDomains = await getSupportedDomains();
  response.json({ domains: visibleDomains, supportedDomains });
});

router.get('/api/setup-checklist', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view the setup checklist.' });
    return;
  }

  response.json(await buildSetupChecklist());
});

router.get('/api/privacy-policy', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view the privacy policy.' });
    return;
  }

  response.json({
    document: await getPrivacyPolicyDocument()
  });
});

router.put('/api/privacy-policy', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to edit the privacy policy.' });
    return;
  }

  const parsedBody = updatePrivacyPolicyDocumentSchema.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({
      error: 'Invalid privacy policy payload.',
      issues: parsedBody.error.issues
    });
    return;
  }

  try {
    response.json({
      document: await updatePrivacyPolicyDocument(parsedBody.data.markdown)
    });
  } catch {
    response.status(500).json({ error: 'Unable to update the privacy policy.' });
  }
});

router.get('/api/users/:userId', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view users.' });
    return;
  }

  const parsedParams = userIdParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    response.status(400).json({
      error: 'Invalid user id.',
      issues: parsedParams.error.issues
    });
    return;
  }

  const user = await findUserById(parsedParams.data.userId);
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }

  response.json({
    user: await buildAdminUserDetail(user)
  });
});

router.patch('/api/users/:userId/domain-access', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to edit users.' });
    return;
  }

  const parsedParams = userIdParamsSchema.safeParse(request.params);
  const parsedBody = updateUserDomainAccessSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid user domain access payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const user = await findUserById(parsedParams.data.userId);
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }

  if (!isSupportedUsTimeZone(parsedBody.data.defaultScheduleTimezone)) {
    response.status(400).json({ error: 'Default schedule timezone must be a supported US timezone.' });
    return;
  }

  const supportedCanonicalHosts = new Set((await getSupportedDomains()).map((domain) => domain.host));
  const normalizedHosts = [
    ...new Set(parsedBody.data.allowedCanonicalHosts.map((host) => host.toLowerCase()))
  ];

  if (normalizedHosts.some((host) => !supportedCanonicalHosts.has(host))) {
    response.status(400).json({ error: 'One or more requested hosts are unsupported.' });
    return;
  }

  await replaceUserDomainAccess(user.id, normalizedHosts);
  const updatedUser = await updateUserDefaultScheduleTimezone(
    user.id,
    parsedBody.data.defaultScheduleTimezone
  );

  if (!updatedUser) {
    response.status(500).json({ error: 'Unable to update user settings.' });
    return;
  }

  response.json({
    user: await buildAdminUserDetail(updatedUser)
  });
});

router.get('/api/groups/:groupId', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view groups.' });
    return;
  }

  const parsedParams = groupIdParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    response.status(400).json({
      error: 'Invalid group id.',
      issues: parsedParams.error.issues
    });
    return;
  }

  const group = await findGroupDetailById(parsedParams.data.groupId);
  if (!group) {
    response.status(404).json({ error: 'Group not found.' });
    return;
  }

  response.json({ group });
});

router.patch('/api/groups/:groupId', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to edit groups.' });
    return;
  }

  const parsedParams = groupIdParamsSchema.safeParse(request.params);
  const parsedBody = updateGroupSettingsSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid group settings payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const existingGroup = await findGroupById(parsedParams.data.groupId);
  if (!existingGroup) {
    response.status(404).json({ error: 'Group not found.' });
    return;
  }

  const supportedCanonicalHosts = new Set((await getSupportedDomains()).map((domain) => domain.host));
  const supportedManagedHosts = new Set((await getManagedDomains()).map((domain) => domain.host));
  const normalizedHosts = [
    ...new Set(parsedBody.data.allowedCanonicalHosts.map((host) => host.toLowerCase()))
  ];
  const normalizedDomainAdministrationHosts = [
    ...new Set(parsedBody.data.domainAdministrationHosts.map((host) => host.toLowerCase()))
  ];
  const normalizedEmailDomains = normalizeEmailDomains(parsedBody.data.autoMemberEmailDomains);

  if (normalizedHosts.some((host) => !supportedCanonicalHosts.has(host))) {
    response.status(400).json({ error: 'One or more requested hosts are unsupported.' });
    return;
  }

  if (normalizedDomainAdministrationHosts.some((host) => !supportedManagedHosts.has(host))) {
    response.status(400).json({ error: 'One or more requested domain admin hosts are unsupported.' });
    return;
  }

  if (normalizedEmailDomains.some((emailDomain) => !emailDomainPattern.test(emailDomain))) {
    response.status(400).json({ error: 'One or more automatic email domains are invalid.' });
    return;
  }

  const normalizedMemberUserIds = [...new Set(parsedBody.data.memberUserIds)];
  const existingUserIds = await listExistingUserIds(normalizedMemberUserIds);
  if (existingUserIds.length !== normalizedMemberUserIds.length) {
    response.status(400).json({ error: 'One or more selected users no longer exist.' });
    return;
  }

  try {
    const group = await updateGroupSettings({
      groupId: parsedParams.data.groupId,
      name: parsedBody.data.name,
      memberUserIds: normalizedMemberUserIds,
      allowedCanonicalHosts: normalizedHosts,
      domainAdministrationHosts: normalizedDomainAdministrationHosts,
      autoMemberEmailDomains: normalizedEmailDomains
    });

    if (!group) {
      response.status(404).json({ error: 'Group not found.' });
      return;
    }

    response.json({ group });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: 'A group with that name already exists.' });
      return;
    }

    response.status(500).json({ error: 'Unable to update group.' });
  }
});

router.delete('/api/groups/:groupId', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to delete groups.' });
    return;
  }

  const parsedParams = groupIdParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    response.status(400).json({
      error: 'Invalid group id.',
      issues: parsedParams.error.issues
    });
    return;
  }

  const deleted = await deleteUserGroup(parsedParams.data.groupId);
  if (!deleted) {
    response.status(404).json({ error: 'Group not found.' });
    return;
  }

  response.status(204).send();
});

router.get('/api/invites', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view invites.' });
    return;
  }

  response.json({
    invites: (await listRegistrationInvites()).map(serializeRegistrationInvite)
  });
});

router.post('/api/invites', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to create invites.' });
    return;
  }

  const parsedBody = createRegistrationInviteSchema.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({
      error: 'Invalid invite payload.',
      issues: parsedBody.error.issues
    });
    return;
  }

  if (parsedBody.data.groupId) {
    const group = await findGroupById(parsedBody.data.groupId);
    if (!group) {
      response.status(404).json({ error: 'Selected group not found.' });
      return;
    }
  }

  const creator = await findUserByEmail(request.sessionUser!.email);
  if (!creator) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }

  const invite = await createRegistrationInvite({
    token: randomBytes(24).toString('base64url'),
    label: parsedBody.data.label,
    groupId: parsedBody.data.groupId,
    createdByUserId: creator.id
  });

  if (!invite) {
    response.status(500).json({ error: 'Unable to create invite.' });
    return;
  }

  response.status(201).json({
    invite: serializeRegistrationInvite(invite)
  });
});

router.get('/api/user-variables', requireAuthenticatedUser, async (request, response) => {
  const user = await findUserByEmail(request.sessionUser!.email);
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }

  response.json({
    variables: serializeLinkVariables(await getUserLinkVariables(user.id)),
    defaultScheduleTimezone: user.default_schedule_timezone
  });
});

router.put('/api/user-variables', requireAuthenticatedUser, async (request, response) => {
  const parsedBody = updateCurrentUserLinkVariablesSchema.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({
      error: 'Invalid link variable payload.',
      issues: parsedBody.error.issues
    });
    return;
  }

  const user = await findUserByEmail(request.sessionUser!.email);
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }

  if (!isSupportedUsTimeZone(parsedBody.data.defaultScheduleTimezone)) {
    response.status(400).json({ error: 'Default schedule timezone must be a supported US timezone.' });
    return;
  }

  const nextLinkVariables = normalizeLinkVariables(parsedBody.data.variables);
  const updatedSettings = await replaceUserLinkVariablesAndDefaultScheduleTimezone(
    user.id,
    nextLinkVariables,
    parsedBody.data.defaultScheduleTimezone
  );
  if (!updatedSettings) {
    response.status(500).json({ error: 'Unable to update destination settings.' });
    return;
  }

  response.json({
    variables: serializeLinkVariables(updatedSettings.linkVariables),
    defaultScheduleTimezone: updatedSettings.defaultScheduleTimezone
  });
});

router.get('/api/users/:userId/link-variables', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to view user variables.' });
    return;
  }

  const parsedParams = userIdParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    response.status(400).json({
      error: 'Invalid user id.',
      issues: parsedParams.error.issues
    });
    return;
  }

  const user = await findUserById(parsedParams.data.userId);
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }

  response.json({
    variables: serializeLinkVariables(await getUserLinkVariables(user.id))
  });
});

router.put('/api/users/:userId/link-variables', requireAuthenticatedUser, async (request, response) => {
  if (!request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'Super admin access is required to edit user variables.' });
    return;
  }

  const parsedParams = userIdParamsSchema.safeParse(request.params);
  const parsedBody = updateUserLinkVariablesSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid user link variable payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const user = await findUserById(parsedParams.data.userId);
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }

  const nextLinkVariables = normalizeLinkVariables(parsedBody.data.variables);
  const updatedLinkVariables = await replaceUserLinkVariables(user.id, nextLinkVariables);
  if (!updatedLinkVariables) {
    response.status(500).json({ error: 'Unable to update user link variables.' });
    return;
  }

  response.json({
    variables: serializeLinkVariables(updatedLinkVariables)
  });
});

router.patch('/api/domains/:canonicalHost', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = domainHostParamsSchema.safeParse(request.params);
  const parsedBody = updateDomainSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid domain payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const normalizedHost = parsedParams.data.canonicalHost.toLowerCase();
  const managedDomain =
    (await getManagedDomains()).find((domain) => domain.host === normalizedHost) ?? null;
  if (!managedDomain || !isProvisionedHost(normalizedHost)) {
    response.status(404).json({ error: 'Domain not found.' });
    return;
  }

  const normalizedRequestedAliasTargetHost =
    parsedBody.data.aliasTargetHost !== undefined
      ? parsedBody.data.aliasTargetHost?.toLowerCase() ?? null
      : undefined;
  const normalizedRequestedAuthProviderHost =
    parsedBody.data.authProviderHost !== undefined
      ? parsedBody.data.authProviderHost?.toLowerCase() ?? null
      : undefined;

  if (!request.sessionUser!.isSuperAdmin) {
    const { administeredDomainHosts, allowedCanonicalHosts } = await syncAuthenticatedUserRecord(
      request.sessionUser!
    );
    if (!administeredDomainHosts.includes(normalizedHost)) {
      response
        .status(403)
        .json({ error: 'Domain administration access is required to edit this domain.' });
      return;
    }

    if (parsedBody.data.isDefaultForNewAccounts !== undefined) {
      response
        .status(403)
        .json({ error: 'Only super admins can change default domain status.' });
      return;
    }

    if (managedDomain.isDefaultForNewAccounts) {
      response.status(403).json({ error: 'Only super admins can edit default domains.' });
      return;
    }

    if (
      normalizedRequestedAliasTargetHost &&
      !allowedCanonicalHosts.includes(normalizedRequestedAliasTargetHost)
    ) {
      response.status(403).json({
        error: 'You can only alias to domains you have link creation access to.'
      });
      return;
    }

    if (
      normalizedRequestedAuthProviderHost &&
      !allowedCanonicalHosts.includes(normalizedRequestedAuthProviderHost)
    ) {
      response.status(403).json({
        error: 'You can only use Auth via domains you have link creation access to.'
      });
      return;
    }
  }

  let hostState = await findDomainHostState(normalizedHost);

  if (normalizedRequestedAliasTargetHost && normalizedRequestedAuthProviderHost) {
    response.status(400).json({
      error: 'A domain must be Canonical, Auth via, or Alias, but not more than one.'
    });
    return;
  }

  if (
    parsedBody.data.isDefaultForNewAccounts !== undefined &&
    ((normalizedRequestedAliasTargetHost !== undefined && normalizedRequestedAliasTargetHost !== null) ||
      hostState.kind === 'alias')
  ) {
    response.status(400).json({ error: 'Alias domains cannot be marked as defaults.' });
    return;
  }

  if (parsedBody.data.aliasTargetHost !== undefined) {
    const normalizedAliasTargetHost = normalizedRequestedAliasTargetHost ?? null;
    const createHostIfMissing = hostState.kind === 'missing';
    let createTargetIfMissing = false;

    if (normalizedAliasTargetHost) {
      if (!isProvisionedHost(normalizedAliasTargetHost)) {
        response.status(400).json({ error: 'Alias targets must be existing canonical domains.' });
        return;
      }

      const targetState = await findDomainHostState(normalizedAliasTargetHost);
      if (targetState.kind === 'alias') {
        response.status(400).json({ error: 'Alias targets must be existing canonical domains.' });
        return;
      }

      createTargetIfMissing = targetState.kind === 'missing';
    }

    const aliasUpdate = await setDomainAliasTarget({
      host: normalizedHost,
      aliasTargetHost: normalizedAliasTargetHost,
      createHostIfMissing,
      createTargetIfMissing
    });

    if (!aliasUpdate.ok) {
      if (aliasUpdate.reason === 'not_found') {
        response.status(404).json({ error: 'Domain not found.' });
        return;
      }

      if (aliasUpdate.reason === 'invalid_target') {
        response.status(400).json({ error: 'Alias targets must be existing canonical domains.' });
        return;
      }

      if (aliasUpdate.reason === 'self_target') {
        response.status(400).json({ error: 'A domain cannot alias to itself.' });
        return;
      }

      if (aliasUpdate.reason === 'in_use') {
        response.status(409).json({
          error: 'A domain with existing links cannot be converted into an alias.'
        });
        return;
      }
    }

    hostState = await findDomainHostState(normalizedHost);
  }

  if (parsedBody.data.isDefaultForNewAccounts !== undefined) {
    if (hostState.kind === 'missing') {
      await createCanonicalDomain(normalizedHost);
      hostState = { kind: 'canonical' };
    }

    const updatedDomain = await updateDomainDefaults({
      canonicalHost: normalizedHost,
      isDefaultForNewAccounts: parsedBody.data.isDefaultForNewAccounts
    });

    if (!updatedDomain) {
      response.status(404).json({ error: 'Domain not found.' });
      return;
    }
  }

  if (parsedBody.data.rootRedirectSlug !== undefined) {
    const updatedHostSettings = await updateDomainRootRedirectSlug({
      host: normalizedHost,
      rootRedirectSlug: parsedBody.data.rootRedirectSlug,
      allowMissingHost: hostState.kind === 'missing'
    });

    if (!updatedHostSettings) {
      response.status(404).json({ error: 'Domain not found.' });
      return;
    }
  }

  if (parsedBody.data.authProviderHost !== undefined) {
    const normalizedAuthProviderHost = normalizedRequestedAuthProviderHost ?? null;

    if (normalizedAuthProviderHost && hostState.kind === 'alias') {
      response.status(400).json({ error: 'Alias domains cannot use Auth via.' });
      return;
    }

    if (normalizedAuthProviderHost && !isProvisionedHost(normalizedAuthProviderHost)) {
      response.status(400).json({ error: 'Auth providers must be existing provisioned domains.' });
      return;
    }

    const providerUpdate = await updateDomainAuthProviderHost({
      host: normalizedHost,
      authProviderHost: normalizedAuthProviderHost,
      allowMissingHost: hostState.kind === 'missing'
    });

    if (!providerUpdate.ok) {
      if (providerUpdate.reason === 'not_found') {
        response.status(404).json({ error: 'Domain not found.' });
        return;
      }

      if (providerUpdate.reason === 'self_target') {
        response.status(400).json({ error: 'A domain cannot use itself as its auth provider.' });
        return;
      }
    }
  }

  invalidateDomainCache();
  response.json({
    domains: await getVisibleManagedDomainsForSessionUser(request.sessionUser!),
    supportedDomains: await getSupportedDomains()
  });
});

router.post('/api/links', requireAuthenticatedUser, async (request, response) => {
  const parsedBody = createLinkSchema.safeParse(request.body);

  if (!parsedBody.success) {
    response.status(400).json({
      error: 'Invalid link payload.',
      issues: parsedBody.error.issues
    });
    return;
  }

  const supportedHosts = new Set((await getSupportedDomains()).map((domain) => domain.host));
  if (!supportedHosts.has(parsedBody.data.canonicalHost)) {
    response.status(400).json({ error: 'Unsupported host selected.' });
    return;
  }

  try {
    const { userRecord, allowedCanonicalHosts } = await syncAuthenticatedUserRecord(
      request.sessionUser!
    );

    if (
      !request.sessionUser!.isSuperAdmin &&
      !allowedCanonicalHosts.includes(parsedBody.data.canonicalHost.toLowerCase())
    ) {
      response.status(403).json({ error: 'You do not have access to create links on that host.' });
      return;
    }

    const link = await createLink({
      slug: parsedBody.data.slug.toLowerCase(),
      canonicalHost: parsedBody.data.canonicalHost.toLowerCase(),
      destinationUrl: parsedBody.data.destinationUrl,
      description: parsedBody.data.description,
      internalOnly: parsedBody.data.internalOnly,
      password: parsedBody.data.password ?? null,
      createdByUserId: userRecord.id,
      scheduleTimezone: userRecord.default_schedule_timezone
    });

    await primeCachedRedirectLink({
      ...link,
      has_schedule: false,
      active_scheduled_destination_url: null
    });

    response.status(201).json({ link: serializeLink(link) });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: 'That short link already exists for the selected host.' });
      return;
    }

    response.status(500).json({ error: 'Unable to create link.' });
  }
});

router.patch('/api/links/:linkId', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);
  const parsedBody = updateLinkSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid update payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
  if (!existingLink) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner =
    existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to edit this link.' });
    return;
  }

  const supportedHosts = new Set((await getSupportedDomains()).map((domain) => domain.host));
  const requestedCanonicalHost = parsedBody.data.canonicalHost.toLowerCase();
  if (!supportedHosts.has(requestedCanonicalHost)) {
    response.status(400).json({ error: 'Unsupported host selected.' });
    return;
  }

  if (!request.sessionUser!.isSuperAdmin && requestedCanonicalHost !== existingLink.canonical_host) {
    const { allowedCanonicalHosts } = await syncAuthenticatedUserRecord(request.sessionUser!);

    if (!allowedCanonicalHosts.includes(requestedCanonicalHost)) {
      response.status(403).json({ error: 'You do not have access to move this link to that host.' });
      return;
    }
  }

  try {
    const updatedLink = await updateLink({
      linkId: existingLink.id,
      slug: parsedBody.data.slug.toLowerCase(),
      canonicalHost: requestedCanonicalHost,
      destinationUrl: parsedBody.data.destinationUrl,
      internalOnly: parsedBody.data.internalOnly
    });

    if (!updatedLink) {
      response.status(500).json({ error: 'Unable to update link.' });
      return;
    }

    await Promise.all([
      invalidateCachedRedirectLink(existingLink.canonical_host, existingLink.slug),
      invalidateCachedRedirectLink(updatedLink.canonical_host, updatedLink.slug)
    ]);

    response.json({ link: serializeLink(updatedLink) });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: 'That short link already exists for the selected host.' });
      return;
    }

    response.status(500).json({ error: 'Unable to update link.' });
  }
});

router.delete('/api/links/:linkId', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    response.status(400).json({
      error: 'Invalid link id.',
      issues: parsedParams.error.issues
    });
    return;
  }

  const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
  if (!existingLink) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner =
    existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to delete this link.' });
    return;
  }

  const deleted = await deleteLink(existingLink.id);
  if (!deleted) {
    response.status(500).json({ error: 'Unable to delete link.' });
    return;
  }

  await invalidateCachedRedirectLink(existingLink.canonical_host, existingLink.slug);

  response.status(204).send();
});

router.patch('/api/links/:linkId/disabled', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);
  const parsedBody = updateLinkDisabledStateSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid disabled-state payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
  if (!existingLink) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner =
    existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to disable this link.' });
    return;
  }

  const updatedLink = await updateLinkDisabledState({
    linkId: existingLink.id,
    isDisabled: parsedBody.data.isDisabled
  });

  if (!updatedLink) {
    response.status(500).json({ error: 'Unable to update link state.' });
    return;
  }

  await Promise.all([
    invalidateCachedRedirectLink(existingLink.canonical_host, existingLink.slug),
    invalidateCachedRedirectLink(updatedLink.canonical_host, updatedLink.slug)
  ]);

  response.json({ link: serializeLink(updatedLink) });
});

router.put('/api/links/:linkId/config', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);
  const parsedBody = updateLinkConfigurationSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid link configuration payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
  if (!existingLink) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner =
    existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to configure this link.' });
    return;
  }

  const supportedHosts = new Set((await getSupportedDomains()).map((domain) => domain.host));
  const requestedCanonicalHost = parsedBody.data.canonicalHost.toLowerCase();
  if (!supportedHosts.has(requestedCanonicalHost)) {
    response.status(400).json({ error: 'Unsupported host selected.' });
    return;
  }

  if (!request.sessionUser!.isSuperAdmin && requestedCanonicalHost !== existingLink.canonical_host) {
    const { allowedCanonicalHosts } = await syncAuthenticatedUserRecord(request.sessionUser!);

    if (!allowedCanonicalHosts.includes(requestedCanonicalHost)) {
      response.status(403).json({ error: 'You do not have access to move this link to that host.' });
      return;
    }
  }

  if (!isSupportedUsTimeZone(parsedBody.data.scheduleTimezone)) {
    response.status(400).json({ error: 'Schedule timezone must be a supported US timezone.' });
    return;
  }

  let normalizedSchedules: Array<{
    startMinute: number;
    endMinute: number;
    destinationUrl: string;
  }> = [];
  let normalizedRotationIntervalMinutes: number | null = null;
  let normalizedRotationDestinations: Array<{
    destinationUrl: string;
  }> = [];

  if (parsedBody.data.scheduleMode === 'windows') {
    try {
      normalizedSchedules = normalizeScheduledDestinations(parsedBody.data.schedules);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid schedule configuration.'
      });
      return;
    }
  } else {
    normalizedRotationDestinations = normalizeRotationDestinations(parsedBody.data.rotationDestinations);

    if (
      (parsedBody.data.rotationIntervalMinutes ?? null) === null &&
      normalizedRotationDestinations.length > 0
    ) {
      response.status(400).json({
        error: 'Rotation interval is required when rotation destinations are configured.'
      });
      return;
    }

    if (
      (parsedBody.data.rotationIntervalMinutes ?? null) !== null &&
      normalizedRotationDestinations.length === 0
    ) {
      response.status(400).json({
        error: 'Add at least one rotation destination when rotation mode is configured.'
      });
      return;
    }

    if (
      parsedBody.data.rotationIntervalMinutes !== null &&
      parsedBody.data.rotationIntervalMinutes * normalizedRotationDestinations.length > 24 * 60
    ) {
      response.status(400).json({
        error: 'Rotation schedules must fit within a 24-hour day.'
      });
      return;
    }

    normalizedRotationIntervalMinutes = parsedBody.data.rotationIntervalMinutes ?? null;
  }

  const hasActiveSubtrackers = hasActiveLinkSubtrackers(parsedBody.data.subtrackers);
  const hasActivePasswords = hasActiveLinkPasswords(parsedBody.data.passwords);

  if (parsedBody.data.requiresTrackingId && !hasActiveSubtrackers) {
    response.status(400).json({
      error: 'Add at least one active tagged link when tracking IDs are required.'
    });
    return;
  }

  if (hasDuplicateLinkPasswords(parsedBody.data.passwords)) {
    response.status(400).json({
      error: 'Each password must be unique for a link.'
    });
    return;
  }

  try {
    const updatePassword = Object.prototype.hasOwnProperty.call(parsedBody.data, 'password');
    const passwordHash = updatePassword
      ? parsedBody.data.password === null
        ? null
        : parsedBody.data.password
          ? await hashLinkPassword(parsedBody.data.password)
          : null
      : null;

    const updatedLink = await replaceLinkConfiguration({
      linkId: existingLink.id,
      slug: parsedBody.data.slug.toLowerCase(),
      canonicalHost: requestedCanonicalHost,
      destinationUrl: parsedBody.data.destinationUrl,
      description: parsedBody.data.description,
      internalOnly: parsedBody.data.internalOnly,
      isListed: request.sessionUser!.isSuperAdmin
        ? parsedBody.data.isListed ?? existingLink.is_listed
        : existingLink.is_listed,
      isDisabled: parsedBody.data.isDisabled,
      waitingRoomEnabled: parsedBody.data.waitingRoomEnabled,
      requiresTrackingId: parsedBody.data.requiresTrackingId,
      rememberPasswordAccess: parsedBody.data.rememberPasswordAccess,
      disabledDestinationUrl: parsedBody.data.disabledDestinationUrl ?? null,
      expiresAt: parsedBody.data.expirationAt ?? null,
      scheduleTimezone: parsedBody.data.scheduleTimezone,
      scheduleMode: parsedBody.data.scheduleMode,
      schedules: normalizedSchedules,
      rotationIntervalMinutes: normalizedRotationIntervalMinutes,
      rotationDestinations: normalizedRotationDestinations,
      updatePassword,
      passwordHash,
      subtrackers: parsedBody.data.subtrackers.map((subtracker) => ({
        id: subtracker.id,
        name: subtracker.name,
        isDisabled: subtracker.isDisabled ?? false
      })),
      passwords: parsedBody.data.passwords.map((password) => ({
        id: password.id,
        name: password.name,
        password: password.password,
        isDisabled: password.isDisabled ?? false
      }))
    });

    if (!updatedLink) {
      response.status(500).json({ error: 'Unable to update link configuration.' });
      return;
    }

    await Promise.all([
      invalidateCachedRedirectLink(existingLink.canonical_host, existingLink.slug),
      invalidateCachedRedirectLink(updatedLink.canonical_host, updatedLink.slug)
    ]);

    const isExpired =
      updatedLink.expires_at !== null && Date.parse(updatedLink.expires_at) <= Date.now();
    const hasRotationSchedule = Boolean(updatedLink.rotation_schedule?.destinations.length);
    if (
      updatedLink.schedules.length === 0 &&
      !hasRotationSchedule &&
      !updatedLink.is_disabled &&
      !isExpired
    ) {
      await primeCachedRedirectLink({
        ...updatedLink,
        has_schedule: false,
        active_scheduled_destination_url: null
      });
    }

    response.json({ link: serializeApiLinkConfiguration(updatedLink) });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: 'That short link already exists for the selected host.' });
      return;
    }

    if (
      error instanceof Error &&
      (error.message === 'Link sub-tracker not found.' ||
        error.message === 'Link password not found.' ||
        error.message === 'That password is already configured for this link.')
    ) {
      response.status(400).json({ error: error.message });
      return;
    }

    response.status(500).json({ error: 'Unable to update link configuration.' });
  }
});

router.post('/api/links/:linkId/subtrackers', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);
  const parsedBody = createLinkSubtrackerSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid sub-tracker payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
  if (!existingLink) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner =
    existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to configure this link.' });
    return;
  }

  try {
    const subtracker = await createLinkSubtracker({
      linkId: existingLink.id,
      name: parsedBody.data.name
    });

    response.status(201).json({
      subtracker: {
        id: subtracker.id,
        name: subtracker.name,
        trackingId: subtracker.tracking_id,
        isDisabled: subtracker.is_disabled,
        usageCount: subtracker.usage_count,
        created_at: subtracker.created_at
      }
    });
  } catch {
    response.status(500).json({ error: 'Unable to create tagged link.' });
  }
});

router.patch(
  '/api/links/:linkId/subtrackers/:subtrackerId',
  requireAuthenticatedUser,
  async (request, response) => {
    const parsedParams = linkSubtrackerParamsSchema.safeParse(request.params);
    const parsedBody = updateLinkSubtrackerDisabledStateSchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      response.status(400).json({
        error: 'Invalid sub-tracker request.',
        issues: [
          ...(parsedParams.success ? [] : parsedParams.error.issues),
          ...(parsedBody.success ? [] : parsedBody.error.issues)
        ]
      });
      return;
    }

    const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
    if (!existingLink) {
      response.status(404).json({ error: 'Link not found.' });
      return;
    }

    const isOwner =
      existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to configure this link.' });
    return;
  }

  const linkConfig = await findLinkConfigurationByPublicId(parsedParams.data.linkId);

  if (existingLink.requires_tracking_id && parsedBody.data.isDisabled) {
    const targetSubtracker = linkConfig?.subtrackers.find(
      (subtracker) => subtracker.id === parsedParams.data.subtrackerId
    );
      const remainingActiveSubtrackers =
        linkConfig?.subtrackers.filter(
          (subtracker) =>
            subtracker.id !== parsedParams.data.subtrackerId && !subtracker.is_disabled
        ) ?? [];

      if (targetSubtracker && !targetSubtracker.is_disabled && remainingActiveSubtrackers.length === 0) {
        response.status(400).json({
          error: 'Add another active tagged link before disabling this one.'
        });
        return;
      }
    }

    const subtracker = await updateLinkSubtrackerDisabledState({
      linkId: existingLink.id,
      subtrackerId: parsedParams.data.subtrackerId,
      isDisabled: parsedBody.data.isDisabled
    });

    if (!subtracker) {
      response.status(404).json({ error: 'Tagged link not found.' });
      return;
    }

    response.json({
      subtracker: {
        id: subtracker.id,
        name: subtracker.name,
        trackingId: subtracker.tracking_id,
        isDisabled: subtracker.is_disabled,
        usageCount: subtracker.usage_count
      }
    });
  }
);

router.post('/api/links/:linkId/passwords', requireAuthenticatedUser, async (request, response) => {
  const parsedParams = linkIdParamsSchema.safeParse(request.params);
  const parsedBody = createLinkPasswordSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    response.status(400).json({
      error: 'Invalid password payload.',
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues)
      ]
    });
    return;
  }

  const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
  if (!existingLink) {
    response.status(404).json({ error: 'Link not found.' });
    return;
  }

  const isOwner =
    existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
  if (!isOwner && !request.sessionUser!.isSuperAdmin) {
    response.status(403).json({ error: 'You do not have permission to configure this link.' });
    return;
  }

  try {
    const password = await createLinkPassword({
      linkId: existingLink.id,
      name: parsedBody.data.name,
      password: parsedBody.data.password
    });

    await invalidateCachedRedirectLink(existingLink.canonical_host, existingLink.slug);

    response.status(201).json({
      password: {
        id: password.id,
        name: password.name,
        password: password.password,
        isDisabled: password.is_disabled,
        usageCount: password.usage_count,
        created_at: password.created_at
      }
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'That password is already configured for this link.'
    ) {
      response.status(400).json({ error: error.message });
      return;
    }

    response.status(500).json({ error: 'Unable to create password.' });
  }
});

router.patch(
  '/api/links/:linkId/passwords/:passwordId',
  requireAuthenticatedUser,
  async (request, response) => {
    const parsedParams = linkPasswordParamsSchema.safeParse(request.params);
    const parsedBody = updateLinkPasswordDisabledStateSchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      response.status(400).json({
        error: 'Invalid password request.',
        issues: [
          ...(parsedParams.success ? [] : parsedParams.error.issues),
          ...(parsedBody.success ? [] : parsedBody.error.issues)
        ]
      });
      return;
    }

    const existingLink = await findLinkByPublicId(parsedParams.data.linkId);
    if (!existingLink) {
      response.status(404).json({ error: 'Link not found.' });
      return;
    }

    const isOwner =
      existingLink.created_by_email.toLowerCase() === request.sessionUser!.email.toLowerCase();
    if (!isOwner && !request.sessionUser!.isSuperAdmin) {
      response.status(403).json({ error: 'You do not have permission to configure this link.' });
      return;
    }

    const password = await updateLinkPasswordDisabledState({
      linkId: existingLink.id,
      passwordId: parsedParams.data.passwordId,
      isDisabled: parsedBody.data.isDisabled
    });

    if (!password) {
      response.status(404).json({ error: 'Password not found.' });
      return;
    }

    await invalidateCachedRedirectLink(existingLink.canonical_host, existingLink.slug);

    response.json({
      password: {
        id: password.id,
        name: password.name,
        password: password.password,
        isDisabled: password.is_disabled,
        usageCount: password.usage_count
      }
    });
  }
);

export const apiRouter = router;
