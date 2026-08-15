import type { CurrencyCode } from '@velora/validation';

import type { BillingInterval, CommercialMode } from './offer-policy.js';

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

  boundsFor(currency: CurrencyCode) {
    return this.bounds.get(currency);
  }

  currencies(): readonly CurrencyCode[] {
    return [...this.bounds.keys()].sort() as readonly CurrencyCode[];
  }
}
