import type { SafeLogger } from '@velora/observability/server';

import { OutboxRepository } from '../events/outbox.js';
import type { ConsumerContextResolver } from '../users/context.js';
import type { ConsumerDirectory } from '../users/directory.js';
import type { OnboardingService } from '../users/onboarding.js';
import type { UsersDatabase } from '../users/repository.js';
import { ConnectionDirectory } from './connections.js';
import { IntroductionRepository } from './introductions.js';
import { DiscoveryRepository } from './repository.js';
import { DiscoveryRoutes } from './routes.js';
import type { CandidateSafetyPort } from './safety.js';
import { discoveryOutbox } from './schema.js';
import { DiscoveryService } from './service.js';

export interface DiscoveryRuntime {
  /** The connection fact this domain publishes to MESSAGING. */
  readonly connections: ConnectionDirectory;
  readonly introductions: IntroductionRepository;
  /**
   * This domain's outbox, exposed so the relay in the worker can drain it. The
   * relay is the only reader; no other domain is given the table.
   */
  readonly outbox: OutboxRepository;
  readonly repository: DiscoveryRepository;
  readonly routes: DiscoveryRoutes;
  readonly service: DiscoveryService;
}

/**
 * DISCOVERY composition root.
 *
 * It receives USERS' admission service and USERS' published consumer directory
 * rather than re-deriving who is eligible or reading profile tables itself, so
 * there is one definition of an admitted consumer and one place that knows the
 * shape of `users_`. This domain writes nothing outside `discovery_`.
 */
export function createDiscoveryRuntime(input: {
  readonly consumerContext: ConsumerContextResolver;
  readonly database: UsersDatabase;
  readonly directory: ConsumerDirectory;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  readonly onboarding: OnboardingService;
  /** The published TRUST & SAFETY eligibility contract. */
  readonly safety: CandidateSafetyPort;
}): DiscoveryRuntime {
  const repository = new DiscoveryRepository(input.database);
  const introductions = new IntroductionRepository(input.database);
  const outbox = new OutboxRepository(input.database, discoveryOutbox);
  const service = new DiscoveryService({
    directory: input.directory,
    introductions,
    logger: input.logger,
    now: input.now ?? (() => new Date()),
    onboarding: input.onboarding,
    outbox,
    repository,
    safety: input.safety,
  });
  return {
    connections: new ConnectionDirectory(input.database),
    introductions,
    outbox,
    repository,
    routes: new DiscoveryRoutes({
      consumerContext: input.consumerContext,
      discovery: service,
    }),
    service,
  };
}
