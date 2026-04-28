import { type Response, Router } from 'express';
import { z } from 'zod';

import { getAppConfig } from '../config/app-config.js';
import { getAuthConfig } from '../config/auth-config.js';
import {
  findAvailableRegistrationInviteByToken,
  hasUserRegisteredViaInvite,
  registerUserWithInvite
} from '../db/registration-invites.js';
import {
  findUserByEmail,
  getUserEffectiveDomainAdministrationHosts,
  getUserEffectiveDomainAccess,
  initializeUserDomainAccess,
  syncAutomaticGroupMembershipsForEmail,
  upsertUser
} from '../db/users.js';
import {
  createAnalyticsSuppressionToken,
  createSessionToken,
  getAnalyticsSuppressionCookieName,
  getSessionCookieName
} from '../services/session.js';
import { getInitialCanonicalHostsForEmail } from '../services/domains.js';
import {
  EmailAuthError,
  requestEmailSignInCode,
  verifyEmailSignInCode
} from '../services/email-auth.js';
import { verifyGoogleIdToken } from '../services/google-auth.js';
import {
  canEmailCodeSelfRegister,
  canGoogleEmailSelfRegister
} from '../services/auth-policy.js';
import { isSuperAdminEmail } from '../services/super-admins.js';

const router = Router();
const appConfig = getAppConfig();
const authConfig = getAuthConfig();

const inviteTokenSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z.string().min(1).max(200).optional()
);

const googleAuthSchema = z.object({
  credential: z.string().min(1),
  inviteToken: inviteTokenSchema
});

const requestEmailCodeSchema = z.object({
  email: z.string().trim().email(),
  inviteToken: inviteTokenSchema
});

const verifyEmailCodeSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(1),
  inviteToken: inviteTokenSchema
});

const inviteStatusQuerySchema = z.object({
  inviteToken: z.string().trim().min(1).max(200)
});

async function getSignedInUserAccess(email: string, userId: string, isExistingUser: boolean) {
  if (!isExistingUser) {
    await initializeUserDomainAccess(userId, await getInitialCanonicalHostsForEmail(email));
    await syncAutomaticGroupMembershipsForEmail(userId, email);
  }

  const [allowedCanonicalHosts, administeredDomainHosts] = await Promise.all([
    getUserEffectiveDomainAccess(userId),
    getUserEffectiveDomainAdministrationHosts(userId)
  ]);

  return {
    allowedCanonicalHosts,
    administeredDomainHosts
  };
}

async function resolveRegistrationContext(email: string, inviteToken: string | undefined) {
  const existingUser = await findUserByEmail(email);
  const existingUserHasInvite = existingUser
    ? await hasUserRegisteredViaInvite(existingUser.id)
    : false;

  if (existingUser) {
    return {
      existingUser,
      existingUserHasInvite,
      invite: null
    };
  }

  if (!inviteToken) {
    return {
      existingUser,
      existingUserHasInvite,
      invite: null
    };
  }

  const invite = await findAvailableRegistrationInviteByToken(inviteToken);
  if (!invite) {
    throw new Error('This invite link is invalid or has already been used.');
  }

  return {
    existingUser,
    existingUserHasInvite,
    invite
  };
}

router.get('/auth/invite-status', async (request, response) => {
  const parsedQuery = inviteStatusQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    response.status(400).json({ error: 'Invalid invite token.' });
    return;
  }

  const invite = await findAvailableRegistrationInviteByToken(parsedQuery.data.inviteToken);
  response.json({
    isAvailable: Boolean(invite)
  });
});

async function buildSignedInUser(
  profile: { email: string; name: string; picture: string | null },
  options?: {
    existingUser?: Awaited<ReturnType<typeof findUserByEmail>>;
    inviteToken?: string;
    useInvite?: boolean;
  }
) {
  const existingUser = options?.existingUser ?? (await findUserByEmail(profile.email));
  let userRecord;

  if (options?.useInvite && options.inviteToken) {
    const registrationResult = await registerUserWithInvite({
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      inviteToken: options.inviteToken
    });

    if (registrationResult.reason === 'invalid_or_used') {
      throw new Error('This invite link is invalid or has already been used.');
    }

    if (registrationResult.reason === 'existing_user') {
      throw new Error('This invite link can only be used to register a new account.');
    }

    if (!registrationResult.user) {
      throw new Error('Unable to register with this invite link.');
    }

    userRecord = registrationResult.user;
  } else {
    userRecord = await upsertUser(profile);
  }

  const { allowedCanonicalHosts, administeredDomainHosts } = await getSignedInUserAccess(
    profile.email,
    userRecord.id,
    options?.useInvite ? false : existingUser !== null
  );

  return {
    sessionToken: await createSessionToken(profile),
    analyticsSuppressionToken: await createAnalyticsSuppressionToken(profile.email),
    user: {
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      isSuperAdmin: isSuperAdminEmail(profile.email),
      allowedCanonicalHosts,
      administeredDomainHosts,
      defaultScheduleTimezone: userRecord.default_schedule_timezone
    }
  };
}

