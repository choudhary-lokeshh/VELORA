import { z } from 'zod';

import { creatorHandleSchema } from './creator.js';
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

export const commercialResourceTypeValues = ['club', 'gift'] as const;
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
    // Gift offers are platform-managed catalog projections. Creator Studio may
    // only create offers for creator-owned clubs.
    resourceType: z.literal('club'),
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
    /**
     * What the charge was for, by opaque reference.
     *
     * The same join the subscription projection publishes and for the same
     * reason: BILLING knows which resource an offer points at and nothing about
     * what that resource is called. Absent only where the offer behind the
     * payment can no longer be read.
     */
    resource: z
      .object({ id: z.uuid(), type: commercialResourceTypeSchema })
      .strict()
      .optional(),
    state: paymentStateSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ConsumerPayment = z.infer<typeof consumerPaymentSchema>;

/**
 * Everything this person has been charged, or nearly charged, newest first.
 *
 * A record of attempts rather than a set of receipts. A receipt is a document
 * with legal weight in a jurisdiction, and what one has to say — the merchant
 * of record, the tax breakdown, the sequence number — is unresolved commercial
 * and tax policy. Publishing this list is honest; calling it a receipt would
 * not be.
 */
export const consumerPaymentListResponseSchema = z
  .object({
    nextCursor: z.string().min(1).max(512).optional(),
    payments: z.array(consumerPaymentSchema).max(100),
  })
  .strict();
export type ConsumerPaymentListResponse = z.infer<
  typeof consumerPaymentListResponseSchema
>;

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
  .object({
    currency: currencyCodeSchema,
    /**
     * How often the chosen price recurs.
     *
     * Required whenever the offer carries more than one live price in this
     * currency, which is what makes "twelve a month" and "a hundred and twenty
     * a year" two purchases rather than an ambiguity. An offer with one price
     * needs none, and a one-time purchase has none to give.
     *
     * The amount is still not in this request. What something costs is read
     * from the price row inside the transaction that records the operation;
     * this only says which of a creator's published cadences was chosen.
     */
    interval: billingIntervalSchema.optional(),
    offerId: offerIdSchema,
  })
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

export const giftVisualValues = [
  'rose',
  'spark',
  'heart',
  'crown',
  'celebration',
  'diamond',
  'star',
  'ribbon',
] as const;
export const giftVisualSchema = z.enum(giftVisualValues);
export const giftTierValues = [
  'small',
  'medium',
  'large',
  'signature',
] as const;
export const giftTierSchema = z.enum(giftTierValues);
export const giftStateValues = [
  'pending',
  'sent',
  'failed',
  'partially_reversed',
  'reversed',
] as const;
export const giftStateSchema = z.enum(giftStateValues);
export const giftIdSchema = z.uuid();
export const giftCatalogItemIdSchema = z.uuid();

export const giftCatalogItemSchema = z
  .object({
    description: z.string().min(1).max(160),
    id: giftCatalogItemIdSchema,
    name: z.string().min(1).max(48),
    price: moneySchema,
    tier: giftTierSchema,
    visual: giftVisualSchema,
  })
  .strict();

export const giftCatalogResponseSchema = z
  .object({
    creator: z.object({ displayName: z.string(), handle: z.string() }).strict(),
    enabled: z.boolean(),
    items: z.array(giftCatalogItemSchema),
  })
  .strict();

export const sendGiftRequestSchema = z
  .object({
    context: z.object({ type: z.literal('creator_profile') }).strict(),
    currency: currencyCodeSchema,
    giftItemId: giftCatalogItemIdSchema,
    handle: creatorHandleSchema,
  })
  .strict();

export const consumerGiftSchema = z
  .object({
    createdAt: z.iso.datetime(),
    creator: z.object({ displayName: z.string(), handle: z.string() }).strict(),
    gift: z
      .object({
        id: giftCatalogItemIdSchema,
        name: z.string(),
        visual: giftVisualSchema,
      })
      .strict(),
    id: giftIdSchema,
    price: moneySchema,
    sentAt: z.iso.datetime().optional(),
    state: giftStateSchema,
  })
  .strict();

export const creatorReceivedGiftSchema = z
  .object({
    createdAt: z.iso.datetime(),
    earning: moneySchema,
    gift: z
      .object({
        id: giftCatalogItemIdSchema,
        name: z.string(),
        visual: giftVisualSchema,
      })
      .strict(),
    gross: moneySchema,
    id: giftIdSchema,
    senderVisibility: z.literal('withheld'),
    sentAt: z.iso.datetime().optional(),
    state: giftStateSchema,
  })
  .strict();

