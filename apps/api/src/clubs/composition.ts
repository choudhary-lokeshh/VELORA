import {
  localTestBillingEntitlement,
  unavailableBillingEntitlement,
  type ServerConfig,
} from '@velora/config/server';

import type { CreatorContextResolver } from '../creators/context.js';
import type { ConsumerContextResolver } from '../users/context.js';
import {
  LocalTestBillingEntitlement,
  UnavailableBillingEntitlement,
  type BillingEntitlementPort,
} from './billing.js';
import { ClubRepository } from './club-repository.js';
import { ClubRoutes } from './club-routes.js';
import { ClubService, type ClubMemberStandingPort } from './club-service.js';
import type { ContentCreatorPort } from './creators.js';
import { ClubsRepository, type ClubsDatabase } from './repository.js';
import { ClubsRoutes } from './routes.js';
import { ClubsService } from './service.js';

export interface ClubsRuntime {
  /** The future commercial-entitlement seam. Refuses in every environment. */
  readonly billing: BillingEntitlementPort;
  readonly clubRepository: ClubRepository;
  readonly clubRoutes: ClubRoutes;
  readonly clubs: ClubService;
  readonly repository: ClubsRepository;
  readonly routes: ClubsRoutes;
  readonly service: ClubsService;
}

/**
 * Billing adapter registry, on the same rule as every other provider: a
 * configured name with no entry is an error rather than a default.
 * Configuration already refuses anything but `unavailable` in staging and
 * production, so there is no route, header, or environment string that reaches
 * the test adapter in a deployed environment.
 */
const billingEntitlements: Readonly<
  Record<string, () => BillingEntitlementPort>
> = {
  [localTestBillingEntitlement]: () => new LocalTestBillingEntitlement(),
  [unavailableBillingEntitlement]: () => new UnavailableBillingEntitlement(),
};

/**
 * PRIVATE CLUBS composition root.
 *
 * It receives CREATORS' published directory rather than reading `creators_`
 * itself, so there is one definition of "this creator may operate" and one
 * definition of "this handle has a public page". This domain writes nothing
 * outside `clubs_`.
 */
export function createClubsRuntime(input: {
  readonly config: ServerConfig;
  readonly consumerContext: ConsumerContextResolver;
  readonly creatorContext: CreatorContextResolver;
  /** The published CREATORS directory contract. */
  readonly creators: ContentCreatorPort;
  readonly database: ClubsDatabase;
  readonly now?: () => Date;
  /** The published USERS standing contract, for admitting a member. */
  readonly standing: ClubMemberStandingPort;
}): ClubsRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new ClubsRepository(input.database);
  const clubRepository = new ClubRepository(input.database);
  const service = new ClubsService({
    clubs: clubRepository,
    creators: input.creators,
    now,
    repository,
  });
  const clubs = new ClubService({
    clubs: clubRepository,
    creators: input.creators,
    now,
    standing: input.standing,
  });
  const buildBilling =
    billingEntitlements[input.config.CLUBS_BILLING_ENTITLEMENT];
  if (buildBilling === undefined) {
    throw new Error(
      `Unknown billing entitlement adapter: ${input.config.CLUBS_BILLING_ENTITLEMENT}`,
    );
  }
  return {
    billing: buildBilling(),
    clubRepository,
    clubRoutes: new ClubRoutes({
      consumerContext: input.consumerContext,
      creatorContext: input.creatorContext,
      service: clubs,
    }),
    clubs,
    repository,
    routes: new ClubsRoutes({
      creatorContext: input.creatorContext,
      service,
    }),
    service,
  };
}
