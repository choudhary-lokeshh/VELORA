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
import {
  createIdentityRuntime,
  type IdentityRuntime,
} from './identity/composition.js';
import { identityReconciliationIntervalMilliseconds } from './identity/policy.js';
import { createMediaRuntime, type MediaRuntime } from './media/composition.js';
import {
  mediaInspectionIntervalMilliseconds,
  mediaProcessingIntervalMilliseconds,
  mediaReconciliationIntervalMilliseconds,
  mediaRemovalIntervalMilliseconds,
  mediaUploadSweepIntervalMilliseconds,
} from './media/policy.js';
import { messagingOutbox } from './messaging/schema.js';
import { createRealtimeRuntime } from './realtime/composition.js';
import {
  rtcObligationDrainIntervalMilliseconds,
  rtcSweepIntervalMilliseconds,
} from './realtime/policy.js';
import { realtimeOutbox } from './realtime/schema.js';
import { ConnectionDirectory } from './discovery/connections.js';
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
import {
  LocalTestTakedownPolicy,
  TakedownService,
  UnpublishedTakedownPolicy,
} from './safety/takedown.js';
import { ProfileRepository } from './users/profile-repository.js';
import { profileMediaReadinessIntervalMilliseconds } from './users/profile-policy.js';
import { ProfileMediaReadinessSweep } from './users/profile-service.js';
import { OnboardingService } from './users/onboarding.js';
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
 * How often a paid period that has run out is actually closed.
 *
 * A minute, on the same reasoning the takedown sweep uses: the end of a period
 * is a stored date rather than a timer, so the only question is how long
 * somebody keeps access they have stopped paying for. A minute is short enough
 * that nobody notices and long enough that the sweep is not the reason a
 * database is busy.
 */
export const subscriptionExpiryIntervalMilliseconds = 60_000;

/**
 * How often passed takedown deadlines are looked for.
 *
 * A minute, because a deadline is a row rather than a timer: the sweep is
 * recovering facts that are already true rather than firing an alarm at the
 * instant one passes, so it can be leisurely and lose nothing. On a platform
 * that publishes no deadline policy it finds nothing at all, every time, which
 * is the accurate answer rather than an idle loop pretending otherwise.
 */
export const safetyDeadlineSweepIntervalMilliseconds = 60_000;

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
/**
 * How far apart two background cycles are started.
 *
 * Sixteen pollers ran on intervals of 5, 15, 30, and 60 seconds — every one of
 * them a multiple of five — and every one was started in the same synchronous
 * loop. Their timers therefore aligned permanently: eight cycles began together
 * every five seconds and all sixteen began together every sixty, against a
 * database admission bound of eight permits with a 250ms wait. The excess did
 * not queue and proceed; it waited out the bound and reported
 * `Database admission capacity is exhausted`, at high severity, on an idle
 * developer machine. The bound was doing exactly its job. The arrival pattern
 * was the defect.
 *
 * Spacing the starts fixes it at the source. Sixteen phases 250ms apart occupy
 * four seconds, less than the shortest interval, and because every interval is
 * a whole multiple of five seconds each poller keeps its phase for the life of
 * the process — two cycles that start apart stay apart, permanently, rather
 * than drifting back into alignment. Nothing about how often work is looked for
 * changes, and no limit is raised.
 */
export const backgroundCyclePhaseMilliseconds = 250;

export function startBackgroundCycles(composition: WorkerComposition): void {
  let phase = 0;
  for (const value of Object.values(composition)) {
    if (!(value instanceof Poller)) continue;
    value.start(phase);
    phase += backgroundCyclePhaseMilliseconds;
  }
}

