import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type { JournalStore } from '../money/journal.js';
import { money, type Money } from '../money/money.js';
import {
  reservingInstructionStates,
  type PayoutFailureReason,
  type PayoutInstructionState,
  type RecipientStatus,
} from './policy.js';
import {
  payoutsInstructions,
  payoutsJournalAccounts,
  payoutsRecipients,
} from './schema.js';

export type PayoutInstructionRow = typeof payoutsInstructions.$inferSelect;
export type PayoutRecipientRow = typeof payoutsRecipients.$inferSelect;

/** A position in a list ordered by creation instant, newest first. */
export interface PayoutCursor {
  readonly id: string;
  readonly moment: Date;
}

/** What a creator's money looks like from the disbursement side. */
export interface PayoutBalances {
  /** Free to be requested, before any policy is applied to it. */
  readonly available: Money;
  readonly currency: string;
  /** Withheld by an explicit decision. */
  readonly held: Money;
  /** Earmarked against an instruction in flight. */
  readonly reserved: Money;
}

/**
 * Payout recipients, instructions, and the balances both are bounded by.
 *
 * Every balance here is derived from journal entries on every read. There is no
 * cached total and no decrementing column, because
 * `docs/architecture/10-money-flow.md` forbids a single mutable balance column
 * standing as authoritative truth for a creator's money — a cached one is a
 * second source of truth that a concurrency bug can corrupt with nothing
 * noticing, and a derived one can be recomputed and compared.
 *
 * The recipient row is what concurrent payout requests serialize on. It is not
 * modified by taking the lock; it is the one row every request for a given
 * creator must consult, which is what turns a read-then-decide race into a
 * queue.
 */
