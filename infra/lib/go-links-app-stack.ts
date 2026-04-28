import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as triggers from 'aws-cdk-lib/triggers';
import { Construct } from 'constructs';

import {
  parseCertificateArns,
  parseEdgeCertificateArns,
  parseHostedZones,
  parseJsonStringArray,
  parseProvisionedHostsFromEnv
} from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../..');

function toSecretId(value: string) {
  return value.includes(':secret:') ? value.split(':secret:')[1] ?? value : value;
}

function buildSecretPolicyResource(stack: cdk.Stack, secretId: string) {
  return stack.formatArn({
    service: 'secretsmanager',
    resource: 'secret',
    resourceName: `${secretId}*`,
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME
  });
}

function resolveSecretReference(stack: cdk.Stack, name?: string, arn?: string) {
  if (name) {
    return {
      id: name,
      policyResource: buildSecretPolicyResource(stack, name)
    };
  }

  if (!arn) {
    return null;
  }

  return {
    id: toSecretId(arn),
    policyResource: arn
  };
}

function parseArnRegion(arn: string) {
  return arn.split(':')[3] ?? '';
}

function validateCertificateRegions(
  hosts: string[],
  certificateArns: Record<string, string>,
  expectedRegion: string,
  variableName: string,
  usageDescription: string
) {
  for (const host of hosts) {
    const certificateArn = certificateArns[host];
    const certificateRegion = parseArnRegion(certificateArn);

    if (certificateRegion !== expectedRegion) {
      throw new Error(
        `${variableName} must contain ${usageDescription} certificate ARNs in ${expectedRegion}. ${host} is using ${certificateArn}.`
      );
    }
  }
}

