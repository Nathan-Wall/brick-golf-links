import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const queueConfigSchema = z.object({
  LINK_USAGE_QUEUE_URL: z.string().min(1).optional()
});

export const getQueueConfig = createCachedConfig(() => {
  const parsed = queueConfigSchema.parse(process.env);

  return {
    linkUsageQueueUrl: parsed.LINK_USAGE_QUEUE_URL ?? null
  };
});
