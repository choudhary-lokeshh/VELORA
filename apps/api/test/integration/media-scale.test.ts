import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  mediaPurgeStallMilliseconds,
  mediaStallMilliseconds,
  mediaVerificationGraceMilliseconds,
} from '../../src/media/policy.js';
import {
  connectDatabase,
  execute,
  insertRows,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * The media platform's reads at a size nobody has yet.
 *
 * Every query here is correct at any volume. What this file measures is whether
 * it stays *cheap* at one the platform will reach — and the answer, before the
 * indexes and rewrites this suite locks in, was no for five of them. The worst
 * scanned every asset on the platform every sixty seconds.
 *
 * The plans are asserted rather than the timings. A duration is a property of
 * the machine that ran it; the index the planner chose is a property of the
 * schema, and it is the thing a later change can silently take away. That is
 * the whole reason this file exists: the fixes are cheap to make and invisible
 * to lose.
 *
 * Two of these assertions would have passed against the *old* code as well,
 * because a rewrite alone did not change the plan. The stall query needed both
 * a correlated anti-join and a narrow index leading on the lifecycle, and
 * either one on its own left it scanning. So each is asserted for what it
 * actually contributes rather than as a pair.
 *
 * Seeded directly rather than through the product. What is under test is the
 * shape of the read, and driving four hundred thousand assets through the
 * upload pipeline would measure sharp.
 */

const databaseUrl = await provisionDatabase('velora_media_scale');
const database: TestDatabase = connectDatabase(databaseUrl);

/**
 * Volumes chosen as the smallest that make the planner choose what a real table
 * would get. Larger seeds prove the same thing more slowly.
 */
const readyAssets = 40_000;
const openAssets = 20_000;
const abandonedAssets = 2_000;
/** One in fifty windows stranded with no capability, as a crash would leave. */
const strandedEvery = 50;
/**
 * A backlog, against a platform that has discharged forty thousand duties.
 *
 * Small on purpose, and that is the property under test rather than a saving:
 * what is owed at any moment is a tiny fraction of what has ever been done, so
 * a read that answers "what is still outstanding, and since when" from a
 * partial index costs the backlog and a read that does not costs the history.
 * A seed with no backlog in it would let both look identical.
 */
const owedDuties = 2_000;
const owedPurges = 2_000;
const openFindings = 500;
/** Assets the platform took on and has not finished, among the ones it has. */
const stalledAssets = 500;
/**
 * Findings are retained rather than tidied — "this asset's derivative went
 * missing twice last month" is an answer somebody will need — so the history
 * outgrows the backlog by orders of magnitude, and a read of what is still
 * outstanding must not pay for it.
 */
const resolvedFindings = 40_000;

function uuidFor(prefix: string, index: number): string {
  const tail = index.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${tail}`;
}

function objectKeyFor(assetId: string, index: number): string {
  return `media/${assetId}/original/${index.toString(16).padStart(32, '0')}`;
}

const epoch = Date.UTC(2026, 0, 1);
function iso(offsetMilliseconds: number): string {
  return new Date(epoch + offsetMilliseconds).toISOString();
}

/** Rows per statement, bounded by the wire protocol's parameter ceiling. */
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

/**
 * The plan PostgreSQL would choose if a sequential scan were not on the table.
 *
 * Used for the three operator aggregates and nowhere else, and the reason is
 * worth stating rather than hiding behind a helper name. At this suite's volume
 * a sequential scan genuinely *is* the cheaper plan for a grouped count, so
 * asserting that the planner avoids one would be asserting something false —
 * the index-only scan wins at production volume, and it was measured winning
 * there: 10,450 buffers against 349 at four hundred thousand assets.
 *
 * What can actually regress is the index being dropped, renamed, or narrowed so
 * that it no longer *covers* the aggregate. That is what this asks: with the
 * cheap option removed, can the planner answer this question from the index
 * alone? A covering index says yes with an index-only scan; a missing or
 * badly-shaped one falls back to a heap scan and the assertion fails.
 *
 * One connection for both statements, because a GUC set on a pooled connection
 * and read on another would silently prove nothing.
 */
async function coveringPlanFor(statement: string): Promise<string> {
  return database.sql.begin(async (connection: Bun.SQL) => {
    await execute(connection.unsafe('set local enable_seqscan = off'));
    const rows = await rowsOf<Record<string, string>>(
      connection.unsafe(statement),
    );
    return rows.map((row) => Object.values(row).join(' ')).join('\n');
  });
}

async function seed(): Promise<void> {
  await database.truncate();

  // Ready assets are the bulk of a real platform, and they are what makes the
  // difference between an index and a scan visible: a query interested in the
  // few in flight must not pay for the many that are finished.
  await seedRows(
    'media_assets',
    Array.from({ length: readyAssets }, (_unused, index) => ({
      asset_class: 'consumer_profile_image',
      byte_size: 1_000,
      created_at: iso(index * 1_000),
      detected_format: 'jpeg',
      digest: 'a'.repeat(64),
      frame_count: 1,
      height: 100,
      id: uuidFor('aaaaaaaa', index),
      idempotency_key: `ready-${String(index).padStart(8, '0')}`,
      lifecycle: 'ready',
      lifecycle_changed_at: iso(index * 1_000),
      owner_domain: 'users',
      owner_reference: uuidFor('cccccccc', index),
      ready_at: iso(index * 1_000),
      updated_at: iso(index * 1_000),
      width: 100,
    })),
  );

  // Uploads in flight, each with a live window. These are what the `not in`
  // form used to hash in full before it could reject a single candidate.
  await seedRows(
    'media_assets',
    Array.from({ length: openAssets }, (_unused, index) => ({
      asset_class: 'consumer_profile_image',
      created_at: iso(index * 1_000),
      id: uuidFor('bbbbbbbb', index),
      idempotency_key: `open-${String(index).padStart(8, '0')}`,
      lifecycle: 'awaiting_upload',
      lifecycle_changed_at: iso(index * 1_000),
      owner_domain: 'users',
      owner_reference: uuidFor('dddddddd', index),
      updated_at: iso(index * 1_000),
    })),
  );

  await seedRows(
    'media_upload_sessions',
    Array.from({ length: openAssets }, (_unused, index) => {
      const stranded = index % strandedEvery === 0;
      const assetId = uuidFor('bbbbbbbb', index);
      return {
        asset_id: assetId,
        attempt: 1,
        created_at: iso(index * 1_000),
        expires_at: iso(index * 1_000 + 900_000),
        id: uuidFor('eeeeeeee', index),
        maximum_bytes: 8_388_608,
        object_key: objectKeyFor(assetId, index),
        // A window that committed and never got a capability is the crash
        // window this platform records rather than hides.
        provider: stranded ? null : 'local-test',
        provider_reference: stranded ? null : 'local-test:x',
        state: 'issued',
        updated_at: iso(index * 1_000),
      };
    }),
  );

  // Reserved, never uploaded, and long past the technical TTL: what the
  // abandonment sweep is looking for, hiding behind everything above.
  await seedRows(
    'media_assets',
    Array.from({ length: abandonedAssets }, (_unused, index) => ({
      asset_class: 'consumer_profile_image',
      created_at: iso(-90 * 86_400_000),
      id: uuidFor('ffffffff', index),
      idempotency_key: `gone-${String(index).padStart(8, '0')}`,
      lifecycle: 'awaiting_upload',
      lifecycle_changed_at: iso(-90 * 86_400_000),
      owner_domain: 'users',
      owner_reference: uuidFor('9aaaaaaa', index),
      updated_at: iso(-90 * 86_400_000),
    })),
  );

  await seedRows(
    'media_objects',
    Array.from({ length: readyAssets }, (_unused, index) => {
      const assetId = uuidFor('aaaaaaaa', index);
      return {
        asset_id: assetId,
        byte_size: 1_000,
        created_at: iso(index * 1_000),
        digest: 'a'.repeat(64),
        format: 'jpeg',
        height: 100,
        id: uuidFor('1aaaaaaa', index),
        object_key: objectKeyFor(assetId, index),
        provider: 'local-test',
        role: 'original',
        state: 'present',
        updated_at: iso(index * 1_000),
        verified_at: iso(index * 1_000),
        width: 100,
      };
    }),
  );

  // Mostly discharged, as a platform that has been running accumulates. The
  // claim query must not pay for any of them.
  await seedRows(
    'media_obligations',
    Array.from({ length: readyAssets }, (_unused, index) => ({
      asset_id: uuidFor('aaaaaaaa', index),
      attempts: 0,
      available_at: iso(index * 1_000),
      completed_at: iso(index * 1_000),
      created_at: iso(index * 1_000),
      id: uuidFor('2aaaaaaa', index),
      kind: 'inspect',
      state: 'completed',
      updated_at: iso(index * 1_000),
    })),
  );

  // Work the platform took on and did not finish, sitting in a transient state
  // long enough for the sweep to call it a stall. Few, as they should be, and
  // hidden behind forty thousand finished ones.
  await seedRows(
    'media_assets',
    Array.from({ length: stalledAssets }, (_unused, index) => ({
      asset_class: 'consumer_profile_image',
      byte_size: 1_000,
      created_at: iso(-2 * 86_400_000),
      detected_format: 'jpeg',
      digest: 'a'.repeat(64),
      frame_count: 1,
      height: 100,
      id: uuidFor('5aaaaaaa', index),
      idempotency_key: `stuck-${String(index).padStart(8, '0')}`,
      lifecycle: 'processing',
      lifecycle_changed_at: iso(-2 * 86_400_000),
      owner_domain: 'users',
      owner_reference: uuidFor('8aaaaaaa', index),
      updated_at: iso(-2 * 86_400_000),
      width: 100,
    })),
  );

  // What is owed right now, hiding behind everything above. Kinds that address
  // the asset rather than one of its objects, one per asset, because the unique
  // partial index allows exactly one outstanding duty of a kind per asset.
  await seedRows(
    'media_obligations',
    Array.from({ length: owedDuties }, (_unused, index) => ({
      asset_id: uuidFor('aaaaaaaa', index),
      attempts: 0,
      available_at: iso(index * 1_000),
      created_at: iso(index * 1_000),
      id: uuidFor('3aaaaaaa', index),
      kind: index % 2 === 0 ? 'process' : 'reconcile',
      state: 'pending',
      updated_at: iso(index * 1_000),
    })),
  );

  // Purges asked for and never answered. The outcome column is what keeps them
  // visible, and the partial index is what keeps finding them cheap.
  await execute(
    database.sql.unsafe(
      `update media_objects set purge_requested_at = created_at
       where id in (select id from media_objects order by id limit ${String(owedPurges)})`,
    ),
  );

  // Disagreements, mostly closed. The few still outstanding are what an
  // operator is paged about, and the many resolved ones are the history that
  // must cost the question nothing.
  await seedRows(
    'media_drift_findings',
    Array.from(
      { length: openFindings + resolvedFindings },
      (_unused, index) => {
        const open = index < openFindings;
        const assetId = uuidFor('aaaaaaaa', index % readyAssets);
        return {
          asset_id: assetId,
          created_at: iso(index * 1_000),
          id: uuidFor('4aaaaaaa', index),
          kind: 'variant_missing',
          last_observed_at: iso(index * 1_000),
          object_key: objectKeyFor(assetId, index),
          occurrences: 1,
          resolution: open ? null : 'repaired',
          resolved_at: open ? null : iso(index * 1_000),
          updated_at: iso(index * 1_000),
        };
      },
    ),
  );

  for (const table of [
    'media_assets',
    'media_drift_findings',
    'media_objects',
    'media_obligations',
    'media_upload_sessions',
  ]) {
    await execute(database.sql.unsafe(`analyze ${table}`));
  }
}

/** The instants the sweeps compute, as this seed's clock sees them. */
const now = new Date(epoch + readyAssets * 1_000);
const stallBefore = new Date(now.getTime() - mediaStallMilliseconds);
const purgeBefore = new Date(now.getTime() - mediaPurgeStallMilliseconds);
const verifyBefore = new Date(
  now.getTime() - mediaVerificationGraceMilliseconds,
);
const abandonBefore = new Date(now.getTime() - 24 * 60 * 60_000);

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await database.close();
});

describe('the sweeps do not pay for the platform they run on', () => {
  it('finds stalled assets without scanning the ones that are finished', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select a.id from media_assets a
        where a.lifecycle in ('uploaded', 'inspecting')
          and a.lifecycle_changed_at <= ${stallBefore}
          and a.legal_hold_at is null
          and not exists (
            select 1 from media_obligations o
            where o.asset_id = a.id and o.kind = 'inspect' and o.state = 'pending')
          and not exists (
            select 1 from media_drift_findings f
            where f.asset_id = a.id and f.kind = 'stalled_lifecycle'
              and f.resolved_at is null)
        order by a.lifecycle_changed_at asc, a.id asc
        limit 25`,
    );

    // The narrow lifecycle index leads. Without it this query scanned every
    // asset on the platform every reconciliation cycle, and the anti-join
    // rewrite on its own did not change that — measured at ten thousand four
    // hundred and forty buffers before, six after.
    expect(plan).toContain('media_assets_lifecycle_idx');
    expect(plan).not.toContain('Seq Scan on media_assets');
    // And the anti-conditions are probes rather than a hash of every pending
    // obligation and every outstanding finding on the platform.
    expect(plan).not.toContain('Seq Scan on media_obligations');
    expect(plan).not.toContain('Seq Scan on media_drift_findings');
  });

  it('reclaims abandoned uploads without hashing every upload in flight', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select a.id from media_assets a
        where a.lifecycle in ('initiated', 'awaiting_upload')
          and a.lifecycle_changed_at <= ${abandonBefore}
          and not exists (
            select 1 from media_upload_sessions s
            where s.asset_id = a.id and s.state = 'issued')
        order by a.lifecycle_changed_at asc, a.id asc
        limit 100`,
    );

    // The partial transient index leads, and the open-window check is one
    // probe per candidate. As a `not in` subquery this built a hash of every
    // open window before it could reject one row, so the sweep's cost grew
    // with how many people were mid-upload.
    expect(plan).toContain('media_assets_transient_idx');
    expect(plan).toContain('media_upload_sessions_open_uk');
    expect(plan).not.toContain('Seq Scan on media_upload_sessions');
  });

  it('recovers stranded upload windows from an index of only the stranded', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id from media_upload_sessions
        where state = 'issued' and provider_reference is null
        order by created_at asc, id asc
        limit 100`,
    );

    expect(plan).toContain('media_upload_sessions_stranded_idx');
    expect(plan).not.toContain('Seq Scan on media_upload_sessions');
    // No sort at the page boundary: the index is already in the order the
    // sweep reads, so a backlog drains without re-sorting what it skipped.
    expect(plan).not.toContain('Sort Method');
  });

  it('walks the verification cursor in order rather than sorting it', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id from media_objects
        where verified_at <= ${verifyBefore}
        order by verified_at asc, id asc
        limit 25`,
    );

    expect(plan).toContain('media_objects_verification_idx');
    expect(plan).not.toContain('Seq Scan on media_objects');
    expect(plan).not.toContain('Sort Method');
  });

  it('finds a purge backlog from the partial index that holds only backlog', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id from media_objects
        where purge_requested_at is not null and purge_outcome is null
          and purge_requested_at <= ${purgeBefore}
        order by purge_requested_at asc, id asc
        limit 25`,
    );

    expect(plan).toContain('media_objects_purge_pending_idx');
    expect(plan).not.toContain('Seq Scan on media_objects');
  });
});

