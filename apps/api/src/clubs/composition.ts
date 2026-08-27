import {
  localTestBillingEntitlement,
  unavailableBillingEntitlement,
  type ServerConfig,
} from '@velora/config/server';

import type { CreatorContextResolver } from '../creators/context.js';
import {
  UnavailableCreatorMedia,
  type CreatorMediaPort,
} from '../creators/profile-media.js';
import type { ConsumerContextResolver } from '../users/context.js';
import {
  LocalTestBillingEntitlement,
  UnavailableBillingEntitlement,
  type BillingEntitlementPort,
} from './billing.js';
import { ClubCommercialDirectory } from './commercial.js';
import { ClubRepository } from './club-repository.js';
import { ClubRoutes } from './club-routes.js';
import { ClubService, type ClubMemberStandingPort } from './club-service.js';
import { ContentMediaService } from './content-media.js';
import type { ContentCreatorPort } from './creators.js';
import { ClubsRepository, type ClubsDatabase } from './repository.js';
import { ClubsRoutes } from './routes.js';
import { ClubsService } from './service.js';

export interface ClubsRuntime {
  /** The future commercial-entitlement seam. Refuses in every environment. */
  readonly billing: BillingEntitlementPort;
  /** Images attached to catalog items, reached only through MEDIA's contracts. */
  readonly contentMedia: ContentMediaService;
  readonly clubRepository: ClubRepository;
  readonly clubRoutes: ClubRoutes;
  readonly clubs: ClubService;
  /** The one question BILLING may ask about a club, published for it. */
  readonly commercialDirectory: ClubCommercialDirectory;
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
  /**
   * The media platform, reached only through its published contracts.
   *
   * Optional, and absent means unavailable rather than absent means allowed: a
   * composition with no media platform refuses every upload instead of failing
   * on the first one somebody attempts.
   */
  readonly media?: CreatorMediaPort;
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
  const contentMedia = new ContentMediaService({
    creators: input.creators,
    media: input.media ?? new UnavailableCreatorMedia(),
    now,
    repository,
  });
  return {
    billing: buildBilling(),
    contentMedia,
    clubRepository,
    clubRoutes: new ClubRoutes({
      consumerContext: input.consumerContext,
      creatorContext: input.creatorContext,
      media: contentMedia,
      service: clubs,
    }),
    clubs,
    commercialDirectory: new ClubCommercialDirectory(),
    repository,
    routes: new ClubsRoutes({
      creatorContext: input.creatorContext,
      media: contentMedia,
      service,
    }),
    service,
  };
}
