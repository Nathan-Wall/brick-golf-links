import { pool } from './pool.js';

type CountRow = {
  count: number;
};

type EmailSignInCodeRow = {
  id: string;
  email: string;
  code_hash: string;
  requested_ip: string | null;
  failed_attempt_count: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

export async function countRecentEmailSignInRequestsByEmail(email: string, since: string) {
  const result = await pool.query<CountRow>(
    `
      select count(*)::int as count
      from email_sign_in_codes
      where lower(email) = lower($1)
        and created_at >= $2::timestamptz
    `,
    [email, since]
  );

  return result.rows[0]?.count ?? 0;
}

export async function countRecentEmailSignInRequestsByIp(requestedIp: string, since: string) {
  const result = await pool.query<CountRow>(
    `
      select count(*)::int as count
      from email_sign_in_codes
      where requested_ip = $1
        and created_at >= $2::timestamptz
    `,
    [requestedIp, since]
  );

  return result.rows[0]?.count ?? 0;
}

export async function createEmailSignInCode(input: {
  email: string;
  codeHash: string;
  requestedIp: string | null;
  expiresAt: string;
}) {
  const result = await pool.query<{ id: string }>(
    `
      insert into email_sign_in_codes (email, code_hash, requested_ip, expires_at)
      values ($1, $2, $3, $4::timestamptz)
      returning id
    `,
    [input.email, input.codeHash, input.requestedIp, input.expiresAt]
  );

  return result.rows[0]?.id ?? null;
}

export async function findLatestPendingEmailSignInCode(email: string) {
  const result = await pool.query<EmailSignInCodeRow>(
    `
      select
        id,
        email::text,
        code_hash,
        requested_ip,
        failed_attempt_count,
        expires_at::text,
        consumed_at::text,
        created_at::text
      from email_sign_in_codes
      where lower(email) = lower($1)
        and consumed_at is null
      order by created_at desc, id desc
      limit 1
    `,
    [email]
  );

  return result.rows[0] ?? null;
}

export async function invalidateOtherActiveEmailSignInCodes(email: string, keepId: string) {
  await pool.query(
    `
      update email_sign_in_codes
      set consumed_at = now()
      where lower(email) = lower($1)
        and consumed_at is null
        and id <> $2
    `,
    [email, keepId]
  );
}

export async function consumeEmailSignInCode(id: string) {
  await pool.query(
    `
      update email_sign_in_codes
      set consumed_at = coalesce(consumed_at, now())
      where id = $1
    `,
    [id]
  );
}

export async function incrementEmailSignInCodeFailedAttempts(id: string) {
  const result = await pool.query<{ failed_attempt_count: number }>(
    `
      update email_sign_in_codes
      set failed_attempt_count = failed_attempt_count + 1
      where id = $1
      returning failed_attempt_count
    `,
    [id]
  );

  return result.rows[0]?.failed_attempt_count ?? 0;
}
