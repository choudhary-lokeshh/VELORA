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

export type IdentityEvidenceStanding =
  'expired' | 'granted' | 'missing' | 'pending' | 'refused' | 'revoked';

export interface IdentityCreatorEvidenceDecision {
  readonly recordedAt: Date | undefined;
  readonly standing: IdentityEvidenceStanding;
}

export interface IdentityCommercialKycEvidenceDecision {
  readonly recordedAt: Date | undefined;
  readonly standing: IdentityEvidenceStanding;
}

/** Published CREATORS contract. It exposes no provider or evidence handle. */
export interface IdentityCreatorEvidenceReaderPort {
  currentForCreator(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<IdentityCreatorEvidenceDecision | undefined>;
}

/** Published PAYOUTS contract. Evidence is never payout authorization. */
export interface IdentityCommercialKycEvidenceReaderPort {
  currentForCreator(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<IdentityCommercialKycEvidenceDecision | undefined>;
}

export interface IdentityDepictedPersonEvidenceDecision {
  readonly adultStanding: IdentityEvidenceStanding;
  readonly identityStanding: IdentityEvidenceStanding;
  readonly subjectReference: string;
}

/**
 * Published SAFETY contract. The owner reference binds the Identity subject to
 * one SAFETY assertion, so a caller cannot attach somebody else's evidence.
 */
export interface IdentityDepictedPersonEvidenceReaderPort {
  currentForSafetyParticipant(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly participantReference: string;
    readonly subjectReference: string;
  }): Promise<IdentityDepictedPersonEvidenceDecision | undefined>;
}

/** Explicit test fixture. Production composition must provide the real reader. */
export class EmptyIdentityDepictedPersonEvidenceReader implements IdentityDepictedPersonEvidenceReaderPort {
  currentForSafetyParticipant(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
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

    // Sequential, because `executor` may be a transaction and a transaction is
    // one connection. See `users/standing.ts`, which reaches this read inside
    // one.
    const attempt = await this.repository.findLatestAttempt(input.executor, {
      purpose: 'adult_assurance',
      subjectId: subject.id,
    });
    const evidence = await this.repository.findCurrentEvidence(
      input.executor,
      subject.id,
      'adult_threshold',
    );
    return currentDecision(attempt, evidence, input.now);
  }
}

export class IdentityCreatorEvidenceReader implements IdentityCreatorEvidenceReaderPort {
  constructor(private readonly repository: IdentityRepository) {}

  async currentForCreator(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<IdentityCreatorEvidenceDecision | undefined> {
    const subject = await this.repository.findSubjectByOwner(input.executor, {
      ownerDomain: 'creators',
      ownerReference: input.creatorId,
    });
    if (subject === undefined) return undefined;
    const decision = await evidenceStandingFor({
      evidenceClass: 'creator_identity',
      executor: input.executor,
      now: input.now,
      purpose: 'creator_identity',
      repository: this.repository,
      subjectId: subject.id,
    });
    return { recordedAt: decision.recordedAt, standing: decision.standing };
  }
}

export class IdentityCommercialKycEvidenceReader implements IdentityCommercialKycEvidenceReaderPort {
  constructor(private readonly repository: IdentityRepository) {}

  async currentForCreator(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<IdentityCommercialKycEvidenceDecision | undefined> {
    const subject = await this.repository.findSubjectByOwner(input.executor, {
      ownerDomain: 'creators',
      ownerReference: input.creatorId,
    });
    if (subject === undefined) return undefined;
    const decision = await evidenceStandingFor({
      evidenceClass: 'commercial_kyc',
      executor: input.executor,
      now: input.now,
      purpose: 'commercial_kyc',
      repository: this.repository,
      subjectId: subject.id,
    });
    return { recordedAt: decision.recordedAt, standing: decision.standing };
  }
}

export class IdentityDepictedPersonEvidenceReader implements IdentityDepictedPersonEvidenceReaderPort {
  constructor(private readonly repository: IdentityRepository) {}

  async currentForSafetyParticipant(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly participantReference: string;
    readonly subjectReference: string;
  }): Promise<IdentityDepictedPersonEvidenceDecision | undefined> {
    const subject = await this.repository.findSubjectByOwner(input.executor, {
      ownerDomain: 'safety',
      ownerReference: input.participantReference,
    });
    if (subject?.id !== input.subjectReference) {
      return undefined;
    }
    const [identity, adult] = await Promise.all([
      evidenceStandingFor({
        evidenceClass: 'depicted_person_identity',
        executor: input.executor,
        now: input.now,
        purpose: 'depicted_person_identity',
        repository: this.repository,
        subjectId: subject.id,
      }),
      evidenceStandingFor({
        evidenceClass: 'depicted_person_adult_threshold',
        executor: input.executor,
        now: input.now,
        purpose: 'depicted_person_adult_assurance',
        repository: this.repository,
        subjectId: subject.id,
      }),
    ]);
    return {
      adultStanding: adult.standing,
      identityStanding: identity.standing,
      subjectReference: subject.id,
    };
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

async function evidenceStandingFor(input: {
  readonly evidenceClass:
    | 'commercial_kyc'
    | 'creator_identity'
    | 'depicted_person_adult_threshold'
    | 'depicted_person_identity';
  readonly executor: Executor;
  readonly now: Date;
  readonly purpose:
    | 'commercial_kyc'
    | 'creator_identity'
    | 'depicted_person_adult_assurance'
    | 'depicted_person_identity';
  readonly repository: IdentityRepository;
  readonly subjectId: string;
}): Promise<{
  readonly recordedAt: Date | undefined;
  readonly standing: IdentityEvidenceStanding;
}> {
  const [attempt, evidence] = await Promise.all([
    input.repository.findLatestAttempt(input.executor, {
      purpose: input.purpose,
      subjectId: input.subjectId,
    }),
    input.repository.findCurrentEvidence(
      input.executor,
      input.subjectId,
      input.evidenceClass,
    ),
  ]);
  if (
    evidence !== undefined &&
    (attempt === undefined || evidence.attemptId === attempt.id)
  ) {
    return {
      recordedAt: evidence.recordedAt,
      standing:
        evidence.normalizedResult === 'granted' &&
        evidence.expiresAt !== null &&
        evidence.expiresAt <= input.now
          ? 'expired'
          : evidence.normalizedResult,
    };
  }
  if (attempt === undefined)
    return { recordedAt: undefined, standing: 'missing' };
  if (
    attempt.state === 'created' ||
    attempt.state === 'processing' ||
    attempt.state === 'provider_pending' ||
    attempt.state === 'provider_starting'
  ) {
    return { recordedAt: attempt.updatedAt, standing: 'pending' };
  }
  if (attempt.state === 'refused') {
    return { recordedAt: attempt.updatedAt, standing: 'refused' };
  }
  if (attempt.state === 'expired') {
    return { recordedAt: attempt.updatedAt, standing: 'expired' };
  }
  return { recordedAt: attempt.updatedAt, standing: 'missing' };
}
