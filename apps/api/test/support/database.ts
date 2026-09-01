import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/bun-sql';

import type { AuthDatabase } from '../../src/auth/repository.js';

const applicationRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);

export function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for integration tests`);
  }
  return value;
}

/**
 * Domain integration tests run against their own database so the bootstrap
 * migration suite keeps its guarantee of starting from a genuinely empty one.
 */
export async function provisionDatabase(databaseName: string): Promise<string> {
  const administrative = requiredEnvironment('TEST_DATABASE_URL');
  const target = new URL(administrative);
  target.pathname = `/${databaseName}`;

  const sql = new Bun.SQL(administrative, { max: 1 });
  try {
    await sql.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await sql.unsafe(`create database "${databaseName}"`);
  } finally {
    await sql.close();
  }

  const migration = Bun.spawn(['bun', 'run', 'scripts/migrate-database.ts'], {
    cwd: applicationRoot,
    env: { ...Bun.env, DATABASE_URL: target.toString() },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    migration.exited,
    new Response(migration.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Migration failed: ${stderr}`);
  }
  return target.toString();
}

export interface TestDatabase {
  close(): Promise<void>;
  readonly drizzle: AuthDatabase;
  readonly sql: Bun.SQL;
  truncate(): Promise<void>;
  readonly url: string;
}

/**
 * Roots of every ownership tree the migrations create. `cascade` removes the
 * rows that reference them, so this list only ever needs a new entry when a
 * domain adds a table nothing else points at.
 */
/**
 * Roots a truncation starts from. Tables inside a domain follow by cascade;
 * DISCOVERY is listed explicitly because cross-domain references deliberately
 * carry no foreign key, so nothing cascades into it.
 */
const truncationRoots = [
  // AI has one FK from its append-only events to the durable run. Capability
  // activation and daily accounting have no cross-domain reference by design.
  'ai_run_events',
  'ai_runs',
  // Activation is immutable migration-owned release configuration. It is not
  // runtime test residue, and keeping it lets every freshly-truncated suite
  // exercise the same local/test gate the migration installed.
  'ai_usage_daily',
  'auth_accounts',
  'auth_recovery_rate_events',
  // BILLING's journal. Entries cascade from neither table — the composite
  // currency foreign keys carry `no action` so nothing can delete a posted
  // entry — so all three are listed, entries first.
  'billing_journal_entries',
  'billing_journal_transactions',
  'billing_journal_accounts',
  // Commercial records are retained rather than deleted, so nothing cascades
  // here either: both tables are listed, prices before the offers they name.
  'billing_outbox',
  'billing_provider_events',
  'billing_subscriptions',
  // Reversals reference a capture, and the capture is retained rather than
  // deletable, so both are listed explicitly ahead of the payments they name.
  'billing_disputes',
  'billing_refunds',
  'billing_gifts',
  'billing_payments',
  'billing_prices',
  'billing_offers',
  // PRIVATE CLUBS references a creator by opaque identifier with no foreign
  // key, so nothing cascades into its catalog either.
  'clubs_clubs',
  'clubs_content',
  // PAYOUTS' book and its records. Entries cascade from neither journal table
  // — the composite currency keys carry `no action` — so all three are listed,
  // entries first, and the domain's own records follow.
  'payouts_journal_entries',
  'payouts_journal_transactions',
  'payouts_journal_accounts',
  'payouts_instructions',
  'payouts_outbox',
  'payouts_recipients',
  // CREATORS holds no foreign key to AUTH or USERS by design, so nothing
  // cascades into it and it is listed as its own root.
  'creators_accounts',
  'discovery_introductions',
  'discovery_outbox',
  'discovery_passes',
  'discovery_presentations',
  // IDENTITY references owner domains only through opaque values, so its
  // storage is an independent ownership root. Evidence and attempts are
  // retained, and test reset uses TRUNCATE rather than row deletion.
  'identity_outbox',
  'identity_provider_events',
  'identity_reconciliation_findings',
  'identity_evidence',
  'identity_attempts',
  'identity_subjects',
  // MEDIA holds no foreign key to any other domain — an owner is an opaque
  // reference — so nothing cascades into it and the asset is its own root. Its
  // sessions, objects, and obligations follow by cascade.
  // LIVE references consumer accounts, the RTC session carrying an encounter,
  // and the introduction two people may have signalled by opaque identifier
  // with no foreign key, so nothing cascades into it and all three of its roots
  // are listed. Messages follow the encounter by cascade.
  'live_encounters',
  'live_invitations',
  'live_participations',
  'media_assets',
  'messaging_conversations',
  'messaging_outbox',
  'notifications_feed',
  'notifications_intents',
  // A preference references its owner by opaque identifier with no foreign
  // key, exactly as the intent does, so nothing cascades into it either.
  'notifications_preferences',
  'notifications_provider_events',
  'notifications_push_devices',
  // REALTIME references consumer accounts and the authorizing introduction by
  // opaque identifier with no foreign key, so nothing cascades into it and the
  // session is its own root. Participants and provider obligations follow by
  // cascade.
  'realtime_outbox',
  // Verified provider callbacks reference a room by the provider's own handle
  // rather than by a foreign key, so nothing cascades into them either.
  'realtime_provider_events',
  'realtime_sessions',
  'safety_blocks',
  // Cases are the parent of reports, evidence, and decisions, so truncating
  // them cascades. Listing the rest keeps the intent readable rather than
  // implicit. `truncate` fires no row triggers, so the append-only triggers on
  // these tables do not stand in the way of resetting a test database.
  'safety_cases',
  'safety_content_classifications',
  'safety_takedown_claims',
  'safety_appeals',
  'safety_decision_evidence',
  'safety_decisions',
  'safety_enforcements',
  'safety_evidence',
  'safety_reports',
  // Depicted-person evidence hangs off the declaration, so truncating that
  // cascades. All three are listed for the same reason the rest are.
  'safety_content_depictions',
  'safety_depicted_participants',
  'safety_consent_records',
  'users_accounts',
  // WALLET's coin books. Entries and acquisitions carry `no action` foreign
  // keys to the transaction they belong to — nothing may delete a posted entry
  // — so every table is listed, in the order that leaves no dangling
  // reference. The append-only triggers refuse UPDATE and DELETE and do not
  // fire on TRUNCATE, which is what lets a suite start from an empty ledger
  // without weakening the guarantee that made it append-only.
  'wallet_live_preference_entitlements',
  'wallet_acquisitions',
  'wallet_entries',
  'wallet_transactions',
  'wallet_accounts',
  'wallet_balances',
];

