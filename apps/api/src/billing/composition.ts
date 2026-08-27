import {
  localTestCommerceEligibility,
  localTestCommercePolicy,
  localTestPaymentProvider,
  localTestTaxAuthority,
  unavailableCommerceEligibility,
  unavailablePaymentProvider,
  unavailableTaxAuthority,
  unpublishedCommercePolicy,
  type ServerConfig,
} from '@velora/config/server';

import type { SafeLogger } from '@velora/observability/server';

import type { CreatorContextResolver } from '../creators/context.js';
import type { DatabaseHandle } from '../database/executor.js';
import { OutboxRepository } from '../events/outbox.js';
import { JournalStore } from '../money/journal.js';
import type { ConsumerContextResolver } from '../users/context.js';
import type { SafetyDirectoryPort } from '../safety/directory.js';
import { CheckoutRoutes } from './checkout-routes.js';
import { CheckoutService } from './checkout-service.js';
import {
  LocalTestCommerceEligibility,
  UnavailableCommerceEligibility,
  type CommerceEligibility,
} from './commerce-eligibility.js';
import {
  LocalTestCommercePolicy,
  UnpublishedCommercePolicy,
  type CommercePolicy,
} from './commerce-policy.js';
import { DisputeRepository } from './dispute-repository.js';
import { EarningsRepository } from './earnings-repository.js';
import { EarningsRoutes } from './earnings-routes.js';
import { DisputeService } from './dispute-service.js';
import { LocalTestCheckoutTransport } from './local-test-checkout.js';
import { LocalTestPaymentProvider } from './local-test-provider.js';
import { MembershipRoutes } from './membership-routes.js';
import { MembershipService } from './membership-service.js';
import { OfferRepository } from './offer-repository.js';
import { OfferRoutes } from './offer-routes.js';
import { OfferService } from './offer-service.js';
import { ProviderEventRepository } from './event-repository.js';
import { PaymentRepository } from './payment-repository.js';
import { BillingReconciliation } from './reconciliation.js';
import { RefundRepository } from './refund-repository.js';
import { RefundService } from './refund-service.js';
import { SubscriptionRepository } from './subscription-repository.js';
import { SubscriptionService } from './subscription-service.js';
import {
  LocalTestTaxAuthority,
  UnavailableTaxAuthority,
  type TaxAuthorityPort,
} from './tax.js';
import { WebhookRoutes } from './webhook-routes.js';
import { WebhookService } from './webhook-service.js';
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
import { billingJournalTables, billingOutbox } from './schema.js';
import { GiftRepository } from './gift-repository.js';
import { GiftService } from './gift-service.js';
import { GiftRoutes } from './gift-routes.js';

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
  readonly disputeRepository: DisputeRepository;
  readonly disputes: DisputeService;
  /** Ledger-derived creator financial views. Authoritative payable, projections beside it. */
  readonly earnings: EarningsRepository;
  readonly earningsRoutes: EarningsRoutes;
  readonly eventRepository: ProviderEventRepository;
  readonly journal: JournalStore;
  readonly giftRepository: GiftRepository;
  readonly gifts: GiftService;
  readonly giftRoutes: GiftRoutes;
  /** BILLING's transactional outbox, drained by the shared relay. */
  readonly outbox: OutboxRepository;
  readonly membershipRoutes: MembershipRoutes;
  readonly memberships: MembershipService;
  readonly offerRepository: OfferRepository;
  readonly offerRoutes: OfferRoutes;
  readonly offers: OfferService;
  readonly paymentRepository: PaymentRepository;
  /** The country and capability authority. `unavailable` in every deployed environment. */
  readonly eligibility: CommerceEligibility;
  /** The commercial terms in force. `unpublished` in every deployed environment. */
  readonly policy: CommercePolicy;
  /** The tax authority. `unavailable` in every deployed environment. */
  readonly tax: TaxAuthorityPort;
  /** The payment adapter. `unavailable` in every deployed environment. */
  readonly provider: PaymentProviderPort;
  /**
   * The local-test adapter's own hosted page, when that adapter is the one
   * configuration built. Absent everywhere else, so there is nothing to
   * register and nothing to reach.
   */
  readonly localCheckout: LocalTestCheckoutTransport | undefined;
  /** Resolves ambiguous outcomes from provider truth. Runs on the worker only. */
  readonly reconciliation: BillingReconciliation;
  readonly refundRepository: RefundRepository;
  /** Reversal orchestration. Operator-driven only; no consumer path reaches it. */
  readonly refunds: RefundService;
  readonly subscriptionRepository: SubscriptionRepository;
  /** Consumer cancellation and the period-end sweep. No provider is involved. */
  readonly subscriptions: SubscriptionService;
  readonly webhookRoutes: WebhookRoutes;
  readonly webhooks: WebhookService;
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

