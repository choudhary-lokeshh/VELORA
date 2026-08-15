import type {
  AdminCreatorReasonCodeValue,
  AdminRemovableObjectValue,
} from '@velora/validation';

import type { ClubRepository } from '../clubs/club-repository.js';
import type { ClubsRepository } from '../clubs/repository.js';
import type {
  DatabaseHandle,
  TransactionHandle,
} from '../database/executor.js';
import type {
  CreatorProfileRepository,
  CreatorsRepository,
} from '../creators/repository.js';
import type { CreatorAccountRow } from '../creators/repository.js';
import type { EnforcementAuthority } from '../safety/enforcement.js';
import type { EnforcementObjectType } from '../safety/policy.js';
import type { EnforcementRow } from '../safety/repository.js';

/**
 * Platform Admin creator operations.
 *
 * ADMIN owns none of the state it changes. A suspension is CREATORS' lifecycle,
 * an unpublished item is PRIVATE CLUBS' lifecycle, and the record of the
 * decision is TRUST & SAFETY's enforcement log — so every operation here writes
 * through the owning domain's repository and asks TRUST & SAFETY's enforcement
 * authority to record the decision, and there is no Admin table holding a
 * second opinion about any of it.
 *
 * Every operation is audited by construction rather than by remembering to, and
 * the state change and its record now genuinely commit together: both happen
 * inside one transaction, so an operation that succeeded without an audit row,
 * or an audit row with no operation, cannot exist. They previously ran as two
 * independent statements, which meant a failure between them left exactly the
 * state this comment claimed was unreachable.
 *
 * The enforcement record is written by the authority rather than appended here,
 * because one writer is what keeps the enforcement vocabulary a rule instead of
 * a convention. It also fixes a quieter error: these records used to be stamped
 * with the *reporting* policy version, which described the wrong vocabulary
 * entirely.
 */

/**
 * Refusal as a rollback.
 *
 * Not an error condition the caller sees: every one of these is a refusal the
 * route already answers with a conflict. Throwing is how the refusal reaches
 * the transaction boundary, so nothing written on the way to discovering it
 * survives.
 */
class RefusedOperation extends Error {
  constructor() {
    super('Operator request refused');
    this.name = 'RefusedOperation';
  }
}

