import type { Money } from '../money/money.js';

/**
 * The approved terms a disbursement must sit inside.
 *
 * Not a payout provider. This is the answer to "when does money a creator has
 * earned become money they may ask for, and how much of it" — every part of
 * which is an unresolved commercial and legal decision in
 * `docs/decisions/DECISIONS_REQUIRED.md`: the settlement window against refund
 * and dispute exposure, the reserve, the minimum payout, the treatment of a
 * negative balance, and the countries any of it applies in.
 *
 * `docs/architecture/10-money-flow.md` draws the step from *pending* to
 * *available* as policy rather than as elapsed time, precisely because
 * inventing a constant there would be inventing that policy. This port is that
 * step. A platform with no approved terms has nothing available, which makes
 * every payout request refuse — and that is a truthful state rather than a
 * broken one.
 */
export interface PayoutPolicy {
  /** Adapter name, recorded for audit and reported to the creator surface. */
  readonly source: string;
  /**
   * How much of a creator's balance may be requested right now, or nothing when
   * no terms are approved.
   *
   * Takes the whole balance rather than a date, because the question is about
   * money and not about time: a settlement window, a rolling reserve, and a
   * minimum payout all answer "how much of this may leave", and a port that
   * only knew how old the money was could express the first and neither of the
   * others.
   */
  releasable(input: {
    readonly available: Money;
    readonly held: Money;
    readonly reserved: Money;
  }): Money | undefined;
}

/**
 * The configured policy in every deployed environment.
 *
 * Nothing is ever releasable, which makes every payout request refuse. There is
 * no partial state: a platform that has approved no settlement window, no
 * reserve, and no minimum cannot correctly release one creator's balance and
 * refuse another's.
 */
export class UnpublishedPayoutPolicy implements PayoutPolicy {
  readonly source = 'unpublished';

  releasable(): undefined {
    return undefined;
  }
}

/**
 * Development and test policy.
 *
 * It releases whatever is available and holds nothing back. That is not a
 * proposal — a real policy will almost certainly withhold against refund and
 * dispute exposure — and its only job is to make the reservation, the
 * instruction, and the disbursement accounting exercisable. Configuration
 * refuses this adapter outside the local and test application environments, and
 * its name is what stops a passing test from reading as evidence about approved
 * payout terms.
 */
export class LocalTestPayoutPolicy implements PayoutPolicy {
  readonly source = 'local-test';

  releasable(input: { readonly available: Money }): Money {
    return input.available;
  }
}
