import { z } from 'zod';

import {
  currencyCodeSchema,
  minorUnitsSchema,
  moneySchema,
  positiveMinorUnitsSchema,
} from './money.js';

/**
 * BILLING wire vocabulary.
 *
 * What a creator offers, and what it costs, are separate things with separate
 * lifecycles: `docs/domains/billing.md` gives BILLING the offer and the
 * immutable price snapshot, and gives PRIVATE CLUBS the access decision. That
 * split is why nothing here describes membership, content, or entitlement — and
 * why nothing in the PRIVATE CLUBS contract describes money.
 *
 * Nothing here is a commercial term either. There is no platform fee, no
 * revenue share, no default currency, no minimum price, and no free trial:
 * every one of those is an unresolved decision in
 * `docs/decisions/DECISIONS_REQUIRED.md`, and a field that carried a default
 * would be a term nobody approved.
 */

export const commercialModeValues = ['subscription', 'one_time'] as const;
export const commercialModeSchema = z.enum(commercialModeValues);
export type CommercialModeValue = z.infer<typeof commercialModeSchema>;

export const billingIntervalValues = ['month', 'year'] as const;
export const billingIntervalSchema = z.enum(billingIntervalValues);
export type BillingIntervalValue = z.infer<typeof billingIntervalSchema>;

export const commercialResourceTypeValues = ['club'] as const;
export const commercialResourceTypeSchema = z.enum(
  commercialResourceTypeValues,
);
export type CommercialResourceTypeValue = z.infer<
  typeof commercialResourceTypeSchema
>;

export const offerStateValues = ['draft', 'active', 'retired'] as const;
export const offerStateSchema = z.enum(offerStateValues);
export type OfferStateValue = z.infer<typeof offerStateSchema>;

export const priceStateValues = ['active', 'retired'] as const;
export const priceStateSchema = z.enum(priceStateValues);
export type PriceStateValue = z.infer<typeof priceStateSchema>;

export const offerIdSchema = z.uuid();
export const priceIdSchema = z.uuid();

/**
 * What the platform can currently sell, stated plainly.
 *
 * A surface reads `enabled` and says so. It never renders a price field, a
 * purchase action, or a currency selector against an empty policy, because a
 * form that cannot succeed is worse than an explanation of why.
 */
export const monetisationReadinessSchema = z
  .object({
    currencies: z.array(currencyCodeSchema),
    enabled: z.boolean(),
    intervals: z.array(billingIntervalSchema),
    modes: z.array(commercialModeSchema),
    /** Which policy is in force. `unpublished` in every deployed environment. */
    source: z.string().min(1).max(64),
  })
  .strict();
export type MonetisationReadinessResponse = z.infer<
  typeof monetisationReadinessSchema
>;

/**
 * One price, frozen.
 *
 * The amount travels as minor units plus its currency, never as a formatted
 * string and never as a JSON number. A surface renders it against the published
 * currency exponent; nothing downstream re-derives what it means.
 */
export const commercialPriceSchema = z
  .object({
    amount: moneySchema,
    createdAt: z.iso.datetime(),
    effectiveFrom: z.iso.datetime(),
    id: priceIdSchema,
    /** Present exactly when the offer recurs. */
    interval: billingIntervalSchema.optional(),
    retiredAt: z.iso.datetime().optional(),
    state: priceStateSchema,
  })
  .strict();
export type CommercialPrice = z.infer<typeof commercialPriceSchema>;

export const commercialOfferSchema = z
  .object({
    activatedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    id: offerIdSchema,
    mode: commercialModeSchema,
    prices: z.array(commercialPriceSchema),
    resourceId: z.uuid(),
    resourceType: commercialResourceTypeSchema,
    retiredAt: z.iso.datetime().optional(),
    state: offerStateSchema,
    updatedAt: z.iso.datetime(),
    /** Optimistic concurrency token; a stale lifecycle change is refused. */
    version: z.number().int().min(1),
  })
  .strict();
export type CommercialOffer = z.infer<typeof commercialOfferSchema>;

export const commercialOfferListResponseSchema = z
  .object({
    nextCursor: z.string().optional(),
    offers: z.array(commercialOfferSchema),
    readiness: monetisationReadinessSchema,
  })
  .strict();
export type CommercialOfferListResponse = z.infer<
  typeof commercialOfferListResponseSchema
>;

export const commercialOfferResponseSchema = z
  .object({ offer: commercialOfferSchema })
  .strict();
export type CommercialOfferResponse = z.infer<
  typeof commercialOfferResponseSchema
>;

export const createCommercialOfferRequestSchema = z
  .object({
    mode: commercialModeSchema,
    resourceId: z.uuid(),
    resourceType: commercialResourceTypeSchema,
  })
  .strict();