export class PayoutsRepository {
  constructor(
    private readonly database: DatabaseHandle,
    private readonly journal: JournalStore,
  ) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  /**
   * Ensures a recipient row exists, so there is something to serialize on.
   *
   * Created in `absent` with no provider reference: a creator who has never
   * opened a provider's onboarding has a place in this table and nothing in it,
   * which is a truthful state and the one every payout request needs to be able
   * to lock.
   */
  async ensureRecipient(
    executor: Executor,
    input: {
      readonly creatorId: string;
      readonly now: Date;
      readonly provider: string;
    },
  ): Promise<PayoutRecipientRow | undefined> {
    await executor
      .insert(payoutsRecipients)
      .values({
        createdAt: input.now,
        creatorId: input.creatorId,
        provider: input.provider,
        status: 'absent',
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing();
    return this.findRecipient(executor, input.creatorId);
  }

  async findRecipient(
    executor: Executor,
    creatorId: string,
  ): Promise<PayoutRecipientRow | undefined> {
    const rows = await executor
      .select()
      .from(payoutsRecipients)
      .where(eq(payoutsRecipients.creatorId, creatorId))
      .limit(1);
    return rows[0];
  }

  /**
   * Takes the recipient under lock, so every request for this creator queues.
   *
   * The row is never modified by this; the lock is taken purely for the
   * ordering it imposes. Two simultaneous payout requests would otherwise each
   * read a balance that did not yet include the other's reservation, and both
   * would decide there was room for the whole of it.
   */
  async lockRecipient(
    executor: Executor,
    creatorId: string,
  ): Promise<PayoutRecipientRow | undefined> {
    const rows = await executor
      .select()
      .from(payoutsRecipients)
      .where(eq(payoutsRecipients.creatorId, creatorId))
      .limit(1)
      .for('update');
    return rows[0];
  }

  /**
   * Records what a provider says about a recipient.
   *
   * Only the provider's own answer and the reference to its record. There is no
   * column here for a bank detail or an identity document, so there is nothing
   * for a careless caller to put one in.
   */
  async recordRecipient(
    executor: Executor,
    input: {
      readonly capabilityCheckedAt: Date;
      readonly creatorId: string;
      readonly now: Date;
      readonly providerReference: string;
      readonly status: RecipientStatus;
    },
  ): Promise<PayoutRecipientRow | undefined> {
    const updated = await executor
      .update(payoutsRecipients)
      .set({
        capabilityCheckedAt: input.capabilityCheckedAt,
        providerReference: input.providerReference,
        status: input.status,
        updatedAt: input.now,
        version: sql`${payoutsRecipients.version} + 1`,
      })
      .where(eq(payoutsRecipients.creatorId, input.creatorId))
      .returning();
    return updated[0];
  }

  /**
   * What a creator's book says, per currency.
   *
   * Three balances read from three positions, negated because the journal keeps
   * debits minus credits and a liability is a credit balance — "what we owe
   * you" reads better as a positive number than as a sign a creator has no
   * reason to know about.
   */
  async balancesFor(
    executor: Executor,
    input: { readonly creatorId: string; readonly currency: string },
  ): Promise<PayoutBalances> {
    const read = async (category: string): Promise<Money> => {
      const balance = await this.journal.balanceOf(executor, input.currency, {
        category,
        subjectId: input.creatorId,
        subjectType: 'creator',
      });
      return money(-balance.amountMinor, input.currency);
    };
    return {
      available: await read('creator_available'),
      currency: input.currency,
      held: await read('creator_held'),
      reserved: await read('creator_reserved'),
    };
  }

  /** Every currency this creator has ever been credited in. */
  async currenciesFor(
    executor: Executor,
    creatorId: string,
  ): Promise<readonly string[]> {
    const rows = await executor
      .selectDistinct({ currency: payoutsJournalAccounts.currency })
      .from(payoutsJournalAccounts)
      .where(eq(payoutsJournalAccounts.subjectId, creatorId))
      .orderBy(payoutsJournalAccounts.currency);
    return rows.map((row) => row.currency);
  }

  /**
   * Records the instruction, or returns nothing when this creator already has
   * one under this key.
   *
   * `on conflict do nothing` rather than a preceding read: two simultaneous
   * submissions both insert, PostgreSQL admits one, and the loser reads the
   * winner's row.
   *
   * This is safe against the unarbitrated provider-key index only because
   * `lockRecipient` has already taken the creator's recipient under a row lock
   * by the time this runs, so one creator's instructions are serialized before
   * they get here and never contend on that index. A caller that reaches this
   * without that lock reopens the race `lockIdempotentOperation` describes and
   * must take that lock instead.
   */
  async insertInstruction(
    executor: Executor,
    input: {
      readonly amountMinor: bigint;
      readonly correlationId: string;
      readonly creatorId: string;
      readonly currency: string;
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly provider: string;
      readonly providerIdempotencyKey: string;
      readonly requestedBy: string;
    },
  ): Promise<PayoutInstructionRow | undefined> {
    const inserted = await executor
      .insert(payoutsInstructions)
      .values({
        amountMinor: input.amountMinor,
        correlationId: input.correlationId,
        createdAt: input.now,
        creatorId: input.creatorId,
        currency: input.currency,
        id: crypto.randomUUID(),
        idempotencyKey: input.idempotencyKey,
        provider: input.provider,
        providerIdempotencyKey: input.providerIdempotencyKey,
        requestedBy: input.requestedBy,
        state: 'requested',
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing({
        target: [
          payoutsInstructions.creatorId,
          payoutsInstructions.idempotencyKey,
        ],
      })
      .returning();
    return inserted[0];
  }

  async findInstruction(
    executor: Executor,
    instructionId: string,
  ): Promise<PayoutInstructionRow | undefined> {
    const rows = await executor
      .select()
      .from(payoutsInstructions)
      .where(eq(payoutsInstructions.id, instructionId))
      .limit(1);
    return rows[0];
  }

  async findByIdempotency(
    executor: Executor,
    input: { readonly creatorId: string; readonly idempotencyKey: string },
  ): Promise<PayoutInstructionRow | undefined> {
    const rows = await executor
      .select()
      .from(payoutsInstructions)
      .where(
        and(
          eq(payoutsInstructions.creatorId, input.creatorId),
          eq(payoutsInstructions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findByProviderReference(
    executor: Executor,
    input: { readonly provider: string; readonly providerReference: string },
  ): Promise<PayoutInstructionRow | undefined> {
    const rows = await executor
      .select()
      .from(payoutsInstructions)
      .where(
        and(
          eq(payoutsInstructions.provider, input.provider),
          eq(payoutsInstructions.providerReference, input.providerReference),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** One creator's instructions, newest first, keyset paged. */
  async listForCreator(
    executor: Executor,
    input: {
      readonly after: PayoutCursor | undefined;
      readonly creatorId: string;
      readonly limit: number;
    },
  ): Promise<readonly PayoutInstructionRow[]> {
    const after = input.after;
    return executor
      .select()
      .from(payoutsInstructions)
      .where(
        after === undefined
          ? eq(payoutsInstructions.creatorId, input.creatorId)
          : and(
              eq(payoutsInstructions.creatorId, input.creatorId),
              or(
                lt(payoutsInstructions.createdAt, after.moment),
                and(
                  eq(payoutsInstructions.createdAt, after.moment),
                  lt(payoutsInstructions.id, after.id),
                ),
              ),
            ),
      )
      .orderBy(
        desc(payoutsInstructions.createdAt),
        desc(payoutsInstructions.id),
      )
      .limit(input.limit);
  }

  /** Instructions that still hold a reservation, for reconciliation. */
  async listReserving(
    executor: Executor,
    limit: number,
  ): Promise<readonly PayoutInstructionRow[]> {
    return executor
      .select()
      .from(payoutsInstructions)
      .where(
        inArray(payoutsInstructions.state, [...reservingInstructionStates]),
      )
      .orderBy(payoutsInstructions.updatedAt, payoutsInstructions.id)
      .limit(limit);
  }

  /**
   * Moves an instruction, if it is still in a state that permits it.
   *
   * `from` never contains a terminal state, so a late provider answer cannot
   * walk a paid instruction back into flight or a failed one into paid.
   */
  async transition(
    executor: Executor,
    input: {
      readonly failureReason?: PayoutFailureReason;
      readonly from: readonly PayoutInstructionState[];
      readonly instructionId: string;
      readonly lastProviderSyncAt?: Date;
      readonly now: Date;
      readonly providerReference?: string;
      readonly to: PayoutInstructionState;
    },
  ): Promise<PayoutInstructionRow | undefined> {
    const updated = await executor
      .update(payoutsInstructions)
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
        version: sql`${payoutsInstructions.version} + 1`,
      })
      .where(
        and(
          eq(payoutsInstructions.id, input.instructionId),
          inArray(payoutsInstructions.state, [...input.from]),
        ),
      )
      .returning();
    return updated[0];
  }
}
