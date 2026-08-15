import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';

/**
 * Browser AUTH end-to-end support.
 *
 * The Consumer Web session is an `HttpOnly`, `Secure`, `__Host-` cookie issued
 * by the API, so proving it works needs a real API, a real PostgreSQL, and a
 * real browser. This starts that stack before the browser tests and tears it
 * down afterwards. The cookie policy is the production one; nothing here
 * weakens an attribute to make a local run succeed.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = resolve(repositoryRoot, 'test-results/auth-environment.json');

export const authApiPort = 4100;
export const authApiBaseUrl = `http://127.0.0.1:${String(authApiPort)}`;
export const consumerWebOrigin = 'http://127.0.0.1:3000';
export const creatorStudioOrigin = 'http://127.0.0.1:3001';

interface EnvironmentState {
  readonly apiPid: number;
  readonly postgresId: string;
  readonly redisId: string;
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

  const api: ChildProcess = spawn('bun', ['run', 'src/main.ts'], {
    cwd: resolve(repositoryRoot, 'apps/api'),
    env: {
      ...process.env,
      APP_ENV: 'test',
      AUTH_BROWSER_ORIGINS_CONSUMER_WEB: consumerWebOrigin,
      // Creator Studio is a separate audience with its own cookie, so it needs
      // its own approved origin. Without it AUTH refuses every Studio request
      // before it reaches a handler, which is the correct production behaviour
      // and would make the creator journey untestable rather than merely
      // failing.
      AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: creatorStudioOrigin,
      DATABASE_URL: databaseUrl,
      EPHEMERAL_REDIS_URL: `${redisUrl}/0`,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      PORT: String(authApiPort),
      QUEUE_REDIS_URL: `${redisUrl}/1`,
    },
    stdio: 'inherit',
  });
  api.once('error', (error) => {
    throw error;
  });

  await waitForReadiness();

  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify({
      apiPid: api.pid ?? 0,
      postgresId: postgres.getId(),
      redisId: redis.getId(),
    } satisfies EnvironmentState),
    'utf8',
  );
}

export async function stopAuthEnvironment(): Promise<void> {
  let state: EnvironmentState;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8')) as EnvironmentState;
  } catch {
    return;
  }
  if (state.apiPid > 0) {
    try {
      process.kill(state.apiPid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  for (const container of [state.postgresId, state.redisId]) {
    await run('docker', ['rm', '--force', container], {});
  }
  rmSync(stateFile, { force: true });
}
