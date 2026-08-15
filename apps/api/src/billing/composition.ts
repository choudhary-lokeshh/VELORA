import {
  localTestCommercePolicy,
  unpublishedCommercePolicy,
  type ServerConfig,
} from '@velora/config/server';

import type { CreatorContextResolver } from '../creators/context.js';
import type { DatabaseHandle } from '../database/executor.js';
import { JournalStore } from '../money/journal.js';
import {
  LocalTestCommercePolicy,
  UnpublishedCommercePolicy,
  type CommercePolicy,
} from './commerce-policy.js';
import { OfferRepository } from './offer-repository.js';
import { OfferRoutes } from './offer-routes.js';
import { OfferService } from './offer-service.js';
import { billingJournalPrefix } from './policy.js';
import type { CommercialCreatorPort, CommercialResourcePort } from './ports.js';
import { billingJournalTables } from './schema.js';

/**
 * BILLING composition root.
 *
 * It receives CREATORS' published eligibility contract and PRIVATE CLUBS'
 * published resource contract rather than reading `creators_` or `clubs_`
 * itself, so there is one definition of "this creator may operate" and one
 * definition of "this club is published". This domain writes nothing outside
 * `billing_`.
 */
export interface BillingRuntime {
  readonly database: DatabaseHandle;
  readonly journal: JournalStore;
  readonly offerRepository: OfferRepository;
  readonly offerRoutes: OfferRoutes;
  readonly offers: OfferService;
  /** The commercial terms in force. `unpublished` in every deployed environment. */
  readonly policy: CommercePolicy;
}

/**
 * Commerce-policy registry, on the same rule as every other adapter: a
 * configured name with no entry is an error rather than a default.
 * Configuration already refuses anything but `unpublished` in staging and
 * production, so no route, header, or environment string reaches the test
 * policy in a deployed environment.
 */
const commercePolicies: Readonly<Record<string, () => CommercePolicy>> = {
  [localTestCommercePolicy]: () => new LocalTestCommercePolicy(),
  [unpublishedCommercePolicy]: () => new UnpublishedCommercePolicy(),
};

export function createBillingRuntime(input: {
  readonly config: ServerConfig;
  readonly creatorContext: CreatorContextResolver;
  /** The published CREATORS eligibility contract. */
  readonly creators: CommercialCreatorPort;
  readonly database: DatabaseHandle;
  readonly now?: () => Date;
  /** The published contract of whichever domain owns the sold resource. */
  readonly resources: CommercialResourcePort;
}): BillingRuntime {
  const now = input.now ?? (() => new Date());
  const buildPolicy = commercePolicies[input.config.BILLING_COMMERCE_POLICY];
  if (buildPolicy === undefined) {
    throw new Error(
      `Unknown commerce policy: ${input.config.BILLING_COMMERCE_POLICY}`,
    );
  }
  const policy = buildPolicy();
  const offerRepository = new OfferRepository(input.database);
  const offers = new OfferService({
    creators: input.creators,
    now,
    policy,
    repository: offerRepository,
    resources: input.resources,
  });
  return {
    database: input.database,
    journal: new JournalStore({
      now,
      prefix: billingJournalPrefix,
      tables: billingJournalTables,
    }),
    offerRepository,
    offerRoutes: new OfferRoutes({
      creatorContext: input.creatorContext,
      service: offers,
    }),
    offers,
    policy,
  };
}
