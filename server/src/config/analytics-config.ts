import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const analyticsConfigSchema = z.object({
  GOOGLE_ANALYTICS_MEASUREMENT_ID: z.string().optional(),
  GOOGLE_ANALYTICS_API_SECRET: z.string().optional()
});

export const getAnalyticsConfig = createCachedConfig(() => {
  const parsed = analyticsConfigSchema.parse(process.env);

  return {
    measurementId: parsed.GOOGLE_ANALYTICS_MEASUREMENT_ID ?? null,
    apiSecret: parsed.GOOGLE_ANALYTICS_API_SECRET ?? null,
    measurementProtocolEnabled: Boolean(
      parsed.GOOGLE_ANALYTICS_MEASUREMENT_ID && parsed.GOOGLE_ANALYTICS_API_SECRET
    )
  };
});
