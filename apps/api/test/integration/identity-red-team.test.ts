import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  IdentityAdultAssuranceReader,
  IdentityCommercialKycEvidenceReader,
  IdentityCreatorEvidenceReader,
  IdentityDepictedPersonEvidenceReader,
} from '../../src/identity/assurance-reader.js';
import { IdentityRepository } from '../../src/identity/repository.js';

import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  type TestDatabase,
} from '../support/database.js';

/**
 * Adversarial regressions for the finished Identity vertical.
 *
 * Each test here is an attack on the published evidence contracts rather than
 * a feature: it asserts that a particular way of making one class answer for
 * another, of keeping a grant alive past its own terms, of reading somebody
 * else's standing, or of forking the chain a current answer is derived from
 * does not work.
 *
 * It deliberately does not repeat what the behaviour suites already attack.
 * Callback authentication, oversized bodies, replay convergence, lease
 * recovery, cross-subject and cross-class evidence at the schema level, cutover
 * rollback, and Admin exact-action authorization are covered where they were
 * built and are not re-asserted here. What is here is what a hostile read of
 * the finished domain turns up that nothing else asks.
 */

const databaseUrl = await provisionDatabase('velora_identity_red_team');
const database: TestDatabase = connectDatabase(databaseUrl);
const repository = new IdentityRepository(database.drizzle);
const adultAssurance = new IdentityAdultAssuranceReader(repository);
const creatorEvidence = new IdentityCreatorEvidenceReader(repository);
const commercialKyc = new IdentityCommercialKycEvidenceReader(repository);
const depictedPerson = new IdentityDepictedPersonEvidenceReader(repository);

const now = new Date('2026-08-19T12:00:00.000Z');
const executor = database.drizzle;

afterAll(async () => database.close());
beforeEach(async () => database.truncate());

type OwnerDomain = 'auth' | 'creators' | 'safety';

interface Subject {
  readonly id: string;
  readonly ownerReference: string;
}

async function subject(ownerDomain: OwnerDomain): Promise<Subject> {
  const value = {
    created_at: now,
    id: crypto.randomUUID(),
    owner_domain: ownerDomain,
    owner_reference: crypto.randomUUID(),
  };
  await execute(
    database.sql`insert into identity_subjects ${database.sql(value)}`,
  );
  return { id: value.id, ownerReference: value.owner_reference };
}

interface Attempt {
  readonly id: string;
  readonly subjectId: string;
}

