import { createHash } from 'node:crypto';

import type { SafeLogger } from '@velora/observability/server';

import {
  identityReconciliationBatchSize,
  identityReconciliationIntervalMilliseconds,
} from './policy.js';
import type { IdentityAttemptState } from './policy.js';
import {
  isIdentityHostedSession,
  isIdentityProviderSnapshot,
  type IdentityProviderSnapshot,
  type IdentityProviderSnapshotState,
  type IdentityVerificationProviderPort,
} from './provider.js';
import type { IdentityProviderEventService } from './provider-events.js';
import {
  type IdentityAttemptRow,
  type IdentityRepository,
} from './repository.js';

export interface IdentityReconciliationReport {
  readonly examined: number;
  readonly failed: number;
  readonly found: number;
  readonly outstanding: number;
  readonly repaired: number;
}

type ReconciliationOutcome = Pick<
  IdentityReconciliationReport,
  'failed' | 'found' | 'repaired'
>;

const noOutcome: ReconciliationOutcome = {
  failed: 0,
  found: 0,
  repaired: 0,
};

/**
 * Recover only durable IDENTITY facts from the configured provider's current
 * state. It cannot start a session, choose a provider, alter another domain,
 * make a privacy decision, or overwrite evidence.
 */
export class IdentityReconciliationService {
  constructor(
    private readonly dependencies: {
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly provider: IdentityVerificationProviderPort;
      readonly providerEvents: IdentityProviderEventService;
      readonly repository: IdentityRepository;
    },
  ) {}

  async reconcileOnce(): Promise<IdentityReconciliationReport> {
    const { provider, repository } = this.dependencies;
    if (provider.provider === 'unavailable') {
      return { ...noOutcome, examined: 0, outstanding: 0 };
    }

    const now = this.dependencies.now();
    const attempts = await repository.claimReconciliationAttempts({
      dueBefore: new Date(
        now.getTime() - identityReconciliationIntervalMilliseconds,
      ),
      limit: identityReconciliationBatchSize,
      now,
    });
    let failed = 0;
    let found = 0;
    let repaired = 0;
    for (const attempt of attempts) {
      try {
        const outcome = await this.reconcileAttempt(attempt);
        failed += outcome.failed;
        found += outcome.found;
        repaired += outcome.repaired;
      } catch (error) {
        failed += 1;
        this.dependencies.logger.warn(
          {
            errorClass:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            provider: provider.provider,
          },
          'identity reconciliation provider read failed',
        );
      }
    }

    return {
      examined: attempts.length,
      failed,
      found,
      outstanding: await repository.countOpenReconciliationFindings(),
      repaired,
    };
  }

  private async reconcileAttempt(
    attempt: IdentityAttemptRow,
  ): Promise<ReconciliationOutcome> {
    const { provider } = this.dependencies;
    if (attempt.provider !== provider.provider) {
      return this.recordFinding(
        attempt,
        'provider_state_drift',
        'provider_configuration_mismatch',
      );
    }

    if (attempt.state === 'created') {
      // The request may have crashed before it claimed the provider operation.
      // Retrying the already-authorized owner operation is the only safe start.
      return this.recordFinding(
        attempt,
        'stuck_attempt',
        'provider_start_not_claimed',
      );
    }

    const snapshot = await this.retrieveSnapshot(attempt);
    if (snapshot === undefined) {
      return this.recordFinding(
        attempt,
        'missing_provider_reference',
        'provider_session_not_found',
      );
    }
    if (!isIdentityProviderSnapshot(snapshot)) {
      return this.recordFinding(
        attempt,
        'provider_state_drift',
        'invalid_provider_snapshot',
      );
    }
    if (!sameProviderIdentity(attempt, snapshot)) {
      return this.recordFinding(
        attempt,
        'provider_state_drift',
        'provider_identity_mismatch',
        snapshot.state,
      );
    }
    if (snapshotMatchesAttempt(attempt.state, snapshot.state)) return noOutcome;
    if (!snapshotCanAdvanceAttempt(attempt.state, snapshot.state)) {
      return this.recordFinding(
        attempt,
        'provider_state_drift',
        'provider_state_not_applicable',
        snapshot.state,
      );
    }

    // Record before repair. A crash after this commit only leaves an auditable
    // open finding; it never loses an external fact or performs a second write.
    const recorded =
      await this.dependencies.repository.recordReconciliationFinding({
        attemptId: attempt.id,
        fingerprint: fingerprintOf(
          attempt.id,
          'callback_gap',
          'provider_state_not_received',
          snapshot.state,
        ),
        kind: 'callback_gap',
        now: this.dependencies.now(),
        provider: attempt.provider,
        reasonCode: 'provider_state_not_received',
        subjectId: attempt.subjectId,
      });
    const applied =
      await this.dependencies.providerEvents.applyRetrievedProviderSnapshot(
        snapshot,
      );
    if (applied) {
      const resolved =
        await this.dependencies.repository.resolveReconciliationFinding({
          findingId: recorded.finding.id,
          now: this.dependencies.now(),
        });
      return {
        failed: 0,
        found: recorded.kind === 'recorded' ? 1 : 0,
        repaired: resolved ? 1 : 0,
      };
    }

    const drift = await this.recordFinding(
      attempt,
      'provider_state_drift',
      'provider_snapshot_not_applied',
      snapshot.state,
    );
    return {
      failed: 0,
      found: (recorded.kind === 'recorded' ? 1 : 0) + drift.found,
      repaired: 0,
    };
  }

