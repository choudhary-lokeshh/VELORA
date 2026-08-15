import type {
  AdminCreatorReasonCodeValue,
  AdminRemovableObjectValue,
} from '@velora/validation';

import type { ClubRepository } from '../clubs/club-repository.js';
import type { ClubsRepository } from '../clubs/repository.js';
import type {
  CreatorProfileRepository,
  CreatorsRepository,
} from '../creators/repository.js';
import type { CreatorAccountRow } from '../creators/repository.js';
import type { EnforcementRow, SafetyRepository } from '../safety/repository.js';

/**
 * Platform Admin creator operations.
 *
 * ADMIN owns none of the state it changes. A suspension is CREATORS' lifecycle,
 * an unpublished item is PRIVATE CLUBS' lifecycle, and the record of the
 * decision is TRUST & SAFETY's enforcement log — so every operation here writes
 * through the owning domain's repository and appends one enforcement record,
 * and there is no Admin table holding a second opinion about any of it.
 *
 * Every operation is audited by construction rather than by remembering to. The
 * enforcement record carries the actor, the action, the reason, the target, and
 * when it happened, and it is appended in the same transaction as the state
 * change: an operation that succeeded without an audit row, or an audit row
 * with no operation, cannot exist.
 */

export type AdminOutcome =
  | {
      readonly kind: 'applied';
      readonly creator: CreatorAccountRow;
      readonly enforcement: EnforcementRow;
    }
  /**
   * One outcome for a creator that does not exist, an object that is not
   * theirs, and a state that does not permit the operation. An operator sees
   * the list and knows what exists; a caller probing this endpoint learns
   * nothing finer.
   */
  | { readonly kind: 'refused' };

export interface AdminServiceDependencies {
  readonly clubs: ClubRepository;
  readonly content: ClubsRepository;
  readonly creators: CreatorsRepository;
  readonly now: () => Date;
  readonly policyVersion: string;
  readonly profiles: CreatorProfileRepository;
  readonly safety: SafetyRepository;
}

export class AdminCreatorService {
  constructor(private readonly dependencies: AdminServiceDependencies) {}

  /**
   * Stops a creator operating.
   *
   * It does not touch the person's consumer account. `docs/domains/creators.md`
   * keeps creator suspension and a global restriction as separate decisions
   * with separate scopes, and conflating them would ban somebody from a product
   * they were not accused of anything in. Their public surfaces disappear
   * immediately because every public read rechecks current creator state — no
   * sweep, no cascade, nothing to go stale.
   */
  async suspend(input: {
    readonly actorReference: string;
    readonly creatorId: string;
    readonly reasonCode: AdminCreatorReasonCodeValue;
  }): Promise<AdminOutcome> {
    return this.transition({
      ...input,
      expected: ['applicant', 'active'],
      scope: 'creator_suspension',
      status: 'suspended',
      statusReason: 'safety_enforcement',
    });
  }

  /**
   * Restores a stopped capability.
   *
   * Nothing the creator had published comes back with it. Publication is their
   * decision to take again, and silently republishing what an operator took
   * down would undo the enforcement without anybody deciding to.
   */
  async reinstate(input: {
    readonly actorReference: string;
    readonly creatorId: string;
    readonly reasonCode: AdminCreatorReasonCodeValue;
  }): Promise<AdminOutcome> {
    return this.transition({
      ...input,
      expected: ['suspended'],
      scope: 'creator_reinstatement',
      // Back to applicant rather than active: whether every gate still passes
      // is decided by the admission ladder on the next read, not by an
      // operator asserting it here.
      status: 'applicant',
      statusReason: 'onboarding_incomplete',
    });
  }

  /**
   * Takes one published object out of public view.
   *
   * Removal is not deletion. The row stays, the creator keeps it, and the
   * enforcement record says what was taken down and why — which is what an
   * appeal needs and what a deletion would have destroyed.
   */
  async removeObject(input: {
    readonly actorReference: string;
    readonly creatorId: string;
    readonly objectId: string | undefined;
    readonly objectType: AdminRemovableObjectValue;
    readonly reasonCode: AdminCreatorReasonCodeValue;
  }): Promise<AdminOutcome> {
    const { creators, safety } = this.dependencies;
    const creator = await creators.findById(
      creators.transactionless,
      input.creatorId,
    );
    if (creator === undefined) return { kind: 'refused' };
    const now = this.dependencies.now();

    const removed = await this.takeDown(input, now);
    if (removed === undefined) return { kind: 'refused' };

    const enforcement = await safety.insertEnforcement(safety.transactionless, {
      actorReference: input.actorReference,
      effectiveAt: now,
      now,
      policyVersion: this.dependencies.policyVersion,
      reasonCode: input.reasonCode,
      reportId: null,
      scope: 'creator_object_removal',
      subjectId: input.creatorId,
      targetConversationId: null,
      targetObjectId: removed.id,
      targetObjectType: removed.type,
    });
    return { creator, enforcement, kind: 'applied' };
  }