/**
 * The name a harness connection reports in `pg_stat_activity`.
 *
 * A suite that counts backends to prove the instance under test did not leak
 * one has to be able to tell the instance's connections from the observer's.
 * The harness pool opens connections lazily, so without this an extra
 * diagnostic query taken while the pool was busy would look exactly like a
 * connection the service failed to give back.
 */
export const testHarnessApplicationName = 'velora-test-harness';

/**
 * How long a truncation may wait for its locks before it reports who has them.
 *
 * Generous by design: every truncation this harness performs finishes in
 * milliseconds, so a wait this long means a connection is holding a
 * transaction open rather than that the statement is slow.
 */
const truncateLockTimeoutMs = 20_000;

/**
 * Who is holding the locks a truncation could not take.
 *
 * A stalled `beforeEach` is the least informative failure a suite can produce:
 * every later test fails on the same hook timeout and none of them says why.
 * This turns that into a sentence naming the backend, how long its transaction
 * has been open, and the statement it stopped on.
 */
async function lockHolders(sql: Bun.SQL): Promise<string> {
  try {
    // The driver types this as `any`; `rowsOf` is the one place this file
    // narrows such a result, so it is used here too.
    const rows = await rowsOf<{
      pid: number;
      query: string;
      state: string;
      transaction_seconds: number;
      wait_event_type: string;
    }>(
      sql.unsafe(`
      select pid,
             state,
             coalesce(extract(epoch from (now() - xact_start))::int, -1) as transaction_seconds,
             coalesce(wait_event_type, '') as wait_event_type,
             left(regexp_replace(coalesce(query, ''), '\\s+', ' ', 'g'), 200) as query
        from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
         and xact_start is not null
       order by xact_start
       limit 10
    `),
    );
    const described = rows.map(
      (row) =>
        `    pid ${String(row.pid)} ${row.state} for ${String(row.transaction_seconds)}s` +
        `${row.wait_event_type === '' ? '' : ` waiting on ${row.wait_event_type}`}: ${row.query}`,
    );
    return [
      `TRUNCATE could not take its locks within ${String(truncateLockTimeoutMs)}ms.`,
      'A connection is holding a transaction open against a database this suite owns.',
      described.length === 0
        ? '    (no other transaction was open when this was asked)'
        : described.join('\n'),
    ].join('\n');
  } catch (error) {
    return `TRUNCATE could not take its locks, and the holders could not be read: ${String(error)}`;
  }
}

