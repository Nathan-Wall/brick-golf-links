import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const sessionConfigSchema = z.object({
  JWT_SECRET: z.string().min(32)
});

export const getSessionConfig = createCachedConfig(() => {
  const parsed = sessionConfigSchema.parse(process.env);

  return {
    jwtSecret: parsed.JWT_SECRET
  };
});
