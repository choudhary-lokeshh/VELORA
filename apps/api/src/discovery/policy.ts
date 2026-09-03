/**
 * Approved V1 discovery policy.
 *
 * Every value a discovery decision depends on is defined once, here. The point
 * is not tidiness: a suppression window or a ranking rule restated in two places
 * is a policy that can be changed in one of them, and a product rule that is
 * true in one code path and false in another is worse than no rule.
 */

/**
 * How long a pass suppresses a pair from ordinary discovery.
 *
 * A pass is private and expiring. It tells the platform "not now", not "never"
 * and not "this person is bad", so it must not accumulate into anything
 * permanent. A block is the indefinite suppression, and it belongs to
 * TRUST & SAFETY.
 */
export const passSuppressionDays = 7;
export const passSuppressionMilliseconds =
  passSuppressionDays * 24 * 60 * 60 * 1000;

/**
 * How long a positive signal stays capable of completing an introduction.
 *
 * A signal is an offer to meet somebody who is around now, so it cannot outlive
 * the availability that produced it, and it cannot outlive the day either: an
 * answer arriving a week later is answering a question nobody is still asking.
 * The effective expiry is whichever of the two comes first, and a person who is
 * still interested may simply signal again.
 */
export const pendingSignalMaximumMilliseconds = 24 * 60 * 60 * 1000;

/**
 * The effective expiry of a positive signal.
 *
 * `min(originating availability window, creation + 24h)`. A caller with no open
 * window — browsing is not gated on availability — gets the maximum, which is
 * still bounded.
 */
export function pendingSignalExpiry(
  createdAt: Date,
  availabilityWindow: Date | undefined,
): Date {
  const ceiling = new Date(
    createdAt.getTime() + pendingSignalMaximumMilliseconds,
  );
  return availabilityWindow !== undefined && availabilityWindow < ceiling
    ? availabilityWindow
    : ceiling;
}

/**
 * How many candidates one directory read fetches per page requested.
 *
 * Suppression lives in DISCOVERY and eligibility lives in USERS, so a page is
 * assembled by reading a batch of eligible candidates in ranking order and
 * filtering it against this domain's own tables. Over-fetching means the common
 * case — a viewer with few live suppressions among the people ranked next to
 * them — completes in a single round trip.
 */
/**
 * How many introductions one account may open in the window.
 *
 * A cap on automation rather than on interest. Signalling is already bounded in
 * practice by having to be shown somebody first, but "shown somebody" is a read
 * a script can repeat, and the product intent is choosing people rather than
 * signalling everybody. Reaching the bound refuses further signals for a while
 * and closes nothing already open.
 *
 * Counted from the initiator, because a signal somebody received is not
 * something they did.
 */
export const maximumIntroductionSignalsPerWindow = 60;
export const introductionSignalWindowMilliseconds = 60 * 60 * 1000;

export const candidateOverFetchFactor = 4;

/**
 * The hard ceiling on one directory read.
 *
 * This bounds a query, not a correctness rule. No number of suppression
 * relationships changes which candidates are eligible or in what order they are
 * reached; it only changes how many batches the walk takes.
 */
export const maximumCandidateBatchSize = 200;

/**
 * How many batches one request will walk before handing the position back.
 *
 * Bounds the work a single request can do when a viewer's suppressions are dense
 * among the candidates ranked next to them. Reaching it is not truncation: the
 * response carries the position the walk reached, so the client continues from
 * exactly there and no eligible candidate is skipped.
 */
export const maximumFilterRounds = 8;

/**
 * How often the tie-break rotates.
 *
 * The order within a tie must be stable while somebody is paging through it, or
 * they see the same person twice and miss another. It must not be stable
 * forever, or the same accounts sit at the top of everyone's tie groups
 * permanently. A window gives both: stable inside it, different across it, and
 * the window a page started in travels in the cursor so a page boundary never
 * reshuffles underneath a reader.
 */
export const tieBreakRotationMilliseconds = 24 * 60 * 60 * 1000;

/**
 * How coarsely availability freshness is compared.
 *
 * Exact timestamps would make freshness a near-unique value and the tie-break
 * would never actually decide anything, which is the same as not having one.
 * Bucketing puts everyone who became available in the same hour on equal
 * footing, so the rotating tie-break does the work the approved policy asks it
 * to do, and being thirty seconds quicker to press a button stops being an
 * advantage.
 *
 * The value bucketed is when a person's availability session began, not when
 * their row was last written, so re-saving availability does not move them
 * through anybody's results. That is what makes forward-only paging stable; see
 * the consistency model in `docs/domains/discovery.md`.
 */
export const availabilityFreshnessBucketSeconds = 60 * 60;

/**
 * Identifier of the ranking rule that produced a page.
 *
 * Recorded on every presentation. A result nobody can attribute to a specific
 * rule cannot be explained afterwards, and "why did I see this person" is a
 * question an adults-only platform has to be able to answer.
 */
export const rankingVersion = 'v1-deterministic';

/**
 * The V1 ranking rule, in the order it is applied.
 *
 * It is deterministic and explainable by construction. There is no model, no
 * attractiveness score, no popularity or follower signal, and nothing
 * purchasable: none of those may affect either eligibility or order.
 */
export const rankingSignals = [
  'coarse_region_match',
  'shared_language_count',
  'availability_freshness',
  'rotating_tie_break',
] as const;
export type RankingSignal = (typeof rankingSignals)[number];
