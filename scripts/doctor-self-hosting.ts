#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { parseProvisionedHosts } from '../domain-config/index.js';

type Severity = 'ok' | 'warn' | 'error' | 'info';

type Finding = {
  severity: Severity;
  message: string;
};

type Config = {
  terraformDir: string;
  outputName: string;
  repo: string | null;
  environment: string | null;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
};

type GitHubVariableRecord = {
  name: string;
  value: string;
  source: 'repo' | 'env';
};

type GitHubSecretRecord = {
  name: string;
  source: 'repo' | 'env';
};

const REQUIRED_TERRAFORM_VARIABLES = [
  'AWS_REGION',
  'DOMAINS_JSON',
  'APP_VPC_ID',
  'APP_LAMBDA_SECURITY_GROUP_ID',
  'APP_PRIVATE_SUBNET_IDS_JSON',
  'APP_AVAILABILITY_ZONES_JSON',
  'APP_CERTIFICATE_ARNS_JSON',
  'APP_HOSTED_ZONE_IDS_JSON',
  'APP_JWT_SECRET_NAME',
  'APP_DATABASE_SECRET_NAME',
  'APP_DATABASE_HOST'
] as const;

const REQUIRED_GITHUB_SECRETS = ['AWS_DEPLOY_ROLE_ARN'] as const;

function usage() {
  return `Usage:
  scripts/doctor-self-hosting.sh [--repo OWNER/REPO] [--env NAME] [--no-env] [--terraform-dir PATH] [--output NAME]

Examples:
  scripts/doctor-self-hosting.sh
  scripts/doctor-self-hosting.sh --repo owner/repo
  scripts/doctor-self-hosting.sh --repo owner/repo --env production
  scripts/doctor-self-hosting.sh --repo owner/repo --no-env

Defaults:
  --terraform-dir  terraform/foundation
  --output         github_actions_variables
  --env            production

Checks:
  - local commands and authentication for gh, aws, and terraform
  - Terraform deploy output completeness and consistency
  - GitHub variable drift versus Terraform output
  - required GitHub secrets and recommended manual settings`;
}

function addFinding(findings: Finding[], severity: Severity, message: string) {
  findings.push({ severity, message });
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8'
  });

  const error = result.error as NodeJS.ErrnoException | undefined;
  if (error?.code === 'ENOENT') {
    return {
      ok: false,
      stdout: '',
      stderr: `Missing required command: ${command}`,
      status: null
    };
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? null
  };
}

