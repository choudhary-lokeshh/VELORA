import {
  localTestAdultAssuranceVerifier,
  localTestProfileMediaStorage,
  unavailableAdultAssuranceVerifier,
  unavailableProfileMediaStorage,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { CallerResolver } from '../auth/caller.js';

import {
  LocalTestAdultAssuranceVerifier,
  UnavailableAdultAssuranceVerifier,
  type AdultAssuranceVerifier,
} from './adult-assurance.js';
import {
  AvailabilityRepository,
  AvailabilityRoutes,
  AvailabilityService,
} from './availability.js';
import { ConsumerContextResolver } from './context.js';
import { ConsumerDirectory } from './directory.js';
import { ConsumerEnforcement } from './enforcement.js';
import {
  LocalTestProfileMediaStorage,
  UnavailableProfileMediaStorage,
  type ProfileMediaStoragePort,
} from './media.js';
import { OnboardingService } from './onboarding.js';
import { ProfileRepository } from './profile-repository.js';
import { ProfileRoutes } from './profile-routes.js';
import { ProfileService } from './profile-service.js';
import { UsersRepository, type UsersDatabase } from './repository.js';
import { UsersRoutes } from './routes.js';
import { UsersService } from './service.js';
import {
  ConsumerAdultStandingDirectory,
  ConsumerStanding,
} from './standing.js';

export interface UsersRuntime {
  readonly adultAssuranceVerifier: AdultAssuranceVerifier;
  /** The adult standing this domain publishes for CREATORS. */
  readonly adultStanding: ConsumerAdultStandingDirectory;
  readonly availability: AvailabilityService;
  readonly availabilityRoutes: AvailabilityRoutes;
  readonly consumerContext: ConsumerContextResolver;
  readonly directory: ConsumerDirectory;
  /** The account-standing change this domain publishes for enforcement. */
  readonly enforcement: ConsumerEnforcement;
  readonly onboarding: OnboardingService;
  readonly profileMediaStorage: ProfileMediaStoragePort;
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
 * Adult-assurance adapter registry. A configured name with no entry is an error
 * rather than a default, so adding a provider means registering it here
 * deliberately. Configuration already refuses anything but `unavailable` in
 * staging and production.
 */
const adultAssuranceVerifiers: Readonly<
  Record<string, () => AdultAssuranceVerifier>
> = {
  [localTestAdultAssuranceVerifier]: () =>
    new LocalTestAdultAssuranceVerifier(),
  [unavailableAdultAssuranceVerifier]: () =>
    new UnavailableAdultAssuranceVerifier(),
};

/**
 * Profile media adapter registry, on the same rule as the verifier above: a
 * configured name with no entry is an error rather than a silent default.
 */
const profileMediaStorages: Readonly<
  Record<string, () => ProfileMediaStoragePort>
> = {
  [localTestProfileMediaStorage]: () => new LocalTestProfileMediaStorage(),
  [unavailableProfileMediaStorage]: () => new UnavailableProfileMediaStorage(),
};

function selectProfileMediaStorage(
  config: ServerConfig,
): ProfileMediaStoragePort {
  const build = profileMediaStorages[config.USERS_PROFILE_MEDIA_STORAGE];
  if (build === undefined) {
    throw new Error('No approved profile media storage is configured');
  }
  return build();
}

function selectAdultAssuranceVerifier(
  config: ServerConfig,
): AdultAssuranceVerifier {
  const build = adultAssuranceVerifiers[config.USERS_ADULT_ASSURANCE_VERIFIER];
  if (build === undefined) {
    throw new Error('No approved adult assurance verifier is configured');
  }
  return build();
}

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
  readonly now?: () => Date;
}): UsersRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new UsersRepository(input.database);
  const profileRepository = new ProfileRepository(input.database);
  const service = new UsersService({ now, repository });
  const consumerContext = new ConsumerContextResolver({
    caller: input.caller,
    users: service,
  });
  const adultAssuranceVerifier = selectAdultAssuranceVerifier(input.config);
  const onboarding = new OnboardingService({
    adultAssuranceVerifier,
    now,
    profiles: profileRepository,
    repository,
  });
  const profileMediaStorage = selectProfileMediaStorage(input.config);
  const profiles = new ProfileService({
    logger: input.logger,
    now,
    onboarding,
    repository: profileRepository,
    storage: profileMediaStorage,
  });
  const availability = new AvailabilityService({
    now,
    onboarding,
    repository: new AvailabilityRepository(input.database),
  });
  return {
    adultAssuranceVerifier,
    adultStanding: new ConsumerAdultStandingDirectory(repository),
    availability,
    availabilityRoutes: new AvailabilityRoutes({
      availability,
      consumerContext,
    }),
    consumerContext,
    directory: new ConsumerDirectory(input.database),
    enforcement: new ConsumerEnforcement(repository),
    onboarding,
    profileMediaStorage,
    profileRepository,
    profileRoutes: new ProfileRoutes({ consumerContext, profiles }),
    profiles,
    repository,
    routes: new UsersRoutes({ consumerContext, onboarding, service }),
    service,
    standing: new ConsumerStanding(repository),
  };
}
