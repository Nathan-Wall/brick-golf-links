import { loadRuntimeConfig } from './runtime/load-runtime-config.js';

await loadRuntimeConfig();

const [{ getAppConfig }, { createApp }, { runMigrations }] = await Promise.all([
  import('./config/app-config.js'),
  import('./app.js'),
  import('./db/migrate.js')
]);

await runMigrations();

const app = createApp();
const appConfig = getAppConfig();

app.listen(appConfig.port, () => {
  console.log(`Server listening on ${appConfig.port}`);
});
