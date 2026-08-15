import { sql } from 'drizzle-orm';

import type { TransactionHandle } from '../database/executor.js';

/**
 * Serializes every transaction that moves one creator's payout position.
 *
 * Four things write it, and they arrive from different directions: a payout
 * being reserved, one settling, one being released, and BILLING reversing a
 * sale whose share was already accrued. None of them reads another's intent,
 * and the last does not even originate here — it arrives as a published fact
 * that the relay applies.
 *
 * The database refuses to leave a creator overdrawn, but that refusal is a
 * deferred constraint trigger, which is a *check at commit* rather than a lock.
 * Under `READ COMMITTED` two transactions that each debit the same position
 * cannot see the other's uncommitted entries, so each computes a balance that
 * is fine on its own and both commit — and the position ends up overdrawn by
 * exactly the amount the trigger existed to prevent. A payout paid out while a
 * reversal takes the same money back is that race, and it costs real money.
 *
 * This closes it the way `lockPair` closes the equivalent gap for a pair of
 * people: the balance being checked is a *sum over rows*, and a sum has nothing
 * to lock. Taking a transaction-scoped advisory lock on the creator does, and
 * the next writer reads the balance the previous one committed.
 *
 * **Ordering rule: take this before any row lock**, the same rule `lockPair`
 * states, so a transaction that also takes the recipient row keeps the wait
 * graph acyclic.
 */
export async function lockCreatorPosition(
  executor: TransactionHandle,
  creatorId: string,
): Promise<void> {
  // Lower-cased for `lockPair`'s reason: a UUID is one value to PostgreSQL and
  // two different strings to a hash function.
  const key = `payouts_creator_position ${creatorId.toLowerCase()}`;
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
