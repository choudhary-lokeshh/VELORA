import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type { OutboxRow, OutboxTable } from './outbox-table.js';

/**
 * What a producer writes, and where it may write it from.
 *
 * The executor is the caller's, always. A producer that appended on its own
 * handle would have written the fact in a second transaction, and a second
 * transaction is precisely the gap this pattern exists to close: the business
 * row and the fact would then be able to disagree about whether anything
 * happened. Every method here therefore takes the transaction the caller is
 * already inside and refuses to open one of its own.
 */
export interface OutboxAppendPort {
  append(
    executor: TransactionHandle,
    event: OutboxAppend,
  ): Promise<{ readonly id: string }>;
}

export interface OutboxAppend {
  readonly correlationId?: string | undefined;
  /** Versioned past-tense fact name: `messaging.message.sent.v1`. */
  readonly eventName: string;
  readonly eventVersion: number;
  /** Caller-generated so it can be logged and correlated before commit. */
  readonly id?: string | undefined;
  readonly now: Date;
  readonly occurredAt?: Date | undefined;
  /** Minimized. Nothing here may carry message text or a credential. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly subjectId?: string | undefined;
  readonly subjectType: string;
}

/** A claim, held for as long as the lease it was taken under. */
export interface OutboxClaim {
  readonly leaseExpiresAt: Date;
  readonly rows: readonly OutboxRow[];
}

/**
 * What the relay needs from a producer's outbox, and nothing else.
 *
 * Narrow on purpose. The relay claims and settles; it does not append, read
 * history, or open transactions, and a port that let it do those things would
 * invite a future version that did. It also makes the relay testable against a
 * fake without a database, which is how its retry and retirement arithmetic is
 * exercised.
 */
export interface OutboxSourceRepository {
  claim(input: {
    readonly leaseMilliseconds: number;
    readonly limit: number;
    readonly now: Date;
    readonly owner: string;
  }): Promise<OutboxClaim>;

  markDispatched(input: {
    readonly id: string;
    readonly now: Date;
    readonly owner: string;
  }): Promise<boolean>;

  markFailed(input: {
    readonly availableAt: Date;
    readonly deadLetter: boolean;
    readonly id: string;
    readonly now: Date;
    readonly owner: string;
    readonly reason: string;
  }): Promise<boolean>;
}

/**
 * Reads and writes for one producer's outbox.
 *
 * Nothing in here interprets a payload. The relay routes and the consumer
 * decides; this class only moves a row between the three states the table
 * declares, and it never deletes one.
 */
export class OutboxRepository
  implements OutboxAppendPort, OutboxSourceRepository
{
  constructor(
    private readonly database: DatabaseHandle,
    private readonly table: OutboxTable,
  ) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Records a fact inside the caller's transaction.
   *
   * Available immediately: a fact is publishable the moment the transaction
   * that produced it commits, and not before, because a relay in another
   * process cannot see an uncommitted row however hard it polls.
   */
  async append(
    executor: TransactionHandle,
    event: OutboxAppend,
  ): Promise<{ readonly id: string }> {
    const id = event.id ?? crypto.randomUUID();
    await executor.insert(this.table).values({
      availableAt: event.now,
      correlationId: event.correlationId ?? null,
      createdAt: event.now,
      eventName: event.eventName,
      eventVersion: event.eventVersion,
      id,
      occurredAt: event.occurredAt ?? event.now,
      payload: event.payload,
      state: 'pending',
      subjectId: event.subjectId ?? null,
      subjectType: event.subjectType,
      updatedAt: event.now,
    });
    return { id };
  }

  /**
   * Takes the oldest claimable rows and leases them.
   *
   * `for update skip locked` is what lets several relays drain one outbox
   * without coordinating: a row another relay is holding is stepped over rather
   * than waited for. The lease is then written so that a relay which *dies*
   * holding rows — where no lock survives to skip — releases them by expiry
   * instead of stranding them forever.
   *
   * A row whose lease has expired is claimable again even though it is still
   * `pending`. That is the recovery path: at-least-once, never at-most-once.
   */
  async claim(input: {
    readonly leaseMilliseconds: number;
    readonly limit: number;
    readonly now: Date;
    readonly owner: string;
  }): Promise<OutboxClaim> {
    const leaseExpiresAt = new Date(
      input.now.getTime() + input.leaseMilliseconds,
    );
    const rows = await this.database.transaction(async (executor) => {
      const claimable = await executor
        .select({ id: this.table.id })
        .from(this.table)
        .where(
          and(
            eq(this.table.state, 'pending'),
            lte(this.table.availableAt, input.now),
            or(
              isNull(this.table.leaseExpiresAt),
              lte(this.table.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(asc(this.table.sequence))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (claimable.length === 0) return [];

      return executor
        .update(this.table)
        .set({
          leaseExpiresAt,
          leaseOwner: input.owner,
          updatedAt: input.now,
        })
        .where(
          inArray(
            this.table.id,
            claimable.map((row) => row.id),
          ),
        )
        .returning();
    });
    return { leaseExpiresAt, rows };
  }

  /**
   * Marks a claimed row published.
   *
   * The lease owner is part of the predicate, so a relay whose lease expired
   * while it was working — and whose row another relay has since taken — cannot
   * report a dispatch on top of the new owner's claim.
   */
  async markDispatched(input: {
    readonly id: string;
    readonly now: Date;
    readonly owner: string;
  }): Promise<boolean> {
    const updated = await this.database
      .update(this.table)
      .set({
        attempts: sql`${this.table.attempts} + 1`,
        dispatchedAt: input.now,
        failureReason: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        state: 'dispatched',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(this.table.id, input.id),
          eq(this.table.state, 'pending'),
          eq(this.table.leaseOwner, input.owner),
        ),
      )
      .returning({ id: this.table.id });
    return updated.length > 0;
  }

  /**
   * Returns a failed row for a later attempt, or retires it.
   *
   * Retirement is a state, never a delete. A dead-lettered event is the only
   * durable evidence that a fact was produced and never published, and repair
   * needs it.
   */
  async markFailed(input: {
    readonly availableAt: Date;
    readonly deadLetter: boolean;
    readonly id: string;
    readonly now: Date;
    readonly owner: string;
    readonly reason: string;
  }): Promise<boolean> {
    const updated = await this.database
      .update(this.table)
      .set({
        attempts: sql`${this.table.attempts} + 1`,
        availableAt: input.availableAt,
        failureReason: input.reason,
        leaseExpiresAt: null,
        leaseOwner: null,
        state: input.deadLetter ? 'dead_letter' : 'pending',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(this.table.id, input.id),
          eq(this.table.state, 'pending'),
          eq(this.table.leaseOwner, input.owner),
        ),
      )
      .returning({ id: this.table.id });
    return updated.length > 0;
  }

  async findById(
    executor: Executor,
    id: string,
  ): Promise<OutboxRow | undefined> {
    const rows = await executor
      .select()
      .from(this.table)
      .where(eq(this.table.id, id))
      .limit(1);
    return rows[0];
  }
}
