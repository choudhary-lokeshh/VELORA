import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type {
  ControlKey,
  OperatorActionName,
  OperatorActionOutcome,
  OperatorRole,
  OperatorSubjectType,
} from './policy.js';
import {
  operationsControls,
  operationsOperatorActions,
  operationsOperatorGrants,
} from './schema.js';

export type ControlRow = typeof operationsControls.$inferSelect;
export type OperatorGrantRow = typeof operationsOperatorGrants.$inferSelect;
export type OperatorActionRow = typeof operationsOperatorActions.$inferSelect;

/**
 * OPERATIONS' only reader and writer.
 *
 * Three things it deliberately cannot do. It cannot update an operator action,
 * it cannot delete one, and it has no method that takes an action identifier at
 * all — which is what makes "append-only" a shape rather than a promise. It
 * cannot read another domain's table: the composed operator reads live in
 * ADMIN's directories, where the read-model rule already applies.
 *
 * Nothing here decides anything. Whether a role may be granted, whether a
 * version is current, and whether a reason is long enough are the service's
 * business; this module moves rows.
 */
export class OperationsRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  /* ------------------------------ Controls ----------------------------- */

  async listControls(
    executor: Executor = this.database,
  ): Promise<ControlRow[]> {
    return executor
      .select()
      .from(operationsControls)
      .orderBy(asc(operationsControls.key));
  }

  async readControl(
    key: ControlKey,
    executor: Executor = this.database,
  ): Promise<ControlRow | undefined> {
    const rows = await executor
      .select()
      .from(operationsControls)
      .where(eq(operationsControls.key, key))
      .limit(1);
    return rows[0];
  }

  /**
   * Writes a control that has never been set.
   *
   * Answers `undefined` when a row already exists, which is how a first write
   * and a concurrent first write are told apart without a prior read: two
   * operators setting the same never-set control at the same instant both pass
   * a `select`, and only one passes the primary key.
   */
  async insertControl(
    executor: Executor,
    input: {
      readonly changedBy: string;
      readonly enabled: boolean;
      readonly key: ControlKey;
      readonly now: Date;
      readonly reason: string;
    },
  ): Promise<ControlRow | undefined> {
    const rows = await executor
      .insert(operationsControls)
      .values({
        changedBy: input.changedBy,
        enabled: input.enabled,
        key: input.key,
        reason: input.reason,
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0];
  }

  /**
   * Advances a control, but only from the version the operator read.
   *
   * The version is in the `where`, so the losing writer of two concurrent
   * changes updates nothing and gets `undefined` — which the service turns into
   * a conflict the operator can see, rather than an overwrite they cannot.
   */
  async updateControl(
    executor: Executor,
    input: {
      readonly changedBy: string;
      readonly enabled: boolean;
      readonly expectedVersion: number;
      readonly key: ControlKey;
      readonly now: Date;
      readonly reason: string;
    },
  ): Promise<ControlRow | undefined> {
    const rows = await executor
      .update(operationsControls)
      .set({
        changedBy: input.changedBy,
        enabled: input.enabled,
        reason: input.reason,
        updatedAt: input.now,
        version: sql`${operationsControls.version} + 1`,
      })
      .where(
        and(
          eq(operationsControls.key, input.key),
          eq(operationsControls.version, input.expectedVersion),
        ),
      )
      .returning();
    return rows[0];
  }

  /* ------------------------------- Grants ------------------------------ */

  /** The live grant for one operator, if they hold one. */
  async readLiveGrant(
    subjectReference: string,
    executor: Executor = this.database,
  ): Promise<OperatorGrantRow | undefined> {
    const rows = await executor
      .select()
      .from(operationsOperatorGrants)
      .where(
        and(
          eq(operationsOperatorGrants.subjectReference, subjectReference),
          isNull(operationsOperatorGrants.revokedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listGrants(input: {
    readonly cursor?: { readonly grantedAt: Date; readonly id: string };
    readonly executor?: Executor;
    readonly limit: number;
  }): Promise<OperatorGrantRow[]> {
    const executor = input.executor ?? this.database;
    const position = input.cursor;
    return executor
      .select()
      .from(operationsOperatorGrants)
      .where(
        position === undefined
          ? undefined
          : sql`(${operationsOperatorGrants.grantedAt}, ${operationsOperatorGrants.id}) < (${position.grantedAt}, ${position.id})`,
      )
      .orderBy(
        desc(operationsOperatorGrants.grantedAt),
        desc(operationsOperatorGrants.id),
      )
      .limit(input.limit);
  }

  async insertGrant(
    executor: Executor,
    input: {
      readonly grantedBy: string | undefined;
      readonly id: string;
      readonly now: Date;
      readonly reason: string;
      readonly role: OperatorRole;
      readonly subjectReference: string;
    },
  ): Promise<OperatorGrantRow | undefined> {
    const rows = await executor
      .insert(operationsOperatorGrants)
      .values({
        grantedAt: input.now,
        grantedBy: input.grantedBy ?? null,
        id: input.id,
        reason: input.reason,
        role: input.role,
        subjectReference: input.subjectReference,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0];
  }

  /** Ends the live grant for one operator. Answers what it ended, if anything. */
  async revokeGrant(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly revokedBy: string;
      readonly subjectReference: string;
    },
  ): Promise<OperatorGrantRow | undefined> {
    const rows = await executor
      .update(operationsOperatorGrants)
      .set({ revokedAt: input.now, revokedBy: input.revokedBy })
      .where(
        and(
          eq(operationsOperatorGrants.subjectReference, input.subjectReference),
          isNull(operationsOperatorGrants.revokedAt),
        ),
      )
      .returning();
    return rows[0];
  }

  /* ------------------------------- Actions ----------------------------- */

  /**
   * Records one operator action. The only write this table has.
   *
   * Deliberately not part of the command's transaction. An audit row that
   * rolled back with a failed command would leave no trace of the attempt,
   * which is the opposite of what an audit is for — and a refusal has no
   * transaction to join in the first place.
   */
  async insertAction(input: {
    readonly action: OperatorActionName;
    readonly actorReference: string;
    readonly capability: string;
    readonly correlationId: string | undefined;
    readonly executor?: Executor;
    readonly failureCode: string | undefined;
    readonly id: string;
    readonly now: Date;
    readonly outcome: OperatorActionOutcome;
    readonly previousState: string | undefined;
    readonly reason: string;
    readonly requestedState: string | undefined;
    readonly subjectId: string | undefined;
    readonly subjectType: OperatorSubjectType;
  }): Promise<OperatorActionRow> {
    const executor = input.executor ?? this.database;
    const rows = await executor
      .insert(operationsOperatorActions)
      .values({
        action: input.action,
        actorReference: input.actorReference,
        capability: input.capability,
        correlationId: input.correlationId ?? null,
        failureCode: input.failureCode ?? null,
        id: input.id,
        occurredAt: input.now,
        outcome: input.outcome,
        previousState: input.previousState ?? null,
        reason: input.reason,
        requestedState: input.requestedState ?? null,
        subjectId: input.subjectId ?? null,
        subjectType: input.subjectType,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error('Operator action was not recorded');
    return row;
  }

  /**
   * The audit explorer's read: newest first, narrowed by whatever was asked.
   *
   * Every filter is over an indexed column and every value reaching it has
   * already been checked against a closed vocabulary by the route, so nothing
   * here interpolates a caller's string into a comparison.
   */
  async listActions(input: {
    readonly action?: OperatorActionName;
    readonly actorReference?: string;
    readonly cursor?: { readonly id: string; readonly occurredAt: Date };
    readonly limit: number;
    readonly outcome?: OperatorActionOutcome;
    readonly since: Date;
    readonly subjectId?: string;
  }): Promise<OperatorActionRow[]> {
    const conditions = [gt(operationsOperatorActions.occurredAt, input.since)];
    if (input.action !== undefined) {
      conditions.push(eq(operationsOperatorActions.action, input.action));
    }
    if (input.actorReference !== undefined) {
      conditions.push(
        eq(operationsOperatorActions.actorReference, input.actorReference),
      );
    }
    if (input.outcome !== undefined) {
      conditions.push(eq(operationsOperatorActions.outcome, input.outcome));
    }
    if (input.subjectId !== undefined) {
      conditions.push(eq(operationsOperatorActions.subjectId, input.subjectId));
    }
    const position = input.cursor;
    if (position !== undefined) {
      conditions.push(
        sql`(${operationsOperatorActions.occurredAt}, ${operationsOperatorActions.id}) < (${position.occurredAt}, ${position.id})`,
      );
    }
    return this.database
      .select()
      .from(operationsOperatorActions)
      .where(and(...conditions))
      .orderBy(
        desc(operationsOperatorActions.occurredAt),
        desc(operationsOperatorActions.id),
      )
      .limit(input.limit);
  }
}
