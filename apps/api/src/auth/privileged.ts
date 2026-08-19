import { and, count, eq, isNull, lt } from 'drizzle-orm';

import {
  AuthorizationError,
  requireFreshAssurance,
  type AuthContext,
} from './context.js';
import type { PrivilegedAuthenticatorVerifier } from './identity-provider.js';
import { highImpactCooldownMilliseconds } from './policy.js';
import type { AuthExecutor, AuthRepository } from './repository.js';
import {
  authAdminAuthenticators,
  authHighImpactAuthorizations,
  authPrivilegedRecoveryApprovals,
  authPrivilegedRecoveryRequests,
  authSecurityOwners,
} from './schema.js';
import { digestStructure } from './tokens.js';

/**
 * Privileged access foundation: authenticator enrolment, step-up assurance,
 * exact-action authorization, and privileged recovery.
 *
 * Nothing here can grant Admin authority today. Phishing-resistant verification
 * has no approved implementation, so the configured verifier refuses every
 * assertion and step-up cannot succeed in any environment that uses it. What is
 * implemented is the durable state and the deterministic rules that a real
 * verifier plugs into.
 *
 * Break-glass is deliberately absent. ADR-0017 fixes its semantics and does not
 * implement it, because a simulated emergency path on identity infrastructure
 * that does not exist is a false control. There is no emergency elevation code
 * to find here, and the tests assert that no path reaches privileged authority
 * without a fresh phishing-resistant assertion.
 */

/** Two independently stored authenticators before production privileged access. */
export const requiredProductionAuthenticators = 2;
/** Dual control: two distinct preauthorized security owners. */
export const requiredPrivilegedRecoveryApprovals = 2;

export interface HighImpactBinding {
  readonly argumentDigest: string;
  readonly beforeStateDigest: string;
  readonly expectedEffectDigest: string;
  readonly operation: string;
  readonly targetId: string;
  readonly targetType: string;
}

export type StepUpResult =
  | { readonly kind: 'succeeded'; readonly authenticatorId: string }
  | { readonly kind: 'rejected'; readonly reason: StepUpRejection };

export type StepUpRejection =
  'audience_rejected' | 'no_authenticator' | 'verification_failed';

export type HighImpactAuthorizationResult =
  | { readonly kind: 'authorized'; readonly authorizationId: string }
  | { readonly kind: 'rejected'; readonly reason: HighImpactRejection };

export type HighImpactRejection =
  | 'assurance_insufficient'
  | 'assurance_stale'
  | 'audience_rejected'
  | 'cooldown_active';

export type HighImpactExecutionResult =
  | { readonly kind: 'executed' }
  | {
      readonly kind: 'rejected';
      readonly reason: HighImpactExecutionRejection;
    };

export type HighImpactExecutionRejection =
  | 'already_consumed'
  | 'assurance_stale'
  | 'expired'
  | 'session_ended'
  | 'state_changed'
  | 'unknown_authorization';

export type PrivilegedRecoveryResult =
  | { readonly kind: 'completed' }
  | { readonly kind: 'rejected'; readonly reason: PrivilegedRecoveryRejection };

export type PrivilegedRecoveryRejection =
  | 'dual_control_not_satisfied'
  | 'expired'
  | 'not_pending'
  | 'not_security_owner'
  | 'self_approval'
  | 'unknown_request';

export interface PrivilegedAccessDependencies {
  readonly now: () => Date;
  readonly repository: AuthRepository;
  readonly verifier: PrivilegedAuthenticatorVerifier;
}

export class PrivilegedAccessService {
  constructor(private readonly dependencies: PrivilegedAccessDependencies) {}

  get verifierKind(): string {
    return this.dependencies.verifier.kind;
  }

