import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import { money, type Money } from '../money/money.js';
import type { OfferCursor } from './cursor.js';
import type { PaymentRow } from './payment-repository.js';
import {
  outstandingRefundStates,
  type RefundFailureReason,
  type RefundReasonCode,
  type RefundState,
} from './reversal-policy.js';
import { billingDisputes, billingPayments, billingRefunds } from './schema.js';

export type RefundRow = typeof billingRefunds.$inferSelect;

/**
 * Reversals of captured money.
 *
 * Two rules shape every method here, and both are about the same thing: a
 * refund is a claim on money that has already been counted, so the arithmetic
 * has to be right under simultaneous callers rather than merely right when read
 * one at a time.
 *
 * The first is that the payment row is locked before its outstanding reversals
 * are summed. Fifty concurrent requests to refund one charge therefore queue at
 * that lock and each sees the total the previous one committed, instead of
 * fifty callers reading zero and all deciding there was room. The database
 * enforces the same bound again with a trigger, because a rule the writer
 * upholds is a rule the next writer can break.
 *
 * The second is that a transition names the states it is willing to move from,
 * so a late provider answer cannot walk a settled reversal back into flight.
 */
export class RefundRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  /**
   * Takes the capture under lock, so every reversal against it is serialized.
   *
   * `for update` on the payment rather than on the refunds: there is nothing to
   * lock in a table whose contended rows do not exist yet, and locking the one
   * row every concurrent refund must consult is what turns a read-then-decide
   * race into a queue. The row itself is never modified — a capture is
   * immutable — so this is a lock taken purely for its ordering.
   */
  async lockPayment(
    executor: Executor,
    paymentId: string,
  ): Promise<PaymentRow | undefined> {
    const rows = await executor
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.id, paymentId))
      .limit(1)
      .for('update');
    return rows[0];
  }

  /**
   * What is already claimed against one capture.
   *
   * Everything except a refund the provider refused. A `failed` reversal
   * released the money it had reserved; every other state either moved money or
   * may still do so, and reserving against both is the only reading that cannot
   * over-refund. `sum` returns `numeric` in PostgreSQL, cast to text because a
   * numeric is not a JavaScript number and must never be read as one.
   */
  async outstandingTotal(
    executor: Executor,
    input: { readonly currency: string; readonly paymentId: string },
  ): Promise<Money> {
    const rows = await executor
      .select({
        total: sql<string>`coalesce(sum(${billingRefunds.amountMinor}), 0)::text`,
      })
      .from(billingRefunds)
      .where(
        and(
          eq(billingRefunds.paymentId, input.paymentId),
          inArray(billingRefunds.state, [...outstandingRefundStates]),
        ),
      );
    return money(BigInt(rows[0]?.total ?? '0'), input.currency);
  }

  /**
   * What has actually been returned against one capture.
   *
   * Deliberately not the same question as `outstandingTotal`. The bound on a
   * new reversal must reserve against every claim that might still move money,
   * or two operators would each be told there was room. Deciding that a
   * purchase has been *entirely* undone must count only money that has moved,
   * or a reversal that is merely requested would withdraw somebody's access and
   * a later refusal would leave it withdrawn for nothing.
   */
  async settledTotal(
    executor: Executor,
    input: { readonly currency: string; readonly paymentId: string },
  ): Promise<Money> {
    const rows = await executor
      .select({
        total: sql<string>`coalesce(sum(${billingRefunds.amountMinor}), 0)::text`,
      })
      .from(billingRefunds)
      .where(
        and(
          eq(billingRefunds.paymentId, input.paymentId),
          eq(billingRefunds.state, 'succeeded'),
        ),
      );
    return money(BigInt(rows[0]?.total ?? '0'), input.currency);
  }

  /**
   * Everything already unwound against one capture, excluding one reversal.
   *
   * The input the allocation arithmetic needs, and the reason it is exact. A
   * series of partial reversals is split by taking the allocation of the
   * cumulative total and subtracting the allocation of what came before, so
   * "what came before" has to count every reversal that has actually moved
   * money — settled refunds and lost disputes alike, because both withdraw the
   * same claims in the same proportions.
   *
   * The reversal being posted is excluded by identifier rather than by
   * arithmetic, because by the time this is asked it has already reached its
   * settled state and would otherwise count itself — which would make every
   * reversal look like the one that exhausted the capture.
   */
  async unwoundTotalExcluding(
    executor: Executor,
    input: {
      readonly currency: string;
      /** The claim being posted, when this is a dispute. */
      readonly exceptDisputeId?: string;
      /** The reversal being posted, when this is a refund. */
      readonly exceptRefundId?: string;
      readonly paymentId: string;
    },
  ): Promise<Money> {
    const exceptRefund = input.exceptRefundId ?? '';
    const exceptDispute = input.exceptDisputeId ?? '';
    const rows = await executor
      .select({
        total: sql<string>`(
          coalesce((
            select sum(${billingRefunds.amountMinor}) from ${billingRefunds}
             where ${billingRefunds.paymentId} = ${input.paymentId}
               and ${billingRefunds.state} = 'succeeded'
               and ${billingRefunds.id}::text <> ${exceptRefund}
          ), 0)
          + coalesce((
            select sum(${billingDisputes.amountMinor}) from ${billingDisputes}
             where ${billingDisputes.paymentId} = ${input.paymentId}
               and ${billingDisputes.state} = 'lost'
               and ${billingDisputes.id}::text <> ${exceptDispute}
          ), 0)
        )::text`,
      })
      .from(billingPayments)
      .where(eq(billingPayments.id, input.paymentId));
    return money(BigInt(rows[0]?.total ?? '0'), input.currency);
  }

  /**
   * Records the reversal, or returns nothing when this payment already has one
   * under this key.
   *
   * `on conflict do nothing` rather than a preceding read: two simultaneous
   * submissions of one instruction both insert, PostgreSQL admits one, and the
   * loser reads the winner's row.
   *
   * This is safe against the unarbitrated provider-key index only because
   * `lockPayment` has already taken the capture under a row lock by the time
   * this runs, so reversals of one payment are serialized before they get here
   * and never contend on that index. A caller that reaches this without that
   * lock reopens the race `lockIdempotentOperation` describes and must take
   * that lock instead.
   */
  async insertRefund(
    executor: Executor,
    input: {
      readonly amountMinor: bigint;
      readonly correlationId: string;
      readonly currency: string;
      readonly idempotencyKey: string;
      readonly initiatedBy: string;
      readonly now: Date;
      readonly paymentId: string;
      readonly provider: string;
      readonly providerIdempotencyKey: string;
      readonly reasonCode: RefundReasonCode;
    },
  ): Promise<RefundRow | undefined> {
    const inserted = await executor
      .insert(billingRefunds)
      .values({
        amountMinor: input.amountMinor,
        correlationId: input.correlationId,
        createdAt: input.now,
        currency: input.currency,
        id: crypto.randomUUID(),
        idempotencyKey: input.idempotencyKey,
        initiatedBy: input.initiatedBy,
        paymentId: input.paymentId,
        provider: input.provider,
        providerIdempotencyKey: input.providerIdempotencyKey,
        reasonCode: input.reasonCode,
        state: 'requested',
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing({
        target: [billingRefunds.paymentId, billingRefunds.idempotencyKey],
      })
      .returning();
    return inserted[0];
  }

  async findByIdempotency(
    executor: Executor,
    input: { readonly idempotencyKey: string; readonly paymentId: string },
  ): Promise<RefundRow | undefined> {
    const rows = await executor
      .select()
      .from(billingRefunds)
      .where(
        and(
          eq(billingRefunds.paymentId, input.paymentId),
          eq(billingRefunds.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findById(
    executor: Executor,
    refundId: string,
  ): Promise<RefundRow | undefined> {
    const rows = await executor
      .select()
      .from(billingRefunds)
      .where(eq(billingRefunds.id, refundId))
      .limit(1);
    return rows[0];
  }

  async findByProviderReference(
    executor: Executor,
    input: { readonly provider: string; readonly providerReference: string },
  ): Promise<RefundRow | undefined> {
    const rows = await executor
      .select()
      .from(billingRefunds)
      .where(
        and(
          eq(billingRefunds.provider, input.provider),
          eq(billingRefunds.providerReference, input.providerReference),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** Every reversal against one capture, oldest first. */
  async listForPayment(
    executor: Executor,
    paymentId: string,
  ): Promise<readonly RefundRow[]> {
    return executor
      .select()
      .from(billingRefunds)
      .where(eq(billingRefunds.paymentId, paymentId))
      .orderBy(asc(billingRefunds.createdAt), asc(billingRefunds.id));
  }

  /**
   * Reversals across every capture, newest first, keyset paged.
   *
   * Keyed on the creation instant and the identifier, which is the index order,
   * so an operator paging a long history pays for the page rather than for the
   * history.
   */
  async listRecent(
    executor: Executor,
    input: {
      readonly after: OfferCursor | undefined;
      readonly limit: number;
    },
  ): Promise<readonly RefundRow[]> {
    const after = input.after;
    return executor
      .select()
      .from(billingRefunds)
      .where(
        after === undefined
          ? undefined
          : or(
              lt(billingRefunds.createdAt, after.moment),
              and(
                eq(billingRefunds.createdAt, after.moment),
                lt(billingRefunds.id, after.id),
              ),
            ),
      )
      .orderBy(desc(billingRefunds.createdAt), desc(billingRefunds.id))
      .limit(input.limit);
  }

  /**
   * Moves a reversal forward, if it is still in a state that permits it.
   *
   * `from` never contains a terminal state, so a redelivered provider answer
   * against a settled reversal changes nothing and the caller is told so by
   * getting no row back.
   */
  async transition(
    executor: Executor,
    input: {
      readonly failureReason?: RefundFailureReason;
      readonly from: readonly RefundState[];
      readonly lastProviderSyncAt?: Date;
      readonly now: Date;
      readonly providerReference?: string;
      readonly refundId: string;
      readonly to: RefundState;
    },
  ): Promise<RefundRow | undefined> {
    const updated = await executor
      .update(billingRefunds)
      .set({
        ...(input.failureReason === undefined
          ? {}
          : { failureReason: input.failureReason }),
        ...(input.lastProviderSyncAt === undefined
          ? {}
          : { lastProviderSyncAt: input.lastProviderSyncAt }),
        ...(input.providerReference === undefined
          ? {}
          : { providerReference: input.providerReference }),
        state: input.to,
        updatedAt: input.now,
        version: sql`${billingRefunds.version} + 1`,
      })
      .where(
        and(
          eq(billingRefunds.id, input.refundId),
          inArray(billingRefunds.state, [...input.from]),
        ),
      )
      .returning();
    return updated[0];
  }
}
