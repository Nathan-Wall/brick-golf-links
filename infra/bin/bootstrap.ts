import 'source-map-support/register.js';

import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();

new cdk.Stack(app, 'BootstrapPlaceholder', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