  async enrolAuthenticator(input: {
    readonly accountId: string;
    readonly attachment?: 'cross_platform' | 'platform' | undefined;
    readonly correlationId: string;
    readonly credentialId: string;
    readonly label: string;
    readonly publicKey: string;
  }): Promise<string> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const id = crypto.randomUUID();
    await repository.transaction(async (executor) => {
      await executor.insert(authAdminAuthenticators).values({
        accountId: input.accountId,
        attachment: input.attachment ?? null,
        createdAt: now,
        credentialId: input.credentialId,
        id,
        label: input.label,
        publicKey: input.publicKey,
      });
      await repository.recordSecurityEvent(executor, {
        accountId: input.accountId,
        audience: 'platform_admin',
        correlationId: input.correlationId,
        eventType: 'admin_authenticator_enrolled',
      });
    });
    return id;
  }

  async revokeAuthenticator(input: {
    readonly authenticatorId: string;
    readonly correlationId: string;
    readonly reason: string;
  }): Promise<boolean> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const revoked = await executor
        .update(authAdminAuthenticators)
        .set({ revocationReason: input.reason, revokedAt: now })
        .where(
          and(
            eq(authAdminAuthenticators.id, input.authenticatorId),
            isNull(authAdminAuthenticators.revokedAt),
          ),
        )
        .returning({ accountId: authAdminAuthenticators.accountId });
      const target = revoked[0];
      if (target === undefined) return false;
      await repository.recordSecurityEvent(executor, {
        accountId: target.accountId,
        audience: 'platform_admin',
        correlationId: input.correlationId,
        eventType: 'admin_authenticator_revoked',
        reason: input.reason,
      });
      return true;
    });
  }

  /**
   * ADR-0017 requires two independently stored authenticators before production
   * privileged access. This reports the fact; it does not decide policy.
   */
  async productionReadiness(accountId: string): Promise<{
    readonly enrolled: number;
    readonly ready: boolean;
  }> {
    const rows = await this.dependencies.repository.transactionless
      .select({ total: count() })
      .from(authAdminAuthenticators)
      .where(
        and(
          eq(authAdminAuthenticators.accountId, accountId),
          isNull(authAdminAuthenticators.revokedAt),
        ),
      );
    const enrolled = rows[0]?.total ?? 0;
    return { enrolled, ready: enrolled >= requiredProductionAuthenticators };
  }

  /**
   * Re-establishes phishing-resistant assurance on an existing privileged
   * session. Only the Platform Admin audience can step up, and only an enrolled
   * authenticator the configured verifier accepts counts.
   */
  async stepUp(input: {
    readonly assertion: {
      readonly clientDataDigest: string;
      readonly credentialId: string;
      readonly signCount: number;
      readonly signature: string;
    };
    readonly challenge: string;
    readonly context: AuthContext;
    readonly correlationId: string;
  }): Promise<StepUpResult> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    if (
      input.context.audience !== 'platform_admin' ||
      input.context.sessionId === undefined
    ) {
      await this.recordStepUpFailure(input, 'audience_rejected');
      return { kind: 'rejected', reason: 'audience_rejected' };
    }

    const rows = await repository.transactionless
      .select()
      .from(authAdminAuthenticators)
      .where(
        and(
          eq(
            authAdminAuthenticators.credentialId,
            input.assertion.credentialId,
          ),
          eq(authAdminAuthenticators.accountId, input.context.accountId),
          isNull(authAdminAuthenticators.revokedAt),
        ),
      )
      .limit(1);
    const authenticator = rows[0];
    if (authenticator === undefined) {
      await this.recordStepUpFailure(input, 'no_authenticator');
      return { kind: 'rejected', reason: 'no_authenticator' };
    }

    const verified = await this.dependencies.verifier.verify({
      assertion: input.assertion,
      challenge: input.challenge,
      publicKey: authenticator.publicKey,
    });
    if (verified === undefined) {
      await this.recordStepUpFailure(input, 'verification_failed');
      return { kind: 'rejected', reason: 'verification_failed' };
    }
    // A counter that fails to advance is the cloned-authenticator signal, but
    // only for authenticators that keep a counter at all. Most passkeys and
    // multi-device credentials report zero forever, and rejecting those would
    // rule out exactly the phishing-resistant authenticators ADR-0017 wants.
    if (
      verified.countersSupported &&
      verified.signCount <= authenticator.signCount
    ) {
      await this.recordStepUpFailure(input, 'verification_failed');
      return { kind: 'rejected', reason: 'verification_failed' };
    }

    const sessionId = input.context.sessionId;
    const advanced = await repository.transaction(async (executor) => {
      // For a counter-keeping authenticator the advance is the claim, so two
      // concurrent presentations of one assertion cannot both satisfy it. A
      // counterless authenticator has nothing to advance, and single use there
      // rests on the verifier consuming its challenge exactly once, which is
      // where that responsibility belongs.
      const claimed = await executor
        .update(authAdminAuthenticators)
        .set({ lastUsedAt: now, signCount: verified.signCount })
        .where(
          and(
            eq(authAdminAuthenticators.id, authenticator.id),
            isNull(authAdminAuthenticators.revokedAt),
            ...(verified.countersSupported
              ? [lt(authAdminAuthenticators.signCount, verified.signCount)]
              : []),
          ),
        )
        .returning({ id: authAdminAuthenticators.id });
      if (claimed[0] === undefined) return false;

      await repository.refreshSessionAssurance(executor, {
        assurance: 'phishing_resistant',
        now,
        sessionId,
      });
      await repository.recordSecurityEvent(executor, {
        accountId: input.context.accountId,
        audience: 'platform_admin',
        correlationId: input.correlationId,
        eventType: 'admin_step_up_succeeded',
        sessionId,
      });
      return true;
    });
    if (!advanced) {
      await this.recordStepUpFailure(input, 'verification_failed');
      return { kind: 'rejected', reason: 'verification_failed' };
    }
    return { authenticatorId: authenticator.id, kind: 'succeeded' };
  }

  /**
   * Binds an authorization to exactly one operation against one target with one
   * argument set, one observed before-state, and one expected effect. Nothing
   * broad or reusable can be produced by this method.
   */
  async authorizeHighImpact(input: {
    readonly approverAccountId?: string | undefined;
    readonly binding: HighImpactBinding;
    readonly context: AuthContext;
    readonly correlationId: string;
    readonly validForMilliseconds: number;
  }): Promise<HighImpactAuthorizationResult> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const sessionId = input.context.sessionId;
    if (
      input.context.audience !== 'platform_admin' ||
      sessionId === undefined
    ) {
      return { kind: 'rejected', reason: 'audience_rejected' };
    }
    // Assurance is re-derived from the stored session rather than taken from the
    // caller's context, so a reconstructed context cannot refresh it.
    const stored = await repository.findSessionById(
      repository.transactionless,
      sessionId,
    );
    if (
      stored?.accountId !== input.context.accountId ||
      stored.audience !== 'platform_admin'
    ) {
      return { kind: 'rejected', reason: 'audience_rejected' };
    }
    try {
      requireFreshAssurance(
        contextFromSession(stored),
        'phishing_resistant',
        now,
      );
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      return {
        kind: 'rejected',
        reason:
          error.kind === 'assurance_stale'
            ? 'assurance_stale'
            : 'assurance_insufficient',
      };
    }

    const account = await repository.findAccount(
      repository.transactionless,
      input.context.accountId,
    );
    if (
      account?.highImpactRestrictedUntil != null &&
      account.highImpactRestrictedUntil.getTime() > now.getTime()
    ) {
      return { kind: 'rejected', reason: 'cooldown_active' };
    }

    const authorizationId = crypto.randomUUID();
    await repository.transaction(async (executor) => {
      await executor.insert(authHighImpactAuthorizations).values({
        actorAccountId: input.context.accountId,
        actorSessionId: sessionId,
        approvedAt: input.approverAccountId === undefined ? null : now,
        approverAccountId: input.approverAccountId ?? null,
        argumentDigest: input.binding.argumentDigest,
        assurance: stored.assurance,
        authorizedAt: now,
        beforeStateDigest: input.binding.beforeStateDigest,
        correlationId: input.correlationId,
        expectedEffectDigest: input.binding.expectedEffectDigest,
        expiresAt: new Date(now.getTime() + input.validForMilliseconds),
        id: authorizationId,
        operation: input.binding.operation,
        targetId: input.binding.targetId,
        targetType: input.binding.targetType,
      });
      await repository.recordSecurityEvent(executor, {
        accountId: input.context.accountId,
        audience: 'platform_admin',
        correlationId: input.correlationId,
        eventType: 'high_impact_authorized',
        sessionId,
      });
    });
    return { authorizationId, kind: 'authorized' };
  }

  /**
   * Re-authorizes at execution time. The stored binding must still match the
   * operation being executed, the current state must still be the state that was
   * authorized, the actor's session must still be live, and its assurance must
   * still be fresh. Any drift refuses rather than proceeds.
   */
  async executeHighImpact(input: {
    readonly authorizationId: string;
    readonly binding: HighImpactBinding;
    readonly correlationId: string;
    /** The live Admin session consuming its own exact-action authorization. */
    readonly context: AuthContext;
    readonly currentStateDigest: string;
  }): Promise<HighImpactExecutionResult> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(
      async (executor: AuthExecutor): Promise<HighImpactExecutionResult> => {
        const rows = await executor
          .select()
          .from(authHighImpactAuthorizations)
          .where(eq(authHighImpactAuthorizations.id, input.authorizationId))
          .for('update')
          .limit(1);
        const authorization = rows[0];
        if (authorization === undefined) {
          return { kind: 'rejected', reason: 'unknown_authorization' };
        }
        if (authorization.consumedAt !== null) {
          return { kind: 'rejected', reason: 'already_consumed' };
        }
        if (authorization.expiresAt.getTime() <= now.getTime()) {
          return { kind: 'rejected', reason: 'expired' };
        }
        const boundToThisAction =
          authorization.operation === input.binding.operation &&
          authorization.targetType === input.binding.targetType &&
          authorization.targetId === input.binding.targetId &&
          authorization.argumentDigest === input.binding.argumentDigest &&
          authorization.expectedEffectDigest ===
            input.binding.expectedEffectDigest;
        if (!boundToThisAction) {
          return { kind: 'rejected', reason: 'state_changed' };
        }
        if (authorization.beforeStateDigest !== input.currentStateDigest) {
          return { kind: 'rejected', reason: 'state_changed' };
        }
        // An opaque authorization ID may traverse a browser request header, so
        // possession cannot be its authority. It belongs to the Admin session
        // that produced it as well as the exact action binding. Requiring the
        // caller's resolved context here prevents a second privileged operator
        // from consuming another operator's approval for the same target.
        if (
          input.context.audience !== 'platform_admin' ||
          input.context.sessionId === undefined ||
          authorization.actorAccountId !== input.context.accountId ||
          authorization.actorSessionId !== input.context.sessionId
        ) {
          return { kind: 'rejected', reason: 'session_ended' };
        }

        const session = await repository.findSessionById(
          executor,
          authorization.actorSessionId,
        );
        if (session?.revokedAt !== null) {
          return { kind: 'rejected', reason: 'session_ended' };
        }
        if (
          session.accountId !== input.context.accountId ||
          session.audience !== 'platform_admin' ||
          session.absoluteExpiresAt.getTime() <= now.getTime() ||
          session.idleExpiresAt.getTime() <= now.getTime()
        ) {
          return { kind: 'rejected', reason: 'session_ended' };
        }
        try {
          // The stored assurance level and age are used, never a value the
          // caller supplied, so a downgraded or aged session cannot execute.
          requireFreshAssurance(
            contextFromSession(session),
            'phishing_resistant',
            now,
          );
        } catch {
          return { kind: 'rejected', reason: 'assurance_stale' };
        }

        const consumed = await executor
          .update(authHighImpactAuthorizations)
          .set({ consumedAt: now })
          .where(
            and(
              eq(authHighImpactAuthorizations.id, authorization.id),
              isNull(authHighImpactAuthorizations.consumedAt),
            ),
          )
          .returning({ id: authHighImpactAuthorizations.id });
        if (consumed[0] === undefined) {
          return { kind: 'rejected', reason: 'already_consumed' };
        }
        await repository.recordSecurityEvent(executor, {
          accountId: authorization.actorAccountId,
          audience: 'platform_admin',
          correlationId: input.correlationId,
          eventType: 'high_impact_executed',
          sessionId: authorization.actorSessionId,
        });
        return { kind: 'executed' };
      },
    );
  }

  async designateSecurityOwner(accountId: string): Promise<void> {
    await this.dependencies.repository.transactionless
      .insert(authSecurityOwners)
      .values({ accountId, designatedAt: this.dependencies.now() })
      .onConflictDoUpdate({
        set: { revokedAt: null },
        target: authSecurityOwners.accountId,
      });
  }

  async startPrivilegedRecovery(input: {
    readonly correlationId: string;
    readonly initiatedByAccountId: string;
    readonly reason: string;
    readonly targetAccountId: string;
    readonly validForMilliseconds: number;
  }): Promise<string> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const id = crypto.randomUUID();
    await repository.transaction(async (executor) => {
      await executor.insert(authPrivilegedRecoveryRequests).values({
        correlationId: input.correlationId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + input.validForMilliseconds),
        id,
        initiatedByAccountId: input.initiatedByAccountId,
        reason: input.reason,
        status: 'pending',
        targetAccountId: input.targetAccountId,
      });
      await repository.recordSecurityEvent(executor, {
        accountId: input.targetAccountId,
        audience: 'platform_admin',
        correlationId: input.correlationId,
        eventType: 'privileged_recovery_started',
      });
    });
    return id;
  }

  async approvePrivilegedRecovery(input: {
    readonly approverAccountId: string;
    readonly correlationId: string;
    readonly requestId: string;
  }): Promise<PrivilegedRecoveryResult | { readonly kind: 'recorded' }> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const request = await this.loadPendingRequest(executor, input.requestId);
      if ('reason' in request) return request;
      if (request.request.targetAccountId === input.approverAccountId) {
        // The account being recovered cannot approve its own recovery.
        return { kind: 'rejected', reason: 'self_approval' };
      }
      if (!(await this.isSecurityOwner(executor, input.approverAccountId))) {
        return { kind: 'rejected', reason: 'not_security_owner' };
      }

      await executor
        .insert(authPrivilegedRecoveryApprovals)
        .values({
          approvedAt: now,
          approverAccountId: input.approverAccountId,
          id: crypto.randomUUID(),
          requestId: input.requestId,
        })
        .onConflictDoNothing({
          target: [
            authPrivilegedRecoveryApprovals.requestId,
            authPrivilegedRecoveryApprovals.approverAccountId,
          ],
        });
      await repository.recordSecurityEvent(executor, {
        accountId: request.request.targetAccountId,
        audience: 'platform_admin',
        correlationId: input.correlationId,
        eventType: 'privileged_recovery_approved',
      });
      return { kind: 'recorded' };
    });
  }

  /**
   * Completes privileged recovery only under dual control. It revokes the
   * target's authority and its enrolled authenticators, and applies the
   * post-recovery high-impact restriction. Issuing the short-lived bootstrap
   * credential is deliberately absent: it needs the phishing-resistant verifier
   * and the operational identity process that do not exist yet.
   */
  async completePrivilegedRecovery(input: {
    readonly correlationId: string;
    readonly requestId: string;
  }): Promise<PrivilegedRecoveryResult> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const loaded = await this.loadPendingRequest(executor, input.requestId);
      if ('reason' in loaded) return loaded;
      const { request } = loaded;

      const approvals = await executor
        .select({
          approverAccountId: authPrivilegedRecoveryApprovals.approverAccountId,
        })
        .from(authPrivilegedRecoveryApprovals)
        .innerJoin(
          authSecurityOwners,
          eq(
            authPrivilegedRecoveryApprovals.approverAccountId,
            authSecurityOwners.accountId,
          ),
        )
        .where(
          and(
            eq(authPrivilegedRecoveryApprovals.requestId, request.id),
            isNull(authSecurityOwners.revokedAt),
          ),
        );
      const distinct = new Set(
        approvals.map((approval) => approval.approverAccountId),
      );
      if (distinct.size < requiredPrivilegedRecoveryApprovals) {
        return { kind: 'rejected', reason: 'dual_control_not_satisfied' };
      }

      await repository.revokeAccountAuthority(executor, {
        accountId: request.targetAccountId,
        now,
        reason: 'privileged_recovery',
      });
      await executor
        .update(authAdminAuthenticators)
        .set({
          revocationReason: 'privileged_recovery',
          revokedAt: now,
        })
        .where(
          and(
            eq(authAdminAuthenticators.accountId, request.targetAccountId),
            isNull(authAdminAuthenticators.revokedAt),
          ),
        );
      await repository.restrictHighImpactActions(executor, {
        accountId: request.targetAccountId,
        now,
        reason: 'privileged_recovery',
        until: new Date(now.getTime() + highImpactCooldownMilliseconds),
      });
      await executor
        .update(authPrivilegedRecoveryRequests)
        .set({ completedAt: now, status: 'completed' })
        .where(eq(authPrivilegedRecoveryRequests.id, request.id));
      await repository.recordSecurityEvent(executor, {
        accountId: request.targetAccountId,
        audience: 'platform_admin',
        correlationId: input.correlationId,
        eventType: 'privileged_recovery_completed',
      });
      return { kind: 'completed' };
    });
  }

  private async loadPendingRequest(
    executor: AuthExecutor,
    requestId: string,
  ): Promise<
    | { readonly request: typeof authPrivilegedRecoveryRequests.$inferSelect }
    | {
        readonly kind: 'rejected';
        readonly reason: PrivilegedRecoveryRejection;
      }
  > {
    const rows = await executor
      .select()
      .from(authPrivilegedRecoveryRequests)
      .where(eq(authPrivilegedRecoveryRequests.id, requestId))
      .for('update')
      .limit(1);
    const request = rows[0];
    if (request === undefined) {
      return { kind: 'rejected', reason: 'unknown_request' };
    }
    if (request.status !== 'pending') {
      return { kind: 'rejected', reason: 'not_pending' };
    }
    if (request.expiresAt.getTime() <= this.dependencies.now().getTime()) {
      return { kind: 'rejected', reason: 'expired' };
    }
    return { request };
  }

  private async isSecurityOwner(
    executor: AuthExecutor,
    accountId: string,
  ): Promise<boolean> {
    const rows = await executor
      .select({ accountId: authSecurityOwners.accountId })
      .from(authSecurityOwners)
      .where(
        and(
          eq(authSecurityOwners.accountId, accountId),
          isNull(authSecurityOwners.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] !== undefined;
  }

  private async recordStepUpFailure(
    input: { readonly context: AuthContext; readonly correlationId: string },
    reason: StepUpRejection,
  ): Promise<void> {
    await this.dependencies.repository.recordSecurityEvent(
      this.dependencies.repository.transactionless,
      {
        accountId: input.context.accountId,
        audience: input.context.audience,
        correlationId: input.correlationId,
        eventType: 'admin_step_up_failed',
        reason,
      },
    );
  }
}

function contextFromSession(
  session: NonNullable<Awaited<ReturnType<AuthRepository['findSessionById']>>>,
): AuthContext {
  return {
    absoluteExpiresAt: session.absoluteExpiresAt,
    accountId: session.accountId,
    assurance: session.assurance as AuthContext['assurance'],
    assuranceEstablishedAt: session.assuranceEstablishedAt,
    audience: session.audience as AuthContext['audience'],
    authenticatedAt: session.authenticatedAt,
    idleExpiresAt: session.idleExpiresAt,
    sessionId: session.id,
    transport: 'cookie',
  };
}

/** Convenience for callers building an exact-action binding. */
export function bindHighImpactAction(input: {
  readonly argumentsValue: unknown;
  readonly beforeState: unknown;
  readonly expectedEffect: unknown;
  readonly operation: string;
  readonly targetId: string;
  readonly targetType: string;
}): HighImpactBinding {
  return {
    argumentDigest: digestStructure(input.argumentsValue),
    beforeStateDigest: digestStructure(input.beforeState),
    expectedEffectDigest: digestStructure(input.expectedEffect),
    operation: input.operation,
    targetId: input.targetId,
    targetType: input.targetType,
  };
}
