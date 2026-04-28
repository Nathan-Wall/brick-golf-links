import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Request } from 'express';

import { getQueueConfig } from '../config/queue-config.js';
import {
  buildQueuedGoogleAnalyticsEvent,
  isGoogleAnalyticsEnabled,
  isQueuedGoogleAnalyticsEvent,
  sendQueuedGoogleAnalyticsEvent,
  type QueuedGoogleAnalyticsEvent
} from './google-analytics.js';
import { getHourStart, getTenMinuteBucketStart } from './usage-buckets.js';

const sqsClient = new SQSClient({});

export type RedirectOpenEventMessage = {
  linkId: string;
  subtrackerId?: string;
  passwordId?: string;
  count: number;
  occurredAt: string;
  analyticsEvent: QueuedGoogleAnalyticsEvent | null;
};

function isValidDateString(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function isRedirectOpenEventMessage(message: unknown): message is RedirectOpenEventMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<RedirectOpenEventMessage>;
  return (
    typeof candidate.linkId === 'string' &&
    /^\d+$/.test(candidate.linkId) &&
    (candidate.subtrackerId === undefined ||
      (typeof candidate.subtrackerId === 'string' && /^\d+$/.test(candidate.subtrackerId))) &&
    (candidate.passwordId === undefined ||
      (typeof candidate.passwordId === 'string' && /^\d+$/.test(candidate.passwordId))) &&
    typeof candidate.count === 'number' &&
    Number.isInteger(candidate.count) &&
    candidate.count > 0 &&
    (candidate.occurredAt === undefined ||
      (typeof candidate.occurredAt === 'string' && isValidDateString(candidate.occurredAt))) &&
    (candidate.analyticsEvent === null || isQueuedGoogleAnalyticsEvent(candidate.analyticsEvent))
  );
}

export function parseRedirectOpenEventMessage(messageBody: string) {
  const parsed = JSON.parse(messageBody) as unknown;
  if (!isRedirectOpenEventMessage(parsed)) {
    throw new Error('Redirect event queue message payload is invalid.');
  }

  return {
    ...parsed,
    occurredAt:
      typeof parsed.occurredAt === 'string' && isValidDateString(parsed.occurredAt)
        ? parsed.occurredAt
        : new Date().toISOString()
  };
}

export async function recordRedirectOpen(
  request: Request,
  input: {
    linkId: string | number;
    subtrackerId?: string | number;
    passwordId?: string | number;
    analyticsEventName: string;
    analyticsParams: Record<string, string | number | boolean | undefined | null>;
  }
) {
  const occurredAt = new Date().toISOString();
  const analyticsEvent = isGoogleAnalyticsEnabled()
    ? buildQueuedGoogleAnalyticsEvent(request, input.analyticsEventName, input.analyticsParams)
    : null;

  try {
    const queueUrl = getQueueConfig().linkUsageQueueUrl;

    if (!queueUrl) {
      const { recordLinkUsageMetrics } = await import('../db/links.js');

      await recordLinkUsageMetrics({
        usageCounts: [{ linkId: String(input.linkId), count: 1 }],
        subtrackerUsageCounts: input.subtrackerId
          ? [{ subtrackerId: String(input.subtrackerId), count: 1 }]
          : [],
        passwordUsageCounts: input.passwordId
          ? [{ passwordId: String(input.passwordId), count: 1 }]
          : [],
        hourlyRollups: [{ linkId: String(input.linkId), hourStart: getHourStart(occurredAt), count: 1 }],
        tenMinuteRollups: [
          {
            linkId: String(input.linkId),
            bucketStart: getTenMinuteBucketStart(occurredAt),
            count: 1
          }
        ]
      });

      if (analyticsEvent) {
        await sendQueuedGoogleAnalyticsEvent(analyticsEvent);
      }

      return;
    }

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          linkId: String(input.linkId),
          subtrackerId: input.subtrackerId ? String(input.subtrackerId) : undefined,
          passwordId: input.passwordId ? String(input.passwordId) : undefined,
          count: 1,
          occurredAt,
          analyticsEvent
        } satisfies RedirectOpenEventMessage)
      })
    );
  } catch (error) {
    console.error('Unable to record redirect open.', {
      linkId: input.linkId,
      subtrackerId: input.subtrackerId,
      passwordId: input.passwordId,
      error
    });
  }
}