export interface WorkerComposition {
  /** BILLING, composed here because this process drains its inbox and outbox. */
  readonly billing: BillingRuntime;
  /** IDENTITY, composed here because this process drains its verified inbox. */
  readonly identity: IdentityRuntime;
  /** Applies verified identity-provider events outside request threads. */
  readonly identityProviderEventDrain: Poller;
  /** Recovers missing identity callbacks from configured provider truth. */
  readonly identityReconciliation: Poller;
  /** MEDIA, composed here because this process owns its durable byte work. */
  readonly media: MediaRuntime;
  /** Derives what uploaded bytes actually are. Quarantines what fails. */
  readonly mediaInspection: Poller;
  /** Renders the derivative set from decoded pixels. Strips every tag. */
  readonly mediaProcessing: Poller;
  /** Checks the record against the provider. Repairs what can be repaired. */
  readonly mediaReconciliation: Poller;
  /** Keeps USERS' cached readiness projection from going stale unnoticed. */
  readonly profileMediaReadiness: Poller;
  /** Destroys bytes and asks caches to forget. Never loses either duty. */
  readonly mediaRemoval: Poller;
  /** Closes spent upload windows, recovers stranded ones, reclaims the dead. */
  readonly mediaUploadSweep: Poller;
  /** PAYOUTS, composed here because this process applies both sides of the seam. */
  readonly payouts: PayoutsRuntime;
  close(): Promise<void>;
  readonly deliverySweep: Poller;
  readonly providerFeedbackSweep: Poller;
  /** Resolves ambiguous financial outcomes from provider truth. */
  readonly financialReconciliation: Poller;
  /** Closes scheduled cancellations whose paid period has run out. */
  readonly subscriptionExpiry: Poller;
  /** Applies verified provider events. Never runs on a request thread. */
  readonly providerEventDrain: Poller;
  readonly relay: OutboxRelay;
  readonly relayPoller: Poller;
  /** Discharges what calling owes a provider. Decides nothing about a call. */
  readonly rtcObligationDrain: Poller;
  /** Closes invitations and calls that ran out of time. */
  readonly rtcSweep: Poller;
  /** Records passed takedown deadlines as evidence. Decides nothing. */
  readonly safetyDeadlineSweep: Poller;
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
/**
 * Admits nobody, whatever an account has done.
 *
 * The worker authorizes no call — it carries out decisions already recorded —
 * so the admission answer it composes REALTIME with is one that always refuses.
 * A worker able to admit somebody would be a second way into calling that no
 * request path guards.
 */
const refusedAdmission = {
  adultAssurance: 'none',
  adultAssuranceRefused: false,
  outstandingPolicies: [],
  outstandingProfile: [],
  step: 'adult_declaration',
} as const;

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

  const identity = createIdentityRuntime({
    config: input.config,
    database: handle,
    logger: input.logger,
    now,
    owner,
  });

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

  // REALTIME is composed here because this process carries out what calling
  // owes and what it has to clean up: provider teardown, invitations whose
  // deadline passed, and calls stuck past a bounded wait. It gets no request
  // resolvers and no routes, because none is served here — and its eligibility
  // contract refuses every pair, since nothing on this process authorizes a
  // call and a worker that could would be a second way into calling.
  const realtime = createRealtimeRuntime({
    config: input.config,
    connections: new ConnectionDirectory(handle),
    database: handle,
    eligibility: { mayCall: () => Promise.resolve(false) },
    logger: input.logger,
    now,
    onboarding: { evaluate: () => Promise.resolve(refusedAdmission) },
    workerName: owner,
  });

