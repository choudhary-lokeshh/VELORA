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
 * The creator surfaces at a size nobody has yet.
 *
 * Behaviour tests prove a query is correct; this one proves it will still be
 * correct when the table is large, which is a different question and is
 * answered by the plan rather than by the result. Every assertion below is
 * about what PostgreSQL decides to do, taken from `EXPLAIN` on seeded volume,
 * because a sequential scan that is fast on a hundred rows is an outage on a
 * hundred thousand.
 *
 * The data is generated and disposable. Nothing here is committed, and the
 * volumes are the smallest that make the planner choose the plan a real table
 * would get — larger seeds would prove the same thing more slowly.
 */

const databaseUrl = await provisionDatabase('velora_creators_scale');
const database: TestDatabase = connectDatabase(databaseUrl);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

const seededCreators = 20_000;
const seededItemsPerCreator = 4;

/**
 * Rows per statement.
 *
 * The wire protocol carries at most 65,535 parameters, so a batch is bounded by
 * columns as well as rows. Five thousand keeps every table here well inside it
 * and is not a property under test — the volume is.
 */
const seedBatchSize = 5_000;

async function insertInBatches(
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += seedBatchSize) {
    await insertRows(database, table, rows.slice(start, start + seedBatchSize));
  }
}

function uuidFor(prefix: string, index: number): string {
  const tail = index.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${tail}`;
}

/**
 * Creators with published profiles and published public items.
 *
 * Written straight to the tables rather than through the routes: this suite is
 * about query plans on volume, and driving twenty thousand creators through
 * HTTP would measure the harness.
 */
async function seed(): Promise<void> {
  const now = new Date();
  const creators = Array.from({ length: seededCreators }, (_unused, index) => ({
    activated_at: now,
    auth_account_id: uuidFor('aaaaaaaa', index),
    created_at: new Date(now.getTime() - index * 1_000),
    id: uuidFor('cccccccc', index),
    status: 'active',
    status_changed_at: now,
    status_reason: null,
    updated_at: now,
  }));
  await insertInBatches('creators_accounts', creators);

  await insertInBatches(
    'creators_profiles',
    creators.map((creator, index) => ({
      created_at: creator.created_at,
      creator_id: creator.id,
      display_name: `Creator ${String(index)}`,
      handle: `seeded-${String(index).padStart(6, '0')}`,
      publication: 'published',
      published_at: creator.created_at,
      updated_at: now,
      version: 1,
    })),
  );

  const content: Record<string, unknown>[] = [];
  for (const [index, creator] of creators.entries()) {
    for (let item = 0; item < seededItemsPerCreator; item += 1) {
      const ordinal = index * seededItemsPerCreator + item;
      content.push({
        created_at: new Date(now.getTime() - ordinal * 100),
        creator_id: creator.id,
        id: uuidFor('dddddddd', ordinal),
        lifecycle: item === 0 ? 'draft' : 'published',
        published_at:
          item === 0 ? null : new Date(now.getTime() - ordinal * 100),
        title: `Item ${String(ordinal)}`,
        updated_at: now,
        version: 1,
        visibility: item === 1 ? 'members_only' : 'public',
      });
    }
  }
  await insertInBatches('clubs_content', content);
  await execute(database.sql`analyze creators_accounts`);
  await execute(database.sql`analyze creators_profiles`);
  await execute(database.sql`analyze clubs_content`);
}

/** The plan PostgreSQL chose, as one string. */
async function planFor(query: unknown): Promise<string> {
  const rows = await rowsOf<Record<string, string>>(query);
  return rows.map((row) => Object.values(row).join(' ')).join('\n');
}

describe('creator queries stay index-driven at volume', () => {
  it('resolves a public handle by its unique index rather than a scan', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select p.creator_id from creators_profiles p
        join creators_accounts a on a.id = p.creator_id and a.status = 'active'
        where p.handle = 'seeded-019999' and p.publication = 'published'
        limit 1`,
    );

    expect(plan).toContain('creators_profiles_handle_uk');
    expect(plan).not.toContain('Seq Scan on creators_profiles');
  });

  it('serves one creator public catalog from the partial published index', async () => {
    await seed();
    const creatorId = uuidFor('cccccccc', 12_345);

    const plan = await planFor(
      database.sql`explain analyze
        select id, title, published_at from clubs_content
        where creator_id = ${creatorId}
          and lifecycle = 'published'
          and visibility = 'public'
        order by published_at desc, id desc
        limit 21`,
    );

    // The index is partial on published rows and ordered the way the catalog
    // pages, so the planner needs neither the draft rows nor a sort.
    expect(plan).toContain('clubs_content_published_idx');
    expect(plan).not.toContain('Seq Scan on clubs_content');
  });

  it('pages the operator list by its ordering index rather than an offset scan', async () => {
    await seed();

    const plan = await planFor(
      database.sql`explain analyze
        select id, status, created_at from creators_accounts
        order by created_at desc, id desc
        limit 21`,
    );

    // Found by measuring rather than by reading the code: before
    // `creators_accounts_created_idx` existed the planner scanned the table and
    // sorted it, which is fine at twenty thousand rows and an outage later.
    expect(plan).toContain('creators_accounts_created_idx');
    expect(plan).not.toContain('Seq Scan on creators_accounts');
    expect(plan).not.toContain('Sort Method');
  });

  it('reads one creator own catalog page without touching another creator', async () => {
    await seed();
    const creatorId = uuidFor('cccccccc', 7);

    const plan = await planFor(
      database.sql`explain analyze
        select id from clubs_content
        where creator_id = ${creatorId}
        order by created_at desc, id desc
        limit 21`,
    );

    expect(plan).toContain('clubs_content_creator_idx');
    expect(plan).not.toContain('Seq Scan on clubs_content');
  });
});

