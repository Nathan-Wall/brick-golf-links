import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

import { loadRuntimeConfig } from './runtime/load-runtime-config.js';
import {
  sendQueuedGoogleAnalyticsEvent,
  type QueuedGoogleAnalyticsEvent
} from './services/google-analytics.js';
import {
  parseRedirectOpenEventMessage,
  type RedirectOpenEventMessage
} from './services/redirect-event-queue.js';
import { getHourStart, getTenMinuteBucketStart } from './services/usage-buckets.js';

function aggregateLinkUsage(
  records: SQSEvent['Records'],
  parseRedirectOpenEventMessage: (messageBody: string) => RedirectOpenEventMessage
) {
  const aggregatedUsage = new Map<string, number>();
  const aggregatedSubtrackerUsage = new Map<string, number>();
  const aggregatedPasswordUsage = new Map<string, number>();
  const aggregatedHourlyUsage = new Map<string, { linkId: string; hourStart: string; count: number }>();
  const aggregatedTenMinuteUsage = new Map<
    string,
    { linkId: string; bucketStart: string; count: number }
  >();
  const analyticsEvents: QueuedGoogleAnalyticsEvent[] = [];

  for (const record of records) {
    try {
      const message = parseRedirectOpenEventMessage(record.body);
      aggregatedUsage.set(message.linkId, (aggregatedUsage.get(message.linkId) ?? 0) + message.count);
      if (message.subtrackerId) {
        aggregatedSubtrackerUsage.set(
          message.subtrackerId,
          (aggregatedSubtrackerUsage.get(message.subtrackerId) ?? 0) + message.count
        );
      }
      if (message.passwordId) {
        aggregatedPasswordUsage.set(
          message.passwordId,
          (aggregatedPasswordUsage.get(message.passwordId) ?? 0) + message.count
        );
      }
      const hourStart = getHourStart(message.occurredAt);
      const hourlyUsageKey = `${message.linkId}:${hourStart}`;
      const existingHourlyUsage = aggregatedHourlyUsage.get(hourlyUsageKey);
      aggregatedHourlyUsage.set(hourlyUsageKey, {
        linkId: message.linkId,
        hourStart,
        count: (existingHourlyUsage?.count ?? 0) + message.count
      });
      const tenMinuteBucketStart = getTenMinuteBucketStart(message.occurredAt);
      const tenMinuteUsageKey = `${message.linkId}:${tenMinuteBucketStart}`;
      const existingTenMinuteUsage = aggregatedTenMinuteUsage.get(tenMinuteUsageKey);
      aggregatedTenMinuteUsage.set(tenMinuteUsageKey, {
        linkId: message.linkId,
        bucketStart: tenMinuteBucketStart,
        count: (existingTenMinuteUsage?.count ?? 0) + message.count
      });
      if (message.analyticsEvent) {
        analyticsEvents.push(message.analyticsEvent);
      }
    } catch (error) {
      console.error('Dropping malformed redirect event queue message.', {
        messageId: record.messageId,
        error
      });
    }
  }

  return {
    usageUpdates: [...aggregatedUsage.entries()].map(([linkId, count]) => ({
      linkId,
      count
    })),
    subtrackerUsageUpdates: [...aggregatedSubtrackerUsage.entries()].map(
      ([subtrackerId, count]) => ({
        subtrackerId,
        count
      })
    ),
    passwordUsageUpdates: [...aggregatedPasswordUsage.entries()].map(([passwordId, count]) => ({
      passwordId,
      count
    })),
    hourlyRollups: [...aggregatedHourlyUsage.values()],
    tenMinuteRollups: [...aggregatedTenMinuteUsage.values()],
    analyticsEvents
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeConfig();
  const { recordLinkUsageMetrics } = await import('./db/links.js');

  const {
    usageUpdates,
    subtrackerUsageUpdates,
    passwordUsageUpdates,
    hourlyRollups,
    tenMinuteRollups,
    analyticsEvents
  } = aggregateLinkUsage(event.Records, parseRedirectOpenEventMessage);
  if (
    usageUpdates.length === 0 &&
    subtrackerUsageUpdates.length === 0 &&
    passwordUsageUpdates.length === 0 &&
    hourlyRollups.length === 0 &&
    tenMinuteRollups.length === 0 &&
    analyticsEvents.length === 0
  ) {
    return {
      batchItemFailures: []
    };
  }

  if (
    usageUpdates.length > 0 ||
    subtrackerUsageUpdates.length > 0 ||
    passwordUsageUpdates.length > 0 ||
    hourlyRollups.length > 0 ||
    tenMinuteRollups.length > 0
  ) {
    await recordLinkUsageMetrics({
      usageCounts: usageUpdates,
      subtrackerUsageCounts: subtrackerUsageUpdates,
      passwordUsageCounts: passwordUsageUpdates,
      hourlyRollups,
      tenMinuteRollups
    });
  }

  if (analyticsEvents.length > 0) {
    const results = await Promise.allSettled(
      analyticsEvents.map((analyticsEvent) => sendQueuedGoogleAnalyticsEvent(analyticsEvent))
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        return;
      }

      console.error('Unable to deliver queued Google Analytics event.', {
        index,
        error: result.reason
      });
    });
  }

  return {
    batchItemFailures: []
  };
}