describe('claiming work costs nothing for the work already done', () => {
  it('claims obligations from the partial index, past every discharged row', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select id from media_obligations
        where kind = 'process' and state = 'pending' and available_at <= ${now}
          and (lease_expires_at is null or lease_expires_at <= ${now})
        order by sequence asc
        limit 25
        for update skip locked`,
    );

    // Forty thousand discharged obligations are in the table and none of them
    // is in this index. That is the whole reason it is partial on `pending`,
    // and it is why retaining a year of them costs the claim nothing.
    expect(plan).toContain('media_obligations_claimable_idx');
    expect(plan).not.toContain('Seq Scan on media_obligations');
    expect(plan).not.toContain('Sort Method');
  });
});

describe('the operator screen reads an index rather than the platform', () => {
  it('counts assets by lifecycle from the index alone', async () => {
    const plan = await coveringPlanFor(
      `explain analyze select count(*)::int, lifecycle from media_assets
       group by lifecycle order by lifecycle`,
    );

    // Index-only: the count is answered without visiting a single heap row.
    // Measured at four hundred thousand assets, this is ten thousand four
    // hundred and fifty buffers against three hundred and forty-nine, for an
    // index under three megabytes.
    expect(plan).toContain('media_assets_lifecycle_idx');
    expect(plan).toContain('Index Only Scan');
  });

  it('counts objects by role and state from the index alone', async () => {
    const plan = await coveringPlanFor(
      `explain analyze select count(*)::int, role, state from media_objects
       group by role, state order by role, state`,
    );

    expect(plan).toContain('media_objects_role_state_idx');
    expect(plan).toContain('Index Only Scan');
  });

  it('counts obligations by kind and state, discharged ones included', async () => {
    const plan = await coveringPlanFor(
      `explain analyze select count(*)::int, kind, state from media_obligations
       group by kind, state order by kind, state`,
    );

    // The claimable index cannot answer this and must not be expected to: it is
    // partial on `pending`, and the screen exists to show what was discharged
    // and what the platform gave up on. A covering index over every row is a
    // different question from a fast claim, and both are needed.
    expect(plan).toContain('media_obligations_kind_state_idx');
    expect(plan).toContain('Index Only Scan');
  });
});

describe('the backlog ages cost what is owed, not what has been done', () => {
  /**
   * Each of these is the query behind one class on the operator screen, and
   * each asks a partial index that holds only the outstanding rows. That is
   * the whole property: a platform with years of discharged work answers "how
   * long has the oldest one been waiting" from an index the size of the
   * backlog rather than of the history.
   */
  it('ages the purges nobody answered from the backlog index alone', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select count(*)::int,
               max(extract(epoch from (now() - purge_requested_at)))::int
        from media_objects
        where purge_requested_at is not null and purge_outcome is null`,
    );

    // Ninety-odd buffers for two thousand unanswered purges against forty
    // thousand objects: an object whose purge was answered leaves the partial
    // index and stops being paid for.
    //
    // The index is asserted and the *kind* of scan is not, deliberately.
    // Whether PostgreSQL can answer it index-only depends on the visibility map
    // and therefore on when the table was last vacuumed, which is a property of
    // the machine rather than of the schema — and a suite that asserted it
    // would fail for a reason no change caused.
    expect(plan).toContain('media_objects_purge_pending_idx');
    expect(plan).not.toContain('Seq Scan on media_objects');
  });

  it('ages the findings nobody closed from the open-findings index', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select count(*)::int,
               max(extract(epoch from (now() - created_at)))::int
        from media_drift_findings
        where resolved_at is null`,
    );

    // Five buffers for five hundred outstanding findings against forty thousand
    // five hundred rows. Findings are retained rather than tidied, so the
    // history is the thing this question must not be made to read.
    expect(plan).toContain('media_drift_findings_open_idx');
    expect(plan).not.toContain('Seq Scan on media_drift_findings');
  });

  it('ages owed duties without reading the ones already discharged', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select kind, count(*)::int,
               max(extract(epoch from (now() - created_at)))::int
        from media_obligations
        where state = 'pending'
        group by kind`,
    );

    // Forty-one buffers for two thousand outstanding duties against forty-two
    // thousand rows: the read is proportional to what is owed rather than to
    // what has ever been discharged.
    expect(plan).toContain('media_obligations_kind_state_idx');
    expect(plan).not.toContain('Seq Scan on media_obligations');
  });

  it('ages the assets still owed a move from the transient index', async () => {
    const plan = await planFor(
      database.sql`explain analyze
        select count(*)::int,
               max(extract(epoch from (now() - lifecycle_changed_at)))::int
        from media_assets
        where lifecycle in ('uploaded', 'inspecting', 'inspected', 'processing', 'deleting')`,
    );

    // The narrow lifecycle index leads, as it does for the stall sweep and the
    // operator's count — the third thing it earns its keep on. Twenty-one
    // buffers for five hundred assets in flight against sixty-two thousand.
    expect(plan).toContain('media_assets_lifecycle_idx');
    expect(plan).not.toContain('Seq Scan on media_assets');
  });
});

