import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMigrationConfig } from '@velora/config/server';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';

/**
 * The migration runner, and the three things it does around the migration.
 *
 * **It validates the journal first.** Drizzle's migrator compares one number —
 * the highest `created_at` already applied — against each migration's `when`,
 * and applies only those that are strictly greater. A single entry stamped
 * later than the ones after it therefore skips every later migration on any
 * database that has applied it, silently, with an exit code of zero. That
 * happened once in this repository. `pnpm db:journal:check` guards the same
 * property in CI; it is repeated here because CI guards a commit and this
 * guards a deployment, and the deployment is the one with a live database
 * behind it.
 *
 * **It holds an advisory lock.** Two deploys of the same release, a rollout
 * that starts a second replica before the first finishes, or a human running
 * this by hand during a deploy would otherwise apply schema changes
 * concurrently. PostgreSQL advisory locks are the right instrument: the key is
 * derived from a constant, the lock is held on the one connection this script
 * opens, and it is released when that connection closes — including when this
 * process is killed, which a lock table would not survive.
 *
 * **It verifies afterwards.** The number of applied migrations must equal the
 * number on disk. That is the assertion the journal defect defeated, and it is
 * the difference between "the migrator exited zero" and "the schema is the one
 * this build expects".
 */

const config = loadMigrationConfig(process.env);
const applicationRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationsFolder = resolve(applicationRoot, 'drizzle');

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

function readJournal(): readonly JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { readonly entries?: readonly JournalEntry[] };
  const { entries } = journal;
  if (entries === undefined || entries.length === 0) {
    throw new Error('Migration journal is empty or unreadable');
  }
  let previousWhen = -1;
  let previousIndex = -1;
  for (const entry of entries) {
    if (entry.idx <= previousIndex) {
      throw new Error(
        `Migration journal index went backwards at ${entry.tag}; refusing to migrate`,
      );
    }
    if (entry.when <= previousWhen) {
      throw new Error(
        `Migration ${entry.tag} is stamped no later than the one before it, so every migration after it would be skipped; refusing to migrate`,
      );
    }
    previousIndex = entry.idx;
    previousWhen = entry.when;
  }
  return entries;
}

/**
 * One deterministic 64-bit key, as the two 32-bit halves `pg_advisory_lock`
 * takes. Derived from a constant so every deployer of every release computes
 * the same one, and from a hash so it cannot collide with a key somebody picks
 * by hand later.
 */
function advisoryLockKey(): readonly [number, number] {
  const digest = createHash('sha256').update('velora:migrations').digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

const lockWaitMilliseconds = 120_000;
const lockPollMilliseconds = 500;

const entries = readJournal();
const [lockHigh, lockLow] = advisoryLockKey();
const client = new Bun.SQL(config.DATABASE_URL, {
  connectionTimeout: 5,
  max: 1,
});

try {
  const deadline = Date.now() + lockWaitMilliseconds;
  let held = false;
  for (;;) {
    const rows: readonly { readonly acquired: boolean }[] = await client`
      select pg_try_advisory_lock(${lockHigh}, ${lockLow}) as acquired
    `;
    held = rows[0]?.acquired === true;
    if (held) break;
    if (Date.now() >= deadline) {
      throw new Error(
        'Another migration is already running and did not finish within the wait; refusing to apply schema changes concurrently',
      );
    }
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, lockPollMilliseconds),
    );
  }

  await migrate(drizzle(client), { migrationsFolder });

  const applied: readonly { readonly total: number }[] = await client`
    select count(*)::int as total from drizzle.__drizzle_migrations
  `;
  const total = applied[0]?.total ?? 0;
  if (total !== entries.length) {
    throw new Error(
      `Migration verification failed: ${String(total)} applied, ${String(entries.length)} on disk. The database is not at the schema this build expects`,
    );
  }
  process.stdout.write(
    `Migrations applied and verified: ${String(total)} of ${String(entries.length)}.\n`,
  );
} finally {
  // Releasing explicitly rather than relying on the close, so a connection the
  // pool decides to keep cannot hold the lock past this process.
  await client`select pg_advisory_unlock(${lockHigh}, ${lockLow})`.catch(
    () => undefined,
  );
  await client.close();
}