function refuse(): never {
  throw new RefusedOperation();
}

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
  readonly authority: EnforcementAuthority;
  readonly clubs: ClubRepository;
  readonly content: ClubsRepository;
  readonly creators: CreatorsRepository;
  readonly database: DatabaseHandle;
  readonly now: () => Date;
  readonly profiles: CreatorProfileRepository;
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
    return this.inTransaction(async (executor) => {
      const current = await this.dependencies.creators.findById(
        executor,
        input.creatorId,
      );
      if (current === undefined) refuse();
      if (current.status !== 'applicant' && current.status !== 'active') {
        refuse();
      }

      const imposed = await this.dependencies.authority.impose(executor, {
        actorReference: input.actorReference,
        reasonCode: input.reasonCode,
        scope: 'creator_suspension',
        subjectId: input.creatorId,
      });
      if (imposed.kind !== 'recorded') refuse();

      const now = this.dependencies.now();
      const moved = await this.dependencies.creators.transitionStatus(
        executor,
        {
          creatorId: input.creatorId,
          expectedStatus: current.status,
          now,
          status: 'suspended',
          statusReason: 'safety_enforcement',
          suspendedAt: now,
        },
      );
      if (moved === undefined) refuse();
      return {
        creator: moved,
        enforcement: imposed.enforcement,
        kind: 'applied',
      };
    });
  }

  /**
   * Restores a stopped capability.
   *
   * The reversal is a second enforcement record naming the suspension it lifts,
   * so the original stays exactly as it was written. A reinstatement with no
   * live suspension behind it is refused rather than recorded: CREATORS and
   * TRUST & SAFETY disagreeing about whether somebody is suspended is a fault
   * to surface, not one to paper over with a record of undoing nothing.
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
    return this.inTransaction(async (executor) => {
      const current = await this.dependencies.creators.findById(
        executor,
        input.creatorId,
      );
      if (current?.status !== 'suspended') refuse();

      const lifted = await this.dependencies.authority.lift(executor, {
        actorReference: input.actorReference,
        reasonCode: input.reasonCode,
        scope: 'creator_suspension',
        subjectId: input.creatorId,
      });
      if (lifted.kind !== 'recorded') refuse();

      const moved = await this.dependencies.creators.transitionStatus(
        executor,
        {
          creatorId: input.creatorId,
          expectedStatus: 'suspended',
          now: this.dependencies.now(),
          // Back to applicant rather than active: whether every gate still
          // passes is decided by the admission ladder on the next read, not by
          // an operator asserting it here.
          status: 'applicant',
          statusReason: 'onboarding_incomplete',
        },
      );
      if (moved === undefined) refuse();
      return {
        creator: moved,
        enforcement: lifted.enforcement,
        kind: 'applied',
      };
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
    return this.inTransaction(async (executor) => {
      const creator = await this.dependencies.creators.findById(
        executor,
        input.creatorId,
      );
      if (creator === undefined) refuse();

      const target = this.targetOf(input);
      if (target === undefined) refuse();

      const imposed = await this.dependencies.authority.impose(executor, {
        actorReference: input.actorReference,
        reasonCode: input.reasonCode,
        scope: 'creator_object_removal',
        subjectId: input.creatorId,
        targetObjectId: target.id,
        targetObjectType: target.type,
      });
      if (imposed.kind !== 'recorded') refuse();

      const removed = await this.takeDown(
        executor,
        input,
        this.dependencies.now(),
      );
      if (!removed) refuse();
      return {
        creator,
        enforcement: imposed.enforcement,
        kind: 'applied',
      };
    });
  }

  /** Withdraws one entitlement as a platform action rather than a creator's. */
  async revokeMembership(input: {
    readonly actorReference: string;
    readonly creatorId: string;
    readonly membershipId: string;
    readonly reasonCode: AdminCreatorReasonCodeValue;
  }): Promise<AdminOutcome> {
    return this.inTransaction(async (executor) => {
      const { authority, clubs, creators } = this.dependencies;
      const creator = await creators.findById(executor, input.creatorId);
      if (creator === undefined) refuse();

      // The entitlement has to belong to a club this creator owns. A membership
      // identifier from elsewhere is answered as if it did not exist, so an
      // operator cannot reach across creators by guessing one.
      const membership = await clubs.findMembershipById(
        executor,
        input.membershipId,
      );
      if (membership === undefined) refuse();
      const club = await clubs.findClub(executor, membership.clubId);
      if (club?.creatorId !== input.creatorId) refuse();

      const imposed = await authority.impose(executor, {
        actorReference: input.actorReference,
        reasonCode: input.reasonCode,
        scope: 'club_membership_revocation',
        subjectId: input.creatorId,
        targetObjectId: input.membershipId,
        targetObjectType: 'club_membership',
      });
      if (imposed.kind !== 'recorded') refuse();

      const revoked = await clubs.revokeMembership(executor, {
        membershipId: input.membershipId,
        now: this.dependencies.now(),
        state: 'revoked',
      });
      if (revoked === undefined) refuse();
      return { creator, enforcement: imposed.enforcement, kind: 'applied' };
    });
  }

  /**
   * One transaction per operation, and a refusal that takes everything with it.
   *
   * A refusal throws rather than returns, because a return would commit. Some
   * guards necessarily run *after* the enforcement record is written — the
   * authority takes the subject lock, and the lock must precede every row lock,
   * so the decision is recorded before the owning domain is asked to apply it.
   * Returning a refusal from there would leave an audit row for an operation
   * that never happened, which is the exact state this class claims is
   * unreachable.
   */
  private async inTransaction(
    work: (executor: TransactionHandle) => Promise<AdminOutcome>,
  ): Promise<AdminOutcome> {
    try {
      return await this.dependencies.database.transaction(work);
    } catch (error) {
      if (error instanceof RefusedOperation) return { kind: 'refused' };
      throw error;
    }
  }

  /** What the enforcement record will name, decided before anything is written. */
  private targetOf(input: {
    readonly creatorId: string;
    readonly objectId: string | undefined;
    readonly objectType: AdminRemovableObjectValue;
  }):
    { readonly id: string; readonly type: EnforcementObjectType } | undefined {
    if (input.objectType === 'creator_profile') {
      // A profile is identified by its creator, so the enforcement names the
      // creator identifier as the object it acted on.
      return { id: input.creatorId, type: 'creator_profile' };
    }
    if (input.objectId === undefined) return undefined;
    return {
      id: input.objectId,
      type: input.objectType === 'creator_content' ? 'creator_content' : 'club',
    };
  }

  /** Unpublishes one object, if it belongs to the named creator. */
  private async takeDown(
    executor: TransactionHandle,
    input: {
      readonly creatorId: string;
      readonly objectId: string | undefined;
      readonly objectType: AdminRemovableObjectValue;
    },
    now: Date,
  ): Promise<boolean> {
    const { clubs, content, profiles } = this.dependencies;
    if (input.objectType === 'creator_profile') {
      const record = await profiles.findByCreatorId(executor, input.creatorId);
      if (record === undefined) return false;
      const moved = await profiles.setPublication(executor, {
        creatorId: input.creatorId,
        expectedVersion: record.profile.version,
        now,
        publication: 'draft',
      });
      return moved !== undefined;
    }

    if (input.objectId === undefined) return false;

    if (input.objectType === 'creator_content') {
      const item = await content.findOwn(executor, {
        contentId: input.objectId,
        creatorId: input.creatorId,
      });
      if (item === undefined) return false;
      const moved = await content.transitionLifecycle(executor, {
        contentId: input.objectId,
        creatorId: input.creatorId,
        expectedVersion: item.version,
        lifecycle: 'archived',
        now,
      });
      return moved !== undefined;
    }

    const club = await clubs.findOwnClub(executor, {
      clubId: input.objectId,
      creatorId: input.creatorId,
    });
    if (club === undefined) return false;
    const moved = await clubs.transitionClub(executor, {
      clubId: input.objectId,
      creatorId: input.creatorId,
      expectedVersion: club.version,
      // Withdrawn from public view rather than closed: closing is final, and an
      // operator taking something out of sight should not also end it forever.
      lifecycle: 'draft',
      now,
    });
    return moved !== undefined;
  }
}