export type CreateCommercialOfferRequest = z.infer<
  typeof createCommercialOfferRequestSchema
>;

/**
 * Publishing a price.
 *
 * The amount is a strictly positive decimal string of minor units, so no client
 * ever sends a fractional value, a negative price, or a free one by accident,
 * and no double ever touches it. Which currencies and cadences are acceptable
 * comes from readiness; the server re-checks both against approved policy and
 * refuses whatever the client believed.
 */
export const publishCommercialPriceRequestSchema = z
  .object({
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
    interval: billingIntervalSchema.optional(),
    offerId: offerIdSchema,
  })
  .strict();
export type PublishCommercialPriceRequest = z.infer<
  typeof publishCommercialPriceRequestSchema
>;

export const retireCommercialPriceRequestSchema = z
  .object({ offerId: offerIdSchema, priceId: priceIdSchema })
  .strict();
export type RetireCommercialPriceRequest = z.infer<
  typeof retireCommercialPriceRequestSchema
>;

/**
 * The states one payment operation can hold, as a consumer surface sees them.
 *
 * Six answers rather than a paid flag. `reconciliation_pending` is the one that
 * matters most: it says the provider's answer was lost, so the platform does
 * not know yet — which is a truthful thing to show somebody and the only
 * honest alternative to guessing.
 */
export const paymentStateValues = [
  'created',
  'provider_pending',
  'requires_action',
  'succeeded',
  'failed',
  'cancelled',
  'reconciliation_pending',
] as const;
export const paymentStateSchema = z.enum(paymentStateValues);
export type PaymentStateValue = z.infer<typeof paymentStateSchema>;

export const paymentFailureReasonValues = [
  'declined',
  'cancelled_by_consumer',
  'expired',
  'provider_error',
] as const;
export const paymentFailureReasonSchema = z.enum(paymentFailureReasonValues);

export const paymentIdSchema = z.uuid();

/**
 * One payment, as the person making it may see it.
 *
 * No provider reference, no provider status string, no instrument detail, and
 * nothing about the payment method. A consumer learns what they are buying,
 * what it costs, and where the attempt got to.
 */
