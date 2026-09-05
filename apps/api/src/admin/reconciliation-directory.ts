import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';

import { billingPayments, billingProviderEvents } from '../billing/schema.js';
import type { DatabaseHandle } from '../database/executor.js';
import { bounded } from '../database/fan-out.js';
import {
  livePreferenceEntitlements,
  walletAccounts,
  walletBalances,
  walletEntries,
  walletTransactions,
} from '../wallet/schema.js';

/**
 * The questions a money system has to be able to answer about itself.
 *
 * Every finding here is a query with a definition, not an alarm with a
 * threshold somebody guessed. A finding either identifies specific rows an
 * operator can open, or it does not exist — there is no "health 94%", no
 * severity score, and no aggregate that cannot be drilled into. That is the
 * difference between a reconciliation screen and a decoration.
 *
 * Each check states its own definition in words, and those words are published
 * with the finding so an operator reading "3 stuck payments" is also told what
 * this platform means by stuck. A number nobody can define is a number nobody
 * should act on.
 *
 * Nothing here writes, corrects, or adjusts anything. Finding a discrepancy and
 * deciding what to do about it are different jobs with different consequences,
 * and the second one belongs to the domain that owns the money.
 */

export interface ReconciliationFinding {
  /** What this platform means by the finding, in words, published with it. */
  readonly definition: string;
  /** Identifiers an operator can open. Bounded; `total` is the real count. */
  readonly examples: readonly string[];
  readonly key: string;
  readonly total: number;
}

export interface WalletLedgerEntry {
  readonly amount: string;
  readonly businessType: string;
  readonly direction: string;
  readonly occurredAt: Date;
  readonly reason: string;
  readonly transactionId: string;
}

export interface WalletDetail {
  readonly available: string;
  /** What the entries say the balance should be. Computed, not stored. */
  readonly entriesTotal: string;
  readonly entries: readonly WalletLedgerEntry[];
  readonly nextCursor: string | undefined;
  readonly reserved: string;
  readonly userId: string;
}

/**
 * How long a payment may sit in a non-terminal state before it is worth a
 * person's attention.
 *
 * An hour, and it is a definition rather than a tuning knob: every non-terminal
 * payment state in this platform is either waiting on a provider round trip or
 * on a person completing an action, and neither of those legitimately takes an
 * hour. It is published with the finding so nobody has to guess what "stuck"
 * meant.
 */
export const stuckPaymentMinutes = 60;

/** The same idea for a provider event nothing has processed. */
export const unprocessedProviderEventMinutes = 30;

const exampleLimit = 10;
const ledgerPageSize = 50;

export class AdminReconciliationDirectory {
  constructor(
    private readonly dependencies: {
      readonly database: DatabaseHandle;
      readonly now: () => Date;
    },
  ) {}

  private get database(): DatabaseHandle {
    return this.dependencies.database;
  }

  /**
   * Every invariant this platform can actually check, checked.
   *
   * Five of them, run together. Each is bounded — a count plus at most ten
   * identifiers — so a platform with a systemic problem produces a finding
   * rather than a response nobody can load.
   */
  async findings(): Promise<readonly ReconciliationFinding[]> {
    const now = this.dependencies.now();
    const paymentCutoff = new Date(
      now.getTime() - stuckPaymentMinutes * 60_000,
    );
    const eventCutoff = new Date(
      now.getTime() - unprocessedProviderEventMinutes * 60_000,
    );

    const [
      stuckPayments,
      expiredHolds,
      unprocessedEvents,
      unbalanced,
      driftedBalances,
    ] = await bounded([
      async () =>
        this.database
          .select({ id: billingPayments.id })
          .from(billingPayments)
          .where(
            and(
              sql`${billingPayments.state} in ('created', 'provider_pending', 'requires_action', 'reconciliation_pending')`,
              lt(billingPayments.updatedAt, paymentCutoff),
            ),
          )
          .orderBy(billingPayments.updatedAt)
          .limit(exampleLimit + 1),
      // A hold whose window has passed and whose coins are still reserved. The
      // sweep that settles these can be late, restarted, or not running, and
      // this is how an operator sees that before somebody's balance does.
      async () =>
        this.database
          .select({ id: livePreferenceEntitlements.id })
          .from(livePreferenceEntitlements)
          .where(
            and(
              eq(livePreferenceEntitlements.state, 'active'),
              lt(livePreferenceEntitlements.expiresAt, now),
            ),
          )
          .orderBy(livePreferenceEntitlements.expiresAt)
          .limit(exampleLimit + 1),
      async () =>
        this.database
          .select({ id: billingProviderEvents.id })
          .from(billingProviderEvents)
          .where(
            and(
              isNull(billingProviderEvents.processedAt),
              lt(billingProviderEvents.receivedAt, eventCutoff),
            ),
          )
          .orderBy(billingProviderEvents.receivedAt)
          .limit(exampleLimit + 1),
      // The one invariant a double-entry journal cannot survive breaking: every
      // transaction's debits equal its credits. If this is ever non-empty,
      // nothing else on this screen matters.
      async () =>
        this.database
          .select({ id: walletEntries.transactionId })
          .from(walletEntries)
          .groupBy(walletEntries.transactionId)
          .having(
            sql`sum(case when ${walletEntries.direction} = 'debit' then ${walletEntries.amount} else -${walletEntries.amount} end) <> 0`,
          )
          .limit(exampleLimit + 1),
      // A cached balance that disagrees with the entries behind it. The balance
      // is a projection maintained transactionally, so a difference means a
      // write went wrong rather than that the projection is stale.
      async () =>
        this.database
          .select({ userId: walletBalances.userId })
          .from(walletBalances)
          .where(
            sql`${walletBalances.available} + ${walletBalances.reserved} <> coalesce((
            select sum(case when ${walletEntries.direction} = 'credit' then ${walletEntries.amount} else -${walletEntries.amount} end)
            from ${walletEntries}
            join ${walletAccounts} on ${walletAccounts.id} = ${walletEntries.accountId}
            where ${walletAccounts.subjectId} = ${walletBalances.userId}
          ), 0)`,
          )
          .limit(exampleLimit + 1),
    ]);

    const finding = (
      key: string,
      definition: string,
      ids: readonly string[],
    ): ReconciliationFinding => ({
      definition,
      examples: ids.slice(0, exampleLimit),
      key,
      // Deliberately the number of rows this query actually returned, capped.
      // A count over the whole table would be a second scan for a figure that
      // only matters as "some" or "none" until somebody has fixed the first ten.
      total: ids.length,
    });

    return [
      finding(
        'ledger_unbalanced',
        'Wallet transactions whose debits and credits do not sum to zero. Any result is a defect.',
        unbalanced.map((row) => row.id),
      ),
      finding(
        'balance_drift',
        'Accounts whose stored available plus reserved balance disagrees with the sum of their ledger entries.',
        driftedBalances.map((row) => row.userId),
      ),
      finding(
        'payment_stuck',
        `Payments in a non-terminal state and untouched for more than ${String(stuckPaymentMinutes)} minutes.`,
        stuckPayments.map((row) => row.id),
      ),
      finding(
        'hold_expired',
        'Paid live-preference windows whose time has passed while their coins are still reserved.',
        expiredHolds.map((row) => row.id),
      ),
      finding(
        'provider_event_unprocessed',
        `Provider events received more than ${String(unprocessedProviderEventMinutes)} minutes ago and never processed.`,
        unprocessedEvents.map((row) => row.id),
      ),
    ].filter((entry) => entry.total > 0);
  }

