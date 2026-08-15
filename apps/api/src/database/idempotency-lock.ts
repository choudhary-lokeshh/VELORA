import { sql } from 'drizzle-orm';

import type { TransactionHandle } from './executor.js';

/**
 * Serializes the establishment of one idempotent operation.
 *
 * Every money table that records an instruction carries two unique indexes over
 * the same fact: the caller's identity for the operation — the consumer, the
 * thing being bought, and the key they sent — and the platform-generated
 * provider key derived from exactly those columns. Both describe "one
 * instruction, once", and both are wanted: the first is what a replay resolves
 * against, the second is the invariant that Velora never sends two different
 * instructions under one provider key.
 *
 * `on conflict … do nothing` arbitrates *one* index. PostgreSQL checks the
 * named one, and when it finds a conflicting row it skips the insert without
 * touching the others — which is why a duplicate that is already committed
 * resolves cleanly. Two transactions inserting the same identity at the same
 * moment are the case it does not cover: both pass the arbiter's check before
 * either has an index entry the other can see, and the loser then inserts into
 * the *unarbitrated* provider-key index, where a duplicate is not skipped but
 * raised as `23505`. That surfaces as a failed request for what is only a
 * double submission, and it appears exactly when the machine is busy enough for
 * two callers to interleave inside that window.
 *
 * A transaction-scoped advisory lock closes it. One caller establishes the
 * operation and commits; the next takes the lock only after that commit and
 * reads the operation that now exists, so the second insert never happens and
 * neither index is ever contended. The lock is released when the transaction
 * ends, commit or rollback, so a pooled connection never carries one forward.
 *
 * **Ordering rule: take this before any row lock**, the same rule
 * [`lockPair`](./pair-lock.ts) states, so the two locks compose and the wait
 * graph stays acyclic.
 *
 * Keys are namespaced by their table because two domains may legitimately hand
 * out the same identity string, and the hash is 64-bit: two unrelated
 * operations can collide on it and serialize with each other for the length of
 * one short transaction, which is a throughput detail and never a correctness
 * one.
 */
export async function lockIdempotentOperation(
  executor: TransactionHandle,
  namespace: string,
  ...identity: readonly string[]
): Promise<void> {
  // Lower-cased for the same reason `pairLockKey` does it: a UUID is one value
  // to PostgreSQL and two different strings to a hash function, and an
  // identifier that reaches here from a request body may be spelled either way.
  const key = [namespace, ...identity]
    .map((part) => part.toLowerCase())
    .join(' ');
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
