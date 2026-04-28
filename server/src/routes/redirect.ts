import { Router, type Request, type Response } from 'express';

import { getAppConfig } from '../config/app-config.js';
import { findUserLinkVariablesByEmail } from '../db/users.js';
import {
  findLinkPasswordByLinkIdAndId,
  findLinkPasswordByLinkIdAndPassword,
  findRedirectLinkSubtrackerByCanonicalHostAndTrackingId,
  type RedirectLinkRow
} from '../db/links.js';
import { isCrawlerLikeRequest } from '../services/bot-detection.js';
import { resolveDestinationUrlForUser } from '../services/destination-url-templates.js';
import {
  getAuthProviderHostForHost,
  getRootRedirectSlugForHost,
  resolveConfiguredHost,
  resolveRequestedHost,
  type ResolvedHost
} from '../services/domains.js';
import { findCachedRedirectLink } from '../services/redirect-link-cache.js';
import { recordRedirectOpen } from '../services/redirect-event-queue.js';
import {
  getLinkPasswordVerifier,
  verifyLinkPassword
} from '../services/link-passwords.js';
import {
  createRedirectChainToken,
  getAnalyticsSuppressionCookieName,
  getLinkPasswordAccessCookieName,
  createLinkPasswordAccessToken,
  type RedirectChainIdentity,
  verifyLinkPasswordAccessToken,
  verifyRedirectChainToken,
  verifyAnalyticsSuppressionToken
} from '../services/session.js';
import { isLikelyDuplicateRedirectOpen } from '../services/tracking-dedupe.js';

const router = Router();
const appConfig = getAppConfig();
const redirectChainQueryParam = '__glc';
const waitingRoomStatusQueryParam = '__glwr';
const waitingRoomPollIntervalMs = 3_000;
const reservedInternalPathPrefixes = ['/admin', '/api', '/auth', '/app-info'];
const reservedInternalPaths = new Set([
  '/health',
  '/robots.txt',
  '/favicon.svg'
]);

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getLinkPasswordCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: appConfig.nodeEnv === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1_000
  };
}

function getQuerySuffix(originalUrl: string, omittedKeys: string[] = []) {
  const queryIndex = originalUrl.indexOf('?');
  if (queryIndex < 0) {
    return '';
  }

  if (omittedKeys.length === 0) {
    return originalUrl.slice(queryIndex);
  }

  const params = new URLSearchParams(originalUrl.slice(queryIndex + 1));
  for (const key of omittedKeys) {
    params.delete(key);
  }

  const filteredQuery = params.toString();
  return filteredQuery ? `?${filteredQuery}` : '';
}

function getOriginalUrlWithoutQueryKeys(originalUrl: string, omittedKeys: string[] = []) {
  if (omittedKeys.length === 0) {
    return originalUrl;
  }

  const queryIndex = originalUrl.indexOf('?');
  if (queryIndex < 0) {
    return originalUrl;
  }

  const pathname = originalUrl.slice(0, queryIndex);
  const params = new URLSearchParams(originalUrl.slice(queryIndex + 1));
  for (const key of omittedKeys) {
    params.delete(key);
  }

  const filteredQuery = params.toString();
  return filteredQuery ? `${pathname}?${filteredQuery}` : pathname;
}

function appendQueryParamToRelativeUrl(rawUrl: string, key: string, value: string) {
  const destination = new URL(rawUrl, 'https://go-links.local');
  destination.searchParams.set(key, value);
  return `${destination.pathname}${destination.search}`;
}

function buildAuthProviderRedirectUrl(
  authProviderHost: string,
  requestedHost: string,
  shortlinkPath: string,
  querySuffix: string
) {
  return `https://${authProviderHost}/redir-to/${encodeURIComponent(requestedHost)}/${encodeURIComponent(shortlinkPath)}${querySuffix}`;
}

function buildVariablesAdminUrl(variableKey: string) {
  const params = new URLSearchParams({
    missingVariable: variableKey
  });
  return `/admin/variables?${params.toString()}`;
}

function getForwardedRedirectQuery(query: Request['query']) {
  const forwardedQuery = { ...query };
  delete forwardedQuery[redirectChainQueryParam];
  delete forwardedQuery[waitingRoomStatusQueryParam];
  return forwardedQuery;
}

function hasPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isReservedInternalPath(pathname: string) {
  if (reservedInternalPaths.has(pathname)) {
    return true;
  }

  return reservedInternalPathPrefixes.some((prefix) => hasPathPrefix(pathname, prefix));
}

async function isInternalRedirectManagedUrl(rawUrl: string) {
  let destination: URL;

  try {
    destination = new URL(rawUrl);
  } catch {
    return false;
  }

  const resolvedHost = await resolveConfiguredHost(destination.hostname);
  if (!resolvedHost.canonicalHost) {
    return false;
  }

  return !isReservedInternalPath(destination.pathname || '/');
}

