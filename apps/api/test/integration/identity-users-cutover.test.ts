import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';

import {
  IdentityAdultAssuranceReader,
  IdentityDepictedPersonEvidenceReader,
} from '../../src/identity/assurance-reader.js';
import { IdentityRepository } from '../../src/identity/repository.js';
import type { DatabaseHandle } from '../../src/database/executor.js';
import { adultAssuranceDecisionOf } from '../../src/users/onboarding.js';
import { requiredEnvironment, rowsOf } from '../support/database.js';

const migrationSource = resolve(
  fileURLToPath(new URL('../../drizzle', import.meta.url)),
);

interface JournalEntry {
  readonly breakpoints: boolean;
  readonly idx: number;
  readonly tag: string;
  readonly version: string;
  readonly when: number;
}

interface Journal {
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
  readonly version: string;
}

const journal = JSON.parse(
  await readFile(resolve(migrationSource, 'meta/_journal.json'), 'utf8'),
) as Journal;

async function stageMigrations(target: string, through: number): Promise<void> {
  await mkdir(resolve(target, 'meta'), { recursive: true });
  for (const entry of journal.entries) {
    await copyFile(
      resolve(migrationSource, `${entry.tag}.sql`),
      resolve(target, `${entry.tag}.sql`),
    );
  }
  await writeFile(
    resolve(target, 'meta/_journal.json'),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, through + 1) }, null, 2)}\n`,
  );
}

async function withLegacyDatabase(
  name: string,
  work: (input: {
    readonly database: DatabaseHandle;
    migrateLatest(): Promise<void>;
    readonly sql: Bun.SQL;
  }) => Promise<void>,
  through = 46,
): Promise<void> {
  const administrativeUrl = requiredEnvironment('TEST_DATABASE_URL');
  const target = new URL(administrativeUrl);
  target.pathname = `/${name}`;
  const workspace = await mkdtemp(join(tmpdir(), 'velora-identity-cutover-'));
  const migrationsFolder = resolve(workspace, 'drizzle');
  const administrative = new Bun.SQL(administrativeUrl, { max: 1 });
  await administrative.unsafe(`drop database if exists "${name}" with (force)`);
  await administrative.unsafe(`create database "${name}"`);
  await administrative.close();

  const sql = new Bun.SQL(target.toString(), { max: 5 });
  const database = drizzle(sql) as DatabaseHandle;
  try {
    await stageMigrations(migrationsFolder, through);
    await migrate(database, { migrationsFolder });
    await work({
      database,
      async migrateLatest() {
        await stageMigrations(
          migrationsFolder,
          journal.entries.at(-1)?.idx ?? 46,
        );
        await migrate(database, { migrationsFolder });
      },
      sql,
    });
  } finally {
    await sql.close();
    await rm(workspace, { force: true, recursive: true });
    const cleanup = new Bun.SQL(administrativeUrl, { max: 1 });
    try {
      await cleanup.unsafe(`drop database if exists "${name}" with (force)`);
    } finally {
      await cleanup.close();
    }
  }
}

interface LegacyAccount {
  readonly authId: string;
  readonly userId: string;
}

async function seedAccount(
  sql: Bun.SQL,
  createdAt: Date,
): Promise<LegacyAccount> {
  const account = { authId: crypto.randomUUID(), userId: crypto.randomUUID() };
  await sql`insert into auth_accounts (created_at, id, status, updated_at)
    values (${createdAt}, ${account.authId}, 'active', ${createdAt})`;
  await sql`insert into users_accounts
    (auth_account_id, created_at, id, region, status, status_changed_at, status_reason, updated_at)
    values (${account.authId}, ${createdAt}, ${account.userId}, 'DE', 'pending_profile', ${createdAt}, 'onboarding_incomplete', ${createdAt})`;
  return account;
}

async function seedLegacyDecision(
  sql: Bun.SQL,
  input: {
    readonly account: LegacyAccount;
    readonly assuranceClass: 'self_declared' | 'verified_adult';
    readonly createdAt: Date;
    readonly decidedAt: Date;
    readonly expiresAt?: Date;
    readonly id: number;
    readonly outcome: 'failed' | 'passed' | 'pending' | 'review' | 'revoked';
  },
): Promise<void> {
  await sql`insert into users_adult_assurances
    (assurance_class, created_at, decided_at, evidence_reference, expires_at, id,
      method, outcome, policy_version, region, user_id)
    values (
      ${input.assuranceClass}, ${input.createdAt}, ${input.decidedAt},
      ${input.assuranceClass === 'verified_adult' ? input.id.toString(16).padStart(64, '0') : null},
      ${input.expiresAt ?? null}, ${input.id},
      ${input.assuranceClass === 'verified_adult' ? 'legacy-provider' : 'self_declaration'},
      ${input.outcome}, 'legacy-v1', 'DE', ${input.account.userId}
    )`;
}

describe('USERS adult-assurance ownership cutover', () => {
  it('preserves counts, order, evidence chains, and current decisions', async () => {
    await withLegacyDatabase('velora_identity_users_cutover', async (input) => {
      const base = new Date('2026-01-01T00:00:00.000Z');
      const later = new Date('2026-01-02T00:00:00.000Z');
      const now = new Date('2030-01-01T00:00:00.000Z');
      const future = new Date('2040-01-01T00:00:00.000Z');
      const expired = new Date('2027-01-01T00:00:00.000Z');
      const accounts = await Promise.all(
        Array.from({ length: 6 }, async () => seedAccount(input.sql, base)),
      );
      const [refused, verified, lapsed, reviewing, declared, chained] =
        accounts;
      if (
        refused === undefined ||
        verified === undefined ||
        lapsed === undefined ||
        reviewing === undefined ||
        declared === undefined ||
        chained === undefined
      ) {
        throw new Error('account fixture missing');
      }

      await seedLegacyDecision(input.sql, {
        account: refused,
        assuranceClass: 'self_declared',
        createdAt: base,
        decidedAt: base,
        id: 1,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: refused,
        assuranceClass: 'verified_adult',
        createdAt: base,
        decidedAt: base,
        expiresAt: future,
        id: 2,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: refused,
        assuranceClass: 'self_declared',
        createdAt: base,
        decidedAt: base,
        id: 3,
        outcome: 'failed',
      });
      await seedLegacyDecision(input.sql, {
        account: verified,
        assuranceClass: 'self_declared',
        createdAt: base,
        decidedAt: base,
        id: 4,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: verified,
        assuranceClass: 'verified_adult',
        createdAt: later,
        decidedAt: later,
        expiresAt: future,
        id: 5,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: lapsed,
        assuranceClass: 'verified_adult',
        createdAt: base,
        decidedAt: base,
        expiresAt: expired,
        id: 6,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: reviewing,
        assuranceClass: 'verified_adult',
        createdAt: base,
        decidedAt: base,
        expiresAt: future,
        id: 7,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: reviewing,
        assuranceClass: 'verified_adult',
        createdAt: later,
        decidedAt: later,
        id: 8,
        outcome: 'review',
      });
      await seedLegacyDecision(input.sql, {
        account: declared,
        assuranceClass: 'self_declared',
        createdAt: later,
        decidedAt: later,
        id: 9,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: chained,
        assuranceClass: 'verified_adult',
        createdAt: base,
        decidedAt: base,
        expiresAt: future,
        id: 10,
        outcome: 'passed',
      });
      await seedLegacyDecision(input.sql, {
        account: chained,
        assuranceClass: 'verified_adult',
        createdAt: later,
        decidedAt: later,
        id: 11,
        outcome: 'revoked',
      });

      await input.migrateLatest();
      // Re-running the committed migration set is a no-op.
      await input.migrateLatest();

      const tables = await rowsOf<{
        old_table: string | null;
        new_table: string | null;
      }>(
        input.sql`select to_regclass('public.users_adult_assurances')::text as old_table,
          to_regclass('public.users_adult_declarations')::text as new_table`,
      );
      expect(tables[0]).toEqual({
        new_table: 'users_adult_declarations',
        old_table: null,
      });
      const counts = await rowsOf<{
        attempts: string;
        declarations: string;
        evidence: string;
        subjects: string;
      }>(input.sql`select
        (select count(*)::text from users_adult_declarations) as declarations,
        (select count(*)::text from identity_subjects where owner_domain = 'auth') as subjects,
        (select count(*)::text from identity_attempts where provider = 'legacy-users') as attempts,
        (select count(*)::text from identity_evidence where provider = 'legacy-users') as evidence`);
      expect(counts[0]).toEqual({
        attempts: '7',
        declarations: '4',
        evidence: '6',
        subjects: '5',
      });
      const declarationIds = await rowsOf<{ id: string }>(
        input.sql`select id::text from users_adult_declarations order by id`,
      );
      expect(declarationIds.map((row) => row.id)).toEqual(['1', '3', '4', '9']);
      const chain = await rowsOf<{ id: string; supersedes_id: string | null }>(
        input.sql`select id::text, supersedes_id::text from identity_evidence
          where subject_id = (
            select id from identity_subjects
            where owner_domain = 'auth' and owner_reference = ${chained.authId}
          ) order by recorded_at`,
      );
      expect(chain).toHaveLength(2);
      expect(chain[0]?.supersedes_id).toBeNull();
      expect(chain[1]?.supersedes_id).toBe(chain[0]?.id);

      const identity = new IdentityAdultAssuranceReader(
        new IdentityRepository(input.database),
      );
      const expected = new Map([
        [refused.authId, { adultAssurance: 'none', refused: true }],
        [verified.authId, { adultAssurance: 'verified_adult', refused: false }],
        [lapsed.authId, { adultAssurance: 'none', refused: false }],
        [reviewing.authId, { adultAssurance: 'none', refused: false }],
        [declared.authId, { adultAssurance: 'self_declared', refused: false }],
        [chained.authId, { adultAssurance: 'none', refused: true }],
      ] as const);
      for (const account of accounts) {
        const expectedDecision = expected.get(account.authId);
        if (expectedDecision === undefined) {
          throw new Error('expected decision fixture missing');
        }
        const declaration = await rowsOf<{
          outcome: 'failed' | 'passed';
          recorded_at: Date;
        }>(input.sql`select outcome, recorded_at from users_adult_declarations
          where user_id = ${account.userId} order by recorded_at desc, id desc limit 1`);
        const identityDecision = await identity.currentForAuthAccount({
          authAccountId: account.authId,
          executor: input.database,
          now,
        });
        expect(
          adultAssuranceDecisionOf(
            declaration[0] === undefined
              ? undefined
              : {
                  outcome: declaration[0].outcome,
                  recordedAt: declaration[0].recorded_at,
                },
            identityDecision,
          ),
        ).toEqual(expectedDecision);
      }
    });
  });

  it('rolls the complete cutover back when any migration assertion fails', async () => {
    await withLegacyDatabase(
      'velora_identity_users_cutover_rollback',
      async (input) => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const account = await seedAccount(input.sql, now);
        await seedLegacyDecision(input.sql, {
          account,
          assuranceClass: 'verified_adult',
          createdAt: now,
          decidedAt: now,
          id: 1,
          outcome: 'passed',
        });
        const subjectId = crypto.randomUUID();
        await input.sql`insert into identity_subjects
          (created_at, id, owner_domain, owner_reference)
          values (${now}, ${subjectId}, 'auth', ${crypto.randomUUID()})`;
        await input.sql`insert into identity_attempts
          (caller_idempotency_key, completed_at, created_at, id, input_digest,
            jurisdiction, policy_version, provider, provider_bound_at,
            provider_idempotency_key, provider_reference, purpose,
            required_evidence_class, required_threshold, state, subject_id, updated_at)
          values ('collision-key', ${now}, ${now}, ${crypto.randomUUID()}, ${'a'.repeat(64)},
            'DE', 'legacy-v1', 'legacy-users', ${now}, 'legacy-users-1',
            'existing-reference', 'adult_assurance', 'adult_threshold',
            'legacy-adult-threshold', 'succeeded', ${subjectId}, ${now})`;

        let rejected = false;
        try {
          await input.migrateLatest();
        } catch {
          rejected = true;
        }
        expect(rejected).toBe(true);
        const state = await rowsOf<{
          declarations: string | null;
          legacy: string | null;
          source_count: string;
        }>(input.sql`select
          to_regclass('public.users_adult_declarations')::text as declarations,
          to_regclass('public.users_adult_assurances')::text as legacy,
          (select count(*)::text from users_adult_assurances) as source_count`);
        expect(state[0]).toEqual({
          declarations: null,
          legacy: 'users_adult_assurances',
          source_count: '1',
        });
      },
    );
  });
});

describe('SAFETY depicted-person ownership cutover', () => {
  it('preserves participant/consent linkage and moves both evidence classes', async () => {
    await withLegacyDatabase(
      'velora_identity_safety_cutover',
      async (input) => {
        const verifiedAt = new Date('2026-02-01T00:00:00.000Z');
        const expiresAt = new Date('2040-02-01T00:00:00.000Z');
        const contentId = crypto.randomUUID();
        const creatorId = crypto.randomUUID();
        const assertionId = crypto.randomUUID();
        const verifiedId = crypto.randomUUID();
        const consentId = crypto.randomUUID();
        await input.sql`insert into safety_content_depictions
          (content_id, creator_id, declaration, declared_at, policy_version, updated_at, version)
          values (${contentId}, ${creatorId}, 'depicted_persons', ${verifiedAt},
            'v1-provisional', ${verifiedAt}, 1)`;
        await input.sql`insert into safety_depicted_participants
          (adult_assurance_evidence_reference, content_id, creator_id, declared_at,
            evidence_state, expires_at, id, identity_evidence_reference,
            policy_version, supersedes_id, verifier, verified_at,
            verifier_subject_reference)
          values (null, ${contentId}, ${creatorId}, ${verifiedAt}, 'asserted', null,
            ${assertionId}, null, 'v1-provisional', null, null, null, null),
          ('adult-fact-1', ${contentId}, ${creatorId}, ${verifiedAt}, 'verified',
            ${expiresAt}, ${verifiedId}, 'identity-fact-1', 'v1-provisional',
            ${assertionId}, 'legacy-verifier', ${verifiedAt}, 'subject-1')`;
        await input.sql`insert into safety_consent_records
          (actor_reference, consent_evidence_reference, content_id, copy_version,
            disposition, expires_at, id, participant_id, policy_version,
            recorded_at, scope, supersedes_id)
          values ('session:test', 'consent-fact-1', ${contentId},
            'local-test-publication-v1', 'grant', ${expiresAt}, ${consentId},
            ${verifiedId}, 'v1-provisional', ${verifiedAt}, 'publication', null)`;

        await input.migrateLatest();
        await input.migrateLatest();

        const participants = await rowsOf<{
          evidence_state: string;
          id: string;
          identity_subject_reference: string | null;
          supersedes_id: string | null;
        }>(input.sql`select id::text, evidence_state,
            identity_subject_reference::text, supersedes_id::text
          from safety_depicted_participants order by supersedes_id nulls first`);
        expect(participants).toHaveLength(2);
        const linked = participants.find(
          (participant) => participant.id === verifiedId,
        );
        expect(linked).toMatchObject({
          evidence_state: 'identity_referenced',
          supersedes_id: assertionId,
        });
        expect(linked?.identity_subject_reference).not.toBeNull();

        const counts = await rowsOf<{
          attempts: string;
          consent: string;
          evidence: string;
          subjects: string;
        }>(input.sql`select
          (select count(*)::text from identity_subjects
            where owner_domain = 'safety' and owner_reference = ${assertionId}) as subjects,
          (select count(*)::text from identity_attempts
            where subject_id = ${linked?.identity_subject_reference ?? null}) as attempts,
          (select count(*)::text from identity_evidence
            where subject_id = ${linked?.identity_subject_reference ?? null}) as evidence,
          (select count(*)::text from safety_consent_records
            where id = ${consentId} and participant_id = ${verifiedId}
              and content_id = ${contentId}) as consent`);
        expect(counts[0]).toEqual({
          attempts: '2',
          consent: '1',
          evidence: '2',
          subjects: '1',
        });

        const columns = await rowsOf<{ column_name: string }>(
          input.sql`select column_name from information_schema.columns
            where table_schema = 'public'
              and table_name = 'safety_depicted_participants'
            order by column_name`,
        );
        const names = columns.map((column) => column.column_name);
        expect(names).toContain('identity_subject_reference');
        for (const retired of [
          'adult_assurance_evidence_reference',
          'expires_at',
          'identity_evidence_reference',
          'verifier',
          'verified_at',
          'verifier_subject_reference',
        ]) {
          expect(names).not.toContain(retired);
        }

        const reader = new IdentityDepictedPersonEvidenceReader(
          new IdentityRepository(input.database),
        );
        expect(
          await reader.currentForSafetyParticipant({
            executor: input.database,
            now: verifiedAt,
            participantReference: assertionId,
            subjectReference: linked?.identity_subject_reference ?? '',
          }),
        ).toMatchObject({
          adultStanding: 'granted',
          identityStanding: 'granted',
        });
      },
      49,
    );
  });

  it('rolls back linkage and leaves legacy facts when the cutover conflicts', async () => {
    await withLegacyDatabase(
      'velora_identity_safety_cutover_rollback',
      async (input) => {
        const now = new Date('2026-02-01T00:00:00.000Z');
        const contentId = crypto.randomUUID();
        const creatorId = crypto.randomUUID();
        const assertionId = crypto.randomUUID();
        const verifiedId = crypto.randomUUID();
        await input.sql`insert into safety_content_depictions
          (content_id, creator_id, declaration, declared_at, policy_version, updated_at, version)
          values (${contentId}, ${creatorId}, 'depicted_persons', ${now},
            'v1-provisional', ${now}, 1)`;
        await input.sql`insert into safety_depicted_participants
          (adult_assurance_evidence_reference, content_id, creator_id, declared_at,
            evidence_state, expires_at, id, identity_evidence_reference,
            policy_version, supersedes_id, verifier, verified_at,
            verifier_subject_reference)
          values (null, ${contentId}, ${creatorId}, ${now}, 'asserted', null,
            ${assertionId}, null, 'v1-provisional', null, null, null, null),
          ('adult-fact-2', ${contentId}, ${creatorId}, ${now}, 'verified', null,
            ${verifiedId}, 'identity-fact-2', 'v1-provisional', ${assertionId},
            'legacy-verifier', ${now}, 'subject-2')`;

        const collisionSubject = crypto.randomUUID();
        await input.sql`insert into identity_subjects
          (created_at, id, owner_domain, owner_reference)
          values (${now}, ${collisionSubject}, 'auth', ${crypto.randomUUID()})`;
        await input.sql`insert into identity_attempts
          (caller_idempotency_key, completed_at, created_at, id, input_digest,
            jurisdiction, policy_version, provider, provider_bound_at,
            provider_idempotency_key, provider_reference, purpose,
            required_evidence_class, required_threshold, state, subject_id, updated_at)
          values ('collision-safety', ${now}, ${now}, ${crypto.randomUUID()},
            ${'b'.repeat(64)}, 'XX', 'v1-provisional', 'legacy-verifier', ${now},
            ${`legacy-safety-identity-${verifiedId}`}, 'existing-safety-reference',
            'depicted_person_identity', 'depicted_person_identity',
            'legacy-depicted-identity', 'succeeded', ${collisionSubject}, ${now})`;

        let rejected = false;
        try {
          await input.migrateLatest();
        } catch {
          rejected = true;
        }
        expect(rejected).toBe(true);
        const state = await rowsOf<{
          identity_column: string | null;
          legacy_column: string | null;
          legacy_rows: string;
        }>(input.sql`select
          (select column_name from information_schema.columns
            where table_schema = 'public'
              and table_name = 'safety_depicted_participants'
              and column_name = 'identity_subject_reference') as identity_column,
          (select column_name from information_schema.columns
            where table_schema = 'public'
              and table_name = 'safety_depicted_participants'
              and column_name = 'verifier') as legacy_column,
          (select count(*)::text from safety_depicted_participants
            where evidence_state = 'verified') as legacy_rows`);
        expect(state[0]).toEqual({
          identity_column: null,
          legacy_column: 'verifier',
          legacy_rows: '1',
        });
      },
      49,
    );
  });
});
