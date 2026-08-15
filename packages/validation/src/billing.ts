import { z } from 'zod';

import {
  currencyCodeSchema,
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
