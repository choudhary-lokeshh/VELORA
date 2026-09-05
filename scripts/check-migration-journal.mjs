import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The migration journal gate.
 *
 * Drizzle's migrator does not compare the set of applied migrations against the
 * set on disk. It reads one row — the highest `created_at` in
 * `drizzle.__drizzle_migrations` — and applies a migration only when the
 * journal's `when` for it is strictly greater:
 *
 *   if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
 *
 * So a single migration stamped with a `when` later than the ones that follow
 * it poisons every database that has applied it. Every later migration is
 * skipped, forever, with no error and an exit code of zero. `pnpm db:migrate`
 * prints nothing and succeeds, the tables are simply not there, and the first
 * symptom is a route answering 500 in an environment somebody upgraded.
 *
 * It cannot be caught by any test: every suite in this repository provisions an
 * empty database, and on an empty database drizzle applies the whole folder in
 * order regardless of what the timestamps say. Only a long-lived database — a
 * developer's, and one day a deployed one — is affected, which is precisely the
 * kind that matters most.
 *
 * This asserts the three properties the migrator depends on: one journal entry
 * per SQL file, indexes that match file order, and `when` values that strictly
 * increase. It reads files and compares numbers, so it needs no database and
 * runs in milliseconds.
 */

const migrationsFolder = 'apps/api/drizzle';
const journalFile = join(migrationsFolder, 'meta/_journal.json');

const journal = JSON.parse(readFileSync(journalFile, 'utf8'));
const entries = journal.entries ?? [];
const failures = [];

const files = readdirSync(migrationsFolder)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length !== entries.length) {
  failures.push(
    `the journal has ${String(entries.length)} entries and the folder has ${String(files.length)} .sql files`,
  );
}

const tags = new Set(entries.map((entry) => entry.tag));
for (const file of files) {
  const tag = file.replace(/\.sql$/u, '');
  if (!tags.has(tag)) {
    failures.push(`${file} has no journal entry, so it will never be applied`);
  }
}

let previousWhen = -1;
let previousIndex = -1;
for (const [position, entry] of entries.entries()) {
  const name = `${String(entry.idx)}_${String(entry.tag)}`;

  // The file order is the order a person reads, and drizzle applies the journal
  // in array order. Those two agreeing is what makes the numbered prefix mean
  // anything at all.
  if (entry.idx !== position) {
    failures.push(
      `${name}: journal position ${String(position)} does not match its index`,
    );
  }
  if (entry.idx <= previousIndex) {
    failures.push(`${name}: index does not increase`);
  }
  previousIndex = entry.idx;

  // The one that matters. Equal is a failure as well as smaller: two migrations
  // sharing a `when` means whichever drizzle recorded first blocks the other.
  if (entry.when <= previousWhen) {
    failures.push(
      `${name}: when=${String(entry.when)} is not after the previous migration's ${String(previousWhen)}. ` +
        'Drizzle applies a migration only when its `when` is greater than the highest already recorded, ' +
        'so every migration from here on would be silently skipped on any database that has applied this one.',
    );
  }
  previousWhen = entry.when;

  if (!Number.isSafeInteger(entry.when) || entry.when <= 0) {
    failures.push(`${name}: when is not a millisecond timestamp`);
  }
}

if (failures.length > 0) {
  console.error('Migration journal check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nA journal timestamp is bookkeeping, not history. Correcting one changes no SQL,\n' +
      'and a database that already recorded the wrong value is repaired by the procedure in\n' +
      'docs/engineering/02-data-migrations.md.',
  );
  process.exitCode = 1;
} else {
  console.log(
    `Migration journal passed: ${String(entries.length)} migrations, indexes and timestamps strictly increasing.`,
  );
}
