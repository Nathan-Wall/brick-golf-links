import { pool } from './pool.js';

export type DomainRecord = {
  canonical_host: string;
  label: string;
  is_default_for_new_accounts: boolean;
  aliases: string[];
  link_count: number;
  created_at: string;
  updated_at: string;
};

export type DomainHostSettingRecord = {
  host: string;
  root_redirect_slug: string;
  auth_provider_host: string | null;
};

export type DomainHostState =
  | {
      kind: 'canonical';
    }
  | {
      kind: 'alias';
      canonicalHost: string;
    }
  | {
      kind: 'missing';
    };

type DomainSettingsQueryable = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

async function ensureDomainHostSettingsExist(
  hosts: string[],
  queryable: DomainSettingsQueryable = pool
) {
  const normalizedHosts = [...new Set(hosts.map((host) => host.toLowerCase()))];
  if (normalizedHosts.length === 0) {
    return;
  }

  await queryable.query(
    `
      insert into domain_host_settings (host, root_redirect_slug)
      select host, 'admin'
      from unnest($1::text[]) as host
      on conflict (host) do nothing
    `,
    [normalizedHosts]
  );
}

export async function listDomains() {
  const result = await pool.query<DomainRecord>(
    `
      select
        domains.canonical_host,
        domains.label,
        domains.is_default_for_new_accounts,
        coalesce(
          array_remove(array_agg(distinct domain_aliases.alias_host order by domain_aliases.alias_host), null),
          '{}'
        ) as aliases,
        count(distinct links.id)::int as link_count,
        domains.created_at::text,
        domains.updated_at::text
      from domains
      left join domain_aliases on domain_aliases.canonical_host = domains.canonical_host
      left join links on links.canonical_host = domains.canonical_host
      group by
        domains.canonical_host,
        domains.label,
        domains.is_default_for_new_accounts,
        domains.created_at,
        domains.updated_at
      order by lower(domains.canonical_host) asc
    `
  );

  return result.rows;
}

export async function listDomainHostSettings() {
  const result = await pool.query<DomainHostSettingRecord>(
    `
      select
        host,
        root_redirect_slug,
        auth_provider_host
      from domain_host_settings
      order by lower(host) asc
    `
  );

  return result.rows;
}

export async function listDefaultCanonicalHosts() {
  const result = await pool.query<{ canonical_host: string }>(
    `
      select canonical_host
      from domains
      where is_default_for_new_accounts = true
      order by canonical_host asc
    `
  );

  return result.rows.map((row) => row.canonical_host);
}

export async function ensureProvisionedHostSettingsExist(hosts: string[]) {
  const normalizedHosts = [...new Set(hosts.map((host) => host.toLowerCase()))];
  if (normalizedHosts.length === 0) {
    return;
  }

  await ensureDomainHostSettingsExist(normalizedHosts);
}

export async function findDomainHostState(host: string): Promise<DomainHostState> {
  const normalizedHost = host.toLowerCase();
  const [domainResult, aliasResult] = await Promise.all([
    pool.query<{ canonical_host: string }>(
      `
        select canonical_host
        from domains
        where canonical_host = $1
        limit 1
      `,
      [normalizedHost]
    ),
    pool.query<{ canonical_host: string }>(
      `
        select canonical_host
        from domain_aliases
        where alias_host = $1
        limit 1
      `,
      [normalizedHost]
    )
  ]);

  if (domainResult.rowCount) {
    return { kind: 'canonical' };
  }

  if (aliasResult.rowCount) {
    return {
      kind: 'alias',
      canonicalHost: aliasResult.rows[0].canonical_host
    };
  }

  return { kind: 'missing' };
}

export async function createCanonicalDomain(host: string) {
  const normalizedHost = host.toLowerCase();

  await pool.query(
    `
      insert into domains (canonical_host, label, is_default_for_new_accounts)
      values ($1, $1, false)
      on conflict (canonical_host) do nothing
    `,
    [normalizedHost]
  );
}

export async function updateDomainDefaults(input: {
  canonicalHost: string;
  isDefaultForNewAccounts: boolean;
}) {
  const result = await pool.query<DomainRecord>(
    `
      with updated_domain as (
        update domains
        set is_default_for_new_accounts = $2,
            updated_at = now()
        where canonical_host = $1
        returning canonical_host, label, is_default_for_new_accounts, created_at, updated_at
      )
      select
        updated_domain.canonical_host,
        updated_domain.label,
        updated_domain.is_default_for_new_accounts,
        coalesce(
          array_remove(array_agg(distinct domain_aliases.alias_host order by domain_aliases.alias_host), null),
          '{}'
        ) as aliases,
        count(distinct links.id)::int as link_count,
        updated_domain.created_at::text,
        updated_domain.updated_at::text
      from updated_domain
      left join domain_aliases on domain_aliases.canonical_host = updated_domain.canonical_host
      left join links on links.canonical_host = updated_domain.canonical_host
      group by
        updated_domain.canonical_host,
        updated_domain.label,
        updated_domain.is_default_for_new_accounts,
        updated_domain.created_at,
        updated_domain.updated_at
    `,
    [input.canonicalHost, input.isDefaultForNewAccounts]
  );

  return result.rows[0] ?? null;
}

