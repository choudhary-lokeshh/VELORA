import {
  composedCallEligibility,
  unavailableCallEligibility,
  type ServerConfig,
} from '@velora/config/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { ConnectionDirectoryPort } from '../discovery/connections.js';
import type { OnboardingService } from '../users/onboarding.js';
import {
  UnavailableRtcCallEligibility,
  type RtcCallEligibilityPort,
} from './eligibility.js';
import { RtcRepository } from './repository.js';
import { RtcService } from './service.js';

export interface RealtimeRuntime {
  readonly eligibility: RtcCallEligibilityPort;
  readonly repository: RtcRepository;
  readonly service: RtcService;
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
function selectCallEligibility(
  config: ServerConfig,
  composed: RtcCallEligibilityPort | undefined,
): RtcCallEligibilityPort {
  if (config.REALTIME_CALL_ELIGIBILITY === unavailableCallEligibility) {
    return new UnavailableRtcCallEligibility();
  }
  // Any other configured name means the real contract, which the caller must
  // have supplied. Failing here rather than defaulting is the point: a missing
  // eligibility source must never resolve to one that permits a call.
  if (composed === undefined) {
    throw new Error(
      `${composedCallEligibility} call eligibility was configured, but no composed contract was supplied`,
    );
  }
  return composed;
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
  /** The composed contract, when configuration selects it. */
  readonly eligibility?: RtcCallEligibilityPort;
  readonly now?: () => Date;
  readonly onboarding: OnboardingService;
}): RealtimeRuntime {
  const repository = new RtcRepository(input.database);
  const eligibility = selectCallEligibility(input.config, input.eligibility);
  return {
    eligibility,
    repository,
    service: new RtcService({
      connections: input.connections,
      eligibility,
      now: input.now ?? (() => new Date()),
      onboarding: input.onboarding,
      repository,
    }),
  };
}
