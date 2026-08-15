/**
 * The facts PAYOUTS publishes, and BILLING consumes.
 *
 * The return leg of the money seam. BILLING records what it owes a creator out
 * of customer money; PAYOUTS records the same obligation from the disbursement
 * side and is the only domain that learns when it is discharged. It says so
 * through a published fact rather than by writing a `billing_` row, on the same
 * rule every other crossing in this repository follows.
 *
 * The payload carries the creator, the amount, and the instruction. Nothing
 * about a recipient, a provider account, or a provider reference crosses here:
 * BILLING has no use for any of it and a field that exists is a field something
 * eventually fills.
 */

export const disbursementSettledEvent = 'payouts.disbursement.settled.v1';

export interface DisbursementSettledPayload {
  /** What left, in minor units, as a decimal string. */
  readonly amountMinor: string;
  readonly creatorId: string;
  readonly currency: string;
  /** The PAYOUTS instruction this was. Identity for idempotency. */
  readonly instructionId: string;
  readonly [key: string]: unknown;
}
