import { DatabaseError, type PoolClient } from 'pg';

import { createLinkPublicId, createLinkSubtrackerId } from '../services/link-public-id.js';
import { getTenMinuteBucketStart } from '../services/usage-buckets.js';
import { pool } from './pool.js';

export type LinkRow = {
  id: string;
  public_id: string;
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
  remember_password_access: boolean;
  password_hash: string | null;
  has_link_passwords: boolean;
  has_legacy_password_prompt: boolean;
  has_password: boolean;
  usage_count: number;
  schedule_timezone: string;
  schedule_mode: 'windows' | 'rotation';
  owner_default_schedule_timezone: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

export type RedirectLinkRow = LinkRow & {
  has_schedule: boolean;
  active_scheduled_destination_url: string | null;
};

export type ListedLinkRow = LinkRow & {
  has_schedule: boolean;
  current_destination_url: string;
};

export type LinkRecord = Omit<
  LinkRow,
  | 'id'
  | 'public_id'
  | 'owner_default_schedule_timezone'
  | 'remember_password_access'
  | 'password_hash'
  | 'has_link_passwords'
  | 'has_legacy_password_prompt'
> & {
  id: string;
  has_schedule?: boolean;
  current_destination_url?: string;
};

export type LinkScheduleRecord = {
  id: string;
  start_minute: number;
  end_minute: number;
  start_time: string;
  end_time: string;
  destination_url: string;
};

export type LinkRotationDestinationRecord = {
  id: string;
  destination_url: string;
};

export type LinkRotationScheduleRecord = {
  interval_minutes: number;
  destinations: LinkRotationDestinationRecord[];
};

export type LinkSubtrackerRow = {
  id: string;
  link_id: string;
  name: string;
  tracking_id: string;
  is_disabled: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
};

export type LinkSubtrackerRecord = Omit<LinkSubtrackerRow, 'link_id'>;

export type RedirectLinkSubtrackerRecord = {
  id: string;
  link_id: string;
  link_slug: string;
  tracking_id: string;
  is_disabled: boolean;
};

export type LinkPasswordRow = {
  id: string;
  link_id: string;
  name: string;
  password: string;
  is_disabled: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
};

export type LinkPasswordRecord = Omit<LinkPasswordRow, 'link_id'>;

export type LinkConfigurationRow = LinkRow & {
  schedules: LinkScheduleRecord[];
  rotation_schedule: LinkRotationScheduleRecord | null;
  subtrackers: LinkSubtrackerRecord[];
  passwords: LinkPasswordRecord[];
};

export type LinkConfigurationRecord = LinkRecord & {
  schedules: LinkScheduleRecord[];
  rotation_schedule: LinkRotationScheduleRecord | null;
  subtrackers: LinkSubtrackerRecord[];
  passwords: LinkPasswordRecord[];
};

type PaginatedLinkRows = {
  links: ListedLinkRow[];
  page: number;
  pageSize: number;
  totalLinks: number;
  totalPages: number;
};

export type LinkVisibilityFilter = 'all' | 'public' | 'internal';
export type LinkScheduleFilter = 'all' | 'static' | 'scheduled';
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

export type PaginatedLinkRecords = {
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

export type LinkAnalyticsRecords = {
  overview: LinkAnalyticsOverview;
  topLinks: LinkRecord[];
  domainBreakdown: LinkAnalyticsDomainBreakdown[];
  creatorBreakdown: LinkAnalyticsCreatorBreakdown[];
  timeSeries: LinkAnalyticsTimeSeries;
};

type LinkListInput = {
  page: number;
  pageSize: number;
  createdByEmail?: string;
  listedOnly?: boolean;
  allowedCanonicalHosts?: string[];
  searchQuery?: string;
  canonicalHost?: string;
  visibility: LinkVisibilityFilter;
  schedule: LinkScheduleFilter;
  sort: LinkSortOption;
};

type LinkAnalyticsScopeInput = {
  linkId?: string | number;
  createdByEmail?: string;
  timeWindow: LinkAnalyticsTimeWindow;
};

const activeLinkPasswordExistsSql = `
  exists (
    select 1
    from link_passwords
    where link_passwords.link_id = links.id
      and link_passwords.is_disabled = false
  )
`;

const linkSelectColumns = `
  links.id,
  links.public_id,
  links.slug,
  links.canonical_host,
  links.destination_url,
  links.disabled_destination_url,
  links.waiting_room_enabled,
  links.expires_at::text,
  links.description,
  links.internal_only,
  links.is_listed,
  links.is_disabled,
  links.requires_tracking_id,
  links.remember_password_access,
  links.password_hash,
  ${activeLinkPasswordExistsSql} as has_link_passwords,
  (links.password_hash is not null) as has_legacy_password_prompt,
  ((links.password_hash is not null) or ${activeLinkPasswordExistsSql}) as has_password,
  links.usage_count,
  links.schedule_timezone,
  links.schedule_mode,
  users.default_schedule_timezone as owner_default_schedule_timezone,
  users.email as created_by_email,
  links.created_at::text,
  links.updated_at::text
`;

const scheduledLinkExistsSql = `
  (
    (links.schedule_mode = 'rotation' and exists (
      select 1
      from link_rotation_schedule_destinations rotation_destinations
      where rotation_destinations.link_id = links.id
    ))
    or
    (links.schedule_mode = 'windows' and exists (
      select 1
      from link_destination_schedules schedules
      where schedules.link_id = links.id
    ))
  )
`;

function isPublicIdUniqueViolation(error: unknown) {
  return (
    error instanceof DatabaseError &&
    error.code === '23505' &&
    error.constraint === 'idx_links_public_id'
  );
}

function isSubtrackerTrackingIdUniqueViolation(error: unknown) {
  return (
    error instanceof DatabaseError &&
    error.code === '23505' &&
    (error.constraint === 'link_subtrackers_link_id_tracking_id_key' ||
      error.constraint === 'link_subtrackers_tracking_id_key')
  );
}

function isLinkPasswordUniqueViolation(error: unknown) {
  return (
    error instanceof DatabaseError &&
    error.code === '23505' &&
    error.constraint === 'link_passwords_link_id_password_key'
  );
}

export function serializeLink(link: LinkRow): LinkRecord {
  const {
    id: _internalId,
    public_id,
    remember_password_access: _rememberPasswordAccess,
    password_hash,
    has_link_passwords: _hasLinkPasswords,
    has_legacy_password_prompt: _hasLegacyPasswordPrompt,
    owner_default_schedule_timezone: _ownerDefaultScheduleTimezone,
    ...rest
  } = link;
  return {
    id: public_id,
    ...rest
  };
}

function getCurrentMinuteOfDay(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

  return hour * 60 + minute;
}

function getEffectiveScheduleTimeZone(
  link: Pick<LinkRow, 'schedule_mode' | 'schedule_timezone' | 'owner_default_schedule_timezone'>
) {
  return link.schedule_mode === 'rotation'
    ? link.owner_default_schedule_timezone
    : link.schedule_timezone;
}

function getCurrentRotationDestination(
  intervalMinutes: number,
  destinations: Array<{ destination_url: string }>,
  currentMinute: number
) {
  if (intervalMinutes <= 0 || destinations.length === 0) {
    return null;
  }

  const rotationIndex = Math.floor(currentMinute / intervalMinutes) % destinations.length;
  return destinations[rotationIndex]?.destination_url ?? null;
}

async function listLinkRotationSchedule(linkId: string | number) {
  const [rotationResult, destinationsResult] = await Promise.all([
    pool.query<{ interval_minutes: number }>(
      `
        select interval_minutes
        from link_rotation_schedules
        where link_id = $1
        limit 1
      `,
      [linkId]
    ),
    pool.query<LinkRotationDestinationRecord>(
      `
        select
          id,
          destination_url
        from link_rotation_schedule_destinations
        where link_id = $1
        order by sort_order asc, id asc
      `,
      [linkId]
    )
  ]);

  const rotationSchedule = rotationResult.rows[0];
  if (!rotationSchedule) {
    return null;
  }

  return {
    interval_minutes: rotationSchedule.interval_minutes,
    destinations: destinationsResult.rows
  } satisfies LinkRotationScheduleRecord;
}

async function attachLinkScheduleState(links: LinkRow[]): Promise<ListedLinkRow[]> {
  if (links.length === 0) {
    return [];
  }

  const linkIds = links.map((link) => link.id);
  const [windowSchedulesResult, rotationSchedulesResult, rotationDestinationsResult] = await Promise.all([
    pool.query<{
      link_id: string;
      start_minute: number;
      end_minute: number;
      destination_url: string;
    }>(
      `
        select
          link_id,
          start_minute,
          end_minute,
          destination_url
        from link_destination_schedules
        where link_id = any($1::bigint[])
        order by link_id asc, start_minute asc, id asc
      `,
      [linkIds]
    ),
    pool.query<{
      link_id: string;
      interval_minutes: number;
    }>(
      `
        select
          link_id,
          interval_minutes
        from link_rotation_schedules
        where link_id = any($1::bigint[])
      `,
      [linkIds]
    ),
    pool.query<{
      link_id: string;
      destination_url: string;
    }>(
      `
        select
          link_id,
          destination_url
        from link_rotation_schedule_destinations
        where link_id = any($1::bigint[])
        order by link_id asc, sort_order asc, id asc
      `,
      [linkIds]
    )
  ]);

  const schedulesByLinkId = new Map<string, typeof windowSchedulesResult.rows>();
  for (const schedule of windowSchedulesResult.rows) {
    const schedules = schedulesByLinkId.get(schedule.link_id) ?? [];
    schedules.push(schedule);
    schedulesByLinkId.set(schedule.link_id, schedules);
  }

  const rotationIntervalsByLinkId = new Map(
    rotationSchedulesResult.rows.map((row) => [row.link_id, row.interval_minutes])
  );
  const rotationDestinationsByLinkId = new Map<string, typeof rotationDestinationsResult.rows>();
  for (const destination of rotationDestinationsResult.rows) {
    const destinations = rotationDestinationsByLinkId.get(destination.link_id) ?? [];
    destinations.push(destination);
    rotationDestinationsByLinkId.set(destination.link_id, destinations);
  }

  const minuteByTimeZone = new Map<string, number>();

  return links.map((link) => {
    const effectiveScheduleTimeZone = getEffectiveScheduleTimeZone(link);
    const currentMinute =
      minuteByTimeZone.get(effectiveScheduleTimeZone) ??
      getCurrentMinuteOfDay(effectiveScheduleTimeZone);
    minuteByTimeZone.set(effectiveScheduleTimeZone, currentMinute);

    if (link.schedule_mode === 'rotation') {
      const intervalMinutes = rotationIntervalsByLinkId.get(link.id) ?? 0;
      const destinations = rotationDestinationsByLinkId.get(link.id) ?? [];
      const activeDestinationUrl = getCurrentRotationDestination(
        intervalMinutes,
        destinations,
        currentMinute
      );

      return {
        ...link,
        has_schedule: intervalMinutes > 0 && destinations.length > 0,
        current_destination_url: activeDestinationUrl ?? link.destination_url
      };
    }

    const schedules = schedulesByLinkId.get(link.id) ?? [];
    if (schedules.length === 0) {
      return {
        ...link,
        has_schedule: false,
        current_destination_url: link.destination_url
      };
    }

    const activeSchedule = schedules.find(
      (schedule) =>
        schedule.start_minute <= currentMinute && schedule.end_minute > currentMinute
    );

    return {
      ...link,
      has_schedule: true,
      current_destination_url: activeSchedule?.destination_url ?? link.destination_url
    };
  });
}

export function serializePaginatedLinks(result: PaginatedLinkRows): PaginatedLinkRecords {
  return {
    ...result,
    links: result.links.map(serializeLink)
  };
}

function serializeListedLink(link: ListedLinkRow): LinkRecord {
  return {
    ...serializeLink(link),
    has_schedule: link.has_schedule,
    current_destination_url: link.current_destination_url
  };
}

export function serializeLinkConfiguration(link: LinkConfigurationRow): LinkConfigurationRecord {
  return {
    ...serializeLink(link),
    schedules: link.schedules,
    rotation_schedule: link.rotation_schedule,
    subtrackers: link.subtrackers,
    passwords: link.passwords
  };
}

async function listLinkSchedules(linkId: string | number) {
  const result = await pool.query<LinkScheduleRecord>(
    `
      select
        id,
        start_minute,
        end_minute,
        case
          when start_minute = 1440 then '24:00'
          else lpad((start_minute / 60)::text, 2, '0') || ':' || lpad((start_minute % 60)::text, 2, '0')
        end as start_time,
        case
          when end_minute = 1440 then '24:00'
          else lpad((end_minute / 60)::text, 2, '0') || ':' || lpad((end_minute % 60)::text, 2, '0')
        end as end_time,
        destination_url
      from link_destination_schedules
      where link_id = $1
      order by start_minute asc, id asc
    `,
    [linkId]
  );

  return result.rows;
}

async function listLinkSubtrackers(
  linkId: string | number,
  client: Pick<PoolClient, 'query'> = pool
) {
  const result = await client.query<LinkSubtrackerRow>(
    `
      select
        id,
        link_id,
        name,
        tracking_id,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
      from link_subtrackers
      where link_id = $1
      order by is_disabled asc, created_at asc, id asc
    `,
    [linkId]
  );

  return result.rows.map(({ link_id: _linkId, ...subtracker }) => subtracker);
}

async function listLinkPasswords(
  linkId: string | number,
  client: Pick<PoolClient, 'query'> = pool
) {
  const result = await client.query<LinkPasswordRow>(
    `
      select
        id,
        link_id,
        name,
        password,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
      from link_passwords
      where link_id = $1
      order by is_disabled asc, created_at asc, id asc
    `,
    [linkId]
  );

  return result.rows.map(({ link_id: _linkId, ...password }) => password);
}

export async function findLinkById(linkId: string | number) {
  const result = await pool.query<LinkRow>(
    `
      select
        ${linkSelectColumns}
      from links
      inner join users on users.id = links.created_by_user_id
      where links.id = $1
      limit 1
    `,
    [linkId]
  );

  return result.rows[0] ?? null;
}

export async function findLinkByPublicId(linkPublicId: string) {
  const result = await pool.query<LinkRow>(
    `
      select
        ${linkSelectColumns}
      from links
      inner join users on users.id = links.created_by_user_id
      where links.public_id = $1
      limit 1
    `,
    [linkPublicId]
  );

  return result.rows[0] ?? null;
}

export async function findLinkByCanonicalHostAndSlug(canonicalHost: string, slug: string) {
  const result = await pool.query<LinkRow>(
    `
      select
        ${linkSelectColumns}
      from links
      inner join users on users.id = links.created_by_user_id
      where lower(links.canonical_host) = lower($1)
        and lower(links.slug) = lower($2)
      limit 1
    `,
    [canonicalHost, slug]
  );

  return result.rows[0] ?? null;
}

export async function findLinkSubtrackerByLinkIdAndTrackingId(
  linkId: string | number,
  trackingId: string
) {
  const result = await pool.query<LinkSubtrackerRow>(
    `
      select
        id,
        link_id,
        name,
        tracking_id,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
      from link_subtrackers
      where link_id = $1
        and tracking_id = $2
      limit 1
    `,
    [linkId, trackingId]
  );

  const subtracker = result.rows[0];
  if (!subtracker) {
    return null;
  }

  const { link_id: _linkId, ...record } = subtracker;
  return record satisfies LinkSubtrackerRecord;
}

export async function findRedirectLinkSubtrackerByCanonicalHostAndTrackingId(
  canonicalHost: string,
  trackingId: string
) {
  const result = await pool.query<RedirectLinkSubtrackerRecord>(
    `
      select
        link_subtrackers.id,
        link_subtrackers.link_id,
        links.slug as link_slug,
        link_subtrackers.tracking_id,
        link_subtrackers.is_disabled
      from link_subtrackers
      inner join links on links.id = link_subtrackers.link_id
      where lower(links.canonical_host) = lower($1)
        and link_subtrackers.tracking_id = $2
      limit 2
    `,
    [canonicalHost, trackingId]
  );

  if (result.rows.length !== 1) {
    return null;
  }

  return result.rows[0];
}

export async function isLinkPathSegmentAvailable(canonicalHost: string, pathSegment: string) {
  const result = await pool.query<{ is_available: boolean }>(
    `
      select
        not (
          exists (
            select 1
            from links
            where lower(canonical_host) = lower($1)
              and lower(slug) = lower($2)
          )
          or exists (
            select 1
            from link_subtrackers
            inner join links on links.id = link_subtrackers.link_id
            where lower(links.canonical_host) = lower($1)
              and lower(link_subtrackers.tracking_id) = lower($2)
          )
        ) as is_available
    `,
    [canonicalHost, pathSegment]
  );

  return result.rows[0]?.is_available ?? false;
}

export async function findLinkPasswordByLinkIdAndPassword(
  linkId: string | number,
  password: string
) {
  const result = await pool.query<LinkPasswordRow>(
    `
      select
        id,
        link_id,
        name,
        password,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
      from link_passwords
      where link_id = $1
        and password = $2
      limit 1
    `,
    [linkId, password]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const { link_id: _linkId, ...record } = row;
  return record satisfies LinkPasswordRecord;
}

export async function findLinkPasswordByLinkIdAndId(
  linkId: string | number,
  passwordId: string | number
) {
  const result = await pool.query<LinkPasswordRow>(
    `
      select
        id,
        link_id,
        name,
        password,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
      from link_passwords
      where link_id = $1
        and id = $2
      limit 1
    `,
    [linkId, passwordId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const { link_id: _linkId, ...record } = row;
  return record satisfies LinkPasswordRecord;
}

function buildLinkListWhereClause(input: LinkListInput) {
  const clauses: string[] = [];
  const values: Array<string | number | string[]> = [];

  if (input.createdByEmail) {
    values.push(input.createdByEmail);
    clauses.push(`lower(users.email) = lower($${values.length})`);
  }

  if (input.listedOnly) {
    clauses.push('links.is_listed = true');
  }

  if (input.allowedCanonicalHosts) {
    const normalizedAllowedCanonicalHosts = [
      ...new Set(
        input.allowedCanonicalHosts
          .map((host) => host.trim().toLowerCase())
          .filter((host) => host.length > 0)
      )
    ];

    if (normalizedAllowedCanonicalHosts.length === 0) {
      clauses.push('false');
    } else {
      values.push(normalizedAllowedCanonicalHosts);
      clauses.push(`lower(links.canonical_host) = any($${values.length}::text[])`);
    }
  }

  if (input.searchQuery) {
    values.push(`%${input.searchQuery.toLowerCase()}%`);
    clauses.push(`(
      lower(links.slug) like $${values.length}
      or lower(links.canonical_host) like $${values.length}
      or lower(links.canonical_host || '/' || links.slug) like $${values.length}
      or lower('https://' || links.canonical_host || '/' || links.slug) like $${values.length}
      or lower('http://' || links.canonical_host || '/' || links.slug) like $${values.length}
      or lower(links.destination_url) like $${values.length}
      or coalesce(lower(links.description), '') like $${values.length}
      or lower(users.email) like $${values.length}
    )`);
  }

  if (input.canonicalHost) {
    values.push(input.canonicalHost);
    clauses.push(`lower(links.canonical_host) = lower($${values.length})`);
  }

  if (input.visibility === 'public') {
    clauses.push('links.internal_only = false');
  } else if (input.visibility === 'internal') {
    clauses.push('links.internal_only = true');
  }

  if (input.schedule === 'scheduled') {
    clauses.push(scheduledLinkExistsSql);
  } else if (input.schedule === 'static') {
    clauses.push(`not ${scheduledLinkExistsSql}`);
  }

  return {
    whereSql: clauses.length > 0 ? `where ${clauses.join('\n        and ')}` : '',
    values
  };
}

function buildLinkAnalyticsWhereClause(input: LinkAnalyticsScopeInput) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (input.linkId) {
    values.push(input.linkId);
    clauses.push(`links.id = $${values.length}`);
  }

  if (input.createdByEmail) {
    values.push(input.createdByEmail);
    clauses.push(`lower(users.email) = lower($${values.length})`);
  }

  return {
    whereSql: clauses.length > 0 ? `where ${clauses.join('\n        and ')}` : '',
    values
  };
}

function getLinkAnalyticsWindowStart(timeWindow: Exclude<LinkAnalyticsTimeWindow, 'all'>) {
  const now = Date.now();

  switch (timeWindow) {
    case '4h':
      return new Date(now - 4 * 60 * 60 * 1_000).toISOString();
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1_000).toISOString();
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1_000).toISOString();
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1_000).toISOString();
    case '90d':
      return new Date(now - 90 * 24 * 60 * 60 * 1_000).toISOString();
  }

  return new Date(now).toISOString();
}

function getLinkAnalyticsWindowUsageSource(timeWindow: Exclude<LinkAnalyticsTimeWindow, 'all'>) {
  if (timeWindow === '4h') {
    return {
      tableName: 'link_usage_ten_minute',
      timeColumn: 'bucket_start'
    } as const;
  }

  return {
    tableName: 'link_usage_hourly',
    timeColumn: 'hour_start'
  } as const;
}

function getLinkAnalyticsTimeSeriesSpec(timeWindow: Exclude<LinkAnalyticsTimeWindow, '4h'>): {
  granularity: LinkAnalyticsTimeSeriesGranularity;
  bucketTrunc: 'hour' | 'day' | 'week' | 'month';
  stepInterval: '1 hour' | '1 day' | '1 week' | '1 month';
  windowStart?: string;
} {
  switch (timeWindow) {
    case '24h':
      return {
        granularity: 'hour',
        bucketTrunc: 'hour',
        stepInterval: '1 hour',
        windowStart: getLinkAnalyticsWindowStart('24h')
      };
    case '7d':
      return {
        granularity: 'day',
        bucketTrunc: 'day',
        stepInterval: '1 day',
        windowStart: getLinkAnalyticsWindowStart('7d')
      };
    case '30d':
      return {
        granularity: 'day',
        bucketTrunc: 'day',
        stepInterval: '1 day',
        windowStart: getLinkAnalyticsWindowStart('30d')
      };
    case '90d':
      return {
        granularity: 'week',
        bucketTrunc: 'week',
        stepInterval: '1 week',
        windowStart: getLinkAnalyticsWindowStart('90d')
      };
    case 'all':
      return {
        granularity: 'month',
        bucketTrunc: 'month',
        stepInterval: '1 month'
      };
  }
}

async function getLinkAnalyticsTimeSeries(input: LinkAnalyticsScopeInput): Promise<LinkAnalyticsTimeSeries> {
  if (input.timeWindow === '4h') {
    const { whereSql, values } = buildLinkAnalyticsWhereClause(input);
    const windowStart = getLinkAnalyticsWindowStart('4h');
    const seriesStart = getTenMinuteBucketStart(windowStart);
    const seriesEnd = getTenMinuteBucketStart(new Date().toISOString());
    const queryValues = [...values, windowStart, seriesStart, seriesEnd];
    const filteredUsageWhereSql = whereSql
      ? `${whereSql}\n        and link_usage_ten_minute.bucket_start >= $${values.length + 1}`
      : `where link_usage_ten_minute.bucket_start >= $${values.length + 1}`;

    const result = await pool.query<{
      bucket_start: string;
      total_uses: string;
    }>(
      `
        with filtered_usage as (
          select
            link_usage_ten_minute.bucket_start,
            link_usage_ten_minute.usage_count
          from link_usage_ten_minute
          inner join links on links.id = link_usage_ten_minute.link_id
          inner join users on users.id = links.created_by_user_id
          ${filteredUsageWhereSql}
        ),
        bucketed_usage as (
          select
            filtered_usage.bucket_start,
            sum(filtered_usage.usage_count)::integer as total_uses
          from filtered_usage
          group by 1
        ),
        series as (
          select
            generate_series(
              $${values.length + 2}::timestamptz,
              $${values.length + 3}::timestamptz,
              '10 minutes'::interval
            ) as bucket_start
        )
        select
          series.bucket_start::text as bucket_start,
          coalesce(bucketed_usage.total_uses, 0)::text as total_uses
        from series
        left join bucketed_usage on bucketed_usage.bucket_start = series.bucket_start
        order by series.bucket_start asc
      `,
      queryValues
    );

    return {
      granularity: 'tenMinutes',
      points: result.rows.map((row) => ({
        bucketStart: row.bucket_start,
        totalUses: Number(row.total_uses)
      }))
    };
  }

  const { whereSql, values } = buildLinkAnalyticsWhereClause(input);
  const spec = getLinkAnalyticsTimeSeriesSpec(input.timeWindow);
  const queryValues = [...values];
  let filteredUsageWhereSql = whereSql;
  let seriesStartExpression = '(select min(bucket_start) from bucketed_usage)';
  let seriesEndExpression = '(select max(bucket_start) from bucketed_usage)';

  if (spec.windowStart) {
    queryValues.push(spec.windowStart);
    filteredUsageWhereSql = filteredUsageWhereSql
      ? `${filteredUsageWhereSql}\n        and link_usage_hourly.hour_start >= $${queryValues.length}`
      : `where link_usage_hourly.hour_start >= $${queryValues.length}`;

    queryValues.push(spec.windowStart);
    seriesStartExpression = `date_trunc('${spec.bucketTrunc}', $${queryValues.length}::timestamptz)`;
    seriesEndExpression = `date_trunc('${spec.bucketTrunc}', now())`;
  }

  const result = await pool.query<{
    bucket_start: string;
    total_uses: string;
  }>(
    `
      with filtered_usage as (
        select
          link_usage_hourly.hour_start,
          link_usage_hourly.usage_count
        from link_usage_hourly
        inner join links on links.id = link_usage_hourly.link_id
        inner join users on users.id = links.created_by_user_id
        ${filteredUsageWhereSql}
      ),
      bucketed_usage as (
        select
          date_trunc('${spec.bucketTrunc}', filtered_usage.hour_start) as bucket_start,
          sum(filtered_usage.usage_count)::integer as total_uses
        from filtered_usage
        group by 1
      ),
      series as (
        select
          generate_series(
            ${seriesStartExpression},
            ${seriesEndExpression},
            '${spec.stepInterval}'::interval
          ) as bucket_start
      )
      select
        series.bucket_start::text as bucket_start,
        coalesce(bucketed_usage.total_uses, 0)::text as total_uses
      from series
      left join bucketed_usage on bucketed_usage.bucket_start = series.bucket_start
      order by series.bucket_start asc
    `,
    queryValues
  );

  return {
    granularity: spec.granularity,
    points: result.rows.map((row) => ({
      bucketStart: row.bucket_start,
      totalUses: Number(row.total_uses)
    }))
  };
}

function getLinkListOrderByClause(sort: LinkSortOption) {
  switch (sort) {
    case 'updatedAsc':
      return 'links.updated_at asc, links.id asc';
    case 'createdDesc':
      return 'links.created_at desc, links.id desc';
    case 'createdAsc':
      return 'links.created_at asc, links.id asc';
    case 'usageDesc':
      return 'links.usage_count desc, links.updated_at desc, links.id desc';
    case 'usageAsc':
      return 'links.usage_count asc, links.updated_at desc, links.id desc';
    case 'slugAsc':
      return 'lower(links.slug) asc, links.id asc';
    case 'slugDesc':
      return 'lower(links.slug) desc, links.id desc';
    case 'hostAsc':
      return 'reverse(lower(links.canonical_host)) asc, lower(links.canonical_host) asc, lower(links.slug) asc, links.id asc';
    case 'hostDesc':
      return 'reverse(lower(links.canonical_host)) desc, lower(links.canonical_host) desc, lower(links.slug) asc, links.id desc';
    case 'destinationAsc':
      return 'lower(links.destination_url) asc, links.id asc';
    case 'destinationDesc':
      return 'lower(links.destination_url) desc, links.id desc';
    case 'updatedDesc':
    default:
      return 'links.updated_at desc, links.id desc';
  }
}

async function listLinksWithFilters(input: LinkListInput): Promise<PaginatedLinkRows> {
  const { whereSql, values } = buildLinkListWhereClause(input);
  const orderBySql = getLinkListOrderByClause(input.sort);

  const totalResult = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from links
      inner join users on users.id = links.created_by_user_id
      ${whereSql}
    `,
    values
  );

  const totalLinks = Number(totalResult.rows[0]?.count ?? '0');
  const totalPages = Math.max(1, Math.ceil(totalLinks / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const offset = (page - 1) * input.pageSize;

  const result = await pool.query<LinkRow>(
    `
      select
        ${linkSelectColumns}
      from links
      inner join users on users.id = links.created_by_user_id
      ${whereSql}
      order by ${orderBySql}
      limit $${values.length + 1}
      offset $${values.length + 2}
    `,
    [...values, input.pageSize, offset]
  );

  return {
    links: await attachLinkScheduleState(result.rows),
    page,
    pageSize: input.pageSize,
    totalLinks,
    totalPages
  };
}

export async function listLinks(input: Omit<LinkListInput, 'createdByEmail'>): Promise<PaginatedLinkRows> {
  return listLinksWithFilters(input);
}

export async function listListedLinks(
  input: Omit<LinkListInput, 'createdByEmail' | 'listedOnly'>
): Promise<PaginatedLinkRows> {
  return listLinksWithFilters({
    ...input,
    listedOnly: true
  });
}

export async function listLinksByCreator(
  input: Omit<LinkListInput, 'createdByEmail'> & { createdByEmail: string }
): Promise<PaginatedLinkRows> {
  return listLinksWithFilters(input);
}

async function getAllTimeLinkAnalytics(input: LinkAnalyticsScopeInput): Promise<LinkAnalyticsRecords> {
  const { whereSql, values } = buildLinkAnalyticsWhereClause(input);

  const [overviewResult, topLinksResult, domainBreakdownResult, creatorBreakdownResult, timeSeries] =
    await Promise.all([
      pool.query<{
        total_links: string;
        total_uses: string;
        public_links: string;
        internal_links: string;
        scheduled_links: string;
      }>(
        `
          select
            count(*)::text as total_links,
            coalesce(sum(links.usage_count), 0)::text as total_uses,
            count(*) filter (where links.internal_only = false)::text as public_links,
            count(*) filter (where links.internal_only = true)::text as internal_links,
            count(*) filter (where ${scheduledLinkExistsSql})::text as scheduled_links
          from links
          inner join users on users.id = links.created_by_user_id
          ${whereSql}
        `,
        values
      ),
      pool.query<LinkRow>(
        `
          select
            ${linkSelectColumns}
          from links
          inner join users on users.id = links.created_by_user_id
          ${whereSql}
          order by links.usage_count desc, links.updated_at desc, links.id desc
          limit 10
        `,
        values
      ),
      pool.query<{
        canonical_host: string;
        link_count: string;
        total_uses: string;
      }>(
        `
          select
            links.canonical_host,
            count(*)::text as link_count,
            coalesce(sum(links.usage_count), 0)::text as total_uses
          from links
          inner join users on users.id = links.created_by_user_id
          ${whereSql}
          group by links.canonical_host
          order by sum(links.usage_count) desc, links.canonical_host asc
        `,
        values
      ),
      pool.query<{
        email: string;
        link_count: string;
        total_uses: string;
      }>(
        `
          select
            users.email,
            count(*)::text as link_count,
            coalesce(sum(links.usage_count), 0)::text as total_uses
          from links
          inner join users on users.id = links.created_by_user_id
          ${whereSql}
          group by users.email
          order by sum(links.usage_count) desc, users.email asc
          limit 10
        `,
        values
      ),
      getLinkAnalyticsTimeSeries(input)
    ]);

  const overviewRow = overviewResult.rows[0];
  const totalLinks = Number(overviewRow?.total_links ?? '0');
  const scheduledLinks = Number(overviewRow?.scheduled_links ?? '0');

  return {
    overview: {
      totalLinks,
      totalUses: Number(overviewRow?.total_uses ?? '0'),
      publicLinks: Number(overviewRow?.public_links ?? '0'),
      internalLinks: Number(overviewRow?.internal_links ?? '0'),
      scheduledLinks,
      staticLinks: totalLinks - scheduledLinks
    },
    topLinks: (await attachLinkScheduleState(topLinksResult.rows)).map(serializeListedLink),
    domainBreakdown: domainBreakdownResult.rows.map((row) => ({
      canonicalHost: row.canonical_host,
      linkCount: Number(row.link_count),
      totalUses: Number(row.total_uses)
    })),
    creatorBreakdown: creatorBreakdownResult.rows.map((row) => ({
      email: row.email,
      linkCount: Number(row.link_count),
      totalUses: Number(row.total_uses)
    })),
    timeSeries
  };
}

async function getWindowedLinkAnalytics(
  input: LinkAnalyticsScopeInput & { timeWindow: Exclude<LinkAnalyticsTimeWindow, 'all'> }
): Promise<LinkAnalyticsRecords> {
  const { whereSql, values } = buildLinkAnalyticsWhereClause(input);
  const windowStart = getLinkAnalyticsWindowStart(input.timeWindow);
  const usageSource = getLinkAnalyticsWindowUsageSource(input.timeWindow);
  const usageValues = [...values, windowStart];
  const usageWhereSql = whereSql ? `${whereSql}\n            and usage_window.total_uses > 0` : 'where usage_window.total_uses > 0';

  const [overviewResult, topLinksResult, domainBreakdownResult, creatorBreakdownResult, timeSeries] =
    await Promise.all([
      pool.query<{
        total_links: string;
        total_uses: string;
        public_links: string;
        internal_links: string;
        scheduled_links: string;
      }>(
        `
          with usage_window as (
            select
              link_id,
              sum(usage_count)::integer as total_uses
            from ${usageSource.tableName}
            where ${usageSource.timeColumn} >= $${usageValues.length}
            group by link_id
          )
          select
            count(*)::text as total_links,
            coalesce(sum(usage_window.total_uses), 0)::text as total_uses,
            count(*) filter (where links.internal_only = false)::text as public_links,
            count(*) filter (where links.internal_only = true)::text as internal_links,
            count(*) filter (where ${scheduledLinkExistsSql})::text as scheduled_links
          from usage_window
          inner join links on links.id = usage_window.link_id
          inner join users on users.id = links.created_by_user_id
          ${usageWhereSql}
        `,
        usageValues
      ),
      pool.query<LinkRow>(
        `
          with usage_window as (
            select
              link_id,
              sum(usage_count)::integer as total_uses
            from ${usageSource.tableName}
            where ${usageSource.timeColumn} >= $${usageValues.length}
            group by link_id
          )
          select
            links.id,
            links.public_id,
            links.slug,
            links.canonical_host,
            links.destination_url,
            links.disabled_destination_url,
            links.expires_at::text,
            links.description,
            links.internal_only,
            links.is_listed,
            links.is_disabled,
            links.requires_tracking_id,
            usage_window.total_uses as usage_count,
            links.schedule_timezone,
            links.schedule_mode,
            users.email as created_by_email,
            links.created_at::text,
            links.updated_at::text
          from usage_window
          inner join links on links.id = usage_window.link_id
          inner join users on users.id = links.created_by_user_id
          ${usageWhereSql}
          order by usage_window.total_uses desc, links.updated_at desc, links.id desc
          limit 10
        `,
        usageValues
      ),
      pool.query<{
        canonical_host: string;
        link_count: string;
        total_uses: string;
      }>(
        `
          with usage_window as (
            select
              link_id,
              sum(usage_count)::integer as total_uses
            from ${usageSource.tableName}
            where ${usageSource.timeColumn} >= $${usageValues.length}
            group by link_id
          )
          select
            links.canonical_host,
            count(*)::text as link_count,
            coalesce(sum(usage_window.total_uses), 0)::text as total_uses
          from usage_window
          inner join links on links.id = usage_window.link_id
          inner join users on users.id = links.created_by_user_id
          ${usageWhereSql}
          group by links.canonical_host
          order by sum(usage_window.total_uses) desc, links.canonical_host asc
        `,
        usageValues
      ),
      pool.query<{
        email: string;
        link_count: string;
        total_uses: string;
      }>(
        `
          with usage_window as (
            select
              link_id,
              sum(usage_count)::integer as total_uses
            from ${usageSource.tableName}
            where ${usageSource.timeColumn} >= $${usageValues.length}
            group by link_id
          )
          select
            users.email,
            count(*)::text as link_count,
            coalesce(sum(usage_window.total_uses), 0)::text as total_uses
          from usage_window
          inner join links on links.id = usage_window.link_id
          inner join users on users.id = links.created_by_user_id
          ${usageWhereSql}
          group by users.email
          order by sum(usage_window.total_uses) desc, users.email asc
          limit 10
        `,
        usageValues
      ),
      getLinkAnalyticsTimeSeries(input)
    ]);

  const overviewRow = overviewResult.rows[0];
  const totalLinks = Number(overviewRow?.total_links ?? '0');
  const scheduledLinks = Number(overviewRow?.scheduled_links ?? '0');

  return {
    overview: {
      totalLinks,
      totalUses: Number(overviewRow?.total_uses ?? '0'),
      publicLinks: Number(overviewRow?.public_links ?? '0'),
      internalLinks: Number(overviewRow?.internal_links ?? '0'),
      scheduledLinks,
      staticLinks: totalLinks - scheduledLinks
    },
    topLinks: (await attachLinkScheduleState(topLinksResult.rows)).map(serializeListedLink),
    domainBreakdown: domainBreakdownResult.rows.map((row) => ({
      canonicalHost: row.canonical_host,
      linkCount: Number(row.link_count),
      totalUses: Number(row.total_uses)
    })),
    creatorBreakdown: creatorBreakdownResult.rows.map((row) => ({
      email: row.email,
      linkCount: Number(row.link_count),
      totalUses: Number(row.total_uses)
    })),
    timeSeries
  };
}

export async function getLinkAnalytics(
  input: LinkAnalyticsScopeInput
): Promise<LinkAnalyticsRecords> {
  if (input.timeWindow === 'all') {
    return getAllTimeLinkAnalytics(input);
  }

  return getWindowedLinkAnalytics(input as LinkAnalyticsScopeInput & {
    timeWindow: Exclude<LinkAnalyticsTimeWindow, 'all'>;
  });
}

async function findLinkByIdWithClient(
  client: Pick<PoolClient, 'query'>,
  linkId: string | number
) {
  const result = await client.query<LinkRow>(
    `
      select
        ${linkSelectColumns}
      from links
      inner join users on users.id = links.created_by_user_id
      where links.id = $1
      limit 1
    `,
    [linkId]
  );

  return result.rows[0] ?? null;
}

export async function createLink(input: {
  slug: string;
  canonicalHost: string;
  destinationUrl: string;
  description: string | null;
  internalOnly: boolean;
  password?: string | null;
  createdByUserId: string | number;
  scheduleTimezone: string;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const client = await pool.connect();

    try {
      const publicId = createLinkPublicId();
      await client.query('begin');
      const result = await client.query<{ id: string }>(
        `
          insert into links (
            public_id,
            slug,
            canonical_host,
            destination_url,
            description,
            internal_only,
            schedule_timezone,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning id
        `,
        [
          publicId,
          input.slug,
          input.canonicalHost,
          input.destinationUrl,
          input.description,
          input.internalOnly,
          input.scheduleTimezone,
          input.createdByUserId
        ]
      );

      const linkId = result.rows[0]?.id;
      if (!linkId) {
        throw new Error('Unable to create link.');
      }

      if (input.password) {
        await createUniqueLinkPassword(client, {
          linkId,
          name: 'Initial password',
          password: input.password
        });
      }

      const createdLink = await findLinkByIdWithClient(client, linkId);
      if (!createdLink) {
        throw new Error('Unable to load created link.');
      }

      await client.query('commit');
      return createdLink;
    } catch (error) {
      await client.query('rollback');

      if (isPublicIdUniqueViolation(error)) {
        continue;
      }

      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error('Unable to allocate a unique public link id.');
}

export async function findLinkByHostAndSlug(canonicalHost: string, slug: string) {
  const result = await pool.query<RedirectLinkRow>(
    `
      select
        ${linkSelectColumns},
        case
          when links.schedule_mode = 'rotation'
            then active_rotation.destination_url
          else active_schedule.destination_url
        end as active_scheduled_destination_url,
        ${scheduledLinkExistsSql} as has_schedule
      from links
      inner join users on users.id = links.created_by_user_id
      left join lateral (
        select schedules.destination_url
        from link_destination_schedules schedules
        where schedules.link_id = links.id
          and schedules.start_minute <= (
            extract(hour from timezone(links.schedule_timezone, now()))::int * 60 +
            extract(minute from timezone(links.schedule_timezone, now()))::int
          )
          and schedules.end_minute > (
            extract(hour from timezone(links.schedule_timezone, now()))::int * 60 +
            extract(minute from timezone(links.schedule_timezone, now()))::int
          )
        order by schedules.start_minute asc
        limit 1
      ) active_schedule on true
      left join lateral (
        select rotation_destinations.destination_url
        from (
          select
            destinations.destination_url,
            row_number() over (order by destinations.sort_order asc, destinations.id asc) - 1 as destination_index,
            count(*) over () as destination_count,
            rotation.interval_minutes
          from link_rotation_schedules rotation
          inner join link_rotation_schedule_destinations destinations on destinations.link_id = rotation.link_id
          where rotation.link_id = links.id
        ) rotation_destinations
        where rotation_destinations.destination_count > 0
          and rotation_destinations.destination_index = (
            (
              (
                extract(hour from timezone(users.default_schedule_timezone, now()))::int * 60 +
                extract(minute from timezone(users.default_schedule_timezone, now()))::int
              ) / rotation_destinations.interval_minutes
            ) % rotation_destinations.destination_count
          )
        limit 1
      ) active_rotation on true
      where links.canonical_host = $1
        and links.slug = $2
        and links.is_disabled = false
        and (links.expires_at is null or links.expires_at > now())
      limit 1
    `,
    [canonicalHost, slug]
  );

  return result.rows[0] ?? null;
}

export async function findUnavailableLinkByHostAndSlug(canonicalHost: string, slug: string) {
  const result = await pool.query<{
    id: string;
    is_disabled: boolean;
    disabled_destination_url: string | null;
    requires_tracking_id: boolean;
    is_expired: boolean;
  }>(
    `
      select
        links.id,
        links.is_disabled,
        links.disabled_destination_url,
        links.requires_tracking_id,
        (links.expires_at is not null and links.expires_at <= now()) as is_expired
      from links
      where links.canonical_host = $1
        and links.slug = $2
      limit 1
    `,
    [canonicalHost, slug]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  if (row.is_disabled) {
    return {
      linkId: row.id,
      reason: 'disabled' as const,
      disabledDestinationUrl: row.disabled_destination_url,
      requiresTrackingId: row.requires_tracking_id
    };
  }

  if (row.is_expired) {
    return {
      linkId: row.id,
      reason: 'expired' as const,
      disabledDestinationUrl: row.disabled_destination_url,
      requiresTrackingId: row.requires_tracking_id
    };
  }

  return null;
}

function buildUsageCountUpdateValues(updates: Array<{ linkId: number | string; count: number }>) {
  const values: Array<number | string> = [];
  const placeholders = updates
    .map(({ linkId, count }, index) => {
      const offset = index * 2;
      values.push(linkId, count);
      return `($${offset + 1}::bigint, $${offset + 2}::integer)`;
    })
    .join(', ');

  return { values, placeholders };
}

function buildSubtrackerUsageCountUpdateValues(
  updates: Array<{ subtrackerId: number | string; count: number }>
) {
  const values: Array<number | string> = [];
  const placeholders = updates
    .map(({ subtrackerId, count }, index) => {
      const offset = index * 2;
      values.push(subtrackerId, count);
      return `($${offset + 1}::bigint, $${offset + 2}::integer)`;
    })
    .join(', ');

  return { values, placeholders };
}

function buildLinkPasswordUsageCountUpdateValues(
  updates: Array<{ passwordId: number | string; count: number }>
) {
  const values: Array<number | string> = [];
  const placeholders = updates
    .map(({ passwordId, count }, index) => {
      const offset = index * 2;
      values.push(passwordId, count);
      return `($${offset + 1}::bigint, $${offset + 2}::integer)`;
    })
    .join(', ');

  return { values, placeholders };
}

function buildUsageHourlyUpsertValues(
  updates: Array<{ linkId: number | string; hourStart: string; count: number }>
) {
  const values: Array<number | string> = [];
  const placeholders = updates
    .map(({ linkId, hourStart, count }, index) => {
      const offset = index * 3;
      values.push(linkId, hourStart, count);
      return `($${offset + 1}::bigint, $${offset + 2}::timestamptz, $${offset + 3}::integer)`;
    })
    .join(', ');

  return { values, placeholders };
}

function buildUsageTenMinuteUpsertValues(
  updates: Array<{ linkId: number | string; bucketStart: string; count: number }>
) {
  const values: Array<number | string> = [];
  const placeholders = updates
    .map(({ linkId, bucketStart, count }, index) => {
      const offset = index * 3;
      values.push(linkId, bucketStart, count);
      return `($${offset + 1}::bigint, $${offset + 2}::timestamptz, $${offset + 3}::integer)`;
    })
    .join(', ');

  return { values, placeholders };
}

export async function recordLinkUsageMetrics(input: {
  usageCounts: Array<{ linkId: number | string; count: number }>;
  subtrackerUsageCounts: Array<{ subtrackerId: number | string; count: number }>;
  passwordUsageCounts: Array<{ passwordId: number | string; count: number }>;
  hourlyRollups: Array<{ linkId: number | string; hourStart: string; count: number }>;
  tenMinuteRollups: Array<{ linkId: number | string; bucketStart: string; count: number }>;
}) {
  if (
    input.usageCounts.length === 0 &&
    input.subtrackerUsageCounts.length === 0 &&
    input.passwordUsageCounts.length === 0 &&
    input.hourlyRollups.length === 0 &&
    input.tenMinuteRollups.length === 0
  ) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('begin');

    if (input.usageCounts.length > 0) {
      const { values, placeholders } = buildUsageCountUpdateValues(input.usageCounts);
      await client.query(
        `
          update links
          set usage_count = links.usage_count + updates.increment_count
          from (
            values ${placeholders}
          ) as updates(link_id, increment_count)
          where links.id = updates.link_id
        `,
        values
      );
    }

    if (input.subtrackerUsageCounts.length > 0) {
      const { values, placeholders } = buildSubtrackerUsageCountUpdateValues(
        input.subtrackerUsageCounts
      );
      await client.query(
        `
          update link_subtrackers
          set usage_count = link_subtrackers.usage_count + updates.increment_count,
              updated_at = now()
          from (
            values ${placeholders}
          ) as updates(subtracker_id, increment_count)
          where link_subtrackers.id = updates.subtracker_id
        `,
        values
      );
    }

    if (input.passwordUsageCounts.length > 0) {
      const { values, placeholders } = buildLinkPasswordUsageCountUpdateValues(
        input.passwordUsageCounts
      );
      await client.query(
        `
          update link_passwords
          set usage_count = link_passwords.usage_count + updates.increment_count,
              updated_at = now()
          from (
            values ${placeholders}
          ) as updates(password_id, increment_count)
          where link_passwords.id = updates.password_id
        `,
        values
      );
    }

    if (input.hourlyRollups.length > 0) {
      const { values, placeholders } = buildUsageHourlyUpsertValues(input.hourlyRollups);
      await client.query(
        `
          insert into link_usage_hourly (
            link_id,
            hour_start,
            usage_count
          )
          values ${placeholders}
          on conflict (link_id, hour_start)
          do update
          set usage_count = link_usage_hourly.usage_count + excluded.usage_count
        `,
        values
      );
    }

    if (input.tenMinuteRollups.length > 0) {
      const { values, placeholders } = buildUsageTenMinuteUpsertValues(input.tenMinuteRollups);
      await client.query(
        `
          insert into link_usage_ten_minute (
            link_id,
            bucket_start,
            usage_count
          )
          values ${placeholders}
          on conflict (link_id, bucket_start)
          do update
          set usage_count = link_usage_ten_minute.usage_count + excluded.usage_count
        `,
        values
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateLink(input: {
  linkId: string | number;
  slug: string;
  canonicalHost: string;
  destinationUrl?: string;
  internalOnly?: boolean;
}) {
  const result = await pool.query<LinkRow>(
    `
      update links
      set slug = $2,
          canonical_host = $3,
          destination_url = coalesce($4, links.destination_url),
          internal_only = coalesce($5, links.internal_only),
          updated_at = now()
      from users
      where links.id = $1
        and users.id = links.created_by_user_id
      returning
        ${linkSelectColumns}
    `,
    [
      input.linkId,
      input.slug,
      input.canonicalHost,
      input.destinationUrl ?? null,
      input.internalOnly ?? null
    ]
  );

  return result.rows[0] ?? null;
}

export async function updateLinkDisabledState(input: {
  linkId: string | number;
  isDisabled: boolean;
}) {
  const result = await pool.query<LinkRow>(
    `
      update links
      set is_disabled = $2,
          updated_at = now()
      from users
      where links.id = $1
        and users.id = links.created_by_user_id
      returning
        ${linkSelectColumns}
    `,
    [input.linkId, input.isDisabled]
  );

  return result.rows[0] ?? null;
}

export async function deleteLink(linkId: string | number) {
  const result = await pool.query(
    `
      delete from links
      where id = $1
    `,
    [linkId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function findLinkConfigurationById(linkId: string | number) {
  const link = await findLinkById(linkId);
  if (!link) {
    return null;
  }

  const [schedules, rotationSchedule, subtrackers, passwords] = await Promise.all([
    listLinkSchedules(linkId),
    listLinkRotationSchedule(linkId),
    listLinkSubtrackers(linkId),
    listLinkPasswords(linkId)
  ]);

  return {
    ...link,
    schedules,
    rotation_schedule: rotationSchedule,
    subtrackers,
    passwords
  } satisfies LinkConfigurationRow;
}

export async function findLinkConfigurationByPublicId(linkPublicId: string) {
  const link = await findLinkByPublicId(linkPublicId);
  if (!link) {
    return null;
  }

  const [schedules, rotationSchedule, subtrackers, passwords] = await Promise.all([
    listLinkSchedules(link.id),
    listLinkRotationSchedule(link.id),
    listLinkSubtrackers(link.id),
    listLinkPasswords(link.id)
  ]);

  return {
    ...link,
    schedules,
    rotation_schedule: rotationSchedule,
    subtrackers,
    passwords
  } satisfies LinkConfigurationRow;
}

async function createUniqueLinkPassword(
  client: Pick<PoolClient, 'query'>,
  input: { linkId: string | number; name: string; password: string }
) {
  try {
    const result = await client.query<LinkPasswordRow>(
      `
        insert into link_passwords (
          link_id,
          name,
          password
        )
        values ($1, $2, $3)
        returning
          id,
          link_id,
          name,
          password,
          is_disabled,
          usage_count,
          created_at::text,
          updated_at::text
      `,
      [input.linkId, input.name, input.password]
    );

    return result.rows[0];
  } catch (error) {
    if (isLinkPasswordUniqueViolation(error)) {
      throw new Error('That password is already configured for this link.');
    }

    throw error;
  }
}

async function createUniqueLinkSubtracker(
  client: Pick<PoolClient, 'query'>,
  input: { linkId: string | number; name: string }
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const trackingId = createLinkSubtrackerId();
      const result = await client.query<LinkSubtrackerRow>(
        `
          insert into link_subtrackers (
            link_id,
            name,
            tracking_id
          )
          values ($1, $2, $3)
          returning
            id,
            link_id,
            name,
            tracking_id,
            is_disabled,
            usage_count,
            created_at::text,
            updated_at::text
        `,
        [input.linkId, input.name, trackingId]
      );

      return result.rows[0];
    } catch (error) {
      if (isSubtrackerTrackingIdUniqueViolation(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unable to allocate a unique link sub-tracker id.');
}

export async function createLinkSubtracker(input: {
  linkId: string | number;
  name: string;
}) {
  const created = await createUniqueLinkSubtracker(pool, {
    linkId: input.linkId,
    name: input.name.trim()
  });
  const { link_id: _linkId, ...subtracker } = created;
  return subtracker satisfies LinkSubtrackerRecord;
}

export async function createLinkPassword(input: {
  linkId: string | number;
  name: string;
  password: string;
}) {
  const created = await createUniqueLinkPassword(pool, {
    linkId: input.linkId,
    name: input.name.trim(),
    password: input.password.trim()
  });
  const { link_id: _linkId, ...password } = created;
  return password satisfies LinkPasswordRecord;
}

export async function updateLinkSubtrackerDisabledState(input: {
  linkId: string | number;
  subtrackerId: string | number;
  isDisabled: boolean;
}) {
  const result = await pool.query<LinkSubtrackerRow>(
    `
      update link_subtrackers
      set is_disabled = $3,
          updated_at = now()
      where id = $1
        and link_id = $2
      returning
        id,
        link_id,
        name,
        tracking_id,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
    `,
    [input.subtrackerId, input.linkId, input.isDisabled]
  );

  const subtracker = result.rows[0];
  if (!subtracker) {
    return null;
  }

  const { link_id: _linkId, ...record } = subtracker;
  return record satisfies LinkSubtrackerRecord;
}

export async function updateLinkPasswordDisabledState(input: {
  linkId: string | number;
  passwordId: string | number;
  isDisabled: boolean;
}) {
  const result = await pool.query<LinkPasswordRow>(
    `
      update link_passwords
      set is_disabled = $3,
          updated_at = now()
      where id = $1
        and link_id = $2
      returning
        id,
        link_id,
        name,
        password,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
    `,
    [input.passwordId, input.linkId, input.isDisabled]
  );

  const password = result.rows[0];
  if (!password) {
    return null;
  }

  const { link_id: _linkId, ...record } = password;
  return record satisfies LinkPasswordRecord;
}

async function syncLinkSubtrackers(
  client: Pick<PoolClient, 'query'>,
  input: {
    linkId: string | number;
    subtrackers: Array<{
      id?: string | null;
      name: string;
      isDisabled?: boolean;
    }>;
  }
) {
  const existingRows = await client.query<LinkSubtrackerRow>(
    `
      select
        id,
        link_id,
        name,
        tracking_id,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
      from link_subtrackers
      where link_id = $1
      order by created_at asc, id asc
    `,
    [input.linkId]
  );
  const existingById = new Map(existingRows.rows.map((row) => [row.id, row]));
  const keptIds = new Set<string>();

  for (const subtracker of input.subtrackers) {
    const trimmedName = subtracker.name.trim();
    const isDisabled = Boolean(subtracker.isDisabled);

    if (!subtracker.id) {
      const created = await createUniqueLinkSubtracker(client, {
        linkId: input.linkId,
        name: trimmedName
      });
      keptIds.add(created.id);
      continue;
    }

    const existing = existingById.get(subtracker.id);
    if (!existing) {
      throw new Error('Link sub-tracker not found.');
    }

    keptIds.add(existing.id);

    if (existing.name === trimmedName && existing.is_disabled === isDisabled) {
      continue;
    }

    await client.query(
      `
        update link_subtrackers
        set name = $3,
            is_disabled = $4,
            updated_at = now()
        where id = $1
          and link_id = $2
      `,
      [existing.id, input.linkId, trimmedName, isDisabled]
    );
  }

  const idsToDelete = existingRows.rows
    .map((row) => row.id)
    .filter((subtrackerId) => !keptIds.has(subtrackerId));
  if (idsToDelete.length > 0) {
    await client.query(
      `
        delete from link_subtrackers
        where link_id = $1
          and id = any($2::bigint[])
      `,
      [input.linkId, idsToDelete]
    );
  }
}

async function syncLinkPasswords(
  client: Pick<PoolClient, 'query'>,
  input: {
    linkId: string | number;
    passwords: Array<{
      id?: string | null;
      name: string;
      password: string;
      isDisabled?: boolean;
    }>;
  }
) {
  const existingRows = await client.query<LinkPasswordRow>(
    `
      select
        id,
        link_id,
        name,
        password,
        is_disabled,
        usage_count,
        created_at::text,
        updated_at::text
      from link_passwords
      where link_id = $1
      order by created_at asc, id asc
    `,
    [input.linkId]
  );
  const existingById = new Map(existingRows.rows.map((row) => [row.id, row]));
  const keptIds = new Set<string>();

  for (const password of input.passwords) {
    const trimmedName = password.name.trim();
    const trimmedPassword = password.password.trim();
    const isDisabled = Boolean(password.isDisabled);

    if (!password.id) {
      const created = await createUniqueLinkPassword(client, {
        linkId: input.linkId,
        name: trimmedName,
        password: trimmedPassword
      });
      keptIds.add(created.id);
      continue;
    }

    const existing = existingById.get(password.id);
    if (!existing) {
      throw new Error('Link password not found.');
    }

    keptIds.add(existing.id);

    if (
      existing.name === trimmedName &&
      existing.password === trimmedPassword &&
      existing.is_disabled === isDisabled
    ) {
      continue;
    }

    try {
      await client.query(
        `
          update link_passwords
          set name = $3,
              password = $4,
              is_disabled = $5,
              updated_at = now()
          where id = $1
            and link_id = $2
        `,
        [existing.id, input.linkId, trimmedName, trimmedPassword, isDisabled]
      );
    } catch (error) {
      if (isLinkPasswordUniqueViolation(error)) {
        throw new Error('That password is already configured for this link.');
      }

      throw error;
    }
  }

  const idsToDelete = existingRows.rows
    .map((row) => row.id)
    .filter((passwordId) => !keptIds.has(passwordId));
  if (idsToDelete.length > 0) {
    await client.query(
      `
        delete from link_passwords
        where link_id = $1
          and id = any($2::bigint[])
      `,
      [input.linkId, idsToDelete]
    );
  }
}

export async function replaceLinkConfiguration(input: {
  linkId: string | number;
  slug: string;
  canonicalHost: string;
  destinationUrl: string;
  description: string | null;
  internalOnly: boolean;
  isListed: boolean;
  isDisabled: boolean;
  waitingRoomEnabled: boolean;
  requiresTrackingId: boolean;
  disabledDestinationUrl: string | null;
  expiresAt: string | null;
  scheduleTimezone: string;
  scheduleMode: 'windows' | 'rotation';
  schedules: Array<{
    startMinute: number;
    endMinute: number;
    destinationUrl: string;
  }>;
  rotationIntervalMinutes: number | null;
  rotationDestinations: Array<{
    destinationUrl: string;
  }>;
  rememberPasswordAccess: boolean;
  updatePassword: boolean;
  passwordHash: string | null;
  subtrackers: Array<{
    id?: string | null;
    name: string;
    isDisabled?: boolean;
  }>;
  passwords: Array<{
    id?: string | null;
    name: string;
    password: string;
    isDisabled?: boolean;
  }>;
}) {
  const client = await pool.connect();

  try {
    await client.query('begin');

    const updatedLinkResult = await client.query<LinkRow>(
      `
        update links
        set slug = $2,
            canonical_host = $3,
            destination_url = $4,
            description = $5,
            internal_only = $6,
            is_listed = $7,
            is_disabled = $8,
            waiting_room_enabled = $9,
            requires_tracking_id = $10,
            remember_password_access = $11,
            disabled_destination_url = $12,
            expires_at = $13,
            schedule_timezone = $14,
            schedule_mode = $15,
            password_hash = case when $16 then $17 else links.password_hash end,
            updated_at = now()
        from users
        where links.id = $1
          and users.id = links.created_by_user_id
        returning
          ${linkSelectColumns}
      `,
      [
        input.linkId,
        input.slug,
        input.canonicalHost,
        input.destinationUrl,
        input.description,
        input.internalOnly,
        input.isListed,
        input.isDisabled,
        input.waitingRoomEnabled,
        input.requiresTrackingId,
        input.rememberPasswordAccess,
        input.disabledDestinationUrl,
        input.expiresAt,
        input.scheduleTimezone,
        input.scheduleMode,
        input.updatePassword,
        input.passwordHash
      ]
    );

    const updatedLink = updatedLinkResult.rows[0] ?? null;
    if (!updatedLink) {
      await client.query('rollback');
      return null;
    }

    await client.query('delete from link_destination_schedules where link_id = $1', [input.linkId]);
    await client.query('delete from link_rotation_schedule_destinations where link_id = $1', [input.linkId]);
    await client.query('delete from link_rotation_schedules where link_id = $1', [input.linkId]);

    if (input.scheduleMode === 'rotation') {
      if (input.rotationIntervalMinutes !== null && input.rotationDestinations.length > 0) {
        await client.query(
          `
            insert into link_rotation_schedules (
              link_id,
              interval_minutes
            )
            values ($1, $2)
          `,
          [input.linkId, input.rotationIntervalMinutes]
        );

        for (const [index, destination] of input.rotationDestinations.entries()) {
          await client.query(
            `
              insert into link_rotation_schedule_destinations (
                link_id,
                destination_url,
                sort_order
              )
              values ($1, $2, $3)
            `,
            [input.linkId, destination.destinationUrl, index]
          );
        }
      }
    } else {
      for (const [index, schedule] of input.schedules.entries()) {
        await client.query(
          `
            insert into link_destination_schedules (
              link_id,
              start_minute,
              end_minute,
              destination_url,
              sort_order
            )
            values ($1, $2, $3, $4, $5)
          `,
          [input.linkId, schedule.startMinute, schedule.endMinute, schedule.destinationUrl, index]
        );
      }
    }

    await syncLinkSubtrackers(client, {
      linkId: input.linkId,
      subtrackers: input.subtrackers
    });
    await syncLinkPasswords(client, {
      linkId: input.linkId,
      passwords: input.passwords
    });

    await client.query('commit');

    const refreshedLink = await findLinkById(input.linkId);
    if (!refreshedLink) {
      return null;
    }

    const [schedules, rotationSchedule, subtrackers, passwords] = await Promise.all([
      listLinkSchedules(input.linkId),
      listLinkRotationSchedule(input.linkId),
      listLinkSubtrackers(input.linkId),
      listLinkPasswords(input.linkId)
    ]);

    return {
      ...refreshedLink,
      schedules,
      rotation_schedule: rotationSchedule,
      subtrackers,
      passwords
    } satisfies LinkConfigurationRow;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