const commerceEligibilities: Readonly<
  Record<string, () => CommerceEligibility>
> = {
  [localTestCommerceEligibility]: () => new LocalTestCommerceEligibility(),
  [unavailableCommerceEligibility]: () => new UnavailableCommerceEligibility(),
};

const taxAuthorities: Readonly<Record<string, () => TaxAuthorityPort>> = {
  [localTestTaxAuthority]: () => new LocalTestTaxAuthority(),
  [unavailableTaxAuthority]: () => new UnavailableTaxAuthority(),
};

const paymentProviders: Readonly<
  Record<string, (now: () => Date) => PaymentProviderPort>
> = {
  [localTestPaymentProvider]: (now) => new LocalTestPaymentProvider(now),
  [unavailablePaymentProvider]: () => new UnavailablePaymentProvider(),
};

export function createBillingRuntime(input: {
  readonly config: ServerConfig;
  /** Identifies this process when it claims a provider event. */
  readonly eventOwner?: string;
  readonly logger?: SafeLogger;
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
  /** TRUST & SAFETY's current pair-interaction answer. */
  readonly safety?: SafetyDirectoryPort;
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
  const buildEligibility =
    commerceEligibilities[input.config.BILLING_COMMERCE_ELIGIBILITY];
  if (buildEligibility === undefined) {
    throw new Error(
      `Unknown commerce eligibility: ${input.config.BILLING_COMMERCE_ELIGIBILITY}`,
    );
  }
  const buildTax = taxAuthorities[input.config.BILLING_TAX_AUTHORITY];
  if (buildTax === undefined) {
    throw new Error(
      `Unknown tax authority: ${input.config.BILLING_TAX_AUTHORITY}`,
    );
  }
  const policy = buildPolicy();
  const provider = buildProvider(now);
  const eligibility = buildEligibility();
  const tax = buildTax();
  const offerRepository = new OfferRepository(input.database);
  const paymentRepository = new PaymentRepository(input.database);
  const eventRepository = new ProviderEventRepository(input.database);
  const subscriptionRepository = new SubscriptionRepository(input.database);
  const refundRepository = new RefundRepository(input.database);
  const disputeRepository = new DisputeRepository(input.database);
  const giftRepository = new GiftRepository(input.database);
  const outbox = new OutboxRepository(input.database, billingOutbox);
  const journal = new JournalStore({
    now,
    prefix: billingJournalPrefix,
    tables: billingJournalTables,
  });
  const earnings = new EarningsRepository(input.database, journal);
  const logger: SafeLogger = input.logger ?? {
    debug: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    info: () => undefined,
    trace: () => undefined,
    warn: () => undefined,
  };
  const refunds = new RefundService({
    gifts: giftRepository,
    journal,
    now,
    offers: offerRepository,
    outbox,
    payments: paymentRepository,
    policy,
    provider,
    refunds: refundRepository,
  });
  const disputes = new DisputeService({
    disputes: disputeRepository,
    gifts: giftRepository,
    journal,
    now,
    offers: offerRepository,
    outbox,
    policy,
    refunds: refundRepository,
  });
  const webhooks = new WebhookService({
    disputeService: disputes,
    disputes: disputeRepository,
    events: eventRepository,
    journal,
    gifts: giftRepository,
    logger,
    now,
    offers: offerRepository,
    outbox,
    owner: input.eventOwner ?? 'billing-api',
    payments: paymentRepository,
    policy,
    provider,
    refundService: refunds,
    refunds: refundRepository,
    subscriptions: subscriptionRepository,
  });
  const reconciliation = new BillingReconciliation({
    logger,
    now,
    payments: paymentRepository,
    provider,
    refundService: refunds,
    refunds: refundRepository,
    // Long enough that an ordinary provider round trip is never mistaken for a
    // lost one, and short enough that a person is not the first to notice. It
    // is an operational constant rather than a commercial term.
    staleAfterMilliseconds: 60_000,
    webhooks,
  });
  const checkout = new CheckoutService({
    consumers: input.consumers,
    creators: input.creators,
    disputes: disputeRepository,
    gifts: giftRepository,
    eligibility,
    now,
    offers: offerRepository,
    payments: paymentRepository,
    policy,
    provider,
    ...(input.safety === undefined ? {} : { safety: input.safety }),
    // A provider needs somewhere to send a consumer back to, and Consumer Web
    // is the only surface that may start a purchase. The first configured
    // browser origin is that place; where none is configured, checkout refuses
    // rather than inventing a host.
    returnOrigin: input.config.AUTH_BROWSER_ORIGINS_CONSUMER_WEB[0],
    tax,
  });
  const offers = new OfferService({
    creators: input.creators,
    now,
    policy,
    repository: offerRepository,
    resources: input.resources,
  });
  const subscriptions = new SubscriptionService({
    logger,
    now,
    offers: offerRepository,
    outbox,
    subscriptions: subscriptionRepository,
  });
  const memberships = new MembershipService({
    consumers: input.consumers,
    creators: input.creators,
    eligibility,
    now,
    offerService: offers,
    offers: offerRepository,
    policy,
    subscriptions: subscriptionRepository,
  });
  const gifts = new GiftService({
    checkout,
    consumers: input.consumers,
    creators: input.creators,
    gifts: giftRepository,
    journal,
    now,
    provider,
    ...(input.safety === undefined ? {} : { safety: input.safety }),
    webhooks,
  });
  // The adapter borrows the API's own origin for its hosted page, exactly as
  // the local-test media transport does. Where no API base URL is configured it
  // keeps its unreachable address: a redirect nobody can follow is a better
  // answer than one pointing at a host nobody approved.
  if (provider instanceof LocalTestPaymentProvider) {
    provider.hostCheckoutAt(
      `http://${input.config.HOST}:${String(input.config.PORT)}`,
    );
  }
  return {
    checkout,
    checkoutRoutes: new CheckoutRoutes({
      consumerContext: input.consumerContext,
      offers: offerRepository,
      service: checkout,
      subscriptionService: subscriptions,
      subscriptions: subscriptionRepository,
    }),
    database: input.database,
    disputeRepository,
    disputes,
    earnings,
    eligibility,
    earningsRoutes: new EarningsRoutes({
      creatorContext: input.creatorContext,
      earnings,
      policy,
    }),
    eventRepository,
    journal,
    giftRepository,
    giftRoutes: new GiftRoutes({
      consumerContext: input.consumerContext,
      creatorContext: input.creatorContext,
      service: gifts,
    }),
    gifts,
    localCheckout:
      provider instanceof LocalTestPaymentProvider
        ? new LocalTestCheckoutTransport({ provider, webhooks })
        : undefined,
    membershipRoutes: new MembershipRoutes({
      consumerContext: input.consumerContext,
      service: memberships,
    }),
    memberships,
    offerRepository,
    offerRoutes: new OfferRoutes({
      creatorContext: input.creatorContext,
      service: offers,
    }),
    offers,
    outbox,
    paymentRepository,
    policy,
    provider,
    reconciliation,
    refundRepository,
    refunds,
    subscriptionRepository,
    subscriptions,
    tax,
    webhookRoutes: new WebhookRoutes({ service: webhooks }),
    webhooks,
  };
}