function getRedirectChainTokenFromRequest(request: Request) {
  return getSingleQueryValue(request.query[redirectChainQueryParam]);
}

async function getRedirectChainIdentity(request: Request) {
  const redirectChainToken = getRedirectChainTokenFromRequest(request);
  if (!redirectChainToken) {
    return null;
  }

  try {
    return await verifyRedirectChainToken(redirectChainToken);
  } catch {
    return null;
  }
}

function appendRedirectChainToken(rawUrl: string, token: string) {
  const destination = new URL(rawUrl);
  destination.searchParams.set(redirectChainQueryParam, token);
  return destination.toString();
}

function appendRedirectChainTokenToRelativeUrl(rawUrl: string, token: string) {
  const destination = new URL(rawUrl, 'https://go-links.local');
  destination.searchParams.set(redirectChainQueryParam, token);
  return `${destination.pathname}${destination.search}`;
}

async function getRootRedirectChainToken(
  request: Request,
  canonicalHost: string,
  rootRedirectSlug: string
) {
  const incomingRedirectChainToken = getRedirectChainTokenFromRequest(request);
  if (incomingRedirectChainToken && (await getRedirectChainIdentity(request))) {
    return incomingRedirectChainToken;
  }

  const linkLookup = await findCachedRedirectLink(canonicalHost, rootRedirectSlug.toLowerCase());
  if (linkLookup.kind === 'missing') {
    return null;
  }

  const entryLinkId =
    linkLookup.kind === 'available' ? linkLookup.link.id : linkLookup.unavailable.linkId;

  return await createRedirectChainToken({
    entryLinkId,
    hopCount: 0
  });
}

async function withRedirectChainToken(
  rawUrl: string,
  currentLinkId: string | number,
  redirectChain: RedirectChainIdentity | null
) {
  if (!(await isInternalRedirectManagedUrl(rawUrl))) {
    return rawUrl;
  }

  const redirectChainToken = await createRedirectChainToken({
    entryLinkId: redirectChain?.entryLinkId ?? currentLinkId,
    hopCount: (redirectChain?.hopCount ?? 0) + 1
  });

  return appendRedirectChainToken(rawUrl, redirectChainToken);
}

router.get('/', async (request, response) => {
  const resolvedHost = await resolveRequestedHost(request);
  const querySuffixWithoutRedirectChain = getQuerySuffix(request.originalUrl, [
    redirectChainQueryParam
  ]);

  if (!resolvedHost.requestedHost || !resolvedHost.canonicalHost) {
    response.redirect(`/admin${querySuffixWithoutRedirectChain}`);
    return;
  }

  const authProviderHost = await getAuthProviderHostForHost(resolvedHost.requestedHost);
  if (authProviderHost && authProviderHost !== resolvedHost.requestedHost) {
    const rootRedirectSlug = await getRootRedirectSlugForHost(resolvedHost.requestedHost);

    if (rootRedirectSlug === 'admin') {
      response.redirect(`https://${authProviderHost}/admin${querySuffixWithoutRedirectChain}`);
      return;
    }

    const redirectChainToken = await getRootRedirectChainToken(
      request,
      resolvedHost.canonicalHost,
      rootRedirectSlug
    );
    let redirectUrl = buildAuthProviderRedirectUrl(
      authProviderHost,
      resolvedHost.requestedHost,
      rootRedirectSlug,
      querySuffixWithoutRedirectChain
    );

    if (redirectChainToken) {
      redirectUrl = appendRedirectChainToken(redirectUrl, redirectChainToken);
    }

    response.redirect(redirectUrl);
    return;
  }

  const rootRedirectSlug = await getRootRedirectSlugForHost(resolvedHost.requestedHost);

  if (rootRedirectSlug === 'admin') {
    response.redirect(`/admin${querySuffixWithoutRedirectChain}`);
    return;
  }

  const redirectChainToken = await getRootRedirectChainToken(
    request,
    resolvedHost.canonicalHost,
    rootRedirectSlug
  );
  let redirectUrl = `/${rootRedirectSlug}${querySuffixWithoutRedirectChain}`;

  if (redirectChainToken) {
    redirectUrl = appendRedirectChainTokenToRelativeUrl(redirectUrl, redirectChainToken);
  }

  response.redirect(redirectUrl);
});

function normalizeJoinedPath(basePath: string, suffixPath: string) {
  if (!suffixPath || suffixPath === '/') {
    return basePath || '/';
  }

  const trimmedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const normalizedBase = trimmedBase.length > 0 ? trimmedBase : '';
  const normalizedSuffix = suffixPath.startsWith('/') ? suffixPath : `/${suffixPath}`;

  return `${normalizedBase}${normalizedSuffix}` || '/';
}

function getSingleQueryValue(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const firstStringValue = value.find((item): item is string => typeof item === 'string');
    return firstStringValue ?? null;
  }

  return null;
}

