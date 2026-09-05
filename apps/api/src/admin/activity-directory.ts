import { and, desc, eq, gt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { authSecurityEvents } from '../auth/schema.js';
import { billingPayments } from '../billing/schema.js';
import type { DatabaseHandle } from '../database/executor.js';
import { bounded } from '../database/fan-out.js';
import { discoveryIntroductions } from '../discovery/schema.js';
import { growthAcquisitionEvents } from '../growth/schema.js';
import { liveEncounters, liveParticipations } from '../live/schema.js';
import { messagingConversations } from '../messaging/schema.js';
import { notificationAttempts } from '../notifications/schema.js';
import type {
  ActivityDomain,
  ActivityResourceType,
  ActivityType,
} from '../operations/policy.js';
import {
  safetyAppeals,
  safetyBlocks,
  safetyEnforcements,
  safetyReports,
} from '../safety/schema.js';
import { supportTicketEvents, supportTickets } from '../support/schema.js';
import { userAccounts } from '../users/schema.js';
import {
  walletAccounts,
  walletAcquisitions,
  walletEntries,
  walletTransactions,
} from '../wallet/schema.js';

/**
 * The activity stream, composed rather than collected.
 *
 * There is no activity table anywhere in this repository, and this module is
 * the reason. Every fact an operator needs to see is already a row some domain
 * writes because the product needs it: a sign-in is AUTH's security event, an
 * encounter is LIVE's row, a capture is WALLET's transaction, a ticket change
 * is SUPPORT's event. Copying those into a telemetry table would create a
 * second answer to every question — one that can be late, can be lost, can be
 * written twice by a retry, and will eventually disagree with the first. This
 * reads the originals.
 *
 * What that buys, stated plainly, because it is the whole argument of
 * `docs/decisions/ADR-0048-…`:
 *
 * **Idempotency is free.** A domain action retried twice produces one row in
 * the owning table or none, so it produces one activity row or none. There is
 * no dedupe key to get wrong.
 *
 * **Retention is free.** Nothing accumulates that was not already accumulating.
 * When a domain's retention decision is finally made and applied, the activity
 * stream shortens with it, automatically and correctly.
 *
 * **Drift is impossible.** An operator looking at the stream and an operator
 * looking at the record are looking at the same row.
 *
 * The cost is that a fact nobody persists cannot be shown. That is a real
 * limit and it is stated in the docs rather than papered over: this stream
 * cannot show "camera disabled" or "message send failed", because neither is
 * persisted anywhere today. The honest answer to that is to persist the fact in
 * the domain that owns it, not to build a parallel pipe that would have had the
 * same gap.
 *
 * **This module reads other domains' tables and writes none of them.** That is
 * the read-model exception `docs/architecture/03-domain-boundaries.md` grants
 * ADMIN and the same one `AdminOperationsDirectory` already uses. No route
 * handler reaches a table; a route calls this, and this only selects.
 */

export interface ActivityEntry {
  /** Whoever caused it, where the source names one. Never a name, always an id. */
  readonly actorId: string | undefined;
  readonly correlationId: string | undefined;
  /**
   * One short, safe word: a state, a reason code, an outcome class. Never a
   * message, a narrative, a token, or anything somebody typed for another
   * person to read.
   */
  readonly detail: string | undefined;
  readonly domain: ActivityDomain;
  /** `<type>#<source identifier>`. Stable, and unique across every source. */
  readonly id: string;
  readonly occurredAt: Date;
  readonly resourceId: string | undefined;
  readonly resourceType: ActivityResourceType | undefined;
  /** Whoever it was about, where that differs from the actor. */
  readonly subjectId: string | undefined;
  readonly type: ActivityType;
}

export interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  readonly nextCursor: string | undefined;
  /** The window actually answered over, so a count is never read as all-time. */
  readonly since: Date;
  readonly until: Date;
}

/**
 * What one source is asked for.
 *
 * `until` is absent on the first page and present on every later one, and that
 * asymmetry is a correctness decision rather than an optimisation.
 *
 * These sources do not share a clock. AUTH's security events are stamped by the
 * database (`default now()`), and most other rows are stamped by the
 * application. An upper bound of "the application's now" therefore silently
 * drops an AUTH event the database wrote a millisecond ago whenever the two
 * clocks differ by a millisecond — which they always do. The first page has no
 * upper bound at all, so "everything since T, newest first" means exactly that;
 * later pages are bounded by the previous page's last row, which is an instant
 * that came out of a row rather than off a clock, and is therefore in the same
 * domain as the column it is compared against.
 */
