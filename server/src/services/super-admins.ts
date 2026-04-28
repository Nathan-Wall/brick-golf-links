import { getAdminConfig } from '../config/admin-config.js';

const adminConfig = getAdminConfig();

export function isSuperAdminEmail(email: string) {
  return adminConfig.superAdminEmails.includes(email.toLowerCase());
}
