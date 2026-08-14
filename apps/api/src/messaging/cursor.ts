import { cursorSchema } from '@velora/validation';

/**
 * Messaging paging positions.
 *
 * Neither cursor is a credential and neither is signed, on the same reasoning
 * the discovery cursor records: the acting consumer always comes from the
 * presented credential, and membership is re-checked on every page. The worst a
 * tampered cursor can do is move a caller to a different position in a
 * conversation they are already a participant in.
 */

const maximumSequence = Number.MAX_SAFE_INTEGER;

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
 * Position in one conversation's history.
 *
 * Keyset on the server-assigned sequence, which is immutable and unique within
 * a conversation, so a page boundary cannot move: a reader scrolling backwards
 * through history sees each message exactly once no matter what arrives while
 * they read.
 *
 * The conversation identifier travels with the position so a cursor from one
 * conversation used against another is a validation failure rather than a
 * silently different query.
 */
export interface MessageCursor {
  readonly before: number;
  readonly conversationId: string;
}

export function encodeMessageCursor(cursor: MessageCursor): string {
  return Buffer.from(
    JSON.stringify({ b: cursor.before, c: cursor.conversationId }),
    'utf8',
  ).toString('base64url');
}

export function decodeMessageCursor(
  value: string,
  conversationId: string,
): MessageCursor | undefined {
  const decoded = decodeJson(value);
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { b: before, c: conversation } = decoded as {
    readonly b?: unknown;
    readonly c?: unknown;
  };
  if (
    typeof before !== 'number' ||
    !Number.isSafeInteger(before) ||
    before < 1 ||
    before > maximumSequence
  ) {
    return undefined;
  }
  if (typeof conversation !== 'string' || conversation !== conversationId) {
    return undefined;
  }
  return { before, conversationId: conversation };
}

/**
 * Position in the caller's conversation list.
 *
 * Ordered by last activity, so unlike the message cursor this one pages over a
 * value that moves. See the consistency model in `docs/domains/messaging.md`:
 * a conversation that receives a message while somebody is paging jumps to the
 * front, which a forward-only reader has already passed, so it can be missed on
 * that pass but never duplicated into it.
 */
export interface ConversationCursor {
  readonly id: string;
  readonly lastActivityAt: Date;
}

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.lastActivityAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeConversationCursor(
  value: string,
): ConversationCursor | undefined {
  const decoded = decodeJson(value);
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { i: id, t: lastActivityAt } = decoded as {
    readonly i?: unknown;
    readonly t?: unknown;
  };
  if (typeof id !== 'string' || !uuidPattern.test(id)) return undefined;
  if (typeof lastActivityAt !== 'string') return undefined;
  const moment = new Date(lastActivityAt);
  if (Number.isNaN(moment.getTime())) return undefined;
  return { id, lastActivityAt: moment };
}
