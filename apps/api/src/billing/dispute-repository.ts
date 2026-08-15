import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import type { OfferCursor } from './cursor.js';
import {
  openDisputeStates,
  type DisputeReasonCode,
  type DisputeState,
} from './reversal-policy.js';
import { billingDisputes, billingPayments } from './schema.js';

export type DisputeRow = typeof billingDisputes.$inferSelect;

/**
 * Cardholder claims against captures.
 *
 * Nothing here originates a dispute. A dispute is somebody else's bank taking
 * money back, so the only thing that may create one of these rows is a verified
 * provider event — there is no route, no operator action, and no job that can
 * decide a dispute has happened.
 *
 * Establishment is deliberately tolerant of arrival order. A provider that
 * sends the resolution before the opening, or sends the opening twice, produces
 * one row either way: the unique provider reference decides, and the lifecycle
 * transition names the states it will move from so a late opening cannot walk a
 * resolved claim back to open.
 */
export class DisputeRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  /**
   * Records the claim, or returns nothing when this provider dispute is already
   * held.
   *
   * The state it is created in is whatever the event said, including a resolved
   * one. That is what makes an out-of-order delivery lossless: a resolution
   * arriving first establishes the dispute in its outcome rather than being
   * discarded for want of an opening that is still in flight.
   */
  async establish(
    executor: Executor,
    input: {
      readonly amountMinor: bigint;
      readonly currency: string;
      readonly evidenceDueAt: Date | undefined;
      readonly now: Date;
      readonly openedAt: Date;
      readonly paymentId: string;
      readonly provider: string;
      readonly providerReference: string;
      readonly reasonCode: DisputeReasonCode;
      readonly resolvedAt: Date | undefined;
      readonly state: DisputeState;
    },
  ): Promise<DisputeRow | undefined> {
    const inserted = await executor
      .insert(billingDisputes)
      .values({
        amountMinor: input.amountMinor,
        createdAt: input.now,
        currency: input.currency,
        evidenceDueAt: input.evidenceDueAt ?? null,
        id: crypto.randomUUID(),
        openedAt: input.openedAt,
        paymentId: input.paymentId,
        provider: input.provider,
        providerReference: input.providerReference,
        reasonCode: input.reasonCode,
        resolvedAt: input.resolvedAt ?? null,
        state: input.state,
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing({
        target: [billingDisputes.provider, billingDisputes.providerReference],
      })
      .returning();
    return inserted[0];
  }

  async findByProviderReference(
    executor: Executor,
    input: { readonly provider: string; readonly providerReference: string },
  ): Promise<DisputeRow | undefined> {
    const rows = await executor
      .select()
      .from(billingDisputes)
      .where(
        and(
          eq(billingDisputes.provider, input.provider),
          eq(billingDisputes.providerReference, input.providerReference),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listForPayment(
    executor: Executor,
    paymentId: string,
  ): Promise<readonly DisputeRow[]> {
    return executor
      .select()
      .from(billingDisputes)
      .where(eq(billingDisputes.paymentId, paymentId))
      .orderBy(asc(billingDisputes.openedAt), asc(billingDisputes.id));
  }

  /**
   * Whether this consumer has a live claim against any of their captures.
   *
   * The one question the commercial path asks of this table. It is answered
   * with a join to the capture rather than by holding a consumer identifier
   * here, because a dispute is a fact about a payment and duplicating the payer
   * onto it would create a second place for the two to disagree.
   */
  async hasOpenDisputeFor(
    executor: Executor,
    input: { readonly consumerId: string },
  ): Promise<boolean> {
    const rows = await executor
      .select({ present: sql<number>`1` })
      .from(billingDisputes)
      .innerJoin(
        billingPayments,
        eq(billingDisputes.paymentId, billingPayments.id),
      )
      .where(
        and(
          eq(billingPayments.consumerId, input.consumerId),
          inArray(billingDisputes.state, [...openDisputeStates]),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listRecent(
    executor: Executor,
    input: {
      readonly after: OfferCursor | undefined;
      readonly limit: number;
    },
  ): Promise<readonly DisputeRow[]> {
    const after = input.after;
    return executor
      .select()
      .from(billingDisputes)
      .where(
        after === undefined
          ? undefined
          : or(
              lt(billingDisputes.openedAt, after.moment),
              and(
                eq(billingDisputes.openedAt, after.moment),
                lt(billingDisputes.id, after.id),
              ),
            ),
      )
      .orderBy(desc(billingDisputes.openedAt), desc(billingDisputes.id))
      .limit(input.limit);
  }

  /**
   * Moves a claim, if it is still in a state that permits it.
   *
   * A resolved dispute is terminal. A provider redelivering the opening after
   * the outcome, or sending two outcomes, changes nothing and the caller learns
   * that by getting no row back.
   */
  async transition(
    executor: Executor,
    input: {
      readonly disputeId: string;
      readonly evidenceDueAt?: Date;
      readonly from: readonly DisputeState[];
      readonly now: Date;
      readonly resolvedAt?: Date;
      readonly to: DisputeState;
    },
  ): Promise<DisputeRow | undefined> {
    const updated = await executor
      .update(billingDisputes)
      .set({
        ...(input.evidenceDueAt === undefined
          ? {}
          : { evidenceDueAt: input.evidenceDueAt }),
        ...(input.resolvedAt === undefined
          ? {}
          : { resolvedAt: input.resolvedAt }),
        state: input.to,
        updatedAt: input.now,
        version: sql`${billingDisputes.version} + 1`,
      })
      .where(
        and(
          eq(billingDisputes.id, input.disputeId),
          inArray(billingDisputes.state, [...input.from]),
        ),
      )
      .returning();
    return updated[0];
  }
}
