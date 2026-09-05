import { eq, inArray, sql } from 'drizzle-orm';

import {
  billingDisputes,
  billingJournalAccounts,
  billingJournalEntries,
  billingPayments,
  billingRefunds,
  billingSubscriptions,
} from '../billing/schema.js';
import { bounded } from '../database/fan-out.js';
import type { DatabaseHandle } from '../database/executor.js';
import { payoutsInstructions } from '../payouts/schema.js';

/**
 * What an operator may see of the platform's money.
 *
 * Deliberately a read and only a read. `docs/product/04-platform-admin.md`
 * makes ADMIN an operations layer over other domains' truth, and the one
 * financial *action* an operator has — issuing a refund — goes through
 * BILLING's own service with an operator's authority. There is no path here
 * that edits a financial row, and there is no query here that could be turned
 * into one.
 *
 * What it returns is deliberately thin. No provider reference, no provider
 * idempotency key, no signing secret, no payout recipient reference, no bank
 * detail, no identity document, and no consumer contact detail. An operator
 * needs to know what state the platform's money is in and be able to act on it;
 * none of those help with that, and
 * `docs/operations/03-finance-payout-operations.md` states the same rule
 * directly — no raw card, bank credential, signing secret, or unrestricted
 * identity document in an operational view.
 *
 * Every figure is a count or a per-currency total. There is no cross-currency
 * sum anywhere, because adding a euro to a yen produces a number that means
 * nothing and an operator would act on it.
 */

export interface FinancialStateRow {
  readonly count: number;
  readonly state: string;
}

export interface FinancialCurrencyTotal {
  readonly amountMinor: string;
  readonly currency: string;
}

export interface FinancialOperationalState {
  readonly disputes: readonly FinancialStateRow[];
  readonly openDisputeTotals: readonly FinancialCurrencyTotal[];
  /** What the platform still owes creators, per currency, from its own book. */
  readonly payableTotals: readonly FinancialCurrencyTotal[];
  readonly payments: readonly FinancialStateRow[];
  readonly payouts: readonly FinancialStateRow[];
  /** Operations that need somebody to look at them. */
  readonly reconciliation: readonly FinancialStateRow[];
  readonly refunds: readonly FinancialStateRow[];
  readonly subscriptions: readonly FinancialStateRow[];
}

export class AdminFinancialDirectory {
  constructor(private readonly database: DatabaseHandle) {}

  async operationalState(): Promise<FinancialOperationalState> {
    const [
      payments,
      refunds,
      disputes,
      subscriptions,
      payouts,
      openDisputeTotals,
      payableTotals,
      // Seven reads, three at a time. ADR-0019 sizes the pool at ten and its
      // admission bound counts requests rather than queries, so a screen taking
      // seven connections is invisible to it — and this one runs beside other
      // operator reads. See `../database/fan-out.ts`.
    ] = await bounded([
      async () => this.paymentStates(),
      async () => this.refundStates(),
      async () => this.disputeStates(),
      async () => this.subscriptionStates(),
      async () => this.payoutStates(),
      async () => this.openDisputes(),
      async () => this.payable(),
    ]);
    return {
      disputes,
      openDisputeTotals,
      payableTotals,
      payments,
      payouts,
      // The classes that need a person: an operation whose provider answer was
      // lost, and a reversal or a payout in the same position. All three are
      // states rather than errors — the platform does not know yet, which is
      // the one honest thing it can say — and reconciliation resolves them from
      // the provider's own record.
      reconciliation: [
        ...payments
          .filter((row) => row.state === 'reconciliation_pending')
          .map((row) => ({ ...row, state: 'payment_reconciliation_pending' })),
        ...refunds
          .filter((row) => row.state === 'reconciliation_pending')
          .map((row) => ({ ...row, state: 'refund_reconciliation_pending' })),
        ...payouts
          .filter((row) => row.state === 'submitted')
          .map((row) => ({ ...row, state: 'payout_awaiting_confirmation' })),
      ],
      refunds,
      subscriptions,
    };
  }

