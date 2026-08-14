import {
  trustAndSafetyEligibility,
  unavailableSafetyEligibility,
  type ServerConfig,
} from '@velora/config/server';

import type { DatabaseHandle } from '../database/executor.js';
import { OutboxRepository } from '../events/outbox.js';
import type { ConnectionDirectoryPort } from '../discovery/connections.js';
import type { ConsumerContextResolver } from '../users/context.js';
import type { ConsumerDirectory } from '../users/directory.js';
import type { OnboardingService } from '../users/onboarding.js';
import { MessagingRepository } from './repository.js';
import { MessagingRoutes } from './routes.js';
import { messagingOutbox } from './schema.js';
import {
  UnavailableSafetyEligibility,
  type SafetyEligibilityPort,
} from './safety.js';
import { MessagingService } from './service.js';

export interface MessagingRuntime {
  /**
   * This domain's outbox, exposed so the relay in the worker can drain it. The
   * relay reads it; no other domain does.
   */
  readonly outbox: OutboxRepository;
  readonly repository: MessagingRepository;
  readonly routes: MessagingRoutes;
  readonly safety: SafetyEligibilityPort;
  readonly service: MessagingService;
}

/**
 * Safety eligibility source, on the same rule as the USERS registries: a
 * configured name with no entry is an error rather than a silent default.
 *
 * `trust-and-safety` is the published TRUST & SAFETY contract the caller
 * supplies. `unavailable` denies every pair and is what a deployed environment
 * gets, because messaging is blocked on open legal decisions rather than on a
 * missing block store.
 */
function selectSafetyEligibility(
  config: ServerConfig,
  trustAndSafety: SafetyEligibilityPort | undefined,
): SafetyEligibilityPort {
  if (config.MESSAGING_SAFETY_ELIGIBILITY === unavailableSafetyEligibility) {
    return new UnavailableSafetyEligibility();
  }
  // Any other configured name means the real contract, which the caller must
  // have supplied. Failing here rather than defaulting is the point: a missing
  // safety source must never resolve to one that permits.
  if (trustAndSafety === undefined) {
    throw new Error(
      `${trustAndSafetyEligibility} safety eligibility was configured, but no safety contract was supplied`,
    );
  }
  return trustAndSafety;
}

/**
 * MESSAGING composition root.
 *
 * It receives DISCOVERY's published connection contract and USERS' published
 * directory rather than re-deriving who is introduced or reading profile tables
 * itself. This domain writes nothing outside `messaging_`.
 */
export function createMessagingRuntime(input: {
  readonly config: ServerConfig;
  readonly connections: ConnectionDirectoryPort;
  readonly consumerContext: ConsumerContextResolver;
  readonly database: DatabaseHandle;
  readonly directory: ConsumerDirectory;
  readonly now?: () => Date;
  readonly onboarding: OnboardingService;
  /** The published TRUST & SAFETY contract, when configuration selects it. */
  readonly safety?: SafetyEligibilityPort;
}): MessagingRuntime {
  const repository = new MessagingRepository(input.database);
  const outbox = new OutboxRepository(input.database, messagingOutbox);
  const safety = selectSafetyEligibility(input.config, input.safety);
  const service = new MessagingService({
    connections: input.connections,
    directory: input.directory,
    now: input.now ?? (() => new Date()),
    onboarding: input.onboarding,
    outbox,
    repository,
    safety,
  });
  return {
    outbox,
    repository,
    routes: new MessagingRoutes({
      consumerContext: input.consumerContext,
      messaging: service,
    }),
    safety,
    service,
  };
}
