import type { Executor } from '../database/executor.js';
import type { ContentSafetyPort } from '../safety/content-safety.js';
import type { SafetyEligibilityPort } from '../safety/eligibility.js';
import type {
  DistributionSurface,
  EnforcementObjectType,
  SafetyCapability,
} from '../safety/policy.js';
import type { MediaOwnerDomain } from './policy.js';
import type { MediaSafetyPort } from './publication.js';

/**
 * How MEDIA asks Trust and Safety about an asset.
 *
 * MEDIA cannot form the question on its own. An asset has no idea what it is
 * for, so it does not know which subject a restriction would name, which object
 * a takedown would name, or which capability is even relevant. The owning
 * domain knows all three, and supplies them; Trust and Safety answers them.
 * This module is the wire between the two and holds no policy of its own — no
 * precedence, no scope arithmetic, no notion of what a restriction implies.
 */

/**
 * What the owning domain must say before a safety question can be asked.
 *
 * `capability` is named by the owning domain because it differs by what the
 * asset is for: a consumer's profile image rides on `consumer_interaction`, a
 * creator's work on `creator_publication`. MEDIA choosing it would be MEDIA
 * deciding which safety rule applies.
 */
export interface MediaSafetySubject {
  readonly capability: SafetyCapability;
  /**
   * Whether this asset hangs off a content item, and therefore additionally
   * needs the content safety gate — classification, consent, surface
   * eligibility, viewer assurance, and the mature-content gate.
   *
   * When true and no content gate is wired, delivery is **denied**. The gap is
   * represented rather than assumed away: an asset that needs a gate nobody
   * asked is not an asset that passed it.
   */
  readonly contentGated: boolean;
  readonly objectId: string | undefined;
  readonly objectType: EnforcementObjectType | undefined;
  readonly subjectId: string;
}

export interface MediaSafetySubjectResolver {
  resolve(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly ownerDomain: MediaOwnerDomain;
  }): Promise<MediaSafetySubject | undefined>;
}

/**
 * Dispatches to whichever domain reserved the asset.
 *
 * A domain with no entry resolves nothing, and an unresolved subject denies —
 * so a new owning domain's assets are undeliverable until somebody says who
 * Trust and Safety should be asked about.
 */
export class RoutedMediaSafetySubjects implements MediaSafetySubjectResolver {
  constructor(
    private readonly routes: Partial<
      Record<MediaOwnerDomain, MediaSafetySubjectResolver>
    >,
  ) {}

  resolve(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly ownerDomain: MediaOwnerDomain;
  }): Promise<MediaSafetySubject | undefined> {
    const route = this.routes[input.ownerDomain];
    if (route === undefined) return Promise.resolve(undefined);
    return route.resolve(input);
  }
}

/**
 * The content-level safety answer.
 *
 * Deciding whether a content item may be delivered needs its classification,
 * its depicted-person consent, the surface, and the viewer's adult assurance,
 * and none of those is MEDIA's to hold. The implementation below is a wire to
 * the Trust and Safety gate and contains no rule of its own.
 */
export interface MediaContentSafetyPort {
  mayDeliverContent(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly objectId: string;
    readonly subjectId: string;
    readonly surface: DistributionSurface;
  }): Promise<boolean>;
}

/**
 * The content gate, asked through the published contract.
 *
 * It calls `mayDeliver` rather than `decide`, because a delivery caller cannot
 * honestly assert what an item is: the gate reads the creator's own declaration
 * and applies its own rules. MEDIA learns one boolean and never sees a
 * classification, a consent record, or a denial reason.
 *
 * Mature content is refused inside that gate, by a capability with exactly one
 * configured value in every environment. Nothing here can change that, and
 * wiring this adapter enables nothing that was previously blocked.
 */
export class SafetyBackedMediaContentSafety implements MediaContentSafetyPort {
  constructor(private readonly gate: ContentSafetyPort) {}

  async mayDeliverContent(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly objectId: string;
    readonly subjectId: string;
    readonly surface: DistributionSurface;
  }): Promise<boolean> {
    const decision = await this.gate.mayDeliver({
      contentId: input.objectId,
      creatorId: input.subjectId,
      executor: input.executor,
      now: input.now,
      surface: input.surface,
      // Deliberately absent. Adult assurance is only consulted for a mature
      // class, and a mature class is refused before the question is reached —
      // so supplying a value here could only ever weaken a gate, never satisfy
      // one. When mature content is a real product decision, the viewer's
      // assurance arrives from AUTH with the request rather than from here.
      viewerAdultAssurance: undefined,
    });
    return decision.allowed;
  }
}

export interface SafetyBackedMediaSafetyDependencies {
  /** Absent until an owning domain wires one. Its absence denies. */
  readonly content?: MediaContentSafetyPort;
  readonly eligibility: SafetyEligibilityPort;
  readonly subjects: MediaSafetySubjectResolver;
}

/**
 * The Trust and Safety answer, asked through the published contract.
 *
 * Two questions, both SAFETY's to answer. Whether the subject may exercise the
 * capability at all, and whether this particular object is currently held out
 * of view. A content-gated asset needs a third, and if nobody can ask it the
 * answer is no.
 *
 * Every call takes the caller's executor, on the rule the eligibility contract
 * states: a safety check that commits separately from the thing it authorizes
 * is not a check. A delivery credential minted from an answer read in an
 * earlier transaction is a credential minted from a fact that may already have
 * changed.
 */
export class SafetyBackedMediaSafety implements MediaSafetyPort {
  constructor(
    private readonly dependencies: SafetyBackedMediaSafetyDependencies,
  ) {}

  async mayDeliver(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly ownerDomain: MediaOwnerDomain;
    readonly surface: DistributionSurface;
  }): Promise<boolean> {
    const { content, eligibility, subjects } = this.dependencies;

    const subject = await subjects.resolve({
      assetId: input.assetId,
      executor: input.executor,
      ownerDomain: input.ownerDomain,
    });
    // Nobody claims this asset, so nobody can vouch for it.
    if (subject === undefined) return false;

    const decision = await eligibility.decide({
      capability: subject.capability,
      executor: input.executor,
      now: input.now,
      subjectId: subject.subjectId,
    });
    if (!decision.allowed) return false;

    if (subject.objectId !== undefined && subject.objectType !== undefined) {
      const restricted = await eligibility.isObjectRestricted({
        executor: input.executor,
        now: input.now,
        objectId: subject.objectId,
        objectType: subject.objectType,
        subjectId: subject.subjectId,
      });
      if (restricted) return false;
    }

    if (!subject.contentGated) return true;
    // A content-gated asset with no content gate wired. The honest answer is
    // no: the question that would decide it is one nothing here can ask.
    if (content === undefined || subject.objectId === undefined) return false;
    return content.mayDeliverContent({
      executor: input.executor,
      now: input.now,
      objectId: subject.objectId,
      subjectId: subject.subjectId,
      surface: input.surface,
    });
  }
}
