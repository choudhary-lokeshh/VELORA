import type { ServerConfig } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { CallerResolver } from '../auth/caller.js';

import {
  EmptyIdentityAdultAssuranceReader,
  type IdentityAdultAssuranceReaderPort,
} from '../identity/assurance-reader.js';
import {
  AvailabilityRepository,
  AvailabilityRoutes,
  AvailabilityService,
} from './availability.js';
import { ConsumerContextResolver } from './context.js';
import { ConsumerDirectory } from './directory.js';
import { ConsumerEnforcement } from './enforcement.js';
import { OnboardingService } from './onboarding.js';
import { ProfileRepository } from './profile-repository.js';
import { ProfileRoutes } from './profile-routes.js';
import { ProfileService, type ProfileMediaPort } from './profile-service.js';
import { UsersRepository, type UsersDatabase } from './repository.js';
import { UsersRoutes } from './routes.js';
import { UsersService } from './service.js';
import {
  ConsumerAdultStandingDirectory,
  ConsumerExistenceDirectory,
  ConsumerStanding,
} from './standing.js';

export interface UsersRuntime {
  /** The adult standing this domain publishes for CREATORS. */
  readonly adultStanding: ConsumerAdultStandingDirectory;
  /** Whether an account exists at all, for TRUST & SAFETY's report targets. */
  readonly existence: ConsumerExistenceDirectory;
  readonly availability: AvailabilityService;
  readonly availabilityRoutes: AvailabilityRoutes;
  readonly consumerContext: ConsumerContextResolver;
  readonly directory: ConsumerDirectory;
  /** The account-standing change this domain publishes for enforcement. */
  readonly enforcement: ConsumerEnforcement;
  readonly onboarding: OnboardingService;
  readonly profileRepository: ProfileRepository;
  readonly profileRoutes: ProfileRoutes;
  readonly profiles: ProfileService;
  readonly repository: UsersRepository;
  readonly routes: UsersRoutes;
  readonly service: UsersService;
  /** Whether an account may be contacted, published for NOTIFICATIONS. */
  readonly standing: ConsumerStanding;
}

/**
 * Profile media adapter registry, on the same rule as the verifier above: a
 * configured name with no entry is an error rather than a silent default.
 */

/**
 * USERS composition root. It receives AUTH's caller resolver rather than
 * building its own, so there is exactly one implementation of credential
 * resolution in the application.
 */
export function createUsersRuntime(input: {
  readonly caller: CallerResolver;
  readonly config: ServerConfig;
  readonly database: UsersDatabase;
  readonly logger: SafeLogger;
  /** Identity's published current-evidence reader; never its repository. */
  readonly identityAdultAssurance?: IdentityAdultAssuranceReaderPort;
  /**
   * The media platform, reached only through its published contracts.
   *
   * USERS no longer holds a storage adapter of its own. It asks MEDIA for an
   * upload capability and for readiness, and holds an opaque asset identifier;
   * object keys, digests, measured sizes, and lifecycle values are MEDIA's and
   * stay there.
   */
  readonly media: ProfileMediaPort;
  readonly now?: () => Date;
}): UsersRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new UsersRepository(input.database);
  const identityAdultAssurance =
    input.identityAdultAssurance ??
    (input.config.APP_ENV === 'test'
      ? new EmptyIdentityAdultAssuranceReader()
      : undefined);
  if (identityAdultAssurance === undefined) {
    throw new Error('USERS requires the Identity adult-assurance reader');
  }
  const profileRepository = new ProfileRepository(input.database);
  const service = new UsersService({ now, repository });
  const consumerContext = new ConsumerContextResolver({
    caller: input.caller,
    users: service,
  });
  const onboarding = new OnboardingService({
    identityAdultAssurance,
    now,
    profiles: profileRepository,
    repository,
  });
  const profiles = new ProfileService({
    logger: input.logger,
    now,
    onboarding,
    repository: profileRepository,
    media: input.media,
    users: repository,
  });
  const availability = new AvailabilityService({
    now,
    onboarding,
    repository: new AvailabilityRepository(input.database),
  });
  return {
    adultStanding: new ConsumerAdultStandingDirectory(
      repository,
      identityAdultAssurance,
    ),
    existence: new ConsumerExistenceDirectory(repository),
    availability,
    availabilityRoutes: new AvailabilityRoutes({
      availability,
      consumerContext,
    }),
    consumerContext,
    directory: new ConsumerDirectory(input.database, identityAdultAssurance),
    enforcement: new ConsumerEnforcement(repository),
    onboarding,
    profileRepository,
    profileRoutes: new ProfileRoutes({ consumerContext, profiles }),
    profiles,
    repository,
    routes: new UsersRoutes({ consumerContext, onboarding, service }),
    service,
    standing: new ConsumerStanding(repository),
  };
}