interface SourceQuery {
  readonly cursor?: string | undefined;
  readonly domain?: ActivityDomain | undefined;
  readonly limit: number;
  readonly since: Date;
  /**
   * One person's activity, given as both identifiers they are known by.
   *
   * AUTH keeps its own account identifier and USERS keeps another; a person's
   * sign-ins are recorded against the first and everything else against the
   * second. Asking for a timeline with only one of them would silently omit
   * half of it, so the caller resolves both and this asks each source for the
   * one it holds.
   */
  readonly subject?:
    | {
        readonly authAccountId?: string | undefined;
        readonly userId?: string | undefined;
      }
    | undefined;
  readonly type?: ActivityType | undefined;
  readonly until: Date | undefined;
}

/** What a caller asks for. The window it answers over is always reported. */
export interface ActivityQuery {
  readonly cursor?: string | undefined;
  readonly domain?: ActivityDomain | undefined;
  readonly limit: number;
  readonly since: Date;
  readonly subject?:
    | {
        readonly authAccountId?: string | undefined;
        readonly userId?: string | undefined;
      }
    | undefined;
  readonly type?: ActivityType | undefined;
  readonly until: Date;
}

interface Cursor {
  readonly at: Date;
  readonly id: string;
}

function encodeCursor(entry: ActivityEntry): string {
  return Buffer.from(
    JSON.stringify({ i: entry.id, t: entry.occurredAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

export function decodeActivityCursor(value: string): Cursor | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { i: id, t: at } = decoded as {
    readonly i?: unknown;
    readonly t?: unknown;
  };
  if (typeof id !== 'string' || typeof at !== 'string') return undefined;
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return undefined;
  return { at: instant, id };
}

/** Newest first, ties broken by identifier so a page boundary cannot drift. */
function ordering(left: ActivityEntry, right: ActivityEntry): number {
  const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  return right.id.localeCompare(left.id);
}

function beforeCursor(entry: ActivityEntry, cursor: Cursor): boolean {
  const at = entry.occurredAt.getTime();
  const bound = cursor.at.getTime();
  if (at !== bound) return at < bound;
  return entry.id.localeCompare(cursor.id) < 0;
}

/**
 * The upper half of a window, applied only when there is one.
 *
 * Absent on a first page, so a row written a millisecond ago by a clock this
 * process does not share is not silently dropped.
 */
function upperBound(
  column: PgColumn,
  until: Date | undefined,
): SQL | undefined {
  return until === undefined ? undefined : lte(column, until);
}

/** Whether one instant falls inside the window this query is answering. */
function inWindow(at: Date, query: SourceQuery): boolean {
  if (at <= query.since) return false;
  return query.until === undefined || at <= query.until;
}

/** A bounded projection of a source value. Never a narrative, never content. */
function detailOf(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 64);
}

export class AdminActivityDirectory {
  constructor(private readonly database: DatabaseHandle) {}

  /**
   * Everything that happened in a window, newest first.
   *
   * Each source is asked separately for at most one page of its own rows in the
   * window; the results are merged and cut to one page. That is a k-way merge
   * of individually ordered, individually indexed reads, which is both correct
   * and cheap — every one of them lands on a recency index its own domain
   * already maintains, and none of them scans.
   *
   * Bounded rather than all at once. Seventeen sources issued together would
   * take as many pooled connections as the pool would give one screen, and
   * ADR-0019's admission bound counts requests rather than queries — so the
   * cost would land on everybody else as `503`. See `../database/fan-out.ts`.
   *
   * A source with no rows contributes nothing and costs one indexed lookup. A
   * filter by domain or type asks only the sources that could answer, so a
   * narrowed query is genuinely narrower rather than the same work with a
   * filter on the end.
   */
  async list(query: ActivityQuery): Promise<ActivityPage> {
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeActivityCursor(query.cursor);
    // A cursor bounds the window rather than being applied afterwards: reading
    // page two must not read page one's rows again out of eleven tables. The
    // first page has no upper bound at all, for the clock reason `SourceQuery`
    // records.
    const readers = this.readersFor(query);
    const gathered = await bounded(
      readers.map((read) => async () => read({ ...query, until: cursor?.at })),
    );

    const merged = gathered
      .flat()
      .filter((entry) => cursor === undefined || beforeCursor(entry, cursor))
      .sort(ordering);
    const page = merged.slice(0, query.limit);
    const last = page.at(-1);
    return {
      entries: page,
      nextCursor:
        merged.length > query.limit && last !== undefined
          ? encodeCursor(last)
          : undefined,
      since: query.since,
      until: query.until,
    };
  }

  /**
   * Only the sources that could answer this query.
   *
   * Asked as a list of readers rather than as one query with a `union all`,
   * because the sources have genuinely different shapes and a union would have
   * to cast every column of eleven tables into one row type in SQL — which is
   * where a column somebody adds later silently lands in the wrong slot.
   */
  private readersFor(
    query: ActivityQuery,
  ): readonly ((bounded: SourceQuery) => Promise<ActivityEntry[]>)[] {
    const all: readonly {
      readonly domain: ActivityDomain;
      readonly read: (bounded: SourceQuery) => Promise<ActivityEntry[]>;
      readonly types: readonly ActivityType[];
    }[] = [
      {
        domain: 'auth',
        read: (bounded) => this.authEvents(bounded),
        types: ['auth.security_event'],
      },
      {
        domain: 'users',
        read: (bounded) => this.accountEvents(bounded),
        types: ['users.account_created', 'users.account_status_changed'],
      },
      {
        domain: 'live',
        read: (bounded) => this.liveParticipations(bounded),
        types: ['live.search_entered', 'live.search_ended'],
      },
      {
        domain: 'live',
        read: (bounded) => this.liveEncounters(bounded),
        types: ['live.encounter_started', 'live.encounter_ended'],
      },
      {
        domain: 'discovery',
        read: (bounded) => this.introductions(bounded),
        types: [
          'discovery.introduction_created',
          'discovery.introduction_settled',
        ],
      },
      {
        domain: 'messaging',
        read: (bounded) => this.conversations(bounded),
        types: ['messaging.conversation_created'],
      },
      {
        domain: 'safety',
        read: (bounded) => this.blocks(bounded),
        types: ['safety.block_created'],
      },
      {
        domain: 'safety',
        read: (bounded) => this.reports(bounded),
        types: ['safety.report_submitted'],
      },
      {
        domain: 'safety',
        read: (bounded) => this.enforcements(bounded),
        types: ['safety.enforcement_applied'],
      },
      {
        domain: 'safety',
        read: (bounded) => this.appeals(bounded),
        types: ['safety.appeal_submitted'],
      },
      {
        domain: 'support',
        read: (bounded) => this.tickets(bounded),
        types: ['support.ticket_opened'],
      },
      {
        domain: 'support',
        read: (bounded) => this.ticketEvents(bounded),
        types: ['support.ticket_event'],
      },
      {
        domain: 'wallet',
        read: (bounded) => this.walletTransactions(bounded),
        types: ['wallet.transaction_posted'],
      },
      {
        domain: 'wallet',
        read: (bounded) => this.walletAcquisitions(bounded),
        types: ['wallet.acquisition_settled'],
      },
      {
        domain: 'billing',
        read: (bounded) => this.payments(bounded),
        types: ['billing.payment_settled'],
      },
      {
        domain: 'notifications',
        read: (bounded) => this.notificationAttempts(bounded),
        types: ['notifications.delivery_attempted'],
      },
      {
        domain: 'growth',
        read: (bounded) => this.growthEvents(bounded),
        types: ['growth.acquisition_event'],
      },
    ];
    return all
      .filter(
        (source) =>
          query.domain === undefined || source.domain === query.domain,
      )
      .filter(
        (source) =>
          query.type === undefined || source.types.includes(query.type),
      )
      .map((source) => source.read);
  }

  /* ------------------------------- Sources ----------------------------- */

  private async authEvents(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.authAccountId === undefined) return [];
    const rows = await this.database
      .select({
        accountId: authSecurityEvents.accountId,
        correlationId: authSecurityEvents.correlationId,
        eventType: authSecurityEvents.eventType,
        id: authSecurityEvents.id,
        occurredAt: authSecurityEvents.occurredAt,
        reason: authSecurityEvents.reason,
        sessionId: authSecurityEvents.sessionId,
      })
      .from(authSecurityEvents)
      .where(
        and(
          gt(authSecurityEvents.occurredAt, query.since),
          upperBound(authSecurityEvents.occurredAt, query.until),
          subject?.authAccountId === undefined
            ? undefined
            : eq(authSecurityEvents.accountId, subject.authAccountId),
        ),
      )
      .orderBy(desc(authSecurityEvents.occurredAt), desc(authSecurityEvents.id))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.accountId ?? undefined,
      correlationId: row.correlationId,
      // AUTH's own event type is the detail — `session_revoked`,
      // `sign_in_failed` — and the reason beside it is a code, never a message.
      detail: detailOf(row.reason) ?? detailOf(row.eventType),
      domain: 'auth' as const,
      id: `auth.security_event#${String(row.id)}`,
      occurredAt: row.occurredAt,
      resourceId: row.sessionId ?? undefined,
      resourceType: 'session' as const,
      subjectId: row.accountId ?? undefined,
      type: 'auth.security_event' as const,
    }));
  }

  private async accountEvents(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const rows = await this.database
      .select({
        createdAt: userAccounts.createdAt,
        id: userAccounts.id,
        status: userAccounts.status,
        statusChangedAt: userAccounts.statusChangedAt,
        statusReason: userAccounts.statusReason,
      })
      .from(userAccounts)
      .where(
        and(
          or(
            and(
              gt(userAccounts.createdAt, query.since),
              upperBound(userAccounts.createdAt, query.until),
            ),
            and(
              gt(userAccounts.statusChangedAt, query.since),
              upperBound(userAccounts.statusChangedAt, query.until),
            ),
          ),
          subject?.userId === undefined
            ? undefined
            : eq(userAccounts.id, subject.userId),
        ),
      )
      .orderBy(desc(userAccounts.statusChangedAt))
      .limit(query.limit);

    const entries: ActivityEntry[] = [];
    for (const row of rows) {
      if (inWindow(row.createdAt, query)) {
        entries.push({
          actorId: row.id,
          correlationId: undefined,
          detail: undefined,
          domain: 'users',
          id: `users.account_created#${row.id}`,
          occurredAt: row.createdAt,
          resourceId: row.id,
          resourceType: 'account',
          subjectId: row.id,
          type: 'users.account_created',
        });
      }
      // A status change is only a distinct fact once it differs from creation.
      // Reporting both at the same instant would show every new account being
      // "changed" the moment it existed.
      if (
        row.statusChangedAt.getTime() !== row.createdAt.getTime() &&
        inWindow(row.statusChangedAt, query)
      ) {
        entries.push({
          actorId: undefined,
          correlationId: undefined,
          detail: detailOf(row.statusReason) ?? detailOf(row.status),
          domain: 'users',
          id: `users.account_status_changed#${row.id}`,
          occurredAt: row.statusChangedAt,
          resourceId: row.id,
          resourceType: 'account',
          subjectId: row.id,
          type: 'users.account_status_changed',
        });
      }
    }
    return entries;
  }

  private async liveParticipations(
    query: SourceQuery,
  ): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const rows = await this.database
      .select({
        encounterId: liveParticipations.encounterId,
        id: liveParticipations.id,
        joinedAt: liveParticipations.joinedAt,
        medium: liveParticipations.medium,
        state: liveParticipations.state,
        stateEnteredAt: liveParticipations.stateEnteredAt,
        userId: liveParticipations.userId,
      })
      .from(liveParticipations)
      .where(
        and(
          or(
            and(
              gt(liveParticipations.joinedAt, query.since),
              upperBound(liveParticipations.joinedAt, query.until),
            ),
            and(
              gt(liveParticipations.stateEnteredAt, query.since),
              upperBound(liveParticipations.stateEnteredAt, query.until),
            ),
          ),
          subject?.userId === undefined
            ? undefined
            : eq(liveParticipations.userId, subject.userId),
        ),
      )
      .orderBy(desc(liveParticipations.stateEnteredAt))
      .limit(query.limit);

    const entries: ActivityEntry[] = [];
    for (const row of rows) {
      if (inWindow(row.joinedAt, query)) {
        entries.push({
          actorId: row.userId,
          correlationId: undefined,
          detail: row.medium,
          domain: 'live',
          id: `live.search_entered#${row.id}`,
          occurredAt: row.joinedAt,
          resourceId: row.encounterId ?? undefined,
          resourceType: 'participation',
          subjectId: row.userId,
          type: 'live.search_entered',
        });
      }
      if (row.state === 'left' && inWindow(row.stateEnteredAt, query)) {
        entries.push({
          actorId: row.userId,
          correlationId: undefined,
          detail: row.medium,
          domain: 'live',
          id: `live.search_ended#${row.id}`,
          occurredAt: row.stateEnteredAt,
          resourceId: row.encounterId ?? undefined,
          resourceType: 'participation',
          subjectId: row.userId,
          type: 'live.search_ended',
        });
      }
    }
    return entries;
  }

  private async liveEncounters(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        createdAt: liveEncounters.createdAt,
        endReason: liveEncounters.endReason,
        endedAt: liveEncounters.endedAt,
        endedById: liveEncounters.endedById,
        id: liveEncounters.id,
        medium: liveEncounters.medium,
        pairHighId: liveEncounters.pairHighId,
        pairLowId: liveEncounters.pairLowId,
      })
      .from(liveEncounters)
      .where(
        and(
          or(
            and(
              gt(liveEncounters.createdAt, query.since),
              upperBound(liveEncounters.createdAt, query.until),
            ),
            and(
              gt(liveEncounters.endedAt, query.since),
              upperBound(liveEncounters.endedAt, query.until),
            ),
          ),
          person === undefined
            ? undefined
            : or(
                eq(liveEncounters.pairHighId, person),
                eq(liveEncounters.pairLowId, person),
              ),
        ),
      )
      .orderBy(desc(liveEncounters.createdAt))
      .limit(query.limit);

    const entries: ActivityEntry[] = [];
    for (const row of rows) {
      if (inWindow(row.createdAt, query)) {
        entries.push({
          actorId: undefined,
          correlationId: undefined,
          detail: row.medium,
          domain: 'live',
          id: `live.encounter_started#${row.id}`,
          occurredAt: row.createdAt,
          resourceId: row.id,
          resourceType: 'encounter',
          subjectId: person ?? row.pairLowId,
          type: 'live.encounter_started',
        });
      }
      const endedAt = row.endedAt;
      if (endedAt !== null && inWindow(endedAt, query)) {
        entries.push({
          actorId: row.endedById ?? undefined,
          correlationId: undefined,
          detail: detailOf(row.endReason),
          domain: 'live',
          id: `live.encounter_ended#${row.id}`,
          occurredAt: endedAt,
          resourceId: row.id,
          resourceType: 'encounter',
          subjectId: person ?? row.pairLowId,
          type: 'live.encounter_ended',
        });
      }
    }
    return entries;
  }

  private async introductions(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        closedAt: discoveryIntroductions.closedAt,
        closedReason: discoveryIntroductions.closedReason,
        createdAt: discoveryIntroductions.createdAt,
        id: discoveryIntroductions.id,
        initiatorId: discoveryIntroductions.initiatorId,
        mutualAt: discoveryIntroductions.mutualAt,
        pairLowId: discoveryIntroductions.pairLowId,
        state: discoveryIntroductions.state,
      })
      .from(discoveryIntroductions)
      .where(
        and(
          or(
            and(
              gt(discoveryIntroductions.createdAt, query.since),
              upperBound(discoveryIntroductions.createdAt, query.until),
            ),
            and(
              gt(discoveryIntroductions.updatedAt, query.since),
              upperBound(discoveryIntroductions.updatedAt, query.until),
            ),
          ),
          person === undefined
            ? undefined
            : or(
                eq(discoveryIntroductions.pairHighId, person),
                eq(discoveryIntroductions.pairLowId, person),
              ),
        ),
      )
      .orderBy(desc(discoveryIntroductions.updatedAt))
      .limit(query.limit);

    const entries: ActivityEntry[] = [];
    for (const row of rows) {
      if (inWindow(row.createdAt, query)) {
        entries.push({
          actorId: row.initiatorId,
          correlationId: undefined,
          detail: undefined,
          domain: 'discovery',
          id: `discovery.introduction_created#${row.id}`,
          occurredAt: row.createdAt,
          resourceId: row.id,
          resourceType: 'introduction',
          subjectId: person ?? row.pairLowId,
          type: 'discovery.introduction_created',
        });
      }
      // Settled means it stopped being a question: mutual, or closed. Both are
      // one row's own instants, so nothing here needs a second table.
      const settledAt = row.mutualAt ?? row.closedAt;
      if (settledAt !== null && inWindow(settledAt, query)) {
        entries.push({
          actorId: undefined,
          correlationId: undefined,
          detail:
            row.mutualAt === null
              ? detailOf(row.closedReason)
              : detailOf(row.state),
          domain: 'discovery',
          id: `discovery.introduction_settled#${row.id}`,
          occurredAt: settledAt,
          resourceId: row.id,
          resourceType: 'introduction',
          subjectId: person ?? row.pairLowId,
          type: 'discovery.introduction_settled',
        });
      }
    }
    return entries;
  }

  private async conversations(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        createdAt: messagingConversations.createdAt,
        id: messagingConversations.id,
        pairLowId: messagingConversations.pairLowId,
      })
      .from(messagingConversations)
      .where(
        and(
          gt(messagingConversations.createdAt, query.since),
          upperBound(messagingConversations.createdAt, query.until),
          person === undefined
            ? undefined
            : or(
                eq(messagingConversations.pairHighId, person),
                eq(messagingConversations.pairLowId, person),
              ),
        ),
      )
      .orderBy(desc(messagingConversations.createdAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: undefined,
      correlationId: undefined,
      // No message, no participant name, no preview. That a conversation began
      // is an operational fact; what is in it is not this module's business and
      // there is deliberately nowhere here to put it.
      detail: undefined,
      domain: 'messaging' as const,
      id: `messaging.conversation_created#${row.id}`,
      occurredAt: row.createdAt,
      resourceId: row.id,
      resourceType: 'conversation' as const,
      subjectId: person ?? row.pairLowId,
      type: 'messaging.conversation_created' as const,
    }));
  }

  private async blocks(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        blockedId: safetyBlocks.blockedId,
        blockerId: safetyBlocks.blockerId,
        createdAt: safetyBlocks.createdAt,
        id: safetyBlocks.id,
      })
      .from(safetyBlocks)
      .where(
        and(
          gt(safetyBlocks.createdAt, query.since),
          upperBound(safetyBlocks.createdAt, query.until),
          person === undefined
            ? undefined
            : or(
                eq(safetyBlocks.blockerId, person),
                eq(safetyBlocks.blockedId, person),
              ),
        ),
      )
      .orderBy(desc(safetyBlocks.createdAt), desc(safetyBlocks.id))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.blockerId,
      correlationId: undefined,
      detail: undefined,
      domain: 'safety' as const,
      id: `safety.block_created#${String(row.id)}`,
      occurredAt: row.createdAt,
      resourceId: undefined,
      resourceType: 'block' as const,
      subjectId: row.blockedId,
      type: 'safety.block_created' as const,
    }));
  }

  private async reports(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        caseId: safetyReports.caseId,
        createdAt: safetyReports.createdAt,
        id: safetyReports.id,
        reasonCode: safetyReports.reasonCode,
        reporterId: safetyReports.reporterId,
        subjectId: safetyReports.subjectId,
      })
      .from(safetyReports)
      .where(
        and(
          gt(safetyReports.createdAt, query.since),
          upperBound(safetyReports.createdAt, query.until),
          person === undefined
            ? undefined
            : or(
                eq(safetyReports.reporterId, person),
                eq(safetyReports.subjectId, person),
              ),
        ),
      )
      .orderBy(desc(safetyReports.createdAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.reporterId,
      correlationId: undefined,
      // The category, never the narrative. What somebody wrote about somebody
      // else belongs in the case detail an authorized safety operator opens,
      // which is where the evidence it rests on also is.
      detail: detailOf(row.reasonCode),
      domain: 'safety' as const,
      id: `safety.report_submitted#${row.id}`,
      occurredAt: row.createdAt,
      resourceId: row.caseId ?? row.id,
      resourceType:
        row.caseId === null ? ('report' as const) : ('case' as const),
      subjectId: row.subjectId,
      type: 'safety.report_submitted' as const,
    }));
  }

  private async enforcements(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        actorReference: safetyEnforcements.actorReference,
        disposition: safetyEnforcements.disposition,
        effectiveAt: safetyEnforcements.effectiveAt,
        id: safetyEnforcements.id,
        reasonCode: safetyEnforcements.reasonCode,
        scope: safetyEnforcements.scope,
        subjectId: safetyEnforcements.subjectId,
      })
      .from(safetyEnforcements)
      .where(
        and(
          gt(safetyEnforcements.effectiveAt, query.since),
          upperBound(safetyEnforcements.effectiveAt, query.until),
          person === undefined
            ? undefined
            : eq(safetyEnforcements.subjectId, person),
        ),
      )
      .orderBy(desc(safetyEnforcements.effectiveAt))
      .limit(query.limit);
    return rows.map((row) => ({
      // The operator session that imposed it. Already an opaque reference in
      // TRUST & SAFETY's own record; nothing is resolved to a person here.
      actorId: undefined,
      correlationId: undefined,
      detail: `${row.disposition}:${row.scope}`.slice(0, 64),
      domain: 'safety' as const,
      id: `safety.enforcement_applied#${row.id}`,
      occurredAt: row.effectiveAt,
      resourceId: row.id,
      resourceType: 'enforcement' as const,
      subjectId: row.subjectId,
      type: 'safety.enforcement_applied' as const,
    }));
  }

  private async appeals(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        appellantReference: safetyAppeals.appellantReference,
        caseId: safetyAppeals.caseId,
        id: safetyAppeals.id,
        state: safetyAppeals.state,
        submittedAt: safetyAppeals.submittedAt,
      })
      .from(safetyAppeals)
      .where(
        and(
          gt(safetyAppeals.submittedAt, query.since),
          upperBound(safetyAppeals.submittedAt, query.until),
          person === undefined
            ? undefined
            : eq(safetyAppeals.appellantReference, person),
        ),
      )
      .orderBy(desc(safetyAppeals.submittedAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.appellantReference,
      correlationId: undefined,
      // The state, never the statement. Somebody contesting a decision wrote
      // that for a reviewer, not for a feed.
      detail: detailOf(row.state),
      domain: 'safety' as const,
      id: `safety.appeal_submitted#${row.id}`,
      occurredAt: row.submittedAt,
      resourceId: row.caseId,
      resourceType: 'appeal' as const,
      subjectId: row.appellantReference,
      type: 'safety.appeal_submitted' as const,
    }));
  }

  private async tickets(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        category: supportTickets.category,
        createdAt: supportTickets.createdAt,
        id: supportTickets.id,
        ownerId: supportTickets.ownerId,
        reference: supportTickets.reference,
      })
      .from(supportTickets)
      .where(
        and(
          gt(supportTickets.createdAt, query.since),
          upperBound(supportTickets.createdAt, query.until),
          person === undefined ? undefined : eq(supportTickets.ownerId, person),
        ),
      )
      .orderBy(desc(supportTickets.createdAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.ownerId,
      correlationId: undefined,
      // The category and the reference. Never the subject line and never the
      // description — somebody wrote those to an operator about their own
      // account, and a general feed is not where either belongs.
      detail: detailOf(row.category),
      domain: 'support' as const,
      id: `support.ticket_opened#${row.id}`,
      occurredAt: row.createdAt,
      resourceId: row.id,
      resourceType: 'ticket' as const,
      subjectId: row.ownerId,
      type: 'support.ticket_opened' as const,
    }));
  }

  private async ticketEvents(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        createdAt: supportTicketEvents.createdAt,
        id: supportTicketEvents.id,
        kind: supportTicketEvents.kind,
        ownerId: supportTickets.ownerId,
        status: supportTicketEvents.status,
        ticketId: supportTicketEvents.ticketId,
      })
      .from(supportTicketEvents)
      .innerJoin(
        supportTickets,
        eq(supportTicketEvents.ticketId, supportTickets.id),
      )
      .where(
        and(
          gt(supportTicketEvents.createdAt, query.since),
          upperBound(supportTicketEvents.createdAt, query.until),
          person === undefined ? undefined : eq(supportTickets.ownerId, person),
        ),
      )
      .orderBy(desc(supportTicketEvents.createdAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: undefined,
      correlationId: undefined,
      // The kind and the status it moved to. Never the note: an internal note
      // is written for the next operator on the case, not for a feed.
      detail: detailOf(row.status) ?? detailOf(row.kind),
      domain: 'support' as const,
      id: `support.ticket_event#${row.id}`,
      occurredAt: row.createdAt,
      resourceId: row.ticketId,
      resourceType: 'ticket' as const,
      subjectId: row.ownerId,
      type: 'support.ticket_event' as const,
    }));
  }

  private async walletTransactions(
    query: SourceQuery,
  ): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        businessType: walletTransactions.businessType,
        correlationId: walletTransactions.correlationId,
        id: walletTransactions.id,
        occurredAt: walletTransactions.occurredAt,
        reason: walletTransactions.reason,
      })
      .from(walletTransactions)
      .where(
        and(
          gt(walletTransactions.occurredAt, query.since),
          upperBound(walletTransactions.occurredAt, query.until),
          // A transaction names no person: it is a balanced set of entries over
          // accounts, and whose account one of them is belongs to WALLET's own
          // account table. Narrowing to a person therefore asks whether any
          // entry of this transaction touched an account of theirs, which is an
          // indexed existence check rather than a join that would multiply the
          // transaction by its entries.
          person === undefined
            ? undefined
            : sql`exists (
                select 1
                from ${walletEntries}
                join ${walletAccounts}
                  on ${walletAccounts.id} = ${walletEntries.accountId}
                where ${walletEntries.transactionId} = ${walletTransactions.id}
                  and ${walletAccounts.subjectId} = ${person}
              )`,
        ),
      )
      .orderBy(desc(walletTransactions.occurredAt), desc(walletTransactions.id))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: undefined,
      correlationId: row.correlationId ?? undefined,
      // What kind of movement and why, never an amount. A balance is somebody's
      // financial position and it belongs on the wallet screen an operator with
      // `wallet.read` opens, not in a stream anybody with `operations.read` can
      // scroll.
      detail: detailOf(row.reason) ?? detailOf(row.businessType),
      domain: 'wallet' as const,
      id: `wallet.transaction_posted#${row.id}`,
      occurredAt: row.occurredAt,
      resourceId: row.id,
      resourceType: 'transaction' as const,
      subjectId: person,
      type: 'wallet.transaction_posted' as const,
    }));
  }

  private async walletAcquisitions(
    query: SourceQuery,
  ): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        channel: walletAcquisitions.channel,
        createdAt: walletAcquisitions.createdAt,
        id: walletAcquisitions.id,
        userId: walletAcquisitions.userId,
      })
      .from(walletAcquisitions)
      .where(
        and(
          gt(walletAcquisitions.createdAt, query.since),
          upperBound(walletAcquisitions.createdAt, query.until),
          person === undefined
            ? undefined
            : eq(walletAcquisitions.userId, person),
        ),
      )
      .orderBy(desc(walletAcquisitions.createdAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.userId,
      correlationId: undefined,
      detail: detailOf(row.channel),
      domain: 'wallet' as const,
      id: `wallet.acquisition_settled#${row.id}`,
      occurredAt: row.createdAt,
      resourceId: row.id,
      resourceType: 'acquisition' as const,
      subjectId: row.userId,
      type: 'wallet.acquisition_settled' as const,
    }));
  }

  private async payments(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        consumerId: billingPayments.consumerId,
        correlationId: billingPayments.correlationId,
        failureReason: billingPayments.failureReason,
        id: billingPayments.id,
        state: billingPayments.state,
        updatedAt: billingPayments.updatedAt,
      })
      .from(billingPayments)
      .where(
        and(
          gt(billingPayments.updatedAt, query.since),
          upperBound(billingPayments.updatedAt, query.until),
          person === undefined
            ? undefined
            : eq(billingPayments.consumerId, person),
        ),
      )
      .orderBy(desc(billingPayments.updatedAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.consumerId,
      correlationId: row.correlationId ?? undefined,
      // The state, and the failure class where there was one. Never an amount,
      // never a provider reference, and never anything that came from a
      // payment instrument.
      detail: detailOf(row.failureReason) ?? detailOf(row.state),
      domain: 'billing' as const,
      id: `billing.payment_settled#${row.id}`,
      occurredAt: row.updatedAt,
      resourceId: row.id,
      resourceType: 'payment' as const,
      subjectId: row.consumerId,
      type: 'billing.payment_settled' as const,
    }));
  }

  private async notificationAttempts(
    query: SourceQuery,
  ): Promise<ActivityEntry[]> {
    // Deliberately not filtered by person. An attempt names an intent rather
    // than a recipient, and joining out to find one would put "who was told
    // what" into a query whose whole purpose is delivery health.
    if (query.subject !== undefined) return [];
    const rows = await this.database
      .select({
        channel: notificationAttempts.channel,
        createdAt: notificationAttempts.createdAt,
        failureClass: notificationAttempts.failureClass,
        id: notificationAttempts.id,
        intentId: notificationAttempts.intentId,
        outcome: notificationAttempts.outcome,
      })
      .from(notificationAttempts)
      .where(
        and(
          gt(notificationAttempts.createdAt, query.since),
          upperBound(notificationAttempts.createdAt, query.until),
        ),
      )
      .orderBy(
        desc(notificationAttempts.createdAt),
        desc(notificationAttempts.id),
      )
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: undefined,
      correlationId: undefined,
      // The channel and how it went. Never a token, never an address, and
      // never the body of what was sent.
      detail: `${row.channel}:${row.failureClass ?? row.outcome}`.slice(0, 64),
      domain: 'notifications' as const,
      id: `notifications.delivery_attempted#${String(row.id)}`,
      occurredAt: row.createdAt,
      resourceId: row.intentId,
      resourceType: 'notification' as const,
      subjectId: undefined,
      type: 'notifications.delivery_attempted' as const,
    }));
  }

  private async growthEvents(query: SourceQuery): Promise<ActivityEntry[]> {
    const subject = query.subject;
    if (subject !== undefined && subject.userId === undefined) return [];
    const person = subject?.userId;
    const rows = await this.database
      .select({
        id: growthAcquisitionEvents.id,
        inviteId: growthAcquisitionEvents.inviteId,
        name: growthAcquisitionEvents.name,
        occurredAt: growthAcquisitionEvents.occurredAt,
        source: growthAcquisitionEvents.source,
        subjectId: growthAcquisitionEvents.subjectId,
      })
      .from(growthAcquisitionEvents)
      .where(
        and(
          gt(growthAcquisitionEvents.occurredAt, query.since),
          upperBound(growthAcquisitionEvents.occurredAt, query.until),
          person === undefined
            ? undefined
            : eq(growthAcquisitionEvents.subjectId, person),
        ),
      )
      .orderBy(desc(growthAcquisitionEvents.occurredAt))
      .limit(query.limit);
    return rows.map((row) => ({
      actorId: row.subjectId ?? undefined,
      correlationId: undefined,
      detail: `${row.name}${row.source === null ? '' : `:${row.source}`}`.slice(
        0,
        64,
      ),
      domain: 'growth' as const,
      id: `growth.acquisition_event#${row.id}`,
      occurredAt: row.occurredAt,
      resourceId: row.inviteId ?? undefined,
      resourceType: 'invite' as const,
      subjectId: row.subjectId ?? undefined,
      type: 'growth.acquisition_event' as const,
    }));
  }
}