function getRedirectViewerContext(request: Request) {
  const currentViewerEmail = request.sessionUser?.email.toLowerCase() ?? null;
  const forwardedQuery = getForwardedRedirectQuery(request.query);
  if (!request.sessionUser || !Object.prototype.hasOwnProperty.call(request.query, 'user')) {
    return {
      isTestingOverride: false,
      viewerEmail: currentViewerEmail,
      forwardedQuery
    };
  }

  const overrideValue = getSingleQueryValue(request.query.user);
  if (overrideValue === null) {
    return {
      isTestingOverride: false,
      viewerEmail: currentViewerEmail,
      forwardedQuery
    };
  }

  delete forwardedQuery.user;
  const viewerEmail = overrideValue.trim().toLowerCase() || null;

  return {
    isTestingOverride: true,
    viewerEmail,
    forwardedQuery
  };
}

async function getAnalyticsSuppressionEmail(request: Request) {
  if (request.sessionUser?.email) {
    return request.sessionUser.email.toLowerCase();
  }

  const analyticsSuppressionToken = request.cookies[getAnalyticsSuppressionCookieName()];
  if (typeof analyticsSuppressionToken !== 'string' || analyticsSuppressionToken.length === 0) {
    return null;
  }

  try {
    const identity = await verifyAnalyticsSuppressionToken(analyticsSuppressionToken);
    return identity.email.toLowerCase();
  } catch {
    return null;
  }
}

export function buildRedirectUrl(
  destinationUrl: string,
  suffixPath: string,
  incomingQuery: Record<string, unknown>
) {
  const destination = new URL(destinationUrl);
  destination.pathname = normalizeJoinedPath(destination.pathname, suffixPath);

  for (const [key, value] of Object.entries(incomingQuery)) {
    destination.searchParams.delete(key);

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          destination.searchParams.append(key, item);
        }
      }
      continue;
    }

    if (typeof value === 'string') {
      destination.searchParams.set(key, value);
    }
  }

  return destination.toString();
}

function getSubmittedPassword(body: unknown) {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const password = (body as { password?: unknown }).password;
  return typeof password === 'string' ? password : '';
}

