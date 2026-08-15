import type { JournalEntryInput } from '../money/journal.js';
import {
  addMoney,
  isPositiveMoney,
  isZeroMoney,
  money,
  subtractMoney,
  type Money,
} from '../money/money.js';
import type { CommercePolicy, RevenueAllocation } from './commerce-policy.js';
import { reversalAllocation } from './commerce-policy.js';

/**
 * The entries a sale and its reversals make, built in one place.
 *
 * Capture and reversal are the same split read in opposite directions, and
 * writing them separately is how the two drift until a fully refunded sale
 * leaves a creator owed money for something nobody bought. Both are therefore
 * derived here from one allocation, against one vocabulary of positions.
 *
 * The positions are the ordinary ones. `provider_clearing` is what a payment
 * provider holds on Velora's behalf and is the only asset in the picture.
 * `creator_payable` is what the platform owes onward, held per creator so that
 * "how much is owed to this creator" is a balance rather than a report.
 * `platform_revenue` is the platform's own share, and `tax_payable` is what a
 * tax authority would be owed — nothing writes it, because no tax authority is
 * configured and computing one would be inventing an amount owed to a
 * government.
 *
 * Two declared categories are deliberately never written. `customer_settlement`
 * and `refunds` describe a contra-account model where a sale and its reversal
 * both accumulate and net off; this book unwinds the positions the sale
 * created instead, because a creator's payable has to *fall* when a sale is
 * reversed and a contra balance elsewhere would leave it standing.
 */

export const clearingAccount = {
  category: 'provider_clearing',
  subjectType: 'platform',
} as const;

export const disputesAccount = {
  category: 'disputes',
  subjectType: 'platform',
} as const;

export const platformRevenueAccount = {
  category: 'platform_revenue',
  subjectType: 'platform',
} as const;

export const taxPayableAccount = {
  category: 'tax_payable',
  subjectType: 'platform',
} as const;

export function creatorPayableAccount(creatorId: string) {
  return {
    category: 'creator_payable',
    subjectId: creatorId,
    subjectType: 'creator',
  } as const;
}

/**
 * A settled sale: the provider owes Velora the gross, and Velora owes it onward.
 *
 * Zero parts are omitted rather than posted, because a journal entry carries a
 * strictly positive amount and the direction carries the sign — a zero entry
 * would be a movement that did not happen.
 */
export function captureEntries(input: {
  readonly allocation: RevenueAllocation;
  readonly creatorId: string;
  readonly gross: Money;
}): readonly JournalEntryInput[] {
  const credits: JournalEntryInput[] = [
    {
      account: creatorPayableAccount(input.creatorId),
      amount: input.allocation.creator,
      direction: 'credit',
    },
    {
      account: platformRevenueAccount,
      amount: input.allocation.platform,
      direction: 'credit',
    },
    {
      account: taxPayableAccount,
      amount: input.allocation.tax,
      direction: 'credit',
    },
  ];
  return [
    { account: clearingAccount, amount: input.gross, direction: 'debit' },
    ...credits.filter((entry) => isPositiveMoney(entry.amount)),
  ];
}

/**
 * A reversal, unwinding exactly what the sale allocated.
 *
 * The counter-entry is the caller's, because where the money went differs: a
 * refund returns it through the provider's position, and a lost dispute leaves
 * it in the position the withholding created. What is common — and what must
 * not be written twice — is which claims on it are being withdrawn.
 */
export interface UnwindEntries {
  /** The debit legs, summing to the amount being reversed. */
  readonly entries: readonly JournalEntryInput[];
  /**
   * The part of the reversal that exceeded what the sale ever allocated.
   *
   * Normally zero. It becomes non-zero only when reversals against one capture
   * add up to more than was captured, which no refund can cause — the database
   * refuses that — and which a cardholder's bank can, by taking back the whole
   * amount after part of it was already refunded. The excess has to land
   * somewhere for the transaction to balance, and the platform is the only
   * party that can absorb it: charging it to the creator would take back money
   * Velora already agreed it owed them, on the strength of an event the creator
   * had no part in. That is an arithmetic fallback, not a revenue-share term,
   * and a published policy may reallocate it.
   */
  readonly excess: Money;
}

export function unwindEntries(input: {
  /** Everything already unwound against this capture, in the same currency. */
  readonly alreadyReversed: Money;
  readonly amount: Money;
  readonly captured: Money;
  readonly creatorId: string;
  readonly policy: CommercePolicy;
}): UnwindEntries | undefined {
  const remaining = subtractMoney(input.captured, input.alreadyReversed);
  const unwindable = isPositiveMoney(remaining)
    ? minimumOf(remaining, input.amount)
    : money(0n, input.amount.currency);
  const excess = subtractMoney(input.amount, unwindable);

  const debits: JournalEntryInput[] = [];
  if (isPositiveMoney(unwindable)) {
    const allocation = reversalAllocation(input.policy, {
      alreadyReversed: input.alreadyReversed,
      amount: unwindable,
    });
    if (allocation === undefined) return undefined;
    debits.push(
      {
        account: creatorPayableAccount(input.creatorId),
        amount: allocation.creator,
        direction: 'debit',
      },
      {
        account: platformRevenueAccount,
        amount: allocation.platform,
        direction: 'debit',
      },
      {
        account: taxPayableAccount,
        amount: allocation.tax,
        direction: 'debit',
      },
    );
  }
  if (isPositiveMoney(excess)) {
    debits.push({
      account: platformRevenueAccount,
      amount: excess,
      direction: 'debit',
    });
  }
  return {
    entries: mergeByAccount(
      debits.filter((entry) => isPositiveMoney(entry.amount)),
    ),
    excess,
  };
}

function minimumOf(left: Money, right: Money): Money {
  return left.amountMinor <= right.amountMinor ? left : right;
}

/**
 * Combines entries that move the same position the same way.
 *
 * Only the excess case produces two, and two debits of one account in one
 * transaction would be a posting that balances while describing the movement
 * twice.
 */
function mergeByAccount(
  entries: readonly JournalEntryInput[],
): readonly JournalEntryInput[] {
  const merged = new Map<string, JournalEntryInput>();
  for (const entry of entries) {
    const key = `${entry.account.category}|${entry.account.subjectId ?? ''}|${entry.direction}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing === undefined
        ? entry
        : { ...existing, amount: addMoney(existing.amount, entry.amount) },
    );
  }
  return [...merged.values()].filter((entry) => !isZeroMoney(entry.amount));
}
