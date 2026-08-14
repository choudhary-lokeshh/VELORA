import { cursorSchema } from '@velora/validation';

import { isUuid } from '../events/payload.js';

/**
 * The in-app feed's paging position.
 *
 * Keyset on the creation instant and the identifier, both immutable, so a page
 * boundary cannot move underneath a reader as new notices arrive above it.
 *
 * Not signed, and not a credential. The acting consumer always comes from the
 * presented credential and the query is scoped to them in its predicate, so the
 * worst a tampered cursor can do is move a caller around their own notices.
 */

export interface FeedCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.createdAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeFeedCursor(value: string): FeedCursor | undefined {
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
  if (!isUuid(id) || typeof createdAt !== 'string') return undefined;
  const moment = new Date(createdAt);
  if (Number.isNaN(moment.getTime())) return undefined;
  return { createdAt: moment, id };
}