function setSignedInCookies(
  response: Response,
  tokens: { sessionToken: string; analyticsSuppressionToken: string }
) {
  response.cookie(getSessionCookieName(), tokens.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.nodeEnv === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  response.cookie(getAnalyticsSuppressionCookieName(), tokens.analyticsSuppressionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.nodeEnv === 'production',
    maxAge: 90 * 24 * 60 * 60 * 1000
  });
}

router.get('/auth/config', (_request, response) => {
  response.json({
    googleClientId: authConfig.googleClientId,
    emailCodeEnabled: authConfig.emailCodeAuth.enabled,
    allowedEmails: authConfig.allowedEmails,
    allowedEmailDomains: authConfig.allowedEmailDomains,
    allowAllVerifiedGoogleAccounts: authConfig.allowAllVerifiedGoogleAccounts
  });
});

router.post('/auth/google', async (request, response) => {
  const parsedBody = googleAuthSchema.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({ error: 'Invalid authentication payload.' });
    return;
  }

  try {
    const profile = await verifyGoogleIdToken(parsedBody.data.credential);
    const registrationContext = await resolveRegistrationContext(
      profile.email,
      parsedBody.data.inviteToken
    );

    if (
      !canGoogleEmailSelfRegister(profile.email) &&
      !registrationContext.existingUserHasInvite &&
      !registrationContext.invite
    ) {
      throw new Error('This Google account is not allowed to sign in.');
    }

    const signedIn = await buildSignedInUser(profile, {
      existingUser: registrationContext.existingUser,
      inviteToken: parsedBody.data.inviteToken,
      useInvite: Boolean(registrationContext.invite)
    });
    setSignedInCookies(response, signedIn);

    response.json({
      user: signedIn.user
    });
  } catch (error) {
    response.status(403).json({
      error: error instanceof Error ? error.message : 'Unable to sign in.'
    });
  }
});

router.post('/auth/email/request', async (request, response) => {
  const parsedBody = requestEmailCodeSchema.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({ error: 'Invalid email address.' });
    return;
  }

  try {
    const registrationContext = await resolveRegistrationContext(
      parsedBody.data.email,
      parsedBody.data.inviteToken
    );
    const forwardedFor = request.get('x-forwarded-for');
    const requestedIp = forwardedFor?.split(',')[0]?.trim() || request.ip || null;
    const requestedHost = request.get('host') ?? null;
    const result = await requestEmailSignInCode({
      email: parsedBody.data.email,
      requestedIp,
      originHost: requestedHost
    }, {
      allowUnlistedEmail: Boolean(
        registrationContext.invite || registrationContext.existingUserHasInvite
      )
    });

    response.json({
      email: result.email,
      expiresInMinutes: result.expiresInMinutes
    });
  } catch (error) {
    const statusCode = error instanceof EmailAuthError ? error.statusCode : 400;
    response.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Unable to send a sign-in code.'
    });
  }
});

router.post('/auth/email/verify', async (request, response) => {
  const parsedBody = verifyEmailCodeSchema.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({ error: 'Invalid email code payload.' });
    return;
  }

  try {
    const registrationContext = await resolveRegistrationContext(
      parsedBody.data.email,
      parsedBody.data.inviteToken
    );
    const profile = await verifyEmailSignInCode(parsedBody.data, {
      allowUnlistedEmail: Boolean(
        registrationContext.invite || registrationContext.existingUserHasInvite
      )
    });

    if (
      !canEmailCodeSelfRegister(profile.email) &&
      !registrationContext.existingUserHasInvite &&
      !registrationContext.invite
    ) {
      throw new Error('This email address is not allowed to sign in.');
    }

    const signedIn = await buildSignedInUser(profile, {
      existingUser: registrationContext.existingUser,
      inviteToken: parsedBody.data.inviteToken,
      useInvite: Boolean(registrationContext.invite)
    });
    setSignedInCookies(response, signedIn);

    response.json({
      user: signedIn.user
    });
  } catch (error) {
    const statusCode = error instanceof EmailAuthError ? error.statusCode : 400;
    response.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Unable to sign in.'
    });
  }
});

router.post('/logout', (_request, response) => {
  response.clearCookie(getSessionCookieName(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.nodeEnv === 'production'
  });
  response.clearCookie(getAnalyticsSuppressionCookieName(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.nodeEnv === 'production'
  });
  response.status(204).send();
});

export const authRouter = router;
