import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type {
  AttemptOutcome,
  DeliveryFailureClass,
  NotificationCategory,
  NotificationChannel,
  NotificationKind,
  NotificationPurpose,
  ProviderFeedbackType,
  PushDeviceDisableReason,
  PushPlatform,
  SuppressionReason,
} from './policy.js';
import {
  notificationAttempts,
  notificationFeed,
  notificationIntents,
  notificationPreferences,
  notificationProviderEvents,
  notificationPushDevices,
} from './schema.js';

export type NotificationIntentRow = typeof notificationIntents.$inferSelect;
export type NotificationAttemptRow = typeof notificationAttempts.$inferSelect;
export type NotificationFeedRow = typeof notificationFeed.$inferSelect;
export type NotificationPreferenceRow =
  typeof notificationPreferences.$inferSelect;
export type NotificationPushDeviceRow =
  typeof notificationPushDevices.$inferSelect;
export type NotificationProviderEventRow =
  typeof notificationProviderEvents.$inferSelect;

/**
 * Every NOTIFICATIONS read and write.
 *
 * Nothing here reads another domain's tables. Whether the recipient may still
 * be told is asked through published contracts at delivery time, and the answer
 * is never stored: a cached safety verdict is a stale safety verdict.
 *
 * Every state transition below is a compare-and-set. Two workers may hold the
 * same row in mind at once — one whose lease expired mid-flight and one that
 * has since claimed it — and the predicate is what makes exactly one of them
 * the writer.
 */
