import { and, asc, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import {
  openSupportTicketStatuses,
  type SupportCategory,
  type SupportEventKind,
  type SupportTicketStatus,
} from './policy.js';
import { supportTicketEvents, supportTickets } from './schema.js';

export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type SupportTicketEventRow = typeof supportTicketEvents.$inferSelect;

/**
 * SUPPORT's only reader and writer.
 *
 * Every method takes the caller's executor, on the rule every other domain
 * follows: a check that commits separately from the write it authorizes is not
 * a check. Nothing here decides anything — the bounds, the transitions, and the
 * reference are the service's business, and a repository that made one of those
 * decisions would be a second place the rules live.
 */
export class SupportRepository {
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
   * Records a ticket, or returns nothing when this submission already made one.
   *
   * Idempotency is the unique index over owner and client identifier, not a
   * prior read: two taps a few milliseconds apart both pass a read and only one
   * passes the index. The loser is answered by the caller reading back what the
   * winner wrote, which is the same shape every other idempotent write in this
   * repository uses.
   */
  async insertTicket(
    executor: Executor,
    input: {
      readonly category: SupportCategory;
      readonly clientTicketId: string;
      readonly description: string;
      readonly id: string;
      readonly now: Date;
      readonly ownerId: string;
      readonly reference: string;
      readonly subject: string;
    },
  ): Promise<SupportTicketRow | undefined> {
    const rows = await executor
      .insert(supportTickets)
      .values({
        category: input.category,
        clientTicketId: input.clientTicketId,
        createdAt: input.now,
        description: input.description,
        id: input.id,
        ownerId: input.ownerId,
        reference: input.reference,
        status: 'received',
        subject: input.subject,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return rows.at(0);
  }

  async findByClientTicketId(
    executor: Executor,
    input: { readonly clientTicketId: string; readonly ownerId: string },
  ): Promise<SupportTicketRow | undefined> {
    const rows = await executor
      .select()
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.ownerId, input.ownerId),
          eq(supportTickets.clientTicketId, input.clientTicketId),
        ),
      )
      .limit(1);
    return rows.at(0);
  }

  async findById(
    executor: Executor,
    id: string,
  ): Promise<SupportTicketRow | undefined> {
    const rows = await executor
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, id))
      .limit(1);
    return rows.at(0);
  }

  /**
   * The ticket, locked.
   *
   * Distinct from `findById` because the caller is about to write. Two
   * operators moving the same ticket at the same moment must not both apply a
   * transition read from the same stale state.
   */
  async lockTicket(
    executor: TransactionHandle,
    id: string,
  ): Promise<SupportTicketRow | undefined> {
    const rows = await executor
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, id))
      .limit(1)
      .for('update');
    return rows.at(0);
  }

  /** How many tickets this account opened since the given instant. */
  async countTicketsSince(
    executor: Executor,
    input: { readonly ownerId: string; readonly since: Date },
  ): Promise<number> {
    const rows = await executor
      .select({ count: sql<string>`count(*)::text` })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.ownerId, input.ownerId),
          gte(supportTickets.createdAt, input.since),
        ),
      );
    return Number(rows.at(0)?.count ?? '0');
  }

  /** How many of this account's tickets nobody has finished with. */
  async countOpenTickets(executor: Executor, ownerId: string): Promise<number> {
    const rows = await executor
      .select({ count: sql<string>`count(*)::text` })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.ownerId, ownerId),
          inArray(supportTickets.status, [...openSupportTicketStatuses]),
        ),
      );
    return Number(rows.at(0)?.count ?? '0');
  }

  /** Whether this reference is already taken. Asked before an insert. */
  async referenceExists(
    executor: Executor,
    reference: string,
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.reference, reference))
      .limit(1);
    return rows.length === 1;
  }

  /**
   * One owner's tickets, newest first, keyset paged on immutable values.
   *
   * `createdAt` alone can tie, so the identifier breaks it. Both are immutable,
   * which is what makes a cursor stable while a status moves underneath it.
   */
  async listForOwner(
    executor: Executor,
    input: {
      readonly before:
        { readonly createdAt: Date; readonly id: string } | undefined;
      readonly limit: number;
      readonly ownerId: string;
    },
  ): Promise<readonly SupportTicketRow[]> {
    const cursor =
      input.before === undefined
        ? undefined
        : or(
            lt(supportTickets.createdAt, input.before.createdAt),
            and(
              eq(supportTickets.createdAt, input.before.createdAt),
              lt(supportTickets.id, input.before.id),
            ),
          );
    return executor
      .select()
      .from(supportTickets)
      .where(
        cursor === undefined
          ? eq(supportTickets.ownerId, input.ownerId)
          : and(eq(supportTickets.ownerId, input.ownerId), cursor),
      )
      .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
      .limit(input.limit);
  }

  /**
   * The operator queue.
   *
   * Oldest first, which is the opposite of the owner's list and deliberately
   * so: a person wants their most recent question and an operator wants the one
   * that has been waiting longest.
   */
  async listForOperator(
    executor: Executor,
    input: {
      readonly after:
        { readonly createdAt: Date; readonly id: string } | undefined;
      readonly limit: number;
      readonly status: SupportTicketStatus | undefined;
    },
  ): Promise<readonly SupportTicketRow[]> {
    const cursor =
      input.after === undefined
        ? undefined
        : or(
            sql`${supportTickets.createdAt} > ${input.after.createdAt}`,
            and(
              eq(supportTickets.createdAt, input.after.createdAt),
              sql`${supportTickets.id} > ${input.after.id}::uuid`,
            ),
          );
    const status =
      input.status === undefined
        ? undefined
        : eq(supportTickets.status, input.status);
    const conditions = [status, cursor].filter((value) => value !== undefined);
    return executor
      .select()
      .from(supportTickets)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(supportTickets.createdAt), asc(supportTickets.id))
      .limit(input.limit);
  }

  /**
   * Moves a ticket, if it is still where the caller read it.
   *
   * A compare-and-set rather than a plain update: two operators acting on the
   * same ticket at the same instant must not both apply a transition computed
   * from the same stale status. The loser reads current state and decides
   * again.
   */
  async transitionStatus(
    executor: Executor,
    input: {
      readonly expectedStatus: SupportTicketStatus;
      readonly id: string;
      readonly now: Date;
      readonly status: SupportTicketStatus;
    },
  ): Promise<SupportTicketRow | undefined> {
    const rows = await executor
      .update(supportTickets)
      .set({ status: input.status, updatedAt: input.now })
      .where(
        and(
          eq(supportTickets.id, input.id),
          eq(supportTickets.status, input.expectedStatus),
        ),
      )
      .returning();
    return rows.at(0);
  }

  async insertEvent(
    executor: Executor,
    input: {
      readonly actorReference: string | null;
      readonly id: string;
      readonly kind: SupportEventKind;
      readonly note: string | null;
      readonly now: Date;
      readonly status: SupportTicketStatus | null;
      readonly ticketId: string;
    },
  ): Promise<SupportTicketEventRow | undefined> {
    const rows = await executor
      .insert(supportTicketEvents)
      .values({
        actorReference: input.actorReference,
        createdAt: input.now,
        id: input.id,
        kind: input.kind,
        note: input.note,
        status: input.status,
        ticketId: input.ticketId,
      })
      .returning();
    return rows.at(0);
  }

  /** Everything recorded against one ticket, oldest first. Operator-only. */
  async listEvents(
    executor: Executor,
    input: { readonly limit: number; readonly ticketId: string },
  ): Promise<readonly SupportTicketEventRow[]> {
    return executor
      .select()
      .from(supportTicketEvents)
      .where(eq(supportTicketEvents.ticketId, input.ticketId))
      .orderBy(asc(supportTicketEvents.sequence))
      .limit(input.limit);
  }
}