export const consumerGiftListResponseSchema = z
  .object({ gifts: z.array(consumerGiftSchema) })
  .strict();
export const creatorReceivedGiftListResponseSchema = z
  .object({ gifts: z.array(creatorReceivedGiftSchema) })
  .strict();
export const sendGiftResponseSchema = z
  .object({ gift: consumerGiftSchema })
  .strict();
export const giftCatalogProvisionResponseSchema = z
  .object({ offers: z.number().int().min(0) })
  .strict();

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
    /** Present exactly when the relationship has been ended. */
    cancelledAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    currentPeriodEnd: z.iso.datetime().optional(),
    currentPeriodStart: z.iso.datetime().optional(),
    id: z.uuid(),
    /** Present exactly when the offer recurs. */
    interval: billingIntervalSchema.optional(),
    offerId: offerIdSchema,
    /**
     * What was bought, by opaque reference.
     *
     * The identifier and its type, so a surface can join this to the club the
     * owning domain publishes under the same identifier. No name, because
     * BILLING does not have one and inventing one here would put a club's
     * identity in the money contract.
     *
     * Absent only when the offer behind the subscription can no longer be read,
     * which the schema's own foreign keys make unreachable. It is optional
     * rather than defaulted because a guessed resource is a claim about what
     * somebody bought.
     */
    resource: z
      .object({ id: z.uuid(), type: commercialResourceTypeSchema })
      .strict()
      .optional(),
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

/**
 * Ending a subscription from the surface that holds it.
 *
 * There is no `immediate` option and no field that could become one. What
 * happens when somebody cancels is commercial policy, the approved reading of
 * it is that a paid period stays paid, and an option that revoked access early
 * would be taking back something already bought. A consumer schedules the end
 * of renewal; the period ends on its own.
 */
export const cancelSubscriptionRequestSchema = z
  .object({ subscriptionId: z.uuid() })
  .strict();
export type CancelSubscriptionRequest = z.infer<
  typeof cancelSubscriptionRequestSchema
>;

export const consumerSubscriptionResponseSchema = z
  .object({ subscription: consumerSubscriptionSchema })
  .strict();
export type ConsumerSubscriptionResponse = z.infer<
  typeof consumerSubscriptionResponseSchema
>;

/**
 * What a creator currently sells, as a visitor to their page sees it.
 *
 * An allow-list over the same offer and price rows Creator Studio reads, minus
 * everything a stranger has no business with: no draft, no retired offer, no
 * retired price, no version token, no creation instant, no creator identifier.
 * What is left is the identity of the thing, what it costs, and how often.
 *
 * The resource is published by opaque identifier and nothing else. Which club
 * that is, what it is called, and what is inside it are PRIVATE CLUBS' to
 * publish, under the same identifier, through its own route.
 *
 * `readiness` travels with the list rather than being inferred from it. An
 * empty list because no creator published anything and an empty list because
 * the platform may not sell are different facts, and a surface that could not
 * tell them apart would tell somebody the creator has nothing when the truth is
 * that VELORA cannot transact.
 */
export const publicMembershipOfferSchema = z
  .object({
    id: offerIdSchema,
    mode: commercialModeSchema,
    prices: z.array(
      z
        .object({
          amount: moneySchema,
          id: priceIdSchema,
          interval: billingIntervalSchema.optional(),
        })
        .strict(),
    ),
    resource: z
      .object({ id: z.uuid(), type: commercialResourceTypeSchema })
      .strict(),
  })
  .strict();
export type PublicMembershipOffer = z.infer<typeof publicMembershipOfferSchema>;

/**
 * Why this person cannot buy this today, when they cannot.
 *
 * Reported per gate rather than as one refusal, because an operator and a
 * consumer need different parts of the same answer and neither is served by
 * "unavailable". The vocabulary is the eligibility authority's own, restated
 * here so a surface can name the shut gate without guessing at it.
 */
export const commerceGateValues = [
  'consumer_country',
  'creator_country',
  'currency',
  'payment_capability',
  'payout_capability',
  'tax_authority',
] as const;
export const commerceGateSchema = z.enum(commerceGateValues);
export type CommerceGateValue = z.infer<typeof commerceGateSchema>;