function loadConfig(argv: string[]): Config {
  let terraformDir = 'terraform/foundation';
  let outputName = 'github_actions_variables';
  let repo: string | null = null;
  let environment: string | null = 'production';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--terraform-dir':
        terraformDir = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--output':
        outputName = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--repo':
        repo = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--env':
        environment = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--no-env':
        environment = null;
        break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}\n\n${usage()}`);
        process.exit(1);
    }
  }

  if (!terraformDir.trim()) {
    console.error('--terraform-dir must be a non-empty path.');
    process.exit(1);
  }

  if (!outputName.trim()) {
    console.error('--output must be a non-empty Terraform output name.');
    process.exit(1);
  }

  if (repo !== null && !repo.trim()) {
    console.error('--repo must be a non-empty owner/repo value.');
    process.exit(1);
  }

  if (environment !== null && !environment.trim()) {
    console.error('--env must be a non-empty environment name.');
    process.exit(1);
  }

  return {
    terraformDir: terraformDir.trim(),
    outputName: outputName.trim(),
    repo: repo?.trim() ?? null,
    environment: environment?.trim() ?? null
  };
}

function normalizeVariableValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  return JSON.stringify(value);
}

function parseJsonObject(raw: string, label: string, findings: Finding[]): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      addFinding(findings, 'error', `${label} must be a JSON object.`);
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    addFinding(
      findings,
      'error',
      `${label} must be valid JSON.${error instanceof Error ? ` ${error.message}` : ''}`
    );
    return null;
  }
}

function parseJsonStringArray(raw: string, label: string, findings: Finding[]): string[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      addFinding(findings, 'error', `${label} must be a JSON array of strings.`);
      return null;
    }

    return parsed;
  } catch (error) {
    addFinding(
      findings,
      'error',
      `${label} must be valid JSON.${error instanceof Error ? ` ${error.message}` : ''}`
    );
    return null;
  }
}

function parseHostList(raw: string, findings: Finding[]): string[] | null {
  try {
    return parseProvisionedHosts(raw, { variableName: 'DOMAINS_JSON' });
  } catch (error) {
    addFinding(
      findings,
      'error',
      error instanceof Error ? error.message : 'DOMAINS_JSON is invalid.'
    );
    return null;
  }
}

function validateHostKeyedMap(
  label: string,
  rawValue: string | undefined,
  hosts: string[],
  findings: Finding[],
  options?: { required?: boolean }
) {
  const required = options?.required ?? true;
  if (!rawValue) {
    if (required) {
      addFinding(findings, 'error', `${label} is missing from Terraform output.`);
    }
    return;
  }

  const parsed = parseJsonObject(rawValue, label, findings);
  if (!parsed) {
    return;
  }

  for (const host of hosts) {
    if (typeof parsed[host] !== 'string' || String(parsed[host]).trim().length === 0) {
      addFinding(findings, 'error', `${label} is missing a non-empty value for ${host}.`);
    }
  }

  const extraHosts = Object.keys(parsed).filter((host) => !hosts.includes(host)).sort();
  if (extraHosts.length > 0) {
    addFinding(findings, 'warn', `${label} contains hosts not present in DOMAINS_JSON: ${extraHosts.join(', ')}.`);
  }
}

function resolveHostname(repo: string) {
  const segments = repo.split('/');
  if (segments.length === 3 && /[.:]/.test(segments[0]!)) {
    return segments[0]!;
  }

  return 'github.com';
}

function checkGhAuthStatus(hostname: string) {
  const activeStatus = runCommand('gh', ['auth', 'status', '--active', '--hostname', hostname]);
  if (activeStatus.ok) {
    return activeStatus;
  }

  const combinedOutput = `${activeStatus.stderr}\n${activeStatus.stdout}`.toLowerCase();
  if (!combinedOutput.includes('unknown flag: --active')) {
    return activeStatus;
  }

  return runCommand('gh', ['auth', 'status', '--hostname', hostname]);
}

function resolveRepo(findings: Finding[], config: Config): string | null {
  if (config.repo) {
    return config.repo;
  }

  const result = runCommand('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (!result.ok) {
    addFinding(
      findings,
      'error',
      `Unable to determine the current GitHub repository.${result.stderr.trim() ? ` ${result.stderr.trim()}` : ''}`
    );
    return null;
  }

  const repo = result.stdout.trim();
  if (!repo) {
    addFinding(findings, 'error', 'Unable to determine the current GitHub repository. Pass --repo OWNER/REPO.');
    return null;
  }

  return repo;
}

function listGitHubVariables(
  findings: Finding[],
  repo: string,
  environment: string | null
): Map<string, GitHubVariableRecord> | null {
  const repoResult = runCommand('gh', ['variable', 'list', '--repo', repo, '--json', 'name,value']);
  if (!repoResult.ok) {
    addFinding(
      findings,
      'error',
      `Unable to list repository GitHub variables.${repoResult.stderr.trim() ? ` ${repoResult.stderr.trim()}` : ''}`
    );
    return null;
  }

  let repoVariables;
  try {
    repoVariables = JSON.parse(repoResult.stdout) as Array<{ name: string; value: string }>;
  } catch (error) {
    addFinding(
      findings,
      'error',
      `Unable to parse repository GitHub variables.${error instanceof Error ? ` ${error.message}` : ''}`
    );
    return null;
  }

  const merged = new Map<string, GitHubVariableRecord>();
  for (const variable of repoVariables) {
    merged.set(variable.name, {
      name: variable.name,
      value: variable.value,
      source: 'repo'
    });
  }

  if (!environment) {
    addFinding(findings, 'ok', `Loaded ${merged.size} repository GitHub variables from ${repo}.`);
    return merged;
  }

  const envResult = runCommand('gh', [
    'variable',
    'list',
    '--repo',
    repo,
    '--env',
    environment,
    '--json',
    'name,value'
  ]);
  if (!envResult.ok) {
    addFinding(
      findings,
      'error',
      `Unable to list GitHub variables for environment ${environment}.${envResult.stderr.trim() ? ` ${envResult.stderr.trim()}` : ''}`
    );
    return null;
  }

  try {
    const envVariables = JSON.parse(envResult.stdout) as Array<{ name: string; value: string }>;
    for (const variable of envVariables) {
      merged.set(variable.name, {
        name: variable.name,
        value: variable.value,
        source: 'env'
      });
    }
  } catch (error) {
    addFinding(
      findings,
      'error',
      `Unable to parse environment GitHub variables.${error instanceof Error ? ` ${error.message}` : ''}`
    );
    return null;
  }

  addFinding(findings, 'ok', `Loaded GitHub variables for ${repo} with environment ${environment} overrides.`);
  return merged;
}

function listGitHubSecrets(
  findings: Finding[],
  repo: string,
  environment: string | null
): Map<string, GitHubSecretRecord> | null {
  const repoResult = runCommand('gh', ['secret', 'list', '--repo', repo, '--json', 'name']);
  if (!repoResult.ok) {
    addFinding(
      findings,
      'error',
      `Unable to list repository GitHub secrets.${repoResult.stderr.trim() ? ` ${repoResult.stderr.trim()}` : ''}`
    );
    return null;
  }

  let repoSecrets;
  try {
    repoSecrets = JSON.parse(repoResult.stdout) as Array<{ name: string }>;
  } catch (error) {
    addFinding(
      findings,
      'error',
      `Unable to parse repository GitHub secrets.${error instanceof Error ? ` ${error.message}` : ''}`
    );
    return null;
  }

  const merged = new Map<string, GitHubSecretRecord>();
  for (const secret of repoSecrets) {
    merged.set(secret.name, {
      name: secret.name,
      source: 'repo'
    });
  }

  if (!environment) {
    addFinding(findings, 'ok', `Loaded ${merged.size} repository GitHub secrets from ${repo}.`);
    return merged;
  }

  const envResult = runCommand('gh', [
    'secret',
    'list',
    '--repo',
    repo,
    '--env',
    environment,
    '--json',
    'name'
  ]);
  if (!envResult.ok) {
    addFinding(
      findings,
      'error',
      `Unable to list GitHub secrets for environment ${environment}.${envResult.stderr.trim() ? ` ${envResult.stderr.trim()}` : ''}`
    );
    return null;
  }

  try {
    const envSecrets = JSON.parse(envResult.stdout) as Array<{ name: string }>;
    for (const secret of envSecrets) {
      merged.set(secret.name, {
        name: secret.name,
        source: 'env'
      });
    }
  } catch (error) {
    addFinding(
      findings,
      'error',
      `Unable to parse environment GitHub secrets.${error instanceof Error ? ` ${error.message}` : ''}`
    );
    return null;
  }

  addFinding(findings, 'ok', `Loaded GitHub secrets for ${repo} with environment ${environment} overrides.`);
  return merged;
}

function loadTerraformManagedVariables(findings: Finding[], config: Config): Record<string, string> | null {
  const result = runCommand('terraform', [
    `-chdir=${config.terraformDir}`,
    'output',
    '-json',
    config.outputName
  ]);

  if (!result.ok) {
    addFinding(
      findings,
      'error',
      `Unable to read terraform output ${config.outputName} from ${config.terraformDir}.${result.stderr.trim() ? ` ${result.stderr.trim()}` : ''}`
    );
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    addFinding(
      findings,
      'error',
      `Unable to parse terraform output ${config.outputName}.${error instanceof Error ? ` ${error.message}` : ''}`
    );
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    addFinding(findings, 'error', `terraform output ${config.outputName} must be a JSON object.`);
    return null;
  }

  const variables = Object.fromEntries(
    Object.entries(parsed).map(([name, value]) => [name, normalizeVariableValue(value)])
  );

  addFinding(
    findings,
    'ok',
    `Loaded ${Object.keys(variables).length} Terraform-managed GitHub variables from ${config.terraformDir}.`
  );
  return variables;
}

function validateTerraformManagedVariables(
  findings: Finding[],
  terraformVariables: Record<string, string>
): string[] | null {
  for (const name of REQUIRED_TERRAFORM_VARIABLES) {
    if (!terraformVariables[name]?.trim()) {
      addFinding(findings, 'error', `Terraform output is missing required GitHub variable ${name}.`);
    }
  }

  const hosts = terraformVariables.DOMAINS_JSON
    ? parseHostList(terraformVariables.DOMAINS_JSON, findings)
    : null;

  const subnetIds = terraformVariables.APP_PRIVATE_SUBNET_IDS_JSON
    ? parseJsonStringArray(terraformVariables.APP_PRIVATE_SUBNET_IDS_JSON, 'APP_PRIVATE_SUBNET_IDS_JSON', findings)
    : null;
  const availabilityZones = terraformVariables.APP_AVAILABILITY_ZONES_JSON
    ? parseJsonStringArray(terraformVariables.APP_AVAILABILITY_ZONES_JSON, 'APP_AVAILABILITY_ZONES_JSON', findings)
    : null;

  if (subnetIds && availabilityZones && subnetIds.length !== availabilityZones.length) {
    addFinding(
      findings,
      'error',
      'Terraform output APP_PRIVATE_SUBNET_IDS_JSON and APP_AVAILABILITY_ZONES_JSON must have the same length.'
    );
  }

  if (hosts) {
    validateHostKeyedMap('APP_CERTIFICATE_ARNS_JSON', terraformVariables.APP_CERTIFICATE_ARNS_JSON, hosts, findings);
    validateHostKeyedMap('APP_HOSTED_ZONE_IDS_JSON', terraformVariables.APP_HOSTED_ZONE_IDS_JSON, hosts, findings);

    const awsRegion = terraformVariables.AWS_REGION?.trim() ?? '';
    const edgeRequired = awsRegion !== 'us-east-1';
    validateHostKeyedMap(
      'APP_EDGE_CERTIFICATE_ARNS_JSON',
      terraformVariables.APP_EDGE_CERTIFICATE_ARNS_JSON,
      hosts,
      findings,
      { required: edgeRequired }
    );
  }

  return hosts;
}

function compareGitHubVariablesAgainstTerraform(
  findings: Finding[],
  terraformVariables: Record<string, string>,
  githubVariables: Map<string, GitHubVariableRecord>
) {
  for (const [name, expectedValue] of Object.entries(terraformVariables)) {
    const actual = githubVariables.get(name);
    if (!actual) {
      addFinding(findings, 'error', `GitHub variable ${name} is missing.`);
      continue;
    }

    if (actual.value !== expectedValue) {
      addFinding(findings, 'error', `GitHub variable ${name} does not match Terraform output.`);
      continue;
    }
  }

  addFinding(findings, 'ok', 'Compared Terraform-managed variables against current GitHub variables.');
}

function validateGitHubSecrets(
  findings: Finding[],
  githubSecrets: Map<string, GitHubSecretRecord>,
  githubVariables: Map<string, GitHubVariableRecord>
) {
  for (const secretName of REQUIRED_GITHUB_SECRETS) {
    if (!githubSecrets.has(secretName)) {
      addFinding(findings, 'error', `Required GitHub secret ${secretName} is missing.`);
    }
  }

  const googleClientIdPresent = githubSecrets.has('GOOGLE_CLIENT_ID');
  const emailFromAddress = githubVariables.get('EMAIL_AUTH_FROM_EMAIL')?.value.trim() ?? '';
  const emailFromName = githubVariables.get('EMAIL_AUTH_FROM_NAME')?.value.trim() ?? '';
  const emailSesIdentityArn = githubVariables.get('EMAIL_AUTH_SES_IDENTITY_ARN')?.value.trim() ?? '';
  const hasAnyEmailAuthConfig = Boolean(
      emailFromAddress ||
      emailFromName ||
      emailSesIdentityArn
  );
  const hasEmailProvider = Boolean(emailFromAddress && emailSesIdentityArn);

  if (hasAnyEmailAuthConfig && (!emailFromAddress || !emailSesIdentityArn)) {
    addFinding(
      findings,
      'error',
      'Email code sign-in is partially configured. EMAIL_AUTH_FROM_EMAIL and EMAIL_AUTH_SES_IDENTITY_ARN are both required for SES-backed delivery.'
    );
  }

  if (!googleClientIdPresent && !hasEmailProvider) {
    addFinding(
      findings,
      'error',
      'No sign-in provider is fully configured. Set GOOGLE_CLIENT_ID for Google sign-in, or configure EMAIL_AUTH_FROM_EMAIL and EMAIL_AUTH_SES_IDENTITY_ARN for SES-backed email code sign-in.'
    );
  }

  const analyticsMeasurementId = githubVariables.get('GOOGLE_ANALYTICS_MEASUREMENT_ID')?.value.trim() ?? '';
  const analyticsSecretPresent = githubSecrets.has('GOOGLE_ANALYTICS_API_SECRET');
  if (analyticsMeasurementId && !analyticsSecretPresent) {
    addFinding(
      findings,
      'warn',
      'GOOGLE_ANALYTICS_MEASUREMENT_ID is set, but GOOGLE_ANALYTICS_API_SECRET is missing. Analytics deploy config is incomplete.'
    );
  }

  if (!analyticsMeasurementId && analyticsSecretPresent) {
    addFinding(
      findings,
      'warn',
      'GOOGLE_ANALYTICS_API_SECRET is set, but GOOGLE_ANALYTICS_MEASUREMENT_ID is missing. Analytics will stay disabled.'
    );
  }
}

function validateManualGitHubVariables(findings: Finding[], githubVariables: Map<string, GitHubVariableRecord>) {
  const superAdmins = githubVariables.get('SUPER_ADMIN_EMAILS')?.value.trim() ?? '';
  if (!superAdmins) {
    addFinding(
      findings,
      'warn',
      'SUPER_ADMIN_EMAILS is not set. You will not have a super admin until this is configured.'
    );
  }

  const allowedEmails = githubVariables.get('ALLOWED_EMAILS_JSON')?.value.trim() ?? '';
  const allowedDomains = githubVariables.get('ALLOWED_EMAIL_DOMAINS_JSON')?.value.trim() ?? '';
  const allowAllValue = githubVariables.get('ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS')?.value.trim().toLowerCase() ?? '';
  const allowAll = allowAllValue === 'true' || allowAllValue === '1';

  if (!allowedEmails && !allowedDomains && !allowAll) {
    addFinding(
      findings,
      'warn',
      'No sign-in allowlist is configured and ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS is not enabled. Email code sign-in will remain deny-all, and Google sign-in will also remain deny-all.'
    );
  }

  if (allowAll) {
    addFinding(
      findings,
      'warn',
      'ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS is enabled. Any verified Google account can sign in.'
    );
  }
}

function printFindings(findings: Finding[]) {
  const order: Severity[] = ['error', 'warn', 'ok', 'info'];
  for (const severity of order) {
    const bucket = findings.filter((finding) => finding.severity === severity);
    if (bucket.length === 0) {
      continue;
    }

    const heading =
      severity === 'error'
        ? 'Errors'
        : severity === 'warn'
          ? 'Warnings'
          : severity === 'ok'
            ? 'Checks'
            : 'Info';

    console.log(`\n${heading}`);
    for (const finding of bucket) {
      const prefix =
        severity === 'error'
          ? 'ERROR'
          : severity === 'warn'
            ? 'WARN'
            : severity === 'ok'
              ? 'OK'
              : 'INFO';
      console.log(`- [${prefix}] ${finding.message}`);
    }
  }
}

function main() {
  const config = loadConfig(process.argv.slice(2));
  const findings: Finding[] = [];

  const ghVersion = runCommand('gh', ['--version']);
  if (ghVersion.ok) {
    addFinding(findings, 'ok', 'Found gh on PATH.');
  } else {
    addFinding(findings, 'error', ghVersion.stderr.trim() || 'Missing required command: gh');
  }

  const awsVersion = runCommand('aws', ['--version']);
  if (awsVersion.ok) {
    addFinding(findings, 'ok', 'Found aws on PATH.');
  } else {
    addFinding(findings, 'error', awsVersion.stderr.trim() || 'Missing required command: aws');
  }

  const terraformVersion = runCommand('terraform', ['--version']);
  if (terraformVersion.ok) {
    addFinding(findings, 'ok', 'Found terraform on PATH.');
  } else {
    addFinding(findings, 'error', terraformVersion.stderr.trim() || 'Missing required command: terraform');
  }

  let repo: string | null = null;
  if (ghVersion.ok) {
    const preResolvedRepo = config.repo ?? 'current gh repository';
    const hostname = resolveHostname(config.repo ?? 'github.com/placeholder/repo');
    const ghAuth = checkGhAuthStatus(hostname);
    if (ghAuth.ok) {
      addFinding(findings, 'ok', `gh auth is active for ${hostname}.`);
      repo = resolveRepo(findings, config);
    } else {
      addFinding(
        findings,
        'error',
        `gh auth is not ready for ${preResolvedRepo}.${ghAuth.stderr.trim() ? ` ${ghAuth.stderr.trim()}` : ''}`
      );
    }
  }

  if (awsVersion.ok) {
    const awsIdentity = runCommand('aws', ['sts', 'get-caller-identity', '--output', 'json']);
    if (awsIdentity.ok) {
      try {
        const identity = JSON.parse(awsIdentity.stdout) as { Account?: string; Arn?: string };
        const account = identity.Account ?? 'unknown-account';
        const arn = identity.Arn ?? 'unknown-principal';
        addFinding(findings, 'ok', `AWS credentials are valid for account ${account} (${arn}).`);
      } catch {
        addFinding(findings, 'ok', 'AWS credentials are valid.');
      }
    } else {
      addFinding(
        findings,
        'error',
        `AWS credentials are not ready.${awsIdentity.stderr.trim() ? ` ${awsIdentity.stderr.trim()}` : ''}`
      );
    }
  }

  const terraformVariables = terraformVersion.ok
    ? loadTerraformManagedVariables(findings, config)
    : null;
  if (terraformVariables) {
    validateTerraformManagedVariables(findings, terraformVariables);
  }

  let githubVariables: Map<string, GitHubVariableRecord> | null = null;
  let githubSecrets: Map<string, GitHubSecretRecord> | null = null;
  if (repo && ghVersion.ok) {
    githubVariables = listGitHubVariables(findings, repo, config.environment);
    githubSecrets = listGitHubSecrets(findings, repo, config.environment);
  }

  if (terraformVariables && githubVariables) {
    compareGitHubVariablesAgainstTerraform(findings, terraformVariables, githubVariables);
    validateManualGitHubVariables(findings, githubVariables);
  }

  if (githubSecrets && githubVariables) {
    validateGitHubSecrets(findings, githubSecrets, githubVariables);
  }

  const repoLabel = repo ?? config.repo ?? 'unknown repo';
  console.log(
    `Self-hosting doctor for ${repoLabel}${config.environment ? ` (environment: ${config.environment})` : ' (repository scope only)'}`
  );

  printFindings(findings);

  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warnCount = findings.filter((finding) => finding.severity === 'warn').length;
  const okCount = findings.filter((finding) => finding.severity === 'ok').length;

  console.log(`\nSummary: ${errorCount} error(s), ${warnCount} warning(s), ${okCount} successful check(s).`);

  process.exit(errorCount > 0 ? 1 : 0);
}

main();
