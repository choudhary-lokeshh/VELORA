import { cursorSchema } from '@velora/validation';

/**
 * A position in somebody's own coin history.
 *
 * Owned here rather than shared, on the convention every other domain follows:
 * a cursor encodes a position in one domain's ordering, and a shared codec
 * would quietly couple two orderings that are free to change independently.
 *
 * It carries a ledger sequence number and nothing else — no account, no
 * balance, and no identity. That matters twice over: a cursor is a value a
 * client holds and may show anybody, and this one says nothing about whose
 * history it is a position in. The acting account comes from the session, so
 * the worst a tampered value can do is move a reader to a different position in
 * a list that was already theirs to read.
 *
 * Not signed, for the same reason recorded in the discovery, messaging, and
 * commercial cursors: what a caller may see is decided by the query on every
 * page rather than by the cursor.
 */
export function encodeActivityCursor(sequence: number): string {
  return Buffer.from(JSON.stringify({ s: sequence }), 'utf8').toString(
    'base64url',
  );
}

export function decodeActivityCursor(value: string): number | undefined {
  if (!cursorSchema.safeParse(value).success) return undefined;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (typeof decoded !== 'object' || decoded === null) return undefined;
    const sequence = (decoded as { s?: unknown }).s;
    // A whole positive number, because a sequence is one. Anything else is a
    // value this domain did not issue, and the route refuses rather than
    // quietly starting again from the top.
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence)) {
      return undefined;
    }
    return sequence > 0 ? sequence : undefined;
  } catch {
    return undefined;
  }
}
