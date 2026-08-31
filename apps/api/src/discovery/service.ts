import { defaultPageSize } from '@velora/validation';
import type { SafeLogger } from '@velora/observability/server';

import type { Executor, TransactionHandle } from '../database/executor.js';
import { lockPair } from '../database/pair-lock.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import {
  introductionMutualEventName,
  introductionMutualEventVersion,
  introductionSubjectType,
} from './events.js';
import type { CandidateSafetyPort } from './safety.js';
import type {
  ConsumerDirectory,
  DirectoryCandidate,
} from '../users/directory.js';
import {
  hasExpired,
  type IntroductionRepository,
  type IntroductionRow,
} from './introductions.js';
import type { OnboardingService } from '../users/onboarding.js';
import type { UserAccountRow } from '../users/repository.js';
import {
  decodeFeedCursor,
  decodeListCursor,
  encodeFeedCursor,
  encodeListCursor,
  tieBreakWindowFor,
} from './cursor.js';
import {
  availabilityFreshnessBucketSeconds,
  candidateOverFetchFactor,
  maximumCandidateBatchSize,
  maximumFilterRounds,
  passSuppressionMilliseconds,
  pendingSignalExpiry,
  rankingVersion,
  tieBreakRotationMilliseconds,
} from './policy.js';
import { DiscoveryPeerVisibility } from './peer-visibility.js';
import type { DiscoveryRepository } from './repository.js';

export interface DiscoveryCandidate {
  readonly bio: string | undefined;
  readonly displayName: string;
  readonly id: string;
  readonly media: readonly { readonly id: string; readonly position: number }[];
  readonly region: string | undefined;
  readonly sharedLanguages: readonly string[];
}

export type FeedOutcome =
  | {
      readonly kind: 'page';
      readonly candidates: readonly DiscoveryCandidate[];
      readonly nextCursor: string | undefined;
    }
  /** The caller may not browse in its current state. */
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_cursor' };

export interface IntroductionView {
  readonly counterpart: DiscoveryCandidate;
  readonly createdAt: Date;
  readonly id: string;
  readonly mutualAt: Date | undefined;
  readonly role: 'initiator' | 'recipient';
  readonly state: 'pending' | 'mutual' | 'closed';
}

export type PersonOutcome =
  | { readonly kind: 'person'; readonly person: DiscoveryCandidate }
  /** The caller may not browse at all. */
  | { readonly kind: 'not_eligible' }
  /** Absent, or nobody this viewer holds a reason to see. Never told apart. */
  | { readonly kind: 'not_found' };

export type IntroductionOutcome =
  | { readonly kind: 'introduction'; readonly view: IntroductionView }
  | { readonly kind: 'not_eligible' }
  /** Deliberately indistinguishable from a target that does not exist. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict' };

/** What the signal transaction decides, before any profile is rendered. */
type SignalOutcome =
  | { readonly kind: 'introduction'; readonly row: IntroductionRow }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict' };

