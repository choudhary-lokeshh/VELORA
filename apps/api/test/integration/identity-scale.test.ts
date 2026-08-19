import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { IdentityOperations } from '../../src/identity/operations.js';
import { UnavailableIdentityVerificationProvider } from '../../src/identity/provider.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * Identity operations reads at the documented V1 scale boundary.
 *
 * Correctness tests cover authorization and projection shape elsewhere. This
 * suite proves the exact-reference read does not become a platform-wide scan
 * after retained attempts, evidence, and reconciliation findings accumulate.
 * Plans are asserted instead of timings because a duration belongs to the
 * runner while an index choice belongs to the schema.
 */

const databaseUrl = await provisionDatabase('velora_identity_scale');
const database: TestDatabase = connectDatabase(databaseUrl);

const subjectCount = 200_000;
const targetOrdinal = 100_000;
const targetHistory = 500;
const targetEvidenceHistory = 100;
const targetFindingHistory = 100;
const epoch = Date.UTC(2026, 0, 1);

function uuidFor(prefix: string, ordinal: number): string {
  const tail = ordinal.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${tail}`;
}

const targetSubjectId = uuidFor('10000000', targetOrdinal);
const targetOwnerReference = uuidFor('11000000', targetOrdinal);

async function planFor(query: unknown): Promise<string> {
  const rows = await rowsOf<Record<string, string>>(query);
  return rows.map((row) => Object.values(row).join(' ')).join('\n');
}

async function seed(): Promise<void> {
  await execute(database.sql`
    insert into identity_subjects (created_at, id, owner_domain, owner_reference)
    select
      timestamptz '2026-01-01 00:00:00+00' + ordinal * interval '1 millisecond',
      ('10000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      case ordinal % 3
        when 0 then 'auth'
        when 1 then 'creators'
        else 'safety'
      end,
      ('11000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid
    from generate_series(1, ${subjectCount}) as seed(ordinal)
  `);

  await execute(database.sql`
    insert into identity_attempts (
      caller_idempotency_key, completed_at, created_at, id, input_digest,
      jurisdiction, policy_version, provider, provider_bound_at,
      provider_idempotency_key, provider_reference, purpose,
      required_evidence_class, required_threshold, state, subject_id, updated_at
    )
    select
      'scale-caller-' || ordinal,
      occurred_at,
      occurred_at,
      ('20000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      repeat('a', 64),
      'ES',
      'local-test-v1',
      'local-test',
      occurred_at,
      'scale-provider-' || ordinal,
      'scale-attempt-' || ordinal,
      case ordinal % 3
        when 0 then 'adult_assurance'
        when 1 then 'creator_identity'
        else 'depicted_person_identity'
      end,
      case ordinal % 3
        when 0 then 'adult_threshold'
        when 1 then 'creator_identity'
        else 'depicted_person_identity'
      end,
      case ordinal % 3
        when 0 then 'adult-18-plus'
        when 1 then 'creator-identity'
        else 'depicted-person-identity'
      end,
      'succeeded',
      ('10000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      occurred_at
    from (
      select ordinal,
        timestamptz '2026-01-01 00:00:00+00' + ordinal * interval '1 millisecond' as occurred_at
      from generate_series(1, ${subjectCount}) as seed(ordinal)
    ) as attempts
  `);

  await execute(database.sql`
    insert into identity_evidence (
      attempt_id, effective_at, evidence_class, expires_at, id,
      normalized_result, policy_version, provider, provider_fact_reference,
      recorded_at, subject_id, supersedes_id, threshold_context
    )
    select
      ('20000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      occurred_at,
      case ordinal % 3
        when 0 then 'adult_threshold'
        when 1 then 'creator_identity'
        else 'depicted_person_identity'
      end,
      occurred_at + interval '365 days',
      ('30000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      'granted',
      'local-test-v1',
      'local-test',
      'scale-fact-' || ordinal,
      occurred_at,
      ('10000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      null,
      case ordinal % 3
        when 0 then 'adult-18-plus'
        when 1 then 'creator-identity'
        else 'depicted-person-identity'
      end
    from (
      select ordinal,
        timestamptz '2026-01-01 00:00:00+00' + ordinal * interval '1 millisecond' as occurred_at
      from generate_series(1, ${subjectCount}) as seed(ordinal)
    ) as evidence
  `);

  await execute(database.sql`
    insert into identity_reconciliation_findings (
      attempt_id, detected_at, evidence_id, fingerprint, id, kind, provider,
      reason_code, resolved_at, state, subject_id, updated_at
    )
    select
      ('20000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      occurred_at,
      ('30000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      md5('identity-scale-finding-a-' || ordinal) || md5('identity-scale-finding-b-' || ordinal),
      ('40000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      'callback_gap',
      'local-test',
      'scale-resolved',
      occurred_at,
      'resolved',
      ('10000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      occurred_at
    from (
      select ordinal,
        timestamptz '2026-01-01 00:00:00+00' + ordinal * interval '1 millisecond' as occurred_at
      from generate_series(1, ${subjectCount}) as seed(ordinal)
    ) as findings
  `);

  await execute(database.sql`
    insert into identity_attempts (
      caller_idempotency_key, completed_at, created_at, id, input_digest,
      jurisdiction, policy_version, provider, provider_bound_at,
      provider_idempotency_key, provider_reference, purpose,
      required_evidence_class, required_threshold, state, subject_id, updated_at
    )
    select
      'target-caller-' || ordinal,
      occurred_at,
      occurred_at,
      ('50000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      repeat('b', 64),
      'ES',
      'local-test-v1',
      'local-test',
      occurred_at,
      'target-provider-' || ordinal,
      'target-attempt-' || ordinal,
      case ordinal % 2 when 0 then 'creator_identity' else 'commercial_kyc' end,
      case ordinal % 2 when 0 then 'creator_identity' else 'commercial_kyc' end,
      case ordinal % 2 when 0 then 'creator-identity' else 'commercial-kyc' end,
      'succeeded',
      ${targetSubjectId},
      occurred_at
    from (
      select ordinal,
        timestamptz '2027-01-01 00:00:00+00' + ordinal * interval '1 millisecond' as occurred_at
      from generate_series(1, ${targetHistory}) as seed(ordinal)
    ) as target_attempts
  `);

  let predecessor = uuidFor('30000000', targetOrdinal);
  for (let ordinal = 1; ordinal <= targetEvidenceHistory; ordinal += 1) {
    const occurredAt = new Date(epoch + 2 * 365 * 86_400_000 + ordinal * 1_000);
    const attemptId = uuidFor('60000000', ordinal);
    const evidenceId = uuidFor('70000000', ordinal);
    await execute(database.sql`
      insert into identity_attempts (
        caller_idempotency_key, completed_at, created_at, id, input_digest,
        jurisdiction, policy_version, provider, provider_bound_at,
        provider_idempotency_key, provider_reference, purpose,
        required_evidence_class, required_threshold, state, subject_id, updated_at
      ) values (
        ${`evidence-caller-${String(ordinal)}`}, ${occurredAt}, ${occurredAt}, ${attemptId},
        ${'c'.repeat(64)}, 'ES', 'local-test-v1', 'local-test', ${occurredAt},
        ${`evidence-provider-${String(ordinal)}`}, ${`evidence-attempt-${String(ordinal)}`},
        'creator_identity', 'creator_identity', 'creator-identity', 'succeeded',
        ${targetSubjectId}, ${occurredAt}
      )
    `);
    await execute(database.sql`
      insert into identity_evidence (
        attempt_id, effective_at, evidence_class, expires_at, id,
        normalized_result, policy_version, provider, provider_fact_reference,
        recorded_at, subject_id, supersedes_id, threshold_context
      ) values (
        ${attemptId}, ${occurredAt}, 'creator_identity',
        ${new Date(occurredAt.getTime() + 365 * 86_400_000)}, ${evidenceId},
        'granted', 'local-test-v1', 'local-test', ${`evidence-fact-${String(ordinal)}`},
        ${occurredAt}, ${targetSubjectId}, ${predecessor}, 'creator-identity'
      )
    `);
    predecessor = evidenceId;
  }

  await execute(database.sql`
    insert into identity_reconciliation_findings (
      detected_at, fingerprint, id, kind, provider, reason_code,
      resolved_at, state, subject_id, updated_at
    )
    select
      occurred_at,
      md5('target-finding-a-' || ordinal) || md5('target-finding-b-' || ordinal),
      ('80000000-0000-4000-8000-' || lpad(to_hex(ordinal), 12, '0'))::uuid,
      'provider_state_drift',
      'local-test',
      'scale-resolved',
      occurred_at,
      'resolved',
      ${targetSubjectId},
      occurred_at
    from (
      select ordinal,
        timestamptz '2027-01-01 00:00:00+00' + ordinal * interval '1 millisecond' as occurred_at
      from generate_series(1, ${targetFindingHistory}) as seed(ordinal)
    ) as target_findings
  `);

  await execute(database.sql`analyze identity_subjects`);
  await execute(database.sql`analyze identity_attempts`);
  await execute(database.sql`analyze identity_evidence`);
  await execute(database.sql`analyze identity_reconciliation_findings`);
}

beforeAll(seed);

afterAll(async () => {
  await database.close();
});

describe('Identity operations reads stay bounded at documented scale', () => {
  it('resolves one opaque owner reference through the unique owner index', async () => {
    const plan = await planFor(database.sql`explain analyze
      select id from identity_subjects
      where owner_domain = 'creators' and owner_reference = ${targetOwnerReference}
      limit 1`);

    expect(plan).toContain('identity_subjects_owner_uk');
    expect(plan).not.toContain('Seq Scan on identity_subjects');
  });

  it('reads mixed-purpose attempt history without sorting or scanning', async () => {
    const plan = await planFor(database.sql`explain analyze
      select created_at, purpose, state, updated_at from identity_attempts
      where subject_id = ${targetSubjectId}
      order by sequence desc
      limit 51`);

    expect(plan).toContain('identity_attempts_subject_history_idx');
    expect(plan).not.toContain('Seq Scan on identity_attempts');
    expect(plan).not.toContain('Sort Method');
  });

  it('derives current evidence from subject and supersession indexes', async () => {
    const plan = await planFor(database.sql`explain analyze
      select evidence_class, expires_at, recorded_at, normalized_result
      from identity_evidence evidence
      where subject_id = ${targetSubjectId}
        and not exists (
          select 1 from identity_evidence superseding
          where superseding.supersedes_id = evidence.id
        )
      order by evidence_class`);

    expect(plan).toContain('identity_evidence_current_idx');
    expect(plan).toContain('identity_evidence_supersedes_uk');
    expect(plan).not.toContain('Seq Scan on identity_evidence');
  });

  it('reads bounded subject findings from the subject history index', async () => {
    const plan = await planFor(database.sql`explain analyze
      select detected_at, kind, state from identity_reconciliation_findings
      where subject_id = ${targetSubjectId}
      order by detected_at desc, id desc
      limit 51`);

    expect(plan).toContain('identity_reconciliation_findings_subject_idx');
    expect(plan).not.toContain('Seq Scan on identity_reconciliation_findings');
    expect(plan).not.toContain('Sort Method');
  });

  it('keeps the real Admin projection bounded over retained history', async () => {
    const operations = new IdentityOperations({
      database: database.drizzle,
      now: () => new Date(Date.UTC(2028, 0, 1)),
      provider: new UnavailableIdentityVerificationProvider(),
    });
    const detail = await operations.subjectDetail({
      ownerDomain: 'creators',
      ownerReference: targetOwnerReference,
    });

    expect(detail).toBeDefined();
    expect(detail?.attempts).toHaveLength(50);
    expect(detail?.attemptsTruncated).toBe(true);
    expect(detail?.currentEvidence).toHaveLength(1);
    expect(detail?.findings).toHaveLength(50);
    expect(detail?.findingsTruncated).toBe(true);
    expect(detail?.ownerDomain).toBe('creators');
  });
});
