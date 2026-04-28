import { getAuthConfig } from '../config/auth-config.js';

const authConfig = getAuthConfig();

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowlistedEmail(email: string) {
  const normalizedEmail = normalizeEmailAddress(email);
  const emailDomain = normalizedEmail.split('@')[1]?.toLowerCase() ?? null;
  const isAllowedEmail = authConfig.allowedEmails.includes(normalizedEmail);
  const isAllowedDomain = emailDomain ? authConfig.allowedEmailDomains.includes(emailDomain) : false;

  return isAllowedEmail || isAllowedDomain;
}

export function canGoogleEmailSelfRegister(email: string) {
  return authConfig.allowAllVerifiedGoogleAccounts || isAllowlistedEmail(email);
}

export function canEmailCodeSelfRegister(email: string) {
  return isAllowlistedEmail(email);
}

export function assertAllowedGoogleSignIn(email: string) {
  const normalizedEmail = normalizeEmailAddress(email);

  if (canGoogleEmailSelfRegister(normalizedEmail)) {
    return normalizedEmail;
  }

  throw new Error('This Google account is not allowed to sign in.');
}

export function assertAllowedEmailCodeSignIn(email: string) {
  const normalizedEmail = normalizeEmailAddress(email);

  if (canEmailCodeSelfRegister(normalizedEmail)) {
    return normalizedEmail;
  }

  throw new Error('This email address is not allowed to sign in.');
}
