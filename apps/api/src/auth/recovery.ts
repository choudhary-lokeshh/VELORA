import { and, count, eq, gt, isNull } from 'drizzle-orm';

import type { AuthContext } from './context.js';
import {
  highImpactCooldownMilliseconds,
  recoveryRateLimits,
  recoveryTokenLifetimeMilliseconds,
} from './policy.js';
import type { AuthExecutor, AuthRepository } from './repository.js';
import { authRecoveryRateEvents, authRecoveryRequests } from './schema.js';
import type { AuthService, BrowserSessionIssue } from './service.js';
import {
  digestToken,
  digestValue,
  generateOpaqueToken,
  isWellFormedOpaqueToken,
} from './tokens.js';

/**
 * Account recovery.
 *
 * Two properties shape everything here. Responses never disclose whether an
 * account exists, so an unknown subject follows the same path, is counted by the
 * same limiters, and produces the same answer as a known one. And the limits
 * that carry the security consequence are counted in PostgreSQL, so an outage in
 * ephemeral infrastructure cannot lift them.
 */

export interface RecoveryDelivery {
  readonly destination: string;
  readonly expiresAt: Date;
  readonly token: string;
}

export interface RecoveryDeliveryPort {
  deliver(delivery: RecoveryDelivery): Promise<void>;
  readonly kind: string;
}

/**
 * Development and test sink. No email, SMS, or push provider is approved, so
 * there is no adapter that reaches a real destination; this one only records
 * what would have been sent and is refused outside local and test environments.
 */
export class LocalTestRecoveryDelivery implements RecoveryDeliveryPort {
  readonly kind = 'local-test';
  private readonly recorded: RecoveryDelivery[] = [];

  deliver(delivery: RecoveryDelivery): Promise<void> {
    this.recorded.push(delivery);
    return Promise.resolve();
  }

  get deliveries(): readonly RecoveryDelivery[] {
    return this.recorded;
  }

  latestFor(destination: string): RecoveryDelivery | undefined {
    return [...this.recorded]
      .reverse()
      .find((delivery) => delivery.destination === destination);
  }
}

export type RecoveryStartResult =
  { readonly kind: 'accepted' } | { readonly kind: 'rate_limited' };

export type RecoveryCompletionResult =
  | { readonly kind: 'completed'; readonly session: BrowserSessionIssue }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'review_required' }
  | { readonly kind: 'rate_limited' };

export interface RecoveryServiceDependencies {
  readonly authService: AuthService;
  readonly delivery: RecoveryDeliveryPort;
  readonly identitySubjectFor: (subject: string) => string;
  readonly now: () => Date;
  readonly repository: AuthRepository;
}

const hour = 3_600_000;
const day = 24 * hour;

export class RecoveryService {
  constructor(private readonly dependencies: RecoveryServiceDependencies) {}

  get deliveryKind(): string {
    return this.dependencies.delivery.kind;
  }

  /**
   * Always answers "accepted" for anything that is not a caller-scoped abuse
   * limit. A per-account limit, an unknown subject, and a successful issue are
   * indistinguishable from outside.
   */
  async start(input: {
    readonly correlationId: string;
    readonly deviceReference?: string | undefined;
    readonly requesterReference: string;
    readonly subject: string;
  }): Promise<RecoveryStartResult> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const requesterDigest = digestValue(input.requesterReference);

    const requesterAttempts = await this.countRateEvents(
      'requester',
      requesterDigest,
      new Date(now.getTime() - hour),
    );
    if (requesterAttempts >= recoveryRateLimits.perRequesterPerHour) {
      return { kind: 'rate_limited' };
    }

    let normalized: string;
    try {
      normalized = this.dependencies.identitySubjectFor(input.subject);
    } catch {
      // A subject the identity adapter refuses is still counted, so malformed
      // input cannot be used to probe cheaply.
      await this.recordRateEvent('requester', requesterDigest, now);
      return { kind: 'accepted' };
    }
    const destinationDigest = digestValue(normalized);

    await this.recordRateEvent('requester', requesterDigest, now);

