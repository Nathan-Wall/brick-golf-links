import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import type { PoolClient } from 'pg';

import { getProvisionedHosts } from '../config/domains.js';
import { getMigrationConfig } from '../config/migration-config.js';
import { pool } from './pool.js';

const migrationConfig = getMigrationConfig();
const DOMAIN_BOOTSTRAP_MARKER_ID = 'bootstrap_managed_domains_from_config';

function resolveMigrationsDir() {
  const candidates = [
    migrationConfig.migrationsDir,
    path.resolve(process.cwd(), 'server/migrations'),
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), '../migrations')
  ].filter((value): value is string => Boolean(value));

  const match = candidates.find((candidate) => fsSync.existsSync(candidate));
  if (!match) {
    throw new Error('Unable to locate the SQL migrations directory.');
  }

  return match;
}

async function hasAppliedMigration(client: PoolClient, id: string) {
  const result = await client.query('select 1 from schema_migrations where id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

async function shouldBootstrapManagedDomains(client: PoolClient) {
  if (await hasAppliedMigration(client, DOMAIN_BOOTSTRAP_MARKER_ID)) {
    return false;
  }

  const [userCountResult, linkCountResult] = await Promise.all([
    client.query<{ count: string }>('select count(*)::text as count from users'),
    client.query<{ count: string }>('select count(*)::text as count from links')
  ]);

  return (
    Number(userCountResult.rows[0]?.count ?? '0') === 0 &&
    Number(linkCountResult.rows[0]?.count ?? '0') === 0
  );
}

async function bootstrapManagedDomainsFromConfig(client: PoolClient, provisionedHosts: string[]) {
  await client.query('begin');

  try {
    // Fresh installs should reflect the current deploy configuration rather than
    // historical owner-specific seed rows from old SQL migrations. Provisioned
    // hosts start as canonical domains; alias/auth-provider relationships remain
    // runtime-managed in the database.
    await client.query('delete from domain_host_settings');
    await client.query('delete from domain_aliases');
    await client.query('delete from domains');

    for (const host of provisionedHosts) {
      await client.query(
        `
          insert into domains (canonical_host, label, is_default_for_new_accounts)
          values ($1, $2, true)
        `,
        [host, host]
      );
    }

    for (const host of provisionedHosts) {
      await client.query(
        `
          insert into domain_host_settings (host, root_redirect_slug, auth_provider_host)
          values ($1, 'admin', null)
        `,
        [host]
      );
    }

    await client.query('insert into schema_migrations (id) values ($1)', [
      DOMAIN_BOOTSTRAP_MARKER_ID
    ]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function runMigrations() {
  const client = await pool.connect();
  const migrationsDir = resolveMigrationsDir();
  let inTransaction = false;

  try {
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (await hasAppliedMigration(client, file)) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');

      await client.query('begin');
      inTransaction = true;
      await client.query(sql);
      await client.query('insert into schema_migrations (id) values ($1)', [file]);
      await client.query('commit');
      inTransaction = false;
    }

    if (await shouldBootstrapManagedDomains(client)) {
      await bootstrapManagedDomainsFromConfig(client, getProvisionedHosts(process.env.DOMAINS_JSON));
    }
  } catch (error) {
    if (inTransaction) {
      await client.query('rollback');
    }
    throw error;
  } finally {
    client.release();
  }
}