function renderSignInPage(input: { adminUrl: string; description: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Sign in to continue</title>
    <style>
      :root {
        color: #102220;
        background:
          radial-gradient(circle at top left, rgba(224, 180, 93, 0.35), transparent 28%),
          linear-gradient(135deg, #f7f0e2 0%, #d8efe6 100%);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      main {
        width: min(100%, 480px);
        padding: 32px;
        border-radius: 24px;
        background: rgba(255, 252, 247, 0.84);
        border: 1px solid rgba(16, 34, 32, 0.08);
        box-shadow: 0 18px 40px rgba(67, 61, 34, 0.08);
        backdrop-filter: blur(14px);
      }

      h1 {
        margin: 0 0 12px;
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        font-size: clamp(1.25rem, 4vw, 1.6rem);
        line-height: 1.1;
      }

      p {
        margin: 0 0 20px;
      }

      a,
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 14px 20px;
        background: #0f6054;
        color: #fff;
        text-decoration: none;
        font-weight: 600;
        border: none;
        cursor: pointer;
      }

      label {
        display: grid;
        gap: 8px;
        margin: 0 0 20px;
        font-weight: 600;
      }

      input {
        width: 100%;
        border: 1px solid rgba(16, 34, 32, 0.16);
        border-radius: 14px;
        padding: 14px 16px;
        font: inherit;
      }

      .error {
        color: #9a2f2f;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Sign in to continue.</h1>
      <p>${escapeHtml(input.description)}</p>
      <a href="${escapeHtml(input.adminUrl)}">Open sign-in</a>
    </main>
  </body>
</html>`;
}

function renderPasswordPage(input: {
  actionUrl: string;
  shortlink: string;
  errorMessage?: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Password required</title>
    <style>
      :root {
        color: #102220;
        background:
          radial-gradient(circle at top left, rgba(224, 180, 93, 0.35), transparent 28%),
          linear-gradient(135deg, #f7f0e2 0%, #d8efe6 100%);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      main {
        width: min(100%, 480px);
        padding: 32px;
        border-radius: 24px;
        background: rgba(255, 252, 247, 0.84);
        border: 1px solid rgba(16, 34, 32, 0.08);
        box-shadow: 0 18px 40px rgba(67, 61, 34, 0.08);
        backdrop-filter: blur(14px);
      }

      h1 {
        margin: 0 0 12px;
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        font-size: clamp(1.25rem, 4vw, 1.5rem);
        line-height: 0.95;
      }

      p {
        margin: 0 0 20px;
      }

      label {
        display: grid;
        gap: 8px;
        margin: 0 0 20px;
        font-weight: 600;
      }

      input {
        width: 100%;
        border: 1px solid rgba(16, 34, 32, 0.16);
        border-radius: 14px;
        padding: 14px 16px;
        font: inherit;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 14px 20px;
        background: #0f6054;
        color: #fff;
        text-decoration: none;
        font-weight: 600;
        border: none;
        cursor: pointer;
      }

      .error {
        color: #9a2f2f;
        font-weight: 600;
      }

      .meta {
        color: rgba(16, 34, 32, 0.72);
        font-size: 0.94rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Password required.</h1>
      <p>Enter the password to continue to <strong>${escapeHtml(input.shortlink)}</strong>.</p>
      ${
        input.errorMessage
          ? `<p class="error">${escapeHtml(input.errorMessage)}</p>`
          : '<p class="meta">This password is managed by the link owner.</p>'
      }
      <form method="post" action="${escapeHtml(input.actionUrl)}">
        <label>
          <span>Password</span>
          <input autofocus name="password" type="password" autocomplete="current-password" />
        </label>
        <button type="submit">Continue</button>
      </form>
    </main>
  </body>
</html>`;
}

function renderWaitingRoomPage(input: {
  shortlink: string;
  resumeUrl: string;
  statusUrl: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Waiting room</title>
    <style>
      :root {
        color: #12232f;
        background:
          radial-gradient(circle at top, rgba(206, 129, 81, 0.28), transparent 30%),
          linear-gradient(160deg, #f4ecde 0%, #d8e8f1 100%);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      main {
        width: min(100%, 540px);
        padding: 32px;
        border-radius: 28px;
        background: rgba(255, 251, 246, 0.86);
        border: 1px solid rgba(18, 35, 47, 0.08);
        box-shadow: 0 24px 60px rgba(43, 57, 71, 0.12);
        backdrop-filter: blur(16px);
      }

      h1 {
        margin: 0 0 12px;
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        font-size: clamp(1.5rem, 4vw, 2rem);
        line-height: 1;
      }

      p {
        margin: 0 0 16px;
      }

      .eyebrow {
        display: inline-flex;
        margin: 0 0 16px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(18, 35, 47, 0.08);
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .shortlink {
        font-weight: 700;
      }

      .status {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 24px 0;
        padding: 16px 18px;
        border-radius: 18px;
        background: rgba(18, 35, 47, 0.06);
      }

      .spinner {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid rgba(18, 35, 47, 0.18);
        border-top-color: #0f6054;
        animation: spin 0.85s linear infinite;
        flex: 0 0 auto;
      }

      .status-text {
        font-weight: 600;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: none;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Waiting room</div>
      <h1>Hang tight.</h1>
      <p>You will be automatically redirected when the event begins.</p>
      <div class="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <div class="status-text" id="status-text">Waiting for the room to open...</div>
      </div>
    </main>
    <script>
      const statusUrl = ${JSON.stringify(input.statusUrl)};
      const resumeUrl = ${JSON.stringify(input.resumeUrl)};
      const statusText = document.getElementById('status-text');
      let pollTimeout = null;
      let pollInFlight = false;

      function setStatus(message) {
        if (statusText) {
          statusText.textContent = message;
        }
      }

      function schedulePoll(delayMs) {
        if (pollTimeout !== null) {
          window.clearTimeout(pollTimeout);
        }

        pollTimeout = window.setTimeout(() => {
          void pollWaitingRoom();
        }, delayMs);
      }

      async function pollWaitingRoom() {
        if (pollInFlight) {
          return;
        }

        pollInFlight = true;

        try {
          const response = await fetch(statusUrl, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              Accept: 'application/json'
            }
          });

          if (response.status === 401) {
            setStatus('Sign in again to keep waiting for this internal link.');
            schedulePoll(${waitingRoomPollIntervalMs});
            return;
          }

          if (!response.ok) {
            throw new Error('status-check-failed');
          }

          const payload = await response.json();
          if (payload && payload.waitingRoomEnabled === false) {
            window.location.replace(
              typeof payload.resumeUrl === 'string' && payload.resumeUrl.length > 0
                ? payload.resumeUrl
                : resumeUrl
            );
            return;
          }

          setStatus('Still waiting...');
        } catch {
          setStatus('Still waiting. Rechecking shortly...');
        } finally {
          pollInFlight = false;
        }

        schedulePoll(${waitingRoomPollIntervalMs});
      }
      void pollWaitingRoom();
    </script>
  </body>
</html>`;
}

function hasLinkPasswordProtection(link: RedirectLinkRow) {
  return link.has_link_passwords || Boolean(link.password_hash);
}

async function getValidLinkPasswordAccess(
  request: Request,
  response: Response,
  link: RedirectLinkRow
) {
  const cookieName = getLinkPasswordAccessCookieName(link.public_id);
  const token = request.cookies[cookieName];
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  try {
    const identity = await verifyLinkPasswordAccessToken(token);
    if (identity.linkId !== link.id) {
      response.clearCookie(cookieName, getLinkPasswordCookieOptions());
      return null;
    }

    if (identity.passwordId) {
      const password = await findLinkPasswordByLinkIdAndId(link.id, identity.passwordId);
      if (
        !password ||
        password.is_disabled ||
        identity.verifier !== getLinkPasswordVerifier(password.password)
      ) {
        response.clearCookie(cookieName, getLinkPasswordCookieOptions());
        return null;
      }

      return {
        passwordId: identity.passwordId
      };
    }

    if (!link.password_hash || identity.verifier !== getLinkPasswordVerifier(link.password_hash)) {
      response.clearCookie(cookieName, getLinkPasswordCookieOptions());
      return null;
    }

    return {
      passwordId: null
    };
  } catch {
    response.clearCookie(cookieName, getLinkPasswordCookieOptions());
    return null;
  }
}

async function requireLinkPasswordAccess(
  request: Request,
  response: Response,
  link: RedirectLinkRow,
  trackingId: string | null
) {
  if (!hasLinkPasswordProtection(link)) {
    return {
      allowed: true,
      passwordId: null,
      grantedBySubmission: false
    };
  }

  const cookieName = getLinkPasswordAccessCookieName(link.public_id);
  if (!link.remember_password_access) {
    const token = request.cookies[cookieName];
    if (typeof token === 'string' && token.length > 0) {
      response.clearCookie(cookieName, getLinkPasswordCookieOptions());
    }
  } else {
    const existingAccess = await getValidLinkPasswordAccess(request, response, link);
    if (existingAccess) {
      return {
        allowed: true,
        passwordId: existingAccess.passwordId,
        grantedBySubmission: false
      };
    }
  }

  const shortlink = buildShortlink(link.canonical_host, link.slug, trackingId);

  if (request.method === 'POST') {
    const submittedPassword = getSubmittedPassword(request.body);
    if (submittedPassword.length === 0) {
      response
        .status(401)
        .type('html')
        .send(
          renderPasswordPage({
            actionUrl: request.originalUrl,
            shortlink,
            errorMessage: 'Enter the password to continue.'
          })
      );
      return {
        allowed: false,
        passwordId: null,
        grantedBySubmission: false
      };
    }

    const matchedPassword = link.has_link_passwords
      ? await findLinkPasswordByLinkIdAndPassword(link.id, submittedPassword)
      : null;
    if (matchedPassword && !matchedPassword.is_disabled) {
      if (link.remember_password_access) {
        const token = await createLinkPasswordAccessToken({
          linkId: link.id,
          passwordId: matchedPassword.id,
          verifier: getLinkPasswordVerifier(matchedPassword.password)
        });
        response.cookie(cookieName, token, getLinkPasswordCookieOptions());
        response.redirect(303, request.originalUrl);
        return {
          allowed: false,
          passwordId: null,
          grantedBySubmission: false
        };
      }

      return {
        allowed: true,
        passwordId: matchedPassword.id,
        grantedBySubmission: true
      };
    }

    if (link.password_hash && (await verifyLinkPassword(submittedPassword, link.password_hash))) {
      if (link.remember_password_access) {
        const token = await createLinkPasswordAccessToken({
          linkId: link.id,
          verifier: getLinkPasswordVerifier(link.password_hash)
        });
        response.cookie(cookieName, token, getLinkPasswordCookieOptions());
        response.redirect(303, request.originalUrl);
        return {
          allowed: false,
          passwordId: null,
          grantedBySubmission: false
        };
      }

      return {
        allowed: true,
        passwordId: null,
        grantedBySubmission: true
      };
    }

    response
      .status(401)
      .type('html')
      .send(
        renderPasswordPage({
          actionUrl: request.originalUrl,
          shortlink,
          errorMessage: 'Incorrect password.'
        })
      );
    return {
      allowed: false,
      passwordId: null,
      grantedBySubmission: false
    };
  }

  if (request.method !== 'GET') {
    response.status(405).send('Method not allowed.');
    return {
      allowed: false,
      passwordId: null,
      grantedBySubmission: false
    };
  }

  response.status(401).type('html').send(
    renderPasswordPage({
      actionUrl: request.originalUrl,
      shortlink
    })
  );
  return {
    allowed: false,
    passwordId: null,
    grantedBySubmission: false
  };
}

function buildShortlink(canonicalHost: string, slug: string, trackingId: string | null) {
  return trackingId ? `${canonicalHost}/${trackingId}` : `${canonicalHost}/${slug}`;
}

function buildShortlinkUrl(canonicalHost: string, slug: string, trackingId: string | null) {
  return `https://${buildShortlink(canonicalHost, slug, trackingId)}`;
}

function normalizeIncomingShortlinkPath(shortlinkPath: string) {
  return shortlinkPath.replace(/^\/+/, '');
}

function getShortlinkPathMatchCandidates(shortlinkPath: string) {
  const normalizedPath = normalizeIncomingShortlinkPath(shortlinkPath);
  const matchablePath = normalizedPath.replace(/\/+$/, '');

  if (!matchablePath) {
    return [];
  }

  const candidates = [matchablePath];
  let slashIndex = matchablePath.lastIndexOf('/');

  while (slashIndex !== -1) {
    const candidate = matchablePath.slice(0, slashIndex);
    if (candidate) {
      candidates.push(candidate);
    }
    slashIndex = matchablePath.lastIndexOf('/', slashIndex - 1);
  }

  return candidates;
}

async function resolveLinkLookupByPath(canonicalHost: string, shortlinkPath: string) {
  const normalizedPath = normalizeIncomingShortlinkPath(shortlinkPath);

  for (const candidateSlug of getShortlinkPathMatchCandidates(normalizedPath)) {
    const linkLookup = await findCachedRedirectLink(canonicalHost, candidateSlug.toLowerCase());
    if (linkLookup.kind === 'missing') {
      continue;
    }

    const suffixPath = normalizedPath.slice(candidateSlug.length);
    return {
      linkLookup,
      slug: candidateSlug,
      suffixPath
    };
  }

  return null;
}

function getTrackedSuffixPath(trackedPath: string, slug: string) {
  const normalizedTrackedPath = normalizeIncomingShortlinkPath(trackedPath);
  if (!normalizedTrackedPath) {
    return '';
  }

  const normalizedSlug = slug.replace(/^\/+|\/+$/g, '');
  const normalizedTrackedPathLower = normalizedTrackedPath.toLowerCase();
  const normalizedSlugLower = normalizedSlug.toLowerCase();

  if (normalizedTrackedPathLower === normalizedSlugLower) {
    return '';
  }

  if (normalizedTrackedPathLower.startsWith(`${normalizedSlugLower}/`)) {
    return normalizedTrackedPath.slice(normalizedSlug.length);
  }

  return `/${normalizedTrackedPath}`;
}

function getMissingSlugPrefill(shortlinkPath: string) {
  return normalizeIncomingShortlinkPath(shortlinkPath).replace(/\/+$/, '');
}

async function handleShortlinkRedirect(
  request: Request,
  response: Response,
  resolvedHost: ResolvedHost,
  shortlinkPath: string
) {
  if (!resolvedHost.canonicalHost) {
    response.status(404).send('Unknown go link host.');
    return;
  }

  const waitingRoomStatusRequest =
    getSingleQueryValue(request.query[waitingRoomStatusQueryParam]) === '1';
  const waitingRoomResumeUrl = getOriginalUrlWithoutQueryKeys(request.originalUrl, [
    waitingRoomStatusQueryParam
  ]);
  const normalizedShortlinkPath = normalizeIncomingShortlinkPath(shortlinkPath);
  const resolvedPathLookup = await resolveLinkLookupByPath(
    resolvedHost.canonicalHost,
    normalizedShortlinkPath
  );
  let linkLookup = resolvedPathLookup?.linkLookup ?? { kind: 'missing' as const };
  let trackingId: string | null = null;
  let suffixPath = resolvedPathLookup?.suffixPath ?? '';
  let trackedSubtrackerId: string | null = null;

  if (linkLookup.kind === 'missing') {
    const slashIndex = normalizedShortlinkPath.indexOf('/');
    const trackingIdCandidate =
      slashIndex === -1
        ? normalizedShortlinkPath
        : normalizedShortlinkPath.slice(0, slashIndex);
    const trackedPath =
      slashIndex === -1 ? '' : normalizedShortlinkPath.slice(slashIndex + 1);
    const matchedSubtracker = await findRedirectLinkSubtrackerByCanonicalHostAndTrackingId(
      resolvedHost.canonicalHost,
      trackingIdCandidate
    );

    if (matchedSubtracker) {
      linkLookup = await findCachedRedirectLink(
        resolvedHost.canonicalHost,
        matchedSubtracker.link_slug.toLowerCase()
      );

      if (linkLookup.kind !== 'missing') {
        suffixPath = getTrackedSuffixPath(trackedPath, matchedSubtracker.link_slug);

        if (!matchedSubtracker.is_disabled) {
          trackingId = trackingIdCandidate;
          trackedSubtrackerId = matchedSubtracker.id;
        }
      }
    }
  }

  if (linkLookup.kind === 'missing') {
    if (waitingRoomStatusRequest) {
      response.set('Cache-Control', 'no-store');
      response.json({
        waitingRoomEnabled: false,
        resumeUrl: waitingRoomResumeUrl
      });
      return;
    }

    const params = new URLSearchParams({
      prefillCanonicalHost: resolvedHost.canonicalHost,
      prefillSlug: getMissingSlugPrefill(normalizedShortlinkPath)
    });
    response.redirect(`/admin?${params.toString()}`);
    return;
  }

  const viewerContext = getRedirectViewerContext(request);
  const redirectChain = await getRedirectChainIdentity(request);

  const requiresTrackingId =
    linkLookup.kind === 'available'
      ? linkLookup.link.requires_tracking_id
      : linkLookup.kind === 'unavailable'
        ? linkLookup.unavailable.requiresTrackingId
        : false;

  if (requiresTrackingId && !trackingId) {
    if (waitingRoomStatusRequest) {
      response.status(404).json({ error: 'Not found.' });
      return;
    }

    response.status(404).send('Not found.');
    return;
  }

  if (linkLookup.kind === 'unavailable') {
    if (waitingRoomStatusRequest) {
      response.set('Cache-Control', 'no-store');
      response.json({
        waitingRoomEnabled: false,
        resumeUrl: waitingRoomResumeUrl
      });
      return;
    }

    if (linkLookup.unavailable.disabledDestinationUrl) {
      const viewerVariables = viewerContext.viewerEmail
        ? await findUserLinkVariablesByEmail(viewerContext.viewerEmail)
        : {};
      const destinationResolution = resolveDestinationUrlForUser(
        linkLookup.unavailable.disabledDestinationUrl,
        viewerVariables
      );

      if (destinationResolution.kind === 'missing-required-variable') {
        if (!request.sessionUser) {
          const params = new URLSearchParams({ next: request.originalUrl });
          response
            .status(401)
            .type('html')
            .send(
              renderSignInPage({
                adminUrl: `/admin?${params.toString()}`,
                description:
                  'This link needs a saved destination variable from your account before it can continue.'
              })
            );
          return;
        }

        response.redirect(buildVariablesAdminUrl(destinationResolution.variableKey));
        return;
      }

      if (destinationResolution.kind === 'invalid') {
        response.status(500).send('Link destination is misconfigured.');
        return;
      }

      response.redirect(
        await withRedirectChainToken(
          destinationResolution.url,
          linkLookup.unavailable.linkId,
          redirectChain
        )
      );
      return;
    }

    response.status(404).send('Not found.');
    return;
  }

  if (linkLookup.link.internal_only && !viewerContext.viewerEmail) {
    if (waitingRoomStatusRequest) {
      response.status(401).json({
        waitingRoomEnabled: true,
        requiresSignIn: true
      });
      return;
    }

    const params = new URLSearchParams({ next: request.originalUrl });
    response
      .status(401)
      .type('html')
      .send(
        renderSignInPage({
          adminUrl: `/admin?${params.toString()}`,
          description: 'This link requires a signed-in account with access to internal links.'
        })
      );
    return;
  }

  const shortlink = buildShortlink(
    linkLookup.link.canonical_host,
    linkLookup.link.slug,
    trackingId
  );

  if (linkLookup.link.waiting_room_enabled) {
    if (waitingRoomStatusRequest) {
      response.set('Cache-Control', 'no-store');
      response.json({
        waitingRoomEnabled: true,
        resumeUrl: waitingRoomResumeUrl
      });
      return;
    }

    if (request.method !== 'GET') {
      response.redirect(303, waitingRoomResumeUrl);
      return;
    }

    response.set('Cache-Control', 'no-store');
    response.status(200).type('html').send(
      renderWaitingRoomPage({
        shortlink,
        resumeUrl: waitingRoomResumeUrl,
        statusUrl: appendQueryParamToRelativeUrl(
          waitingRoomResumeUrl,
          waitingRoomStatusQueryParam,
          '1'
        )
      })
    );
    return;
  }

  if (waitingRoomStatusRequest) {
    response.set('Cache-Control', 'no-store');
    response.json({
      waitingRoomEnabled: false,
      resumeUrl: waitingRoomResumeUrl
    });
    return;
  }

  const passwordAccess = await requireLinkPasswordAccess(
    request,
    response,
    linkLookup.link,
    trackingId
  );
  if (!passwordAccess.allowed) {
    return;
  }

  if (request.method !== 'GET' && !passwordAccess.grantedBySubmission) {
    response.redirect(303, request.originalUrl);
    return;
  }

  const hasQuery = Object.keys(request.query).length > 0;
  const analyticsSuppressionEmail = viewerContext.isTestingOverride
    ? viewerContext.viewerEmail
    : await getAnalyticsSuppressionEmail(request);
  const creatorEmail = linkLookup.link.created_by_email.toLowerCase();
  const isCreatorVisit = Boolean(
    analyticsSuppressionEmail && analyticsSuppressionEmail === creatorEmail
  );
  const isCrawlerLike = isCrawlerLikeRequest(request);
  const isLikelyDuplicate =
    !redirectChain && !viewerContext.isTestingOverride && !isCrawlerLike && !isCreatorVisit
      ? await isLikelyDuplicateRedirectOpen(
          request,
          linkLookup.link.id,
          trackedSubtrackerId ?? undefined,
          passwordAccess.passwordId ?? undefined
        )
      : false;
  const shouldTrackUsageAndAnalytics =
    !redirectChain &&
    !viewerContext.isTestingOverride &&
    !isCrawlerLike &&
    !isCreatorVisit &&
    !isLikelyDuplicate;
  if (shouldTrackUsageAndAnalytics) {
    await recordRedirectOpen(request, {
      linkId: linkLookup.link.id,
      subtrackerId: trackedSubtrackerId ?? undefined,
      passwordId: passwordAccess.passwordId ?? undefined,
      analyticsEventName: 'go_link_open',
      analyticsParams: {
        shortlink: buildShortlinkUrl(
          linkLookup.link.canonical_host,
          linkLookup.link.slug,
          trackingId
        ),
        host: linkLookup.link.canonical_host,
        internal_only: linkLookup.link.internal_only,
        used_alias: Boolean(resolvedHost.matchedAlias),
        has_tracking_id: Boolean(trackingId),
        has_password_link: Boolean(passwordAccess.passwordId),
        has_suffix_path: Boolean(suffixPath),
        has_query: hasQuery
      }
    });
  }

  const viewerVariables = viewerContext.viewerEmail
    ? await findUserLinkVariablesByEmail(viewerContext.viewerEmail)
    : {};
  const destinationUrlTemplate =
    linkLookup.link.active_scheduled_destination_url ?? linkLookup.link.destination_url;
  const destinationResolution = resolveDestinationUrlForUser(destinationUrlTemplate, viewerVariables);
  if (destinationResolution.kind === 'missing-required-variable') {
    if (!request.sessionUser) {
      const params = new URLSearchParams({ next: request.originalUrl });
      response
        .status(401)
        .type('html')
        .send(
          renderSignInPage({
            adminUrl: `/admin?${params.toString()}`,
            description:
              'This link needs a saved destination variable from your account before it can continue.'
          })
        );
      return;
    }

    response.redirect(buildVariablesAdminUrl(destinationResolution.variableKey));
    return;
  }

  if (destinationResolution.kind === 'invalid') {
    response.status(500).send('Link destination is misconfigured.');
    return;
  }

  const redirectUrl = buildRedirectUrl(
    destinationResolution.url,
    suffixPath,
    viewerContext.forwardedQuery
  );

  const finalRedirectUrl = await withRedirectChainToken(redirectUrl, linkLookup.link.id, redirectChain);
  if (passwordAccess.grantedBySubmission) {
    response.redirect(303, finalRedirectUrl);
    return;
  }

  response.redirect(finalRedirectUrl);
}

router.get(/^\/redir-to\/(?<targetHost>[^/]+)\/(?<shortlinkPath>.+)$/, async (request, response) => {
  const resolvedHost = await resolveConfiguredHost(request.params.targetHost);
  await handleShortlinkRedirect(
    request,
    response,
    resolvedHost,
    request.params.shortlinkPath ?? ''
  );
});

router.post(/^\/redir-to\/(?<targetHost>[^/]+)\/(?<shortlinkPath>.+)$/, async (request, response) => {
  const resolvedHost = await resolveConfiguredHost(request.params.targetHost);
  await handleShortlinkRedirect(
    request,
    response,
    resolvedHost,
    request.params.shortlinkPath ?? ''
  );
});

router.get(/^\/(?<shortlinkPath>.+)$/, async (request, response) => {
  const resolvedHost = await resolveRequestedHost(request);
  const querySuffix = getQuerySuffix(request.originalUrl);
  if (resolvedHost.requestedHost) {
    const authProviderHost = await getAuthProviderHostForHost(resolvedHost.requestedHost);
    if (authProviderHost && authProviderHost !== resolvedHost.requestedHost) {
      response.redirect(
        buildAuthProviderRedirectUrl(
          authProviderHost,
          resolvedHost.requestedHost,
          request.params.shortlinkPath ?? '',
          querySuffix
        )
      );
      return;
    }
  }

  await handleShortlinkRedirect(
    request,
    response,
    resolvedHost,
    request.params.shortlinkPath ?? ''
  );
});

router.post(/^\/(?<shortlinkPath>.+)$/, async (request, response) => {
  const resolvedHost = await resolveRequestedHost(request);
  const querySuffix = getQuerySuffix(request.originalUrl);
  if (resolvedHost.requestedHost) {
    const authProviderHost = await getAuthProviderHostForHost(resolvedHost.requestedHost);
    if (authProviderHost && authProviderHost !== resolvedHost.requestedHost) {
      response.redirect(
        307,
        buildAuthProviderRedirectUrl(
          authProviderHost,
          resolvedHost.requestedHost,
          request.params.shortlinkPath ?? '',
          querySuffix
        )
      );
      return;
    }
  }

  await handleShortlinkRedirect(
    request,
    response,
    resolvedHost,
    request.params.shortlinkPath ?? ''
  );
});

export const redirectRouter = router;
