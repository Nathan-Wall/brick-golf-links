import fs from 'node:fs';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { getAppConfig } from './config/app-config.js';
import { hydrateSessionUser } from './middleware/auth.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { redirectRouter } from './routes/redirect.js';

const appConfig = getAppConfig();
const robotsHeaderValue = 'noindex, nofollow, noarchive';

function resolveClientDistDir() {
  const candidates = [
    appConfig.clientDistDir,
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), '../client/dist')
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin:
        appConfig.nodeEnv === 'production' ? true : appConfig.viteAppBaseUrl ?? 'http://localhost:5173',
      credentials: true
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(hydrateSessionUser);
  app.use((request, response, next) => {
    if (!request.path.startsWith('/admin/assets')) {
      response.set('X-Robots-Tag', robotsHeaderValue);
    }

    next();
  });

  app.get('/robots.txt', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=3600');
    response.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.use(authRouter);
  app.use(apiRouter);
  app.use(publicRouter);

  const clientDistDir = resolveClientDistDir();
  if (clientDistDir) {
    app.get(['/favicon.svg', '/admin/favicon.svg'], (_request, response) => {
      response.set('Cache-Control', 'public, max-age=86400');
      response.type('image/svg+xml');
      response.sendFile(path.join(clientDistDir, 'favicon.svg'));
    });

    app.use(
      '/admin/assets',
      express.static(path.join(clientDistDir, 'assets'), {
        maxAge: '1y',
        immutable: true
      })
    );

    app.get(/^\/admin(?:\/.*)?$/, (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  app.use(redirectRouter);

  return app;
}
