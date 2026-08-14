import { cursorSchema } from '@velora/validation';

/**
 * Feed position.
 *
 * The cursor is not a credential and is deliberately not signed. It carries no
 * account identifier: the acting consumer always comes from the presented
 * credential, and every candidate on every page is re-evaluated against the full
 * eligibility rules for that consumer. The worst a tampered cursor can do is
 * move the caller to a different position in their own feed.
 *
 * That is a design decision, not an omission. Signing it would add a key to
 * distribute and rotate in exchange for protecting nothing, and it would invite
 * the much worse mistake of treating a cursor as proof of anything.
 */

export interface FeedCursor {
  /**
   * Sort key of the last candidate on the previous page. Paging is a plain
   * comparison against it, so a page never depends on how many rows came
   * before, and rows appearing or disappearing between pages cannot shift the
   * window.
   */
  readonly after: string;
  /**
   * The tie-break window the feed started in, carried forward so a page
   * boundary that crosses a rotation does not reshuffle what the reader has
   * already been shown.
   */
  readonly window: number;
}

const maximumSortKeyLength = 128;

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({ a: cursor.after, w: cursor.window }),
    'utf8',
  ).toString('base64url');
}

/**
 * Decodes a cursor, or reports that it is unusable.
 *
 * Every field is validated against the shape the feed produced. Anything else —
 * truncated, re-encoded, hand-written, or from an older format — is a
 * validation failure rather than a query with surprising bounds.
 */
export function decodeFeedCursor(value: string): FeedCursor | undefined {
  if (!cursorSchema.safeParse(value).success) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { a: after, w: window } = decoded as {
    readonly a?: unknown;
    readonly w?: unknown;
  };
  if (
    typeof after !== 'string' ||
    after.length === 0 ||
    after.length > maximumSortKeyLength ||
    !/^[0-9a-f-]+$/u.test(after)
  ) {
    return undefined;
  }
  if (
    typeof window !== 'number' ||
    !Number.isSafeInteger(window) ||
    window < 0
  ) {
    return undefined;
  }
  return { after, window };
}

/** Which rotation window an instant falls in. */
export function tieBreakWindowFor(now: Date, span: number): number {
  return Math.floor(now.getTime() / span);
}

/**
 * Position in a list ordered by creation.
 *
 * Separate from the feed cursor because it pages on immutable values — when a
 * row was created and its identifier — rather than on a ranking that changes as
 * people update their availability. A list of one's own introductions must not
 * move underneath a reader at all.
 */
export interface ListCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.createdAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeListCursor(value: string): ListCursor | undefined {
  if (!cursorSchema.safeParse(value).success) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { i: id, t: createdAt } = decoded as {
    readonly i?: unknown;
    readonly t?: unknown;
  };
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)
  ) {
    return undefined;
  }
  if (typeof createdAt !== 'string') return undefined;
  const moment = new Date(createdAt);
  if (Number.isNaN(moment.getTime())) return undefined;
  return { createdAt: moment, id };
}
