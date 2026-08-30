import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A row and the lifecycle written on top of it must be timed by one clock.
 *
 * Nine tables carry a CHECK constraint ordering two of their own timestamps —
 * `ended_at >= created_at`, `accepted_at >= invited_at`, `recorded_at >=
 * decided_at` and their siblings. When an integration fixture creates such a
 * row from PostgreSQL's `now()` and the production path under test then writes
 * the later column from the application clock, the row is timed by two clocks
 * that are not the same clock. Under Docker on macOS they drift by a few
 * milliseconds, and a few milliseconds is all it takes.
 *
 * This has happened twice, and both times it presented as a product failure on
 * a commit that had not touched the product:
 *
 * - `a572ea1` — a billing lifecycle fixture, fixed.
 * - 2026-08-28 — `realtime_sessions`, where an 8.8 ms gap refused the write and
 *   turned the RTC suite and the operator console red together.
 *
 * It is invisible on an idle machine, which is why it reads as an unexplained
 * flake rather than as the same defect twice.
 *
 * **This is a ratchet, not an allowlist.** Thirty-eight of these writes remain,
 * and converting them all at once is a large mechanical change to suites that
 * currently pass — the kind that trades a rare flake for a fresh one. So the
 * count is recorded instead, and this fails when it goes up. Nothing new can
 * join the class, and every conversion lowers the number the next person has to
 * beat. Lower `remaining` when you convert one; there is no path that raises it.
 *
 * The conversion itself is three lines: take one `const stamp = now()` from the
 * clock the suite already declares, bind it wherever `now()` appeared, and
 * compute any relative instant in TypeScript — `${stamp} + interval '1 minute'`
 * looks right and is not, because an untyped parameter beside an interval
 * resolves to `interval + interval` and PostgreSQL refuses it against a
 * timestamptz column.
 */

/** Tables whose own timestamps are ordered against each other by a CHECK. */
const constrainedTables = [
  'discovery_presentations',
  'identity_attempts',
  'identity_evidence',
  'identity_provider_events',
  'identity_reconciliation_findings',
  'realtime_participants',
  'realtime_sessions',
  'safety_takedown_claims',
  'users_adult_declarations',
];

/**
 * What is left to convert, and the only direction this may move.
 *
 * Measured 2026-08-31, after `rtc-provider` (the observed failure) and
 * `rtc-authorization` were converted.
 */
const remaining = 38;

const suites = 'apps/api/test/integration';

/** A `database.sql` template's SQL, with every binding blanked out. */
function statementsOf(source) {
  return [...source.matchAll(/database\.sql`([^`]*)`/gsu)].map((match) =>
    // `${now()}` is the application clock and is the correct thing to bind; only
    // a bare `now()` in the SQL text is the database's.
    match[1].replaceAll(/\$\{[^{}]*\}/gu, '?'),
  );
}

const offenders = [];
for (const file of readdirSync(suites).filter((name) => name.endsWith('.ts'))) {
  const path = join(suites, file);
  for (const sql of statementsOf(readFileSync(path, 'utf8'))) {
    if (!/\bnow\(\)/u.test(sql)) continue;
    const table = constrainedTables.find((name) =>
      new RegExp(String.raw`\b(insert into|update)\s+${name}\b`, 'iu').test(
        sql,
      ),
    );
    if (table !== undefined) offenders.push({ path, table });
  }
}

if (offenders.length > remaining) {
  const added = offenders.length - remaining;
  process.stderr.write(
    `${String(added)} new fixture write(s) time a constrained row by the database clock while the code under test uses the application clock.\n` +
      `That is ${String(offenders.length)} against a recorded ${String(remaining)}, and this number may only go down.\n` +
      'Take one `const stamp = now()` from the clock the suite declares and bind it wherever `now()` appeared.\n' +
      'Tables affected in this run:\n',
  );
  const counted = new Map();
  for (const one of offenders) {
    counted.set(one.path, (counted.get(one.path) ?? 0) + 1);
  }
  for (const [path, count] of [...counted].sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`  ${String(count)}  ${path}\n`);
  }
  process.exit(1);
}

if (offenders.length < remaining) {
  process.stdout.write(
    `Cross-clock fixture writes are down to ${String(offenders.length)} from ${String(remaining)}. ` +
      'Lower `remaining` in scripts/check-fixture-clocks.mjs to hold the ground.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `One clock per lifecycle: ${String(offenders.length)} known cross-clock fixture writes, none added.\n`,
);
