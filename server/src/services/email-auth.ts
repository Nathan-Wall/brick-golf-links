import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { z } from 'zod';

import { getAppConfig } from '../config/app-config.js';
import { getAuthConfig } from '../config/auth-config.js';
import { getSessionConfig } from '../config/session-config.js';
import {
  consumeEmailSignInCode,
  countRecentEmailSignInRequestsByEmail,
  countRecentEmailSignInRequestsByIp,
  createEmailSignInCode,
  findLatestPendingEmailSignInCode,
  incrementEmailSignInCodeFailedAttempts,
  invalidateOtherActiveEmailSignInCodes
} from '../db/email-sign-in-codes.js';
import { findUserByEmail } from '../db/users.js';
import { assertAllowedEmailCodeSignIn, normalizeEmailAddress } from './auth-policy.js';

const appConfig = getAppConfig();
const authConfig = getAuthConfig();
const emailSchema = z.string().trim().email();
const codeSchema = z.string().trim().min(1);
const signInCodeTtlMinutes = 10;
const signInCodeCooldownSeconds = 60;
const signInCodeRequestWindowMinutes = 15;
const maxRequestsPerEmailWindow = 5;
const maxRequestsPerIpWindow = 12;
const maxFailedAttemptsPerCode = 5;
const sesClient = new SESv2Client({});

export class EmailAuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'EmailAuthError';
    this.statusCode = statusCode;
  }
}

function getSesErrorName(error: unknown) {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }

  return null;
}

function getSesErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return null;
}

function getSesErrorMetadata(error: unknown) {
  if (!error || typeof error !== 'object' || !('$metadata' in error)) {
    return null;
  }

  const metadata = error.$metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return {
    httpStatusCode:
      'httpStatusCode' in metadata && typeof metadata.httpStatusCode === 'number'
        ? metadata.httpStatusCode
        : null,
    requestId:
      'requestId' in metadata && typeof metadata.requestId === 'string'
        ? metadata.requestId
        : null,
    attempts: 'attempts' in metadata && typeof metadata.attempts === 'number' ? metadata.attempts : null
  };
}

function redactEmailForLogs(email: string) {
  const [localPart, domain] = normalizeEmailAddress(email).split('@');
  if (!localPart || !domain) {
    return '[redacted]';
  }

  return `${localPart[0] ?? '*'}***@${domain}`;
}

function getEmailDeliveryFailureMessage(error: unknown) {
  const errorName = getSesErrorName(error);

  switch (errorName) {
    case 'MessageRejected':
    case 'MailFromDomainNotVerifiedException':
    case 'BadRequestException':
      return 'Email delivery is not ready. Check SES sender verification, sandbox status, and recipient verification in the configured AWS region.';
    case 'AccessDeniedException':
    case 'NotAuthorizedException':
      return 'Email delivery is not authorized. Check the app SES send permissions and EMAIL_AUTH_SES_IDENTITY_ARN.';
    case 'SendingPausedException':
    case 'AccountSuspendedException':
    case 'TooManyRequestsException':
      return 'Email delivery is temporarily unavailable. Please try again shortly.';
    default:
      return 'Unable to send the sign-in code email.';
  }
}

function requireEmailCodeAuthEnabled() {
  if (!authConfig.emailCodeAuth.enabled) {
    throw new EmailAuthError('Email code sign-in is not configured.', 503);
  }
}

function getRequestWindowStart() {
  return new Date(Date.now() - signInCodeRequestWindowMinutes * 60 * 1000).toISOString();
}

function hashSignInCode(email: string, code: string) {
  return createHmac('sha256', getSessionConfig().jwtSecret)
    .update(`${email}\u0000${code}`)
    .digest();
}

function createSignInCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function getOriginLabel(originHost: string | null) {
  if (originHost?.trim()) {
    return originHost.trim();
  }

  return new URL(appConfig.appBaseUrl).host;
}

function formatCodeDisplayName(email: string) {
  const localPart = normalizeEmailAddress(email).split('@')[0] ?? '';
  const words = localPart
    .split(/[._+-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return email;
  }

  return words
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}

async function sendCodeEmail(input: { email: string; code: string; originHost: string | null }) {
  const originLabel = getOriginLabel(input.originHost);
  const fromEmailAddress = authConfig.emailCodeAuth.fromName
    ? `${authConfig.emailCodeAuth.fromName} <${authConfig.emailCodeAuth.fromEmail!}>`
    : authConfig.emailCodeAuth.fromEmail!;
  const messageBody = [
      `Use this code to sign in to ${originLabel}:`,
      '',
      input.code,
      '',
      `This code expires in ${signInCodeTtlMinutes} minutes.`,
      `If you did not request this code, you can ignore this email.`
    ].join('\n');

  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: fromEmailAddress,
      Destination: {
        ToAddresses: [input.email]
      },
      Content: {
        Simple: {
          Subject: {
            Charset: 'UTF-8',
            Data: `Your sign-in code for ${originLabel}`
          },
          Body: {
            Text: {
              Charset: 'UTF-8',
              Data: messageBody
            }
          }
        }
      },
      EmailTags: [
        {
          Name: 'feature',
          Value: 'email-auth'
        }
      ]
    })
  );
}

function normalizeRequestedEmail(email: string) {
  return emailSchema.parse(normalizeEmailAddress(email));
}

