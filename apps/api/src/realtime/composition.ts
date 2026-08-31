import {
  composedCallEligibility,
  localTestRtcProvider,
  redisSignalTransport,
  unavailableCallEligibility,
  unavailableRtcProvider,
  unavailableSignalTransport,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import { OutboxRepository } from '../events/outbox.js';
import type { ConnectionDirectoryPort } from '../discovery/connections.js';
import type { ConsumerContextResolver } from '../users/context.js';
import type { ConsumerDirectory } from '../users/directory.js';

import {
  ComposedRtcCallEligibility,
  UnavailableRtcCallEligibility,
  type RtcCallEligibilityPort,
  type RtcEnforcementPort,
  type RtcLiveEncounterPort,
  type RtcPairSafetyPort,
  type RtcStandingPort,
} from './eligibility.js';
import { RtcLiveSessions } from './live-sessions.js';
import { RtcJoinAuthorizationService } from './authorization.js';
import { RtcCallEnforcement } from './enforcement.js';
import { RtcOperations } from './operations.js';
import { RtcReconciler } from './reconciliation.js';
import { LocalTestRtcProvider } from './local-test-provider.js';
import { RtcProviderOrchestrator } from './orchestrator.js';
import { RtcProviderEventRoutes } from './provider-event-routes.js';
import { RtcProviderEventService } from './provider-events.js';
import { UnavailableRtcProvider, type RtcProviderPort } from './provider.js';
import { RtcRepository } from './repository.js';
import { realtimeOutbox } from './schema.js';
import { RtcRoutes } from './routes.js';
import {
  RedisRtcSignalPublisher,
  UnavailableRtcSignalPublisher,
  type RtcSignalChannel,
  type RtcSignalPublisherPort,
} from './signalling.js';
import { RtcService, type RtcAdmissionPort } from './service.js';

export interface RealtimeRuntime {
  readonly authorization: RtcJoinAuthorizationService;
  /**
   * The live-session contract this domain publishes to LIVE: open, read,
   * establish, end. It carries no authority to admit anybody — a client asks
   * for a join credential through the route that re-composes eligibility.
   */
  readonly liveSessions: RtcLiveSessions;
  /**
   * What TRUST & SAFETY is allowed to do to a call: end it. Published here so
   * the application can hand it to SAFETY without SAFETY reaching into this
   * domain for anything else.
   */
  readonly enforcement: RtcCallEnforcement;
  /**
   * What an operator may see of calling: counts, ages, and one call by
   * identifier. Published here because nothing outside this domain queries a
   * `realtime_` table.
   */
  readonly operations: RtcOperations;
  /**
   * Discharges what the platform owes a provider. Composed here and run by the
   * worker, because a provider call must never sit on a request path.
   */
  readonly reconciliation: RtcReconciler;
  readonly signals: RtcSignalPublisherPort;
  /**
   * This domain's outbox, exposed so the relay in the worker can drain it. The
   * relay reads it; no other domain does.
   */
  readonly outbox: OutboxRepository;
  readonly eligibility: RtcCallEligibilityPort;
  readonly orchestrator: RtcProviderOrchestrator;
  readonly provider: RtcProviderPort;
  readonly providerEventRoutes: RtcProviderEventRoutes;
  readonly providerEvents: RtcProviderEventService;
  readonly repository: RtcRepository;
  readonly routes: RtcRoutes;
  readonly service: RtcService;
}

/**
 * The RTC transport adapter, on the same registry rule as everything else: a
 * configured name with no entry is an error rather than a silent default.
 *
 * `unavailable` refuses every operation and is the only value staging and
 * production accept, because no provider is approved. `local-test` is
 * deterministic, in-process, and reaches no network; configuration rejects it
 * outside local and test, which is what makes it unreachable rather than
 * merely unused.
 */
const rtcProviders: Readonly<
  Record<string, (now: () => Date) => RtcProviderPort>
> = {
  [localTestRtcProvider]: (now) => new LocalTestRtcProvider(now),
  [unavailableRtcProvider]: () => new UnavailableRtcProvider(),
};

/**
 * How a call's movements reach a connected client.
 *
 * `unavailable` is the default and carries nothing, which is accurate rather
 * than degraded: no realtime gateway exists, because the surfaces that would
 * connect to one are deferred. Selecting `redis` without supplying a channel is
 * an error rather than a silent downgrade, on the same rule as every other
 * registry here — a transport that quietly carried nothing would be
 * indistinguishable from one that worked.
 */
function selectSignalPublisher(input: {
  readonly config: ServerConfig;
  readonly logger?: SafeLogger;
  readonly signalChannel?: RtcSignalChannel;
}): RtcSignalPublisherPort {
  if (input.config.REALTIME_SIGNAL_TRANSPORT === unavailableSignalTransport) {
    return new UnavailableRtcSignalPublisher();
  }
  if (input.signalChannel === undefined) {
    throw new Error(
      `${redisSignalTransport} signal transport was configured, but no channel was supplied`,
    );
  }
  return new RedisRtcSignalPublisher({
    channel: input.signalChannel,
    logger: input.logger ?? silentFallbackLogger,
  });
}

function selectRtcProvider(
  config: ServerConfig,
  now: () => Date,
): RtcProviderPort {
  const build = rtcProviders[config.REALTIME_RTC_PROVIDER];
  if (build === undefined) {
    throw new Error(
      `No RTC provider adapter is registered for ${config.REALTIME_RTC_PROVIDER}`,
    );
  }
  return build(now);
}

/**
 * Call-eligibility source, on the same rule as the MESSAGING and USERS
 * registries: a configured name with no entry is an error rather than a silent
 * default.
 *
 * `composed` is the answer built from DISCOVERY's relationship contract and
 * TRUST & SAFETY's block and enforcement contracts, which the caller supplies.
 * `unavailable` refuses every pair and is what a deployed environment gets,
 * because calling is blocked on decisions nobody has made — no approved
 * provider, no regional availability, no retention schedule, nobody on call —
 * rather than on a missing implementation.
 */
function selectCallEligibility(input: {
  readonly config: ServerConfig;
  readonly connections: ConnectionDirectoryPort;
  readonly enforcement?: RtcEnforcementPort;
  readonly liveEncounters?: RtcLiveEncounterPort;
  readonly override?: RtcCallEligibilityPort;
  readonly safety?: RtcPairSafetyPort;
  readonly standing?: RtcStandingPort;
}): RtcCallEligibilityPort {
  if (input.config.REALTIME_CALL_ELIGIBILITY === unavailableCallEligibility) {
    return new UnavailableRtcCallEligibility();
  }
  // A caller may supply a finished contract; a suite that wants one does. In
  // production the pieces arrive instead and are composed here.
  if (input.override !== undefined) return input.override;
  // Any other configured name means the real contract, which the caller must
  // have supplied the parts for. Failing here rather than defaulting is the
  // point: a missing eligibility source must never resolve to one that permits
  // a call.
  if (
    input.enforcement === undefined ||
    input.safety === undefined ||
    input.standing === undefined
  ) {
    throw new Error(
      `${composedCallEligibility} call eligibility was configured, but the safety, enforcement, and standing contracts were not all supplied`,
    );
  }
  return new ComposedRtcCallEligibility({
    enforcement: input.enforcement,
    // Absent in a composition that does not run live discovery, which then
    // refuses every `live_discovery` session rather than falling through to
    // the introduction arm — a session judged by a relationship it was never
    // created under would be a live encounter becoming a standing permission.
    ...(input.liveEncounters === undefined
      ? {}
      : { liveEncounters: input.liveEncounters }),
    relationship: input.connections,
    safety: input.safety,
    standing: input.standing,
  });
}

/**
 * REALTIME composition root.
 *
 * It receives DISCOVERY's published connection contract and USERS' published
 * onboarding admission rather than re-deriving who is introduced or reading
 * account tables itself. This domain writes nothing outside `realtime_`.
 */
export function createRealtimeRuntime(input: {
  readonly config: ServerConfig;
  readonly connections: ConnectionDirectoryPort;
  /** Present when this composition publishes routes. */
  readonly consumerContext?: ConsumerContextResolver;
  readonly database: DatabaseHandle;
  readonly directory?: ConsumerDirectory;
  readonly logger?: SafeLogger;
  /** A finished contract, for a caller that has one. */
  readonly eligibility?: RtcCallEligibilityPort;
  /** TRUST & SAFETY's live-enforcement answer for one subject. */
  readonly enforcement?: RtcEnforcementPort;
  /** LIVE's published answer about a pair being in a live encounter. */
  readonly liveEncounters?: RtcLiveEncounterPort;
  readonly now?: () => Date;
  readonly onboarding: RtcAdmissionPort;
  /** TRUST & SAFETY's pairwise answer. */
  readonly safety?: RtcPairSafetyPort;
  /**
   * Ephemeral Redis, when this composition fans out to connected clients. It
   * carries hints and never state, so its absence costs a refresh.
   */
  readonly signalChannel?: RtcSignalChannel;
  /** USERS' published account-standing answer. */
  readonly standing?: RtcStandingPort;
  /** Identifies this process on any lease it takes. */
  readonly workerName?: string;
}): RealtimeRuntime {
  const repository = new RtcRepository(input.database);
  const outbox = new OutboxRepository(input.database, realtimeOutbox);
  const now = input.now ?? (() => new Date());
  const provider = selectRtcProvider(input.config, now);
  const signals = selectSignalPublisher(input);
  const orchestrator = new RtcProviderOrchestrator({
    logger: input.logger ?? silentFallbackLogger,
    now,
    provider,
    repository,
  });
  const eligibility = selectCallEligibility({
    config: input.config,
    connections: input.connections,
    ...(input.enforcement === undefined
      ? {}
      : { enforcement: input.enforcement }),
    ...(input.liveEncounters === undefined
      ? {}
      : { liveEncounters: input.liveEncounters }),
    ...(input.eligibility === undefined ? {} : { override: input.eligibility }),
    ...(input.safety === undefined ? {} : { safety: input.safety }),
    ...(input.standing === undefined ? {} : { standing: input.standing }),
  });
  const authorization = new RtcJoinAuthorizationService({
    eligibility,
    now,
    provider,
    repository,
  });
  const service = new RtcService({
    connections: input.connections,
    eligibility,
    now,
    onboarding: input.onboarding,
    orchestrator,
    outbox,
    repository,
    signals,
  });
  const providerEvents = new RtcProviderEventService({
    logger: input.logger ?? silentFallbackLogger,
    now,
    provider,
    repository,
  });
  return {
    authorization,
    eligibility,
    liveSessions: new RtcLiveSessions({ provider, repository, service }),
    enforcement: new RtcCallEnforcement(input.database, { signals }),
    reconciliation: new RtcReconciler({
      logger: input.logger ?? silentFallbackLogger,
      now,
      // Names the process holding a lease, so an operator looking at a stuck
      // obligation can tell which worker was carrying it.
      owner: input.workerName ?? 'rtc-reconciler',
      provider,
      repository,
    }),
    operations: new RtcOperations({
      // Reported from what this process actually composed rather than from the
      // configuration that was meant to select it. A screen reporting the
      // intended adapter while the process runs another is exactly the lie an
      // operations screen exists to prevent.
      adapters: {
        eligibility:
          eligibility instanceof UnavailableRtcCallEligibility
            ? unavailableCallEligibility
            : composedCallEligibility,
        provider: provider.provider,
        signalTransport: signals.transport,
      },
      now,
      repository,
    }),
    orchestrator,
    outbox,
    provider,
    providerEventRoutes: new RtcProviderEventRoutes(providerEvents),
    providerEvents,
    repository,
    signals,
    routes: new RtcRoutes({
      authorization,
      // Routes are only reachable when a composition supplies the consumer
      // seam; a worker composition has no use for them and supplies neither.
      consumerContext: input.consumerContext as never,
      directory: input.directory as never,
      realtime: service,
    }),
    service,
  };
}

/**
 * Used only when a caller composes REALTIME without a logger. It discards
 * rather than writing anywhere, which is correct for a composition that has
 * declared it does not want diagnostics — and is never the production path,
 * where the application supplies its redacting logger.
 */
const silentFallbackLogger: SafeLogger = {
  debug: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  info: () => undefined,
  trace: () => undefined,
  warn: () => undefined,
};
