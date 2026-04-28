import { OAuth2Client } from 'google-auth-library';

import { getAuthConfig } from '../config/auth-config.js';

const authConfig = getAuthConfig();
const googleClient = authConfig.googleClientId
  ? new OAuth2Client(authConfig.googleClientId)
  : null;

export type GoogleProfile = {
  email: string;
  name: string;
  picture: string | null;
};

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!googleClient || !authConfig.googleClientId) {
    throw new Error('Google sign-in is not configured.');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: authConfig.googleClientId
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.name) {
    throw new Error('Google account payload is missing required fields.');
  }

  if (payload.email_verified !== true) {
    throw new Error('This Google account email is not verified.');
  }

  if (authConfig.allowAllVerifiedGoogleAccounts) {
    return {
      email: payload.email.toLowerCase(),
      name: payload.name,
      picture: payload.picture ?? null
    };
  }

  return {
    email: payload.email.toLowerCase(),
    name: payload.name,
    picture: payload.picture ?? null
  };
}
