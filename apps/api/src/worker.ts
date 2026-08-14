import type { Queue } from 'bullmq';
import { loadServerConfig, type ServerConfig } from '@velora/config/server';
import {
  createLogger,
  redactEmbeddedUrls,
  type SafeLogger,
} from '@velora/observability/server';

import { DatabaseService } from './database/database.service.js';
import { discoveryOutbox } from './discovery/schema.js';
import { OutboxRepository } from './events/outbox.js';
import {
  OutboxRelay,
  outboxRelayIntervalMilliseconds,
} from './events/relay.js';
import { Poller } from './jobs/poller.js';
import { JobRegistry } from './jobs/registry.js';
import { createQueue, createWorkerRuntime } from './jobs/runtime.js';
import { messagingOutbox } from './messaging/schema.js';
import { createNotificationsRuntime } from './notifications/composition.js';
import {
  createNotificationWake,
  notificationsQueueName,
  registerNotificationJobs,
} from './notifications/jobs.js';
import { deliverySweepIntervalMilliseconds } from './notifications/policy.js';
import { SafetyDirectory } from './safety/directory.js';
import { SafetyRepository } from './safety/repository.js';
import { UsersRepository } from './users/repository.js';
import { ConsumerStanding } from './users/standing.js';

/**
 * The background half of the platform.
 *
 * Two loops run here, and between them they are why a committed business event
 * cannot lose the notification it owes.
 *
 * The relay drains each producer's transactional outbox. The fact was written
 * by the same transaction as the business row, so it is already durable before
 * this process sees it; the relay's job is to turn it into a notification
 * intent, which is durable too. Killing this process at any point in that
 * sequence loses nothing: leases expire, rows stay claimable, and the next
 * cycle resumes.
 *
 * The delivery sweep claims notices that are due and sends them — after
 * re-reading, inside the claiming transaction, whether the recipient may still
 * be told. A queue wake-up usually gets there first and does exactly the same
 * work; the sweep is what makes the queue optional rather than load-bearing.
 */

export interface WorkerComposition {
  close(): Promise<void>;
  readonly deliverySweep: Poller;
  readonly relay: OutboxRelay;
  readonly relayPoller: Poller;
  readonly registry: JobRegistry;
  /** Runs both loops once. Used at startup so a restart drains immediately. */
  drainOnce(): Promise<void>;
}

/**
 * Builds the worker's durable-work composition.
 *
 * It constructs the published contracts it consumes — TRUST & SAFETY's
 * eligibility answer and USERS' account standing — directly from their own
 * repositories rather than building HTTP runtimes it has no use for. Those are
 * the same classes the API composes; what a worker does not need is routes.
 */
export function createWorkerComposition(input: {
  readonly config: ServerConfig;
  readonly database: DatabaseService;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  readonly queue: Queue;
}): WorkerComposition {
  const now = input.now ?? (() => new Date());
  const handle = input.database.database;
  const owner = `worker-${crypto.randomUUID()}`;
  // The worker owns its own pool, so it owns its own bound. Everything below
  // that reaches PostgreSQL does so inside one admitted unit: a relay cycle, a
  // delivery sweep, or one queued job. Together with BullMQ's own concurrency
  // this keeps the worker's peak demand under the pool, which is the condition
  // the driver defect needs in order not to happen.
  const admit = async <T>(work: () => Promise<T>): Promise<T> =>
    input.database.admission.run(work);

  const notifications = createNotificationsRuntime({
    config: input.config,
    database: handle,
    logger: input.logger,
    now,
    owner,
    safety: new SafetyDirectory(new SafetyRepository(handle)),
    standing: new ConsumerStanding(new UsersRepository(handle)),
    wake: createNotificationWake(input.queue),
  });

  const relay = new OutboxRelay({
    consumers: notifications.intakes,
    logger: input.logger,
    now,
    owner,
    // One relay, one outbox per producing domain. The table belongs to the
    // domain whose transaction writes it; the relay is the only thing that
    // reads either, and it hands facts to consumers rather than granting
    // anybody access to a source table.
    sources: [
      {
        producer: 'discovery',
        repository: new OutboxRepository(handle, discoveryOutbox),
      },
      {
        producer: 'messaging',
        repository: new OutboxRepository(handle, messagingOutbox),
      },
    ],
  });

  const registry = new JobRegistry();
  registerNotificationJobs(registry, notifications.delivery, admit);

  const relayPoller = new Poller({
    cycle: async () => admit(async () => relay.dispatchOnce()),
    intervalMilliseconds: outboxRelayIntervalMilliseconds,
    logger: input.logger,
    name: 'outbox-relay',
  });
  const deliverySweep = new Poller({
    cycle: async () => admit(async () => notifications.delivery.deliverDue()),
    intervalMilliseconds: deliverySweepIntervalMilliseconds,
    logger: input.logger,
    name: 'notification-delivery-sweep',
  });

  return {
    async close() {
      await Promise.all([relayPoller.stop(), deliverySweep.stop()]);
    },
    deliverySweep,
    async drainOnce() {
      await relayPoller.runOnce();
      await deliverySweep.runOnce();
    },
    registry,
    relay,
    relayPoller,
  };
}

