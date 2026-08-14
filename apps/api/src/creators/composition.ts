import type { CallerResolver } from '../auth/caller.js';
import { CreatorContextResolver } from './context.js';
import { CreatorDirectory } from './directory.js';
import type { CreatorAdultEligibilityPort } from './eligibility.js';
import { CreatorProfileRoutes } from './profile-routes.js';
import { CreatorProfileService } from './profile-service.js';
import {
  CreatorProfileRepository,
  CreatorsRepository,
  type CreatorsDatabase,
} from './repository.js';
import { CreatorRoutes } from './routes.js';
import { CreatorsService } from './service.js';

export interface CreatorsRuntime {
  readonly creatorContext: CreatorContextResolver;
  /** The creator identity answers this domain publishes to PRIVATE CLUBS. */
  readonly directory: CreatorDirectory;
  readonly profileRepository: CreatorProfileRepository;
  readonly profileRoutes: CreatorProfileRoutes;
  readonly profiles: CreatorProfileService;
  readonly repository: CreatorsRepository;
  readonly routes: CreatorRoutes;
  readonly service: CreatorsService;
}

/**
 * CREATORS composition root.
 *
 * It receives USERS' published adult-standing contract rather than reading
 * assurance rows or account status itself, so there is one definition of what
 * an adult in good standing is and one place that knows the shape of `users_`.
 * This domain writes nothing outside `creators_`.
 */
export function createCreatorsRuntime(input: {
  readonly caller: CallerResolver;
  readonly database: CreatorsDatabase;
  /** The published USERS adult-standing contract. */
  readonly eligibility: CreatorAdultEligibilityPort;
  readonly now?: () => Date;
}): CreatorsRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new CreatorsRepository(input.database);
  const profileRepository = new CreatorProfileRepository(input.database);
  const service = new CreatorsService({
    eligibility: input.eligibility,
    now,
    repository,
  });
  const profiles = new CreatorProfileService({
    now,
    profiles: profileRepository,
  });
  const creatorContext = new CreatorContextResolver({
    caller: input.caller,
    creators: service,
  });
  return {
    creatorContext,
    directory: new CreatorDirectory(),
    profileRepository,
    profileRoutes: new CreatorProfileRoutes({ creatorContext, profiles }),
    profiles,
    repository,
    routes: new CreatorRoutes({ creatorContext, service }),
    service,
  };
}
