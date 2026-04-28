import { loadRuntimeConfig } from '../runtime/load-runtime-config.js';

await loadRuntimeConfig();

const [{ runMigrations }, { pool }] = await Promise.all([
  import('./migrate.js'),
  import('./pool.js')
]);

await runMigrations();
await pool.end();
