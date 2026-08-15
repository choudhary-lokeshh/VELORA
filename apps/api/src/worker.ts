import type { Queue } from 'bullmq';
import { loadServerConfig, type ServerConfig } from '@velora/config/server';
import {
  createLogger,
  redactEmbeddedUrls,
  type SafeLogger,
} from '@velora/observability/server';

import {
  createBillingRuntime,
  type BillingRuntime,
} from './billing/composition.js';
import {
  entitlementGrantedEvent,
  entitlementRevokedEvent,
} from './billing/entitlement-events.js';
import { PayoutDisbursementIntake } from './billing/disbursement-intake.js';
import {
  revenueReversedEvent,
  revenueSettledEvent,
} from './billing/revenue-events.js';
import { billingOutbox } from './billing/schema.js';
import { ClubRepository } from './clubs/club-repository.js';
import { ClubCommercialDirectory } from './clubs/commercial.js';
import { billingEntitlementIntakes } from './clubs/entitlement-intake.js';
import { CreatorDirectory } from './creators/directory.js';
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
import {
  createPayoutsRuntime,
  type PayoutsRuntime,
} from './payouts/composition.js';
import { disbursementSettledEvent } from './payouts/disbursement-events.js';
import { billingRevenueIntakes } from './payouts/revenue-intake.js';
import { payoutsOutbox } from './payouts/schema.js';
import { SafetyDirectory } from './safety/directory.js';
import { SafetyRepository } from './safety/repository.js';
import { UsersRepository } from './users/repository.js';
import {
  ConsumerAdultStandingDirectory,
  ConsumerStanding,
} from './users/standing.js';

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

/**
 * How often ambiguous financial state is checked against provider truth.
 *
 * An operational constant rather than a commercial term. Frequent enough that a
 * lost answer is resolved long before a person notices it, and infrequent
 * enough that a provider is not asked about the same object continuously.
 */
export const financialReconciliationIntervalMilliseconds = 30_000;

/**
 * Starts every recurring cycle this worker composes.
 *
 * Named by type rather than one by one, deliberately. A cycle that was
 * constructed, wired into `close`, and never started is invisible: the process
 * comes up, reports itself healthy, and quietly does that work only once at
 * boot. The provider-event drain was in exactly that state — and it is the
 * component that applies verified provider events, which the webhook route
 * never applies on a request thread, so settled money would have gone unposted
 * until the next restart. Enumerating by type means a cycle added later cannot
 * be forgotten here, which is the only version of this that stays true.
 */
export function startBackgroundCycles(composition: WorkerComposition): void {
  for (const value of Object.values(composition)) {
    if (value instanceof Poller) value.start();
  }
}

export interface WorkerComposition {
  /** BILLING, composed here because this process drains its inbox and outbox. */
  readonly billing: BillingRuntime;
  /** PAYOUTS, composed here because this process applies both sides of the seam. */
  readonly payouts: PayoutsRuntime;
  close(): Promise<void>;
  readonly deliverySweep: Poller;
  /** Resolves ambiguous financial outcomes from provider truth. */
  readonly financialReconciliation: Poller;
  /** Applies verified provider events. Never runs on a request thread. */
  readonly providerEventDrain: Poller;
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

  // BILLING is composed on the worker for one reason: this process drains its
  // outbox and its provider-event inbox. It gets no request resolvers, because
  // no route is served here — `undefined` would be wrong, so the two context
  // resolvers the API needs are simply absent from this composition path and
  // the runtime is used only for its repositories and its webhook processor.
  const billing = createBillingRuntime({
    config: input.config,
    consumerContext: undefined as never,
    consumers: new ConsumerAdultStandingDirectory(new UsersRepository(handle)),
    creatorContext: undefined as never,
    creators: new CreatorDirectory(),
    database: handle,
    eventOwner: owner,
    logger: input.logger,
    now,
    resources: new ClubCommercialDirectory(),
  });

  // PAYOUTS is composed here for the same reason BILLING is: this process
  // drains both outboxes and applies both sides of the money seam.
  const payouts = createPayoutsRuntime({
    config: input.config,
    creatorContext: undefined as never,
    database: handle,
    logger: input.logger,
    now,
  });

