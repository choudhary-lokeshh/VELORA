import type { UserAccountRow } from '../users/repository.js';
import {
  decodeFeedCursor,
  encodeFeedCursor,
  type FeedCursor,
} from './cursor.js';
import {
  feedFilterOverFetchFactor,
  maximumFeedFilterRounds,
  type NotificationKind,
} from './policy.js';
import type {
  NotificationFeedRow,
  NotificationRepository,
} from './repository.js';
import type { NotificationSafetyPort } from './safety.js';

/**
 * The in-app notification surface.
 *
 * It reads NOTIFICATIONS' own rows and asks TRUST & SAFETY one question. It
 * never touches the delivery intent, so nothing a consumer can call here can
 * observe a lease, an attempt, a provider reference, or a suppression reason —
 * `safety_block` in particular would disclose another person's decision.
 *
 * Eligibility is evaluated on every read rather than frozen into the row. That
 * is the whole reason the in-app surface is easier than external delivery: a
 * read has no side effect to recall, so a block that commits a millisecond
 * before the next page load is honoured on that page load, and one that is
 * withdrawn restores the notices it had been hiding.
 */

export interface NotificationView {
  readonly conversationId: string | undefined;
  readonly createdAt: Date;
  readonly id: string;
  readonly introductionId: string | undefined;
  readonly kind: NotificationKind;
  readonly readAt: Date | undefined;
  readonly subjectId: string;
}

export type NotificationListOutcome =
  | {
      readonly kind: 'page';
      readonly nextCursor: string | undefined;
      readonly notifications: readonly NotificationView[];
    }
  | { readonly kind: 'invalid_cursor' };

function viewOf(row: NotificationFeedRow): NotificationView {
  return {
    conversationId: row.conversationId ?? undefined,
    createdAt: row.createdAt,
    id: row.id,
    introductionId: row.introductionId ?? undefined,
    kind: row.kind as NotificationKind,
    readAt: row.readAt ?? undefined,
    subjectId: row.subjectId,
  };
}

export class NotificationFeedService {
  constructor(
    private readonly dependencies: {
      readonly now: () => Date;
      readonly repository: NotificationRepository;
      readonly safety: NotificationSafetyPort;
    },
  ) {}

  /**
   * One page of the caller's notices, safety-filtered.
   *
   * Filtering removes rows, which would otherwise make every page short, so the
   * read refills up to a fixed number of rounds. The bound is what keeps a
   * consumer whose feed is mostly blocked from turning one request into an
   * unbounded scan; when it is reached the page is returned short with its
   * continuation cursor, and a short page with a cursor never means "no more".
   */
  async list(
    viewer: UserAccountRow,
    input: { readonly cursor: string | undefined; readonly pageSize: number },
  ): Promise<NotificationListOutcome> {
    const decoded =
      input.cursor === undefined ? undefined : decodeFeedCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }

    const collected: NotificationFeedRow[] = [];
    let position: FeedCursor | undefined = decoded;
    let exhausted = false;
    let full = false;

    for (let round = 0; round < maximumFeedFilterRounds && !full; round += 1) {
      const limit =
        (input.pageSize - collected.length) * feedFilterOverFetchFactor;
      const batch = await this.dependencies.repository.listFeed(
        this.dependencies.repository.transactionless,
        { before: position, limit, recipientId: viewer.id },
      );
      if (batch.length === 0) {
        exhausted = true;
        break;
      }

      const blocked = await this.dependencies.safety.blockedAmong({
        candidateIds: [...new Set(batch.map((row) => row.subjectId))],
        executor: this.dependencies.repository.transactionless,
        viewerId: viewer.id,
      });
      for (const row of batch) {
        if (collected.length >= input.pageSize) {
          full = true;
          break;
        }
        // The position advances only over rows this call actually decided
        // about. A row the page had no room for is left for the next request:
        // advancing past it would silently drop it.
        position = { createdAt: row.createdAt, id: row.id };
        if (!blocked.has(row.subjectId)) collected.push(row);
      }
      // A batch shorter than what was asked for means the table had no more to
      // give, so there is nothing beyond the position just reached.
      if (!full && batch.length < limit) exhausted = true;
      if (exhausted) break;
    }

    return {
      kind: 'page',
      nextCursor:
        exhausted || position === undefined
          ? undefined
          : encodeFeedCursor(position),
      notifications: collected.map(viewOf),
    };
  }

  /**
   * Acknowledges notices, and reports only the ones that were the caller's.
   *
   * An identifier belonging to somebody else is absent from the answer rather
   * than refused, so this cannot be used to test whether a notification exists.
   */
  async markRead(
    viewer: UserAccountRow,
    ids: readonly string[],
  ): Promise<readonly string[]> {
    return this.dependencies.repository.markFeedRead(
      this.dependencies.repository.transactionless,
      { ids, now: this.dependencies.now(), recipientId: viewer.id },
    );
  }
}
