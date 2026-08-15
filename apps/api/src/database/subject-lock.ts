import { sql } from 'drizzle-orm';

import type { TransactionHandle } from './executor.js';

/**
 * Serializes concurrent safety decisions about one subject.
 *
 * The pair lock in `pair-lock.ts` exists because two people interacting is a
 * decision about an unordered pair. This one exists for the other half of the
 * same problem: whether a subject is currently under enforcement is decided by
 * the *absence* of a live restricting record, and an absent row has nothing to
 * lock. Two transactions can each read "nothing restricts this creator" and
 * both commit — one publishing, one lifting, one imposing — which is the same
 * check-then-act gap, on a single subject rather than on a pair.
 *
 * A transaction-scoped advisory lock keyed on the subject closes it. Any
 * transaction that decides something about a subject's enforcement state takes
 * it first: imposing a restriction, lifting one, and any protected mutation
 * that is authorized by the absence of one. Because it is exclusive, an
 * enforcement and the mutation it should have prevented are never interleaved —
 * one commits entirely before the other begins its check — so the outcome of a
 * race is always a serial order and never a mutation authorized by a
 * transaction that had already been overtaken.
 *
 * The key is namespaced, so a subject key and a pair key cannot mean the same
 * lock. Identifiers are lower-cased for the reason the pair lock lower-cases
 * them: a UUID is case-insensitive to PostgreSQL's `uuid` type and not to
 * `hashtextextended`, so without normalization a caller could spell the same
 * subject two ways and take two different locks for one person.
 *
 * **Ordering rules.** Take this before any row lock, so the lock graph has no
 * cycle. Never take a pair lock and a subject lock in the same transaction:
 * the two orderings would form one, and no decision needs both — a pair
 * decision is about interaction and a subject decision is about standing.
 */
export function subjectLockKey(subjectId: string): string {
  return `safety:subject:${subjectId.toLowerCase()}`;
}

export async function lockSubject(
  executor: TransactionHandle,
  subjectId: string,
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${subjectLockKey(subjectId)}, 0))`,
  );
}
