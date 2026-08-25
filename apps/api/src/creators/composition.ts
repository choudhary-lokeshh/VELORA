import type { CallerResolver } from '../auth/caller.js';
import { CreatorContextResolver } from './context.js';
import { CreatorDirectory } from './directory.js';
import type { CreatorAdultEligibilityPort } from './eligibility.js';
import {
  CreatorProfileMediaService,
  UnavailableCreatorMedia,
  type CreatorMediaPort,
} from './profile-media.js';
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
  /** This domain's own page images, reached only through MEDIA's contracts. */
  readonly profileMedia: CreatorProfileMediaService;
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
  /**
   * The media platform, reached only through its published contracts.
   *
   * Optional, and absent means unavailable rather than absent means allowed: a
   * composition with no media platform refuses every upload instead of failing
   * on the first one somebody attempts.
   */
  readonly media?: CreatorMediaPort;
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
  const profileMedia = new CreatorProfileMediaService({
    media: input.media ?? new UnavailableCreatorMedia(),
    now,
    profiles: profileRepository,
  });
  return {
    creatorContext,
    directory: new CreatorDirectory(input.eligibility),
    profileMedia,
    profileRepository,
    profileRoutes: new CreatorProfileRoutes({
      creatorContext,
      media: profileMedia,
      profiles,
    }),
    profiles,
    repository,
    routes: new CreatorRoutes({ creatorContext, service }),
    service,
  };
}
