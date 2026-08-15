import { cursorSchema } from '@velora/validation';

/**
 * Commercial paging positions.
 *
 * Owned here rather than shared, on the convention every other domain follows:
 * a cursor encodes a position in one domain's ordering, and a shared codec
 * would quietly couple two orderings that are free to change independently.
 *
 * Not a credential and not signed, for the same reason recorded in the
 * discovery, messaging, and catalog cursors: what a caller may see is decided by
 * the query on every page, and the acting creator comes from the session rather
 * than from the cursor. The worst a tampered value can do is move a reader to a
 * different position in a list they were already entitled to read.
 */

function decodeJson(value: string): unknown {
  if (!cursorSchema.safeParse(value).success) return undefined;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * A position in a list ordered by creation instant, newest first, with the
 * identifier breaking ties.
 *
 * Keyset rather than offset, and keyed on a value that never moves once
 * written, so a page boundary cannot shift under a reader part-way through.
 */
export interface OfferCursor {
  readonly id: string;
  readonly moment: Date;
}

export function encodeOfferCursor(cursor: OfferCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.moment.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeOfferCursor(value: string): OfferCursor | undefined {
  const decoded = decodeJson(value);
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { i: id, t: moment } = decoded as {
    readonly i?: unknown;
    readonly t?: unknown;
  };
  if (typeof id !== 'string' || !uuidPattern.test(id)) return undefined;
  if (typeof moment !== 'string') return undefined;
  const instant = new Date(moment);
  if (Number.isNaN(instant.getTime())) return undefined;
  return { id, moment: instant };
}
