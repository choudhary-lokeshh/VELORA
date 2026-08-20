import {
  composedCallEligibility,
  localTestRtcProvider,
  unavailableCallEligibility,
  unavailableRtcProvider,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { ConnectionDirectoryPort } from '../discovery/connections.js';
import type { OnboardingService } from '../users/onboarding.js';
import {
  ComposedRtcCallEligibility,
  UnavailableRtcCallEligibility,
  type RtcCallEligibilityPort,
  type RtcEnforcementPort,
  type RtcPairSafetyPort,
  type RtcStandingPort,
} from './eligibility.js';
import { LocalTestRtcProvider } from './local-test-provider.js';
import { RtcProviderOrchestrator } from './orchestrator.js';
import { UnavailableRtcProvider, type RtcProviderPort } from './provider.js';
import { RtcRepository } from './repository.js';
import { RtcService } from './service.js';

export interface RealtimeRuntime {
  readonly eligibility: RtcCallEligibilityPort;
  readonly orchestrator: RtcProviderOrchestrator;
  readonly provider: RtcProviderPort;
  readonly repository: RtcRepository;
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
  readonly database: DatabaseHandle;
  readonly logger?: SafeLogger;
  /** A finished contract, for a caller that has one. */
  readonly eligibility?: RtcCallEligibilityPort;
  /** TRUST & SAFETY's live-enforcement answer for one subject. */
  readonly enforcement?: RtcEnforcementPort;
  readonly now?: () => Date;
  readonly onboarding: OnboardingService;
  /** TRUST & SAFETY's pairwise answer. */
  readonly safety?: RtcPairSafetyPort;
  /** USERS' published account-standing answer. */
  readonly standing?: RtcStandingPort;
}): RealtimeRuntime {
  const repository = new RtcRepository(input.database);
  const now = input.now ?? (() => new Date());
  const provider = selectRtcProvider(input.config, now);
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
    ...(input.eligibility === undefined ? {} : { override: input.eligibility }),
    ...(input.safety === undefined ? {} : { safety: input.safety }),
    ...(input.standing === undefined ? {} : { standing: input.standing }),
  });
  return {
    eligibility,
    orchestrator,
    provider,
    repository,
    service: new RtcService({
      connections: input.connections,
      eligibility,
      now,
      onboarding: input.onboarding,
      orchestrator,
      repository,
    }),
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