  const relay = new OutboxRelay({
    consumers: [
      ...notifications.intakes,
      // The receiving half of the commercial seam. PRIVATE CLUBS decides what
      // a settled payment means for access, from BILLING's published fact,
      // against its own tables.
      ...billingEntitlementIntakes({
        clubs: new ClubRepository(handle),
        database: handle,
        grantedEvent: entitlementGrantedEvent,
        logger: input.logger,
        now,
        revokedEvent: entitlementRevokedEvent,
      }),
      // The money seam, both directions. PAYOUTS learns what a creator is owed
      // from BILLING's published fact, and BILLING learns that the obligation
      // was discharged from PAYOUTS'. Neither reads the other's tables.
      ...billingRevenueIntakes({
        database: handle,
        journal: payouts.journal,
        logger: input.logger,
        now,
        reversedEvent: revenueReversedEvent,
        settledEvent: revenueSettledEvent,
      }),
      new PayoutDisbursementIntake(disbursementSettledEvent, {
        database: handle,
        journal: billing.journal,
        logger: input.logger,
        now,
      }),
    ],
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
      {
        producer: 'billing',
        repository: new OutboxRepository(handle, billingOutbox),
      },
      {
        producer: 'payouts',
        repository: new OutboxRepository(handle, payoutsOutbox),
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
  // Verified provider events are applied here rather than on the request that
  // received them. A webhook endpoint that did business work would be slow, and
  // a slow endpoint is how one provider event becomes five.
  const providerEventDrain = new Poller({
    cycle: async () => admit(async () => billing.webhooks.processOnce()),
    intervalMilliseconds: outboxRelayIntervalMilliseconds,
    logger: input.logger,
    name: 'billing-provider-events',
  });
  // Reconciliation is what makes an ambiguous outcome a temporary state rather
  // than a permanent one. It asks providers what they hold under keys Velora
  // already sent, which is a read rather than a retry, and every correction it
  // applies goes through the same code an ordinary verified event would.
  const financialReconciliation = new Poller({
    cycle: async () =>
      admit(async () => {
        const money = await billing.reconciliation.reconcileOnce();
        const disbursements = await payouts.reconciliation.reconcileOnce();
        const examined =
          money.paymentsExamined +
          money.refundsExamined +
          disbursements.examined;
        const failed = money.failed + disbursements.failed;
        // Silent when there was nothing to resolve, which is the ordinary case
        // and would otherwise be a line every thirty seconds saying so. Counts
        // only: what an operator needs is how much is unresolved and whether it
        // is falling, and an identifier here would put one person's purchase in
        // a log line that nothing else in this domain writes.
        if (examined === 0 && failed === 0) return;
        const cycle = {
          disbursementsExamined: disbursements.examined,
          disbursementsResolved: disbursements.resolved,
          failed,
          paymentsExamined: money.paymentsExamined,
          paymentsResolved: money.paymentsResolved,
          refundsExamined: money.refundsExamined,
          refundsResolved: money.refundsResolved,
        };
        const message = 'financial reconciliation cycle';
        // A cycle that could not resolve something is worth an operator's
        // attention; one that simply had work to do is not.
        if (failed === 0) input.logger.info(cycle, message);
        else input.logger.warn(cycle, message);
      }),
    intervalMilliseconds: financialReconciliationIntervalMilliseconds,
    logger: input.logger,
    name: 'financial-reconciliation',
  });
  const deliverySweep = new Poller({
    cycle: async () => admit(async () => notifications.delivery.deliverDue()),
    intervalMilliseconds: deliverySweepIntervalMilliseconds,
    logger: input.logger,
    name: 'notification-delivery-sweep',
  });

  return {
    billing,
    financialReconciliation,
    payouts,
    async close() {
      await Promise.all([
        relayPoller.stop(),
        providerEventDrain.stop(),
        financialReconciliation.stop(),
        deliverySweep.stop(),
      ]);
    },
    deliverySweep,
    async drainOnce() {
      // Provider events first: applying one is what writes the commercial fact
      // the relay then publishes, so draining in this order settles a payment
      // and its entitlement in a single pass.
      await providerEventDrain.runOnce();
      await relayPoller.runOnce();
      await financialReconciliation.runOnce();
      await deliverySweep.runOnce();
    },
    providerEventDrain,
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
  startBackgroundCycles(composition);

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
