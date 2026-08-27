/**
 * The commercial facts BILLING publishes, and PRIVATE CLUBS consumes.
 *
 * This is the seam [ADR-0011](../../../../docs/decisions/ADR-0011-payments-payouts.md)
 * requires between money and access. BILLING never writes `clubs_`; it appends
 * a fact in the same transaction that settles the money, and the entitlement
 * owner applies its own grant and revoke policy to it. That is why a refund
 * revokes access through the same door a payment granted it, and why neither
 * side has to know how the other decides.
 *
 * The payload is minimized. It carries the identifiers the consumer needs to
 * find its own records and nothing else — no amount, no currency, no provider
 * reference, no payment method. What something cost is not an input to whether
 * somebody may read it.
 */

export const entitlementGrantedEvent = 'billing.entitlement.granted.v1';
export const entitlementRevokedEvent = 'billing.entitlement.revoked.v1';

/** Why an entitlement was withdrawn, in terms the access owner can act on. */
export const entitlementRevocationReasons = [
  'subscription_cancelled',
  /**
   * A renewal the provider could not collect.
   *
   * Distinct from a cancellation because nobody decided it, and distinct from a
   * reversal because no money came back. It withdraws access for the same
   * fail-closed reason `past_due` grants none: grace policy is unresolved, and
   * the honest reading of an unresolved policy is no access.
   */
  'subscription_lapsed',
  'subscription_terminated',
  'payment_reversed',
] as const;
export type EntitlementRevocationReason =
  (typeof entitlementRevocationReasons)[number];

export interface EntitlementGrantedPayload {
  /** The subscription or payment this access follows from. */
  readonly commercialReference: string;
  readonly consumerId: string;
  readonly offerId: string;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly [key: string]: unknown;
}

export interface EntitlementRevokedPayload {
  readonly commercialReference: string;
  readonly consumerId: string;
  readonly offerId: string;
  readonly reason: EntitlementRevocationReason;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly [key: string]: unknown;
}