  /**
   * One person's coin position and the ledger behind it.
   *
   * The balance is read from the projection and the entries are read from the
   * journal, and both are published — because the useful operator question is
   * not "what is the balance" but "does the balance follow from what happened",
   * and that is only answerable if the screen shows both.
   *
   * Amounts are decimal strings the whole way to the browser. A coin balance is
   * an exact integer that outgrows what a JavaScript number can hold, and a
   * console that parsed one as a float would eventually show somebody a balance
   * that is off by one and be unable to say why.
   */
  async wallet(input: {
    readonly cursor?: string | undefined;
    readonly userId: string;
  }): Promise<WalletDetail | undefined> {
    const balances = await this.database
      .select({
        available: walletBalances.available,
        reserved: walletBalances.reserved,
      })
      .from(walletBalances)
      .where(eq(walletBalances.userId, input.userId))
      .limit(1);
    const balance = balances[0];
    if (balance === undefined) return undefined;

    const position =
      input.cursor === undefined
        ? undefined
        : Number.parseInt(input.cursor, 10);
    const from =
      position !== undefined && Number.isSafeInteger(position)
        ? position
        : undefined;

    const [rows, totals] = await bounded([
      async () =>
        this.database
          .select({
            amount: walletEntries.amount,
            businessType: walletTransactions.businessType,
            direction: walletEntries.direction,
            occurredAt: walletTransactions.occurredAt,
            reason: walletTransactions.reason,
            sequence: walletEntries.sequence,
            transactionId: walletEntries.transactionId,
          })
          .from(walletEntries)
          .innerJoin(
            walletAccounts,
            eq(walletAccounts.id, walletEntries.accountId),
          )
          .innerJoin(
            walletTransactions,
            eq(walletTransactions.id, walletEntries.transactionId),
          )
          .where(
            and(
              eq(walletAccounts.subjectId, input.userId),
              from === undefined ? undefined : lt(walletEntries.sequence, from),
            ),
          )
          .orderBy(desc(walletEntries.sequence))
          .limit(ledgerPageSize + 1),
      async () =>
        this.database
          .select({
            total: sql<string>`coalesce(sum(case when ${walletEntries.direction} = 'credit' then ${walletEntries.amount} else -${walletEntries.amount} end), 0)`,
          })
          .from(walletEntries)
          .innerJoin(
            walletAccounts,
            eq(walletAccounts.id, walletEntries.accountId),
          )
          .where(eq(walletAccounts.subjectId, input.userId)),
    ]);

    const page = rows.slice(0, ledgerPageSize);
    const last = page.at(-1);
    return {
      available: balance.available.toString(),
      entries: page.map((row) => ({
        amount: row.amount.toString(),
        businessType: row.businessType,
        direction: row.direction,
        occurredAt: row.occurredAt,
        reason: row.reason,
        transactionId: row.transactionId,
      })),
      entriesTotal: totals[0]?.total ?? '0',
      nextCursor:
        rows.length > ledgerPageSize && last !== undefined
          ? String(last.sequence)
          : undefined,
      reserved: balance.reserved.toString(),
      userId: input.userId,
    };
  }
}