export function connectDatabase(
  url: string,
  options: { readonly max?: number } = {},
): TestDatabase {
  // Sized above the peak concurrency these suites exercise, deliberately.
  //
  // A Bun.SQL pool that has to queue a caller for a connection while it is also
  // serving transactions and autocommit queries can lose one permanently to
  // `idle in transaction`, which stalls rather than fails. The race suites fire
  // sixteen simultaneous requests at a single pair, so a pool at or below that
  // has to queue and hangs — measured. Production solves this by bounding
  // in-flight work below the pool instead; see ADR-0019. A test harness has no
  // request admission to bound, so it buys the same guarantee with headroom.
  //
  // Bun runs every integration file in one process, so fifteen suites at twenty
  // connections need three hundred; `scripts/run-integration-tests.mjs` starts
  // PostgreSQL with headroom above that rather than leaving the ceiling to the
  // default hundred, where the same exhaustion appeared as an intermittent hang.
  const tagged = new URL(url);
  tagged.searchParams.set('application_name', testHarnessApplicationName);
  // Twenty by default, and raisable per suite. A suite that fires more
  // simultaneous transactions than the pool can serve does not fail: it queues,
  // and a queued caller competing with in-flight transactions is exactly the
  // shape that can strand a connection `idle in transaction` and stall. A media
  // suite driving fifty concurrent initiations needs headroom above its own
  // peak rather than a smaller test.
  const sql = new Bun.SQL(tagged.toString(), { max: options.max ?? 20 });
  return {
    async close() {
      await sql.close();
    },
    drizzle: drizzle(sql),
    sql,
    async truncate() {
      // Retried once on a deadlock, which PostgreSQL's own contract expects a
      // client to do rather than treat as a failure. `TRUNCATE` takes an
      // ACCESS EXCLUSIVE lock on every table in the list; a read still in
      // flight from the previous test holds a share lock on one of them and
      // wants another, and the two abort each other. Retrying resolves it
      // because the loser's statement is gone by the time the retry runs.
      //
      // Deliberately not a sleep, and deliberately bounded to one attempt: a
      // second deadlock would mean something genuinely concurrent is running
      // against a database a test believes it owns, and that should fail.
      for (let attempt = 0; ; attempt += 1) {
        try {
          // A bounded wait rather than an unbounded one, on one connection.
          //
          // Without the bound, a single connection left `idle in transaction`
          // by the previous test makes this statement wait forever: every test
          // after it fails on the same hook timeout, minutes apart, naming
          // nothing. The bound is far above any truncation this suite performs
          // — they complete in milliseconds — so it fires only when something
          // is genuinely holding a lock, and then it says who.
          //
          // Inside one transaction because `lock_timeout` is a session
          // setting: issued against the pool it can land on a different
          // connection than the truncation it was meant to bound, which leaves
          // the setting where nothing is truncating and the truncation itself
          // unbounded. `SET LOCAL` also expires with the transaction, so no
          // pooled connection carries it afterwards.
          await sql.begin(async (transaction: Bun.SQL) => {
            await transaction.unsafe(
              `set local lock_timeout = '${String(truncateLockTimeoutMs)}ms'`,
            );
            await transaction.unsafe(
              `truncate table ${truncationRoots.join(', ')} restart identity cascade`,
            );
          });
          return;
        } catch (error) {
          const code = (error as { errno?: string }).errno;
          // 55P03 is `lock_not_available`: somebody else holds a lock on a
          // table this suite believes it owns. Name them rather than retrying.
          if (code === '55P03') throw new Error(await lockHolders(sql));
          if (attempt >= 1 || code !== '40P01') throw error;
        }
      }
    },
    url,
  };
}

/**
 * Bun's SQL tag is typed as `any`. Tests narrow it here, once, so every call
 * site stays fully typed instead of spreading assertions through the suite.
 */
export async function rowsOf<Row>(result: unknown): Promise<Row[]> {
  return (await (result as Promise<unknown>)) as Row[];
}

export async function execute(result: unknown): Promise<void> {
  await (result as Promise<unknown>);
}

/**
 * Inserts many plain rows in one statement.
 *
 * Bun's SQL tag renders a JS array as a comma-joined scalar rather than a
 * PostgreSQL array, so the obvious `unnest` form silently produces a malformed
 * array literal. Its own helper builds a multi-row `VALUES` list correctly;
 * this wraps it once so seeding a realistic volume is a typed call rather than
 * a cast repeated at every site. Object keys are the column names.
 */
export async function insertRows(
  database: TestDatabase,
  table: string,
  rows: readonly Readonly<Record<string, unknown>>[],
): Promise<void> {
  if (rows.length === 0) return;
  const tag = database.sql as unknown as {
    (value: unknown): unknown;
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  };
  await tag`insert into ${tag(table)} ${tag(rows)}`;
}

/**
 * True when the database refused the statement.
 *
 * Constraint tests assert that an invariant is enforced by PostgreSQL rather
 * than by application code, so what matters is that the write did not happen;
 * the driver's error shape is not part of the invariant.
 */
export async function refused(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}
