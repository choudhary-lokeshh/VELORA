import type { CurrencyCode } from '@velora/validation';

/**
 * Whether Velora may transact at all, for this consumer, this creator, and this
 * currency.
 *
 * The seam exists because "global" is the default nobody decides and everybody
 * assumes. A platform with no explicit country authority does not sell in no
 * countries; it sells in all of them, quietly, the first time somebody with an
 * unexpected address completes a checkout. This port makes that an answer
 * rather than an omission.
 *
 * Six independent conditions, all of which must pass, and each of which is a
 * separate approval in `docs/compliance/04-payments-tax-payout-gates.md`:
 *
 * - the consumer's country is one Velora may sell into;
 * - the creator's country is one Velora may sell *from*, which is a different
 *   list answering to different law;
 * - the currency is approved for that pairing rather than approved in general;
 * - a payment provider exists that is eligible for the pairing;
 * - a payout capability exists for the creator's country, because selling into
 *   a country Velora cannot pay a creator out of accrues a liability it has no
 *   way to discharge;
 * - and a tax authority exists that can say what is owed.
 *
 * They are reported separately rather than as one boolean. An operator needs to
 * know which gate is shut, and a surface that said only "unavailable" would
 * send a creator to fix something that was never the problem.
 *
 * Nothing here is legal or tax advice, and nothing here decides any of those
 * lists. It is the shape the decisions attach to.
 */

export const commerceEligibilityGates = [
  'consumer_country',
  'creator_country',
  'currency',
  'payment_capability',
  'payout_capability',
  'tax_authority',
] as const;
export type CommerceEligibilityGate = (typeof commerceEligibilityGates)[number];

export interface CommerceEligibilityRequest {
  /**
   * ISO 3166-1 alpha-2, or nothing when Velora does not know it.
   *
   * Self-declared, and worth saying plainly here because this is where it is
   * used as if it were a fact. It comes from the consumer's own adult
   * declaration, recorded with assurance class `self_declared`, and no approved
   * verifier can produce anything stronger — that is `LEGAL REVIEW REQUIRED`
   * under adult/age assurance and launch-country gates in
   * `docs/decisions/DECISIONS_REQUIRED.md`.
   *
   * So this gate refuses a country nobody approved, but it cannot prove that a
   * consumer who names an approved one is in it. That is tolerable only while
   * live money movement is blocked. Enabling a payment provider without
   * deciding what assurance a commerce country claim requires would turn a
   * refusal into a compliance control it is not.
   */
  readonly consumerCountry: string | undefined;
  readonly creatorCountry: string | undefined;
  readonly currency: CurrencyCode;
}

export type CommerceEligibilityVerdict =
  | { readonly kind: 'permitted' }
  | {
      readonly kind: 'refused';
      /** Every gate that is shut, not merely the first one found. */
      readonly gates: readonly CommerceEligibilityGate[];
    };

export interface CommerceEligibility {
  /** Adapter name, recorded for audit and reported to operator surfaces. */
  readonly source: string;
  /** Countries Velora may sell into. Empty until an authority publishes one. */
  consumerCountries(): readonly string[];
  /** Countries Velora may sell from. A different list, answering to different law. */
  creatorCountries(): readonly string[];
  evaluate(request: CommerceEligibilityRequest): CommerceEligibilityVerdict;
}

/**
 * The configured authority in every deployed environment.
 *
 * Nothing is eligible, and every gate is reported shut. There is no partial
 * state and no "unknown country is probably fine": a platform that has approved
 * no launch country, no tax authority, and no provider cannot correctly permit
 * one pairing and refuse the rest.
 */
export class UnavailableCommerceEligibility implements CommerceEligibility {
  readonly source = 'unavailable';

  consumerCountries(): readonly string[] {
    return [];
  }

  creatorCountries(): readonly string[] {
    return [];
  }

  evaluate(): CommerceEligibilityVerdict {
    return { gates: [...commerceEligibilityGates], kind: 'refused' };
  }
}

/**
 * Development and test authority.
 *
 * The lists are short and arbitrary and deliberately so: they exist to exercise
 * a conjunction of gates, not to propose launch countries. Configuration
 * refuses this adapter outside the local and test application environments, and
 * its name is what stops a passing test from reading as evidence about approved
 * market entry.
 *
 * Even here nothing is open-ended. An unknown consumer country refuses, an
 * unknown creator country refuses, and a currency outside the pairing refuses —
 * because the failure this seam exists to prevent is exactly the one where an
 * absent value reads as permission.
 */
export class LocalTestCommerceEligibility implements CommerceEligibility {
  readonly source = 'local-test';

  private readonly consumers: readonly string[] = ['ES', 'FR', 'JP'];

  private readonly creators: readonly string[] = ['ES', 'FR'];

  private readonly currencies: readonly string[] = ['EUR', 'JPY', 'USD'];

  consumerCountries(): readonly string[] {
    return this.consumers;
  }

  creatorCountries(): readonly string[] {
    return this.creators;
  }

  evaluate(request: CommerceEligibilityRequest): CommerceEligibilityVerdict {
    const gates: CommerceEligibilityGate[] = [];
    if (
      request.consumerCountry === undefined ||
      !this.consumers.includes(request.consumerCountry)
    ) {
      gates.push('consumer_country');
    }
    if (
      request.creatorCountry === undefined ||
      !this.creators.includes(request.creatorCountry)
    ) {
      gates.push('creator_country');
    }
    if (!this.currencies.includes(request.currency)) gates.push('currency');
    return gates.length === 0
      ? { kind: 'permitted' }
      : { gates, kind: 'refused' };
  }
}
