import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  IdentityCommercialKycEvidenceReader,
  IdentityCreatorEvidenceReader,
} from '../../src/identity/assurance-reader.js';
import { IdentityRepository } from '../../src/identity/repository.js';

import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

const databaseUrl = await provisionDatabase('velora_identity_foundation');
const database: TestDatabase = connectDatabase(databaseUrl);

afterAll(async () => database.close());
beforeEach(async () => database.truncate());

interface Subject {
  readonly id: string;
  readonly ownerReference: string;
}

async function subject(
  ownerDomain: 'auth' | 'creators' | 'safety' = 'auth',
): Promise<Subject> {
  const value = {
    created_at: new Date(),
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
  readonly policyVersion: string;
  readonly provider: string;
  readonly subjectId: string;
}

async function attempt(
  subjectId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<Attempt> {
  const now = new Date();
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
  return {
    id: value.id,
    policyVersion: value.policy_version,
    provider: value.provider,
    subjectId: value.subject_id,
  };
}

interface Evidence {
  readonly id: string;
  readonly recordedAt: Date;
}

async function evidence(
  source: Attempt,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<Evidence> {
  const now = new Date();
  const value = {
    attempt_id: source.id,
    effective_at: now,
    evidence_class: 'adult_threshold',
    expires_at: new Date(now.getTime() + 86_400_000),
    id: crypto.randomUUID(),
    normalized_result: 'granted',
    policy_version: source.policyVersion,
    provider: source.provider,
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
  return { id: value.id, recordedAt: value.recorded_at };
}

describe('Identity Assurance ownership and privacy', () => {
  it('owns only identity-prefixed tables and no cross-domain foreign key', async () => {
    const rows = await rowsOf<{
      foreign_table: string;
      table_name: string;
    }>(database.sql`
      select source.relname as table_name, target.relname as foreign_table
      from pg_constraint constraint_record
      join pg_class source on source.oid = constraint_record.conrelid
      join pg_class target on target.oid = constraint_record.confrelid
      where constraint_record.contype = 'f'
        and source.relname like 'identity_%'
        and target.relname not like 'identity_%'
    `);
    expect(rows).toEqual([]);
  });

  it('creates no column for forbidden identity material or callback bodies', async () => {
    const columns = await rowsOf<{ column_name: string; table_name: string }>(
      database.sql`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public' and table_name like 'identity_%'
        order by table_name, ordinal_position
      `,
    );
    const forbidden = [
      'address',
      'bank_account',
      'biometric_template',
      'date_of_birth',
      'callback_body',
      'document_number',
      'exact_dob',
      'first_name',
      'full_name',
      'hosted_url',
      'last_name',
      'raw_body',
      'selfie',
      'tax_id',
      'video',
    ];
    for (const column of columns) {
      expect(forbidden.some((term) => column.column_name.includes(term))).toBe(
        false,
      );
    }
    expect(
      columns.some((column) => column.column_name === 'payload_digest'),
    ).toBe(true);
  });
});

describe('verification subjects and attempts', () => {
  it('maps one opaque owner reference to one subject and keeps it immutable', async () => {
    const created = await subject();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into identity_subjects ${database.sql({
            created_at: new Date(),
            id: crypto.randomUUID(),
            owner_domain: 'auth',
            owner_reference: created.ownerReference,
          })}`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`update identity_subjects set owner_domain = 'creators'
            where id = ${created.id}`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`delete from identity_subjects where id = ${created.id}`,
        ),
      ),
    ).toBe(true);
  });

  it('rejects concurrent active purpose and changed input under one key', async () => {
    const created = await subject();
    const now = new Date();
    const operation = {
      caller_idempotency_key: 'caller-fixed-key',
      completed_at: null,
      created_at: now,
      id: crypto.randomUUID(),
      input_digest: 'a'.repeat(64),
      jurisdiction: 'ES',
      policy_version: 'local-test-v1',
      provider: 'local-test',
      provider_bound_at: null,
      provider_idempotency_key: 'provider-fixed-key',
      provider_reference: null,
      purpose: 'adult_assurance',
      required_evidence_class: 'adult_threshold',
      required_threshold: 'adult-18-plus',
      state: 'created',
      subject_id: created.id,
      updated_at: now,
    };
    await execute(
      database.sql`insert into identity_attempts ${database.sql(operation)}`,
    );

    expect(
      await refused(() =>
        execute(
          database.sql`insert into identity_attempts ${database.sql({
            ...operation,
            caller_idempotency_key: 'another-caller-key',
            id: crypto.randomUUID(),
            provider_idempotency_key: 'another-provider-key',
          })}`,
        ),
      ),
    ).toBe(true);

    expect(
      await refused(() =>
        execute(
          database.sql`insert into identity_attempts ${database.sql({
            ...operation,
            id: crypto.randomUUID(),
            input_digest: 'b'.repeat(64),
            provider_idempotency_key: 'changed-provider-key',
            state: 'unavailable',
            completed_at: now,
          })}`,
        ),
      ),
    ).toBe(true);
  });

  it('allows only ordered lifecycle moves and freezes terminal attempts', async () => {
    const created = await subject();
    const operation = await attempt(created.id, {
      completed_at: null,
      provider_bound_at: null,
      provider_reference: null,
      state: 'created',
    });
    const now = new Date(Date.now() + 1_000);

    expect(
      await refused(() =>
        execute(
          database.sql`update identity_attempts
            set state = 'succeeded', completed_at = ${now}, updated_at = ${now}
            where id = ${operation.id}`,
        ),
      ),
    ).toBe(true);

    await execute(
      database.sql`update identity_attempts
        set state = 'provider_starting', updated_at = ${now}
        where id = ${operation.id}`,
    );
    await execute(
      database.sql`update identity_attempts
        set state = 'provider_pending', provider_reference = 'provider-ref',
            provider_bound_at = ${now}, updated_at = ${now}
        where id = ${operation.id}`,
    );
    await execute(
      database.sql`update identity_attempts
        set state = 'succeeded', completed_at = ${now}, updated_at = ${now}
        where id = ${operation.id}`,
    );

    expect(
      await refused(() =>
        execute(
          database.sql`update identity_attempts
            set completed_at = ${new Date(now.getTime() + 1_000)},
                updated_at = ${new Date(now.getTime() + 1_000)}
            where id = ${operation.id}`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`delete from identity_attempts where id = ${operation.id}`,
        ),
      ),
    ).toBe(true);
  });
});

describe('append-only assurance evidence', () => {
  it('preserves one ordered, immutable supersession chain', async () => {
    const created = await subject();
    const source = await attempt(created.id);
    const grant = await evidence(source);
    const revokeTime = new Date(grant.recordedAt.getTime() + 1_000);
    const revocation = await evidence(source, {
      effective_at: revokeTime,
      expires_at: null,
      normalized_result: 'revoked',
      recorded_at: revokeTime,
      supersedes_id: grant.id,
    });

    expect(
      await refused(() =>
        evidence(source, {
          effective_at: new Date(revokeTime.getTime() + 1_000),
          normalized_result: 'expired',
          recorded_at: new Date(revokeTime.getTime() + 1_000),
          supersedes_id: grant.id,
        }),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`update identity_evidence set normalized_result = 'granted'
            where id = ${revocation.id}`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`delete from identity_evidence where id = ${grant.id}`,
        ),
      ),
    ).toBe(true);
  });

  it('rejects stale, cross-subject, cross-class, provider, and policy evidence', async () => {
    const firstSubject = await subject();
    const secondSubject = await subject();
    const source = await attempt(firstSubject.id);
    const baseTime = new Date(Date.now() + 5_000);
    const base = await evidence(source, {
      effective_at: baseTime,
      recorded_at: baseTime,
    });

    expect(
      await refused(() =>
        evidence(source, {
          effective_at: new Date(baseTime.getTime() - 1_000),
          recorded_at: new Date(baseTime.getTime() + 1_000),
          supersedes_id: base.id,
        }),
      ),
    ).toBe(true);
    expect(
      await refused(() => evidence(source, { subject_id: secondSubject.id })),
    ).toBe(true);
    expect(
      await refused(() => evidence(source, { evidence_class: 'identity' })),
    ).toBe(true);
    expect(
      await refused(() => evidence(source, { provider: 'other-provider' })),
    ).toBe(true);
    expect(
      await refused(() => evidence(source, { policy_version: 'other-policy' })),
    ).toBe(true);
    expect(
      await refused(() =>
        evidence(source, {
          effective_at: new Date(baseTime.getTime() + 2_000),
          expires_at: new Date(baseTime.getTime() + 1_000),
          recorded_at: new Date(baseTime.getTime() + 2_000),
        }),
      ),
    ).toBe(true);
  });
});

describe('published creator evidence contract', () => {
  it('returns only the current coarse standing for the exact Creator subject', async () => {
    const creator = await subject('creators');
    const source = await attempt(creator.id, {
      purpose: 'creator_identity',
      required_evidence_class: 'creator_identity',
      required_threshold: 'creator-identity-match',
    });
    const grant = await evidence(source, {
      evidence_class: 'creator_identity',
      threshold_context: 'creator-identity-match',
    });
    const reader = new IdentityCreatorEvidenceReader(
      new IdentityRepository(database.drizzle),
    );

    expect(
      await reader.currentForCreator({
        creatorId: creator.ownerReference,
        executor: database.drizzle,
        now: new Date(grant.recordedAt.getTime() + 1),
      }),
    ).toEqual({ recordedAt: grant.recordedAt, standing: 'granted' });
    expect(
      await reader.currentForCreator({
        creatorId: crypto.randomUUID(),
        executor: database.drizzle,
        now: new Date(),
      }),
    ).toBeUndefined();
  });
});

describe('published commercial-KYC evidence contract', () => {
  it('returns only the current coarse standing for the exact Creator subject', async () => {
    const creator = await subject('creators');
    const source = await attempt(creator.id, {
      purpose: 'commercial_kyc',
      required_evidence_class: 'commercial_kyc',
      required_threshold: 'commercial-kyc',
    });
    const grant = await evidence(source, {
      evidence_class: 'commercial_kyc',
      threshold_context: 'commercial-kyc',
    });
    const reader = new IdentityCommercialKycEvidenceReader(
      new IdentityRepository(database.drizzle),
    );

    expect(
      await reader.currentForCreator({
        creatorId: creator.ownerReference,
        executor: database.drizzle,
        now: new Date(grant.recordedAt.getTime() + 1),
      }),
    ).toEqual({ recordedAt: grant.recordedAt, standing: 'granted' });
    expect(
      await reader.currentForCreator({
        creatorId: crypto.randomUUID(),
        executor: database.drizzle,
        now: new Date(),
      }),
    ).toBeUndefined();
  });
});

describe('verified callback and reconciliation records', () => {
  it('deduplicates full provider scope and freezes verified receipt identity', async () => {
    const now = new Date();
    const receipt = {
      attempts: 0,
      available_at: now,
      failure_reason: null,
      id: crypto.randomUUID(),
      lease_expires_at: null,
      lease_owner: null,
      normalized_event_type: 'verification.completed',
      occurred_at: now,
      payload_digest: 'c'.repeat(64),
      processed_at: null,
      provider: 'local-test',
      provider_account: 'default',
      provider_environment: 'test',
      provider_event_id: 'event-1',
      provider_reference: 'provider-ref',
      received_at: now,
      state: 'received',
    };
    await execute(
      database.sql`insert into identity_provider_events ${database.sql(receipt)}`,
    );
    expect(
      await refused(() =>
        execute(
          database.sql`insert into identity_provider_events ${database.sql({
            ...receipt,
            id: crypto.randomUUID(),
          })}`,
        ),
      ),
    ).toBe(true);

    await execute(
      database.sql`update identity_provider_events
        set state = 'processed', processed_at = ${now}
        where id = ${receipt.id}`,
    );
    expect(
      await refused(() =>
        execute(
          database.sql`update identity_provider_events
            set payload_digest = ${'d'.repeat(64)} where id = ${receipt.id}`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`delete from identity_provider_events where id = ${receipt.id}`,
        ),
      ),
    ).toBe(true);
  });

  it('keeps reconciliation identity fixed while allowing one settlement', async () => {
    const now = new Date();
    const finding = {
      attempt_id: null,
      detected_at: now,
      evidence_id: null,
      fingerprint: 'e'.repeat(64),
      id: crypto.randomUUID(),
      kind: 'callback_gap',
      provider: 'local-test',
      reason_code: 'callback-not-observed',
      resolved_at: null,
      state: 'open',
      subject_id: null,
      updated_at: now,
    };
    await execute(
      database.sql`insert into identity_reconciliation_findings ${database.sql(finding)}`,
    );
    await execute(
      database.sql`update identity_reconciliation_findings
        set state = 'resolved', resolved_at = ${now}, updated_at = ${now}
        where id = ${finding.id}`,
    );
    expect(
      await refused(() =>
        execute(
          database.sql`update identity_reconciliation_findings
            set state = 'dead_letter' where id = ${finding.id}`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`update identity_reconciliation_findings
            set reason_code = 'rewritten' where id = ${finding.id}`,
        ),
      ),
    ).toBe(true);
  });
});
