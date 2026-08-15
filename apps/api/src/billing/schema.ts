import { journalTables } from '../money/journal-table.js';
import {
  billingJournalCategories,
  billingJournalPrefix,
  billingJournalReasons,
} from './policy.js';

/**
 * BILLING-owned persistence.
 *
 * `docs/architecture/03-domain-boundaries.md` gives this domain payment
 * intents, charges, refunds, and platform subscription state, and explicitly
 * not payout disbursement or content access decisions. Everything here lives
 * under `billing_` and nothing outside this domain writes it.
 *
 * The journal is the first thing built, before any offer, payment, or
 * subscription exists. [ADR-0021](../../../../docs/decisions/ADR-0021-monetization-money-architecture.md)
 * gives the reason: a payment recorded before there is somewhere to account for
 * it is a payment that gets accounted for retroactively, by inference, from
 * records that were not designed to support it.
 *
 * The tables come from the shared factory in `src/money/journal-table.ts`, on
 * the same rule the transactional outbox follows: the shape and its invariants
 * are declared once, the storage is owned per domain. PAYOUTS will instantiate
 * the same factory under its own prefix, and the two books will never share a
 * row.
 */
const journal = journalTables(billingJournalPrefix, {
  categories: billingJournalCategories,
  reasons: billingJournalReasons,
});

export const billingJournalAccounts = journal.accounts;
export const billingJournalTransactions = journal.transactions;
export const billingJournalEntries = journal.entries;

export const billingJournalTables = journal;