export const consumerPaymentSchema = z
  .object({
    amount: moneySchema,
    createdAt: z.iso.datetime(),
    failureReason: paymentFailureReasonSchema.optional(),
    id: paymentIdSchema,
    offerId: offerIdSchema,
    state: paymentStateSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ConsumerPayment = z.infer<typeof consumerPaymentSchema>;

/**
 * Starting a purchase.
 *
 * The currency is explicit rather than inferred, because an offer may carry
 * more than one live price and guessing which one somebody meant to pay is the
 * kind of convenience that shows one amount and charges another. There is no
 * amount in this request at all: what something costs is server truth, read
 * from the price row inside the transaction that records the operation.
 */
export const startCheckoutRequestSchema = z
  .object({ currency: currencyCodeSchema, offerId: offerIdSchema })
  .strict();
export type StartCheckoutRequest = z.infer<typeof startCheckoutRequestSchema>;

export const checkoutResponseSchema = z
  .object({
    payment: consumerPaymentSchema,
    /**
     * The provider-hosted page to complete payment on, when this call created
     * one. Absent on a replay and absent whenever the provider produced none.
     *
     * Reaching it is not a purchase and returning from it is not a receipt: the
     * return route reads server state, and nothing a browser does advances a
     * payment.
     */
    redirectUrl: z.url().optional(),
  })
  .strict();
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

/**
 * What a provider webhook is told.
 *
 * One field, and the same answer for a first delivery and a redelivery. A
 * provider that got a different answer for a repeat would learn which of its
 * events Velora had already seen, and has no use for that.
 */
export const providerEventAcknowledgementSchema = z
  .object({ received: z.literal(true) })
  .strict();
export type ProviderEventAcknowledgement = z.infer<
  typeof providerEventAcknowledgementSchema
>;

/**
 * A subscription, as the person holding it may see it.
 *
 * `past_due` appears here and grants nothing. Whether a lapsed payment keeps
 * access, and for how long, is grace policy nobody has approved, and the
 * fail-closed reading of an unresolved policy is no access. A surface says
 * exactly that rather than implying a grace period exists.
 */
export const subscriptionStateValues = [
  'pending',
  'active',
  'past_due',
  'cancel_at_period_end',
  'cancelled',
  'terminated',
] as const;
export const subscriptionStateSchema = z.enum(subscriptionStateValues);
export type SubscriptionStateValue = z.infer<typeof subscriptionStateSchema>;

export const consumerSubscriptionSchema = z
  .object({
    amount: moneySchema,
    createdAt: z.iso.datetime(),
    currentPeriodEnd: z.iso.datetime().optional(),
    id: z.uuid(),
    offerId: offerIdSchema,
    state: subscriptionStateSchema,
  })
  .strict();
export type ConsumerSubscription = z.infer<typeof consumerSubscriptionSchema>;

export const consumerSubscriptionListResponseSchema = z
  .object({ subscriptions: z.array(consumerSubscriptionSchema) })
  .strict();
export type ConsumerSubscriptionListResponse = z.infer<
  typeof consumerSubscriptionListResponseSchema
>;

export const commercialOfferLifecycleValues = ['active', 'retired'] as const;
export const commercialOfferLifecycleSchema = z.enum(
  commercialOfferLifecycleValues,
);

export const commercialOfferLifecycleRequestSchema = z
  .object({
    offerId: offerIdSchema,
    state: commercialOfferLifecycleSchema,
    /** The version the caller believes it is changing. */
    version: z.number().int().min(1),
  })
  .strict();
export type CommercialOfferLifecycleRequest = z.infer<
  typeof commercialOfferLifecycleRequestSchema
>;

/**
 * The states one refund can hold.
 *
 * The same six-answer discipline a payment gets, for the same reason: a refund
 * whose provider answer was lost is neither issued nor refused, and collapsing
 * that into either would either return money twice or tell somebody they were
 * repaid when they were not.
 *
 * There is no `cancelled`. A refund exists because an operator decided to
 * reverse a charge; abandoning one after the instruction is in flight would
 * mean guessing what the provider did with it, which is precisely what
 * `reconciliation_pending` refuses to do.
 */
export const refundStateValues = [
  'requested',
  'provider_pending',
  'succeeded',
  'failed',
  'reconciliation_pending',
] as const;
export const refundStateSchema = z.enum(refundStateValues);
export type RefundStateValue = z.infer<typeof refundStateSchema>;

/**
 * Why an operator reversed a charge.
 *
 * `v1-provisional`, and deliberately not a refund policy. Refund eligibility —
 * who may ask, within what window, for what proportion — is unresolved in
 * `docs/decisions/DECISIONS_REQUIRED.md` and is not decided by this list. What
 * this records is the reason the operator gave, which an audit needs whatever
 * the eventual policy turns out to be.
 */
export const refundReasonCodeValues = [
  'duplicate_charge',
  'not_delivered',
  'operator_correction',
  'dispute_resolution',
] as const;
export const refundReasonCodeSchema = z.enum(refundReasonCodeValues);
export type RefundReasonCodeValue = z.infer<typeof refundReasonCodeSchema>;

/** Why a refund did not go through, in Velora's vocabulary. */
export const refundFailureReasonValues = [
  'declined',
  'provider_error',
] as const;
export const refundFailureReasonSchema = z.enum(refundFailureReasonValues);

export const refundIdSchema = z.uuid();
export const disputeIdSchema = z.uuid();

/**
 * One refund, as an operator sees it.
 *
 * No provider reference, no provider status string, and no operator name. The
 * actor is an opaque session reference on the row itself, which an audit can
 * follow and a screen has no use for.
 */
export const refundSchema = z
  .object({
    amount: moneySchema,
    createdAt: z.iso.datetime(),
    failureReason: refundFailureReasonSchema.optional(),
    id: refundIdSchema,
    paymentId: paymentIdSchema,
    reasonCode: refundReasonCodeSchema,
    state: refundStateSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Refund = z.infer<typeof refundSchema>;

/**
 * Asking for a reversal.
 *
 * The amount and currency are both explicit and both re-checked against the
 * captured payment. A request that omitted the amount and meant "all of it"
 * would be a different instruction depending on when it was evaluated, and a
 * request that omitted the currency would let a partial refund of a JPY charge
 * be read as minor units of something else.
 */
export const issueRefundRequestSchema = z
  .object({
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
    paymentId: paymentIdSchema,
    reasonCode: refundReasonCodeSchema,
  })
  .strict();
export type IssueRefundRequest = z.infer<typeof issueRefundRequestSchema>;

export const refundResponseSchema = z.object({ refund: refundSchema }).strict();
export type RefundResponse = z.infer<typeof refundResponseSchema>;

/**
 * A dispute's lifecycle, in Velora's vocabulary rather than a provider's.
 *
 * `won` and `lost` are stated from the platform's side and describe where the
 * money ended up: `lost` means the provider returned it to the cardholder, so
 * it is a reversal with the same financial consequence as a full refund.
 * `withdrawn` is the cardholder standing the claim down, which leaves the sale
 * intact.
 */
export const disputeStateValues = [
  'opened',
  'under_review',
  'won',
  'lost',
  'withdrawn',
] as const;
export const disputeStateSchema = z.enum(disputeStateValues);
export type DisputeStateValue = z.infer<typeof disputeStateSchema>;

/**
 * Why a cardholder disputed, normalized from whatever a provider calls it.
 *
 * `v1-provisional`. Every provider publishes its own reason vocabulary and none
 * of them agree; mapping happens in an adapter so a provider that renames a
 * reason changes an adapter rather than Velora's records.
 */
export const disputeReasonCodeValues = [
  'unrecognized',
  'product_not_received',
  'product_unacceptable',
  'duplicate',
  'fraudulent',
  'subscription_cancelled',
  'other',
] as const;
export const disputeReasonCodeSchema = z.enum(disputeReasonCodeValues);
export type DisputeReasonCodeValue = z.infer<typeof disputeReasonCodeSchema>;

/**
 * One dispute, as an operator sees it.
 *
 * The evidence deadline is present exactly when the provider gave one. Velora
 * never invents it: a deadline nobody published would be a date an operator
 * would plan around.
 */
/**
 * What one currency of a creator's earnings amounts to.
 *
 * Six figures, one currency, and no total. A creator who sold in euros and yen
 * has two of these and never a third that adds them up: a sum across currencies
 * is a number with no meaning that somebody would plan against.
 *
 * `payable` is the only authoritative figure — it is a balance derived from the
 * ledger on every read. The rest are projections over the commercial records
 * that produced those ledger entries, computed on read and therefore rebuildable
 * by construction. Nothing here is a forecast, a trend, or a projection of
 * future income; every number describes money that has already moved.
 */
export const creatorCurrencyEarningsSchema = z
  .object({
    currency: currencyCodeSchema,
    /** Claimed back by a cardholder and not yet resolved either way. */
    disputed: minorUnitsSchema,
    /** What consumers paid, before anything was taken out of it. */
    gross: minorUnitsSchema,
    /** The authoritative balance: what the platform owes this creator. */
    payable: minorUnitsSchema,
    /** What the platform kept under approved terms. */
    platform: minorUnitsSchema,
    /** Returned to consumers, by refund or by a lost dispute. */
    reversed: minorUnitsSchema,
    /**
     * Withheld against a tax authority.
     *
     * Zero everywhere, and that is a statement about what Velora withheld
     * rather than about what any creator owes. No tax authority is configured
     * and no policy in this repository computes one.
     */
    tax: minorUnitsSchema,
  })
  .strict();
export type CreatorCurrencyEarnings = z.infer<
  typeof creatorCurrencyEarningsSchema
>;

export const creatorEarningsResponseSchema = z
  .object({
    /** One entry per currency this creator has ever been paid in. */
    currencies: z.array(creatorCurrencyEarningsSchema),
    readiness: monetisationReadinessSchema,
  })
  .strict();
export type CreatorEarningsResponse = z.infer<
  typeof creatorEarningsResponseSchema
>;

export const creatorEarningsEntryKindValues = [
  'capture',
  'dispute',
  'refund',
] as const;
export const creatorEarningsEntryKindSchema = z.enum(
  creatorEarningsEntryKindValues,
);

/**
 * One commercial event in a creator's history.
 *
 * Deliberately thin on the consumer side: a creator learns what was bought,
 * when, for how much, and what happened to it. Who bought it is not theirs to
 * know, so no consumer identifier, name, or contact detail appears here.
 */
export const creatorEarningsEntrySchema = z
  .object({
    amount: moneySchema,
    id: z.uuid(),
    kind: creatorEarningsEntryKindSchema,
    occurredAt: z.iso.datetime(),
    offerId: offerIdSchema,
    /** The lifecycle of the payment, refund, or dispute this describes. */
    state: z.string().min(1).max(32),
  })
  .strict();
export type CreatorEarningsEntry = z.infer<typeof creatorEarningsEntrySchema>;

export const creatorEarningsHistoryResponseSchema = z
  .object({
    currency: currencyCodeSchema,
    entries: z.array(creatorEarningsEntrySchema),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type CreatorEarningsHistoryResponse = z.infer<
  typeof creatorEarningsHistoryResponseSchema
>;

export const disputeSchema = z
  .object({
    amount: moneySchema,
    createdAt: z.iso.datetime(),
    evidenceDueAt: z.iso.datetime().optional(),
    id: disputeIdSchema,
    openedAt: z.iso.datetime(),
    paymentId: paymentIdSchema,
    reasonCode: disputeReasonCodeSchema,
    resolvedAt: z.iso.datetime().optional(),
    state: disputeStateSchema,
  })
  .strict();
export type Dispute = z.infer<typeof disputeSchema>;
