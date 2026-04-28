import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const adminConfigSchema = z.object({
  SUPER_ADMIN_EMAILS: z.string().optional()
});

export const getAdminConfig = createCachedConfig(() => {
  const parsed = adminConfigSchema.parse(process.env);

  return {
    superAdminEmails: (parsed.SUPER_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  };
});
