import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  connectDatabase,
  execute,
  insertRows,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * TRUST & SAFETY reads at volume.
 *
 * Every query here is correct at any size. What this file measures is whether
 * it stays *cheap* at a size the platform will reach, because a safety read
 * that degrades is one an operator stops using and one a person waits on while
 * being told what was done to them.
 *
 * The plans are asserted rather than the timings. A duration is a property of
 * the machine that ran it; the index the planner chose is a property of the
 * schema, and it is the thing a later change can silently take away.
 *
 * Seeded directly rather than through the product, because what is under test
 * is the shape of the read. Building sixty thousand rows through HTTP would
 * measure onboarding.
 */

const databaseUrl = await provisionDatabase('velora_safety_scale');
const database: TestDatabase = connectDatabase(databaseUrl);

const cases = 20_000;
const reports = 20_000;
const blocks = 20_000;
const decisions = 10_000;
const claims = 10_000;

/** A deterministic identifier, so a seeded row can be addressed by index. */
function uuidFor(prefix: string, index: number): string {
  const tail = index.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${tail}`;
}

function iso(offsetMilliseconds: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offsetMilliseconds).toISOString();
}

/**
 * Seeds in statement-sized batches.
 *
 * The wire protocol caps a statement at 65,535 bound parameters, so twenty
 * thousand rows of a dozen columns is several statements whether or not the
 * caller wanted it to be. Chunking here keeps the seed one obvious loop rather
 * than a number tuned per table.
 */
async function seedRows(
  table: string,
  rows: readonly Readonly<Record<string, unknown>>[],
): Promise<void> {
  const columns = Object.keys(rows[0] ?? {}).length || 1;
  const perStatement = Math.max(1, Math.floor(60_000 / columns));
  for (let start = 0; start < rows.length; start += perStatement) {
    await insertRows(database, table, rows.slice(start, start + perStatement));
  }
}

/** The plan PostgreSQL chose, as one string. */
async function planFor(query: unknown): Promise<string> {
  const rows = await rowsOf<Record<string, string>>(query);
  return rows.map((row) => Object.values(row).join(' ')).join('\n');
}

async function seed(): Promise<void> {
  await database.truncate();

  // Cases: a realistic mixture of open and settled, because the open queue is
  // only interesting when most of the table is not in it.
  await seedRows(
    'safety_cases',
    Array.from({ length: cases }, (_, index) => {
      const settled = index % 4 !== 0;
      return {
        closed_at: settled ? iso(index * 1_000) : null,
        id: uuidFor('caaaaaaa', index),
        opened_at: iso(index * 1_000),
        policy_version: 'v1-provisional',
        priority: 'untriaged',
        queue: 'consumer_conduct',
        state: settled ? 'closed' : 'new',
        // One case per target, because the open-target unique index is partial
        // on the open ones and a duplicate open target is refused.
        target_id: uuidFor('7aaaaaaa', index),
        target_type: 'consumer_account',
        updated_at: iso(index * 1_000),
      };
    }),
  );

  const reporterId = uuidFor('7ebbbbbb', 1);
  await seedRows(
    'safety_reports',
    Array.from({ length: reports }, (_, index) => ({
      case_id: uuidFor('caaaaaaa', index % cases),
      client_report_id: `seeded-${String(index).padStart(6, '0')}`,
      conversation_id: null,
      created_at: iso(index * 1_000),
      detail: null,
      id: uuidFor('4ebbbbbb', index),
      message_id: null,
      policy_version: 'v1-provisional',
      reason_code: 'harassment',
      // One busy reporter and many quiet ones, so "my own reports" is a real
      // question rather than a table scan that happens to be short.
      reporter_id: index % 10 === 0 ? reporterId : uuidFor('7ebbbbbb', index),
      resolved_at: index % 4 === 0 ? null : iso(index * 1_000),
      source_surface: 'consumer_web',
      state: index % 4 === 0 ? 'received' : 'dismissed',
      subject_id: uuidFor('7aaaaaaa', index % cases),
      target_type: 'consumer_account',
      updated_at: iso(index * 1_000),
    })),
  );

  const blockerId = uuidFor('7ccccccc', 1);
  await seedRows(
    'safety_blocks',
    Array.from({ length: blocks }, (_, index) => ({
      blocked_id: uuidFor('7ddddddd', index),
      blocker_id: index % 10 === 0 ? blockerId : uuidFor('7ccccccc', index),
      created_at: iso(index * 1_000),
      // Most live, some withdrawn, because the list is partial on the live ones.
      revoked_at: index % 7 === 0 ? iso(index * 1_000 + 500) : null,
      updated_at: iso(index * 1_000),
    })),
  );

  const subjectId = uuidFor('7aaaaaaa', 3);
  await seedRows(
    'safety_decisions',
    Array.from({ length: decisions }, (_, index) => ({
      action: 'no_action',
      actor_reference: 'session:seeded',
      // Every decision needs a case, and only the settled quarter may carry a
      // resolving one, so they are spread across distinct cases.
      case_id: uuidFor('caaaaaaa', index * 2 + 1),
      decided_at: iso(index * 1_000),
      enforcement_id: null,
      expires_at: null,
      id: uuidFor('4ddddddd', index),
      policy_version: 'v1-provisional',
      prior_state: null,
      reason_code: 'no_violation_found',
      resulting_state: null,
      scope: null,
      // One subject with a long history, which is what a statement of reasons
      // has to read through.
      subject_id: index % 10 === 0 ? subjectId : uuidFor('7aaaaaaa', index),
      supersedes_id: null,
      target_type: 'consumer_account',
    })),
  );

  await seedRows(
    'safety_takedown_claims',
    Array.from({ length: claims }, (_, index) => ({
      acknowledged_at: null,
      acknowledgement_due_at: iso(index * 1_000 + 3_600_000),
      action_due_at: iso(index * 1_000 + 86_400_000),
      // Most breaches already recorded, so the overdue queue is only useful if
      // the index excludes them rather than filtering them out every cycle.
      breach_recorded_at: index % 20 === 0 ? null : iso(index * 1_000),
      case_id: uuidFor('caaaaaaa', index),
      claimant_account_id: null,
      claimant_kind: 'depicted_person',
      completed_at: null,
      consent_record_id: null,
      content_id: uuidFor('7eeeeeee', index),
      creator_id: uuidFor('7fffffff', index),
      deadline_policy_version: 'local-test-v1',
      decided_at: null,
      id: uuidFor('4fffffff', index),
      lease_actor_reference: null,
      lease_expires_at: null,
      policy_version: 'v1-provisional',
      reason_code: 'non_consensual_content',
      received_at: iso(index * 1_000),
      state: 'received',
      triage_due_at: iso(index * 1_000 + 14_400_000),
      updated_at: iso(index * 1_000),
      urgency: 'urgent',
    })),
  );

  for (const table of [
    'safety_cases',
    'safety_reports',
    'safety_blocks',
    'safety_decisions',
    'safety_takedown_claims',
  ]) {
    await execute(database.sql.unsafe(`analyze ${table}`));
  }
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await database.close();
});

describe('the operator queues stay walks that stop', () => {
  it('reads the unfiltered case queue from the open-case index', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id, opened_at from safety_cases
        where state in ('new', 'triaged', 'investigating')
        order by opened_at asc, id asc
        limit 51`,
    );

    // The default operator view. `safety_cases_queue_idx` leads with the queue,
    // so before this index existed the planner scanned every case ever opened
    // and sorted it — fine at twenty thousand rows and an outage later.
    expect(plan).toContain('safety_cases_open_idx');
    expect(plan).not.toContain('Seq Scan on safety_cases');
    expect(plan).not.toContain('Sort Method');
  });

  it('reads one queue from the queue index without a sort', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id, opened_at from safety_cases
        where state in ('new', 'triaged', 'investigating')
          and queue = 'consumer_conduct'
        order by opened_at asc, id asc
        limit 51`,
    );

    expect(plan).not.toContain('Seq Scan on safety_cases');
  });

  it('reads the open report queue from the partial open index', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id, created_at from safety_reports
        where state in ('received', 'under_review')
        order by created_at asc, id asc
        limit 51`,
    );

    // Two open states through an index leading with `state` is a merge and a
    // sort. Partial on the open rows, in the read's own order, is one walk.
    expect(plan).toContain('safety_reports_open_idx');
    expect(plan).not.toContain('Seq Scan on safety_reports');
    expect(plan).not.toContain('Sort Method');
  });

  it('offers only the overdue claims whose breach is not yet recorded', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id from safety_takedown_claims
        where state in ('received', 'acknowledged')
          and action_due_at <= now()
          and breach_recorded_at is null
        order by action_due_at asc, id asc
        limit 51`,
    );

    // Without the recorded breaches out of the predicate the index accumulates
    // every one ever written and the sweep filters them out again, every
    // cycle, for ever.
    expect(plan).toContain('safety_takedown_claims_due_idx');
    expect(plan).not.toContain('Seq Scan on safety_takedown_claims');
  });
});

describe("a person's own lists page from an index", () => {
  it('reads live blocks by blocker without a sort', async () => {
    const blockerId = uuidFor('7ccccccc', 1);
    const plan = await planFor(
      database.sql`explain analyze
        select id, created_at from safety_blocks
        where blocker_id = ${blockerId} and revoked_at is null
        order by created_at desc, id desc
        limit 51`,
    );

    // The live-pair unique index leads with the blocked account: it answers
    // "is this pair blocked" and can supply no order at all.
    expect(plan).toContain('safety_blocks_live_idx');
    expect(plan).not.toContain('Seq Scan on safety_blocks');
    expect(plan).not.toContain('Sort Method');
  });

  it('reads a reporter own reports without a sort at the page boundary', async () => {
    const reporterId = uuidFor('7ebbbbbb', 1);
    const plan = await planFor(
      database.sql`explain analyze
        select id, created_at from safety_reports
        where reporter_id = ${reporterId}
        order by created_at desc, id desc
        limit 51`,
    );

    expect(plan).toContain('safety_reports_reporter_idx');
    expect(plan).not.toContain('Seq Scan on safety_reports');
    expect(plan).not.toContain('Sort Method');
  });

  it('reads the decisions behind a statement of reasons by subject', async () => {
    const subjectId = uuidFor('7aaaaaaa', 3);
    const plan = await planFor(
      database.sql`explain analyze
        select id, decided_at from safety_decisions
        where subject_id = ${subjectId}
        order by decided_at desc, id desc
        limit 51`,
    );

    // What somebody reads when they ask what was done to them, so it is on the
    // path of a request a restricted person makes.
    expect(plan).toContain('safety_decisions_subject_idx');
    expect(plan).not.toContain('Seq Scan on safety_decisions');
    expect(plan).not.toContain('Sort Method');
  });
});

describe('every safety read is bounded', () => {
  it('reads a case timeline by the case rather than by scanning', async () => {
    const caseId = uuidFor('caaaaaaa', 7);
    const plan = await planFor(
      database.sql`explain analyze
        select id from safety_reports where case_id = ${caseId}
        order by created_at asc, id asc
        limit 201`,
    );

    expect(plan).toContain('safety_reports_case_idx');
    expect(plan).not.toContain('Seq Scan on safety_reports');
  });

  it('answers a target lookup without walking the case table', async () => {
    const targetId = uuidFor('7aaaaaaa', 11);
    const plan = await planFor(
      database.sql`explain analyze
        select id from safety_cases
        where target_type = 'consumer_account' and target_id = ${targetId}
          and state not in ('decided', 'closed')
        limit 1`,
    );

    // Intake asks this for every report, under the subject lock, so it is on
    // the hot path of the one thing a person must always be able to do.
    expect(plan).not.toContain('Seq Scan on safety_cases');
  });
});
