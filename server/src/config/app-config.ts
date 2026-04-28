import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const appConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_BUILD_ID: z.string().default('dev'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  VITE_APP_BASE_URL: z.string().url().optional(),
  CLIENT_DIST_DIR: z.string().optional()
});

export const getAppConfig = createCachedConfig(() => {
  const parsed = appConfigSchema.parse(process.env);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appBuildId: parsed.APP_BUILD_ID,
    appBaseUrl: parsed.APP_BASE_URL,
    viteAppBaseUrl: parsed.VITE_APP_BASE_URL ?? null,
    clientDistDir: parsed.CLIENT_DIST_DIR ?? null
  };
});
