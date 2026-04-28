import type { NextFunction, Request, Response } from 'express';

import { getSessionCookieName, verifySessionToken } from '../services/session.js';
import { isSuperAdminEmail } from '../services/super-admins.js';

declare global {
  namespace Express {
    interface Request {
      sessionUser?: {
        email: string;
        name: string;
        picture: string | null;
        isSuperAdmin: boolean;
      } | null;
    }
  }
}

export async function hydrateSessionUser(request: Request, _response: Response, next: NextFunction) {
  const token = request.cookies[getSessionCookieName()];

  if (!token) {
    request.sessionUser = null;
    next();
    return;
  }

  try {
    const sessionIdentity = await verifySessionToken(token);
    request.sessionUser = {
      ...sessionIdentity,
      isSuperAdmin: isSuperAdminEmail(sessionIdentity.email)
    };
  } catch {
    request.sessionUser = null;
  }

  next();
}

export function requireAuthenticatedUser(request: Request, response: Response, next: NextFunction) {
  if (!request.sessionUser) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }

  next();
}
