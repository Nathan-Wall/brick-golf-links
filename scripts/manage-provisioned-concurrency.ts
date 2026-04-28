#!/usr/bin/env node

import { closeSync, openSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

type CommandName = 'up' | 'down' | 'status' | '_sleep-then-down' | '-h' | '--help' | 'help';

interface Config {
  readonly region: string;
  readonly stackName: string;
  readonly functionLogicalIdPrefix: string;
  readonly functionAlias: string;
  readonly surgeProvisionedConcurrency: number;
  readonly baselineProvisionedConcurrency: number;
  readonly waitTimeoutSeconds: number;
  readonly stateDir: string;
  readonly wrapperPath: string;
  readonly pidFile: string;
  readonly metaFile: string;
  readonly logFile: string;
}

interface ScheduledDownMeta {
  readonly target: number;
  readonly durationLabel: string;
  readonly runAtEpoch: number;
}

interface ProvisionedConcurrencyConfig {
  readonly RequestedProvisionedConcurrentExecutions: number;
  readonly AvailableProvisionedConcurrentExecutions?: number;
  readonly AllocatedProvisionedConcurrentExecutions?: number;
  readonly Status: string;
  readonly StatusReason?: string;
  readonly LastModified?: string;
}

interface AwsJsonResult<T> {
  readonly value: T | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface UpArguments {
  readonly target: number;
  readonly durationLabel: string | null;
  readonly durationSeconds: number | null;
}

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);

function usage(): string {
  return `Usage:
  scripts/manage-provisioned-concurrency.sh up [count]
  scripts/manage-provisioned-concurrency.sh up [count] DURATION
  scripts/manage-provisioned-concurrency.sh down
  scripts/manage-provisioned-concurrency.sh status

Examples:
  scripts/manage-provisioned-concurrency.sh up
  scripts/manage-provisioned-concurrency.sh up 2h
  scripts/manage-provisioned-concurrency.sh up 50
  scripts/manage-provisioned-concurrency.sh up 50 2h
  scripts/manage-provisioned-concurrency.sh down
  scripts/manage-provisioned-concurrency.sh status

Environment overrides:
  AWS_REGION                         Default: us-east-2
  STACK_NAME                         Default: GoLinksAppStack
  FUNCTION_LOGICAL_ID                Default: GoLinksFunction
  FUNCTION_ALIAS                     Default: live
  SURGE_PROVISIONED_CONCURRENCY      Default: 40
  BASELINE_PROVISIONED_CONCURRENCY   Default: 0
  WAIT_TIMEOUT_SECONDS               Default: 600

Notes:
  - Requires aws CLI credentials for the target account.
  - Assumes the stack has a published Lambda alias for the app function.
  - "down" deletes provisioned concurrency when the baseline is 0.
  - Timed "up" schedules a best-effort local background "down" on this machine.`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseNonNegativeInt(value: string | undefined, label: string, fallback: number): number {
  const raw = value ?? String(fallback);
  if (!/^\d+$/.test(raw)) {
    fail(`Invalid ${label}: ${raw}`);
  }
  return Number(raw);
}

function loadConfig(): Config {
  const region = process.env.AWS_REGION ?? 'us-east-2';
  const stackName = process.env.STACK_NAME ?? 'GoLinksAppStack';
  const functionLogicalIdPrefix = process.env.FUNCTION_LOGICAL_ID ?? 'GoLinksFunction';
  const functionAlias = process.env.FUNCTION_ALIAS ?? 'live';
  const surgeProvisionedConcurrency = parseNonNegativeInt(
    process.env.SURGE_PROVISIONED_CONCURRENCY,
    'SURGE_PROVISIONED_CONCURRENCY',
    40
  );
  const baselineProvisionedConcurrency = parseNonNegativeInt(
    process.env.BASELINE_PROVISIONED_CONCURRENCY,
    'BASELINE_PROVISIONED_CONCURRENCY',
    0
  );
  const waitTimeoutSeconds = parseNonNegativeInt(process.env.WAIT_TIMEOUT_SECONDS, 'WAIT_TIMEOUT_SECONDS', 600);
  const stateDir = process.env.STATE_DIR ?? join(process.env.TMPDIR ?? '/tmp', 'go-links-provisioned-concurrency');
  const wrapperPath = join(scriptDir, 'manage-provisioned-concurrency.sh');
  const stateKey = `${stackName}-${functionAlias}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const pidFile = join(stateDir, `${stateKey}.pid`);
  const metaFile = join(stateDir, `${stateKey}.meta`);
  const logFile = join(stateDir, `${stateKey}.log`);

  mkdirSync(stateDir, { recursive: true });

  return {
    region,
    stackName,
    functionLogicalIdPrefix,
    functionAlias,
    surgeProvisionedConcurrency,
    baselineProvisionedConcurrency,
    waitTimeoutSeconds,
    stateDir,
    wrapperPath,
    pidFile,
    metaFile,
    logFile,
  };
}

function requireAwsCli(): void {
  const result = spawnSync('aws', ['--version'], { encoding: 'utf8' });
  const error = result.error as NodeJS.ErrnoException | undefined;
  if (error?.code === 'ENOENT') {
    fail('Missing required command: aws');
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    fail(stderr ? `Unable to run aws CLI: ${stderr}` : 'Unable to run aws CLI.');
  }
}

function runAws<T>(args: string[], options?: { allowFailure?: (stderr: string, stdout: string) => boolean }): AwsJsonResult<T> {
  const result = spawnSync('aws', args, { encoding: 'utf8' });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const error = result.error as NodeJS.ErrnoException | undefined;

  if (error?.code === 'ENOENT') {
    fail('Missing required command: aws');
  }

  if (result.status !== 0) {
    if (options?.allowFailure?.(stderr, stdout)) {
      return { value: null, stdout, stderr };
    }

    const failureMessage = stderr.trim() || stdout.trim() || `aws ${args[0]} failed`;
    throw new Error(failureMessage);
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return { value: null, stdout, stderr };
  }

  return { value: JSON.parse(trimmed) as T, stdout, stderr };
}

function isProvisionedConcurrencyMissing(stderr: string, stdout: string): boolean {
  const output = `${stderr}\n${stdout}`;
  return (
    output.includes('ProvisionedConcurrencyConfigNotFoundException') ||
    output.includes('Requested resource not found') ||
    output.includes('Cannot find alias')
  );
}

function sanitizePid(rawValue: string): number | null {
  if (!/^\d+$/.test(rawValue.trim())) {
    return null;
  }
  return Number(rawValue.trim());
}

function readScheduledDownMeta(config: Config): ScheduledDownMeta | null {
  try {
    const raw = readFileSync(config.metaFile, 'utf8').trim();
    if (!raw) {
      return null;
    }

    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Partial<ScheduledDownMeta>;
      if (
        typeof parsed.target === 'number' &&
        typeof parsed.durationLabel === 'string' &&
        typeof parsed.runAtEpoch === 'number'
      ) {
        return {
          target: parsed.target,
          durationLabel: parsed.durationLabel,
          runAtEpoch: parsed.runAtEpoch,
        };
      }
      return null;
    }

    const values = new Map<string, string>();
    for (const line of raw.split('\n')) {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }
      values.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
    }

    const target = Number(values.get('target'));
    const durationLabel = values.get('duration') ?? '';
    const runAtEpoch = Number(values.get('run_at_epoch'));

    if (!Number.isFinite(target) || !Number.isFinite(runAtEpoch) || durationLabel.length === 0) {
      return null;
    }

    return { target, durationLabel, runAtEpoch };
  } catch {
    return null;
  }
}

function cleanupTimerState(config: Config): void {
  rmSync(config.pidFile, { force: true });
  rmSync(config.metaFile, { force: true });
}

function killPidIfRunning(pid: number): void {
  try {
    process.kill(pid, 0);
  } catch {
    return;
  }

  try {
    process.kill(pid);
  } catch {
    // Ignore races where the timer process exits between checks.
  }
}

function cancelScheduledDown(config: Config): void {
  try {
    const pid = sanitizePid(readFileSync(config.pidFile, 'utf8'));
    if (pid !== null) {
      killPidIfRunning(pid);
    }
  } catch {
    // No active timer file.
  }

  cleanupTimerState(config);
}

function recordScheduledDown(config: Config, meta: ScheduledDownMeta): void {
  writeFileSync(config.metaFile, `${JSON.stringify(meta, null, 2)}\n`);
}

function getStatus(config: Config, functionName: string): ProvisionedConcurrencyConfig | null {
  const result = runAws<ProvisionedConcurrencyConfig>(
    [
      'lambda',
      'get-provisioned-concurrency-config',
      '--region',
      config.region,
      '--function-name',
      functionName,
      '--qualifier',
      config.functionAlias,
      '--output',
      'json',
    ],
    { allowFailure: isProvisionedConcurrencyMissing }
  );

  return result.value;
}

function resolveFunctionName(config: Config): string {
  const resources = runAws<{
    StackResourceSummaries?: Array<{
      LogicalResourceId?: string;
      ResourceType?: string;
      PhysicalResourceId?: string;
    }>;
  }>([
    'cloudformation',
    'list-stack-resources',
    '--region',
    config.region,
    '--stack-name',
    config.stackName,
    '--output',
    'json',
  ]).value;

  const functionResource = resources?.StackResourceSummaries?.find(
    (resource) =>
      resource.ResourceType === 'AWS::Lambda::Function' &&
      typeof resource.LogicalResourceId === 'string' &&
      resource.LogicalResourceId.startsWith(config.functionLogicalIdPrefix) &&
      typeof resource.PhysicalResourceId === 'string'
  );

  if (!functionResource?.PhysicalResourceId) {
    fail(
      `Unable to find Lambda function in stack ${config.stackName} with logical id prefix ${config.functionLogicalIdPrefix}.\n` +
        'If you just added the alias support, deploy the app stack first.'
    );
  }

  return functionResource.PhysicalResourceId;
}

function printScheduledDownStatus(config: Config): void {
  const meta = readScheduledDownMeta(config);
  if (meta === null) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (meta.runAtEpoch <= now) {
    cleanupTimerState(config);
    return;
  }

  const eta = meta.runAtEpoch - now;
  console.log(
    `Scheduled fallback: baseline in ${eta}s (requested via ${meta.durationLabel}, target=${meta.target}).`
  );
}

function printStatus(config: Config, functionName: string): void {
  const status = getStatus(config, functionName);
  if (status === null) {
    console.log(`No provisioned concurrency configured for ${functionName}:${config.functionAlias}.`);
    printScheduledDownStatus(config);
    return;
  }

  console.log(JSON.stringify(status, null, 4));
  printScheduledDownStatus(config);
}

async function waitUntilReady(config: Config, functionName: string): Promise<void> {
  const startTime = Date.now();

  while (true) {
    const status = getStatus(config, functionName);
    if (status === null) {
      console.log('Provisioned concurrency config is absent.');
      return;
    }

    console.log(
      `Status: ${status.Status ?? 'unknown'} (requested=${status.RequestedProvisionedConcurrentExecutions ?? '?'}, available=${status.AvailableProvisionedConcurrentExecutions ?? '?'})`
    );

    if (status.Status === 'READY') {
      return;
    }

    if (status.Status === 'FAILED') {
      throw new Error(`Provisioned concurrency failed: ${status.StatusReason ?? 'unknown reason'}`);
    }

    if (Date.now() - startTime >= config.waitTimeoutSeconds * 1000) {
      throw new Error('Timed out waiting for provisioned concurrency to become READY.');
    }

    await sleepSeconds(5);
  }
}

async function setTargetConcurrency(config: Config, functionName: string, target: number): Promise<void> {
  console.log(`Setting provisioned concurrency for ${functionName}:${config.functionAlias} to ${target}...`);

  runAws([
    'lambda',
    'put-provisioned-concurrency-config',
    '--region',
    config.region,
    '--function-name',
    functionName,
    '--qualifier',
    config.functionAlias,
    '--provisioned-concurrent-executions',
    String(target),
    '--output',
    'json',
  ]);

  await waitUntilReady(config, functionName);
}

async function deleteConfig(config: Config, functionName: string): Promise<void> {
  console.log(`Deleting provisioned concurrency for ${functionName}:${config.functionAlias}...`);

  runAws(
    [
      'lambda',
      'delete-provisioned-concurrency-config',
      '--region',
      config.region,
      '--function-name',
      functionName,
      '--qualifier',
      config.functionAlias,
      '--output',
      'json',
    ],
    { allowFailure: isProvisionedConcurrencyMissing }
  );

  const startTime = Date.now();
  while (true) {
    const status = getStatus(config, functionName);
    if (status === null) {
      console.log('Provisioned concurrency removed.');
      return;
    }

    if (Date.now() - startTime >= config.waitTimeoutSeconds * 1000) {
      throw new Error('Timed out waiting for provisioned concurrency deletion.');
    }

    await sleepSeconds(5);
  }
}

async function applyDownAction(config: Config, functionName: string): Promise<void> {
  if (config.baselineProvisionedConcurrency === 0) {
    await deleteConfig(config, functionName);
    return;
  }

  await setTargetConcurrency(config, functionName, config.baselineProvisionedConcurrency);
  printStatus(config, functionName);
}

async function applyOverdueFallbackIfNeeded(config: Config, functionName: string): Promise<void> {
  const meta = readScheduledDownMeta(config);
  if (meta === null) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (meta.runAtEpoch > now) {
    return;
  }

  console.log('Scheduled fallback is overdue. Returning provisioned concurrency to baseline now...');
  await applyDownAction(config, functionName);
  cleanupTimerState(config);
}

function getTimerEnv(config: Config): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AWS_REGION: config.region,
    STACK_NAME: config.stackName,
    FUNCTION_LOGICAL_ID: config.functionLogicalIdPrefix,
    FUNCTION_ALIAS: config.functionAlias,
    SURGE_PROVISIONED_CONCURRENCY: String(config.surgeProvisionedConcurrency),
    BASELINE_PROVISIONED_CONCURRENCY: String(config.baselineProvisionedConcurrency),
    WAIT_TIMEOUT_SECONDS: String(config.waitTimeoutSeconds),
    STATE_DIR: config.stateDir,
  };
}

function scheduleTimedDown(
  config: Config,
  functionName: string,
  target: number,
  durationLabel: string,
  durationSeconds: number
): void {
  cancelScheduledDown(config);

  const runAtEpoch = Math.floor(Date.now() / 1000) + durationSeconds;
  recordScheduledDown(config, { target, durationLabel, runAtEpoch });

  const logFd = openSync(config.logFile, 'a');
  const child = spawn(config.wrapperPath, ['_sleep-then-down', functionName, String(durationSeconds)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: getTimerEnv(config),
  });
  closeSync(logFd);

  child.unref();

  if (typeof child.pid === 'number') {
    writeFileSync(config.pidFile, `${child.pid}\n`);
  }

  console.log(`Scheduled fallback to baseline in ${durationLabel}.`);
}

function parseDurationToSeconds(input: string): number {
  const durationPattern = /(\d+)([smhd])/g;
  let matchedLength = 0;
  let total = 0;

  for (const match of input.matchAll(durationPattern)) {
    matchedLength += match[0].length;
    const value = Number(match[1]);
    const unit = match[2];
    switch (unit) {
      case 's':
        total += value;
        break;
      case 'm':
        total += value * 60;
        break;
      case 'h':
        total += value * 3600;
        break;
      case 'd':
        total += value * 86400;
        break;
      default:
        fail(`Invalid duration: ${input}`);
    }
  }

  if (matchedLength !== input.length || total <= 0) {
    fail(`Invalid duration: ${input}`);
  }

  return total;
}

function isDurationArgument(value: string): boolean {
  return /^\d+[smhd](\d+[smhd])*$/.test(value);
}

function parseUpArguments(args: string[], config: Config): UpArguments {
  if (args.length === 0) {
    return {
      target: config.surgeProvisionedConcurrency,
      durationLabel: null,
      durationSeconds: null,
    };
  }

  if (args.length === 1) {
    if (/^\d+$/.test(args[0])) {
      const target = Number(args[0]);
      if (target <= 0) {
        fail(`Invalid concurrency target: ${args[0]}`);
      }
      return { target, durationLabel: null, durationSeconds: null };
    }

    if (!isDurationArgument(args[0])) {
      fail(`Invalid duration or target: ${args[0]}`);
    }

    return {
      target: config.surgeProvisionedConcurrency,
      durationLabel: args[0],
      durationSeconds: parseDurationToSeconds(args[0]),
    };
  }

  if (args.length === 2) {
    if (!/^\d+$/.test(args[0]) || Number(args[0]) <= 0) {
      fail(`Invalid concurrency target: ${args[0]}`);
    }

    if (!isDurationArgument(args[1])) {
      fail(`Invalid duration: ${args[1]}`);
    }

    return {
      target: Number(args[0]),
      durationLabel: args[1],
      durationSeconds: parseDurationToSeconds(args[1]),
    };
  }

  fail('Too many arguments for up.\n' + usage());
}

async function sleepSeconds(totalSeconds: number): Promise<void> {
  let remainingSeconds = totalSeconds;
  while (remainingSeconds > 0) {
    const nextSliceSeconds = Math.min(remainingSeconds, 3600);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, nextSliceSeconds * 1000);
    });
    remainingSeconds -= nextSliceSeconds;
  }
}

async function handleUp(config: Config, args: string[]): Promise<void> {
  requireAwsCli();
  const functionName = resolveFunctionName(config);
  await applyOverdueFallbackIfNeeded(config, functionName);
  const parsed = parseUpArguments(args, config);
  cancelScheduledDown(config);
  await setTargetConcurrency(config, functionName, parsed.target);
  if (parsed.durationLabel !== null && parsed.durationSeconds !== null) {
    scheduleTimedDown(config, functionName, parsed.target, parsed.durationLabel, parsed.durationSeconds);
  }
  printStatus(config, functionName);
}

async function handleDown(config: Config): Promise<void> {
  requireAwsCli();
  const functionName = resolveFunctionName(config);
  await applyOverdueFallbackIfNeeded(config, functionName);
  cancelScheduledDown(config);
  await applyDownAction(config, functionName);
}

async function handleStatus(config: Config): Promise<void> {
  requireAwsCli();
  const functionName = resolveFunctionName(config);
  await applyOverdueFallbackIfNeeded(config, functionName);
  printStatus(config, functionName);
}

async function handleSleepThenDown(config: Config, args: string[]): Promise<void> {
  requireAwsCli();
  const functionName = args[0];
  const durationSeconds = args[1];
  if (!functionName || !/^\d+$/.test(durationSeconds ?? '')) {
    fail('Missing function name or duration for timed fallback.');
  }

  await sleepSeconds(Number(durationSeconds));
  await handleTimedDown(config, [functionName]);
}

async function handleTimedDown(config: Config, args: string[]): Promise<void> {
  requireAwsCli();
  const functionName = args[0];
  if (!functionName) {
    fail('Missing function name for timed fallback.');
  }

  await applyDownAction(config, functionName);
  cleanupTimerState(config);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const [commandNameRaw, ...args] = process.argv.slice(2);
  const commandName = commandNameRaw as CommandName | undefined;

  switch (commandName) {
    case 'up':
      await handleUp(config, args);
      return;
    case 'down':
      await handleDown(config);
      return;
    case 'status':
      await handleStatus(config);
      return;
    case '_sleep-then-down':
      await handleSleepThenDown(config, args);
      return;
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      console.log(usage());
      if (commandName === undefined) {
        process.exitCode = 1;
      }
      return;
    default:
      fail(`Unknown command: ${commandName}\n${usage()}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