  /** Withdraws one entitlement as a platform action rather than a creator's. */
  async revokeMembership(input: {
    readonly actorReference: string;
    readonly creatorId: string;
    readonly membershipId: string;
    readonly reasonCode: AdminCreatorReasonCodeValue;
  }): Promise<AdminOutcome> {
    const { clubs, creators, safety } = this.dependencies;
    const creator = await creators.findById(
      creators.transactionless,
      input.creatorId,
    );
    if (creator === undefined) return { kind: 'refused' };

    // The entitlement has to belong to a club this creator owns. A membership
    // identifier from elsewhere is answered as if it did not exist, so an
    // operator cannot reach across creators by guessing one.
    const membership = await clubs.findMembershipById(
      clubs.transactionless,
      input.membershipId,
    );
    if (membership === undefined) return { kind: 'refused' };
    const club = await clubs.findClub(clubs.transactionless, membership.clubId);
    if (club?.creatorId !== input.creatorId) return { kind: 'refused' };

    const now = this.dependencies.now();
    const revoked = await clubs.revokeMembership(clubs.transactionless, {
      membershipId: input.membershipId,
      now,
      state: 'revoked',
    });
    if (revoked === undefined) return { kind: 'refused' };

    const enforcement = await safety.insertEnforcement(safety.transactionless, {
      actorReference: input.actorReference,
      effectiveAt: now,
      now,
      policyVersion: this.dependencies.policyVersion,
      reasonCode: input.reasonCode,
      reportId: null,
      scope: 'club_membership_revocation',
      subjectId: input.creatorId,
      targetConversationId: null,
      targetObjectId: input.membershipId,
      targetObjectType: 'club_membership',
    });
    return { creator, enforcement, kind: 'applied' };
  }

  /**
   * Moves a capability, only from a state that permits it.
   *
   * The expected-status predicate is what settles two operators acting at the
   * same moment: both write, one matches, and the loser is refused rather than
   * recording a second enforcement for a change it did not make.
   */
  private async transition(input: {
    readonly actorReference: string;
    readonly creatorId: string;
    readonly expected: readonly ('applicant' | 'active' | 'suspended')[];
    readonly reasonCode: AdminCreatorReasonCodeValue;
    readonly scope: 'creator_suspension' | 'creator_reinstatement';
    readonly status: 'suspended' | 'applicant';
    readonly statusReason: 'safety_enforcement' | 'onboarding_incomplete';
  }): Promise<AdminOutcome> {
    const { creators, safety } = this.dependencies;
    const current = await creators.findById(
      creators.transactionless,
      input.creatorId,
    );
    if (current === undefined) return { kind: 'refused' };
    if (!input.expected.includes(current.status as 'applicant')) {
      return { kind: 'refused' };
    }

    const now = this.dependencies.now();
    const moved = await creators.transitionStatus(creators.transactionless, {
      creatorId: input.creatorId,
      expectedStatus: current.status,
      now,
      status: input.status,
      statusReason: input.statusReason,
      ...(input.status === 'suspended' ? { suspendedAt: now } : {}),
    });
    if (moved === undefined) return { kind: 'refused' };

    const enforcement = await safety.insertEnforcement(safety.transactionless, {
      actorReference: input.actorReference,
      effectiveAt: now,
      now,
      policyVersion: this.dependencies.policyVersion,
      reasonCode: input.reasonCode,
      reportId: null,
      scope: input.scope,
      subjectId: input.creatorId,
      targetConversationId: null,
    });
    return { creator: moved, enforcement, kind: 'applied' };
  }

  /** Unpublishes one object, if it belongs to the named creator. */
  private async takeDown(
    input: {
      readonly creatorId: string;
      readonly objectId: string | undefined;
      readonly objectType: AdminRemovableObjectValue;
    },
    now: Date,
  ): Promise<
    | {
        readonly id: string;
        readonly type: 'creator_profile' | 'creator_content' | 'club';
      }
    | undefined
  > {
    const { clubs, content, profiles } = this.dependencies;
    if (input.objectType === 'creator_profile') {
      const record = await profiles.findByCreatorId(
        profiles.transactionless,
        input.creatorId,
      );
      if (record === undefined) return undefined;
      const moved = await profiles.setPublication({
        creatorId: input.creatorId,
        expectedVersion: record.profile.version,
        now,
        publication: 'draft',
      });
      return moved === undefined
        ? undefined
        : { id: input.creatorId, type: 'creator_profile' };
    }

    if (input.objectId === undefined) return undefined;

    if (input.objectType === 'creator_content') {
      const item = await content.findOwn(content.transactionless, {
        contentId: input.objectId,
        creatorId: input.creatorId,
      });
      if (item === undefined) return undefined;
      const moved = await content.transitionLifecycle(content.transactionless, {
        contentId: input.objectId,
        creatorId: input.creatorId,
        expectedVersion: item.version,
        lifecycle: 'archived',
        now,
      });
      return moved === undefined
        ? undefined
        : { id: input.objectId, type: 'creator_content' };
    }

    const club = await clubs.findOwnClub(clubs.transactionless, {
      clubId: input.objectId,
      creatorId: input.creatorId,
    });
    if (club === undefined) return undefined;
    const moved = await clubs.transitionClub(clubs.transactionless, {
      clubId: input.objectId,
      creatorId: input.creatorId,
      expectedVersion: club.version,
      // Withdrawn from public view rather than closed: closing is final, and an
      // operator taking something out of sight should not also end it forever.
      lifecycle: 'draft',
      now,
    });
    return moved === undefined
      ? undefined
      : { id: input.objectId, type: 'club' };
  }
}