  private async paymentStates(): Promise<readonly FinancialStateRow[]> {
    const rows = await this.database
      .select({
        count: sql<number>`count(*)::int`,
        state: billingPayments.state,
      })
      .from(billingPayments)
      .groupBy(billingPayments.state)
      .orderBy(billingPayments.state);
    return rows.map((row) => ({ count: row.count, state: row.state }));
  }

  private async refundStates(): Promise<readonly FinancialStateRow[]> {
    const rows = await this.database
      .select({
        count: sql<number>`count(*)::int`,
        state: billingRefunds.state,
      })
      .from(billingRefunds)
      .groupBy(billingRefunds.state)
      .orderBy(billingRefunds.state);
    return rows.map((row) => ({ count: row.count, state: row.state }));
  }

  private async disputeStates(): Promise<readonly FinancialStateRow[]> {
    const rows = await this.database
      .select({
        count: sql<number>`count(*)::int`,
        state: billingDisputes.state,
      })
      .from(billingDisputes)
      .groupBy(billingDisputes.state)
      .orderBy(billingDisputes.state);
    return rows.map((row) => ({ count: row.count, state: row.state }));
  }

  private async subscriptionStates(): Promise<readonly FinancialStateRow[]> {
    const rows = await this.database
      .select({
        count: sql<number>`count(*)::int`,
        state: billingSubscriptions.state,
      })
      .from(billingSubscriptions)
      .groupBy(billingSubscriptions.state)
      .orderBy(billingSubscriptions.state);
    return rows.map((row) => ({ count: row.count, state: row.state }));
  }

  private async payoutStates(): Promise<readonly FinancialStateRow[]> {
    const rows = await this.database
      .select({
        count: sql<number>`count(*)::int`,
        state: payoutsInstructions.state,
      })
      .from(payoutsInstructions)
      .groupBy(payoutsInstructions.state)
      .orderBy(payoutsInstructions.state);
    return rows.map((row) => ({ count: row.count, state: row.state }));
  }

  /** Every live cardholder claim, totalled per currency. Never summed across. */
  private async openDisputes(): Promise<readonly FinancialCurrencyTotal[]> {
    const rows = await this.database
      .select({
        amountMinor: sql<string>`sum(${billingDisputes.amountMinor})::text`,
        currency: billingDisputes.currency,
      })
      .from(billingDisputes)
      .where(inArray(billingDisputes.state, ['opened', 'under_review']))
      .groupBy(billingDisputes.currency)
      .orderBy(billingDisputes.currency);
    return rows.map((row) => ({
      amountMinor: row.amountMinor,
      currency: row.currency,
    }));
  }

  /**
   * What the platform still owes creators, read from BILLING's own book.
   *
   * The ledger rather than a projection, and negated because a liability is a
   * credit balance. It falls when a payout settles, because PAYOUTS publishes
   * that and BILLING consumes it — so this figure and the payout book agree
   * without either reading the other's tables.
   */
  private async payable(): Promise<readonly FinancialCurrencyTotal[]> {
    const rows = await this.database
      .select({
        amountMinor: sql<string>`(-sum(case when ${billingJournalEntries.direction} = 'debit' then ${billingJournalEntries.amountMinor} else -${billingJournalEntries.amountMinor} end))::text`,
        currency: billingJournalAccounts.currency,
      })
      .from(billingJournalEntries)
      .innerJoin(
        billingJournalAccounts,
        eq(billingJournalAccounts.id, billingJournalEntries.accountId),
      )
      .where(eq(billingJournalAccounts.category, 'creator_payable'))
      .groupBy(billingJournalAccounts.currency)
      .orderBy(billingJournalAccounts.currency);
    return rows
      .map((row) => ({ amountMinor: row.amountMinor, currency: row.currency }))
      .filter((row) => row.amountMinor !== '0');
  }
}
