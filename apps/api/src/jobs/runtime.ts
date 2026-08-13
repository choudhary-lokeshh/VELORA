import {
  Queue,
  Worker,
  type Job,
  type JobsOptions,
  type WorkerOptions,
} from 'bullmq';
import type { ServerConfig } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import Redis from 'ioredis';

import { bullMqConnectionFromUrl } from './connection.js';
import type { JobRegistration, JobRegistry } from './registry.js';

const workerShutdownTimeoutMilliseconds = 30_000;

async function assertQueueRedisReady(url: string): Promise<void> {
  const client = new Redis(url, {
    connectTimeout: 1_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
  } finally {
    if (client.status === 'ready') await client.quit();
    else client.disconnect(false);
  }
}

export interface WorkerRuntime {
  close(): Promise<void>;
  readonly completion: Promise<void>;
  readonly workers: readonly Worker[];
}

export async function closeWorkers(
  workers: readonly Pick<Worker, 'close'>[],
  timeoutMilliseconds = workerShutdownTimeoutMilliseconds,
): Promise<void> {
  await Promise.race([
    Promise.all(workers.map(async (worker) => worker.close())).then(
      () => undefined,
    ),
    rejectAfter(timeoutMilliseconds, 'BullMQ worker shutdown timed out'),
  ]);
}

export function defaultOptionsForJob<Payload>(
  registration: JobRegistration<Payload>,
): JobsOptions {
  return {
    attempts: registration.retry.attempts,
    backoff: {
      delay: registration.retry.backoffMilliseconds,
      type: 'exponential',
    },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: false,
  };
}

async function processRegisteredJob(
  job: Job,
  registry: JobRegistry,
): Promise<void> {
  const registration = registry.get(job.name);
  if (registration?.queue !== job.queueName) {
    throw new Error(`Unregistered job: ${job.queueName}/${job.name}`);
  }
  const payload = registration.validate.parse(job.data);
  await registration.handler(payload, job);
}

function rejectAfter(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, milliseconds);
    timer.unref();
  });
}

export async function createWorkerRuntime(
  config: ServerConfig,
  registry: JobRegistry,
  logger: SafeLogger,
  workerOptions: Partial<WorkerOptions> = {},
): Promise<WorkerRuntime> {
  await assertQueueRedisReady(config.QUEUE_REDIS_URL);
  const connection = bullMqConnectionFromUrl(config.QUEUE_REDIS_URL);
  const workers = registry.queueNames().map(
    (queueName) =>
      new Worker(
        queueName,
        async (job) => processRegisteredJob(job, registry),
        {
          autorun: false,
          connection,
          concurrency: 4,
          lockDuration: 30_000,
          maxStalledCount: 1,
          stalledInterval: 30_000,
          ...workerOptions,
        },
      ),
  );

  for (const worker of workers) {
    worker.on('error', (error) => {
      logger.error({ error, queue: worker.name }, 'BullMQ worker error');
    });
    worker.on('failed', (job, error) => {
      logger.warn(
        {
          attemptsMade: job?.attemptsMade,
          error,
          jobId: job?.id,
          jobName: job?.name,
          queue: worker.name,
        },
        'BullMQ job failed',
      );
    });
  }

  let closing = false;
  const runPromises = workers.map(async (worker) => worker.run());
  const completion = Promise.race(runPromises).then(() => {
    if (!closing && workers.length > 0) {
      throw new Error('BullMQ worker stopped unexpectedly');
    }
  });

  try {
    await Promise.all(
      workers.map(async (worker) =>
        Promise.race([
          worker.waitUntilReady(),
          rejectAfter(5_000, `BullMQ worker ${worker.name} startup timed out`),
        ]),
      ),
    );
  } catch (error) {
    closing = true;
    await Promise.allSettled(workers.map(async (worker) => worker.close(true)));
    throw error;
  }

  return {
    completion,
    workers,
    async close() {
      closing = true;
      await closeWorkers(workers);
    },
  };
}

export function createQueue<Payload>(
  config: ServerConfig,
  queueName: string,
  registration?: JobRegistration<Payload>,
): Queue {
  return new Queue(queueName, {
    connection: bullMqConnectionFromUrl(config.QUEUE_REDIS_URL),
    defaultJobOptions:
      registration === undefined
        ? { removeOnComplete: true, removeOnFail: false }
        : defaultOptionsForJob(registration),
  });
}
