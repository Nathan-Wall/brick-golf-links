#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

interface Config {
  readonly terraformDir: string;
  readonly outputName: string;
  readonly repo: string | null;
  readonly environment: string | null;
  readonly skipSync: boolean;
  readonly skipDoctor: boolean;
  readonly dryRunSync: boolean;
  readonly terraformApplyArgs: string[];
}

function usage(): string {
  return `Usage:
  scripts/apply-self-hosting.sh [--repo OWNER/REPO] [--env NAME] [--no-env] [--terraform-dir PATH] [--output NAME] [--skip-sync] [--skip-doctor] [--dry-run-sync] [--] [terraform apply args...]

Examples:
  scripts/apply-self-hosting.sh --repo owner/repo --env production
  scripts/apply-self-hosting.sh --repo owner/repo --env production -- -auto-approve
  scripts/apply-self-hosting.sh --no-env --skip-doctor

Defaults:
  --terraform-dir  terraform/foundation
  --output         github_actions_variables
  --env            production

Notes:
  - Runs terraform apply first, then syncs GitHub Actions variables, then runs the self-hosting doctor.
  - Pass additional terraform apply arguments after --, for example -- -auto-approve.
  - Requires terraform to be installed. Sync and doctor also require gh, and doctor checks AWS credentials.
  - Secrets such as AWS_DEPLOY_ROLE_ARN still need to be managed separately.`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runStep(label: string, command: string, args: string[]): void {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  });
  const error = result.error as NodeJS.ErrnoException | undefined;

  if (error?.code === 'ENOENT') {
    fail(`Missing required command: ${command}`);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function loadConfig(argv: string[]): Config {
  let terraformDir = 'terraform/foundation';
  let outputName = 'github_actions_variables';
  let repo: string | null = null;
  let environment: string | null = 'production';
  let skipSync = false;
  let skipDoctor = false;
  let dryRunSync = false;
  let terraformApplyArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      terraformApplyArgs = argv.slice(index + 1);
      break;
    }

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
      case '--skip-sync':
        skipSync = true;
        break;
      case '--skip-doctor':
        skipDoctor = true;
        break;
      case '--dry-run-sync':
        dryRunSync = true;
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

  if (skipSync && dryRunSync) {
    fail('--dry-run-sync cannot be combined with --skip-sync.');
  }

  return {
    terraformDir: terraformDir.trim(),
    outputName: outputName.trim(),
    repo: repo?.trim() ?? null,
    environment: environment?.trim() ?? null,
    skipSync,
    skipDoctor,
    dryRunSync,
    terraformApplyArgs
  };
}

function buildSyncArgs(config: Config, scriptDir: string): string[] {
  const args = [
    '--experimental-strip-types',
    path.join(scriptDir, 'sync-github-vars-from-terraform.ts'),
    '--terraform-dir',
    config.terraformDir,
    '--output',
    config.outputName
  ];

  if (config.repo) {
    args.push('--repo', config.repo);
  }

  if (config.environment) {
    args.push('--env', config.environment);
  }

  if (config.dryRunSync) {
    args.push('--dry-run');
  }

  return args;
}

function buildDoctorArgs(config: Config, scriptDir: string): string[] {
  const args = [
    '--experimental-strip-types',
    path.join(scriptDir, 'doctor-self-hosting.ts'),
    '--terraform-dir',
    config.terraformDir,
    '--output',
    config.outputName
  ];

  if (config.repo) {
    args.push('--repo', config.repo);
  }

  if (config.environment) {
    args.push('--env', config.environment);
  } else {
    args.push('--no-env');
  }

  return args;
}

function main(): void {
  const config = loadConfig(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));

  runStep('terraform apply', 'terraform', [
    `-chdir=${config.terraformDir}`,
    'apply',
    ...config.terraformApplyArgs
  ]);

  if (!config.skipSync) {
    runStep(
      config.dryRunSync ? 'dry-run sync GitHub Actions variables' : 'sync GitHub Actions variables',
      process.execPath,
      buildSyncArgs(config, scriptDir)
    );
  }

  if (!config.skipDoctor) {
    runStep('run self-hosting doctor', process.execPath, buildDoctorArgs(config, scriptDir));
  }

  console.log('\nCompleted self-hosting apply workflow.');
}

main();
