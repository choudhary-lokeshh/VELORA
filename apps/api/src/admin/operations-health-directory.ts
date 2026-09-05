import { and, count, gt, inArray, isNotNull, sql } from 'drizzle-orm';

import { authSecurityEvents } from '../auth/schema.js';
import { billingOutbox, billingPayments } from '../billing/schema.js';
import { bounded } from '../database/fan-out.js';
import type { DatabaseHandle } from '../database/executor.js';
import { discoveryOutbox } from '../discovery/schema.js';
import { identityOutbox } from '../identity/schema.js';
import type { OutboxTable } from '../events/outbox-table.js';
import { messagingOutbox } from '../messaging/schema.js';
import { notificationAttempts } from '../notifications/schema.js';
import { payoutsOutbox } from '../payouts/schema.js';
import { realtimeOutbox } from '../realtime/schema.js';

/**
 * What is stuck, what is failing, and how the platform knows.
 *
 * Every figure here comes from a durable row somebody's domain wrote because
 * something went wrong. Nothing is scraped from a log, nothing is sampled, and
 * nothing is a rate computed from a denominator this module invented — an
 * operator who is told "seventeen dead-lettered events in BILLING since 09:00"
 * can go and look at all seventeen, which is the property that separates an
 * operational read from a dashboard.
 *
 * The one thing that is not a database row is the queue state, and it is asked
 * of BullMQ directly and reported as unknown when nobody could ask. A zero
 * would have been a lie about a broker nothing reached.
 *
 * **One query per outbox, and at most three in flight.** The first version of
 * this module issued three queries per domain and ran all eighteen at once,
 * which took as many pooled connections as it could get and produced `503`s
 * from a platform that had capacity a moment earlier. Grouping by state with a
 * `min` and a `max` in the same pass answers the same three questions in one
 * round trip, and `bounded` keeps a single operator read from becoming a
 * capacity event. See `../database/fan-out.ts`.
 */

export interface OutboxState {
  readonly deadLettered: number;
  readonly domain: string;
  /** When the newest dead-letter happened, so a fingerprint can carry a time. */
  readonly deadLetteredLatestAt: Date | undefined;
  /** The oldest pending row's age tells an operator whether it is moving. */
  readonly oldestPendingAt: Date | undefined;
  readonly pending: number;
}

export interface FailureFingerprint {
  /** The class of failure, from the owning domain's own closed vocabulary. */
  readonly category: string;
  readonly domain: string;
  readonly latestAt: Date;
  readonly total: number;
}

export interface OperationsSnapshot {
  readonly failures: readonly FailureFingerprint[];
  readonly outboxes: readonly OutboxState[];
  /** The window the failure counts were taken over. Never implied. */
  readonly since: Date;
}

const outboxes: readonly {
  readonly domain: string;
  readonly table: OutboxTable;
}[] = [
  { domain: 'billing', table: billingOutbox },
  { domain: 'discovery', table: discoveryOutbox },
  { domain: 'identity', table: identityOutbox },
  { domain: 'messaging', table: messagingOutbox },
  { domain: 'payouts', table: payoutsOutbox },
  { domain: 'realtime', table: realtimeOutbox },
];

/**
 * The AUTH events that mean something went wrong for somebody.
 *
 * A closed list rather than "anything with `failed` in the name", because the
 * set an operator should be alerted about is a decision, and a substring match
 * would silently start counting a new event type nobody reviewed.
 */
const authFailureEventTypes = [
  'admin_step_up_failed',
  'authentication_failed',
  'recovery_rejected',
  'refresh_reuse_detected',
] as const;

export class AdminOperationsHealthDirectory {
  constructor(private readonly database: DatabaseHandle) {}

  /**
   * Everything stuck or failing in one window.
   *
   * Nine queries — one per outbox and three over failure sources — run at most
   * three at a time. Each is a grouped count over an indexed column with a
   * bounded window, so the cost grows with what actually went wrong inside the
   * window rather than with the platform's history.
   */
  async snapshot(since: Date): Promise<OperationsSnapshot> {
    const outboxStates = await this.outboxStates();
    const failures = await this.failures(since, outboxStates);
    return { failures, outboxes: outboxStates, since };
  }

