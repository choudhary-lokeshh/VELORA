import { cursorSchema } from '@velora/validation';

/**
 * Catalog paging positions.
 *
 * Neither cursor is a credential and neither is signed, on the same reasoning
 * the discovery and messaging cursors record: what a caller may see is decided
 * by the query on every page, so the worst a tampered value can do is move a
 * reader to a different position in a list they were already entitled to read.
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
 * A position in a list ordered by one instant, newest first, with the item
 * identifier breaking ties.
 *
 * Keyset rather than offset, and keyed on a value that does not move once it is
 * set: an item's publication instant is written when it is published and never
 * rewritten, so a page boundary cannot shift under a reader who is part-way
 * through. That is the difference between "no duplicate rows across pages" as a
 * property and as a hope.
 */
export interface CatalogCursor {
  readonly id: string;
  readonly moment: Date;
}

export function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.moment.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeCatalogCursor(value: string): CatalogCursor | undefined {
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