function normalizeSubmittedCode(code: string) {
  const normalizedCode = codeSchema.parse(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new EmailAuthError('Enter the 6-digit code from your email.', 400);
  }

  return normalizedCode;
}

export async function requestEmailSignInCode(input: {
  email: string;
  requestedIp: string | null;
  originHost: string | null;
}, options?: {
  allowUnlistedEmail?: boolean;
}) {
  requireEmailCodeAuthEnabled();

  const normalizedEmail = normalizeRequestedEmail(input.email);
  const email = options?.allowUnlistedEmail
    ? normalizedEmail
    : assertAllowedEmailCodeSignIn(normalizedEmail);
  const latestPendingCode = await findLatestPendingEmailSignInCode(email);
  const now = Date.now();

  if (latestPendingCode) {
    const createdAtMs = new Date(latestPendingCode.created_at).getTime();
    const remainingCooldownMs =
      createdAtMs + signInCodeCooldownSeconds * 1000 - now;

    if (remainingCooldownMs > 0) {
      const remainingSeconds = Math.ceil(remainingCooldownMs / 1000);
      throw new EmailAuthError(
        `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} before requesting another code.`,
        429
      );
    }
  }

  const requestWindowStart = getRequestWindowStart();
  const [emailRequestCount, ipRequestCount] = await Promise.all([
    countRecentEmailSignInRequestsByEmail(email, requestWindowStart),
    input.requestedIp
      ? countRecentEmailSignInRequestsByIp(input.requestedIp, requestWindowStart)
      : Promise.resolve(0)
  ]);

  if (emailRequestCount >= maxRequestsPerEmailWindow) {
    throw new EmailAuthError(
      'Too many sign-in codes were requested for this email. Please wait 15 minutes and try again.',
      429
    );
  }

  if (ipRequestCount >= maxRequestsPerIpWindow) {
    throw new EmailAuthError(
      'Too many sign-in code requests came from this network. Please wait 15 minutes and try again.',
      429
    );
  }

  const code = createSignInCode();
  const codeId = await createEmailSignInCode({
    email,
    codeHash: hashSignInCode(email, code).toString('hex'),
    requestedIp: input.requestedIp,
    expiresAt: new Date(now + signInCodeTtlMinutes * 60 * 1000).toISOString()
  });

  if (!codeId) {
    throw new EmailAuthError('Unable to create a sign-in code.', 500);
  }

  try {
    await sendCodeEmail({
      email,
      code,
      originHost: input.originHost
    });
    await invalidateOtherActiveEmailSignInCodes(email, codeId);
  } catch (error) {
    await consumeEmailSignInCode(codeId);
    const sesMetadata = getSesErrorMetadata(error);

    console.error('Unable to send email sign-in code.', {
      email: redactEmailForLogs(email),
      fromEmail: authConfig.emailCodeAuth.fromEmail,
      sesErrorName: getSesErrorName(error),
      sesErrorMessage: getSesErrorMessage(error),
      sesRequestId: sesMetadata?.requestId ?? null,
      sesStatusCode: sesMetadata?.httpStatusCode ?? null,
      sesAttempts: sesMetadata?.attempts ?? null
    });

    throw new EmailAuthError(getEmailDeliveryFailureMessage(error), 502);
  }

  return {
    email,
    expiresInMinutes: signInCodeTtlMinutes
  };
}

export async function verifyEmailSignInCode(input: { email: string; code: string }, options?: {
  allowUnlistedEmail?: boolean;
}) {
  requireEmailCodeAuthEnabled();

  const normalizedEmail = normalizeRequestedEmail(input.email);
  const email = options?.allowUnlistedEmail
    ? normalizedEmail
    : assertAllowedEmailCodeSignIn(normalizedEmail);
  const code = normalizeSubmittedCode(input.code);
  const pendingCode = await findLatestPendingEmailSignInCode(email);

  if (!pendingCode) {
    throw new EmailAuthError('Invalid or expired code.', 400);
  }

  if (new Date(pendingCode.expires_at).getTime() <= Date.now()) {
    await consumeEmailSignInCode(pendingCode.id);
    throw new EmailAuthError('Invalid or expired code.', 400);
  }

  if (pendingCode.failed_attempt_count >= maxFailedAttemptsPerCode) {
    await consumeEmailSignInCode(pendingCode.id);
    throw new EmailAuthError('Too many incorrect attempts. Request a new code.', 429);
  }

  const providedHash = hashSignInCode(email, code);
  const storedHash = Buffer.from(pendingCode.code_hash, 'hex');
  const isMatch =
    storedHash.length === providedHash.length && timingSafeEqual(storedHash, providedHash);

  if (!isMatch) {
    const failedAttemptCount = await incrementEmailSignInCodeFailedAttempts(pendingCode.id);

    if (failedAttemptCount >= maxFailedAttemptsPerCode) {
      await consumeEmailSignInCode(pendingCode.id);
      throw new EmailAuthError('Too many incorrect attempts. Request a new code.', 429);
    }

    throw new EmailAuthError('Invalid or expired code.', 400);
  }

  await consumeEmailSignInCode(pendingCode.id);

  const existingUser = await findUserByEmail(email);

  return {
    email,
    name: existingUser?.name ?? formatCodeDisplayName(email),
    picture: existingUser?.picture_url ?? null
  };
}
