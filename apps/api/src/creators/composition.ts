import type { CallerResolver } from '../auth/caller.js';
import { CreatorContextResolver } from './context.js';
import type { CreatorAdultEligibilityPort } from './eligibility.js';
import { CreatorsRepository, type CreatorsDatabase } from './repository.js';
import { CreatorRoutes } from './routes.js';
import { CreatorsService } from './service.js';

export interface CreatorsRuntime {
  readonly creatorContext: CreatorContextResolver;
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
  const repository = new CreatorsRepository(input.database);
  const service = new CreatorsService({
    eligibility: input.eligibility,
    now: input.now ?? (() => new Date()),
    repository,
  });
  const creatorContext = new CreatorContextResolver({
    caller: input.caller,
    creators: service,
  });
  return {
    creatorContext,
    repository,
    routes: new CreatorRoutes({ creatorContext, service }),
    service,
  };
}
