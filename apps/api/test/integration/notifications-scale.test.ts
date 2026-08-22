import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  connectDatabase,
  execute,
  insertRows,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * Notification delivery at a size nobody has yet.
 *
 * Behaviour tests prove a query is correct; this one proves it will still be
 * correct when the table is large, which is a different question and is
 * answered by the plan rather than by the result. A sequential scan that is
 * fast on a hundred notices is an outage on ten million.
 *
 * The access paths here share one shape worth naming. Almost every question
 * this domain asks is about a *small live set inside a large dead history*:
 * notices still owed among all notices ever sent, registrations still live
 * among every device that ever registered, provider events not yet applied
 * among every event ever received. Nothing here has an approved retention
 * duration, so the history side grows without bound. The indexes are therefore
 * partial on the live states, and what these tests check is that the planner
 * uses them rather than walking the history.
 *
 * The seeded disparity is deliberate and the reason the assertions mean
 * anything: with a live fraction anywhere near the dead one, the planner would
 * reasonably choose a sequential scan and a passing test would be measuring the
 * seed rather than the index.
 */

const databaseUrl = await provisionDatabase('velora_notifications_scale');
const database: TestDatabase = connectDatabase(databaseUrl);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

/** Settled notices, which is what a mature table is almost entirely made of. */
const seededSettledNotices = 40_000;
/** Still owed, which is what the delivery worker's only hot query is about. */
const seededOwedNotices = 40;
const seededRetiredDevices = 20_000;
const seededLiveDevices = 20;
const seededAppliedEvents = 20_000;
const seededWaitingEvents = 20;
/** One person's feed, large enough that paging it has to use the index. */
const seededFeedRows = 30_000;

const reader = '11111111-1111-4111-8111-111111111111';

