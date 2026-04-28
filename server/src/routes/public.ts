import { Router } from 'express';

import { getPrivacyPolicyDocument } from '../db/app-documents.js';
import { renderPrivacyPolicyMarkdownToHtml } from '../services/privacy-policy.js';

const router = Router();

function renderPrivacyPolicyPage(contentHtml: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Privacy Policy</title>
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
        padding: 24px;
      }

      main {
        width: min(100%, 840px);
        margin: 0 auto;
        padding: 32px;
        border-radius: 24px;
        background: rgba(255, 252, 247, 0.84);
        border: 1px solid rgba(16, 34, 32, 0.08);
        box-shadow: 0 18px 40px rgba(67, 61, 34, 0.08);
        backdrop-filter: blur(14px);
      }

      h1,
      h2 {
        font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
        line-height: 1.1;
      }

      h1 {
        margin: 0 0 12px;
        font-size: clamp(1.8rem, 4vw, 2.4rem);
      }

      h2 {
        margin: 28px 0 10px;
        font-size: 1.15rem;
      }

      p,
      li {
        line-height: 1.6;
      }

      p {
        margin: 0 0 16px;
      }

      ul {
        margin: 0 0 16px;
        padding-left: 20px;
      }

      .eyebrow {
        margin: 0 0 10px;
        color: rgba(16, 34, 32, 0.72);
        font-size: 0.9rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .meta {
        color: rgba(16, 34, 32, 0.72);
      }

      a {
        color: #0f6054;
      }

      code {
        padding: 0.1em 0.35em;
        border-radius: 0.45em;
        background: rgba(16, 34, 32, 0.08);
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 0.95em;
      }
    </style>
  </head>
  <body>
    <main>
      ${contentHtml}
    </main>
  </body>
</html>`;
}

router.get('/app-info/privacy-policy', async (_request, response) => {
  try {
    const document = await getPrivacyPolicyDocument();
    const contentHtml = renderPrivacyPolicyMarkdownToHtml(document.markdown);

    response.set('Cache-Control', 'no-store');
    response.status(200).type('html').send(renderPrivacyPolicyPage(contentHtml));
  } catch {
    response.status(500).type('text/plain').send('Privacy policy is unavailable.');
  }
});

export const publicRouter = router;
