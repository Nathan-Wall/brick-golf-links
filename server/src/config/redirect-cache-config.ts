import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const redirectCacheConfigSchema = z.object({
  REDIRECT_CACHE_URL: z.string().url().optional()
});

export const getRedirectCacheConfig = createCachedConfig(() => {
  const parsed = redirectCacheConfigSchema.parse(process.env);

  return {
    redirectCacheUrl: parsed.REDIRECT_CACHE_URL ?? null
  };
});
