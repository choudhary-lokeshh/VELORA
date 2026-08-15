/**
 * PAYOUTS' vocabulary, restated for the schema.
 *
 * Same rule as every other policy module: `drizzle-kit` cannot import the
 * ESM-only contract package while generating migrations, so the values a CHECK
 * needs live here and a unit test asserts they match what `@velora/validation`
 * publishes.
 *
 * Nothing in this file is a payout policy. Settlement windows, minimum payout
 * amounts, reserves, negative-balance treatment, payout countries, and fees are
 * all unresolved commercial and legal decisions in
 * `docs/decisions/DECISIONS_REQUIRED.md`. What is declared here is the shape a
 * disbursement takes once somebody with the authority to decide those has
 * decided them.
 */

/** Table prefix and account-identifier namespace for the creator-liability book. */
export const payoutsJournalPrefix = 'payouts';

/**
 * Positions the creator-liability book keeps.
 *
 * Deliberately a different vocabulary from BILLING's. These are the *payout*
 * side of the same obligation: BILLING records what it collected and owes
 * onward, and this book records what is owed to a creator and how far along the
 * way out it has got. [ADR-0011](../../../../docs/decisions/ADR-0011-payments-payouts.md)
 * forbids one shared ledger between them, and one combined book would let a
 * refund and a payout reversal be posted as though they were the same event.
 */
export const payoutsJournalCategories = [
  /** The counter-position for revenue arriving from BILLING's published fact. */
  'revenue_intake',
  /** What a creator is owed and has not yet claimed. Subject-scoped. */
  'creator_available',
  /** Earmarked against one payout instruction in flight. Subject-scoped. */
  'creator_reserved',
  /** Withheld from a creator by an explicit decision. Subject-scoped. */
  'creator_held',
  /** Money that has left toward a creator. The disbursement counter-position. */
  'payout_disbursed',
] as const;
export type PayoutsJournalCategory = (typeof payoutsJournalCategories)[number];

/**
 * Why a transaction was posted in this book.
 *
 * Declared in full now rather than grown one migration at a time, for the same
 * reason BILLING's vocabulary was: a reason added later has to be reconciled
 * against transactions written before it existed.
 */
export const payoutsJournalReasons = [
  /** Revenue settled at BILLING and became a creator liability here. */
  'revenue_accrued',
  /** Revenue was reversed at BILLING and the liability fell with it. */
  'revenue_reversed',
  /** A payout request earmarked an amount. */
  'payout_reserved',
  /** A reservation was released without money moving. */
  'reservation_released',
  /** Money left toward a creator. */
  'payout_paid',
  /** An explicit hold moved an amount out of what a creator may claim. */
  'hold_applied',
  /** A hold was lifted. */
  'hold_released',
  /** A compensating transaction repairing an earlier one. */
  'correction',
] as const;
export type PayoutsJournalReason = (typeof payoutsJournalReasons)[number];

/** Business event types PAYOUTS posts against. */
export const payoutsBusinessTypes = {
  /** A ledger repair, referenced by the operation that authorized it. */
  correction: 'payouts.correction',
  /** A payout instruction being paid, referenced by its identifier. */
  disbursement: 'payouts.disbursement',
  /** A payout instruction reserving an amount, by its identifier. */
  reservation: 'payouts.reservation',
  /** A released reservation, by the instruction's identifier. */
  release: 'payouts.release',
  /** Revenue accrued from BILLING, referenced by the BILLING event identity. */
  revenue: 'payouts.revenue',
} as const;

/**
 * What has happened to one payout instruction.
 *
 * `requested` and `reserved` are separate because the reservation is an
 * accounting fact and the request is an intention: an instruction that exists
 * without its reservation has taken nothing from anybody, and one that reserved
 * without being submitted has taken it durably and can be released. Collapsing
 * them would make a crash between the two indistinguishable from a payout that
 * never happened.
 *
 * `submitted` covers "the provider has it" and is where an ambiguous answer
 * lands, because a payout instruction whose answer was lost has either moved
 * money or not, and guessing either way is how a platform pays twice.
 */
export const payoutInstructionStates = [
  'requested',
  'reserved',
  'submitted',
  'paid',
  'failed',
  'cancelled',
  'reversed',
] as const;
export type PayoutInstructionState = (typeof payoutInstructionStates)[number];

/** States in which an instruction still holds its reservation. */
export const reservingInstructionStates: readonly PayoutInstructionState[] = [
  'reserved',
  'submitted',
];

/** States an instruction will not leave without a new business event. */
export const terminalInstructionStates: readonly PayoutInstructionState[] = [
  'paid',
  'failed',
  'cancelled',
  'reversed',
];

/** Why a payout did not go through, in Velora's vocabulary. */
export const payoutFailureReasons = [
  'recipient_not_ready',
  'declined',
  'provider_error',
] as const;
export type PayoutFailureReason = (typeof payoutFailureReasons)[number];

/**
 * How far a creator has got with a payout provider's own onboarding.
 *
 * Normalized from whatever a provider calls it, and deliberately coarse.
 * Velora holds a reference to the provider's record and a capability answer;
 * it does not hold, and has no column for, a bank account number, a routing
 * number, a government identifier, or an identity document.
 */
export const recipientStatuses = [
  /** No provider record exists yet. */
  'absent',
  /** The provider has a record and is not finished with it. */
  'onboarding',
  /** The provider says this recipient can be paid. */
  'ready',
  /** The provider says it cannot pay this recipient. */
  'restricted',
] as const;
export type RecipientStatus = (typeof recipientStatuses)[number];

/** Widest provider reference PAYOUTS will store. */
export const maximumPayoutReferenceLength = 200;

/** Widest client idempotency key a payout request accepts. */
export const maximumPayoutIdempotencyKeyLength = 128;

/** Largest page a creator's payout history returns. */
export const maximumPayoutPageSize = 50;
