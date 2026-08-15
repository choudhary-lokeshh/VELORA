/**
 * The payment-operation vocabulary, restated for the schema.
 *
 * Same rule as every other policy module here: `drizzle-kit` cannot import the
 * ESM-only contract package while generating migrations, so the values a CHECK
 * needs live here and a unit test asserts they match what `@velora/validation`
 * publishes.
 */

/**
 * The states one payment operation can hold.
 *
 * Deliberately not a boolean. `docs/flows/payment-lifecycle.md` requires the
 * difference between "we have not asked yet", "we asked and are waiting",
 * "somebody must act", "it settled", "it did not", and "we do not know" to be
 * six distinct answers, because collapsing any two of them is how a system
 * ends up treating a timeout as a success.
 *
 * - `created` — the operation exists and no provider has been asked. It is
 *   written and committed before the network call, so a process that dies
 *   between the two leaves something reconciliation can find.
 * - `provider_pending` — the provider holds it and has not settled it.
 * - `requires_action` — the provider needs the consumer to do something more.
 * - `succeeded` — verified provider evidence says money moved.
 * - `failed` — verified provider evidence says it did not.
 * - `cancelled` — abandoned before settlement.
 * - `reconciliation_pending` — the provider's answer was lost or ambiguous.
 *   Never treated as either success or failure; a job resolves it from the
 *   provider's own record.
 */
export const paymentStates = [
  'created',
  'provider_pending',
  'requires_action',
  'succeeded',
  'failed',
  'cancelled',
  'reconciliation_pending',
] as const;
export type PaymentState = (typeof paymentStates)[number];

/**
 * States that will never change again without a new business event.
 *
 * Used by the transition rules rather than by the schema: a terminal state is
 * a fact about the lifecycle, and a CHECK that froze these rows would also
 * block the refund and dispute records that legitimately follow one.
 */
export const terminalPaymentStates: readonly PaymentState[] = [
  'succeeded',
  'failed',
  'cancelled',
];

/**
 * Why a payment did not succeed, in Velora's vocabulary.
 *
 * Bounded and deliberately coarse. A provider's decline code can carry
 * information about the cardholder that Velora has no reason to hold, and a
 * consumer-facing surface must not turn one into advice about somebody's bank.
 */
export const paymentFailureReasons = [
  'declined',
  'cancelled_by_consumer',
  'expired',
  'provider_error',
] as const;
export type PaymentFailureReason = (typeof paymentFailureReasons)[number];

/**
 * Widest client idempotency key BILLING accepts, matching the contract.
 *
 * The stored key is scoped to the acting consumer and the offer, never global:
 * somebody may legitimately buy two different things, and may legitimately buy
 * the same thing again after a subscription ends.
 */
export const maximumIdempotencyKeyLength = 128;

/** Widest provider reference BILLING will store. */
export const maximumProviderReferenceLength = 200;

/** Largest page a consumer's own payment history returns. */
export const maximumPaymentPageSize = 50;