function uuidFor(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

/**
 * The wire protocol carries at most 65,535 parameters per statement, so a batch
 * is bounded by columns as well as by rows.
 *
 * Derived from the row rather than fixed at a constant: adding a column then
 * changes the batch instead of breaking the suite with a wire error that reads
 * like a test defect. The first version of this suite inserted forty thousand
 * notices in one statement and failed exactly that way.
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

async function planFor(query: unknown): Promise<string> {
  const rows = await rowsOf<Record<string, string>>(query);
  return rows.map((row) => Object.values(row).join(' ')).join('\n');
}

async function seed(): Promise<void> {
  const settled = Array.from({ length: seededSettledNotices }, (_, index) => ({
    attempts: 1,
    channel: 'push',
    created_at: new Date(Date.now() - index * 1_000),
    delivered_at: new Date(Date.now() - index * 1_000),
    expires_at: new Date(Date.now() + 86_400_000),
    id: uuidFor('aaaaaaaa', index),
    next_attempt_at: new Date(Date.now() - index * 1_000),
    payload: '{}',
    purpose: 'transactional',
    recipient_id: uuidFor('55555555', index % 500),
    source_event_id: uuidFor('66666666', index),
    source_producer: 'messaging',
    state: 'delivered',
    subject_id: uuidFor('77777777', index % 500),
    template_key: 'messaging.message.received.v1',
    updated_at: new Date(),
  }));
  const owed = Array.from({ length: seededOwedNotices }, (_, index) => ({
    attempts: 0,
    channel: 'push',
    created_at: new Date(Date.now() - index * 1_000),
    expires_at: new Date(Date.now() + 86_400_000),
    id: uuidFor('bbbbbbbb', index),
    next_attempt_at: new Date(Date.now() - 60_000),
    payload: '{}',
    purpose: 'transactional',
    recipient_id: uuidFor('88888888', index),
    source_event_id: uuidFor('99999999', index),
    source_producer: 'messaging',
    state: 'queued',
    subject_id: uuidFor('aaaaaaab', index),
    template_key: 'messaging.message.received.v1',
    updated_at: new Date(),
  }));
  await insertInBatches('notifications_intents', [...settled, ...owed]);

  const feed = Array.from({ length: seededFeedRows }, (_, index) => ({
    conversation_id: uuidFor('cccccccc', index),
    created_at: new Date(Date.now() - index * 1_000),
    id: uuidFor('dddddddd', index),
    kind: 'message_received',
    recipient_id: reader,
    source_event_id: uuidFor('eeeeeeee', index),
    subject_id: uuidFor('ffffffff', index % 400),
    template_key: 'messaging.message.received.v1',
  }));
  await insertInBatches('notifications_feed', feed);

  const retired = Array.from({ length: seededRetiredDevices }, (_, index) => ({
    created_at: new Date(Date.now() - index * 1_000),
    disable_reason: 'token_rotated',
    disabled_at: new Date(),
    id: uuidFor('11111112', index),
    installation_id: `retired-device-${String(index)}`,
    last_seen_at: new Date(),
    platform: 'ios',
    recipient_id: uuidFor('22222223', index % 500),
    token_fingerprint: index.toString(16).padStart(64, '0'),
  }));
  const live = Array.from({ length: seededLiveDevices }, (_, index) => ({
    created_at: new Date(),
    id: uuidFor('33333334', index),
    installation_id: `live-device-${String(index)}`,
    last_seen_at: new Date(),
    platform: 'ios',
    recipient_id: uuidFor('44444445', index),
    token_fingerprint: (index + 1_000_000).toString(16).padStart(64, '0'),
  }));
  await insertInBatches('notifications_push_devices', [...retired, ...live]);

  const applied = Array.from({ length: seededAppliedEvents }, (_, index) => ({
    attempts: 1,
    available_at: new Date(Date.now() - index * 1_000),
    feedback_type: 'delivered',
    id: uuidFor('55555556', index),
    occurred_at: new Date(),
    payload_digest: index.toString(16).padStart(64, '0'),
    processed_at: new Date(),
    provider: 'local-test',
    provider_account: 'account-1',
    provider_environment: 'local-test',
    provider_event_id: `applied-${String(index)}`,
    received_at: new Date(Date.now() - index * 1_000),
    state: 'processed',
  }));
  const waiting = Array.from({ length: seededWaitingEvents }, (_, index) => ({
    attempts: 0,
    available_at: new Date(Date.now() - 60_000),
    feedback_type: 'token_invalid',
    id: uuidFor('66666667', index),
    occurred_at: new Date(),
    payload_digest: (index + 2_000_000).toString(16).padStart(64, '0'),
    provider: 'local-test',
    provider_account: 'account-1',
    provider_environment: 'local-test',
    provider_event_id: `waiting-${String(index)}`,
    received_at: new Date(Date.now() - 60_000),
    state: 'received',
  }));
  await insertInBatches('notifications_provider_events', [
    ...applied,
    ...waiting,
  ]);

  await execute(database.sql`analyze notifications_intents`);
  await execute(database.sql`analyze notifications_feed`);
  await execute(database.sql`analyze notifications_push_devices`);
  await execute(database.sql`analyze notifications_provider_events`);
}

describe('owed work is found without walking the history', () => {
  it('reads what is due from the partial index, not the whole table', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select * from notifications_intents
        where state in ('queued', 'attempted') and next_attempt_at <= now()
        order by next_attempt_at, created_at
        limit 50`,
    );

    // The delivery worker's only hot query. Forty owed rows inside forty
    // thousand settled ones is the shape a real table has, and walking the
    // settled side to find them is the outage this index exists to prevent.
    expect(plan).toContain('notifications_intents_due_idx');
    expect(plan).not.toContain('Seq Scan on notifications_intents');
  });

  it('finds provider events waiting to be applied by their partial index', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select * from notifications_provider_events
        where state in ('received', 'retry_wait') and available_at <= now()
        order by available_at, id
        limit 50`,
    );

    expect(plan).toContain('notifications_provider_events_claimable_idx');
    expect(plan).not.toContain('Seq Scan on notifications_provider_events');
  });
});

describe('a live registration is found without walking every device ever seen', () => {
  it('reads a person’s live devices from the partial index', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select * from notifications_push_devices
        where recipient_id = ${uuidFor('44444445', 3)}
          and disabled_at is null`,
    );

    // Asked on every push delivery, so it runs as often as notices are sent.
    expect(plan).toContain('notifications_push_devices_recipient_idx');
    expect(plan).not.toContain('Seq Scan on notifications_push_devices');
  });

  it('recognises a token already registered from its partial unique index', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select * from notifications_push_devices
        where token_fingerprint = ${(1_000_003).toString(16).padStart(64, '0')}
          and disabled_at is null`,
    );

    expect(plan).toContain('notifications_push_devices_token_uk');
  });
});

describe('one person’s feed pages without scanning everybody’s', () => {
  it('reads the newest page from the keyset index', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select * from notifications_feed
        where recipient_id = ${reader}
        order by created_at desc, id desc
        limit 20`,
    );

    // Keyset paging over immutable columns, so a page boundary cannot move
    // under a reader and no offset grows with the history.
    expect(plan).toContain('notifications_feed_recipient_idx');
    expect(plan).not.toContain('Seq Scan on notifications_feed');
  });

  it('resumes from a cursor without an offset', async () => {
    await seed();
    const anchor = new Date(Date.now() - 10_000 * 1_000);

    const plan = await planFor(
      database.sql`explain analyze
        select * from notifications_feed
        where recipient_id = ${reader}
          and (created_at, id) < (${anchor}, ${uuidFor('dddddddd', 10_000)})
        order by created_at desc, id desc
        limit 20`,
    );

    expect(plan).toContain('notifications_feed_recipient_idx');
    // An OFFSET deep in a large feed reads and discards everything before it.
    expect(plan).not.toContain('Seq Scan on notifications_feed');
  });
});

describe('a preference is read by its key', () => {
  it('answers the delivery-time question from the primary key', async () => {
    await seed();
    await insertInBatches(
      'notifications_preferences',
      Array.from({ length: 5_000 }, (_, index) => ({
        category: 'direct_message',
        channel: 'push',
        created_at: new Date(),
        enabled: index % 2 === 0,
        recipient_id: uuidFor('77777778', index),
        updated_at: new Date(),
      })),
    );
    await execute(database.sql`analyze notifications_preferences`);

    const plan = await planFor(
      database.sql`explain analyze
        select enabled from notifications_preferences
        where recipient_id = ${uuidFor('77777778', 42)}
          and category = 'direct_message' and channel = 'push'`,
    );

    // Asked inside the claiming transaction on every delivery, so it is on the
    // hot path and the primary key is expected to answer the whole query.
    expect(plan).toContain('notifications_preferences_pk');
  });
});
