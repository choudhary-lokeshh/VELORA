/**
 * The reversal vocabulary, restated for the schema.
 *
 * Same rule as every other policy module here: `drizzle-kit` cannot import the
 * ESM-only contract package while generating migrations, so the values a CHECK
 * needs live here and a unit test asserts they match what `@velora/validation`
 * publishes.
 *
 * Nothing in this file is a refund policy. Who may ask for their money back,
 * within what window, and for what proportion is unresolved commercial policy
 * in `docs/decisions/DECISIONS_REQUIRED.md`. What is declared here is the shape
 * a reversal takes once somebody with the authority to decide one has decided
 * it, which is a different question and a prerequisite for the first.
 */

/**
 * The states one refund can hold.
 *
 * The same discipline a payment gets. `reconciliation_pending` is the state
 * that matters most: a refund instruction whose answer was lost has either
 * moved money or not, and the two are not interchangeable — returning it twice
 * and telling somebody they were repaid when they were not are both worse than
 * saying the platform does not know yet.
 */
export const refundStates = [
  'requested',
  'provider_pending',
  'succeeded',
  'failed',
  'reconciliation_pending',
] as const;
export type RefundState = (typeof refundStates)[number];

/**
 * States a refund will not leave without a new business event.
 *
 * Used by the transition rules rather than by the schema. Terminality is what
 * makes the over-refund guard sound: a refund that could walk back out of
 * `failed` would let an amount already counted against the capture be counted
 * again.
 */
export const terminalRefundStates: readonly RefundState[] = [
  'succeeded',
  'failed',
];

/**
 * Refund states that still count against the captured amount.
 *
 * Everything except `failed`. A refund the provider refused released nothing
 * and must not reserve part of a capture forever; every other state either
 * moved money or may still do so, and both have to be reserved against.
 */
export const outstandingRefundStates: readonly RefundState[] = [
  'requested',
  'provider_pending',
  'succeeded',
  'reconciliation_pending',
];

/** Why a refund did not go through, in Velora's vocabulary. */
export const refundFailureReasons = ['declined', 'provider_error'] as const;
export type RefundFailureReason = (typeof refundFailureReasons)[number];

/**
 * Why an operator reversed a charge. `v1-provisional`.
 *
 * The record of a decision, not the rule that authorized it. An audit needs to
 * know what the operator said whatever the eventual refund policy turns out to
 * be, and a free-text field would make that unanalysable.
 */
export const refundReasonCodes = [
  'duplicate_charge',
  'not_delivered',
  'operator_correction',
  'dispute_resolution',
] as const;
export type RefundReasonCode = (typeof refundReasonCodes)[number];

/**
 * A dispute's lifecycle, in Velora's vocabulary rather than a provider's.
 *
 * Stated from the platform's side and describing where the money ended up.
 * `lost` means the provider returned it to the cardholder, so it carries the
 * same financial consequence as a full refund; `won` and `withdrawn` both leave
 * the sale standing.
 */
export const disputeStates = [
  'opened',
  'under_review',
  'won',
  'lost',
  'withdrawn',
] as const;
export type DisputeState = (typeof disputeStates)[number];

/** Dispute states that are still live, and may still move. */
export const openDisputeStates: readonly DisputeState[] = [
  'opened',
  'under_review',
];

/** Dispute states in which the money has stopped moving. */
export const resolvedDisputeStates: readonly DisputeState[] = [
  'won',
  'lost',
  'withdrawn',
];

/**
 * Why a cardholder disputed, normalized from whatever a provider calls it.
 * `v1-provisional`.
 */
export const disputeReasonCodes = [
  'unrecognized',
  'product_not_received',
  'product_unacceptable',
  'duplicate',
  'fraudulent',
  'subscription_cancelled',
  'other',
] as const;
export type DisputeReasonCode = (typeof disputeReasonCodes)[number];

/**
 * Widest operator idempotency key a refund accepts, matching the contract.
 *
 * The stored key is scoped to the payment being reversed rather than global:
 * one payment may legitimately be refunded twice in parts, and two payments may
 * legitimately be reversed under keys a client generated independently.
 */
export const maximumRefundIdempotencyKeyLength = 128;

/** Largest page an operator's refund or dispute listing returns. */
export const maximumReversalPageSize = 50;