export async function runWorkerMain(): Promise<void> {
  const config = loadServerConfig(process.env);
  const logger = createLogger({
    level: config.LOG_LEVEL,
    serviceName: 'velora-worker',
  });

  const database = new DatabaseService(config);
  const queue = createQueue(config, notificationsQueueName);
  const composition = createWorkerComposition({
    config,
    database,
    logger,
    queue,
  });

  let runtime;
  try {
    // Same reason as the API: the pool is opened here rather than under the
    // startup drain, which is the busiest moment this process has.
    await database.warm();
    runtime = await createWorkerRuntime(config, composition.registry, logger);
  } catch (error) {
    // A startup that fails still owns a connection pool and a queue client, and
    // both hold the event loop open. Releasing them here is what makes an
    // unreachable dependency an immediate non-zero exit rather than a hang.
    await composition.close();
    await queue.close();
    await database.close();
    throw error;
  }
  const keepAlive = setInterval(() => undefined, 60_000);

  let shutdown: Promise<void> | undefined;
  const stop = (signal: string) => {
    shutdown ??= (async () => {
      logger.info({ signal }, 'worker shutdown requested');
      // Intake first, then the loops that claim work, then the connections
      // underneath them. A lease outliving this process is recoverable; a claim
      // taken against a closed pool is a needless error.
      await runtime.close();
      await composition.close();
      await queue.close();
      await database.close();
    })();
    return shutdown;
  };

  // Installed before any work begins. The startup drain can take as long as the
  // backlog it is clearing, and a supervisor that sends SIGTERM during it must
  // get the ordered shutdown above rather than the default handler's kill. The
  // pollers wait for whatever cycle is in flight, so a signal arriving mid-drain
  // ends the drain rather than abandoning it.
  const signalled = new Promise<void>((resolve, reject) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void stop(signal).then(resolve, reject);
      });
    }
  });

  // A restart is the moment a backlog is most likely: whatever the previous
  // process was holding is still leased, and whatever it never got to is still
  // due. Draining once before the timers begin means recovery does not wait for
  // the first interval.
  await composition.drainOnce();
  composition.relayPoller.start();
  composition.deliverySweep.start();

  // Announced once the process is actually doing its job, so a supervisor
  // reading this line knows the drain is done and the loops are running.
  logger.info(
    { registrations: composition.registry.list().length },
    'worker started',
  );

  try {
    await Promise.race([signalled, runtime.completion]);
  } finally {
    clearInterval(keepAlive);
  }
}

if (import.meta.main) {
  void runWorkerMain().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(
      `VELORA worker startup or shutdown failed: ${redactEmbeddedUrls(message)}\n`,
    );
    process.exitCode = 1;
  });
}
