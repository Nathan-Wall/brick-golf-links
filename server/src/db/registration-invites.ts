import { pool } from './pool.js';

export type RegistrationInviteRecord = {
  id: string;
  token: string;
  label: string | null;
  group_id: string | null;
  group_name: string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  used_by_user_id: string | null;
  used_by_email: string | null;
  created_at: string;
  updated_at: string;
  used_at: string | null;
};

type UserRecord = {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  default_schedule_timezone: string;
};

export async function listRegistrationInvites() {
  const result = await pool.query<RegistrationInviteRecord>(
    `
      select
        registration_invites.id::text,
        registration_invites.token,
        registration_invites.label,
        registration_invites.group_id::text,
        groups.name as group_name,
        registration_invites.created_by_user_id::text,
        created_by_user.email as created_by_email,
        registration_invites.used_by_user_id::text,
        registration_invites.used_by_email,
        registration_invites.created_at::text,
        registration_invites.updated_at::text,
        registration_invites.used_at::text
      from registration_invites
      left join groups on groups.id = registration_invites.group_id
      left join users as created_by_user on created_by_user.id = registration_invites.created_by_user_id
      order by registration_invites.created_at desc, registration_invites.id desc
    `
  );

  return result.rows;
}

export async function createRegistrationInvite(input: {
  token: string;
  label: string | null;
  groupId: string | number | null;
  createdByUserId: string | number | null;
}) {
  const result = await pool.query<RegistrationInviteRecord>(
    `
      insert into registration_invites (token, label, group_id, created_by_user_id)
      values ($1, $2, $3, $4)
      returning
        id::text,
        token,
        label,
        group_id::text,
        null::text as group_name,
        created_by_user_id::text,
        null::text as created_by_email,
        used_by_user_id::text,
        used_by_email,
        created_at::text,
        updated_at::text,
        used_at::text
    `,
    [input.token, input.label, input.groupId, input.createdByUserId]
  );

  const createdInvite = result.rows[0] ?? null;
  if (!createdInvite) {
    return null;
  }

  return await findRegistrationInviteById(createdInvite.id);
}

export async function findRegistrationInviteById(inviteId: string | number) {
  const result = await pool.query<RegistrationInviteRecord>(
    `
      select
        registration_invites.id::text,
        registration_invites.token,
        registration_invites.label,
        registration_invites.group_id::text,
        groups.name as group_name,
        registration_invites.created_by_user_id::text,
        created_by_user.email as created_by_email,
        registration_invites.used_by_user_id::text,
        registration_invites.used_by_email,
        registration_invites.created_at::text,
        registration_invites.updated_at::text,
        registration_invites.used_at::text
      from registration_invites
      left join groups on groups.id = registration_invites.group_id
      left join users as created_by_user on created_by_user.id = registration_invites.created_by_user_id
      where registration_invites.id = $1
      limit 1
    `,
    [inviteId]
  );

  return result.rows[0] ?? null;
}

export async function findAvailableRegistrationInviteByToken(token: string) {
  const result = await pool.query<Pick<RegistrationInviteRecord, 'id' | 'token' | 'group_id'>>(
    `
      select
        id::text,
        token,
        group_id::text
      from registration_invites
      where token = $1
        and used_at is null
      limit 1
    `,
    [token]
  );

  return result.rows[0] ?? null;
}

export async function hasUserRegisteredViaInvite(userId: string | number) {
  const result = await pool.query(
    `
      select 1
      from registration_invites
      where used_by_user_id = $1
      limit 1
    `,
    [userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function registerUserWithInvite(input: {
  email: string;
  name: string;
  picture: string | null;
  inviteToken: string;
}) {
  const client = await pool.connect();

  try {
    await client.query('begin');

    const inviteResult = await client.query<{ id: string; group_id: string | null }>(
      `
        select
          id::text,
          group_id::text
        from registration_invites
        where token = $1
          and used_at is null
        for update
      `,
      [input.inviteToken]
    );

    const invite = inviteResult.rows[0] ?? null;
    if (!invite) {
      await client.query('rollback');
      return {
        reason: 'invalid_or_used' as const,
        user: null
      };
    }

    const existingUserResult = await client.query<{ id: string }>(
      `
        select id::text
        from users
        where lower(email) = lower($1)
        limit 1
      `,
      [input.email]
    );

    if (existingUserResult.rows[0]) {
      await client.query('rollback');
      return {
        reason: 'existing_user' as const,
        user: null
      };
    }

    const createdUserResult = await client.query<UserRecord>(
      `
        insert into users (email, name, picture_url)
        values ($1, $2, $3)
        on conflict (email) do nothing
        returning id::text, email, name, picture_url, default_schedule_timezone
      `,
      [input.email, input.name, input.picture]
    );

    const createdUser = createdUserResult.rows[0] ?? null;
    if (!createdUser) {
      await client.query('rollback');
      return {
        reason: 'existing_user' as const,
        user: null
      };
    }

    if (invite.group_id) {
      await client.query(
        `
          insert into user_group_memberships (group_id, user_id)
          values ($1, $2)
          on conflict do nothing
        `,
        [invite.group_id, createdUser.id]
      );
    }

    await client.query(
      `
        update registration_invites
        set
          used_by_user_id = $2,
          used_by_email = $3,
          used_at = now(),
          updated_at = now()
        where id = $1
      `,
      [invite.id, createdUser.id, input.email]
    );

    await client.query('commit');
    return {
      reason: null,
      user: createdUser
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