    // The destination quota is counted before the attempt is recorded and works
    // for an address with no account, so it cannot be used to tell the two
    // apart. Exceeding it still answers "accepted".
    const destinationWithinHour = await this.countRateEvents(
      'destination',
      destinationDigest,
      new Date(now.getTime() - hour),
    );
    const destinationWithinDay = await this.countRateEvents(
      'destination',
      destinationDigest,
      new Date(now.getTime() - day),
    );
    await this.recordRateEvent('destination', destinationDigest, now);
    if (
      destinationWithinHour >= recoveryRateLimits.perAccountPerHour ||
      destinationWithinDay >= recoveryRateLimits.perAccountPerDay
    ) {
      return { kind: 'accepted' };
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(
      now.getTime() + recoveryTokenLifetimeMilliseconds,
    );

    const issued = await repository.transaction(async (executor) => {
      const accountId = await repository.findAccountIdBySubject(executor, {
        provider: 'local',
        providerSubject: normalized,
      });
      if (accountId === undefined) return false;

      const withinHour = await this.countAccountRequests(
        executor,
        accountId,
        new Date(now.getTime() - hour),
      );
      const withinDay = await this.countAccountRequests(
        executor,
        accountId,
        new Date(now.getTime() - day),
      );
      if (
        withinHour >= recoveryRateLimits.perAccountPerHour ||
        withinDay >= recoveryRateLimits.perAccountPerDay
      ) {
        return false;
      }

      const deviceDigest =
        input.deviceReference === undefined
          ? undefined
          : digestValue(input.deviceReference);
      // A device that has never completed an authentication for this account is
      // high risk. It is a deterministic seam, not a risk engine, and it fails
      // closed when the caller supplies no device reference at all.
      const known =
        deviceDigest !== undefined &&
        (await repository.isKnownDevice(executor, {
          accountId,
          deviceDigest,
        }));

      await executor.insert(authRecoveryRequests).values({
        accountId,
        channel: 'email',
        createdAt: now,
        destinationDigest,
        deviceDigest: deviceDigest ?? null,
        expiresAt,
        id: crypto.randomUUID(),
        riskLevel: known ? 'standard' : 'high',
        tokenDigest: digestToken(token),
      });
      await repository.recordSecurityEvent(executor, {
        accountId,
        correlationId: input.correlationId,
        eventType: 'recovery_started',
        reason: known ? 'known_device' : 'high_risk_device',
      });
      return true;
    });

    // Delivery is an external effect and stays outside the transaction. A
    // delivery that fails after commit leaves a token nobody received, which
    // expires harmlessly; delivering inside would hold a transaction open
    // across provider I/O.
    if (issued) {
      await this.dependencies.delivery.deliver({
        destination: normalized,
        expiresAt,
        token,
      });
    }

    return { kind: 'accepted' };
  }

  /**
   * Consumes a recovery token. Consumption is a conditional update inside the
   * same transaction that revokes prior authority, so two simultaneous attempts
   * on one token cannot both succeed.
   */
  async complete(input: {
    readonly correlationId: string;
    readonly deviceReference?: string | undefined;
    readonly requesterReference: string;
    readonly token: string;
  }): Promise<RecoveryCompletionResult> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const requesterDigest = digestValue(input.requesterReference);
    const requesterAttempts = await this.countRateEvents(
      'requester',
      requesterDigest,
      new Date(now.getTime() - hour),
    );
    await this.recordRateEvent('requester', requesterDigest, now);
    if (requesterAttempts >= recoveryRateLimits.perRequesterPerHour) {
      return { kind: 'rate_limited' };
    }
    if (!isWellFormedOpaqueToken(input.token)) return { kind: 'invalid' };

