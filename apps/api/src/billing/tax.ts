import { money, zeroMoney, type Money } from '../money/money.js';

/**
 * What a sale owes a tax authority.
 *
 * A port rather than a calculation, because tax is not arithmetic Velora is
 * competent to perform. What is owed depends on where the consumer is, where
 * the creator is, what was sold, which registrations the platform holds, and
 * which of them make it the merchant of record — and every one of those is an
 * approval recorded as unresolved in
 * `docs/compliance/04-payments-tax-payout-gates.md`. Nothing in this repository
 * is tax advice and nothing here decides any of it.
 *
 * Two rules shape the interface.
 *
 * **A tax result is evidence, so it is snapshotted rather than recomputed.**
 * The amount, and the name of the authority that produced it, are written onto
 * the payment at the moment of purchase and frozen there. Recomputing a
 * historical sale against today's rates would silently rewrite what somebody
 * was charged, and a rate change is exactly the thing that makes that happen.
 *
 * **Zero is a result, not a default.** An authority that says a sale owes
 * nothing has said something; an absent authority has not. The two are
 * different values here — `undefined` versus a zero amount carrying an
 * authority name — because a silent zero is how a platform accrues an
 * unremitted tax liability without anybody deciding to.
 */

export interface TaxAssessmentRequest {
  readonly consumerCountry: string | undefined;
  readonly sellerCountry: string | undefined;
  /** What the consumer is being charged, before any split. */
  readonly gross: Money;
}

export interface TaxAssessment {
  /** Which authority produced this, recorded on the sale beside the amount. */
  readonly authority: string;
  /** Tax owed out of the gross. Zero is a valid, authoritative answer. */
  readonly amount: Money;
}

export interface TaxAuthorityPort {
  /** Adapter name, recorded for audit and reported to operator surfaces. */
  readonly authority: string;
  /**
   * Assesses one sale, or refuses.
   *
   * Called outside every database transaction. A tax engine is a network call
   * to somebody else's service, and holding a PostgreSQL transaction open
   * across one is forbidden by `docs/engineering/03-jobs-idempotency-concurrency.md`
   * for the same reason holding one across a payment provider is.
   */
  assess(request: TaxAssessmentRequest): Promise<TaxAssessment | undefined>;
}

/**
 * The configured authority in every deployed environment.
 *
 * It assesses nothing, which makes taxable commerce impossible rather than
 * untaxed. A platform with no tax engine and no published treatment cannot
 * charge somebody a price whose tax component it invented, and it certainly
 * cannot charge one whose tax component it assumed was nil.
 */
export class UnavailableTaxAuthority implements TaxAuthorityPort {
  readonly authority = 'unavailable';

  assess(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

/**
 * Development and test authority.
 *
 * It assesses zero and says so, under its own name. That is deliberately not
 * the same as no authority: the sale carries `local-test` as the authority that
 * produced the figure, so a zero in the books is attributable and a test using
 * it cannot be mistaken for evidence about any real tax treatment.
 *
 * Configuration refuses this adapter outside the local and test application
 * environments.
 */
export class LocalTestTaxAuthority implements TaxAuthorityPort {
  readonly authority = 'local-test';

  assess(request: TaxAssessmentRequest): Promise<TaxAssessment> {
    return Promise.resolve({
      amount: zeroMoney(request.gross.currency),
      authority: this.authority,
    });
  }
}

/** Reads a snapshotted assessment back off a stored sale. */
export function storedAssessment(input: {
  readonly currency: string;
  readonly taxAuthority: string | null;
  readonly taxMinor: bigint | null;
}): TaxAssessment | undefined {
  if (input.taxAuthority === null || input.taxMinor === null) return undefined;
  return {
    amount: money(input.taxMinor, input.currency),
    authority: input.taxAuthority,
  };
}
