import type { TransactionHandle } from '../database/executor.js';
import { lockSubject } from '../database/subject-lock.js';
import {
  enforcementPolicyVersion,
  liftableEnforcementScopes,
  type EnforcementObjectType,
  type EnforcementReasonCode,
  type EnforcementScope,
} from './policy.js';
import type { EnforcementRow, SafetyRepository } from './repository.js';

/**
 * What identifies one restriction.
 *
 * A subject can be under several restrictions at once — a suspension and a
 * removed item are different facts — so "is this already in force" is a
 * question about the scope *and* the thing it names, never about the subject
 * alone. Collapsing them would let a second conversation closure be silently
 * treated as a repeat of the first.
 */
export interface EnforcementIdentity {
  readonly scope: EnforcementScope;
  readonly subjectId: string;
  readonly targetConversationId?: string | undefined;
  readonly targetObjectId?: string | undefined;
  readonly targetObjectType?: EnforcementObjectType | undefined;
}

export interface ImposeRequest extends EnforcementIdentity {
  readonly actorReference: string;
  /** When a time-bounded restriction stops on its own. Absent is indefinite. */
  readonly expiresAt?: Date | undefined;
  readonly reasonCode: EnforcementReasonCode;
  readonly reportId?: string | undefined;
}

export interface LiftRequest extends EnforcementIdentity {
  readonly actorReference: string;
  readonly reasonCode: EnforcementReasonCode;
  readonly reportId?: string | undefined;
}

export type EnforcementOutcome =
  | { readonly kind: 'recorded'; readonly enforcement: EnforcementRow }
  /** The same restriction already stands. Imposing again changes nothing. */
  | { readonly kind: 'already_in_force'; readonly enforcement: EnforcementRow }
  /** There is nothing in force to take away. */
  | { readonly kind: 'nothing_to_lift' }
  /** The platform publishes no way to reverse this scope. */
  | { readonly kind: 'not_liftable' };

export interface EnforcementAuthorityDependencies {
  readonly now: () => Date;
  readonly repository: SafetyRepository;
}

/**
 * The one writer of enforcement records.
 *
 * Before this existed, MODERATION and ADMIN each appended their own rows with
 * their own idea of what a scope meant, which is how `account_restriction` came
 * to be written both by a restriction and by the review that undid one. Putting
 * every write behind one authority is what makes the vocabulary a rule rather
 * than a convention, and what gives supersession a single place to be correct.
 *
 * The authority records decisions. It does **not** apply them: an account's
 * standing is USERS' truth and a conversation's state is MESSAGING's, and the
 * caller applies the change through those domains' published contracts in the
 * same transaction as the record. Splitting the two would allow a record with
 * no effect, or an effect with no record, and an audit could explain neither.
 *
 * Every method takes the caller's transaction and takes the subject lock inside
 * it, so an imposition, a lift, and any mutation authorized by their absence
 * are serialized against each other. The lock is transaction-scoped and
 * re-entrant, so a caller that already holds it pays nothing to be safe.
 */
export class EnforcementAuthority {
  constructor(
    private readonly dependencies: EnforcementAuthorityDependencies,
  ) {}

  /**
   * Records a restriction, unless the same one already stands.
   *
   * Idempotent by identity rather than by an idempotency key, because an
   * enforcement decision repeated is the same decision: a second suspension of
   * an already-suspended creator is not a second fact, and recording it would
   * make the history of what was done to somebody depend on how many times an
   * operator clicked.
   */
  async impose(
    executor: TransactionHandle,
    request: ImposeRequest,
  ): Promise<EnforcementOutcome> {
    await lockSubject(executor, request.subjectId);
    const now = this.dependencies.now();
    const standing = await this.findLive(executor, request, now);
    if (standing !== undefined) {
      return { enforcement: standing, kind: 'already_in_force' };
    }
    const enforcement = await this.dependencies.repository.insertEnforcement(
      executor,
      {
        actorReference: request.actorReference,
        disposition: 'restrict',
        effectiveAt: now,
        expiresAt: request.expiresAt ?? null,
        now,
        policyVersion: enforcementPolicyVersion,
        reasonCode: request.reasonCode,
        reportId: request.reportId ?? null,
        scope: request.scope,
        subjectId: request.subjectId,
        supersedesId: null,
        targetConversationId: request.targetConversationId ?? null,
        targetObjectId: request.targetObjectId ?? null,
        targetObjectType: request.targetObjectType ?? null,
      },
    );
    return { enforcement, kind: 'recorded' };
  }

  /**
   * Records that a standing restriction has been taken away.
   *
   * The lift names the record it replaces, so the original stays exactly as it
   * was written and the reversal is a second fact rather than an erasure. A
   * lift with nothing to lift is refused: a record claiming to have undone
   * something that was never in force would be a decision an audit could not
   * follow, and would make "this account was restricted and then restored" a
   * story anybody could write.
   */
  async lift(
    executor: TransactionHandle,
    request: LiftRequest,
  ): Promise<EnforcementOutcome> {
    if (!liftableEnforcementScopes.includes(request.scope)) {
      return { kind: 'not_liftable' };
    }
    await lockSubject(executor, request.subjectId);
    const now = this.dependencies.now();
    const standing = await this.findLive(executor, request, now);
    if (standing === undefined) return { kind: 'nothing_to_lift' };

    const enforcement = await this.dependencies.repository.insertEnforcement(
      executor,
      {
        actorReference: request.actorReference,
        disposition: 'lift',
        effectiveAt: now,
        expiresAt: null,
        now,
        policyVersion: enforcementPolicyVersion,
        reasonCode: request.reasonCode,
        reportId: request.reportId ?? null,
        scope: request.scope,
        subjectId: request.subjectId,
        supersedesId: standing.id,
        targetConversationId: request.targetConversationId ?? null,
        targetObjectId: request.targetObjectId ?? null,
        targetObjectType: request.targetObjectType ?? null,
      },
    );
    return { enforcement, kind: 'recorded' };
  }

  /** The live restriction matching an identity exactly, if there is one. */
  private async findLive(
    executor: TransactionHandle,
    identity: EnforcementIdentity,
    now: Date,
  ): Promise<EnforcementRow | undefined> {
    const live = await this.dependencies.repository.listLiveEnforcements(
      executor,
      { now, scopes: [identity.scope], subjectId: identity.subjectId },
    );
    return live.find(
      (row) =>
        row.targetConversationId === (identity.targetConversationId ?? null) &&
        row.targetObjectId === (identity.targetObjectId ?? null) &&
        row.targetObjectType === (identity.targetObjectType ?? null),
    );
  }
}
