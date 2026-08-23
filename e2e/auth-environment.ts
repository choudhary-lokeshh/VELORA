import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';

import { seedCohorts, type SeedCohort } from './seed.js';

/**
 * The stack the browser suite runs against.
 *
 * The Consumer Web session is an `HttpOnly`, `Secure`, `__Host-` cookie issued
 * by the API, so proving it works needs a real API, a real PostgreSQL, and a
 * real browser. This starts that stack before the browser tests and tears it
 * down afterwards. The cookie policy is the production one; nothing here weakens
 * an attribute to make a local run succeed.
 *
 * The API also runs with the development adapters the configuration schema
 * admits in local and test — filesystem media, the in-process RTC adapter, the
 * real block store for messaging eligibility, and an in-memory notification
 * channel. `packages/config/src/server.ts` refuses every one of them in staging
 * and production, and that refusal is asserted in its own suite. They are
 * enabled here for one reason: without them the browser cannot reach discovery,
 * introductions, messaging, calls, or safety at all, and a suite that stopped at
 * the profile step would leave the entire product unproved in a real browser.
 *
 * A worker runs beside the API, because media inspection and processing are its
 * work and a profile image never becomes ready without it.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = resolve(repositoryRoot, 'test-results/auth-environment.json');
const mediaDirectory = resolve(repositoryRoot, 'test-results/media');

export const authApiPort = 4100;
export const authApiBaseUrl = `http://127.0.0.1:${String(authApiPort)}`;
export const consumerWebOrigin = 'http://127.0.0.1:3000';
export const creatorStudioOrigin = 'http://127.0.0.1:3001';
export const platformAdminOrigin = 'http://127.0.0.1:3002';

/**
 * HMAC material for the development media adapter's delivery grants.
 *
 * A fixture, not a secret: the adapter it belongs to is refused outside local
 * and test, its addresses are deliberately unroutable, and nothing it signs is
 * honoured by anything real. It is a constant rather than a generated value
 * because two processes generating their own would reject each other's grants.
 */
const mediaSigningKey = 'velora-browser-suite-media-fixture-key';

/**
 * Which cohort a browser project owns.
 *
 * Fixed order rather than a hash, so a project always gets the same accounts and
 * a failure is reproducible by name. WebKit is deliberately absent: it cannot
 * hold a `Secure` cookie over plain-HTTP loopback and therefore skips every
 * product assertion, so seeding a cohort for it would be admitting four accounts
 * and processing four images that nothing then drives. A project with no cohort
 * of its own falls back to the first, which is only ever read by a test that is
 * being skipped.
 */
export const cohortOrder = ['chromium', 'firefox'] as const;

interface EnvironmentState {
  readonly apiPid: number;
  readonly cohorts: readonly SeedCohort[];
  readonly postgresId: string;
  readonly redisId: string;
  readonly workerPid: number;
}

function run(
  command: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<number> {
  return new Promise((settle, fail) => {
    const child = spawn(command, [...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    });
    child.once('error', fail);
    child.once('exit', (code) => {
      settle(code ?? 1);
    });
  });
}

async function waitForReadiness(deadlineMilliseconds = 60_000): Promise<void> {
  const deadline = Date.now() + deadlineMilliseconds;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${authApiBaseUrl}/v1/health/live`);
      if (response.ok) return;
      lastError = `status ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unknown error';
    }
    await new Promise((settle) => setTimeout(settle, 200));
  }
  throw new Error(`AUTH API never became live: ${lastError}`);
}

