import { sql } from 'drizzle-orm';

import type { TransactionHandle } from './executor.js';

/**
 * Serializes concurrent decisions about one unordered pair of people.
 *
 * Several domains decide things about a pair — DISCOVERY whether they may be
 * introduced, MESSAGING whether a message may be sent, TRUST & SAFETY whether
 * they may interact at all — and every one of those decisions is "check that
 * nothing forbids this, then write". Row locks cannot serialize that on their
 * own: the thing being checked for is usually the *absence* of a row, and an
 * absent row has nothing to lock. Two transactions can therefore both read "no
 * block exists" and both commit, which is exactly the check-then-act gap a
 * safety decision must not have.
 *
 * A transaction-scoped advisory lock keyed on the pair closes it. Any
 * transaction that has already taken the lock and committed is visible to the
 * next one that takes it, and any transaction that wants it waits. The lock is
 * released when the transaction ends, whether it commits or rolls back, so a
 * pooled connection never carries one forward.
 *
 * **Ordering rule: take this before any row lock.** Every transaction that
 * needs both takes the pair lock first and the row lock second, so the lock
 * graph has no cycle and no pair of transactions can wait on each other.
 *
 * The key is a 64-bit hash of the ordered pair, so the same two people always
 * take the same lock whichever of them is acting. Two unrelated pairs can
 * collide on a key; that makes them serialize with each other for the length of
 * one short transaction, which is a throughput detail and never a correctness
 * one.
 *
 * Identifiers are lower-cased before they are ordered and hashed. Some of them
 * arrive in a request body, and a UUID is case-insensitive as a value but not
 * as a string: `A1B2…` and `a1b2…` are the same person to PostgreSQL's `uuid`
 * type and two different sort positions and two different hashes to this
 * function. Without normalization a caller could spell a counterpart's
 * identifier in upper case and take a *different* advisory lock for the same
 * pair, which would let a block and a signal about those two people run
 * concurrently — reopening the exact check-then-act gap this lock exists to
 * close. Normalizing here rather than at each boundary means no future call
 * site can forget.
 */
export function pairLockKey(first: string, second: string): string {
  const left = first.toLowerCase();
  const right = second.toLowerCase();
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

export async function lockPair(
  executor: TransactionHandle,
  first: string,
  second: string,
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${pairLockKey(first, second)}, 0))`,
  );
}