export class NotificationRepository {
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
   * Records a notice as owed, or reports that it already is.
   *
   * The unique index over source event, recipient, and template decides — not a
   * prior read, which two concurrent relays would both pass. This is the inbox:
   * the relay redelivers whenever a worker dies between this insert and the
   * dispatch being recorded, and the second arrival must change nothing.
   */
  async insertIntent(
    executor: Executor,
    input: {
      readonly channel: NotificationChannel;
      readonly correlationId: string | null;
      readonly expiresAt: Date;
      readonly now: Date;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly purpose: NotificationPurpose;
      readonly recipientId: string;
      readonly sourceEventId: string;
      readonly sourceProducer: string;
      readonly subjectId: string | null;
      readonly templateKey: string;
    },
  ): Promise<NotificationIntentRow | undefined> {
    const inserted = await executor
      .insert(notificationIntents)
      .values({
        channel: input.channel,
        correlationId: input.correlationId,
        createdAt: input.now,
        expiresAt: input.expiresAt,
        id: crypto.randomUUID(),
        // Due immediately. A notice is worth sending the moment it is owed.
        nextAttemptAt: input.now,
        payload: input.payload,
        purpose: input.purpose,
        recipientId: input.recipientId,
        sourceEventId: input.sourceEventId,
        sourceProducer: input.sourceProducer,
        state: 'queued',
        subjectId: input.subjectId,
        templateKey: input.templateKey,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findById(
    executor: Executor,
    id: string,
  ): Promise<NotificationIntentRow | undefined> {
    const rows = await executor
      .select()
      .from(notificationIntents)
      .where(eq(notificationIntents.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Notices that are due, as hints.
   *
   * Deliberately unlocked. The caller needs the recipient and subject before it
   * can take the pair lock, and the pair lock has to be taken before any row
   * lock — so this read happens outside the claiming transaction, exactly as
   * MESSAGING reads a membership hint before locking. Everything is re-read
   * under the lock, so a stale hint costs a wasted lock and never a wrong
   * decision.
   *
   * `attempted` rows whose lease has lapsed are included. That is the crash
   * recovery path: a worker that died holding a claim released nothing, and
   * expiry is what brings its work back.
   */
  async listDue(
    executor: Executor,
    input: { readonly limit: number; readonly now: Date },
  ): Promise<readonly NotificationIntentRow[]> {
    return executor
      .select()
      .from(notificationIntents)
      .where(
        or(
          and(
            eq(notificationIntents.state, 'queued'),
            lte(notificationIntents.nextAttemptAt, input.now),
          ),
          and(
            eq(notificationIntents.state, 'attempted'),
            lte(notificationIntents.leaseExpiresAt, input.now),
          ),
        ),
      )
      .orderBy(
        asc(notificationIntents.nextAttemptAt),
        asc(notificationIntents.createdAt),
      )
      .limit(input.limit);
  }

  /**
   * Locks one intent for claiming, or steps over it.
   *
   * `skip locked` rather than a wait: a row another worker is actively
   * settling will be in a state this one cannot claim by the time the lock is
   * released, so waiting for it only holds the pair lock longer.
   */
  async lockClaimable(
    executor: TransactionHandle,
    input: { readonly id: string; readonly now: Date },
  ): Promise<NotificationIntentRow | undefined> {
    const rows = await executor
      .select()
      .from(notificationIntents)
      .where(
        and(
          eq(notificationIntents.id, input.id),
          or(
            and(
              eq(notificationIntents.state, 'queued'),
              lte(notificationIntents.nextAttemptAt, input.now),
            ),
            and(
              eq(notificationIntents.state, 'attempted'),
              lte(notificationIntents.leaseExpiresAt, input.now),
            ),
          ),
        ),
      )
      .limit(1)
      .for('update', { skipLocked: true });
    return rows[0];
  }

  /**
   * Takes the claim: counts the attempt, leases the row, and moves it to
   * `attempted`.
   *
   * The attempt is counted here, before the provider is called, and that is
   * deliberate. A worker killed mid-call leaves no evidence of what it did, so
   * the only safe assumption is that it did something; charging the budget at
   * claim time is what makes a notice that crashes every worker retire instead
   * of being retried forever.
   */
  async claim(
    executor: Executor,
    input: {
      readonly expectedVersion: number;
      readonly id: string;
      readonly leaseExpiresAt: Date;
      readonly now: Date;
      readonly owner: string;
    },
  ): Promise<NotificationIntentRow | undefined> {
    const updated = await executor
      .update(notificationIntents)
      .set({
        attempts: sql`${notificationIntents.attempts} + 1`,
        leaseExpiresAt: input.leaseExpiresAt,
        leaseOwner: input.owner,
        state: 'attempted',
        updatedAt: input.now,
        version: sql`${notificationIntents.version} + 1`,
      })
      .where(
        and(
          eq(notificationIntents.id, input.id),
          eq(notificationIntents.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Terminal success.
   *
   * The lease owner is in the predicate, so a worker whose claim expired while
   * a provider call was in flight cannot report a delivery over the claim
   * somebody else now holds.
   */
  async settleDelivered(
    executor: Executor,
    input: { readonly id: string; readonly now: Date; readonly owner: string },
  ): Promise<NotificationIntentRow | undefined> {
    const updated = await executor
      .update(notificationIntents)
      .set({
        deliveredAt: input.now,
        failureReason: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        state: 'delivered',
        updatedAt: input.now,
        version: sql`${notificationIntents.version} + 1`,
      })
      .where(this.heldBy(input.id, input.owner))
      .returning();
    return updated[0];
  }

  /**
   * Terminal suppression.
   *
   * Reached without any provider call ever being made. That ordering is the
   * point of the whole delivery path: a notice suppressed for safety must not
   * have left the building first.
   */
  async settleSuppressed(
    executor: Executor,
    input: {
      readonly id: string;
      readonly now: Date;
      readonly owner: string;
      readonly reason: SuppressionReason;
    },
  ): Promise<NotificationIntentRow | undefined> {
    const updated = await executor
      .update(notificationIntents)
      .set({
        leaseExpiresAt: null,
        leaseOwner: null,
        state: 'suppressed',
        suppressionReason: input.reason,
        updatedAt: input.now,
        version: sql`${notificationIntents.version} + 1`,
      })
      .where(this.heldBy(input.id, input.owner))
      .returning();
    return updated[0];
  }

  /**
   * Returns a failed notice for a later attempt, or retires it.
   *
   * Retirement is a state, never a delete. A dead-lettered notice is the
   * durable evidence that the platform owed somebody something and did not
   * deliver it, and repair needs the payload it still holds.
   */
  async settleFailed(
    executor: Executor,
    input: {
      readonly deadLetter: boolean;
      readonly id: string;
      readonly nextAttemptAt: Date;
      readonly now: Date;
      readonly owner: string;
      readonly reason: string;
    },
  ): Promise<NotificationIntentRow | undefined> {
    const updated = await executor
      .update(notificationIntents)
      .set({
        failureReason: input.reason,
        leaseExpiresAt: null,
        leaseOwner: null,
        nextAttemptAt: input.nextAttemptAt,
        state: input.deadLetter ? 'dead_letter' : 'queued',
        updatedAt: input.now,
        version: sql`${notificationIntents.version} + 1`,
      })
      .where(this.heldBy(input.id, input.owner))
      .returning();
    return updated[0];
  }

  /**
   * Releases a claim for a notice that was never attempted, restoring the
   * attempt count.
   *
   * Used when no delivery channel is configured. Nothing was asked of anybody,
   * so nothing was spent: the notice stays owed, indefinitely if need be, and
   * is still subject to a fresh safety recheck whenever a provider appears.
   */
  async releaseUnattempted(
    executor: Executor,
    input: {
      readonly attempts: number;
      readonly id: string;
      readonly nextAttemptAt: Date;
      readonly now: Date;
      readonly owner: string;
    },
  ): Promise<NotificationIntentRow | undefined> {
    const updated = await executor
      .update(notificationIntents)
      .set({
        attempts: input.attempts,
        leaseExpiresAt: null,
        leaseOwner: null,
        nextAttemptAt: input.nextAttemptAt,
        state: 'queued',
        updatedAt: input.now,
        version: sql`${notificationIntents.version} + 1`,
      })
      .where(this.heldBy(input.id, input.owner))
      .returning();
    return updated[0];
  }

  /** Appends the record of one attempt. Nothing here is ever updated. */
  async insertAttempt(
    executor: Executor,
    input: {
      readonly attemptNumber: number;
      readonly channel: NotificationChannel;
      readonly failureClass: DeliveryFailureClass | null;
      readonly failureReason: string | null;
      readonly intentId: string;
      readonly now: Date;
      readonly outcome: AttemptOutcome;
      readonly providerReference: string | null;
    },
  ): Promise<NotificationAttemptRow | undefined> {
    const inserted = await executor
      .insert(notificationAttempts)
      .values({
        attemptNumber: input.attemptNumber,
        channel: input.channel,
        createdAt: input.now,
        failureClass: input.failureClass,
        failureReason: input.failureReason,
        intentId: input.intentId,
        outcome: input.outcome,
        providerReference: input.providerReference,
      })
      // A reclaimed lease can replay an attempt number. The index decides, and
      // a repeated record of the same attempt is not a second attempt.
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /**
   * Records the in-app line, or reports that it already exists.
   *
   * Same inbox key as the intent, and called in the same transaction, so a
   * relay redelivery produces neither a second notice nor a second line.
   */
  async insertFeedEntry(
    executor: Executor,
    input: {
      readonly callId: string | null;
      readonly conversationId: string | null;
      readonly introductionId: string | null;
      readonly kind: NotificationKind;
      readonly now: Date;
      readonly recipientId: string;
      readonly sourceEventId: string;
      readonly subjectId: string;
      readonly templateKey: string;
    },
  ): Promise<NotificationFeedRow | undefined> {
    const inserted = await executor
      .insert(notificationFeed)
      .values({
        callId: input.callId,
        conversationId: input.conversationId,
        createdAt: input.now,
        id: crypto.randomUUID(),
        introductionId: input.introductionId,
        kind: input.kind,
        recipientId: input.recipientId,
        sourceEventId: input.sourceEventId,
        subjectId: input.subjectId,
        templateKey: input.templateKey,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /**
   * One person's notices, newest first.
   *
   * Scoped to the recipient in the predicate rather than checked afterwards, so
   * a tampered cursor can only move a caller around their own rows. Paging is
   * keyset on the creation instant and the identifier, both immutable, so a
   * page boundary cannot move underneath a reader.
   */
  async listFeed(
    executor: Executor,
    input: {
      readonly before:
        { readonly createdAt: Date; readonly id: string } | undefined;
      readonly limit: number;
      readonly recipientId: string;
    },
  ): Promise<readonly NotificationFeedRow[]> {
    const position =
      input.before === undefined
        ? undefined
        : or(
            lt(notificationFeed.createdAt, input.before.createdAt),
            and(
              eq(notificationFeed.createdAt, input.before.createdAt),
              lt(notificationFeed.id, input.before.id),
            ),
          );
    return executor
      .select()
      .from(notificationFeed)
      .where(and(eq(notificationFeed.recipientId, input.recipientId), position))
      .orderBy(desc(notificationFeed.createdAt), desc(notificationFeed.id))
      .limit(input.limit);
  }

  /**
   * Acknowledges notices the caller owns.
   *
   * Ownership is in the predicate, so an identifier belonging to somebody else
   * updates nothing and the caller cannot tell whether it existed. `read_at` is
   * only set where it is null, which makes a repeated acknowledgement keep the
   * first instant rather than moving it.
   */
  async markFeedRead(
    executor: Executor,
    input: {
      readonly ids: readonly string[];
      readonly now: Date;
      readonly recipientId: string;
    },
  ): Promise<readonly string[]> {
    if (input.ids.length === 0) return [];
    const updated = await executor
      .update(notificationFeed)
      .set({ readAt: input.now })
      .where(
        and(
          inArray(notificationFeed.id, [...input.ids]),
          eq(notificationFeed.recipientId, input.recipientId),
          isNull(notificationFeed.readAt),
        ),
      )
      .returning({ id: notificationFeed.id });
    return updated.map((row) => row.id);
  }

  /**
   * One person's decision about one category on one channel.
   *
   * `undefined` means no row, which is "never asked" rather than "off". The
   * default for a category belongs to policy, not here, so changing a default
   * does not require rewriting rows nobody ever set.
   */
  async preferenceFor(
    executor: Executor,
    input: {
      readonly category: NotificationCategory;
      readonly channel: NotificationChannel;
      readonly recipientId: string;
    },
  ): Promise<boolean | undefined> {
    const rows = await executor
      .select({ enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.recipientId, input.recipientId),
          eq(notificationPreferences.category, input.category),
          eq(notificationPreferences.channel, input.channel),
        ),
      )
      .limit(1);
    return rows[0]?.enabled;
  }

  /** Every decision this person has expressed. Their own rows and no others. */
  async listPreferences(
    executor: Executor,
    recipientId: string,
  ): Promise<readonly NotificationPreferenceRow[]> {
    return executor
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.recipientId, recipientId))
      .orderBy(
        notificationPreferences.category,
        notificationPreferences.channel,
      );
  }

  /**
   * Records a decision, replacing any earlier one for the same triple.
   *
   * A disabled mandatory category is refused by the table's own CHECK rather
   * than by a branch here, so every write path inherits the refusal instead of
   * having to remember it.
   */
  async setPreference(
    executor: Executor,
    input: {
      readonly category: NotificationCategory;
      readonly channel: NotificationChannel;
      readonly enabled: boolean;
      readonly now: Date;
      readonly recipientId: string;
    },
  ): Promise<void> {
    await executor
      .insert(notificationPreferences)
      .values({
        category: input.category,
        channel: input.channel,
        createdAt: input.now,
        enabled: input.enabled,
        recipientId: input.recipientId,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        set: { enabled: input.enabled, updatedAt: input.now },
        target: [
          notificationPreferences.recipientId,
          notificationPreferences.category,
          notificationPreferences.channel,
        ],
      });
  }

  /**
   * Retires every live registration holding this token, except the one this
   * principal is about to take.
   *
   * The `except` is what makes re-registering an unchanged token idempotent
   * rather than a retirement followed by an insert.
   */
  async disableDevicesByFingerprint(
    executor: Executor,
    input: {
      readonly exceptRecipientId: string;
      readonly now: Date;
      readonly reason: PushDeviceDisableReason;
      readonly tokenFingerprint: string;
    },
  ): Promise<void> {
    await executor
      .update(notificationPushDevices)
      .set({ disableReason: input.reason, disabledAt: input.now })
      .where(
        and(
          eq(notificationPushDevices.tokenFingerprint, input.tokenFingerprint),
          isNull(notificationPushDevices.disabledAt),
          ne(notificationPushDevices.recipientId, input.exceptRecipientId),
        ),
      );
  }

  /** Retires this installation's live registrations. */
  async disableDevicesByInstallation(
    executor: Executor,
    input: {
      readonly exceptTokenFingerprint?: string;
      readonly installationId: string;
      readonly now: Date;
      readonly reason: PushDeviceDisableReason;
      readonly recipientId: string;
    },
  ): Promise<void> {
    await executor
      .update(notificationPushDevices)
      .set({ disableReason: input.reason, disabledAt: input.now })
      .where(
        and(
          eq(notificationPushDevices.recipientId, input.recipientId),
          eq(notificationPushDevices.installationId, input.installationId),
          isNull(notificationPushDevices.disabledAt),
          ...(input.exceptTokenFingerprint === undefined
            ? []
            : [
                ne(
                  notificationPushDevices.tokenFingerprint,
                  input.exceptTokenFingerprint,
                ),
              ]),
        ),
      );
  }

  /**
   * Records a live registration, or refreshes the one that is already there.
   *
   * A repeated registration of an unchanged token is a heartbeat rather than a
   * new device, so it moves `lastSeenAt` and nothing else. That is what keeps
   * an app that registers on every launch from accumulating rows.
   */
  async upsertPushDevice(
    executor: Executor,
    input: {
      readonly installationId: string;
      readonly now: Date;
      readonly platform: PushPlatform;
      readonly recipientId: string;
      readonly tokenFingerprint: string;
    },
  ): Promise<NotificationPushDeviceRow> {
    const inserted = await executor
      .insert(notificationPushDevices)
      .values({
        createdAt: input.now,
        id: crypto.randomUUID(),
        installationId: input.installationId,
        lastSeenAt: input.now,
        platform: input.platform,
        recipientId: input.recipientId,
        tokenFingerprint: input.tokenFingerprint,
      })
      .onConflictDoUpdate({
        set: {
          installationId: input.installationId,
          lastSeenAt: input.now,
          platform: input.platform,
          recipientId: input.recipientId,
        },
        target: notificationPushDevices.tokenFingerprint,
        targetWhere: isNull(notificationPushDevices.disabledAt),
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new Error('push device registration produced no row');
    }
    return row;
  }

  /** Every device this person can currently be reached on. */
  async listActivePushDevices(
    executor: Executor,
    recipientId: string,
  ): Promise<readonly NotificationPushDeviceRow[]> {
    return executor
      .select()
      .from(notificationPushDevices)
      .where(
        and(
          eq(notificationPushDevices.recipientId, recipientId),
          isNull(notificationPushDevices.disabledAt),
        ),
      )
      .orderBy(notificationPushDevices.createdAt);
  }

  /**
   * Records a verified provider event, or recognises one already seen.
   *
   * `onConflictDoNothing` against the identity index is the whole duplicate
   * story: the fiftieth delivery of one event costs one refused insert, and no
   * caller has to read first to find out.
   */
  async recordProviderEvent(
    executor: Executor,
    input: {
      readonly feedbackType: ProviderFeedbackType;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly payloadDigest: string;
      readonly provider: string;
      readonly providerAccount: string;
      readonly providerEnvironment: string;
      readonly providerEventId: string;
      readonly providerReference?: string | undefined;
      readonly tokenFingerprint?: string | undefined;
    },
  ): Promise<void> {
    await executor
      .insert(notificationProviderEvents)
      .values({
        availableAt: input.now,
        feedbackType: input.feedbackType,
        id: crypto.randomUUID(),
        occurredAt: input.occurredAt,
        payloadDigest: input.payloadDigest,
        provider: input.provider,
        providerAccount: input.providerAccount,
        providerEnvironment: input.providerEnvironment,
        providerEventId: input.providerEventId,
        providerReference: input.providerReference ?? null,
        receivedAt: input.now,
        state: 'received',
        tokenFingerprint: input.tokenFingerprint ?? null,
      })
      .onConflictDoNothing();
  }

  /** Verified events waiting to be applied, oldest first. */
  async listClaimableProviderEvents(
    executor: Executor,
    input: { readonly limit: number; readonly now: Date },
  ): Promise<readonly NotificationProviderEventRow[]> {
    return executor
      .select()
      .from(notificationProviderEvents)
      .where(
        and(
          inArray(notificationProviderEvents.state, ['received', 'retry_wait']),
          lte(notificationProviderEvents.availableAt, input.now),
          or(
            isNull(notificationProviderEvents.leaseExpiresAt),
            lt(notificationProviderEvents.leaseExpiresAt, input.now),
          ),
        ),
      )
      .orderBy(
        asc(notificationProviderEvents.availableAt),
        asc(notificationProviderEvents.id),
      )
      .limit(input.limit);
  }

  /** Takes a lease, or reports that somebody else already holds one. */
  async claimProviderEvent(
    executor: Executor,
    input: {
      readonly id: string;
      readonly leaseExpiresAt: Date;
      readonly now: Date;
      readonly owner: string;
    },
  ): Promise<NotificationProviderEventRow | undefined> {
    const claimed = await executor
      .update(notificationProviderEvents)
      .set({
        attempts: sql`${notificationProviderEvents.attempts} + 1`,
        leaseExpiresAt: input.leaseExpiresAt,
        leaseOwner: input.owner,
      })
      .where(
        and(
          eq(notificationProviderEvents.id, input.id),
          inArray(notificationProviderEvents.state, ['received', 'retry_wait']),
          lte(notificationProviderEvents.availableAt, input.now),
          or(
            isNull(notificationProviderEvents.leaseExpiresAt),
            lt(notificationProviderEvents.leaseExpiresAt, input.now),
          ),
        ),
      )
      .returning();
    return claimed[0];
  }

  async settleProviderEvent(
    executor: Executor,
    input: {
      readonly failureReason?: string | undefined;
      readonly id: string;
      readonly now: Date;
      readonly owner: string;
      readonly state: 'processed' | 'retry_wait' | 'dead_letter';
      readonly availableAt?: Date | undefined;
    },
  ): Promise<NotificationProviderEventRow | undefined> {
    const settled = await executor
      .update(notificationProviderEvents)
      .set({
        ...(input.availableAt === undefined
          ? {}
          : { availableAt: input.availableAt }),
        failureReason: input.failureReason ?? null,
        leaseExpiresAt: null,
        leaseOwner: null,
        processedAt: input.state === 'processed' ? input.now : null,
        state: input.state,
      })
      .where(
        and(
          eq(notificationProviderEvents.id, input.id),
          eq(notificationProviderEvents.leaseOwner, input.owner),
        ),
      )
      .returning();
    return settled[0];
  }

  /**
   * Retires every live registration holding this fingerprint.
   *
   * Used when a provider reports a token invalid. Unlike registration, this
   * spares nobody: a token the provider retired is one no account can be
   * reached on.
   */
  async disableDevicesByProviderInvalidation(
    executor: Executor,
    input: { readonly now: Date; readonly tokenFingerprint: string },
  ): Promise<number> {
    const disabled = await executor
      .update(notificationPushDevices)
      .set({
        disableReason: 'provider_invalidated',
        disabledAt: input.now,
      })
      .where(
        and(
          eq(notificationPushDevices.tokenFingerprint, input.tokenFingerprint),
          isNull(notificationPushDevices.disabledAt),
        ),
      )
      .returning();
    return disabled.length;
  }

  private heldBy(id: string, owner: string) {
    return and(
      eq(notificationIntents.id, id),
      eq(notificationIntents.state, 'attempted'),
      eq(notificationIntents.leaseOwner, owner),
    );
  }
}
