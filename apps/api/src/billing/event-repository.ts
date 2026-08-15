import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import type { ProviderEventState } from './subscription-policy.js';
import { billingProviderEvents } from './schema.js';

export type ProviderEventRow = typeof billingProviderEvents.$inferSelect;

/**
 * The verified provider-event inbox.
 *
 * Claiming is a database lease taken with `for update skip locked`, exactly as
 * the outbox relay claims what it publishes. That is what makes a worker killed
 * mid-processing recoverable: the claim expires and the next worker takes the
 * row, rather than the row being stranded in a process that no longer exists.
 *
 * An attempt is counted when the claim is taken, not when processing answers.
 * An event whose handling kills every worker therefore retires instead of
 * being retried forever.
 */
export class ProviderEventRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  /**
   * Records a verified receipt, or returns nothing when the event is already
   * held.
   *
   * Redelivery is normal. The unique index decides, so the fifth copy of an
   * event is a no-op rather than a fifth effect, and the endpoint can
   * acknowledge it without the handler knowing whether it was the first.
   */
  async receive(
    executor: Executor,
    input: {
      readonly amountMinor: bigint | undefined;
      readonly currency: string | undefined;
      readonly eventType: string;
      readonly evidenceDueAt: Date | undefined;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly payloadDigest: string;
      readonly provider: string;
      readonly providerDisputeReference: string | undefined;
      readonly providerEventId: string;
      readonly providerPaymentReference: string | undefined;
      readonly providerRefundReference: string | undefined;
      readonly reasonCode: string | undefined;
      readonly status: string | undefined;
    },
  ): Promise<ProviderEventRow | undefined> {
    const inserted = await executor
      .insert(billingProviderEvents)
      .values({
        amountMinor: input.amountMinor ?? null,
        attempts: 0,
        availableAt: input.now,
        currency: input.currency ?? null,
        eventType: input.eventType,
        evidenceDueAt: input.evidenceDueAt ?? null,
        id: crypto.randomUUID(),
        occurredAt: input.occurredAt,
        payloadDigest: input.payloadDigest,
        provider: input.provider,
        providerDisputeReference: input.providerDisputeReference ?? null,
        providerEventId: input.providerEventId,
        providerPaymentReference: input.providerPaymentReference ?? null,
        providerRefundReference: input.providerRefundReference ?? null,
        reasonCode: input.reasonCode ?? null,
        receivedAt: input.now,
        state: 'received',
        status: input.status ?? null,
      })
      .onConflictDoNothing({
        target: [
          billingProviderEvents.provider,
          billingProviderEvents.providerEventId,
        ],
      })
      .returning();
    return inserted[0];
  }

  async findByIdentity(
    executor: Executor,
    input: { readonly provider: string; readonly providerEventId: string },
  ): Promise<ProviderEventRow | undefined> {
    const rows = await executor
      .select()
      .from(billingProviderEvents)
      .where(
        and(
          eq(billingProviderEvents.provider, input.provider),
          eq(billingProviderEvents.providerEventId, input.providerEventId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Takes a batch under a lease.
   *
   * `skip locked` so two workers draining the same inbox never wait on each
   * other, and an expired lease so a worker that died holding one releases it
   * by the passage of time rather than by anything remembering it.
   */
  async claim(input: {
    readonly leaseMilliseconds: number;
    readonly limit: number;
    readonly now: Date;
    readonly owner: string;
  }): Promise<readonly ProviderEventRow[]> {
    const leaseExpiresAt = new Date(
      input.now.getTime() + input.leaseMilliseconds,
    );
    return this.database.transaction(async (executor) => {
      const candidates = await executor
        .select({ id: billingProviderEvents.id })
        .from(billingProviderEvents)
        .where(
          and(
            or(
              eq(billingProviderEvents.state, 'received'),
              eq(billingProviderEvents.state, 'retry_wait'),
            ),
            lte(billingProviderEvents.availableAt, input.now),
            or(
              isNull(billingProviderEvents.leaseExpiresAt),
              lte(billingProviderEvents.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(
          asc(billingProviderEvents.availableAt),
          asc(billingProviderEvents.id),
        )
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (candidates.length === 0) return [];
      const claimed: ProviderEventRow[] = [];
      for (const candidate of candidates) {
        const rows = await executor
          .update(billingProviderEvents)
          .set({
            attempts: sql`${billingProviderEvents.attempts} + 1`,
            leaseExpiresAt,
            leaseOwner: input.owner,
          })
          .where(eq(billingProviderEvents.id, candidate.id))
          .returning();
        const row = rows[0];
        if (row !== undefined) claimed.push(row);
      }
      return claimed;
    });
  }

  /**
   * Settles a claimed row, if this worker still holds the claim.
   *
   * The lease owner is in the predicate, so a worker whose lease expired
   * mid-flight cannot write over the claim somebody else now holds.
   */
  async settle(
    executor: Executor,
    input: {
      readonly availableAt?: Date;
      readonly failureReason?: string;
      readonly id: string;
      readonly now: Date;
      readonly owner: string;
      readonly state: ProviderEventState;
    },
  ): Promise<boolean> {
    const settled = input.state === 'processed' || input.state === 'ignored';
    const updated = await executor
      .update(billingProviderEvents)
      .set({
        ...(input.availableAt === undefined
          ? {}
          : { availableAt: input.availableAt }),
        ...(input.failureReason === undefined
          ? {}
          : { failureReason: input.failureReason }),
        leaseExpiresAt: null,
        leaseOwner: null,
        processedAt: settled ? input.now : null,
        state: input.state,
      })
      .where(
        and(
          eq(billingProviderEvents.id, input.id),
          eq(billingProviderEvents.leaseOwner, input.owner),
        ),
      )
      .returning({ id: billingProviderEvents.id });
    return updated.length > 0;
  }
}