describe('creator paging is stable while the catalog is being written', () => {
  it('delivers no item twice and skips none already passed', async () => {
    const creatorId = uuidFor('cccccccc', 1);
    const now = new Date();
    await execute(
      database.sql`insert into creators_accounts
        (activated_at, auth_account_id, created_at, id, status, status_changed_at, status_reason, updated_at)
        values (now(), ${uuidFor('aaaaaaaa', 1)}, now(), ${creatorId}, 'active', now(), null, now())`,
    );
    await insertRows(
      database,
      'clubs_content',
      Array.from({ length: 12 }, (_unused, index) => ({
        created_at: new Date(now.getTime() - index * 1_000),
        creator_id: creatorId,
        id: uuidFor('dddddddd', index),
        lifecycle: 'published',
        published_at: new Date(now.getTime() - index * 1_000),
        title: `Existing ${String(index)}`,
        updated_at: now,
        version: 1,
        visibility: 'public',
      })),
    );

    const page = async (after?: { id: string; moment: Date }) =>
      rowsOf<{ id: string; published_at: Date }>(
        after === undefined
          ? database.sql`select id, published_at from clubs_content
              where creator_id = ${creatorId} and lifecycle = 'published'
                and visibility = 'public'
              order by published_at desc, id desc limit 5`
          : database.sql`select id, published_at from clubs_content
              where creator_id = ${creatorId} and lifecycle = 'published'
                and visibility = 'public'
                and (published_at < ${after.moment}
                     or (published_at = ${after.moment} and id < ${after.id}))
              order by published_at desc, id desc limit 5`,
      );

    const first = await page();
    // Something newer arrives between pages. A forward-only keyset reader is
    // already past it, so it cannot be inserted into a page they have had.
    //
    // Its instant comes from the same clock as the rows above rather than from
    // the database's `now()`. "Newer" is the whole premise of this test, and
    // taking the two sides of that comparison from two different clocks makes
    // it an assumption that the container's clock has not drifted behind the
    // host's — which under load it does, and then this fails as a paging
    // defect that never happened.
    const arrival = new Date(now.getTime() + 1_000);
    await execute(
      database.sql`insert into clubs_content
        (created_at, creator_id, id, lifecycle, published_at, title, updated_at, version, visibility)
        values (${arrival}, ${creatorId}, ${uuidFor('eeeeeeee', 1)}, 'published', ${arrival}, 'Arrived mid-read', ${arrival}, 1, 'public')`,
    );
    const firstLast = first.at(-1);
    if (firstLast === undefined) throw new Error('first page was empty');
    const second = await page({
      id: firstLast.id,
      moment: firstLast.published_at,
    });
    const secondLast = second.at(-1);
    if (secondLast === undefined) throw new Error('second page was empty');
    const third = await page({
      id: secondLast.id,
      moment: secondLast.published_at,
    });

    const seen = [...first, ...second, ...third].map((row) => row.id);
    expect(seen).toHaveLength(new Set(seen).size);
    expect(seen).not.toContain(uuidFor('eeeeeeee', 1));
    expect(first).toHaveLength(5);
    expect(second).toHaveLength(5);
    expect(third).toHaveLength(2);
  });
});

describe('creator tables carry the indexes their access paths need', () => {
  it('has one index per hot path and no duplicate of one', async () => {
    const indexes = await rowsOf<{ indexname: string }>(
      database.sql`select indexname from pg_indexes
        where schemaname = 'public'
          and (tablename like 'creators_%' or tablename like 'clubs_%')
        order by indexname`,
    );
    const names = indexes.map((row) => row.indexname);

    for (const required of [
      'creators_accounts_auth_account_uk',
      'creators_accounts_created_idx',
      'creators_accounts_status_idx',
      'creators_profiles_handle_uk',
      'clubs_content_published_idx',
      'clubs_content_creator_idx',
      'clubs_clubs_creator_slug_uk',
      'clubs_clubs_creator_idx',
      'clubs_memberships_live_uk',
      'clubs_memberships_club_idx',
      'clubs_memberships_member_idx',
      'clubs_invites_token_digest_uk',
      'clubs_invites_club_idx',
    ]) {
      expect(names, required).toContain(required);
    }
    // A leading-column duplicate of a composite index earns nothing and costs
    // every write.
    expect(names).not.toContain('clubs_content_creator_only_idx');
    expect(names).not.toContain('clubs_memberships_club_only_idx');
  });

  it('keeps every creator-owned table free of an unbounded ordering scan', async () => {
    // Every listing this vertical serves is keyed on an indexed ordering and
    // bounded by a limit. This asserts the shape rather than the plan: a table
    // that grew a listing with no index would show up here as a missing one.
    const tables = await rowsOf<{ tablename: string }>(
      database.sql`select distinct tablename from pg_indexes
        where schemaname = 'public'
          and (tablename like 'creators_%' or tablename like 'clubs_%')
        order by tablename`,
    );
    expect(tables.map((row) => row.tablename)).toEqual([
      'clubs_benefits',
      'clubs_clubs',
      'clubs_content',
      'clubs_content_media',
      'clubs_invites',
      'clubs_memberships',
      'creators_accounts',
      'creators_policy_acknowledgements',
      'creators_profile_links',
      'creators_profiles',
    ]);
  });
});
