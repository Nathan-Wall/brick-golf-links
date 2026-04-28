import { pool } from './pool.js';

type UserRecord = {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  default_schedule_timezone: string;
};

type UserLinkVariablesRow = {
  link_variables: Record<string, string>;
};

type UserLinkVariablesSettingsRow = {
  link_variables: Record<string, string>;
  default_schedule_timezone: string;
};

type GroupRecord = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type AdminUserRecord = UserRecord & {
  created_at: string;
  updated_at: string;
  link_count: number;
};

export type AdminGroupRecord = GroupRecord & {
  member_count: number;
  domain_count: number;
};

export type AdminGroupSummary = Pick<AdminGroupRecord, 'id' | 'name'>;

export type AdminGroupDetail = AdminGroupRecord & {
  member_user_ids: string[];
  allowed_canonical_hosts: string[];
  domain_administration_hosts: string[];
  auto_member_email_domains: string[];
};

function normalizeCanonicalHosts(canonicalHosts: string[]) {
  return [...new Set(canonicalHosts.map((host) => host.toLowerCase()))];
}

function normalizeEmailDomains(emailDomains: string[]) {
  return [
    ...new Set(
      emailDomains
        .map((emailDomain) => emailDomain.trim().toLowerCase().replace(/^@+/, ''))
        .filter((emailDomain) => emailDomain.length > 0)
    )
  ];
}

function normalizeUserIds(userIds: Array<string | number>) {
  return [...new Set(userIds.map((userId) => String(userId)))];
}

function extractEmailDomain(email: string) {
  const trimmedEmail = email.trim().toLowerCase();
  const atIndex = trimmedEmail.lastIndexOf('@');

  if (atIndex === -1 || atIndex === trimmedEmail.length - 1) {
    return null;
  }

  return trimmedEmail.slice(atIndex + 1);
}

export async function upsertUser(input: {
  email: string;
  name: string;
  picture: string | null;
}): Promise<UserRecord> {
  const result = await pool.query<UserRecord>(
    `
      insert into users (email, name, picture_url)
      values ($1, $2, $3)
      on conflict (email)
      do update
      set name = excluded.name,
          picture_url = excluded.picture_url,
          updated_at = now()
      returning id, email, name, picture_url, default_schedule_timezone
    `,
    [input.email, input.name, input.picture]
  );

  return result.rows[0];
}

export async function listUsers() {
  const result = await pool.query<AdminUserRecord>(
    `
      select
        users.id,
        users.email,
        users.name,
        users.picture_url,
        users.default_schedule_timezone,
        users.created_at::text,
        users.updated_at::text,
        count(links.id)::int as link_count
      from users
      left join links on links.created_by_user_id = users.id
      group by
        users.id,
        users.email,
        users.name,
        users.picture_url,
        users.default_schedule_timezone,
        users.created_at,
        users.updated_at
      order by lower(users.email) asc
    `
  );

  return result.rows;
}

export async function findUserByEmail(email: string) {
  const result = await pool.query<UserRecord>(
    `
      select id, email, name, picture_url, default_schedule_timezone
      from users
      where lower(email) = lower($1)
      limit 1
    `,
    [email]
  );

  return result.rows[0] ?? null;
}

