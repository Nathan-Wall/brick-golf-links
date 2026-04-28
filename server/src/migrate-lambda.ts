import type { Handler } from 'aws-lambda';

import { loadRuntimeConfig } from './runtime/load-runtime-config.js';

export const handler: Handler = async () => {
  await loadRuntimeConfig();

  const [{ runMigrations }, { pool }] = await Promise.all([
    import('./db/migrate.js'),
    import('./db/pool.js')
  ]);

  await runMigrations();
  await pool.end();

  return {
    statusCode: 200,
    body: 'Migrations complete.'
  };
};
