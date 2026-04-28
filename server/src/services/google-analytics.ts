import type { Request } from 'express';

import { getAnalyticsConfig } from '../config/analytics-config.js';

type AnalyticsEventParams = Record<string, string | number | boolean | undefined | null>;

export type QueuedGoogleAnalyticsEvent = {
  clientId: string;
  timestampMicros: number;
  eventName: string;
  params: Record<string, string | number | boolean>;
};

const measurementProtocolEndpoint = 'https://www.google-analytics.com/mp/collect';

function extractGaClientIdFromCookie(cookieValue: string | undefined) {
  if (!cookieValue) {
    return null;
  }

  const parts = cookieValue.split('.');
  if (parts.length < 4) {
    return null;
  }

  const candidate = parts.slice(-2).join('.');
  return /^\d+\.\d+$/.test(candidate) ? candidate : null;
}

function buildFallbackClientId() {
  return `${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 1_000_000_000)}`;
}

function getClientId(request: Request) {
  return extractGaClientIdFromCookie(request.cookies?._ga) ?? buildFallbackClientId();
}

function sanitizeParams(params: AnalyticsEventParams) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null)
  ) as Record<string, string | number | boolean>;
}

export function isGoogleAnalyticsEnabled() {
  return getAnalyticsConfig().measurementProtocolEnabled;
}

export function buildQueuedGoogleAnalyticsEvent(
  request: Request,
  eventName: string,
  params: AnalyticsEventParams
): QueuedGoogleAnalyticsEvent {
  return {
    clientId: getClientId(request),
    timestampMicros: Date.now() * 1_000,
    eventName,
    params: sanitizeParams(params)
  };
}

export function isQueuedGoogleAnalyticsEvent(message: unknown): message is QueuedGoogleAnalyticsEvent {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<QueuedGoogleAnalyticsEvent>;
  if (
    typeof candidate.clientId !== 'string' ||
    candidate.clientId.length === 0 ||
    typeof candidate.timestampMicros !== 'number' ||
    !Number.isInteger(candidate.timestampMicros) ||
    candidate.timestampMicros <= 0 ||
    typeof candidate.eventName !== 'string' ||
    candidate.eventName.length === 0 ||
    !candidate.params ||
    typeof candidate.params !== 'object' ||
    Array.isArray(candidate.params)
  ) {
    return false;
  }

  return Object.values(candidate.params).every(
    (value) =>
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  );
}

export function parseQueuedGoogleAnalyticsEvent(messageBody: string) {
  const parsed = JSON.parse(messageBody) as unknown;
  if (!isQueuedGoogleAnalyticsEvent(parsed)) {
    throw new Error('Google Analytics queue message payload is invalid.');
  }

  return parsed;
}

export async function sendQueuedGoogleAnalyticsEvent(event: QueuedGoogleAnalyticsEvent) {
  const analyticsConfig = getAnalyticsConfig();

  if (!analyticsConfig.measurementProtocolEnabled) {
    return;
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 1_000);

  try {
    const response = await fetch(
      `${measurementProtocolEndpoint}?measurement_id=${encodeURIComponent(analyticsConfig.measurementId!)}&api_secret=${encodeURIComponent(analyticsConfig.apiSecret!)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: event.clientId,
          timestamp_micros: event.timestampMicros,
          non_personalized_ads: true,
          events: [
            {
              name: event.eventName,
              params: {
                engagement_time_msec: 1,
                ...event.params
              }
            }
          ]
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`Google Analytics returned ${response.status}.`);
    }
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