async function attempt(
  subjectId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<Attempt> {
  const value = {
    caller_idempotency_key: `caller-${crypto.randomUUID()}`,
    completed_at: now,
    created_at: now,
    id: crypto.randomUUID(),
    input_digest: 'a'.repeat(64),
    jurisdiction: 'ES',
    policy_version: 'local-test-v1',
    provider: 'local-test',
    provider_bound_at: now,
    provider_idempotency_key: `provider-${crypto.randomUUID()}`,
    provider_reference: `attempt-${crypto.randomUUID()}`,
    purpose: 'adult_assurance',
    required_evidence_class: 'adult_threshold',
    required_threshold: 'adult-18-plus',
    state: 'succeeded',
    subject_id: subjectId,
    updated_at: now,
    ...overrides,
  };
  await execute(
    database.sql`insert into identity_attempts ${database.sql(value)}`,
  );
  return { id: value.id, subjectId: value.subject_id };
}

/** A pre-provider attempt has no bound reference and no completion. */
async function pendingAttempt(
  subjectId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<Attempt> {
  return attempt(subjectId, {
    completed_at: null,
    provider_bound_at: null,
    provider_reference: null,
    state: 'provider_pending',
    ...overrides,
  });
}

async function evidence(
  source: Attempt,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const value = {
    attempt_id: source.id,
    effective_at: now,
    evidence_class: 'adult_threshold',
    expires_at: new Date(now.getTime() + 86_400_000),
    id: crypto.randomUUID(),
    normalized_result: 'granted',
    policy_version: 'local-test-v1',
    provider: 'local-test',
    provider_fact_reference: `fact-${crypto.randomUUID()}`,
    recorded_at: now,
    subject_id: source.subjectId,
    supersedes_id: null,
    threshold_context: 'adult-18-plus',
    ...overrides,
  };
  await execute(
    database.sql`insert into identity_evidence ${database.sql(value)}`,
  );
  return value.id;
}

describe('one class never answers for another', () => {
  it('does not let a creator-identity grant stand in for commercial KYC', async () => {
    const creator = await subject('creators');
    const granted = await attempt(creator.id, {
      purpose: 'creator_identity',
      required_evidence_class: 'creator_identity',
      required_threshold: 'creator-identity',
    });
    await evidence(granted, {
      evidence_class: 'creator_identity',
      threshold_context: 'creator-identity',
    });

    expect(
      await creatorEvidence.currentForCreator({
        creatorId: creator.ownerReference,
        executor,
        now,
      }),
    ).toEqual({ recordedAt: now, standing: 'granted' });
    expect(
      await commercialKyc.currentForCreator({
        creatorId: creator.ownerReference,
        executor,
        now,
      }),
    ).toEqual({ recordedAt: undefined, standing: 'missing' });
  });

  it('does not let commercial KYC stand in for creator identity', async () => {
    const creator = await subject('creators');
    const granted = await attempt(creator.id, {
      purpose: 'commercial_kyc',
      required_evidence_class: 'commercial_kyc',
      required_threshold: 'commercial-kyc',
    });
    await evidence(granted, {
      evidence_class: 'commercial_kyc',
      threshold_context: 'commercial-kyc',
    });

    expect(
      await commercialKyc.currentForCreator({
        creatorId: creator.ownerReference,
        executor,
        now,
      }),
    ).toEqual({ recordedAt: now, standing: 'granted' });
    expect(
      await creatorEvidence.currentForCreator({
        creatorId: creator.ownerReference,
        executor,
        now,
      }),
    ).toEqual({ recordedAt: undefined, standing: 'missing' });
  });

  it('has nothing to say about a person who only declared their own age', async () => {
    // USERS keeps self-declaration. A principal who never met a verification
    // requirement has no Identity subject at all, and the reader says so rather
    // than reporting an absence as a decision an owner could misread.
    expect(
      await adultAssurance.currentForAuthAccount({
        authAccountId: crypto.randomUUID(),
        executor,
        now,
      }),
    ).toBeUndefined();
  });
});

describe('a grant never outlives its own terms', () => {
  it('refuses to call a grant current at the instant it expires', async () => {
    const account = await subject('auth');
    const granted = await attempt(account.id);
    await evidence(granted, { expires_at: now });

    const decision = await adultAssurance.currentForAuthAccount({
      authAccountId: account.ownerReference,
      executor,
      now,
    });
    expect(decision?.assurance).toBe('none');

    const creator = await subject('creators');
    const creatorGrant = await attempt(creator.id, {
      purpose: 'creator_identity',
      required_evidence_class: 'creator_identity',
      required_threshold: 'creator-identity',
    });
    await evidence(creatorGrant, {
      evidence_class: 'creator_identity',
      expires_at: now,
      threshold_context: 'creator-identity',
    });
    expect(
      (
        await creatorEvidence.currentForCreator({
          creatorId: creator.ownerReference,
          executor,
          now,
        })
      )?.standing,
    ).toBe('expired');
  });

  it('reports a revocation as a revocation rather than as an absence', async () => {
    const account = await subject('auth');
    const granted = await attempt(account.id);
    const grant = await evidence(granted);
    const revoking = await attempt(account.id, {
      caller_idempotency_key: `caller-${crypto.randomUUID()}`,
    });
    await evidence(revoking, {
      effective_at: new Date(now.getTime() + 1_000),
      expires_at: null,
      normalized_result: 'revoked',
      recorded_at: new Date(now.getTime() + 1_000),
      supersedes_id: grant,
    });

    const decision = await adultAssurance.currentForAuthAccount({
      authAccountId: account.ownerReference,
      executor,
      now,
    });
    expect(decision?.assurance).toBe('none');
    expect(decision?.refused).toBe(true);
  });

  it('will not let a delayed success outrank the attempt that came after it', async () => {
    // The durable attempt sequence decides, not the wall clock a provider
    // stamped on a callback. Otherwise a success that arrives late could
    // resurrect assurance a later refusal already took away.
    const account = await subject('auth');
    const earlier = await attempt(account.id);
    await evidence(earlier, {
      // A recording timestamp far in the future, as a delayed callback would.
      effective_at: new Date(now.getTime() + 600_000),
      recorded_at: new Date(now.getTime() + 600_000),
    });
    await attempt(account.id, { state: 'refused' });

    const decision = await adultAssurance.currentForAuthAccount({
      authAccountId: account.ownerReference,
      executor,
      now,
    });
    expect(decision?.assurance).toBe('none');
    expect(decision?.refused).toBe(true);
  });

  it('withholds a current grant while a later attempt is still open', async () => {
    // Re-verification fails closed: an owner asking mid-attempt is told the
    // question is open rather than being handed the superseded answer. No V1
    // owner predicate consumes this, and a Phase 2 workflow that starts an
    // attempt must not strand a person who is currently verified.
    const creator = await subject('creators');
    const granted = await attempt(creator.id, {
      purpose: 'creator_identity',
      required_evidence_class: 'creator_identity',
      required_threshold: 'creator-identity',
    });
    await evidence(granted, {
      evidence_class: 'creator_identity',
      threshold_context: 'creator-identity',
    });
    await pendingAttempt(creator.id, {
      purpose: 'creator_identity',
      required_evidence_class: 'creator_identity',
      required_threshold: 'creator-identity',
    });

    expect(
      (
        await creatorEvidence.currentForCreator({
          creatorId: creator.ownerReference,
          executor,
          now,
        })
      )?.standing,
    ).toBe('pending');
  });
});

describe('the chain a current answer comes from', () => {
  it('refuses a second root for one subject and class', async () => {
    // Every root is a non-superseded tip. Two of them would make the current
    // answer whichever row the database returned first, so a revoked tip could
    // be passed over for a granted one.
    const account = await subject('auth');
    const first = await attempt(account.id);
    await evidence(first, { expires_at: null, normalized_result: 'revoked' });

    expect(
      await refused(async () =>
        evidence(first, { provider_fact_reference: 'fact-second-root' }),
      ),
    ).toBe(true);

    const decision = await adultAssurance.currentForAuthAccount({
      authAccountId: account.ownerReference,
      executor,
      now,
    });
    expect(decision?.assurance).toBe('none');
    expect(decision?.refused).toBe(true);
  });

  it('keeps one root per class rather than one per subject', async () => {
    const creator = await subject('creators');
    const identity = await attempt(creator.id, {
      purpose: 'creator_identity',
      required_evidence_class: 'creator_identity',
      required_threshold: 'creator-identity',
    });
    const kyc = await attempt(creator.id, {
      purpose: 'commercial_kyc',
      required_evidence_class: 'commercial_kyc',
      required_threshold: 'commercial-kyc',
    });
    await evidence(identity, {
      evidence_class: 'creator_identity',
      threshold_context: 'creator-identity',
    });
    await evidence(kyc, {
      evidence_class: 'commercial_kyc',
      threshold_context: 'commercial-kyc',
    });

    expect(
      (
        await creatorEvidence.currentForCreator({
          creatorId: creator.ownerReference,
          executor,
          now,
        })
      )?.standing,
    ).toBe('granted');
    expect(
      (
        await commercialKyc.currentForCreator({
          creatorId: creator.ownerReference,
          executor,
          now,
        })
      )?.standing,
    ).toBe('granted');
  });
});

describe('reading somebody else', () => {
  it('answers a depicted-person read only for the exact participant pairing', async () => {
    const participant = await subject('safety');
    const other = await subject('safety');
    const identity = await attempt(participant.id, {
      purpose: 'depicted_person_identity',
      required_evidence_class: 'depicted_person_identity',
      required_threshold: 'depicted-person-identity',
    });
    await evidence(identity, {
      evidence_class: 'depicted_person_identity',
      threshold_context: 'depicted-person-identity',
    });

    expect(
      await depictedPerson.currentForSafetyParticipant({
        executor,
        now,
        participantReference: participant.ownerReference,
        subjectReference: participant.id,
      }),
    ).toEqual({
      adultStanding: 'missing',
      identityStanding: 'granted',
      subjectReference: participant.id,
    });

    // A caller holding one participant's reference and another's subject
    // identifier learns nothing, and is answered exactly as for an absent
    // record rather than with a distinguishable refusal.
    expect(
      await depictedPerson.currentForSafetyParticipant({
        executor,
        now,
        participantReference: participant.ownerReference,
        subjectReference: other.id,
      }),
    ).toBeUndefined();
    expect(
      await depictedPerson.currentForSafetyParticipant({
        executor,
        now,
        participantReference: other.ownerReference,
        subjectReference: participant.id,
      }),
    ).toBeUndefined();
  });

  it('never resolves an owner reference across owner domains', async () => {
    // The same opaque value in two owner domains is two subjects. A Creator
    // reader handed an AUTH principal's reference must not find the AUTH
    // subject's evidence.
    const account = await subject('auth');
    const granted = await attempt(account.id);
    await evidence(granted);

    expect(
      await creatorEvidence.currentForCreator({
        creatorId: account.ownerReference,
        executor,
        now,
      }),
    ).toBeUndefined();
    expect(
      await commercialKyc.currentForCreator({
        creatorId: account.ownerReference,
        executor,
        now,
      }),
    ).toBeUndefined();
  });
});

describe('what a published contract hands an owner', () => {
  it('carries a decision and never a provider or evidence handle', async () => {
    const creator = await subject('creators');
    const granted = await attempt(creator.id, {
      purpose: 'creator_identity',
      required_evidence_class: 'creator_identity',
      required_threshold: 'creator-identity',
    });
    await evidence(granted, {
      evidence_class: 'creator_identity',
      threshold_context: 'creator-identity',
    });

    const decision = await creatorEvidence.currentForCreator({
      creatorId: creator.ownerReference,
      executor,
      now,
    });
    expect(Object.keys(decision ?? {}).sort()).toEqual([
      'recordedAt',
      'standing',
    ]);

    const account = await subject('auth');
    const adult = await attempt(account.id);
    await evidence(adult);
    const adultDecision = await adultAssurance.currentForAuthAccount({
      authAccountId: account.ownerReference,
      executor,
      now,
    });
    expect(Object.keys(adultDecision ?? {}).sort()).toEqual([
      'assurance',
      'recordedAt',
      'refused',
    ]);
  });
});
