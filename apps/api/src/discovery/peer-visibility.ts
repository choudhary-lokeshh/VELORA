import type { Executor } from '../database/executor.js';
import type { ConsumerDirectory } from '../users/directory.js';
import { hasExpired, type IntroductionRepository } from './introductions.js';
import { availabilityFreshnessBucketSeconds } from './policy.js';
import type { CandidateSafetyPort } from './safety.js';

/**
 * Whether one consumer currently holds a reason to be shown another's imagery.
 *
 * USERS owns a consumer's profile images and knows the slot they occupy. What
 * it cannot know is whether some *other* account may see them, because that is a
 * question about the relationship between two people and DISCOVERY is the domain
 * that decides relationships. `ConsumerProfileMediaAssociation` recorded exactly
 * that gap in a comment and entitled only the owner; this is the answer it was
 * waiting for, written where the rule belongs.
 *
 * There are two ways to hold a reason and no third.
 *
 * **The pair holds a live introduction.** A pending signal in either direction
 * that has not expired, or a mutual introduction. Somebody who has turned
 * discoverability off, whose availability window has closed, or who has stopped
 * matching on language does not vanish from a conversation they are already in,
 * so this arm deliberately does not re-ask any of those questions.
 *
 * **The subject is a candidate the viewer may be shown right now.** The same
 * predicate a signal is revalidated against, so a photograph is visible on
 * exactly the surface where the person is, and stops being visible when they
 * stop being eligible — including when their availability window closes, which
 * is the one place presence legitimately reaches the imagery.
 *
 * Both arms are additionally conditioned on Trust and Safety permitting the
 * pair. A block therefore withdraws imagery on the next issuance in both
 * directions, whatever relationship preceded it.
 *
 * What is deliberately *not* asked is whether the **viewer** is admitted,
 * available, or discoverable. Being seen and being able to see are different
 * questions, and requiring the viewer to be discoverable would mean somebody who
 * turned themselves off could no longer see the people they are already talking
 * to. Every route that reaches this has already established that the caller is
 * an active consumer.
 */
export interface ConsumerPeerVisibilityPort {
  mayViewProfileMedia(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly subjectId: string;
    readonly viewerId: string;
  }): Promise<boolean>;
}

export interface DiscoveryPeerVisibilityDependencies {
  /** USERS' published directory. Never a `users_` table read from here. */
  readonly directory: ConsumerDirectory;
  readonly introductions: IntroductionRepository;
  /** The published TRUST & SAFETY eligibility contract. */
  readonly safety: CandidateSafetyPort;
}

export class DiscoveryPeerVisibility implements ConsumerPeerVisibilityPort {
  constructor(
    private readonly dependencies: DiscoveryPeerVisibilityDependencies,
  ) {}

  async mayViewProfileMedia(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly subjectId: string;
    readonly viewerId: string;
  }): Promise<boolean> {
    // Somebody's own image is theirs to see through this path as well. USERS
    // already answers that case before asking, so reaching it here means the
    // two identifiers genuinely differ; the guard exists so the pair queries
    // below are never run against a degenerate pair.
    if (input.viewerId === input.subjectId) return true;

    // Safety first, and on its own. A denied pair is denied whatever
    // relationship or eligibility would otherwise have applied, and asking it
    // before either arm means neither arm can accidentally become the reason.
    const permitted = await this.dependencies.safety.mayInteract({
      executor: input.executor,
      first: input.viewerId,
      now: input.now,
      second: input.subjectId,
    });
    if (!permitted) return false;

    const introduction = await this.dependencies.introductions.findUnclosedPair(
      input.executor,
      { first: input.viewerId, second: input.subjectId },
    );
    if (introduction !== undefined && !hasExpired(introduction, input.now)) {
      return true;
    }

    return this.isCurrentCandidate(input);
  }

  /**
   * Whether the subject would appear in the viewer's feed at this instant.
   *
   * Asked through USERS' directory with the criteria DISCOVERY owns, which is
   * the same call `signalIntroduction` makes to revalidate a target rather than
   * trusting the page a client is still holding.
   *
   * Region and rotation seed do not participate. Both exist only to order a
   * page, and this asks a membership question about one identifier, so the
   * ordering they would produce is never read. Passing the viewer's real region
   * would mean a second read of a `users_` row for a value that cannot change
   * the answer.
   */
  private async isCurrentCandidate(input: {
    readonly now: Date;
    readonly subjectId: string;
    readonly viewerId: string;
  }): Promise<boolean> {
    const languages = await this.dependencies.directory.languagesOf(
      input.viewerId,
    );
    if (languages.length === 0) return false;
    const matches = await this.dependencies.directory.findDiscoverable({
      after: undefined,
      freshnessBucketSeconds: availabilityFreshnessBucketSeconds,
      languages,
      limit: 1,
      now: input.now,
      onlyId: input.subjectId,
      seed: input.viewerId,
      viewerId: input.viewerId,
      viewerRegion: null,
    });
    return matches.length === 1;
  }
}
