import { and, asc, count, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type { AcquisitionEventName } from './policy.js';
import {
  growthAcquisitionEvents,
  growthInvites,
  growthLiveWindows,
  growthSignupAttributions,
} from './schema.js';

export type GrowthInviteRow = typeof growthInvites.$inferSelect;
export type GrowthLiveWindowRow = typeof growthLiveWindows.$inferSelect;
export type GrowthAttributionRow = typeof growthSignupAttributions.$inferSelect;

/**
 * GROWTH's only reader and writer.
 *
 * Every method takes the caller's executor, on the rule every other domain
 * follows: a check that commits separately from the write it authorises is not
 * a check. Nothing here decides anything — which code is minted, what a
 * campaign string is worth, and whether a window is honest are the service's
 * business.
 */
export class GrowthRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Records one invitation, or nothing when this account already has one.
   *
   * Idempotency is the unique index over the owner, not a prior read: two
   * presses a few milliseconds apart both pass a read and only one passes the
   * index. The loser reads back what the winner wrote, which is the same shape
   * every other idempotent write in this repository uses.
   */
  async insertInvite(
    executor: Executor,
    input: {
      readonly code: string;
      readonly id: string;
      readonly inviterUserId: string;
      readonly now: Date;
    },
  ): Promise<GrowthInviteRow | undefined> {
    const rows = await executor
      .insert(growthInvites)
      .values({
        code: input.code,
        createdAt: input.now,
        id: input.id,
        inviterUserId: input.inviterUserId,
      })
      .onConflictDoNothing()
      .returning();
    return rows.at(0);
  }

  async findInviteByOwner(
    executor: Executor,
    inviterUserId: string,
  ): Promise<GrowthInviteRow | undefined> {
    const rows = await executor
      .select()
      .from(growthInvites)
      .where(eq(growthInvites.inviterUserId, inviterUserId))
      .limit(1);
    return rows.at(0);
  }

  /** One usable invitation by code. A revoked one is absent, not reported. */
  async findUsableInviteByCode(
    executor: Executor,
    code: string,
  ): Promise<GrowthInviteRow | undefined> {
    const rows = await executor
      .select()
      .from(growthInvites)
      .where(and(eq(growthInvites.code, code), isNull(growthInvites.revokedAt)))
      .limit(1);
    return rows.at(0);
  }

  /**
   * Records where one account came from, or nothing if it already has an origin.
   *
   * The conflict target is the account, which is what makes a second
   * attribution impossible rather than merely refused. A caller that loses this
   * race has not failed: the account already has exactly the one origin it is
   * ever allowed.
   */
  async insertAttribution(
    executor: Executor,
    input: {
      readonly campaign: string | undefined;
      readonly content: string | undefined;
      readonly inviteId: string | undefined;
      readonly inviterUserId: string | undefined;
      readonly medium: string | undefined;
      readonly now: Date;
      readonly source: string;
      readonly userId: string;
    },
  ): Promise<GrowthAttributionRow | undefined> {
    const rows = await executor
      .insert(growthSignupAttributions)
      .values({
        attributedAt: input.now,
        campaign: input.campaign ?? null,
        content: input.content ?? null,
        inviteId: input.inviteId ?? null,
        inviterUserId: input.inviterUserId ?? null,
        medium: input.medium ?? null,
        source: input.source,
        userId: input.userId,
      })
      .onConflictDoNothing()
      .returning();
    return rows.at(0);
  }

  async findAttribution(
    executor: Executor,
    userId: string,
  ): Promise<GrowthAttributionRow | undefined> {
    const rows = await executor
      .select()
      .from(growthSignupAttributions)
      .where(eq(growthSignupAttributions.userId, userId))
      .limit(1);
    return rows.at(0);
  }

  /**
   * Records one acquisition fact.
   *
   * Deduplicated by the visitor's own opening key where there is one, so a
   * person refreshing an invitation page ten times is one opening. A row that
   * loses the conflict is not an error and is not reported as one: it is the
   * same visitor arriving again, which is exactly what the key is for.
   */
  async insertEvent(
    executor: Executor,
    input: {
      readonly campaign?: string | undefined;
      readonly dedupeKey?: string | undefined;
      readonly id: string;
      readonly inviteId?: string | undefined;
      readonly medium?: string | undefined;
      readonly name: AcquisitionEventName;
      readonly now: Date;
      readonly source?: string | undefined;
      readonly subjectId?: string | undefined;
    },
  ): Promise<void> {
    await executor
      .insert(growthAcquisitionEvents)
      .values({
        campaign: input.campaign ?? null,
        dedupeKey: input.dedupeKey ?? null,
        id: input.id,
        inviteId: input.inviteId ?? null,
        medium: input.medium ?? null,
        name: input.name,
        occurredAt: input.now,
        source: input.source ?? null,
        subjectId: input.subjectId ?? null,
      })
      .onConflictDoNothing();
  }

  /**
   * Withdraws every link one account holds, and says how many that was.
   *
   * Called when somebody closes their account. The row stays — the
   * attributions it already produced point at it, and deleting it would orphan
   * them — and stops being usable, which is exactly what `revokedAt` is for.
   *
   * Already-revoked links are left alone rather than re-stamped, so the instant
   * recorded is the one the link actually stopped working at.
   */
  async revokeInvitesByOwner(
    executor: Executor,
    input: { readonly now: Date; readonly ownerId: string },
  ): Promise<number> {
    const rows = await executor
      .update(growthInvites)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(growthInvites.inviterUserId, input.ownerId),
          isNull(growthInvites.revokedAt),
        ),
      )
      .returning({ id: growthInvites.id });
    return rows.length;
  }

  async countEventsSince(
    executor: Executor,
    input: { readonly name: AcquisitionEventName; readonly since: Date },
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(growthAcquisitionEvents)
      .where(
        and(
          eq(growthAcquisitionEvents.name, input.name),
          gte(growthAcquisitionEvents.occurredAt, input.since),
        ),
      );
    return rows.at(0)?.total ?? 0;
  }

  async countInvitesSince(executor: Executor, since: Date): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(growthInvites)
      .where(gte(growthInvites.createdAt, since));
    return rows.at(0)?.total ?? 0;
  }

  /**
   * Signups by channel over a window.
   *
   * Grouped by source and by nothing else. A breakdown per inviter would be one
   * person's social graph handed to an operator with no decision to make about
   * it, and this domain has no reason to be able to produce one.
   */
  async countSignupsBySource(
    executor: Executor,
    since: Date,
  ): Promise<readonly { readonly signups: number; readonly source: string }[]> {
    const rows = await executor
      .select({
        signups: count(),
        source: growthSignupAttributions.source,
      })
      .from(growthSignupAttributions)
      .where(gte(growthSignupAttributions.attributedAt, since))
      .groupBy(growthSignupAttributions.source)
      .orderBy(sql`count(*) desc`)
      .limit(50);
    return rows.map((row) => ({ signups: row.signups, source: row.source }));
  }

  /**
   * The windows worth publishing: not cancelled, not finished, starting soon.
   *
   * Ordered by start, which is the order somebody reads them in. A window that
   * has ended is absent rather than listed as ended, because the list is an
   * announcement of what is coming rather than a history of what happened.
   */
  async listPublishableWindows(
    executor: Executor,
    input: { readonly limit: number; readonly now: Date; readonly until: Date },
  ): Promise<readonly GrowthLiveWindowRow[]> {
    return executor
      .select()
      .from(growthLiveWindows)
      .where(
        and(
          isNull(growthLiveWindows.cancelledAt),
          gt(growthLiveWindows.endsAt, input.now),
          lte(growthLiveWindows.startsAt, input.until),
        ),
      )
      .orderBy(asc(growthLiveWindows.startsAt), asc(growthLiveWindows.id))
      .limit(input.limit);
  }

  async findWindowBySlug(
    executor: Executor,
    slug: string,
  ): Promise<GrowthLiveWindowRow | undefined> {
    const rows = await executor
      .select()
      .from(growthLiveWindows)
      .where(eq(growthLiveWindows.slug, slug))
      .limit(1);
    return rows.at(0);
  }

  /**
   * Schedules one window, or moves the one already at this address.
   *
   * Re-scheduling rather than refusing, because an operator correcting a time
   * they got wrong is the ordinary case and a second window at the same address
   * is not a thing this product can serve. Cancelling is cleared by the same
   * write: re-scheduling a withdrawn window is how it comes back.
   */
  async upsertWindow(
    executor: Executor,
    input: {
      readonly endsAt: Date;
      readonly id: string;
      readonly now: Date;
      readonly slug: string;
      readonly startsAt: Date;
      readonly title: string;
    },
  ): Promise<void> {
    await executor
      .insert(growthLiveWindows)
      .values({
        createdAt: input.now,
        endsAt: input.endsAt,
        id: input.id,
        slug: input.slug,
        startsAt: input.startsAt,
        title: input.title,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        set: {
          cancelledAt: null,
          endsAt: input.endsAt,
          startsAt: input.startsAt,
          title: input.title,
          updatedAt: input.now,
        },
        target: growthLiveWindows.slug,
      });
  }

  /** Withdraws one window. Already cancelled and never existing are one answer. */
  async cancelWindow(
    executor: Executor,
    input: { readonly now: Date; readonly slug: string },
  ): Promise<void> {
    await executor
      .update(growthLiveWindows)
      .set({ cancelledAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(growthLiveWindows.slug, input.slug),
          isNull(growthLiveWindows.cancelledAt),
        ),
      );
  }
}
