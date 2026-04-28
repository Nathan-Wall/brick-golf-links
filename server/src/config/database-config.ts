import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_HOST: z.string().min(1).optional(),
  DATABASE_PORT: z.coerce.number().default(5432),
  DATABASE_NAME: z.string().min(1).optional(),
  DATABASE_USER: z.string().min(1).optional(),
  DATABASE_PASSWORD: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(['disable', 'require']).optional()
});

export const getDatabaseConfig = createCachedConfig(() => {
  const parsed = databaseConfigSchema.parse(process.env);

  const hasDatabaseUrl = Boolean(parsed.DATABASE_URL);
  const hasDiscreteDatabaseConfig =
    Boolean(parsed.DATABASE_HOST) &&
    Boolean(parsed.DATABASE_NAME) &&
    Boolean(parsed.DATABASE_USER) &&
    Boolean(parsed.DATABASE_PASSWORD);

  if (!hasDatabaseUrl && !hasDiscreteDatabaseConfig) {
    throw new Error(
      'Database configuration is required. Set DATABASE_URL or DATABASE_HOST/DATABASE_NAME/DATABASE_USER/DATABASE_PASSWORD.'
    );
  }

  return hasDatabaseUrl
    ? {
        connectionString: parsed.DATABASE_URL!,
        ssl: parsed.DATABASE_SSL === 'require'
      }
    : {
        host: parsed.DATABASE_HOST!,
        port: parsed.DATABASE_PORT,
        database: parsed.DATABASE_NAME!,
        user: parsed.DATABASE_USER!,
        password: parsed.DATABASE_PASSWORD!,
        ssl: parsed.DATABASE_SSL ? parsed.DATABASE_SSL === 'require' : true
      };
});
