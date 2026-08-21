import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  rtcAbuseWindowMilliseconds,
  rtcJoinTimeoutMilliseconds,
  rtcReconnectGraceMilliseconds,
} from '../../src/realtime/policy.js';
import {
  connectDatabase,
  execute,
  insertRows,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * Calling at a size nobody has yet.
 *
 * Behaviour tests prove a query is correct; this one proves it will still be
 * correct when the table is large, which is a different question and is
 * answered by the plan rather than by the result. Every assertion below is
 * about what PostgreSQL decides to do, taken from `EXPLAIN` on seeded volume,
 * because a sequential scan that is fast on a hundred calls is an outage on a
 * million.
 *
 * The access paths here are unusual in one way worth naming. Almost every
 * question this domain asks is about a *live* call — which is a vanishing
 * fraction of the rows, because a call is an event and its history is kept
 * forever with no retention policy approved. So the indexes are partial on the
 * live states, and what these tests are really checking is that the planner
 * uses them rather than walking a history that grows without bound.
 *
 * The data is generated and disposable, and the volumes are the smallest that
 * make the planner choose the plan a real table would get.
 */

const databaseUrl = await provisionDatabase('velora_rtc_scale');
const database: TestDatabase = connectDatabase(databaseUrl);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

/** Finished calls, which is what a mature table is almost entirely made of. */
const seededFinishedCalls = 40_000;

/**
 * Live calls, which is what almost every question is about.
 *
 * Mostly `active`, with a handful stuck in the two states that have a deadline
 * — which is the shape a real platform has and, more to the point, the shape
 * the sweep assertions actually depend on.
 *
 * The first version of this suite seeded forty live calls evenly across four
 * states. That made the live-side indexes and the partial deadline index almost
 * the same size, so the planner's choice between them turned on cost
 * differences smaller than the variation between machines: twenty local runs
 * all chose the deadline index and the hosted runner chose a live-side index
 * and filtered. The test was asserting a preference under conditions where no
 * preference existed. Seeding a real disparity is what makes the assertion
 * about the index rather than about the hardware.
 */
const seededLiveCalls = 4_000;
/**
 * How many of those sit in a state a sweep has a deadline for.
 *
 * Split across all three: calls still ringing past their invitation deadline,
 * calls stuck connecting, and calls stuck reconnecting. Every sweep assertion
 * needs rows its query actually matches — a plan asserted for a query that
 * finds nothing is not evidence about that query.
 */
const seededStalledCalls = 30;
const seededIssuances = 20_000;

/**
 * The wire protocol carries at most 65,535 parameters per statement, so a batch
 * is bounded by columns as well as rows.
 *
 * Derived from the row rather than fixed at a constant: a call carries
 * twenty-one columns, and a batch size that was safe for a narrower table
 * fails here as a wire error that reads like a test defect. Deriving it means
 * adding a column changes the batch instead of breaking the suite.
 */
const maximumBoundParameters = 65_535;

async function insertInBatches(
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const columns = Object.keys(rows[0] ?? {}).length;
  const batch = Math.max(1, Math.floor(maximumBoundParameters / (columns + 1)));
  for (let start = 0; start < rows.length; start += batch) {
    await insertRows(database, table, rows.slice(start, start + batch));
  }
}

function uuidFor(prefix: string, index: number): string {
  const tail = index.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${tail}`;
}

/** The person every "one caller" question below is asked about. */
const busyCaller = uuidFor('11111111', 1);

/**
 * A history of finished calls, a handful of live ones, and a pile of issuances.
 *
 * Written straight to the tables rather than through the service: this suite is
 * about query plans on volume, and driving forty thousand calls through the
 * lifecycle would measure the harness.
 */
async function seed(): Promise<void> {
  const now = new Date();
  const calls: Record<string, unknown>[] = [];

  for (let index = 0; index < seededFinishedCalls; index += 1) {
    // Every twentieth call is the busy caller's, so the per-caller counters
    // have a realistic share to find rather than one row or all of them.
    const initiator =
      index % 20 === 0 ? busyCaller : uuidFor('11111111', index);
    const counterpart = uuidFor('22222222', index);
    const [low, high] =
      initiator < counterpart
        ? [initiator, counterpart]
        : [counterpart, initiator];
    const at = new Date(now.getTime() - index * 1_000);
    calls.push({
      accepted_at: at,
      authorization_generation: 2,
      created_at: at,
      end_reason: 'hung_up',
      ended_at: at,
      id: uuidFor('aaaaaaaa', index),
      initiator_id: initiator,
      invitation_expires_at: at,
      medium: 'voice',
      origin_introduction_id: uuidFor('bbbbbbbb', index),
      pair_high_id: high,
      pair_low_id: low,
      provider: 'local-test',
      provider_bound_at: at,
      provider_idempotency_key: `rtc-${uuidFor('aaaaaaaa', index)}`,
      provider_reference: uuidFor('cccccccc', index),
      state: 'ended',
      state_entered_at: at,
      updated_at: at,
    });
  }

  // Live calls: overwhelmingly `active`, with a few stuck in each state that
  // has a deadline. A sweep looking for the stalled ones must not pay for the
  // healthy ones, and that is only a meaningful question when the healthy ones
  // outnumber them.
  const stalledStates = ['invited', 'connecting', 'reconnecting'] as const;
  for (let index = 0; index < seededLiveCalls; index += 1) {
    const state: string =
      index < seededStalledCalls
        ? (stalledStates[index % stalledStates.length] ?? 'invited')
        : 'active';
    const initiator = uuidFor('33333333', index);
    const counterpart = uuidFor('44444444', index);
    const at = new Date(now.getTime() - 600_000);
    calls.push({
      // A ringing call has not been answered; everything else has.
      accepted_at: state === 'invited' ? null : at,
      authorization_generation: 1,
      created_at: at,
      end_reason: null,
      ended_at: null,
      id: uuidFor('eeeeeeee', index),
      initiator_id: initiator,
      invitation_expires_at: at,
      medium: 'voice',
      origin_introduction_id: uuidFor('ffffffff', index),
      pair_high_id: counterpart,
      pair_low_id: initiator,
      provider: null,
      provider_bound_at: null,
      provider_idempotency_key: null,
      provider_reference: null,
      state,
      state_entered_at: at,
      updated_at: at,
    });
  }
  await insertInBatches('realtime_sessions', calls);

  await insertInBatches(
    'realtime_join_issuances',
    Array.from({ length: seededIssuances }, (_unused, index) => {
      const at = new Date(now.getTime() - index * 1_000);
      return {
        authorization_generation: 1,
        expires_at: new Date(at.getTime() + 120_000),
        issued_at: at,
        session_id: uuidFor('aaaaaaaa', index),
        user_id: index % 20 === 0 ? busyCaller : uuidFor('11111111', index),
      };
    }),
  );

  await execute(database.sql`analyze realtime_sessions`);
  await execute(database.sql`analyze realtime_join_issuances`);
}

/** The plan PostgreSQL chose, as one string. */
async function planFor(query: unknown): Promise<string> {
  const rows = await rowsOf<Record<string, string>>(query);
  return rows.map((row) => Object.values(row).join(' ')).join('\n');
}

describe('a live call is found without walking the history', () => {
  it('finds the pair live call from the partial unique index', async () => {
    await seed();
    const low = uuidFor('33333333', 7);
    const high = uuidFor('44444444', 7);

    const plan = await planFor(
      database.sql`explain analyze
        select * from realtime_sessions
        where pair_low_id = ${low} and pair_high_id = ${high}
          and state in ('invited', 'accepted', 'connecting', 'active',
                        'reconnecting', 'ending')
        limit 1`,
    );

    // Index-driven on one of the live-partial indexes, so a history of forty
    // thousand finished calls between other people never enters the plan.
    //
    // Which of them is deliberately not pinned. Three indexes are partial on
    // the live states and any of them answers this in a couple of pages; the
    // planner picked the high-side one here, and an assertion naming the
    // composite would have been asserting a choice rather than a property. The
    // composite's real job is the uniqueness it enforces — one live call per
    // pair — which `rtc-lifecycle.test.ts` proves directly.
    expect(plan).toContain('Index Scan using realtime_sessions_live_');
    expect(plan).not.toContain('Seq Scan on realtime_sessions');
  });

  it('finds every live call one person is in from either side of the pair', async () => {
    await seed();
    const person = uuidFor('33333333', 11);

    const plan = await planFor(
      database.sql`explain analyze
        select * from realtime_sessions
        where (pair_low_id = ${person} or pair_high_id = ${person})
          and state in ('invited', 'accepted', 'connecting', 'active',
                        'reconnecting', 'ending')
        order by sequence
        limit 25`,
    );

    // Which side of the ordered pair somebody is on is an artefact of
    // identifier ordering, so enforcement against an account has to search
    // both — and both are indexed, partially, on the live states.
    expect(plan).toContain('realtime_sessions_live_low_idx');
    expect(plan).toContain('realtime_sessions_live_high_idx');
    expect(plan).not.toContain('Seq Scan on realtime_sessions');
  });
});

describe('the sweeps read a deadline rather than a table', () => {
  it('claims due invitations from the invitation-deadline index', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select * from realtime_sessions
        where state = 'invited' and invitation_expires_at <= now()
        order by sequence
        limit 100`,
    );

    expect(plan).toContain('realtime_sessions_invitation_deadline_idx');
    expect(plan).not.toContain('Seq Scan on realtime_sessions');
  });

  it('finds calls stuck connecting from the state-deadline index', async () => {
    await seed();
    const deadline = new Date(Date.now() - rtcJoinTimeoutMilliseconds);

    const plan = await planFor(
      database.sql`explain analyze
        select * from realtime_sessions
        where state = 'connecting' and state_entered_at <= ${deadline}
        order by state_entered_at
        limit 100`,
    );

    // Partial on exactly the two states that have a deadline, so a sweep that
    // runs every few seconds never touches a finished call.
    //
    // The index name is pinned here, unlike the pair lookup above, and
    // measurement is why. Dropping this index does not produce a sequential
    // scan — the planner falls back to another live-partial index and applies
    // the deadline as a filter, which reads every live call on every cycle. A
    // "no sequential scan" assertion alone would have passed through that
    // regression without noticing it.
    expect(plan).toContain('realtime_sessions_state_deadline_idx');
    expect(plan).not.toContain('Seq Scan on realtime_sessions');
  });

  it('finds calls stuck reconnecting from the same index', async () => {
    await seed();
    const deadline = new Date(Date.now() - rtcReconnectGraceMilliseconds);

    const plan = await planFor(
      database.sql`explain analyze
        select * from realtime_sessions
        where state = 'reconnecting' and state_entered_at <= ${deadline}
        order by state_entered_at
        limit 100`,
    );

    expect(plan).toContain('realtime_sessions_state_deadline_idx');
    expect(plan).not.toContain('Seq Scan on realtime_sessions');
  });
});

