import {
  localTestCommercePolicy,
  localTestPaymentProvider,
  unavailablePaymentProvider,
  unpublishedCommercePolicy,
  type ServerConfig,
} from '@velora/config/server';

import type { CreatorContextResolver } from '../creators/context.js';
import type { DatabaseHandle } from '../database/executor.js';
import { JournalStore } from '../money/journal.js';
import type { ConsumerContextResolver } from '../users/context.js';
import { CheckoutRoutes } from './checkout-routes.js';
import { CheckoutService } from './checkout-service.js';
import {
  LocalTestCommercePolicy,
  UnpublishedCommercePolicy,
  type CommercePolicy,
} from './commerce-policy.js';
import { LocalTestPaymentProvider } from './local-test-provider.js';
import { OfferRepository } from './offer-repository.js';
import { OfferRoutes } from './offer-routes.js';
import { OfferService } from './offer-service.js';
import { PaymentRepository } from './payment-repository.js';
import { billingJournalPrefix } from './policy.js';
import type {
  CommercialConsumerPort,
  CommercialCreatorPort,
  CommercialResourcePort,
} from './ports.js';
import {
  UnavailablePaymentProvider,
  type PaymentProviderPort,
} from './provider.js';
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
  readonly checkout: CheckoutService;
  readonly checkoutRoutes: CheckoutRoutes;
  readonly database: DatabaseHandle;
  readonly journal: JournalStore;
  readonly offerRepository: OfferRepository;
  readonly offerRoutes: OfferRoutes;
  readonly offers: OfferService;
  readonly paymentRepository: PaymentRepository;
  /** The commercial terms in force. `unpublished` in every deployed environment. */
  readonly policy: CommercePolicy;
  /** The payment adapter. `unavailable` in every deployed environment. */
  readonly provider: PaymentProviderPort;
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

const paymentProviders: Readonly<Record<string, () => PaymentProviderPort>> = {
  [localTestPaymentProvider]: () => new LocalTestPaymentProvider(),
  [unavailablePaymentProvider]: () => new UnavailablePaymentProvider(),
};

export function createBillingRuntime(input: {
  readonly config: ServerConfig;
  readonly consumerContext: ConsumerContextResolver;
  /** The published USERS standing contract, for charging a consumer. */
  readonly consumers: CommercialConsumerPort;
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
  const buildProvider = paymentProviders[input.config.BILLING_PAYMENT_PROVIDER];
  if (buildProvider === undefined) {
    throw new Error(
      `Unknown payment provider: ${input.config.BILLING_PAYMENT_PROVIDER}`,
    );
  }
  const policy = buildPolicy();
  const provider = buildProvider();
  const offerRepository = new OfferRepository(input.database);
  const paymentRepository = new PaymentRepository(input.database);
  const checkout = new CheckoutService({
    consumers: input.consumers,
    now,
    offers: offerRepository,
    payments: paymentRepository,
    policy,
    provider,
    // A provider needs somewhere to send a consumer back to, and Consumer Web
    // is the only surface that may start a purchase. The first configured
    // browser origin is that place; where none is configured, checkout refuses
    // rather than inventing a host.
    returnOrigin: input.config.AUTH_BROWSER_ORIGINS_CONSUMER_WEB[0],
  });
  const offers = new OfferService({
    creators: input.creators,
    now,
    policy,
    repository: offerRepository,
    resources: input.resources,
  });
  return {
    checkout,
    checkoutRoutes: new CheckoutRoutes({
      consumerContext: input.consumerContext,
      service: checkout,
    }),
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
    paymentRepository,
    policy,
    provider,
  };
}