export class GoLinksAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
    const emailAuthFromEmail = process.env.EMAIL_AUTH_FROM_EMAIL?.trim().toLowerCase() ?? '';
    const emailAuthFromName = process.env.EMAIL_AUTH_FROM_NAME?.trim() ?? '';
    const emailAuthSesIdentityArn = process.env.EMAIL_AUTH_SES_IDENTITY_ARN?.trim() ?? '';

    const appBuildId = process.env.APP_BUILD_ID ?? process.env.GITHUB_SHA ?? 'dev';
    const analyticsMeasurementId = process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID ?? '';
    const analyticsApiSecret = process.env.GOOGLE_ANALYTICS_API_SECRET ?? '';
    const vpcId = process.env.APP_VPC_ID;
    const lambdaSecurityGroupId = process.env.APP_LAMBDA_SECURITY_GROUP_ID;
    const jwtSecretName = process.env.APP_JWT_SECRET_NAME;
    const jwtSecretArn = process.env.APP_JWT_SECRET_ARN;
    const databaseSecretName = process.env.APP_DATABASE_SECRET_NAME;
    const databaseSecretArn = process.env.APP_DATABASE_SECRET_ARN;
    const databaseHost = process.env.APP_DATABASE_HOST;
    const privateSubnetIds = parseJsonStringArray('APP_PRIVATE_SUBNET_IDS_JSON');
    const availabilityZones = parseJsonStringArray('APP_AVAILABILITY_ZONES_JSON');
    const jwtSecret = resolveSecretReference(this, jwtSecretName, jwtSecretArn);
    const databaseSecret = resolveSecretReference(this, databaseSecretName, databaseSecretArn);

    if (
      !vpcId ||
      !lambdaSecurityGroupId ||
      !jwtSecret ||
      !databaseSecret ||
      !databaseHost
    ) {
      throw new Error(
        'APP_VPC_ID, APP_LAMBDA_SECURITY_GROUP_ID, APP_DATABASE_HOST, APP_PRIVATE_SUBNET_IDS_JSON, APP_AVAILABILITY_ZONES_JSON, APP_HOSTED_ZONE_IDS_JSON, APP_CERTIFICATE_ARNS_JSON or APP_CERTIFICATE_ARN, and either APP_JWT_SECRET_NAME or APP_JWT_SECRET_ARN plus either APP_DATABASE_SECRET_NAME or APP_DATABASE_SECRET_ARN must be set. If the app deploy region is not us-east-1, APP_EDGE_CERTIFICATE_ARNS_JSON must also point at CloudFront certificates in us-east-1.'
      );
    }

    if (privateSubnetIds.length === 0) {
      throw new Error('APP_PRIVATE_SUBNET_IDS_JSON must include at least one subnet id.');
    }

    if (availabilityZones.length !== privateSubnetIds.length) {
      throw new Error(
        'APP_AVAILABILITY_ZONES_JSON must contain one availability zone for each private subnet.'
      );
    }

    if (emailAuthFromEmail && !emailAuthSesIdentityArn) {
      throw new Error(
        'EMAIL_AUTH_SES_IDENTITY_ARN must be set when EMAIL_AUTH_FROM_EMAIL is configured.'
      );
    }

    if (!emailAuthFromEmail && emailAuthSesIdentityArn) {
      throw new Error(
        'EMAIL_AUTH_FROM_EMAIL must be set when EMAIL_AUTH_SES_IDENTITY_ARN is configured.'
      );
    }

    const hosts = parseProvisionedHostsFromEnv();
    const certificateArns = parseCertificateArns(hosts);
    const edgeCertificateArns = parseEdgeCertificateArns(hosts, certificateArns);
    const hostedZones = parseHostedZones(hosts);
    const deployRegion = cdk.Token.isUnresolved(this.region)
      ? process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION
      : this.region;

    if (deployRegion) {
      validateCertificateRegions(
        hosts,
        certificateArns,
        deployRegion,
        'APP_CERTIFICATE_ARNS_JSON / APP_CERTIFICATE_ARN',
        'API Gateway regional custom-domain'
      );
    }

    validateCertificateRegions(
      hosts,
      edgeCertificateArns,
      'us-east-1',
      'APP_EDGE_CERTIFICATE_ARNS_JSON',
      'CloudFront viewer'
    );

    const zoneCache = new Map<string, route53.IHostedZone>();
    for (const host of hosts) {
      const hostedZone = hostedZones[host];
      zoneCache.set(
        host,
        route53.HostedZone.fromHostedZoneAttributes(this, `Zone${host.replace(/\W/g, '')}`, {
          hostedZoneId: hostedZone.hostedZoneId,
          zoneName: hostedZone.zoneName
        })
      );
    }

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'GoLinksVpc', {
      vpcId,
      availabilityZones,
      privateSubnetIds
    });

    const lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'GoLinksLambdaSg',
      lambdaSecurityGroupId
    );

    const privateSubnets = privateSubnetIds.map((subnetId, index) =>
      ec2.Subnet.fromSubnetAttributes(this, `GoLinksPrivateSubnet${index + 1}`, {
        subnetId,
        availabilityZone: availabilityZones[index]
      })
    );

    const redirectCacheSecurityGroup = new ec2.SecurityGroup(this, 'GoLinksRedirectCacheSg', {
      vpc,
      description: 'Security group for the shared go-links redirect cache.',
      allowAllOutbound: true
    });

    redirectCacheSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow go-links Lambdas to reach the redirect cache'
    );

    const redirectCacheName = `${this.stackName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-redirect-cache`.slice(
      0,
      40
    );

    const redirectCache = new elasticache.CfnServerlessCache(this, 'GoLinksRedirectCache', {
      engine: 'valkey',
      description: 'Shared redirect cache for go-links.',
      serverlessCacheName: redirectCacheName,
      securityGroupIds: [redirectCacheSecurityGroup.securityGroupId],
      subnetIds: privateSubnetIds
    });

    const linkUsageDlq = new sqs.Queue(this, 'GoLinksLinkUsageDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14)
    });

    const linkUsageQueue = new sqs.Queue(this, 'GoLinksLinkUsageQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: linkUsageDlq,
        maxReceiveCount: 5
      }
    });

    const sharedEnvironment = {
      APP_BUILD_ID: appBuildId,
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: googleClientId,
      EMAIL_AUTH_FROM_EMAIL: emailAuthFromEmail,
      EMAIL_AUTH_FROM_NAME: emailAuthFromName,
      GOOGLE_ANALYTICS_MEASUREMENT_ID: analyticsMeasurementId,
      GOOGLE_ANALYTICS_API_SECRET: analyticsApiSecret,
      ALLOWED_EMAILS_JSON: process.env.ALLOWED_EMAILS_JSON ?? '',
      ALLOWED_EMAIL_DOMAINS_JSON: process.env.ALLOWED_EMAIL_DOMAINS_JSON ?? '',
      ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS:
        process.env.ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS ?? 'false',
      SUPER_ADMIN_EMAILS: process.env.SUPER_ADMIN_EMAILS ?? '',
      JWT_SECRET_ID: jwtSecret.id,
      DATABASE_SECRET_ID: databaseSecret.id,
      DATABASE_HOST: databaseHost,
      DATABASE_SSL: 'require',
      DATABASE_PORT: process.env.APP_DATABASE_PORT ?? '5432',
      DATABASE_NAME: process.env.APP_DATABASE_NAME ?? 'go_links',
      DOMAINS_JSON: JSON.stringify(hosts),
      LINK_USAGE_QUEUE_URL: linkUsageQueue.queueUrl,
      REDIRECT_CACHE_URL: cdk.Fn.join('', [
        'rediss://',
        redirectCache.attrEndpointAddress,
        ':',
        redirectCache.attrEndpointPort
      ])
    };

    const appFunction = new lambdaNodejs.NodejsFunction(this, 'GoLinksFunction', {
      entry: path.join(workspaceRoot, 'server/src/lambda.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(20),
      logRetention: logs.RetentionDays.ONE_MONTH,
      vpc,
      securityGroups: [lambdaSecurityGroup],
      vpcSubnets: {
        subnets: privateSubnets
      },
      environment: {
        ...sharedEnvironment,
        CLIENT_DIST_DIR: '/var/task/client-dist'
      },
      bundling: {
        format: lambdaNodejs.OutputFormat.CJS,
        minify: true,
        sourceMap: true,
        commandHooks: {
          beforeBundling() {
            return [];
          },
          beforeInstall() {
            return [];
          },
          afterBundling(inputDir, outputDir) {
            return [
              `mkdir -p ${outputDir}/client-dist`,
              `cp -r ${inputDir}/client/dist/. ${outputDir}/client-dist`,
              `mkdir -p ${outputDir}/content`,
              `cp ${inputDir}/server/content/privacy-policy.md ${outputDir}/content/privacy-policy.md`
            ];
          }
        }
      }
    });

    const appFunctionLiveAlias = new lambda.Alias(this, 'GoLinksFunctionLiveAlias', {
      aliasName: 'live',
      version: appFunction.currentVersion
    });

    const migrationFunction = new lambdaNodejs.NodejsFunction(this, 'GoLinksMigrationFunction', {
      entry: path.join(workspaceRoot, 'server/src/migrate-lambda.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 1024,
      logRetention: logs.RetentionDays.ONE_MONTH,
      vpc,
      securityGroups: [lambdaSecurityGroup],
      vpcSubnets: {
        subnets: privateSubnets
      },
      environment: {
        ...sharedEnvironment,
        MIGRATIONS_DIR: '/var/task/migrations'
      },
      bundling: {
        format: lambdaNodejs.OutputFormat.CJS,
        minify: true,
        sourceMap: true,
        commandHooks: {
          beforeBundling() {
            return [];
          },
          beforeInstall() {
            return [];
          },
          afterBundling(_inputDir, outputDir) {
            return [
              `mkdir -p ${outputDir}/migrations`,
              `cp -r ${workspaceRoot}/server/migrations/. ${outputDir}/migrations`
            ];
          }
        }
      }
    });

    const linkUsageWorker = new lambdaNodejs.NodejsFunction(this, 'GoLinksLinkUsageWorker', {
      entry: path.join(workspaceRoot, 'server/src/link-usage-worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_MONTH,
      vpc,
      securityGroups: [lambdaSecurityGroup],
      vpcSubnets: {
        subnets: privateSubnets
      },
      environment: sharedEnvironment,
      bundling: {
        format: lambdaNodejs.OutputFormat.CJS,
        minify: true,
        sourceMap: true
      }
    });

    const api = new apigwv2.HttpApi(this, 'GoLinksHttpApi', {
      defaultIntegration: new apigwv2Integrations.HttpLambdaIntegration(
        'GoLinksLambdaIntegration',
        appFunctionLiveAlias
      )
    });

    new triggers.Trigger(this, 'GoLinksMigrationTrigger', {
      handler: migrationFunction,
      executeAfter: [appFunction]
    });

    linkUsageWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(linkUsageQueue, {
        batchSize: 100,
        maxBatchingWindow: cdk.Duration.seconds(1),
        reportBatchItemFailures: true
      })
    );

    linkUsageQueue.grantSendMessages(appFunction);

    for (const fn of [appFunction, migrationFunction, linkUsageWorker]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'],
          resources: [jwtSecret.policyResource, databaseSecret.policyResource]
        })
      );
    }

    if (emailAuthFromEmail) {
      appFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'ses:FromAddress': emailAuthFromEmail
            }
          }
        })
      );
    }

    for (const host of hosts) {
      const certificate = acm.Certificate.fromCertificateArn(
        this,
        `GoLinksCertificate${host.replace(/\W/g, '')}`,
        certificateArns[host]
      );
      const edgeCertificate = acm.Certificate.fromCertificateArn(
        this,
        `GoLinksEdgeCertificate${host.replace(/\W/g, '')}`,
        edgeCertificateArns[host]
      );

      const domain = new apigwv2.DomainName(this, `Domain${host.replace(/\W/g, '')}`, {
        domainName: host,
        certificate
      });

      new apigwv2.ApiMapping(this, `Mapping${host.replace(/\W/g, '')}`, {
        api,
        domainName: domain,
        stage: api.defaultStage
      });

      const distribution = new cloudfront.Distribution(
        this,
        `Distribution${host.replace(/\W/g, '')}`,
        {
          certificate: edgeCertificate,
          domainNames: [host],
          minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          defaultBehavior: {
            origin: new cloudfrontOrigins.HttpOrigin(domain.regionalDomainName, {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
            }),
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
          }
        }
      );

      const zone = zoneCache.get(host)!;

      new route53.ARecord(this, `ARecord${host.replace(/\W/g, '')}`, {
        zone,
        recordName: host,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution))
      });
    }

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.apiEndpoint,
      exportName: `${this.stackName}:ApiEndpoint`
    });

    new cdk.CfnOutput(this, 'AppFunctionName', {
      value: appFunction.functionName,
      exportName: `${this.stackName}:AppFunctionName`
    });

    new cdk.CfnOutput(this, 'AppFunctionAliasName', {
      value: appFunctionLiveAlias.aliasName,
      exportName: `${this.stackName}:AppFunctionAliasName`
    });
  }
}