export const publicMembershipOfferListResponseSchema = z
  .object({
    /**
     * Every gate that is shut for this viewer and this creator, empty when the
     * pairing is permitted. Present only for a viewer VELORA can evaluate.
     */
    gates: z.array(commerceGateSchema).optional(),
    handle: creatorHandleSchema,
    offers: z.array(publicMembershipOfferSchema).max(50),
    readiness: monetisationReadinessSchema,
    /** The viewer's own live relationships against these offers, if any. */
    subscriptions: z.array(consumerSubscriptionSchema).max(50),
  })
  .strict();
export type PublicMembershipOfferListResponse = z.infer<
  typeof publicMembershipOfferListResponseSchema
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
 * What one kind of thing sold amounted to, within one currency.
 *
 * Gross and reversals only. Both are attributable because every payment names
 * the offer it paid for and every offer names what it sells; the platform's
 * share and the payable are single ledger positions per creator and currency,
 * and splitting either across sources would be an inference rather than a
 * reading. A creator gets the part of the question the records can answer.
 */
export const creatorRevenueSourceSchema = z
  .object({
    gross: minorUnitsSchema,
    reversed: minorUnitsSchema,
    source: commercialResourceTypeSchema,
  })
  .strict();
export type CreatorRevenueSource = z.infer<typeof creatorRevenueSourceSchema>;

/**
 * What one currency of a creator's earnings amounts to.
 *
 * Six figures, one currency, and no total. A creator who sold in euros and yen
 * has two of these and never a third that adds them up: a sum across currencies
 * is a number with no meaning that somebody would plan against.
 *
 * `sources` splits two of the six by what was sold. It adds no new money to the
 * answer and is not a seventh figure.
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
     * `gross` and `reversed` again, split by what was sold.
     *
     * A source with no history is absent rather than zero, and what is present
     * sums exactly to the two totals above — the resource type is a closed,
     * non-null enum, so no sale falls outside the split.
     */
    sources: z.array(creatorRevenueSourceSchema).max(8),
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
    /** What was sold. Not who bought it, and not which club it was. */
    source: commercialResourceTypeSchema,
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

/**
 * One dispute, as an operator sees it.
 *
 * The evidence deadline is present exactly when the provider gave one. Velora
 * never invents it: a deadline nobody published would be a date an operator
 * would plan around.
 */
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

/**
 * One dispute as the operator answering it sees it.
 *
 * The provider's own reference is published here and nowhere else in this
 * contract, because answering a claim means quoting it to the provider and an
 * operator who cannot name the case cannot work it. Nothing about the
 * cardholder appears: a dispute is about a payment, and who made that payment
 * is a consumer identity that a finance queue has no business grouping by.
 *
 * There is no evidence field and no submission action. Whether Velora may
 * submit evidence, in what form, and through which provider is unresolved, and
 * a control that accepted a file and did nothing with it would be worse than
 * its absence.
 */
export const adminDisputeSchema = disputeSchema
  .extend({ providerReference: z.string().min(1).max(200) })
  .strict();
export type AdminDispute = z.infer<typeof adminDisputeSchema>;

export const adminDisputeListResponseSchema = z
  .object({
    disputes: z.array(adminDisputeSchema).max(100),
    nextCursor: z.string().min(1).max(512).optional(),
    /** Whether evidence submission exists at all in this environment. */
    readiness: monetisationReadinessSchema,
  })
  .strict();
export type AdminDisputeListResponse = z.infer<
  typeof adminDisputeListResponseSchema
>;

/**
 * How far a creator has got with a payout provider's own onboarding.
 *
 * Normalized from whatever a provider calls it, and deliberately coarse.
 * Velora holds a reference to the provider's record and this answer; it does
 * not hold, and has no field for, a bank account number, a routing number, a
 * government identifier, or an identity document.
 */
export const payoutRecipientStatusValues = [
  'absent',
  'onboarding',
  'ready',
  'restricted',
] as const;
export const payoutRecipientStatusSchema = z.enum(payoutRecipientStatusValues);
export type PayoutRecipientStatusValue = z.infer<
  typeof payoutRecipientStatusSchema
>;

/**
 * What one currency of a creator's payout balance looks like.
 *
 * Four figures and no total, for the same reason earnings carry none: the sum
 * of two currencies is not an amount. `releasable` is what approved payout
 * terms would let go right now and is zero wherever no terms are published,
 * which is what makes a payout control refuse honestly instead of failing.
 */