  private async retrieveSnapshot(
    attempt: IdentityAttemptRow,
  ): Promise<IdentityProviderSnapshot | undefined> {
    const provider = this.dependencies.provider;
    if (attempt.providerReference !== null) {
      return provider.retrieveCurrentState(attempt.providerReference);
    }
    const session = await provider.retrieveByIdempotencyKey(
      attempt.providerIdempotencyKey,
    );
    return isIdentityHostedSession(session) ? session.snapshot : undefined;
  }

  private async recordFinding(
    attempt: IdentityAttemptRow,
    kind:
      'missing_provider_reference' | 'provider_state_drift' | 'stuck_attempt',
    reasonCode: string,
    state = 'none',
  ): Promise<ReconciliationOutcome> {
    const result =
      await this.dependencies.repository.recordReconciliationFinding({
        attemptId: attempt.id,
        fingerprint: fingerprintOf(attempt.id, kind, reasonCode, state),
        kind,
        now: this.dependencies.now(),
        provider: attempt.provider,
        reasonCode,
        subjectId: attempt.subjectId,
      });
    return {
      failed: 0,
      found: result.kind === 'recorded' ? 1 : 0,
      repaired: 0,
    };
  }
}

function sameProviderIdentity(
  attempt: IdentityAttemptRow,
  snapshot: IdentityProviderSnapshot,
): boolean {
  return (
    snapshot.platformSubjectReference === attempt.subjectId &&
    snapshot.providerIdempotencyKey === attempt.providerIdempotencyKey &&
    (attempt.providerReference === null ||
      snapshot.providerReference === attempt.providerReference)
  );
}

function snapshotMatchesAttempt(
  attempt: IdentityAttemptState,
  snapshot: IdentityProviderSnapshotState,
): boolean {
  return (
    (attempt === 'provider_pending' && snapshot === 'pending') ||
    (attempt === 'processing' && snapshot === 'processing') ||
    (attempt === 'succeeded' && snapshot === 'succeeded') ||
    (attempt === 'refused' && snapshot === 'refused') ||
    (attempt === 'failed' && snapshot === 'failed') ||
    (attempt === 'expired' && snapshot === 'expired') ||
    (attempt === 'cancelled' && snapshot === 'cancelled')
  );
}

function snapshotCanAdvanceAttempt(
  attempt: IdentityAttemptState,
  snapshot: IdentityProviderSnapshotState,
): boolean {
  switch (attempt) {
    case 'provider_starting':
      return snapshot !== 'revoked';
    case 'provider_pending':
    case 'processing':
      return [
        'processing',
        'succeeded',
        'refused',
        'failed',
        'expired',
        'cancelled',
      ].includes(snapshot);
    case 'succeeded':
      return snapshot === 'expired' || snapshot === 'revoked';
    default:
      return false;
  }
}

function fingerprintOf(...parts: readonly string[]): string {
  return createHash('sha256')
    .update(parts.join('\u0000'), 'utf8')
    .digest('hex');
}
