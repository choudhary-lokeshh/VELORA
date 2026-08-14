import { cursorSchema } from '@velora/validation';

/**
 * Safety paging positions.
 *
 * Both list keyset on values that never change — when a record was made and its
 * identifier — so a page boundary cannot move underneath a reader. Neither
 * cursor is a credential and neither is signed: the acting consumer always comes
 * from the presented credential, and both lists are scoped to that consumer in
 * the query predicate, so a tampered cursor can only move a caller around their
 * own records.
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

export interface BlockCursor {
  readonly createdAt: Date;
  readonly id: number;
}

export function encodeBlockCursor(cursor: BlockCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.createdAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeBlockCursor(value: string): BlockCursor | undefined {
  const decoded = decodeJson(value);
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { i: id, t: createdAt } = decoded as {
    readonly i?: unknown;
    readonly t?: unknown;
  };
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    return undefined;
  }
  if (typeof createdAt !== 'string') return undefined;
  const moment = new Date(createdAt);
  if (Number.isNaN(moment.getTime())) return undefined;
  return { createdAt: moment, id };
}

export interface ReportCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeReportCursor(cursor: ReportCursor): string {
  return Buffer.from(
    JSON.stringify({ i: cursor.id, t: cursor.createdAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeReportCursor(value: string): ReportCursor | undefined {
  const decoded = decodeJson(value);
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