export const creatorPayoutBalanceSchema = z
  .object({
    available: minorUnitsSchema,
    currency: currencyCodeSchema,
    held: minorUnitsSchema,
    releasable: minorUnitsSchema,
    reserved: minorUnitsSchema,
  })
  .strict();
export type CreatorPayoutBalance = z.infer<typeof creatorPayoutBalanceSchema>;

/**
 * Whether this creator could be paid at all, and what they hold.
 *
 * The two refusal reasons are reported separately on purpose. A creator whose
 * provider record is fine but whose platform has published no settlement terms
 * is in a different position from one who has not finished onboarding, and
 * collapsing the two would tell both of them to do the wrong thing.
 */
export const creatorPayoutReadinessResponseSchema = z
  .object({
    balances: z.array(creatorPayoutBalanceSchema),
    enabled: z.boolean(),
    /** Which payout terms are in force. `unpublished` in every deployed environment. */
    policySource: z.string().min(1).max(64),
    /** Which payout adapter is configured. `unavailable` in every deployed environment. */
    providerSource: z.string().min(1).max(64),
    recipientStatus: payoutRecipientStatusSchema,
  })
  .strict();
export type CreatorPayoutReadinessResponse = z.infer<
  typeof creatorPayoutReadinessResponseSchema
>;

/**
 * A link into the provider's own hosted onboarding.
 *
 * A URL and a status. Velora collects nothing itself: the bank details and the
 * identity documents are gathered, verified, and retained by the provider,
 * under the provider's own compliance obligations, and Velora keeps a reference
 * to the record they belong to.
 */
export const payoutOnboardingResponseSchema = z
  .object({
    onboardingUrl: z.url(),
    recipientStatus: payoutRecipientStatusSchema,
  })
  .strict();
export type PayoutOnboardingResponse = z.infer<
  typeof payoutOnboardingResponseSchema
>;

/**
 * The states one payout instruction can hold.
 *
 * `submitted` is where an ambiguous answer lands. A payout whose answer was
 * lost has either moved money or not, and guessing either way is how a platform
 * pays somebody twice.
 */
export const payoutStateValues = [
  'requested',
  'reserved',
  'submitted',
  'paid',
  'failed',
  'cancelled',
  'reversed',
] as const;
export const payoutStateSchema = z.enum(payoutStateValues);
export type PayoutStateValue = z.infer<typeof payoutStateSchema>;

export const payoutFailureReasonValues = [
  'recipient_not_ready',
  'declined',
  'provider_error',
] as const;
export const payoutFailureReasonSchema = z.enum(payoutFailureReasonValues);

/**
 * One payout instruction, as the creator it belongs to may see it.
 *
 * The provider's own reference is present exactly when the provider has given
 * one, which is from the moment it accepted the instruction. It is published
 * here because this is the creator's own payout and the reference is what they
 * would have to quote to chase it — the same reason an operator answering a
 * dispute is given the case reference and nothing else about it. Velora never
 * invents one: an instruction the provider has not yet answered for carries no
 * reference rather than a placeholder somebody would try to look up.
 */
export const creatorPayoutSchema = z
  .object({
    amount: moneySchema,
    createdAt: z.iso.datetime(),
    failureReason: payoutFailureReasonSchema.optional(),
    id: z.uuid(),
    providerReference: z.string().min(1).max(200).optional(),
    state: payoutStateSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type CreatorPayout = z.infer<typeof creatorPayoutSchema>;

export const payoutResponseSchema = z
  .object({ payout: creatorPayoutSchema })
  .strict();
export type PayoutResponse = z.infer<typeof payoutResponseSchema>;

export const creatorPayoutHistoryResponseSchema = z
  .object({ payouts: z.array(creatorPayoutSchema) })
  .strict();
export type CreatorPayoutHistoryResponse = z.infer<
  typeof creatorPayoutHistoryResponseSchema
>;

/**
 * Asking to be paid.
 *
 * The amount and currency are both explicit and both re-checked against what
 * the ledger says the creator may claim. There is no "pay me everything"
 * request, because what "everything" means depends on when it is evaluated and
 * a creator is entitled to know the figure they asked for.
 */
export const requestPayoutRequestSchema = z
  .object({
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
  })
  .strict();
export type RequestPayoutRequest = z.infer<typeof requestPayoutRequestSchema>;
