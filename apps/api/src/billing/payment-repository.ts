import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import { lockIdempotentOperation } from '../database/idempotency-lock.js';
import type { OfferCursor } from './cursor.js';
import type { PaymentFailureReason, PaymentState } from './payment-policy.js';
import { billingPayments } from './schema.js';

export type PaymentRow = typeof billingPayments.$inferSelect;

/**
 * Payment operations.
 *
 * Two rules shape every method. A read that could reach somebody else's
 * payment puts the consumer in the predicate, so an identifier belonging to
 * another person is indistinguishable from one that does not exist. And a
 * transition names the states it is willing to move from, so a late provider
 * answer cannot resurrect an operation that has already settled or been
 * abandoned — the predicate loses, and the caller is told nothing changed.
 */
export class PaymentRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  /**
   * Establishes the operation, or returns nothing when this consumer already
   * has one for this offer under this key.
   *
   * Fifty simultaneous submissions of one purchase converge on one row, and it
   * takes both of the things here to get there. The advisory lock is what makes
   * the establishment of one operation identity happen once at a time, so a
   * loser reads the winner's committed row rather than racing it into the
   * provider-key index — `lockIdempotentOperation` explains why arbitrating a
   * single index is not enough on its own. `on conflict do nothing` then
   * resolves the ordinary case, a duplicate that is already committed, without
   * a retry loop and without a window in which two operations exist.
   */
  async insertOperation(
    executor: TransactionHandle,
    input: {
      readonly amountMinor: bigint;
      readonly consumerId: string;
      readonly correlationId: string;
      readonly currency: string;
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly offerId: string;
      readonly priceId: string;
      readonly provider: string;
      readonly providerIdempotencyKey: string;
      readonly taxAuthority: string;
      readonly taxMinor: bigint;
    },
  ): Promise<PaymentRow | undefined> {
    await lockIdempotentOperation(
      executor,
      'billing_payments',
      input.consumerId,
      input.offerId,
      input.idempotencyKey,
    );
    const inserted = await executor
      .insert(billingPayments)
      .values({
        amountMinor: input.amountMinor,
        consumerId: input.consumerId,
        correlationId: input.correlationId,
        createdAt: input.now,
        currency: input.currency,
        id: crypto.randomUUID(),
        idempotencyKey: input.idempotencyKey,
        offerId: input.offerId,
        priceId: input.priceId,
        provider: input.provider,
        providerIdempotencyKey: input.providerIdempotencyKey,
        state: 'created',
        taxAuthority: input.taxAuthority,
        taxMinor: input.taxMinor,
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing({
        target: [
          billingPayments.consumerId,
          billingPayments.offerId,
          billingPayments.idempotencyKey,
        ],
      })
      .returning();
    return inserted[0];
  }

  async findByIdempotency(
    executor: Executor,
    input: {
      readonly consumerId: string;
      readonly idempotencyKey: string;
      readonly offerId: string;
    },
  ): Promise<PaymentRow | undefined> {
    const rows = await executor
      .select()
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.consumerId, input.consumerId),
          eq(billingPayments.offerId, input.offerId),
          eq(billingPayments.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findOwnPayment(
    executor: Executor,
    input: { readonly consumerId: string; readonly paymentId: string },
  ): Promise<PaymentRow | undefined> {
    const rows = await executor
      .select()
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.id, input.paymentId),
          eq(billingPayments.consumerId, input.consumerId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * One operation by identifier, with no consumer in the predicate.
   *
   * For the paths where the caller is not the payer: a verified provider event
   * about a reversal, and reconciliation resolving one. It is safe precisely
   * because it grants nothing — every consumer-facing read still goes through
   * `findOwnPayment`, which puts the payer in the predicate.
   */
  async findById(
    executor: Executor,
    paymentId: string,
  ): Promise<PaymentRow | undefined> {
    const rows = await executor
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.id, paymentId))
      .limit(1);
    return rows[0];
  }

  async findByProviderReference(
    executor: Executor,
    input: { readonly provider: string; readonly providerReference: string },
  ): Promise<PaymentRow | undefined> {
    const rows = await executor
      .select()
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.provider, input.provider),
          eq(billingPayments.providerReference, input.providerReference),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Operations that have sat unsettled too long, oldest first.
   *
   * The partial index over the unsettled states is what makes this the size of
   * the backlog rather than of the history. Bounded by the caller, so a
   * reconciliation cycle cannot be stalled by one.
   */
  async listUnsettledBefore(
    executor: Executor,
    input: { readonly before: Date; readonly limit: number },
  ): Promise<readonly PaymentRow[]> {
    return executor
      .select()
      .from(billingPayments)
      .where(
        and(
          inArray(billingPayments.state, [
            'created',
            'provider_pending',
            'requires_action',
            'reconciliation_pending',
          ]),
          lt(billingPayments.updatedAt, input.before),
        ),
      )
      .orderBy(billingPayments.updatedAt, billingPayments.id)
      .limit(input.limit);
  }
  async listOwnPayments(
    executor: Executor,
    input: {
      readonly after: OfferCursor | undefined;
      readonly consumerId: string;
      readonly limit: number;
    },
  ): Promise<PaymentRow[]> {
    const after = input.after;
    return executor
      .select()
      .from(billingPayments)
      .where(
        after === undefined
          ? eq(billingPayments.consumerId, input.consumerId)
          : and(
              eq(billingPayments.consumerId, input.consumerId),
              or(
                lt(billingPayments.createdAt, after.moment),
                and(
                  eq(billingPayments.createdAt, after.moment),
                  lt(billingPayments.id, after.id),
                ),
              ),
            ),
      )
      .orderBy(desc(billingPayments.createdAt), desc(billingPayments.id))
      .limit(input.limit);
  }

  /**
   * Moves an operation forward, if it is still in a state that permits it.
   *
   * `from` is a list rather than one value because several transitions are
   * legitimate from more than one place — a provider event confirming success
   * may arrive while the operation is `provider_pending`, `requires_action`, or
   * `reconciliation_pending`, and all three are the same fact arriving late.
   * What the list never contains is a terminal state, so nothing can walk an
   * operation back out of one.
   */
  async transition(
    executor: Executor,
    input: {
      readonly failureReason?: PaymentFailureReason;
      readonly from: readonly PaymentState[];
      readonly lastProviderSyncAt?: Date;
      readonly now: Date;
      readonly paymentId: string;
      readonly providerReference?: string;
      readonly to: PaymentState;
    },
  ): Promise<PaymentRow | undefined> {
    const updated = await executor
      .update(billingPayments)
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
        version: sql`${billingPayments.version} + 1`,
      })
      .where(
        and(
          eq(billingPayments.id, input.paymentId),
          input.from.length === 1
            ? eq(billingPayments.state, input.from[0] ?? 'created')
            : or(
                ...input.from.map((state) => eq(billingPayments.state, state)),
              ),
        ),
      )
      .returning();
    return updated[0];
  }
}
