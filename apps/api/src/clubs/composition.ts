import type { CreatorContextResolver } from '../creators/context.js';
import type { ContentCreatorPort } from './creators.js';
import { ClubsRepository, type ClubsDatabase } from './repository.js';
import { ClubsRoutes } from './routes.js';
import { ClubsService } from './service.js';

export interface ClubsRuntime {
  readonly repository: ClubsRepository;
  readonly routes: ClubsRoutes;
  readonly service: ClubsService;
}

/**
 * PRIVATE CLUBS composition root.
 *
 * It receives CREATORS' published directory rather than reading `creators_`
 * itself, so there is one definition of "this creator may operate" and one
 * definition of "this handle has a public page". This domain writes nothing
 * outside `clubs_`.
 */
export function createClubsRuntime(input: {
  readonly creatorContext: CreatorContextResolver;
  /** The published CREATORS directory contract. */
  readonly creators: ContentCreatorPort;
  readonly database: ClubsDatabase;
  readonly now?: () => Date;
}): ClubsRuntime {
  const repository = new ClubsRepository(input.database);
  const service = new ClubsService({
    creators: input.creators,
    now: input.now ?? (() => new Date()),
    repository,
  });
  return {
    repository,
    routes: new ClubsRoutes({
      creatorContext: input.creatorContext,
      service,
    }),
    service,
  };
}