export async function startAuthEnvironment(): Promise<void> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:18.4-alpine3.24').start(),
    new GenericContainer('redis:8.10.0-alpine3.23')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections tcp'))
      .start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`;

  const migrated = await run('pnpm', ['db:migrate'], {
    DATABASE_URL: databaseUrl,
  });
  if (migrated !== 0)
    throw new Error('AUTH migration failed before browser tests');

  rmSync(mediaDirectory, { force: true, recursive: true });
  mkdirSync(mediaDirectory, { recursive: true });

  const backendEnvironment: Record<string, string> = {
    APP_ENV: 'test',
    AUTH_BROWSER_ORIGINS_CONSUMER_WEB: consumerWebOrigin,
    // Creator Studio is a separate audience with its own cookie, so it needs its
    // own approved origin. Without it AUTH refuses every Studio request before
    // it reaches a handler, which is the correct production behaviour and would
    // make the creator journey untestable rather than merely failing.
    AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: creatorStudioOrigin,
    /*
     * Platform Admin is allowed to *ask*, and nothing more.
     *
     * Admitting an origin lets a browser reach the session endpoint; it grants
     * no audience and no assurance, and every privileged route still refuses on
     * both counts. Without it AUTH rejects the console's request before it
     * arrives, and the browser suite could only ever observe a network failure
     * — which would prove that the origin is unconfigured rather than that the
     * platform refuses privileged access, and those are very different claims.
     */
    AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: platformAdminOrigin,
    DATABASE_URL: databaseUrl,
    EPHEMERAL_REDIS_URL: `${redisUrl}/0`,
    LOG_LEVEL: 'warn',
    MEDIA_DELIVERY_SIGNING_KEY: mediaSigningKey,
    MEDIA_LOCAL_STORAGE_DIRECTORY: mediaDirectory,
    MEDIA_MALWARE_SCANNER: 'local-test',
    MEDIA_STORAGE_PROVIDER: 'local-test',
    MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
    NOTIFICATIONS_DELIVERY_CHANNEL: 'local-test',
    QUEUE_REDIS_URL: `${redisUrl}/1`,
    REALTIME_CALL_ELIGIBILITY: 'composed',
    REALTIME_RTC_PROVIDER: 'local-test',
    SAFETY_APPEAL_POLICY: 'local-test',
  };

  const api: ChildProcess = spawn('bun', ['run', 'src/main.ts'], {
    cwd: resolve(repositoryRoot, 'apps/api'),
    env: {
      ...process.env,
      ...backendEnvironment,
      HOST: '127.0.0.1',
      PORT: String(authApiPort),
    },
    stdio: 'inherit',
  });
  api.once('error', (error) => {
    throw error;
  });

  const worker: ChildProcess = spawn('bun', ['run', 'src/worker.ts'], {
    cwd: resolve(repositoryRoot, 'apps/api'),
    env: { ...process.env, ...backendEnvironment },
    stdio: 'inherit',
  });
  worker.once('error', (error) => {
    throw error;
  });

  await waitForReadiness();

  const cohorts = await seedCohorts({
    apiBaseUrl: authApiBaseUrl,
    backendEnvironment,
    cohorts: cohortOrder.length,
    origin: consumerWebOrigin,
    repositoryRoot,
    runId: String(Date.now()),
  });

  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify({
      apiPid: api.pid ?? 0,
      cohorts,
      postgresId: postgres.getId(),
      redisId: redis.getId(),
      workerPid: worker.pid ?? 0,
    } satisfies EnvironmentState),
    'utf8',
  );
}

/**
 * The cohort a project drives.
 *
 * Every project gets its own accounts, because every interesting assertion in
 * the product suite mutates something and a shared cohort would make one
 * project's result depend on what another had already done.
 */
export function cohortFor(project: string): SeedCohort {
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as EnvironmentState;
  const index = cohortOrder.indexOf(project as (typeof cohortOrder)[number]);
  const cohort = state.cohorts[index === -1 ? 0 : index];
  if (cohort === undefined) {
    throw new Error(`no seeded cohort for project ${project}`);
  }
  return cohort;
}

export async function stopAuthEnvironment(): Promise<void> {
  let state: EnvironmentState;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8')) as EnvironmentState;
  } catch {
    return;
  }
  for (const pid of [state.apiPid, state.workerPid]) {
    if (pid <= 0) continue;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  for (const container of [state.postgresId, state.redisId]) {
    await run('docker', ['rm', '--force', container], {});
  }
  rmSync(stateFile, { force: true });
  rmSync(mediaDirectory, { force: true, recursive: true });
}