    const outcome = await repository.transaction(
      async (
        executor: AuthExecutor,
      ): Promise<
        | { readonly kind: 'invalid' }
        | { readonly kind: 'review_required' }
        | { readonly kind: 'consumed'; readonly accountId: string }
      > => {
        const rows = await executor
          .select()
          .from(authRecoveryRequests)
          .where(eq(authRecoveryRequests.tokenDigest, digestToken(input.token)))
          .for('update')
          .limit(1);
        const request = rows[0];
        if (request === undefined) return { kind: 'invalid' };
        if (request.consumedAt !== null || request.invalidatedAt !== null) {
          return { kind: 'invalid' };
        }
        if (request.expiresAt.getTime() <= now.getTime()) {
          return { kind: 'invalid' };
        }
        if (request.riskLevel === 'high') {
          // ADR-0017 requires a second independent signal or reviewed handling
          // for high-risk recovery. Neither exists yet, so this fails closed
          // instead of granting authority.
          await repository.recordSecurityEvent(executor, {
            accountId: request.accountId,
            correlationId: input.correlationId,
            eventType: 'recovery_rejected',
            reason: 'second_signal_required',
          });
          return { kind: 'review_required' };
        }

        const claimed = await executor
          .update(authRecoveryRequests)
          .set({ consumedAt: now })
          .where(
            and(
              eq(authRecoveryRequests.id, request.id),
              isNull(authRecoveryRequests.consumedAt),
            ),
          )
          .returning({ id: authRecoveryRequests.id });
        if (claimed[0] === undefined) return { kind: 'invalid' };

        // Every other outstanding token for the account dies with this one.
        await executor
          .update(authRecoveryRequests)
          .set({ invalidatedAt: now, invalidationReason: 'superseded' })
          .where(
            and(
              eq(authRecoveryRequests.accountId, request.accountId),
              isNull(authRecoveryRequests.consumedAt),
              isNull(authRecoveryRequests.invalidatedAt),
            ),
          );

        await repository.revokeAccountAuthority(executor, {
          accountId: request.accountId,
          now,
          reason: 'account_recovery',
        });
        await repository.restrictHighImpactActions(executor, {
          accountId: request.accountId,
          now,
          reason: 'account_recovery',
          until: new Date(now.getTime() + highImpactCooldownMilliseconds),
        });
        await repository.recordSecurityEvent(executor, {
          accountId: request.accountId,
          correlationId: input.correlationId,
          eventType: 'sessions_revoked_all',
          reason: 'account_recovery',
        });
        await repository.recordSecurityEvent(executor, {
          accountId: request.accountId,
          correlationId: input.correlationId,
          eventType: 'recovery_completed',
        });
        return { accountId: request.accountId, kind: 'consumed' };
      },
    );

    if (outcome.kind !== 'consumed') return outcome;

    // Recovery re-establishes ordinary access only. ADR-0017 is explicit that it
    // does not immediately grant the highest assurance level.
    const session = await this.dependencies.authService.reissueBrowserSession({
      accountId: outcome.accountId,
      audience: 'consumer_web',
      correlationId: input.correlationId,
      deviceReference: input.deviceReference,
    });
    return { kind: 'completed', session };
  }

  private async countRateEvents(
    scope: 'account' | 'destination' | 'requester',
    scopeDigest: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.dependencies.repository.transactionless
      .select({ total: count() })
      .from(authRecoveryRateEvents)
      .where(
        and(
          eq(authRecoveryRateEvents.scope, scope),
          eq(authRecoveryRateEvents.scopeDigest, scopeDigest),
          gt(authRecoveryRateEvents.occurredAt, since),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  private async recordRateEvent(
    scope: 'account' | 'destination' | 'requester',
    scopeDigest: string,
    now: Date,
  ): Promise<void> {
    await this.dependencies.repository.transactionless
      .insert(authRecoveryRateEvents)
      .values({ occurredAt: now, scope, scopeDigest });
  }

  private async countAccountRequests(
    executor: AuthExecutor,
    accountId: string,
    since: Date,
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(authRecoveryRequests)
      .where(
        and(
          eq(authRecoveryRequests.accountId, accountId),
          gt(authRecoveryRequests.createdAt, since),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /** Whether the account is inside the post-recovery high-impact restriction. */
  async isHighImpactRestricted(
    context: Pick<AuthContext, 'accountId'>,
  ): Promise<boolean> {
    const account = await this.dependencies.repository.findAccount(
      this.dependencies.repository.transactionless,
      context.accountId,
    );
    if (account?.highImpactRestrictedUntil == null) return false;
    return (
      account.highImpactRestrictedUntil.getTime() >
      this.dependencies.now().getTime()
    );
  }
}
