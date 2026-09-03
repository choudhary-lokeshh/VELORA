import { cursorSchema } from '@velora/validation';

/**
 * Support paging position.
 *
 * Keyset on when a ticket was opened and its identifier, both immutable, so a
 * page boundary cannot move underneath a reader while an operator changes a
 * status. One shape serves both lists — the owner's newest-first and the
 * operator's oldest-first — because the position it names is the same position;
 * only the comparison the query makes with it differs.
 *
 * Not a credential and not signed. The owner's list is scoped to the caller in
 * the query predicate and the operator's list is behind the Platform Admin
 * audience, so a tampered cursor can only move a caller around rows they were
 * already entitled to read.
 */

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface SupportCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeSupportCursor(cursor: SupportCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.createdAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeSupportCursor(value: string): SupportCursor | undefined {
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
  if (typeof id !== 'string' || !uuidPattern.test(id)) return undefined;
  if (typeof createdAt !== 'string') return undefined;
  const moment = new Date(createdAt);
  if (Number.isNaN(moment.getTime())) return undefined;
  return { createdAt: moment, id };
}
