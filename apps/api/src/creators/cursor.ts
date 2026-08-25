import { cursorSchema } from '@velora/validation';

/**
 * A position in the creator directory.
 *
 * Not a credential and not signed, on the same reasoning every other cursor in
 * this repository records: what a caller may see is decided by the query on
 * every page, so the worst a tampered value can do is move a reader to a
 * different position in a listing they were already entitled to read.
 *
 * Keyset rather than offset, and keyed on a value that does not move once it is
 * set. A page's publication instant is written when it is published and cleared
 * only by unpublishing, so a boundary cannot shift under a reader part-way
 * through — which is the difference between "no duplicate rows across pages" as
 * a property and as a hope.
 */
export interface DirectoryCursor {
  readonly id: string;
  readonly moment: Date;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function encodeDirectoryCursor(cursor: DirectoryCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.moment.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeDirectoryCursor(
  value: string,
): DirectoryCursor | undefined {
  if (!cursorSchema.safeParse(value).success) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { i: id, t: moment } = decoded as {
    readonly i?: unknown;
    readonly t?: unknown;
  };
  if (typeof id !== 'string' || !uuidPattern.test(id)) return undefined;
  if (typeof moment !== 'string') return undefined;
  const instant = new Date(moment);
  return Number.isNaN(instant.getTime()) ? undefined : { id, moment: instant };
}
