import type { Executor } from '../database/executor.js';
import type {
  IdentityAttemptRow,
  IdentityEvidenceRow,
  IdentityRepository,
} from './repository.js';

export interface IdentityAdultAssuranceDecision {
  readonly assurance: 'none' | 'verified_adult';
  readonly recordedAt: Date;
  readonly refused: boolean;
}

/** Published Identity contract. It exposes a decision fact, never persistence. */
export interface IdentityAdultAssuranceReaderPort {
  currentForAuthAccount(input: {
    readonly authAccountId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<IdentityAdultAssuranceDecision | undefined>;
}

/** Explicit test fixture. Production composition must provide the real reader. */
export class EmptyIdentityAdultAssuranceReader implements IdentityAdultAssuranceReaderPort {
  currentForAuthAccount(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

/**
 * Resolves the latest Identity-owned adult-threshold decision for an AUTH
 * principal. The caller supplies its executor so an owner may ask inside its
 * own transaction, but only this class reads `identity_` tables.
 */
export class IdentityAdultAssuranceReader implements IdentityAdultAssuranceReaderPort {
  constructor(private readonly repository: IdentityRepository) {}

  async currentForAuthAccount(input: {
    readonly authAccountId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<IdentityAdultAssuranceDecision | undefined> {
    const subject = await this.repository.findSubjectByOwner(input.executor, {
      ownerDomain: 'auth',
      ownerReference: input.authAccountId,
    });
    if (subject === undefined) return undefined;

    const [attempt, evidence] = await Promise.all([
      this.repository.findLatestAttempt(input.executor, {
        purpose: 'adult_assurance',
        subjectId: subject.id,
      }),
      this.repository.findCurrentEvidence(
        input.executor,
        subject.id,
        'adult_threshold',
      ),
    ]);
    return currentDecision(attempt, evidence, input.now);
  }
}

function currentDecision(
  attempt: IdentityAttemptRow | undefined,
  evidence: IdentityEvidenceRow | undefined,
  now: Date,
): IdentityAdultAssuranceDecision | undefined {
  if (attempt === undefined && evidence === undefined) return undefined;

  // Evidence produced by the latest attempt is its normalized result. Evidence
  // from an older attempt always yields to the later durable attempt sequence,
  // even when a delayed callback gives that old evidence a newer timestamp.
  // Otherwise a stale success could resurrect assurance during re-verification.
  if (
    evidence !== undefined &&
    (attempt === undefined || evidence.attemptId === attempt.id)
  ) {
    return decisionFromEvidence(evidence, now);
  }
  if (attempt === undefined) return undefined;
  return {
    assurance: 'none',
    recordedAt: attempt.updatedAt,
    refused: attempt.state === 'refused',
  };
}

function decisionFromEvidence(
  evidence: IdentityEvidenceRow,
  now: Date,
): IdentityAdultAssuranceDecision {
  const unexpiredGrant =
    evidence.normalizedResult === 'granted' &&
    (evidence.expiresAt?.getTime() ?? Infinity) > now.getTime();
  return {
    assurance: unexpiredGrant ? 'verified_adult' : 'none',
    recordedAt: evidence.recordedAt,
    refused:
      evidence.normalizedResult === 'refused' ||
      evidence.normalizedResult === 'revoked',
  };
}
