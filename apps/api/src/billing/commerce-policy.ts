import type { CurrencyCode } from '@velora/validation';

import { money, subtractMoney, zeroMoney, type Money } from '../money/money.js';
import type { BillingInterval, CommercialMode } from './offer-policy.js';

/**
 * How one settled amount divides between the parties with a claim on it.
 *
 * Three parts and nothing else, because there are exactly three places money
 * from a sale can be owed to: the creator who sold the thing, the platform that
 * carried the sale, and a tax authority. Whatever proportions a published policy
 * eventually chooses, the parts must sum to the gross exactly — a split that
 * loses a minor unit to rounding is a book that will not balance, and one that
 * gains one is money nobody paid.
 */
export interface RevenueAllocation {
  readonly creator: Money;
  readonly platform: Money;
  /**
   * Tax owed to an authority out of this sale.
   *
   * Zero is not the same statement as "no tax applies". No tax authority is
   * configured anywhere in Velora and none is approved, so no policy in this
   * repository can compute one; the field exists so the seam a tax engine
   * attaches to is the same seam the rest of the split already goes through,
   * rather than a column added later to a book that had no room for it.
   */
  readonly tax: Money;
}

/**
 * The approved commercial terms an offer must sit inside.
 *
 * Not a payment provider. This is the answer to "what may Velora charge, in
 * what currency, on what cadence, between what bounds" — every part of which is
 * a business decision recorded as unresolved in
 * `docs/decisions/DECISIONS_REQUIRED.md`. A platform with no approved terms has
 * no purchasable product, and that is a truthful state rather than a broken one.
 *
 * The port exists so the accounting and activation machinery is exercisable
 * against a deterministic test policy while production carries none. Nothing in
 * BILLING reads a percentage, a currency list, or a price bound from anywhere
 * else.
 */
export interface CommercePolicy {
  /** Cadences a recurring offer may bill on. Empty means none may. */
  readonly intervals: readonly BillingInterval[];
  /** Commercial modes that may be activated at all. */
  readonly modes: readonly CommercialMode[];
  /** Adapter name, recorded for audit and reported to the creator surface. */
  readonly source: string;
  /**
   * Inclusive minor-unit bounds for one price in this currency, or nothing when
   * the currency is not approved for commerce.
   *
   * One method rather than a currency list plus a bounds lookup, so "approved"
   * and "priceable between these amounts" cannot disagree.
   */
  boundsFor(
    currency: CurrencyCode,
  ):
    | { readonly maximumMinor: bigint; readonly minimumMinor: bigint }
    | undefined;
  /** Currencies commerce may run in. Empty until terms are approved. */
  currencies(): readonly CurrencyCode[];
  /**
   * How a settled amount divides, or nothing when no terms are approved.
   *
   * A pure function of the amount, deliberately. It is called once when a sale
   * settles and again for every reversal of it, and a split that depended on
   * anything else — the day, a creator's tier, a running total — could not be
   * reproduced later, which would make the books unauditable.
   *
   * Returning nothing is the honest answer where no platform fee and no revenue
   * share are published. It is what makes a capture unpostable rather than
   * posted against a percentage nobody approved.
   */
  allocate(gross: Money): RevenueAllocation | undefined;
}

/**
 * The reversal of part of a sale, split the same way the sale was.
 *
 * Computed as the difference between the allocation of everything reversed so
 * far including this reversal and the allocation of everything reversed before
 * it, rather than by splitting the reversed amount on its own. The difference
 * is what keeps a series of partial reversals exact: splitting each one
 * independently rounds each one, and five roundings against a policy with a
 * percentage in it leave a capture that never quite returns to zero.
 *
 * A component may legitimately come out at zero — reversing one minor unit
 * moves nothing to a party whose share rounds below one — so a caller posts
 * only the parts that are non-zero. What is guaranteed is that the three parts
 * sum to exactly the amount being reversed.
 */
export function reversalAllocation(
  policy: CommercePolicy,
  input: {
    readonly amount: Money;
    /** Everything already unwound against this capture, in the same currency. */
    readonly alreadyReversed: Money;
  },
): RevenueAllocation | undefined {
  const before = policy.allocate(input.alreadyReversed);
  const after = policy.allocate({
    amountMinor: input.alreadyReversed.amountMinor + input.amount.amountMinor,
    currency: input.amount.currency,
  });
  if (before === undefined || after === undefined) return undefined;
  return {
    creator: subtractMoney(after.creator, before.creator),
    platform: subtractMoney(after.platform, before.platform),
    tax: subtractMoney(after.tax, before.tax),
  };
}

/**
 * The configured policy in every deployed environment.
 *
 * It approves nothing, which makes every activation fail closed. There is no
 * partial state: a platform that has approved no fee, no currency, and no
 * refund terms cannot sell one thing correctly and refuse the rest.
 */
export class UnpublishedCommercePolicy implements CommercePolicy {
  readonly intervals: readonly BillingInterval[] = [];

  readonly modes: readonly CommercialMode[] = [];

  readonly source = 'unpublished';

  allocate(): undefined {
    return undefined;
  }

  boundsFor(): undefined {
    return undefined;
  }

  currencies(): readonly CurrencyCode[] {
    return [];
  }
}

/**
 * Development and test policy.
 *
 * The numbers here are arbitrary and deliberately so: they exist to exercise
 * bounds checking, not to propose terms. Configuration refuses this adapter
 * outside the local and test application environments, so no deployed
 * environment can be charged against it, and its name is what stops a passing
 * test from reading as evidence about approved commercial terms.
 */
export class LocalTestCommercePolicy implements CommercePolicy {
  readonly intervals: readonly BillingInterval[] = ['month', 'year'];

  readonly modes: readonly CommercialMode[] = ['subscription', 'one_time'];

  readonly source = 'local-test';

  private readonly bounds: ReadonlyMap<
    string,
    { readonly maximumMinor: bigint; readonly minimumMinor: bigint }
  > = new Map([
    ['EUR', { maximumMinor: 50_000n, minimumMinor: 100n }],
    ['JPY', { maximumMinor: 500_000n, minimumMinor: 100n }],
    ['USD', { maximumMinor: 50_000n, minimumMinor: 100n }],
  ]);

  /**
   * A deterministic split, exact by construction.
   *
   * The platform share is floored and the creator takes the remainder, so the
   * three parts sum to the gross for every amount rather than for most of them.
   * The percentage is arbitrary and is not a proposal: its only job is to make
   * a non-trivial split exercisable, and its name is what stops a passing test
   * from reading as evidence about approved commercial terms.
   *
   * No tax is computed, because no tax authority is configured anywhere in this
   * repository and computing one would be inventing an amount owed to a
   * government.
   */
  allocate(gross: Money): RevenueAllocation {
    const platformMinor = (gross.amountMinor * 20n) / 100n;
    const tax = zeroMoney(gross.currency);
    const platform = money(platformMinor, gross.currency);
    return {
      creator: subtractMoney(subtractMoney(gross, platform), tax),
      platform,
      tax,
    };
  }

  boundsFor(currency: CurrencyCode) {
    return this.bounds.get(currency);
  }

  currencies(): readonly CurrencyCode[] {
    return [...this.bounds.keys()].sort() as readonly CurrencyCode[];
  }
}
