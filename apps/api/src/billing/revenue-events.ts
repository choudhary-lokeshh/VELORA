/**
 * The revenue facts BILLING publishes, and PAYOUTS consumes.
 *
 * The second seam this domain owns, and it exists for the same reason the
 * entitlement seam does. `docs/architecture/10-money-flow.md` states that a
 * PAYOUTS balance is never derived from a BILLING row read directly, so BILLING
 * appends a fact in the same transaction that moves the money and PAYOUTS
 * applies its own accounting to it. Neither domain reads the other's storage
 * and neither calls the other synchronously.
 *
 * The payload carries the creator's share and nothing about the consumer. Who
 * paid, what they bought, and what they were charged are BILLING's business;
 * what crosses this seam is how much a creator is owed and in what currency.
 * A payout book has no use for a payer's identity, and a field that exists is a
 * field something eventually fills.
 */

export const revenueSettledEvent = 'billing.revenue.settled.v1';
export const revenueReversedEvent = 'billing.revenue.reversed.v1';

/** Why revenue was withdrawn again, in terms the payout book can act on. */
export const revenueReversalReasons = ['refund', 'dispute_lost'] as const;
export type RevenueReversalReason = (typeof revenueReversalReasons)[number];

export interface RevenueSettledPayload {
  /** The creator's share, in minor units, as a decimal string. */
  readonly creatorMinor: string;
  readonly creatorId: string;
  readonly currency: string;
  /** The BILLING operation this settled from. Identity for idempotency. */
  readonly paymentId: string;
  readonly [key: string]: unknown;
}

export interface RevenueReversedPayload {
  /** The creator's share of what was returned, in minor units. */
  readonly creatorMinor: string;
  readonly creatorId: string;
  readonly currency: string;
  readonly paymentId: string;
  readonly reason: RevenueReversalReason;
  /** The refund or dispute this reversal is. Identity for idempotency. */
  readonly reversalId: string;
  readonly [key: string]: unknown;
}
