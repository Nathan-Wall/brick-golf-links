import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const migrationConfigSchema = z.object({
  MIGRATIONS_DIR: z.string().optional()
});

export const getMigrationConfig = createCachedConfig(() => {
  const parsed = migrationConfigSchema.parse(process.env);

  return {
    migrationsDir: parsed.MIGRATIONS_DIR ?? null
  };
});
