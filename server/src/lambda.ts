import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import serverless from 'serverless-http';

import { loadRuntimeConfig } from './runtime/load-runtime-config.js';

let serverPromise: ReturnType<typeof serverless> | null = null;

async function getServer() {
  if (!serverPromise) {
    await loadRuntimeConfig();
    const { createApp } = await import('./app.js');
    serverPromise = serverless(createApp());
  }

  return serverPromise;
}

export async function handler(event: APIGatewayProxyEventV2, context: Context) {
  const server = await getServer();
  return await server(event, context);
}
