#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

interface Config {
  readonly terraformDir: string;
  readonly outputName: string;
  readonly repo: string | null;
  readonly environment: string | null;
  readonly dryRun: boolean;
}

type VariableMap = Record<string, string>;

function usage(): string {
  return `Usage:
  scripts/sync-github-vars-from-terraform.sh [--repo OWNER/REPO] [--env NAME] [--terraform-dir PATH] [--output NAME] [--dry-run]

Examples:
  scripts/sync-github-vars-from-terraform.sh --repo owner/repo
  scripts/sync-github-vars-from-terraform.sh --repo owner/repo --env production
  scripts/sync-github-vars-from-terraform.sh --terraform-dir terraform/foundation --dry-run

Defaults:
  --terraform-dir  terraform/foundation
  --output         github_actions_variables

Notes:
  - Requires both terraform and gh to be installed and available on PATH.
  - Only GitHub Actions variables are synced. Secrets such as AWS_DEPLOY_ROLE_ARN,
    GOOGLE_CLIENT_ID, and GOOGLE_ANALYTICS_API_SECRET still need to be managed separately.
  - Without --env, variables are written at the repository level.
  - If --repo is omitted, the script uses the current gh repository context.`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireCommand(name: string): void {
  const result = spawnSync(name, ['--version'], { encoding: 'utf8' });
  const error = result.error as NodeJS.ErrnoException | undefined;

  if (error?.code === 'ENOENT') {
    fail(`Missing required command: ${name}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    fail(stderr ? `Unable to run ${name}: ${stderr}` : `Unable to run ${name}.`);
  }
}

function runCommand(command: string, args: string[], options?: { stdin?: string }) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options?.stdin
  });
  const error = result.error as NodeJS.ErrnoException | undefined;

  if (error?.code === 'ENOENT') {
    fail(`Missing required command: ${command}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    const stdout = (result.stdout ?? '').trim();
    fail(stderr || stdout || `${command} ${args.join(' ')} failed.`);
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
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

function loadConfig(argv: string[]): Config {
  let terraformDir = 'terraform/foundation';
  let outputName = 'github_actions_variables';
  let repo: string | null = null;
  let environment: string | null = null;
  let dryRun = false;

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
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
      default:
        fail(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!terraformDir.trim()) {
    fail('--terraform-dir must be a non-empty path.');
  }

  if (!outputName.trim()) {
    fail('--output must be a non-empty Terraform output name.');
  }

  if (repo !== null && !repo.trim()) {
    fail('--repo must be a non-empty owner/repo value.');
  }

  if (environment !== null && !environment.trim()) {
    fail('--env must be a non-empty environment name.');
  }

  return {
    terraformDir,
    outputName,
    repo: repo?.trim() ?? null,
    environment: environment?.trim() ?? null,
    dryRun
  };
}

function resolveRepositoryName(config: Config): string {
  if (config.repo) {
    return config.repo;
  }

  const result = runCommand('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const repoName = result.stdout.trim();
  if (!repoName) {
    fail('Unable to determine the current GitHub repository. Pass --repo OWNER/REPO.');
  }

  return repoName;
}

function loadTerraformVariables(config: Config): VariableMap {
  const result = runCommand('terraform', [
    `-chdir=${config.terraformDir}`,
    'output',
    '-json',
    config.outputName
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    fail(
      `Unable to parse terraform output ${config.outputName} as JSON.${
        error instanceof Error ? ` ${error.message}` : ''
      }`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`terraform output ${config.outputName} must be a JSON object of GitHub variable names to values.`);
  }

  const variables = Object.fromEntries(
    Object.entries(parsed).map(([name, value]) => [name, normalizeVariableValue(value)])
  );

  if (Object.keys(variables).length === 0) {
    fail(`terraform output ${config.outputName} did not contain any GitHub variables.`);
  }

  return variables;
}

function syncVariable(
  repo: string,
  environment: string | null,
  name: string,
  value: string,
  dryRun: boolean
): void {
  const scopeLabel = environment ? `environment ${environment}` : 'repository';

  if (dryRun) {
    console.log(`[dry-run] ${scopeLabel} ${name}=${value}`);
    return;
  }

  const args = ['variable', 'set', name, '--repo', repo, '--body', value];
  if (environment) {
    args.push('--env', environment);
  }

  runCommand('gh', args);
  console.log(`Synced ${name} to ${scopeLabel}.`);
}

function main(): void {
  const config = loadConfig(process.argv.slice(2));

  requireCommand('gh');
  requireCommand('terraform');

  const repo = resolveRepositoryName(config);
  const variables = loadTerraformVariables(config);
  const sortedNames = Object.keys(variables).sort((left, right) => left.localeCompare(right));

  console.log(
    `Syncing ${sortedNames.length} GitHub Actions variable${sortedNames.length === 1 ? '' : 's'} ` +
      `from terraform output ${config.outputName} in ${config.terraformDir} to ${config.environment ? `environment ${config.environment}` : 'repository'} ${repo}.`
  );

  for (const name of sortedNames) {
    syncVariable(repo, config.environment, name, variables[name]!, config.dryRun);
  }
}

main();