export type IntroductionListOutcome =
  | {
      readonly kind: 'page';
      readonly introductions: readonly IntroductionView[];
      readonly nextCursor: string | undefined;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_cursor' };

export type PassOutcome =
  | { readonly kind: 'recorded'; readonly suppressedUntil: Date }
  | { readonly kind: 'not_eligible' }
  /** A pass against oneself is meaningless and is refused rather than stored. */
  | { readonly kind: 'invalid_target' };

/**
 * The second reason two people may be introduced, and the only one DISCOVERY
 * does not derive itself.
 *
 * Ordinary discovery introduces people it showed each other: the target has to
 * be a candidate the viewer could be shown at this instant, which is what
 * `isIntroducible` asks. Random live discovery introduces people the *server*
 * put together, and one of them is very often not a candidate of the other's —
 * different language, a closed availability window, a rotation that was never
 * going to surface them. Requiring feed eligibility there would mean Connect
 * silently failing after a good conversation, which is the whole product.
 *
 * So LIVE publishes this, DISCOVERY consumes it, and the rule stays here: being
 * put together live is a reason to be introducible, and it is bounded — the
 * encounter has to be recent — because it is a reason to introduce *now* rather
 * than a standing permission to introduce somebody afterwards.
 *
 * It is declared here rather than imported from LIVE, on the rule
 * `docs/architecture/03-domain-boundaries.md` sets: a consumer declares the
 * contract it needs and the owner supplies it at the composition root.
 */
export interface LiveEncounterIntroducibilityPort {
  hasMetLiveRecently(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;
}

export interface DiscoveryServiceDependencies {
  readonly directory: ConsumerDirectory;
  readonly introductions: IntroductionRepository;
  /** Absent in a composition that does not run live discovery. */
  readonly liveEncounters?: LiveEncounterIntroducibilityPort;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly onboarding: OnboardingService;
  /** DISCOVERY's own outbox, appended inside the transaction that decides. */
  readonly outbox: OutboxAppendPort;
  readonly repository: DiscoveryRepository;
  readonly safety: CandidateSafetyPort;
}

/**
 * Candidate presentation and pair decisions.
 *
 * Profile data is never read from here. USERS publishes a consumer directory
 * and this domain calls it with the criteria it owns, which is what
 * `docs/architecture/03-domain-boundaries.md` requires: another domain may call
 * an approved service contract, not reach into a schema it does not own.
 *
 * What this service owns is the part that is genuinely discovery policy — who
 * may browse at all, which pairs are suppressed, how long a pass lasts, and
 * which window the tie-break is rotating in.
 */
export class DiscoveryService {
  /**
   * The relationship rule this domain publishes, held rather than restated.
   *
   * It is built from this service's own dependencies, so the answer a person
   * page gives about who may look and the answer a photograph gives are the
   * same answer from the same code rather than two readings that could drift.
   */
  private readonly visibility: DiscoveryPeerVisibility;

  constructor(private readonly dependencies: DiscoveryServiceDependencies) {
    this.visibility = new DiscoveryPeerVisibility({
      directory: dependencies.directory,
      introductions: dependencies.introductions,
      safety: dependencies.safety,
    });
  }

  async feed(
    viewer: UserAccountRow,
    input: { readonly cursor: string | undefined; readonly pageSize: number },
  ): Promise<FeedOutcome> {
    if (!(await this.mayBrowse(viewer))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    const decoded =
      input.cursor === undefined ? undefined : decodeFeedCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }

    const window =
      decoded?.window ?? tieBreakWindowFor(now, tieBreakRotationMilliseconds);
    const languages = await this.dependencies.directory.languagesOf(viewer.id);
    const pageSize = Math.max(1, Math.min(input.pageSize, defaultPageSize * 2));
    const walk = await this.walkCandidates({
      languages,
      now,
      pageSize,
      startAfter: decoded?.after,
      viewer,
      window,
    });

    const page = walk.accepted.slice(0, pageSize);
    const candidates = await this.attachMedia(page);

    await this.dependencies.repository.recordPresentations(
      this.dependencies.repository.transactionless,
      {
        candidateIds: page.map((row) => row.id),
        now,
        rankingVersion,
        viewerId: viewer.id,
      },
    );

    return {
      candidates,
      kind: 'page',
      nextCursor: nextPositionOf(walk, page, pageSize, window),
    };
  }

  /**
   * Walks the ranked candidate order, filtering each batch against this
   * domain's own pair state.
   *
   * The two halves of "who may this person see" live in different domains, and
   * neither half can be pushed into the other without one of them reading tables
   * it does not own. Reading eligible candidates in order and rejecting the
   * suppressed ones batch by batch keeps that boundary intact while making the
   * cost of a page a function of the page, not of how many people the viewer has
   * ever declined or been introduced to.
   *
   * The walk stops early when the round budget runs out. That is a bound on one
   * request, not on the result: the position reached comes back in the cursor,
   * so the client resumes exactly there and nothing between here and the end of
   * the order is skipped.
   */
  private async walkCandidates(input: {
    readonly languages: readonly string[];
    readonly now: Date;
    readonly pageSize: number;
    readonly startAfter: string | undefined;
    readonly viewer: UserAccountRow;
    readonly window: number;
  }): Promise<CandidateWalk> {
    const batchSize = Math.min(
      maximumCandidateBatchSize,
      Math.max(input.pageSize + 1, input.pageSize * candidateOverFetchFactor),
    );
    // One more than the page, so whether a further page exists is known without
    // a second count over the same predicate.
    const wanted = input.pageSize + 1;

    const accepted: DirectoryCandidate[] = [];
    let after = input.startAfter;
    let examinedTo: string | undefined;
    let exhausted = false;

    for (let round = 0; round < maximumFilterRounds; round += 1) {
      if (accepted.length >= wanted) break;
      const batch = await this.dependencies.directory.findDiscoverable({
        after,
        freshnessBucketSeconds: availabilityFreshnessBucketSeconds,
        languages: input.languages,
        limit: batchSize,
        now: input.now,
        seed: `${input.viewer.id}:${String(input.window)}`,
        viewerId: input.viewer.id,
        viewerRegion: input.viewer.region,
      });
      if (batch.length === 0) {
        exhausted = true;
        break;
      }

      const candidateIds = batch.map((row) => row.id);
      // Sequential, not concurrent. Each of these reads takes its own pooled
      // connection, so running them together means one in-flight request holds
      // several at once — and a handful of concurrent requests then hold every
      // connection while each waits for one more, which is a deadlock the pool
      // cannot break. The invariant this restores is simple and worth keeping:
      // a request holds at most one pooled connection at a time.
      const suppressed = await this.dependencies.repository.suppressedAmong({
        candidateIds,
        now: input.now,
        viewerId: input.viewer.id,
      });
      const paired = await this.dependencies.introductions.livePairsAmong(
        this.dependencies.repository.transactionless,
        {
          actorId: input.viewer.id,
          candidateIds,
          now: input.now,
        },
      );
      // Blocks are asked per batch for the same reason suppressions are: how
      // many safety relationships an account has accumulated is not allowed to
      // become an input to whether discovery works. A block landing while
      // somebody is paging removes that candidate from every later page, which
      // is the documented consistency model — safety always outranks snapshot
      // stability.
      const blocked = await this.dependencies.safety.blockedAmong({
        candidateIds,
        executor: this.dependencies.repository.transactionless,
        viewerId: input.viewer.id,
      });

      for (const row of batch) {
        // Everything before this point in the order has now been judged, so a
        // resumed page starts after it whether or not it was accepted.
        examinedTo = row.sortKey;
        if (
          suppressed.has(row.id) ||
          paired.has(row.id) ||
          blocked.has(row.id)
        ) {
          continue;
        }
        accepted.push(row);
        if (accepted.length >= wanted) break;
      }

      after = batch.at(-1)?.sortKey ?? after;
      if (batch.length < batchSize) {
        exhausted = true;
        break;
      }
    }

    if (!exhausted && accepted.length < wanted) {
      // Not an error and not truncation — the caller gets a position to resume
      // from. It is worth seeing, because a viewer who repeatedly needs the
      // whole budget is one whose suppressions are dense among the people ranked
      // beside them, and that is a ranking observation rather than a fault.
      this.dependencies.logger.info(
        { rounds: maximumFilterRounds },
        'discovery candidate walk reached its round budget',
      );
    }
    return { accepted, examinedTo, exhausted };
  }

  /**
   * One person, for somebody who holds a reason to look at them.
   *
   * The same minimized projection a card carries, because a page about somebody
   * else is not a licence to publish more about them — what changes is that the
   * whole set of their images is rendered rather than the first, and that is a
   * client decision about references the projection already carried.
   *
   * Who may look is the rule DISCOVERY already publishes for imagery: a live
   * introduction in either direction, or somebody the viewer may currently be
   * shown, both conditioned on Trust and Safety permitting the pair. Reusing it
   * rather than restating it is what keeps a photograph and the page it sits on
   * from ever disagreeing about who may see whom.
   *
   * Absent and not-permitted are one answer, so this cannot be used to learn
   * that an account exists.
   */
  async person(
    viewer: UserAccountRow,
    personId: string,
  ): Promise<PersonOutcome> {
    if (!(await this.mayBrowse(viewer))) return { kind: 'not_eligible' };
    if (personId === viewer.id) return { kind: 'not_found' };

    const permitted = await this.visibility.mayViewProfileMedia({
      executor: this.dependencies.repository.transactionless,
      now: this.dependencies.now(),
      subjectId: personId,
      viewerId: viewer.id,
    });
    if (!permitted) return { kind: 'not_found' };

    const languages = await this.dependencies.directory.languagesOf(viewer.id);
    const profiles = await this.dependencies.directory.profilesFor({
      ids: [personId],
      viewerLanguages: languages,
    });
    const profile = profiles[0];
    if (profile === undefined) return { kind: 'not_found' };
    const [person] = await this.attachMedia([{ ...profile, sortKey: '' }]);
    return person === undefined
      ? { kind: 'not_found' }
      : { kind: 'person', person };
  }

  /**
   * Records a private decline.
   *
   * Nothing is sent to the other person, nothing is scored, and the suppression
   * expires. The candidate's own eligibility is deliberately not checked: a
   * person may decline somebody who has since become invisible to them, and
   * refusing that would be a strange answer to a decision they already made.
   */
  async pass(
    viewer: UserAccountRow,
    candidateId: string,
  ): Promise<PassOutcome> {
    if (!(await this.mayBrowse(viewer))) return { kind: 'not_eligible' };
    if (candidateId === viewer.id) return { kind: 'invalid_target' };

    const now = this.dependencies.now();
    const suppressedUntil = await this.dependencies.repository.recordPass(
      this.dependencies.repository.transactionless,
      {
        candidateId,
        expiresAt: new Date(now.getTime() + passSuppressionMilliseconds),
        now,
        viewerId: viewer.id,
      },
    );
    return { kind: 'recorded', suppressedUntil };
  }

  /**
   * Records one side deliberately opting in, and completes the introduction
   * when the other side already had.
   *
   * The reciprocal transition is a compare-and-set against the other person's
   * pending signal, so an account can never make an introduction mutual by
   * signalling twice. Two simultaneous reciprocal signals produce exactly one
   * introduction: the pair index rejects the second insert, and the loser then
   * reads the winner's row and completes it.
   *
   * A signal also expires. It is an offer to meet somebody who is around now, so
   * it cannot outlive the availability that produced it or the day, whichever
   * ends first. An expired signal is closed where it is found rather than swept
   * by a job — the record of what was offered stays, the pair stops waiting on
   * an answer nobody is going to act on, and either person may signal again.
   */
  async signalIntroduction(
    viewer: UserAccountRow,
    candidateId: string,
  ): Promise<IntroductionOutcome> {
    if (!(await this.mayBrowse(viewer))) return { kind: 'not_eligible' };
    if (candidateId === viewer.id) return { kind: 'not_found' };

    const now = this.dependencies.now();
    // Candidate eligibility and the caller's availability window are read
    // before the transaction, because both go through USERS' directory on its
    // own handle: calling them from inside would need a second pooled
    // connection while this one holds a lock, which is how a pool deadlocks.
    // Neither is a safety answer, and both are already point-in-time
    // revalidations of what a client was shown.
    // Sequential, not concurrent. Each of these reads takes its own pooled
    // connection, so running them together lets one in-flight request hold
    // several at once — and a handful of concurrent requests then hold every
    // connection while each waits for one more, which is a deadlock the pool
    // cannot break. A request holds at most one pooled connection at a time.
    const introducible = await this.isIntroducible(viewer, candidateId, now);
    const availabilityWindow =
      await this.dependencies.directory.openAvailabilityWindow(viewer.id, now);

    return this.dependencies.repository
      .transaction(async (executor): Promise<SignalOutcome> => {
        // Pair lock first, before any row lock or insert. A block committing
        // concurrently either precedes this signal — in which case the check
        // below sees it — or waits for this transaction to finish. There is no
        // window in which both read "no block" and both commit.
        await lockPair(executor, viewer.id, candidateId);
        if (
          !(await this.dependencies.safety.mayInteract({
            executor,
            first: viewer.id,
            now,
            second: candidateId,
          }))
        ) {
          // A blocked pair answers exactly as a candidate that is not there.
          // Returning anything else would disclose another person's safety
          // decision, which the domain document forbids in as many words.
          return { kind: 'not_found' };
        }

        const existing = await this.retireExpired(
          executor,
          await this.dependencies.introductions.findUnclosedPair(executor, {
            first: viewer.id,
            second: candidateId,
          }),
          now,
        );
        if (
          existing === undefined &&
          !introducible &&
          !(await this.hasMetLiveRecently(
            executor,
            viewer.id,
            candidateId,
            now,
          ))
        ) {
          // Absent and not-permitted answer identically, so probing this
          // endpoint discloses nothing about another account.
          return { kind: 'not_found' };
        }

        const created =
          existing === undefined
            ? await this.dependencies.introductions.insertPending(executor, {
                expiresAt: pendingSignalExpiry(now, availabilityWindow),
                initiatorId: viewer.id,
                now,
                targetId: candidateId,
              })
            : undefined;
        if (created !== undefined) {
          return { kind: 'introduction', row: created };
        }

        const live =
          existing ??
          (await this.dependencies.introductions.findUnclosedPair(executor, {
            first: viewer.id,
            second: candidateId,
          }));
        if (live === undefined) return { kind: 'conflict' };
        if (hasExpired(live, now)) {
          // The row lost the insert race to somebody whose own signal has since
          // expired. Answering `conflict` asks the caller to try again, which is
          // exactly right: the retry retires that row and creates a fresh signal.
          return { kind: 'conflict' };
        }
        if (live.state === 'mutual' || live.initiatorId === viewer.id) {
          // Already answered, or the caller repeating their own signal. Either
          // way the honest response is the introduction as it stands.
          return { kind: 'introduction', row: live };
        }

        const mutual = await this.dependencies.introductions.makeMutual(
          executor,
          {
            expectedVersion: live.version,
            id: live.id,
            now,
            respondingActorId: viewer.id,
          },
        );
        if (mutual !== undefined) {
          // The fact is written by the transaction that made the transition, so
          // a process killed the instant after this commits still owes the
          // notice. Only the initiator is named: the caller reciprocating is
          // about to receive this introduction in their own response.
          await this.dependencies.outbox.append(executor, {
            eventName: introductionMutualEventName,
            eventVersion: introductionMutualEventVersion,
            now,
            occurredAt: mutual.mutualAt ?? now,
            payload: {
              initiatorId: mutual.initiatorId,
              introductionId: mutual.id,
              respondingActorId: viewer.id,
            },
            subjectId: mutual.id,
            subjectType: introductionSubjectType,
          });
          return { kind: 'introduction', row: mutual };
        }
        const settled = await this.dependencies.introductions.findForActor(
          executor,
          { actorId: viewer.id, id: live.id },
        );
        return settled === undefined
          ? { kind: 'conflict' }
          : { kind: 'introduction', row: settled };
      })
      .then(async (outcome): Promise<IntroductionOutcome> =>
        // Rendering reads USERS' directory, so it happens after the
        // transaction has committed and released its connection.
        outcome.kind === 'introduction'
          ? {
              kind: 'introduction',
              view: await this.viewOf(viewer, outcome.row),
            }
          : outcome,
      );
  }

  /**
   * Declines the other person's pending signal.
   *
   * The other person is not told. The pair is also suppressed from ordinary
   * discovery for the same window a pass uses, because a decline is the same
   * kind of private negative answer and re-showing the pair immediately would
   * make the decline meaningless.
   */
  async declineIntroduction(
    viewer: UserAccountRow,
    introductionId: string,
  ): Promise<IntroductionOutcome> {
    return this.closeIntroduction(viewer, introductionId, {
      reason: 'declined',
      requireInitiator: false,
      suppressPair: true,
    });
  }

  /** Withdraws the caller's own pending signal. Nothing is disclosed. */
  async withdrawIntroduction(
    viewer: UserAccountRow,
    introductionId: string,
  ): Promise<IntroductionOutcome> {
    return this.closeIntroduction(viewer, introductionId, {
      reason: 'withdrawn',
      requireInitiator: true,
      suppressPair: false,
    });
  }

  async listIntroductions(
    viewer: UserAccountRow,
    input: { readonly cursor: string | undefined; readonly pageSize: number },
  ): Promise<IntroductionListOutcome> {
    if (!(await this.mayBrowse(viewer))) return { kind: 'not_eligible' };
    const decoded =
      input.cursor === undefined ? undefined : decodeListCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }

    const pageSize = Math.max(1, Math.min(input.pageSize, defaultPageSize * 2));
    const rows = await this.dependencies.introductions.listLive(
      this.dependencies.repository.transactionless,
      {
        actorId: viewer.id,
        before: decoded,
        limit: pageSize + 1,
        now: this.dependencies.now(),
      },
    );
    const page = rows.slice(0, pageSize);
    const introductions = await this.viewsOf(viewer, page);
    const last = page.at(-1);
    return {
      introductions,
      kind: 'page',
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeListCursor({ createdAt: last.createdAt, id: last.id })
          : undefined,
    };
  }

  /**
   * Closes a pending signal whose window has passed, and reports the pair as
   * having nothing live.
   *
   * Losing the compare-and-set means somebody else already resolved the row —
   * another request retiring the same expiry, or an enforcement closure. Either
   * way the pair no longer has a live signal, which is the answer this returns.
   * Nothing is rewritten: the row keeps who offered what and when, and gains
   * only the reason it ended.
   */
  private async retireExpired(
    executor: TransactionHandle,
    row: IntroductionRow | undefined,
    now: Date,
  ): Promise<IntroductionRow | undefined> {
    if (row === undefined || !hasExpired(row, now)) return row;
    await this.dependencies.introductions.close(executor, {
      expectedVersion: row.version,
      id: row.id,
      now,
      reason: 'expired',
    });
    return undefined;
  }

  private async closeIntroduction(
    viewer: UserAccountRow,
    introductionId: string,
    options: {
      readonly reason: 'declined' | 'withdrawn';
      readonly requireInitiator: boolean;
      readonly suppressPair: boolean;
    },
  ): Promise<IntroductionOutcome> {
    if (!(await this.mayBrowse(viewer))) return { kind: 'not_eligible' };
    const row = await this.dependencies.introductions.findForActor(
      this.dependencies.repository.transactionless,
      { actorId: viewer.id, id: introductionId },
    );
    const now = this.dependencies.now();
    // An expired signal is not something either person can still answer, so it
    // is indistinguishable from one that is not there.
    if (row?.state !== 'pending' || hasExpired(row, now)) {
      return { kind: 'not_found' };
    }
    const isInitiator = row.initiatorId === viewer.id;
    if (isInitiator !== options.requireInitiator) return { kind: 'not_found' };

    const closed = await this.dependencies.introductions.close(
      this.dependencies.repository.transactionless,
      {
        expectedVersion: row.version,
        id: row.id,
        now,
        reason: options.reason,
      },
    );
    if (closed === undefined) return { kind: 'conflict' };
    if (options.suppressPair) {
      await this.dependencies.repository.recordPass(
        this.dependencies.repository.transactionless,
        {
          candidateId: counterpartOf(closed, viewer.id),
          expiresAt: new Date(now.getTime() + passSuppressionMilliseconds),
          now,
          viewerId: viewer.id,
        },
      );
    }
    return { kind: 'introduction', view: await this.viewOf(viewer, closed) };
  }

  /** Revalidates the target at the moment of the action, not when it was shown. */
  /**
   * Whether this viewer could legitimately be introduced to this person now.
   *
   * Published so another domain can gate an action that *would* lead to an
   * introduction without performing one. It is the same predicate a signal is
   * revalidated against — discoverability, availability, language overlap,
   * region rotation, adult standing, and Trust and Safety — asked as a question
   * rather than as a side effect.
   *
   * It deliberately answers a plain boolean. A caller learns whether the action
   * it is about to offer is permitted and never why it is not, which keeps
   * "not discoverable", "not available", "blocked", and "does not exist" a
   * single indistinguishable answer wherever this is used.
   */
  async mayBeIntroducedTo(
    viewer: UserAccountRow,
    candidateId: string,
    now: Date,
  ): Promise<boolean> {
    if (candidateId === viewer.id) return false;
    if (!(await this.mayBrowse(viewer))) return false;
    return this.isIntroducible(viewer, candidateId, now);
  }

  private async isIntroducible(
    viewer: UserAccountRow,
    candidateId: string,
    now: Date,
  ): Promise<boolean> {
    const languages = await this.dependencies.directory.languagesOf(viewer.id);
    if (languages.length === 0) return false;
    const matches = await this.dependencies.directory.findDiscoverable({
      after: undefined,
      freshnessBucketSeconds: availabilityFreshnessBucketSeconds,
      languages,
      limit: 1,
      now,
      onlyId: candidateId,
      seed: viewer.id,
      viewerId: viewer.id,
      viewerRegion: viewer.region,
    });
    return matches.length === 1;
  }

  /**
   * Whether a live encounter is the reason these two may be introduced.
   *
   * Asked inside the writing transaction, on the caller's own executor, rather
   * than beside the feed-eligibility read that happens before it. The feed
   * answer is a point-in-time revalidation of a page somebody is holding; this
   * one is an authorization, and an authorization taken on a different
   * connection a moment earlier is an authorization with a window under it.
   *
   * A composition without live discovery answers `false` here and behaves
   * exactly as this domain did before ADR-0040.
   */
  private async hasMetLiveRecently(
    executor: Executor,
    first: string,
    second: string,
    now: Date,
  ): Promise<boolean> {
    const live = this.dependencies.liveEncounters;
    if (live === undefined) return false;
    return live.hasMetLiveRecently({ executor, first, now, second });
  }

  private async viewOf(
    viewer: UserAccountRow,
    row: IntroductionRow,
  ): Promise<IntroductionView> {
    const views = await this.viewsOf(viewer, [row]);
    const view = views[0];
    if (view === undefined) throw new Error('Introduction view was not built');
    return view;
  }

  private async viewsOf(
    viewer: UserAccountRow,
    rows: readonly IntroductionRow[],
  ): Promise<readonly IntroductionView[]> {
    if (rows.length === 0) return [];
    const counterpartIds = rows.map((row) => counterpartOf(row, viewer.id));
    const languages = await this.dependencies.directory.languagesOf(viewer.id);
    // Sequential, not concurrent. Each of these reads takes its own pooled
    // connection, so running them together lets one in-flight request hold
    // several at once — and a handful of concurrent requests then hold every
    // connection while each waits for one more, which is a deadlock the pool
    // cannot break. A request holds at most one pooled connection at a time.
    const profiles = await this.dependencies.directory.profilesFor({
      ids: counterpartIds,
      viewerLanguages: languages,
    });
    const media = await this.dependencies.directory.mediaFor(counterpartIds);
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const mediaById = new Map<
      string,
      { readonly id: string; readonly position: number }[]
    >();
    for (const item of media) {
      const existing = mediaById.get(item.userId) ?? [];
      existing.push({ id: item.id, position: item.position });
      mediaById.set(item.userId, existing);
    }

    return rows.flatMap((row) => {
      const counterpartId = counterpartOf(row, viewer.id);
      const profile = byId.get(counterpartId);
      if (profile === undefined) return [];
      return [
        {
          counterpart: {
            bio: profile.bio ?? undefined,
            displayName: profile.displayName,
            id: profile.id,
            media: mediaById.get(counterpartId) ?? [],
            region: profile.region ?? undefined,
            sharedLanguages: profile.sharedLanguages,
          },
          createdAt: row.createdAt,
          id: row.id,
          mutualAt: row.mutualAt ?? undefined,
          role: row.initiatorId === viewer.id ? 'initiator' : 'recipient',
          state: row.state,
        },
      ];
    });
  }

  /**
   * Browsing requires the same standing that appearing requires.
   *
   * An account that is not itself eligible to be seen does not get to look
   * through other people's profiles: discovery is mutual exposure, not a
   * directory.
   */
  private async mayBrowse(viewer: UserAccountRow): Promise<boolean> {
    if (viewer.status !== 'active') return false;
    const eligibility = await this.dependencies.onboarding.evaluate(viewer);
    return eligibility.step === 'completed';
  }

  private async attachMedia(
    rows: readonly DirectoryCandidate[],
  ): Promise<readonly DiscoveryCandidate[]> {
    const media = await this.dependencies.directory.mediaFor(
      rows.map((row) => row.id),
    );
    const byCandidate = new Map<
      string,
      { readonly id: string; readonly position: number }[]
    >();
    for (const item of media) {
      const existing = byCandidate.get(item.userId) ?? [];
      existing.push({ id: item.id, position: item.position });
      byCandidate.set(item.userId, existing);
    }
    return rows.map((row) => ({
      bio: row.bio ?? undefined,
      displayName: row.displayName,
      id: row.id,
      media: byCandidate.get(row.id) ?? [],
      region: row.region ?? undefined,
      sharedLanguages: row.sharedLanguages,
    }));
  }
}

/** The other person in a pair, from the perspective of one of them. */
function counterpartOf(row: IntroductionRow, actorId: string): string {
  return row.pairLowId === actorId ? row.pairHighId : row.pairLowId;
}

interface CandidateWalk {
  /** Candidates that survived this domain's own filtering, in ranking order. */
  readonly accepted: readonly DirectoryCandidate[];
  /** How far along the ranked order the walk actually judged. */
  readonly examinedTo: string | undefined;
  /** Whether the ranked order ended, as opposed to the walk stopping early. */
  readonly exhausted: boolean;
}

/**
 * Where the next page starts, or that there is no next page.
 *
 * A short page is not the end of the feed. When the round budget stops a walk
 * before it fills a page there are still candidates beyond it, and answering
 * with no cursor would end the feed at a point the ranking never reached — the
 * silent truncation this design exists to remove. Only the ranked order running
 * out ends it.
 */
function nextPositionOf(
  walk: CandidateWalk,
  page: readonly DirectoryCandidate[],
  pageSize: number,
  window: number,
): string | undefined {
  if (walk.accepted.length > pageSize) {
    const last = page.at(-1);
    return last === undefined
      ? undefined
      : encodeFeedCursor({ after: last.sortKey, window });
  }
  if (walk.exhausted || walk.examinedTo === undefined) return undefined;
  return encodeFeedCursor({ after: walk.examinedTo, window });
}