export async function updateDomainRootRedirectSlug(input: {
  host: string;
  rootRedirectSlug: string;
  allowMissingHost?: boolean;
}) {
  const normalizedHost = input.host.toLowerCase();
  const normalizedSlug = input.rootRedirectSlug.toLowerCase();

  if (!input.allowMissingHost) {
    const hostExistsResult = await pool.query(
      `
        select 1
        from domains
        where canonical_host = $1
        union
        select 1
        from domain_aliases
        where alias_host = $1
        limit 1
      `,
      [normalizedHost]
    );

    if (!hostExistsResult.rowCount) {
      return null;
    }
  }

  const result = await pool.query<DomainHostSettingRecord>(
    `
      insert into domain_host_settings (host, root_redirect_slug)
      values ($1, $2)
      on conflict (host)
      do update
      set root_redirect_slug = excluded.root_redirect_slug,
          updated_at = now()
      returning host, root_redirect_slug
    `,
    [normalizedHost, normalizedSlug]
  );

  return result.rows[0] ?? null;
}

export async function updateDomainAuthProviderHost(input: {
  host: string;
  authProviderHost: string | null;
  allowMissingHost?: boolean;
}) {
  const normalizedHost = input.host.toLowerCase();
  const normalizedAuthProviderHost = input.authProviderHost?.toLowerCase() ?? null;

  if (normalizedAuthProviderHost === normalizedHost) {
    return { ok: false as const, reason: 'self_target' as const };
  }

  if (!input.allowMissingHost) {
    const hostExistsResult = await pool.query(
      `
        select 1
        from domains
        where canonical_host = $1
        union
        select 1
        from domain_aliases
        where alias_host = $1
        limit 1
      `,
      [normalizedHost]
    );

    if (!hostExistsResult.rowCount) {
      return { ok: false as const, reason: 'not_found' as const };
    }
  }

  const result = await pool.query<DomainHostSettingRecord>(
    `
      insert into domain_host_settings (host, root_redirect_slug, auth_provider_host)
      values ($1, 'admin', $2)
      on conflict (host)
      do update
      set auth_provider_host = excluded.auth_provider_host,
          updated_at = now()
      returning host, root_redirect_slug, auth_provider_host
    `,
    [normalizedHost, normalizedAuthProviderHost]
  );

  return { ok: true as const, settings: result.rows[0] ?? null };
}

export async function setDomainAliasTarget(input: {
  host: string;
  aliasTargetHost: string | null;
  createHostIfMissing?: boolean;
  createTargetIfMissing?: boolean;
}) {
  const host = input.host.toLowerCase();
  const aliasTargetHost = input.aliasTargetHost?.toLowerCase() ?? null;
  const client = await pool.connect();

  try {
    await client.query('begin');

    if (aliasTargetHost && aliasTargetHost === host) {
      await client.query('rollback');
      return { ok: false as const, reason: 'self_target' as const };
    }

    if (input.createHostIfMissing) {
      await client.query(
        `
          insert into domains (canonical_host, label, is_default_for_new_accounts)
          values ($1, $1, false)
          on conflict (canonical_host) do nothing
        `,
        [host]
      );
    }

    const hostDomainResult = await client.query<{ label: string; is_default_for_new_accounts: boolean }>(
      `
        select label, is_default_for_new_accounts
        from domains
        where canonical_host = $1
        limit 1
      `,
      [host]
    );
    const hostAliasResult = await client.query<{ canonical_host: string }>(
      `
        select canonical_host
        from domain_aliases
        where alias_host = $1
        limit 1
      `,
      [host]
    );

    if (!hostDomainResult.rowCount && !hostAliasResult.rowCount) {
      await client.query('rollback');
      return { ok: false as const, reason: 'not_found' as const };
    }

    if (!aliasTargetHost) {
      await client.query(
        `
          insert into domains (canonical_host, label, is_default_for_new_accounts)
          values ($1, $1, false)
          on conflict (canonical_host) do nothing
        `,
        [host]
      );
      await ensureDomainHostSettingsExist([host], client);

      if (hostAliasResult.rowCount) {
        const previousCanonicalHost = hostAliasResult.rows[0].canonical_host;

        await client.query(
          `
            insert into user_domain_access (user_id, canonical_host)
            select user_id, $1
            from user_domain_access
            where canonical_host = $2
            on conflict do nothing
          `,
          [host, previousCanonicalHost]
        );
      }

      await client.query('delete from domain_aliases where alias_host = $1', [host]);
      await client.query('commit');
      return { ok: true as const };
    }

    if (input.createTargetIfMissing) {
      await client.query(
        `
          insert into domains (canonical_host, label, is_default_for_new_accounts)
          values ($1, $1, false)
          on conflict (canonical_host) do nothing
        `,
        [aliasTargetHost]
      );
    }

    const targetResult = await client.query(
      `
        select 1
        from domains
        where canonical_host = $1
        limit 1
      `,
      [aliasTargetHost]
    );

    if (!targetResult.rowCount) {
      await client.query('rollback');
      return { ok: false as const, reason: 'invalid_target' as const };
    }

    if (hostDomainResult.rowCount) {
      const linkCountResult = await client.query<{ count: string }>(
        `
          select count(*)::text as count
          from links
          where canonical_host = $1
        `,
        [host]
      );

      if (Number(linkCountResult.rows[0]?.count ?? '0') > 0) {
        await client.query('rollback');
        return { ok: false as const, reason: 'in_use' as const };
      }

      await client.query(
        `
          update domain_aliases
          set canonical_host = $2
          where canonical_host = $1
            and alias_host <> $1
        `,
        [host, aliasTargetHost]
      );

      await client.query('delete from domains where canonical_host = $1', [host]);
      await client.query('delete from user_domain_access where canonical_host = $1', [host]);
    }

    await client.query(
      `
        insert into domain_aliases (alias_host, canonical_host)
        values ($1, $2)
        on conflict (alias_host)
        do update set canonical_host = excluded.canonical_host
      `,
      [host, aliasTargetHost]
    );
    await ensureDomainHostSettingsExist([host], client);

    await client.query('commit');
    return { ok: true as const };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