  // BILLING is composed on the worker for one reason: this process drains its
  // outbox and its provider-event inbox. It gets no request resolvers, because
  // no route is served here — `undefined` would be wrong, so the two context
  // resolvers the API needs are simply absent from this composition path and
  // the runtime is used only for its repositories and its webhook processor.
  const billing = createBillingRuntime({
    config: input.config,
    consumerContext: undefined as never,
    consumers: new ConsumerAdultStandingDirectory(
      new UsersRepository(handle),
      identity.adultAssurance,
    ),
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
        producer: 'realtime',
        repository: new OutboxRepository(handle, realtimeOutbox),
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
  const identityProviderEventDrain = new Poller({
    cycle: async () => admit(async () => identity.providerEvents.processOnce()),
    intervalMilliseconds: outboxRelayIntervalMilliseconds,
    logger: input.logger,
    name: 'identity-provider-events',
  });
  // IDENTITY follows the same external-effect rule as financial recovery: a
  // durable attempt is selected and marked first, provider truth is read with
  // no transaction held, and any correction goes through append-only evidence.
  const identityReconciliation = new Poller({
    cycle: async () =>
      admit(async () => {
        const report = await identity.reconciliation.reconcileOnce();
        if (
          report.failed === 0 &&
          report.found === 0 &&
          report.outstanding === 0
        ) {
          return;
        }
        const details = {
          examined: report.examined,
          failed: report.failed,
          found: report.found,
          outstanding: report.outstanding,
          provider: identity.provider.provider,
          repaired: report.repaired,
        };
        if (report.failed === 0 && report.outstanding === 0) {
          input.logger.info(details, 'identity reconciliation cycle');
        } else {
          input.logger.warn(
            details,
            'identity reconciliation requires attention',
          );
        }
      }),
    intervalMilliseconds: identityReconciliationIntervalMilliseconds,
    logger: input.logger,
    name: 'identity-reconciliation',
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
  // A cancelled subscription ends when its paid period does, not when somebody
  // asked. This is the sweep that closes the ones that have run out and
  // publishes the revocation; it reaches no provider, because the end of a
  // period is arithmetic on a date this platform already stored.
  const subscriptionExpiry = new Poller({
    cycle: async () =>
      admit(async () => {
        const report = await billing.subscriptions.expireOnce();
        // Silent when there was nothing due, which is the ordinary case.
        if (report.expired === 0) return;
        input.logger.info(
          { examined: report.examined, expired: report.expired },
          'subscription periods closed',
        );
      }),
    intervalMilliseconds: subscriptionExpiryIntervalMilliseconds,
    logger: input.logger,
    name: 'subscription-expiry',
  });
  // TRUST & SAFETY's obligations are rows, so the worker's part is to notice
  // when one has passed and write that down. It never decides a case: a sweep
  // that quietly actioned a claim would be automation deciding a safety matter,
  // which this domain does not do.
  const takedown = new TakedownService({
    now,
    policy:
      input.config.SAFETY_TAKEDOWN_POLICY === 'local-test'
        ? new LocalTestTakedownPolicy()
        : new UnpublishedTakedownPolicy(),
    repository: new SafetyRepository(handle),
  });
  // What calling owes a provider. The discharge itself reaches a vendor, so it
  // runs here and never on a request path, and it holds no database connection
  // while it does.
  const rtcObligationDrain = new Poller({
    cycle: async () =>
      admit(async () => {
        const report = await realtime.reconciliation.dischargeOnce();
        // Silent when nothing was owed, which is the ordinary case and, with no
        // approved provider, the only one. Counts only: what an operator needs
        // is how much is outstanding and whether it is falling, and an
        // identifier here would put two people's call in a log line.
        if (report.examined === 0) return;
        const cycle = {
          abandoned: report.abandoned,
          deferred: report.deferred,
          discharged: report.discharged,
          examined: report.examined,
          provider: realtime.provider.provider,
        };
        if (report.abandoned > 0) {
          input.logger.error(cycle, 'rtc obligations abandoned');
        } else if (report.deferred > 0) {
          input.logger.warn(cycle, 'rtc obligations deferred');
        } else {
          input.logger.info(cycle, 'rtc obligation drain cycle');
        }
      }),
    intervalMilliseconds: rtcObligationDrainIntervalMilliseconds,
    logger: input.logger,
    name: 'rtc-obligation-drain',
  });

  // Invitations nobody answered and calls stuck past a bounded wait. Both
  // deadlines are already true in the database, so this records facts rather
  // than deciding them, and a cycle that never runs delays a record without
  // changing any decision.
  const rtcSweep = new Poller({
    cycle: async () =>
      admit(async () => {
        const expired = await realtime.service.expireDueInvitations();
        const stalled = await realtime.service.closeStalledCalls();
        const closed =
          expired + stalled.failedToConnect + stalled.reconnectExpired;
        if (closed === 0) return;
        input.logger.info(
          {
            failedToConnect: stalled.failedToConnect,
            invitationsExpired: expired,
            reconnectExpired: stalled.reconnectExpired,
          },
          'rtc sweep cycle',
        );
      }),
    intervalMilliseconds: rtcSweepIntervalMilliseconds,
    logger: input.logger,
    name: 'rtc-sweep',
  });

  const safetyDeadlineSweep = new Poller({
    cycle: async () =>
      admit(async () => {
        const { recorded } = await takedown.recordOverdue({
          actorReference: owner,
        });
        // Silent when nothing passed, which is the ordinary case and, on a
        // platform publishing no deadline policy, the only one. A count and
        // nothing else: an identifier here would put one person's complaint in
        // a log line, and nothing in this domain writes one.
        if (recorded > 0) {
          input.logger.warn({ recorded }, 'takedown action deadlines passed');
        }
      }),
    intervalMilliseconds: safetyDeadlineSweepIntervalMilliseconds,
    logger: input.logger,
    name: 'safety-deadline-sweep',
  });

  // MEDIA's upload housekeeping, in one cycle because the three steps are one
  // story about windows nobody finished: close what expired, re-obtain a
  // capability for anything the crash window stranded, and reclaim what has
  // gone quiet past the technical TTL. Each is bounded and each is idempotent,
  // so two workers running this at once do the work once between them.
  const media = createMediaRuntime({
    config: input.config,
    database: handle,
    // Only here. Decoding hostile input and re-encoding pixels belong on the
    // worker boundary, and the API composes neither, so it cannot be talked
    // into either.
    performsByteWork: true,
    logger: input.logger,
    now,
  });
  const mediaUploadSweep = new Poller({
    cycle: async () =>
      admit(async () => {
        const expired = await media.service.sweepExpiredUploads();
        const recovered = await media.service.recoverUploadCapabilities();
        const reclaimed = await media.service.sweepAbandonedUploads();
        // Counts only. An asset identifier here would put one person's upload
        // in a log line, and nothing in this domain writes one.
        if (expired > 0 || recovered > 0 || reclaimed > 0) {
          input.logger.info(
            { expired, reclaimed, recovered },
            'media upload windows swept',
          );
        }
      }),
    intervalMilliseconds: mediaUploadSweepIntervalMilliseconds,
    logger: input.logger,
    name: 'media-upload-sweep',
  });

  // Inspection runs on its own cadence, faster than the housekeeping sweep,
  // because somebody is waiting on it: an upload is not usable until the
  // platform knows what it is. The claim is a database lease, so several
  // workers take different rows and one that dies mid-decode loses its lease
  // rather than the duty.
  const mediaInspection = new Poller({
    cycle: async () =>
      admit(async () => {
        const { inspected, quarantined } = await media.service.runInspections({
          owner,
        });
        // Counts only. An asset identifier, an object key, or a rejection
        // reason here would put one person's upload in a log line.
        if (inspected > 0 || quarantined > 0) {
          input.logger.info(
            { inspected, quarantined },
            'media objects inspected',
          );
        }
      }),
    intervalMilliseconds: mediaInspectionIntervalMilliseconds,
    logger: input.logger,
    name: 'media-inspection',
  });

  // Processing is the CPU-heavy half and it runs here rather than anywhere a
  // request could reach, so re-encoding a large image cannot compete with
  // serving traffic.
  const mediaProcessing = new Poller({
    cycle: async () =>
      admit(async () => {
        const { ready } = await media.service.runProcessing({ owner });
        if (ready > 0) {
          input.logger.info({ ready }, 'media derivative sets completed');
        }
      }),
    intervalMilliseconds: mediaProcessingIntervalMilliseconds,
    logger: input.logger,
    name: 'media-processing',
  });

  // USERS caches the media platform's readiness answer so discovery stays one
  // indexed query. The interactive path refreshes an account somebody is
  // looking at; this reaches the ones nobody has opened, oldest first, so a
  // profile whose asset was taken down does not keep a stale `true`.
  // The sweep reconciles admission for accounts whose readiness moved, so it
  // needs the same onboarding authority the API uses rather than a second
  // opinion about what a complete profile is.
  const profileRepository = new ProfileRepository(handle);
  const usersRepository = new UsersRepository(handle);
  const profileMediaSweep = new ProfileMediaReadinessSweep({
    media: media.service,
    now,
    onboarding: new OnboardingService({
      identityAdultAssurance: identity.adultAssurance,
      now,
      profiles: profileRepository,
      repository: usersRepository,
    }),
    repository: profileRepository,
    users: usersRepository,
  });
  const profileMediaReadiness = new Poller({
    cycle: async () =>
      admit(async () => {
        const refreshed = await profileMediaSweep.run();
        if (refreshed > 0) {
          input.logger.debug(
            { refreshed },
            'profile media readiness refreshed',
          );
        }
      }),
    intervalMilliseconds: profileMediaReadinessIntervalMilliseconds,
    logger: input.logger,
    name: 'profile-media-readiness',
  });

  // Deletion and purge in one cycle, deletion first: destroying a derivative is
  // what creates the obligation to purge its address, so running purge first
  // would simply find less to do and come back for it a cycle later.
  const mediaRemoval = new Poller({
    cycle: async () =>
      admit(async () => {
        const removal = await media.service.runDeletions({ owner });
        const purge = await media.service.runPurges({ owner });
        if (
          removal.deleted > 0 ||
          removal.held > 0 ||
          purge.purged > 0 ||
          purge.unsupported > 0
        ) {
          // Counts only, and `held` and `unsupported` are reported rather than
          // folded into success: one means evidence is being preserved, the
          // other means a cache was never actually told.
          input.logger.info(
            {
              deleted: removal.deleted,
              held: removal.held,
              purged: purge.purged,
              unsupported: purge.unsupported,
            },
            'media removal cycle completed',
          );
        }
      }),
    intervalMilliseconds: mediaRemovalIntervalMilliseconds,
    logger: input.logger,
    name: 'media-removal',
  });

  // Checking that the provider still holds what the record says it holds, and
  // repairing what can be repaired. Slower than every other media cycle on
  // purpose: nothing is waiting on it, each row it examines costs a provider
  // round trip, and the failures it finds are ones that have already happened.
  const mediaReconciliation = new Poller({
    cycle: async () =>
      admit(async () => {
        const reconciliation = media.reconciliation;
        if (reconciliation === undefined) return;
        const report = await reconciliation.reconcileOnce({ owner });
        // `outstanding` is reported every time it is non-zero, even when this
        // cycle found and repaired nothing. Drift the platform cannot correct
        // by itself is the whole reason for the number, and a log that went
        // quiet once the sweep stopped finding new faults would read as though
        // the old ones had gone away.
        if (report.found > 0 || report.outstanding > 0) {
          input.logger.warn(
            {
              found: report.found,
              outstanding: report.outstanding,
              repaired: report.repaired,
            },
            'media reconciliation found provider drift',
          );
        }
      }),
    intervalMilliseconds: mediaReconciliationIntervalMilliseconds,
    logger: input.logger,
    name: 'media-reconciliation',
  });

  const deliverySweep = new Poller({
    cycle: async () => admit(async () => notifications.delivery.deliverDue()),
    intervalMilliseconds: deliverySweepIntervalMilliseconds,
    logger: input.logger,
    name: 'notification-delivery-sweep',
  });

  /**
   * Applies what providers said, off the request thread.
   *
   * The callback endpoint records and acknowledges; this is where a verified
   * event is allowed to change something. Keeping them apart is what stops a
   * provider's retry budget being spent on work this platform chose to do
   * later, and it is why a slow apply can never turn into a redelivery storm.
   */
  const providerFeedbackSweep = new Poller({
    cycle: async () =>
      admit(async () => notifications.providerEvents.applyDue()),
    intervalMilliseconds: deliverySweepIntervalMilliseconds,
    logger: input.logger,
    name: 'notification-provider-feedback-sweep',
  });

  return {
    billing,
    financialReconciliation,
    subscriptionExpiry,
    rtcObligationDrain,
    rtcSweep,
    identity,
    identityProviderEventDrain,
    identityReconciliation,
    media,
    mediaInspection,
    mediaProcessing,
    mediaReconciliation,
    mediaRemoval,
    mediaUploadSweep,
    profileMediaReadiness,
    payouts,
    async close() {
      await Promise.all([
        relayPoller.stop(),
        providerEventDrain.stop(),
        identityProviderEventDrain.stop(),
        identityReconciliation.stop(),
        financialReconciliation.stop(),
        subscriptionExpiry.stop(),
        rtcObligationDrain.stop(),
        rtcSweep.stop(),
        safetyDeadlineSweep.stop(),
        mediaInspection.stop(),
        mediaProcessing.stop(),
        mediaReconciliation.stop(),
        mediaRemoval.stop(),
        mediaUploadSweep.stop(),
        profileMediaReadiness.stop(),
        deliverySweep.stop(),
        providerFeedbackSweep.stop(),
      ]);
    },
    deliverySweep,
    providerFeedbackSweep,
    async drainOnce() {
      // Provider events first: applying one is what writes the commercial fact
      // the relay then publishes, so draining in this order settles a payment
      // and its entitlement in a single pass.
      await providerEventDrain.runOnce();
      await identityProviderEventDrain.runOnce();
      await identityReconciliation.runOnce();
      await relayPoller.runOnce();
      await financialReconciliation.runOnce();
      // After the relay, so a period that ended while the process was down is
      // closed and its revocation is published in the same pass.
      await subscriptionExpiry.runOnce();
      await relayPoller.runOnce();
      await safetyDeadlineSweep.runOnce();
      // A restart drains what is owed before it settles into its interval: a
      // room left open by the process that died is the one thing here worth
      // being impatient about.
      await rtcObligationDrain.runOnce();
      await rtcSweep.runOnce();
      await mediaUploadSweep.runOnce();
      await mediaInspection.runOnce();
      await mediaProcessing.runOnce();
      await mediaRemoval.runOnce();
      // Last of the media cycles: it looks for work the others left undone, so
      // running it before them would be asking about a state they are about to
      // change.
      await mediaReconciliation.runOnce();
      await profileMediaReadiness.runOnce();
      // Provider feedback before the delivery sweep: an event retiring a
      // device token should be applied before the next claim reads which
      // devices a person can still be reached on, or that claim aims a notice
      // at a registration this pass was about to retire.
      await providerFeedbackSweep.runOnce();
      await deliverySweep.runOnce();
    },
    providerEventDrain,
    registry,
    relay,
    relayPoller,
    safetyDeadlineSweep,
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
