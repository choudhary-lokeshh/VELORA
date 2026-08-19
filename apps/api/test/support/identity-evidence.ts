import { IdentityRepository } from '../../src/identity/repository.js';
import type {
  IdentityEvidenceClass,
  IdentityPurpose,
} from '../../src/identity/policy.js';
import type { TestDatabase } from './database.js';

/**
 * Test-only normalized evidence writer. It exercises IDENTITY persistence and
 * lifecycle constraints directly; SAFETY never receives provider facts.
 */
export async function grantDepictedPersonEvidence(input: {
  readonly database: TestDatabase;
  readonly expiresAt?: Date | undefined;
  readonly now: Date;
  readonly participantReference: string;
}): Promise<string> {
  const repository = new IdentityRepository(input.database.drizzle);
  const identity = await grant({
    ...input,
    evidenceClass: 'depicted_person_identity',
    purpose: 'depicted_person_identity',
    threshold: 'identity-match',
  });
  const adult = await grant({
    ...input,
    evidenceClass: 'depicted_person_adult_threshold',
    purpose: 'depicted_person_adult_assurance',
    threshold: 'adult-18-plus',
  });
  if (identity !== adult) {
    throw new Error('test Identity purposes resolved different subjects');
  }
  return identity;

  async function grant(grantInput: {
    readonly database: TestDatabase;
    readonly evidenceClass: IdentityEvidenceClass;
    readonly expiresAt?: Date | undefined;
    readonly now: Date;
    readonly participantReference: string;
    readonly purpose: IdentityPurpose;
    readonly threshold: string;
  }): Promise<string> {
    const digest = Bun.SHA256.hash(
      `${grantInput.purpose}:${grantInput.participantReference}`,
      'hex',
    );
    const established = await repository.establishAttempt({
      callerIdempotencyKey: `test-${grantInput.purpose}-${digest.slice(0, 24)}`,
      inputDigest: digest,
      jurisdiction: 'US-CA',
      now: grantInput.now,
      ownerDomain: 'safety',
      ownerReference: grantInput.participantReference,
      policyVersion: 'local-test-v1',
      provider: 'local-test',
      providerIdempotencyKey: `test-provider-${grantInput.purpose}-${digest.slice(0, 24)}`,
      purpose: grantInput.purpose,
      requiredEvidenceClass: grantInput.evidenceClass,
      requiredThreshold: grantInput.threshold,
    });
    if (established.kind !== 'created') {
      if (established.kind === 'replay') return established.subject.id;
      throw new Error(
        `test Identity attempt not established: ${established.kind}`,
      );
    }
    await repository.transaction(async (executor) => {
      await repository.transitionAttempt(executor, {
        attemptId: established.attempt.id,
        from: ['created'],
        now: grantInput.now,
        to: 'provider_starting',
      });
      await repository.transitionAttempt(executor, {
        attemptId: established.attempt.id,
        from: ['provider_starting'],
        now: grantInput.now,
        to: 'provider_pending',
      });
      await repository.transitionAttempt(executor, {
        attemptId: established.attempt.id,
        from: ['provider_pending'],
        now: grantInput.now,
        to: 'succeeded',
      });
      const evidence = await repository.appendEvidence(executor, {
        attemptId: established.attempt.id,
        effectiveAt: grantInput.now,
        evidenceClass: grantInput.evidenceClass,
        ...(grantInput.expiresAt === undefined
          ? {}
          : { expiresAt: grantInput.expiresAt }),
        normalizedResult: 'granted',
        now: grantInput.now,
        policyVersion: 'local-test-v1',
        provider: 'local-test',
        providerFactReference: `test-fact-${digest}`,
        subjectId: established.subject.id,
        thresholdContext: grantInput.threshold,
      });
      if (evidence.kind !== 'inserted' && evidence.kind !== 'duplicate') {
        throw new Error(
          `test Identity evidence not appended: ${evidence.kind}`,
        );
      }
    });
    return established.subject.id;
  }
}

export function consentEvidenceFor(
  participantReference: string,
  scopes: readonly string[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    scopes.map((scope) => [
      scope,
      Bun.SHA256.hash(`consent:${scope}:${participantReference}`, 'hex'),
    ]),
  );
}
