import 'source-map-support/register.js';

import * as cdk from 'aws-cdk-lib';

import { GoLinksAppStack } from '../lib/go-links-app-stack.js';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

new GoLinksAppStack(app, 'GoLinksAppStack', { env });
