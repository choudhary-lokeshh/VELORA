/**
 * BILLING's journal vocabulary.
 *
 * `docs/architecture/03-domain-boundaries.md` gives BILLING the customer money
 * lifecycle and gives PAYOUTS creator disbursement, and
 * [ADR-0011](../../../../docs/decisions/ADR-0011-payments-payouts.md) forbids
 * one shared ledger between them. These are therefore the positions in the
 * *customer-money* book only. PAYOUTS declares its own, and the two are
 * connected by a published settled-revenue fact rather than by a table.
 *
 * These values are restated here rather than imported because `drizzle-kit`
 * cannot import the ESM-only contract package while generating migrations, on
 * the same rule `src/clubs/policy.ts` follows.
 */

/** Table prefix and account-identifier namespace for this journal. */
export const billingJournalPrefix = 'billing';

/**
 * Positions the customer-money book keeps.
 *
 * Named after what they represent rather than after a debit or credit side,
 * because which side is "normal" for a position is an accounting reading and
 * the journal deliberately holds only the movement.
 *
 * Every one of these is a platform position except `creator_payable`, which is
 * held per creator: it is what the platform owes onward, and a single pooled
 * account would make "how much is owed to this creator" a report rather than a
 * balance.
 */
export const billingJournalCategories = [
  /** Money a payment provider holds on Velora's behalf. */
  'provider_clearing',
  /** The customer side of a sale: value delivered in exchange for money. */
  'customer_settlement',
  /** The platform's own share of a sale. */
  'platform_revenue',
  /** What the platform owes onward to one creator. Subject-scoped. */
  'creator_payable',
  /** Money returned, or owed back, to a customer. */
  'refunds',
  /** Amounts a provider has withheld or reversed for a dispute. */
  'disputes',
  /** Amounts withheld against future refund or dispute exposure. */
  'reserves',
  /** The staging position a settled creator liability leaves through. */
  'payout_clearing',
  /** Tax collected on a sale and owed to an authority. */
  'tax_payable',
] as const;
export type BillingJournalCategory = (typeof billingJournalCategories)[number];

/**
 * Why a transaction was posted.
 *
 * The full vocabulary is declared now rather than grown one migration at a
 * time, for the reason `membershipSources` carries `billing` from the start:
 * the alternative is a series of `ALTER ... CHECK` migrations whose only effect
 * is to make an existing design reachable, and a reason added later has to be
 * reconciled against transactions written before it existed.
 *
 * Reachability is not vocabulary. Nothing writes any of these except
 * `correction` until the phase named against it lands, and no provider is
 * approved, so in a deployed environment nothing writes any of them at all.
 */
export const billingJournalReasons = [
  /** A verified payment settled. Written from Phase 4, by webhook processing. */
  'payment_captured',
  /** An approved refund was issued. Written from Phase 5. */
  'refund_issued',
  /** A provider opened a dispute against a payment. Written from Phase 5. */
  'dispute_opened',
  /** A dispute closed, in either party's favour. Written from Phase 5. */
  'dispute_resolved',
  /** A creator liability left the book toward PAYOUTS. Written from Phase 7. */
  'payout_settled',
  /**
   * A compensating transaction that repairs an earlier one.
   *
   * The only reason reachable today, and the only one that may name the
   * transaction it corrects. Repair is always a new balanced transaction: the
   * journal has no update path, so there is nothing else it could be.
   */
  'correction',
] as const;
export type BillingJournalReason = (typeof billingJournalReasons)[number];

/**
 * Business event types BILLING posts against.
 *
 * The pair of type and reference is the idempotency identity of a posting, so
 * a type is a namespace: two different kinds of event can carry the same
 * underlying identifier without colliding.
 */
export const billingBusinessTypes = {
  /** A ledger repair, referenced by the operation that authorized it. */
  correction: 'billing.correction',
  /** A dispute, referenced by its internal dispute identifier. */
  dispute: 'billing.dispute',
  /** A payment operation, referenced by its internal identifier. */
  payment: 'billing.payment',
  /** A refund, referenced by its internal refund identifier. */
  refund: 'billing.refund',
} as const;
export type BillingBusinessType =
  (typeof billingBusinessTypes)[keyof typeof billingBusinessTypes];
