import { z } from 'zod';

import { createCachedConfig } from './helpers.js';

const authConfigSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().optional(),
  ALLOWED_EMAILS_JSON: z.string().optional(),
  ALLOWED_EMAIL_DOMAINS_JSON: z.string().optional(),
  ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS: z
    .enum(['true', 'false', '1', '0'])
    .optional(),
  EMAIL_AUTH_FROM_EMAIL: z.string().optional(),
  EMAIL_AUTH_FROM_NAME: z.string().optional()
});

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseJsonStringArray(value: string | undefined, label: string) {
  if (!value) {
    return [];
  }

  try {
    const decoded = JSON.parse(value) as unknown;
    return z.array(z.string().min(1)).parse(decoded);
  } catch (error) {
    throw new Error(
      `${label} must be a JSON array of non-empty strings.${error instanceof Error ? ` ${error.message}` : ''}`
    );
  }
}

function parseAllowedEmails(parsed: z.infer<typeof authConfigSchema>) {
  return parseJsonStringArray(parsed.ALLOWED_EMAILS_JSON, 'ALLOWED_EMAILS_JSON')
    .map((email) => email.trim().toLowerCase())
    .map((email) => z.string().email().parse(email))
    .filter(Boolean);
}

function parseAllowedEmailDomains(parsed: z.infer<typeof authConfigSchema>) {
  return parseJsonStringArray(parsed.ALLOWED_EMAIL_DOMAINS_JSON, 'ALLOWED_EMAIL_DOMAINS_JSON')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function parseEmailCodeAuthConfig(parsed: z.infer<typeof authConfigSchema>) {
  const fromEmailValue = normalizeOptionalString(parsed.EMAIL_AUTH_FROM_EMAIL);
  const fromName = normalizeOptionalString(parsed.EMAIL_AUTH_FROM_NAME);
  const hasAnyEmailAuthConfig = fromEmailValue !== null || fromName !== null;

  if (!hasAnyEmailAuthConfig) {
    return {
      enabled: false,
      fromEmail: null,
      fromName: null
    };
  }

  if (!fromEmailValue) {
    throw new Error(
      'EMAIL_AUTH_FROM_EMAIL must be set to enable SES-backed email code sign-in.'
    );
  }

  return {
    enabled: true,
    fromEmail: z.string().email().parse(fromEmailValue.toLowerCase()),
    fromName
  };
}

export const getAuthConfig = createCachedConfig(() => {
  const parsed = authConfigSchema.parse(process.env);
  const allowedEmails = [...new Set(parseAllowedEmails(parsed))];
  const allowedEmailDomains = [...new Set(parseAllowedEmailDomains(parsed))];
  const emailCodeAuth = parseEmailCodeAuthConfig(parsed);

  return {
    googleClientId: normalizeOptionalString(parsed.GOOGLE_CLIENT_ID),
    allowedEmails,
    allowedEmailDomains,
    allowAllVerifiedGoogleAccounts:
      parsed.ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS === 'true' ||
      parsed.ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS === '1',
    emailCodeAuth
  };
});
