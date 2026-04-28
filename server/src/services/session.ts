import { SignJWT, jwtVerify } from 'jose';

import { getSessionConfig } from '../config/session-config.js';

const sessionCookieName = 'go_links_session';
const analyticsSuppressionCookieName = 'go_links_last_user';
const linkPasswordAccessCookiePrefix = 'go_links_link_password_';

let encodedSecret: Uint8Array | null = null;

function getEncodedSecret() {
  if (!encodedSecret) {
    encodedSecret = new TextEncoder().encode(getSessionConfig().jwtSecret);
  }

  return encodedSecret;
}

export type SessionIdentity = {
  email: string;
  name: string;
  picture: string | null;
};

export type SessionUser = SessionIdentity & {
  isSuperAdmin: boolean;
};

export type RedirectChainIdentity = {
  entryLinkId: string;
  hopCount: number;
};

export type LinkPasswordAccessIdentity = {
  linkId: string;
  passwordId?: string;
  verifier: string;
};

export async function createSessionToken(user: SessionIdentity) {
  return await new SignJWT({
    tokenType: 'session',
    email: user.email,
    name: user.name,
    picture: user.picture
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getEncodedSecret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getEncodedSecret());
  if (payload.tokenType !== undefined && payload.tokenType !== 'session') {
    throw new Error('Invalid session token type.');
  }

  return {
    email: String(payload.email),
    name: String(payload.name),
    picture: payload.picture ? String(payload.picture) : null
  } satisfies SessionIdentity;
}

export async function createAnalyticsSuppressionToken(email: string) {
  return await new SignJWT({
    tokenType: 'analytics_suppression',
    email
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(getEncodedSecret());
}

export async function verifyAnalyticsSuppressionToken(token: string) {
  const { payload } = await jwtVerify(token, getEncodedSecret());
  if (payload.tokenType !== 'analytics_suppression') {
    throw new Error('Invalid analytics suppression token type.');
  }

  return {
    email: String(payload.email)
  };
}

export async function createLinkPasswordAccessToken(input: {
  linkId: string | number;
  passwordId?: string | number;
  verifier: string;
}) {
  return await new SignJWT({
    tokenType: 'link_password_access',
    linkId: String(input.linkId),
    passwordId: input.passwordId ? String(input.passwordId) : undefined,
    verifier: input.verifier
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getEncodedSecret());
}

export async function verifyLinkPasswordAccessToken(token: string) {
  const { payload } = await jwtVerify(token, getEncodedSecret());
  if (payload.tokenType !== 'link_password_access') {
    throw new Error('Invalid link password access token type.');
  }

  if (typeof payload.linkId !== 'string' || !/^\d+$/.test(payload.linkId)) {
    throw new Error('Invalid link password access link id.');
  }

  if (typeof payload.verifier !== 'string' || payload.verifier.length === 0) {
    throw new Error('Invalid link password access verifier.');
  }

  if (
    payload.passwordId !== undefined &&
    (typeof payload.passwordId !== 'string' || !/^\d+$/.test(payload.passwordId))
  ) {
    throw new Error('Invalid link password access password id.');
  }

  return {
    linkId: payload.linkId,
    passwordId: payload.passwordId,
    verifier: payload.verifier
  } satisfies LinkPasswordAccessIdentity;
}

export async function createRedirectChainToken(input: {
  entryLinkId: string | number;
  hopCount: number;
}) {
  return await new SignJWT({
    tokenType: 'redirect_chain',
    entryLinkId: String(input.entryLinkId),
    hopCount: input.hopCount
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1m')
    .sign(getEncodedSecret());
}

export async function verifyRedirectChainToken(token: string) {
  const { payload } = await jwtVerify(token, getEncodedSecret());
  if (payload.tokenType !== 'redirect_chain') {
    throw new Error('Invalid redirect chain token type.');
  }

  if (typeof payload.entryLinkId !== 'string' || !/^\d+$/.test(payload.entryLinkId)) {
    throw new Error('Invalid redirect chain entry link id.');
  }

  if (
    typeof payload.hopCount !== 'number' ||
    !Number.isInteger(payload.hopCount) ||
    payload.hopCount < 0
  ) {
    throw new Error('Invalid redirect chain hop count.');
  }

  return {
    entryLinkId: payload.entryLinkId,
    hopCount: payload.hopCount
  } satisfies RedirectChainIdentity;
}

export function getSessionCookieName() {
  return sessionCookieName;
}

export function getAnalyticsSuppressionCookieName() {
  return analyticsSuppressionCookieName;
}

export function getLinkPasswordAccessCookieName(linkPublicId: string) {
  return `${linkPasswordAccessCookiePrefix}${linkPublicId}`;
}
