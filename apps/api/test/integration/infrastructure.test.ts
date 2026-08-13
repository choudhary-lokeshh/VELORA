import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServerConfig } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import { Queue } from 'bullmq';

import { createApplication } from '../../src/application.js';
import { RedisHealthService } from '../../src/cache/redis.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { bullMqConnectionFromUrl } from '../../src/jobs/connection.js';
import { JobRegistry, type JobRegistration } from '../../src/jobs/registry.js';
import {
  createQueue,
  createWorkerRuntime,
  defaultOptionsForJob,
} from '../../src/jobs/runtime.js';

const applicationRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);

function logger(): SafeLogger {
  const discard = () => undefined;
  return {
    debug: discard,
    error: discard,
    fatal: discard,
    info: discard,
    trace: discard,
    warn: discard,
  };
}

function testConfig(databaseUrl: string, redisUrl: string): ServerConfig {
  return {
    APP_ENV: 'test',
    DATABASE_URL: databaseUrl,
    EPHEMERAL_REDIS_URL: `${redisUrl}/0`,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    PORT: 4000,
    QUEUE_REDIS_URL: `${redisUrl}/1`,
  };
}

async function runCommand(
  command: readonly string[],
  environment: Record<string, string>,
) {
  const process = Bun.spawn([...command], {
    cwd: applicationRoot,
    env: { ...Bun.env, ...environment },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMilliseconds = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(50);
  }
  throw new Error('Timed out waiting for integration condition');
}

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for integration tests`);
  }
  return value;
}

const config = testConfig(
  requiredEnvironment('TEST_DATABASE_URL'),
  requiredEnvironment('TEST_REDIS_URL'),
);
const redisContainerId = requiredEnvironment('TEST_REDIS_CONTAINER_ID');

describe('real PostgreSQL, Redis, and BullMQ foundation', () => {
  it('runs actual migration command twice and creates no product tables', async () => {
    const first = await runCommand(
      ['bun', 'run', 'scripts/migrate-database.ts'],
      {
        DATABASE_URL: config.DATABASE_URL,
      },
    );
    const second = await runCommand(
      ['bun', 'run', 'scripts/migrate-database.ts'],
      {
        DATABASE_URL: config.DATABASE_URL,
      },
    );
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);

    const sql = new Bun.SQL(config.DATABASE_URL, { max: 1 });
    try {
      const tables = await sql<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
      `;
      expect(tables).toEqual([]);

      await sql`create temporary table constraint_probe (id integer primary key)`;
      await sql`insert into constraint_probe (id) values (1)`;
      let constraintRejected = false;
      try {
        await sql`insert into constraint_probe (id) values (1)`;
      } catch {
        constraintRejected = true;
      }
      expect(constraintRejected).toBe(true);
    } finally {
      await sql.close();
    }
  });

  it('propagates actual migration CLI failure without leaking credentials', async () => {
    const result = await runCommand(
      ['bun', 'run', 'scripts/migrate-database.ts'],
      {
        DATABASE_URL:
          'postgresql://migration-user:migration-secret@127.0.0.1:1/velora',
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain('migration-secret');
  });

  it('reports ready only when PostgreSQL and both Redis responsibilities respond', async () => {
    const application = createApplication({ config });
    try {
      const response = await application.app.handle(
        new Request('http://api.test/v1/health/ready'),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        dependencies: {
          ephemeralRedis: 'up',
          postgres: 'up',
          queueRedis: 'up',
        },
        status: 'ready',
      });
    } finally {
      await application.close();
    }
  });

  it('enqueues, processes, retries, delays, fails, and restarts workers', async () => {
    let transientAttempts = 0;
    let processed = 0;
    const registry = new JobRegistry();
    const registration: JobRegistration<{ mode: string }> = {
      handler: (payload) => {
        if (payload.mode === 'transient' && transientAttempts++ === 0) {
          return Promise.reject(new Error('transient failure'));
        }
        if (payload.mode === 'permanent') {
          return Promise.reject(new Error('permanent failure'));
        }
        processed += 1;
        return Promise.resolve();
      },
      name: 'bootstrap.probe.v1',
      queue: 'bootstrap-probe',
      retry: { attempts: 2, backoffMilliseconds: 100 },
      validate: {
        parse(input) {
          if (
            typeof input !== 'object' ||
            input === null ||
            !('mode' in input) ||
            typeof input.mode !== 'string'
          ) {
            throw new Error('Invalid probe payload');
          }
          return { mode: input.mode };
        },
      },
      version: 1,
    };
    registry.register(registration);
    const queue = createQueue(config, registration.queue, registration);
    const runtime = await createWorkerRuntime(config, registry, logger());
    try {
      const success = await queue.add(registration.name, { mode: 'success' });
      const transient = await queue.add(
        registration.name,
        { mode: 'transient' },
        defaultOptionsForJob(registration),
      );
      const delayed = await queue.add(
        registration.name,
        { mode: 'delayed' },
        { ...defaultOptionsForJob(registration), delay: 200 },
      );
      const permanent = await queue.add(
        registration.name,
        { mode: 'permanent' },
        defaultOptionsForJob(registration),
      );

      await waitFor(async () => (await success.getState()) === 'completed');
      await waitFor(async () => (await transient.getState()) === 'completed');
      await waitFor(async () => (await delayed.getState()) === 'completed');
      await waitFor(async () => (await permanent.getState()) === 'failed');
      if (transient.id === undefined || permanent.id === undefined) {
        throw new Error('BullMQ did not assign job identifiers');
      }
      expect((await queue.getJob(transient.id))?.attemptsMade).toBe(2);
      expect((await queue.getJob(permanent.id))?.attemptsMade).toBe(2);
      expect(processed).toBe(3);
    } finally {
      await runtime.close();
    }

    const afterRestart = await queue.add(registration.name, {
      mode: 'after-restart',
    });
    const restarted = await createWorkerRuntime(config, registry, logger());
    try {
      await waitFor(
        async () => (await afterRestart.getState()) === 'completed',
      );
      expect(processed).toBe(4);
    } finally {
      await restarted.close();
      await queue.close();
    }
  });

  it('rejects queue startup promptly when Redis is unavailable', async () => {
    const registry = new JobRegistry();
    registry.register({
      handler: () => Promise.resolve(),
      name: 'bootstrap.probe.v1',
      queue: 'bootstrap-probe',
      retry: { attempts: 1, backoffMilliseconds: 10 },
      validate: { parse: () => ({}) },
      version: 1,
    });
    let startupError: unknown;
    try {
      await createWorkerRuntime(
        { ...config, QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1' },
        registry,
        logger(),
      );
    } catch (error) {
      startupError = error;
    }
    expect(startupError).toBeInstanceOf(Error);
  });

  it('boots and gracefully stops actual API entrypoint', async () => {
    const process = Bun.spawn(['bun', 'run', 'src/main.ts'], {
      cwd: applicationRoot,
      env: {
        ...Bun.env,
        APP_ENV: 'test',
        DATABASE_URL: config.DATABASE_URL,
        EPHEMERAL_REDIS_URL: config.EPHEMERAL_REDIS_URL,
        HOST: '127.0.0.1',
        LOG_LEVEL: 'info',
        PORT: '41987',
        QUEUE_REDIS_URL: config.QUEUE_REDIS_URL,
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });
    let output = '';
    let errorOutput = '';
    const readOutput = (async () => {
      const decoder = new TextDecoder();
      for await (const value of process.stdout) {
        output += decoder.decode(value, { stream: true });
      }
    })();
    const readErrorOutput = (async () => {
      const decoder = new TextDecoder();
      for await (const value of process.stderr) {
        errorOutput += decoder.decode(value, { stream: true });
      }
    })();
    await Promise.race([
      waitFor(async () => Promise.resolve(output.includes('API started'))),
      process.exited.then((code) => {
        throw new Error(
          `API exited before ready (${String(code)}): ${errorOutput}`,
        );
      }),
    ]);
    process.kill('SIGTERM');
    const [exitCode] = await Promise.all([
      process.exited,
      readOutput,
      readErrorOutput,
    ]);
    expect(exitCode).toBe(0);
    expect(output).toContain('API started');
    expect(output).toContain('API shutdown requested');
    expect(errorOutput).toBe('');
  });

  it('boots and gracefully stops actual worker entrypoint', async () => {
    const process = Bun.spawn(['bun', 'run', 'src/worker.ts'], {
      cwd: applicationRoot,
      env: {
        ...Bun.env,
        APP_ENV: 'test',
        DATABASE_URL: config.DATABASE_URL,
        EPHEMERAL_REDIS_URL: config.EPHEMERAL_REDIS_URL,
        LOG_LEVEL: 'info',
        QUEUE_REDIS_URL: config.QUEUE_REDIS_URL,
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });
    let output = '';
    let errorOutput = '';
    const readOutput = (async () => {
      const decoder = new TextDecoder();
      for await (const value of process.stdout) {
        output += decoder.decode(value, { stream: true });
      }
    })();
    const readErrorOutput = (async () => {
      const decoder = new TextDecoder();
      for await (const value of process.stderr) {
        errorOutput += decoder.decode(value, { stream: true });
      }
    })();
    await Promise.race([
      waitFor(async () => Promise.resolve(output.includes('worker started'))),
      process.exited.then((code) => {
        throw new Error(
          `worker exited before ready (${String(code)}): ${errorOutput}`,
        );
      }),
    ]);
    process.kill('SIGTERM');
    const [exitCode] = await Promise.all([
      process.exited,
      readOutput,
      readErrorOutput,
    ]);
    expect(exitCode).toBe(0);
    expect(output).toContain('worker started');
    expect(output).toContain('worker shutdown requested');
    expect(errorOutput).toBe('');
  });

  it('actual worker entrypoint fails promptly and safely without Redis', async () => {
    const result = await runCommand(['bun', 'run', 'src/worker.ts'], {
      APP_ENV: 'test',
      DATABASE_URL: config.DATABASE_URL,
      EPHEMERAL_REDIS_URL: config.EPHEMERAL_REDIS_URL,
      LOG_LEVEL: 'silent',
      QUEUE_REDIS_URL: 'redis://queue-user:queue-secret@127.0.0.1:1/1',
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('worker startup or shutdown failed');
    expect(result.stderr).not.toContain('queue-secret');
  });

  it('actual worker entrypoint rejects invalid configuration safely', async () => {
    const result = await runCommand(['bun', 'run', 'src/worker.ts'], {
      APP_ENV: 'test',
      DATABASE_URL:
        'postgresql://database-user:database-secret@127.0.0.1:1/velora',
      EPHEMERAL_REDIS_URL: config.EPHEMERAL_REDIS_URL,
      LOG_LEVEL: 'silent',
      QUEUE_REDIS_URL: 'https://queue-user:queue-secret@127.0.0.1:1/1',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('worker startup or shutdown failed');
    expect(result.stderr).not.toContain('database-secret');
    expect(result.stderr).not.toContain('queue-secret');
  });

  it('recovers health and retains queued work across a Redis restart', async () => {
    const queueName = 'durability-probe';
    const queue = new Queue(queueName, {
      connection: bullMqConnectionFromUrl(config.QUEUE_REDIS_URL),
    });
    const health = new RedisHealthService(
      config.EPHEMERAL_REDIS_URL,
      'ephemeral-readiness',
    );
    let containerStopped = false;
    try {
      const job = await queue.add('durability.probe.v1', { durable: true });
      if (job.id === undefined) throw new Error('BullMQ did not assign job ID');
      const jobId = job.id;
      await queue.disconnect();

      await waitFor(async () => health.isReady());
      expect(await health.isReady()).toBe(true);
      const stop = await runCommand(
        ['docker', 'stop', '--time', '1', redisContainerId],
        {},
      );
      containerStopped = stop.exitCode === 0;
      expect(stop.exitCode).toBe(0);
      expect(await health.isReady()).toBe(false);

      const start = await runCommand(['docker', 'start', redisContainerId], {});
      if (start.exitCode === 0) containerStopped = false;
      expect(start.exitCode).toBe(0);
      await waitFor(async () => {
        const ping = await runCommand(
          ['docker', 'exec', redisContainerId, 'redis-cli', 'ping'],
          {},
        );
        return ping.exitCode === 0 && ping.stdout.trim() === 'PONG';
      });
      await waitFor(async () => health.isReady());
      expect(await health.isReady()).toBe(true);

      const exists = await runCommand(
        [
          'docker',
          'exec',
          redisContainerId,
          'redis-cli',
          '-n',
          '1',
          'exists',
          `bull:${queueName}:${jobId}`,
        ],
        {},
      );
      expect(exists.exitCode).toBe(0);
      expect(exists.stdout.trim()).toBe('1');
    } finally {
      if (containerStopped) {
        await runCommand(['docker', 'start', redisContainerId], {});
      }
      await Promise.all([health.close(), queue.disconnect()]);
    }
  });

  it('distinguishes ephemeral Redis outage from queue Redis durability', async () => {
    const unavailable = new RedisHealthService(
      'redis://127.0.0.1:1/0',
      'ephemeral-readiness',
    );
    const database = new DatabaseService(config);
    try {
      expect(await unavailable.isReady()).toBe(false);
      expect(await database.isReady()).toBe(true);
    } finally {
      await Promise.all([unavailable.close(), database.close()]);
    }
  });
});