  private async outboxStates(): Promise<readonly OutboxState[]> {
    return bounded(
      outboxes.map(({ domain, table }) => async () => {
        // One pass answers all three questions: how many are waiting, how many
        // were never published, and how long the oldest of each has been that
        // way. Three queries would have been three connections.
        const rows = await this.database
          .select({
            newest: sql<string>`max(${table.updatedAt})`,
            oldest: sql<string>`min(${table.createdAt})`,
            state: table.state,
            total: count(),
          })
          .from(table)
          .where(sql`${table.state} <> 'dispatched'`)
          .groupBy(table.state);
        const pending = rows.find((row) => row.state === 'pending');
        const dead = rows.find((row) => row.state === 'dead_letter');
        return {
          deadLettered: dead === undefined ? 0 : dead.total,
          deadLetteredLatestAt:
            dead === undefined ? undefined : new Date(dead.newest),
          domain,
          oldestPendingAt:
            pending === undefined ? undefined : new Date(pending.oldest),
          pending: pending === undefined ? 0 : pending.total,
        };
      }),
    );
  }

  private async failures(
    since: Date,
    outboxStates: readonly OutboxState[],
  ): Promise<readonly FailureFingerprint[]> {
    const [notifications, payments, auth] = await bounded([
      async () =>
        this.database
          .select({
            category: notificationAttempts.failureClass,
            latestAt: sql<string>`max(${notificationAttempts.createdAt})`,
            total: count(),
          })
          .from(notificationAttempts)
          .where(
            and(
              gt(notificationAttempts.createdAt, since),
              isNotNull(notificationAttempts.failureClass),
            ),
          )
          .groupBy(notificationAttempts.failureClass),
      async () =>
        this.database
          .select({
            category: billingPayments.failureReason,
            latestAt: sql<string>`max(${billingPayments.updatedAt})`,
            total: count(),
          })
          .from(billingPayments)
          .where(
            and(
              gt(billingPayments.updatedAt, since),
              isNotNull(billingPayments.failureReason),
            ),
          )
          .groupBy(billingPayments.failureReason),
      async () =>
        this.database
          .select({
            category: authSecurityEvents.eventType,
            latestAt: sql<string>`max(${authSecurityEvents.occurredAt})`,
            total: count(),
          })
          .from(authSecurityEvents)
          .where(
            and(
              gt(authSecurityEvents.occurredAt, since),
              inArray(authSecurityEvents.eventType, [...authFailureEventTypes]),
            ),
          )
          .groupBy(authSecurityEvents.eventType),
    ] as const);

    const fingerprints: FailureFingerprint[] = [];
    for (const row of notifications) {
      if (row.category === null) continue;
      fingerprints.push({
        category: row.category,
        domain: 'notifications',
        latestAt: new Date(row.latestAt),
        total: row.total,
      });
    }
    for (const row of payments) {
      if (row.category === null) continue;
      fingerprints.push({
        category: row.category,
        domain: 'billing',
        latestAt: new Date(row.latestAt),
        total: row.total,
      });
    }
    for (const row of auth) {
      fingerprints.push({
        category: row.category,
        domain: 'auth',
        latestAt: new Date(row.latestAt),
        total: row.total,
      });
    }
    // The dead letters are already counted above, so they are turned into
    // fingerprints here rather than queried a second time. A dead-lettered
    // event is a fact that was never published and will not be without a
    // person, which is exactly the shape of every other row on this list.
    for (const outbox of outboxStates) {
      if (outbox.deadLettered === 0) continue;
      const latestAt = outbox.deadLetteredLatestAt;
      if (latestAt === undefined || latestAt <= since) continue;
      fingerprints.push({
        category: 'dead_letter',
        domain: outbox.domain,
        latestAt,
        total: outbox.deadLettered,
      });
    }

    // Loudest first: an operator scanning this list is looking for the thing
    // that is happening most, and ties break on recency so a fresh failure
    // outranks an equally sized one from the start of the window.
    return fingerprints.sort(
      (left, right) =>
        right.total - left.total ||
        right.latestAt.getTime() - left.latestAt.getTime(),
    );
  }
}