describe('the abuse counters do not read the history', () => {
  it('counts one person credentials from the user index', async () => {
    await seed();
    const since = new Date(Date.now() - rtcAbuseWindowMilliseconds);

    const plan = await planFor(
      database.sql`explain analyze
        select count(*)::text from realtime_join_issuances
        where user_id = ${busyCaller} and issued_at >= ${since}`,
    );

    // The index is on the person and the instant together, which is exactly
    // the question the bound asks. Without the instant in the index this would
    // read every credential that person has ever been issued.
    expect(plan).toContain('realtime_join_issuances_user_idx');
    expect(plan).not.toContain('Seq Scan on realtime_join_issuances');
  });

  it('counts one call credentials from the session index', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select count(*)::text from realtime_join_issuances
        where session_id = ${uuidFor('aaaaaaaa', 4_242)}`,
    );

    expect(plan).toContain('realtime_join_issuances_session_idx');
    expect(plan).not.toContain('Seq Scan on realtime_join_issuances');
  });
});

describe('what the platform owes is found without reading what it has done', () => {
  it('claims due obligations from the pending index', async () => {
    await seed();
    const now = new Date();
    await insertInBatches(
      'realtime_provider_obligations',
      Array.from({ length: 5_000 }, (_unused, index) => ({
        attempts: 0,
        available_at: new Date(now.getTime() - index * 1_000),
        created_at: now,
        discharged_at: index % 50 === 0 ? null : now,
        kind: 'terminate_session',
        provider: 'local-test',
        provider_reference: uuidFor('cccccccc', index),
        session_id: uuidFor('aaaaaaaa', index),
        state: index % 50 === 0 ? 'pending' : 'discharged',
        updated_at: now,
      })),
    );
    await execute(database.sql`analyze realtime_provider_obligations`);

    const plan = await planFor(
      database.sql`explain analyze
        select id from realtime_provider_obligations
        where state = 'pending' and available_at <= now()
          and (lease_expires_at is null or lease_expires_at <= now())
        order by id
        limit 20
        for update skip locked`,
    );

    // Almost every obligation a mature platform holds has been discharged, and
    // a drain that runs every five seconds must not read them to find the few
    // that have not.
    expect(plan).not.toContain('Seq Scan on realtime_provider_obligations');
  });
});

describe('the operator screen is bounded by what is live, not by what is kept', () => {
  it('counts calls by state without a per-row scan of the history', async () => {
    await seed();

    // Counting every state is genuinely a whole-table question and is allowed
    // to be: it runs when an operator opens a screen, not on a request path.
    // What it must not do is grow a per-call cost — the aggregate is one pass,
    // and this is the assertion that it stays one.
    const plan = await planFor(
      database.sql`explain analyze
        select count(*)::text, state from realtime_sessions group by state`,
    );
    expect(plan).not.toContain('Nested Loop');
  });

  it('finds ended calls with undischarged teardown by joining on the key', async () => {
    await seed();
    const now = new Date();
    await insertInBatches(
      'realtime_provider_obligations',
      Array.from({ length: 2_000 }, (_unused, index) => ({
        attempts: 0,
        available_at: now,
        created_at: now,
        kind: 'terminate_session',
        provider: 'local-test',
        provider_reference: uuidFor('cccccccc', index),
        session_id: uuidFor('aaaaaaaa', index),
        state: 'pending',
        updated_at: now,
      })),
    );
    await execute(database.sql`analyze realtime_provider_obligations`);

    const plan = await planFor(
      database.sql`explain analyze
        select count(*)::text
        from realtime_provider_obligations o
        join realtime_sessions s on s.id = o.session_id
        where o.state = 'pending' and s.ended_at is not null
          and s.state in ('ended', 'expired', 'rejected', 'cancelled', 'failed')`,
    );

    // The join is on the session's primary key, so the cost is bounded by how
    // much is owed rather than by how many calls have ever happened.
    expect(plan).toContain('realtime_sessions_pkey');
  });
});
