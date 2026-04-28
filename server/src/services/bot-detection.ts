import type { Request } from 'express';

const botUserAgentPatterns = [
  /\b(bot|crawler|spider|slurp)\b/i,
  /\bgooglebot\b/i,
  /\bbingbot\b/i,
  /\bduckduckbot\b/i,
  /\bbaiduspider\b/i,
  /\byandex(bot)?\b/i,
  /\bapplebot\b/i,
  /\bfacebookexternalhit\b/i,
  /\bfacebot\b/i,
  /\bslackbot\b/i,
  /\bdiscordbot\b/i,
  /\blinkedinbot\b/i,
  /\btelegrambot\b/i,
  /\bgooglemessages\b/i,
  /\bgoogle-pagerenderer\b/i,
  /\bwhatsapp\b/i,
  /\bskypeuripreview\b/i,
  /\btwitterbot\b/i,
  /\bpreview\b/i,
  /\b(headlesschrome|phantomjs|puppeteer|playwright|selenium|cypress)\b/i,
  /\b(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client)\b/i,
  /\b(apache-httpclient|libwww-perl|postmanruntime|okhttp)\b/i
];

function getHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function getUserAgent(request: Request) {
  return getHeaderValue(request.headers['user-agent']);
}

export function isCrawlerLikeRequest(request: Request) {
  const userAgent = getUserAgent(request);
  const purpose = getHeaderValue(request.headers.purpose);
  const xPurpose = getHeaderValue(request.headers['x-purpose']);
  const secPurpose = getHeaderValue(request.headers['sec-purpose']);

  if (
    [purpose, xPurpose, secPurpose].some((value) =>
      typeof value === 'string' ? /\b(prefetch|preview)\b/i.test(value) : false
    )
  ) {
    return true;
  }

  if (!userAgent) {
    return false;
  }

  return botUserAgentPatterns.some((pattern) => pattern.test(userAgent));
}
