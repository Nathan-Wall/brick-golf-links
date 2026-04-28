import { createClient, type RedisClientType } from 'redis';

import { getRedirectCacheConfig } from '../config/redirect-cache-config.js';

const sharedRedisErrorLogIntervalMs = 30_000;

let sharedRedisClient: RedisClientType | null = null;
let sharedRedisClientConnectPromise: Promise<RedisClientType | null> | null = null;
let lastSharedRedisErrorAt = 0;

function logSharedRedisError(operation: string, error: unknown) {
  const now = Date.now();
  if (now - lastSharedRedisErrorAt < sharedRedisErrorLogIntervalMs) {
    return;
  }

  lastSharedRedisErrorAt = now;
  console.error(`Unable to use shared Redis during ${operation}.`, { error });
}

export async function getSharedRedisClient() {
  const { redirectCacheUrl } = getRedirectCacheConfig();
  if (!redirectCacheUrl) {
    return null;
  }

  if (sharedRedisClient?.isReady) {
    return sharedRedisClient;
  }

  if (sharedRedisClientConnectPromise) {
    return await sharedRedisClientConnectPromise;
  }

  if (!sharedRedisClient) {
    sharedRedisClient = createClient({
      url: redirectCacheUrl,
      socket: {
        connectTimeout: 1_000,
        keepAlive: true,
        keepAliveInitialDelay: 5_000,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1_000)
      }
    });

    sharedRedisClient.on('error', (error) => {
      logSharedRedisError('redis-client-error', error);
    });
  }

  const client = sharedRedisClient;
  sharedRedisClientConnectPromise = client
    .connect()
    .then(() => client)
    .catch((error) => {
      logSharedRedisError('redis-connect', error);

      try {
        client.destroy();
      } catch {
        // Best-effort cleanup.
      }

      if (sharedRedisClient === client) {
        sharedRedisClient = null;
      }

      return null;
    })
    .finally(() => {
      sharedRedisClientConnectPromise = null;
    });

  return await sharedRedisClientConnectPromise;
}