export async function findUserById(userId: string | number) {
  const result = await pool.query<AdminUserRecord>(
    `
      select
        users.id,
        users.email,
        users.name,
        users.picture_url,
        users.default_schedule_timezone,
        users.created_at::text,
        users.updated_at::text,
        count(links.id)::int as link_count
      from users
      left join links on links.created_by_user_id = users.id
      where users.id = $1
      group by users.id, users.email, users.name, users.picture_url, users.default_schedule_timezone, users.created_at, users.updated_at
      limit 1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function updateUserDefaultScheduleTimezone(
  userId: string | number,
  defaultScheduleTimezone: string
) {
  const result = await pool.query<AdminUserRecord>(
    `
      update users
      set default_schedule_timezone = $2,
          updated_at = now()
      where id = $1
      returning
        id,
        email,
        name,
        picture_url,
        default_schedule_timezone,
        created_at::text,
        updated_at::text,
        (
          select count(*)::int
          from links
          where links.created_by_user_id = users.id
        ) as link_count
    `,
    [userId, defaultScheduleTimezone]
  );

  return result.rows[0] ?? null;
}

export async function getUserDomainAccess(userId: string | number) {
  const existingResult = await pool.query<{ canonical_host: string }>(
    `
      select canonical_host
      from user_domain_access
      where user_id = $1
      order by canonical_host asc
    `,
    [userId]
  );

  return existingResult.rows.map((row) => row.canonical_host);
}

export async function getUserInheritedDomainAccess(userId: string | number) {
  const result = await pool.query<{ canonical_host: string }>(
    `
      select distinct group_domain_access.canonical_host
      from user_group_memberships
      inner join group_domain_access
        on group_domain_access.group_id = user_group_memberships.group_id
      where user_group_memberships.user_id = $1
      order by group_domain_access.canonical_host asc
    `,
    [userId]
  );

  return result.rows.map((row) => row.canonical_host);
}

export async function getUserEffectiveDomainAccess(userId: string | number) {
  const result = await pool.query<{ canonical_host: string }>(
    `
      select canonical_host
      from user_domain_access
      where user_id = $1
      union
      select group_domain_access.canonical_host
      from user_group_memberships
      inner join group_domain_access
        on group_domain_access.group_id = user_group_memberships.group_id
      where user_group_memberships.user_id = $1
      order by canonical_host asc
    `,
    [userId]
  );

  return result.rows.map((row) => row.canonical_host);
}

export async function getUserInheritedDomainAdministrationHosts(userId: string | number) {
  const result = await pool.query<{ host: string }>(
    `
      select distinct group_domain_admin_access.host
      from user_group_memberships
      inner join group_domain_admin_access
        on group_domain_admin_access.group_id = user_group_memberships.group_id
      where user_group_memberships.user_id = $1
      order by group_domain_admin_access.host asc
    `,
    [userId]
  );

  return result.rows.map((row) => row.host);
}

export async function getUserEffectiveDomainAdministrationHosts(userId: string | number) {
  return await getUserInheritedDomainAdministrationHosts(userId);
}

export async function getUserGroups(userId: string | number) {
  const result = await pool.query<AdminGroupSummary>(
    `
      select groups.id, groups.name
      from groups
      inner join user_group_memberships
        on user_group_memberships.group_id = groups.id
      where user_group_memberships.user_id = $1
      order by lower(groups.name) asc, groups.id asc
    `,
    [userId]
  );

  return result.rows;
}

export async function syncAutomaticGroupMembershipsForEmail(
  userId: string | number,
  email: string
) {
  const emailDomain = extractEmailDomain(email);
  if (!emailDomain) {
    return 0;
  }

  const result = await pool.query(
    `
      insert into user_group_memberships (group_id, user_id)
      select group_auto_member_email_domains.group_id, $1
      from group_auto_member_email_domains
      where group_auto_member_email_domains.email_domain = $2
      on conflict do nothing
    `,
    [userId, emailDomain]
  );

  return result.rowCount ?? 0;
}

export async function getUserLinkVariables(userId: string | number) {
  const result = await pool.query<UserLinkVariablesRow>(
    `
      select link_variables
      from users
      where id = $1
      limit 1
    `,
    [userId]
  );

  return result.rows[0]?.link_variables ?? {};
}

export async function findUserLinkVariablesByEmail(email: string) {
  const result = await pool.query<UserLinkVariablesRow>(
    `
      select link_variables
      from users
      where lower(email) = lower($1)
      limit 1
    `,
    [email]
  );

  return result.rows[0]?.link_variables ?? {};
}

export async function replaceUserLinkVariables(
  userId: string | number,
  linkVariables: Record<string, string>
) {
  const result = await pool.query<UserLinkVariablesRow>(
    `
      update users
      set link_variables = $2::jsonb,
          updated_at = now()
      where id = $1
      returning link_variables
    `,
    [userId, JSON.stringify(linkVariables)]
  );

  return result.rows[0]?.link_variables ?? null;
}

export async function replaceUserLinkVariablesAndDefaultScheduleTimezone(
  userId: string | number,
  linkVariables: Record<string, string>,
  defaultScheduleTimezone: string
) {
  const result = await pool.query<UserLinkVariablesSettingsRow>(
    `
      update users
      set link_variables = $2::jsonb,
          default_schedule_timezone = $3,
          updated_at = now()
      where id = $1
      returning link_variables, default_schedule_timezone
    `,
    [userId, JSON.stringify(linkVariables), defaultScheduleTimezone]
  );

  const updatedRow = result.rows[0];
  if (!updatedRow) {
    return null;
  }

  return {
    linkVariables: updatedRow.link_variables ?? {},
    defaultScheduleTimezone: updatedRow.default_schedule_timezone
  };
}

export async function initializeUserDomainAccess(userId: string | number, canonicalHosts: string[]) {
  const normalizedHosts = normalizeCanonicalHosts(canonicalHosts);
  const existingCanonicalHosts = await getUserDomainAccess(userId);
  if (existingCanonicalHosts.length > 0) {
    return existingCanonicalHosts;
  }

  if (normalizedHosts.length === 0) {
    return [];
  }

  await pool.query(
    `
      insert into user_domain_access (user_id, canonical_host)
      select $1, unnest($2::text[])
      on conflict do nothing
    `,
    [userId, normalizedHosts]
  );

  return normalizedHosts;
}

export async function replaceUserDomainAccess(userId: string | number, canonicalHosts: string[]) {
  const normalizedHosts = normalizeCanonicalHosts(canonicalHosts);
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query('delete from user_domain_access where user_id = $1', [userId]);

    if (normalizedHosts.length > 0) {
      await client.query(
        `
          insert into user_domain_access (user_id, canonical_host)
          select $1, unnest($2::text[])
          on conflict do nothing
        `,
        [userId, normalizedHosts]
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return normalizedHosts;
}

export async function listExistingUserIds(userIds: Array<string | number>) {
  const normalizedUserIds = normalizeUserIds(userIds);
  if (normalizedUserIds.length === 0) {
    return [];
  }

  const result = await pool.query<{ id: string }>(
    `
      select id
      from users
      where id = any($1::bigint[])
      order by id asc
    `,
    [normalizedUserIds]
  );

  return result.rows.map((row) => row.id);
}

export async function listGroups() {
  const result = await pool.query<AdminGroupRecord>(
    `
      select
        groups.id,
        groups.name,
        groups.created_at::text,
        groups.updated_at::text,
        count(distinct user_group_memberships.user_id)::int as member_count,
        count(distinct group_domain_access.canonical_host)::int as domain_count
      from groups
      left join user_group_memberships
        on user_group_memberships.group_id = groups.id
      left join group_domain_access
        on group_domain_access.group_id = groups.id
      group by groups.id, groups.name, groups.created_at, groups.updated_at
      order by lower(groups.name) asc, groups.id asc
    `
  );

  return result.rows;
}

export async function findGroupById(groupId: string | number) {
  const result = await pool.query<AdminGroupRecord>(
    `
      select
        groups.id,
        groups.name,
        groups.created_at::text,
        groups.updated_at::text,
        count(distinct user_group_memberships.user_id)::int as member_count,
        count(distinct group_domain_access.canonical_host)::int as domain_count
      from groups
      left join user_group_memberships
        on user_group_memberships.group_id = groups.id
      left join group_domain_access
        on group_domain_access.group_id = groups.id
      where groups.id = $1
      group by groups.id, groups.name, groups.created_at, groups.updated_at
      limit 1
    `,
    [groupId]
  );

  return result.rows[0] ?? null;
}

export async function getGroupMemberUserIds(groupId: string | number) {
  const result = await pool.query<{ user_id: string }>(
    `
      select user_id::text
      from user_group_memberships
      where group_id = $1
      order by user_id asc
    `,
    [groupId]
  );

  return result.rows.map((row) => row.user_id);
}

export async function getGroupDomainAccess(groupId: string | number) {
  const result = await pool.query<{ canonical_host: string }>(
    `
      select canonical_host
      from group_domain_access
      where group_id = $1
      order by canonical_host asc
    `,
    [groupId]
  );

  return result.rows.map((row) => row.canonical_host);
}

export async function getGroupDomainAdministrationHosts(groupId: string | number) {
  const result = await pool.query<{ host: string }>(
    `
      select host
      from group_domain_admin_access
      where group_id = $1
      order by host asc
    `,
    [groupId]
  );

  return result.rows.map((row) => row.host);
}

export async function getGroupAutoMemberEmailDomains(groupId: string | number) {
  const result = await pool.query<{ email_domain: string }>(
    `
      select email_domain
      from group_auto_member_email_domains
      where group_id = $1
      order by email_domain asc
    `,
    [groupId]
  );

  return result.rows.map((row) => row.email_domain);
}

export async function findGroupDetailById(groupId: string | number) {
  const group = await findGroupById(groupId);
  if (!group) {
    return null;
  }

  const [memberUserIds, allowedCanonicalHosts, domainAdministrationHosts, autoMemberEmailDomains] =
    await Promise.all([
      getGroupMemberUserIds(groupId),
      getGroupDomainAccess(groupId),
      getGroupDomainAdministrationHosts(groupId),
      getGroupAutoMemberEmailDomains(groupId)
    ]);

  return {
    ...group,
    member_user_ids: memberUserIds,
    allowed_canonical_hosts: allowedCanonicalHosts,
    domain_administration_hosts: domainAdministrationHosts,
    auto_member_email_domains: autoMemberEmailDomains
  } satisfies AdminGroupDetail;
}

export async function createGroup(name: string) {
  const result = await pool.query<GroupRecord>(
    `
      insert into groups (name)
      values ($1)
      returning id, name, created_at::text, updated_at::text
    `,
    [name.trim()]
  );

  const createdGroup = result.rows[0] ?? null;
  if (!createdGroup) {
    return null;
  }

  return {
    ...createdGroup,
    member_count: 0,
    domain_count: 0
  } satisfies AdminGroupRecord;
}

export async function updateGroupSettings(input: {
  groupId: string | number;
  name: string;
  memberUserIds: Array<string | number>;
  allowedCanonicalHosts: string[];
  domainAdministrationHosts: string[];
  autoMemberEmailDomains: string[];
}) {
  const normalizedUserIds = normalizeUserIds(input.memberUserIds);
  const normalizedHosts = normalizeCanonicalHosts(input.allowedCanonicalHosts);
  const normalizedDomainAdministrationHosts = normalizeCanonicalHosts(
    input.domainAdministrationHosts
  );
  const normalizedEmailDomains = normalizeEmailDomains(input.autoMemberEmailDomains);
  const client = await pool.connect();

  try {
    await client.query('begin');

    const updateResult = await client.query<GroupRecord>(
      `
        update groups
        set name = $2,
            updated_at = now()
        where id = $1
        returning id, name, created_at::text, updated_at::text
      `,
      [input.groupId, input.name.trim()]
    );

    if (!updateResult.rows[0]) {
      await client.query('rollback');
      return null;
    }

    await client.query('delete from user_group_memberships where group_id = $1', [input.groupId]);

    if (normalizedUserIds.length > 0) {
      await client.query(
        `
          insert into user_group_memberships (group_id, user_id)
          select $1, unnest($2::bigint[])
          on conflict do nothing
        `,
        [input.groupId, normalizedUserIds]
      );
    }

    await client.query('delete from group_domain_access where group_id = $1', [input.groupId]);

    if (normalizedHosts.length > 0) {
      await client.query(
        `
          insert into group_domain_access (group_id, canonical_host)
          select $1, unnest($2::text[])
          on conflict do nothing
        `,
        [input.groupId, normalizedHosts]
      );
    }

    await client.query('delete from group_domain_admin_access where group_id = $1', [input.groupId]);

    if (normalizedDomainAdministrationHosts.length > 0) {
      await client.query(
        `
          insert into group_domain_admin_access (group_id, host)
          select $1, unnest($2::text[])
          on conflict do nothing
        `,
        [input.groupId, normalizedDomainAdministrationHosts]
      );
    }

    await client.query('delete from group_auto_member_email_domains where group_id = $1', [
      input.groupId
    ]);

    if (normalizedEmailDomains.length > 0) {
      await client.query(
        `
          insert into group_auto_member_email_domains (group_id, email_domain)
          select $1, unnest($2::text[])
          on conflict do nothing
        `,
        [input.groupId, normalizedEmailDomains]
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return await findGroupDetailById(input.groupId);
}

export async function deleteGroup(groupId: string | number) {
  const result = await pool.query(
    `
      delete from groups
      where id = $1
    `,
    [groupId]
  );

  return (result.rowCount ?? 0) > 0;
}