describe('media tables carry the indexes their access paths need', () => {
  it('has one index per hot path and no duplicate of one', async () => {
    const indexes = await rowsOf<{ indexname: string }>(
      database.sql`select indexname from pg_indexes
        where schemaname = 'public' and tablename like 'media_%'
        order by indexname`,
    );
    const names = indexes.map((row) => row.indexname);

    for (const required of [
      'media_assets_idempotency_uk',
      'media_assets_lifecycle_idx',
      'media_assets_owner_idx',
      'media_assets_transient_idx',
      'media_drift_findings_asset_idx',
      'media_drift_findings_asset_open_uk',
      'media_drift_findings_object_open_uk',
      'media_drift_findings_open_idx',
      'media_objects_asset_idx',
      'media_objects_object_key_uk',
      'media_objects_original_uk',
      'media_objects_purge_pending_idx',
      'media_objects_role_state_idx',
      'media_objects_variant_uk',
      'media_objects_verification_idx',
      'media_obligations_asset_idx',
      'media_obligations_asset_pending_uk',
      'media_obligations_claimable_idx',
      'media_obligations_kind_state_idx',
      'media_obligations_object_pending_uk',
      'media_obligations_sequence_uk',
      'media_upload_sessions_asset_idx',
      'media_upload_sessions_expiry_idx',
      'media_upload_sessions_object_key_uk',
      'media_upload_sessions_open_uk',
      'media_upload_sessions_stranded_idx',
      'media_upload_sessions_unreconciled_idx',
    ]) {
      expect(names, required).toContain(required);
    }

    // A composite leading with the same column as a narrow index would earn
    // nothing here and cost every write. The lifecycle index is narrow on
    // purpose — measured, the wider version was declined by the planner for
    // the aggregate and cost seven times the storage.
    expect(names).not.toContain('media_assets_lifecycle_changed_idx');
    expect(names).not.toContain('media_objects_role_idx');
  });
});
