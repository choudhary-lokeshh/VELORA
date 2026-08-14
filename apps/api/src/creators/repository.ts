import { and, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

import {
  creatorAccounts,
  creatorPolicyAcknowledgements,
  type CreatorAccountStatus,
  type CreatorAccountStatusReason,
  type CreatorPolicyKey,
} from './schema.js';

export type CreatorsDatabase = BunSQLDatabase;
export type CreatorsExecutor = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];
type AnyExecutor = CreatorsDatabase | CreatorsExecutor;

export type CreatorAccountRow = typeof creatorAccounts.$inferSelect;
export type CreatorPolicyAcknowledgementRow =
  typeof creatorPolicyAcknowledgements.$inferSelect;

/**
 * Every CREATORS read and write. PostgreSQL is the authority for creator
 * capability existence and lifecycle state; nothing here consults a cache, and
 * no other domain reaches these tables.
 */
export class CreatorsRepository {
  constructor(private readonly database: CreatorsDatabase) {}

  /** For reads and single-statement writes that need no transaction. */
  get transactionless(): CreatorsDatabase {
    return this.database;
  }

  transaction<T>(work: (executor: CreatorsExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  async findByAuthAccountId(
    executor: AnyExecutor,
    authAccountId: string,
  ): Promise<CreatorAccountRow | undefined> {
    const rows = await executor
      .select()
      .from(creatorAccounts)
      .where(eq(creatorAccounts.authAccountId, authAccountId))
      .limit(1);
    return rows[0];
  }

  async findById(
    executor: AnyExecutor,
    id: string,
  ): Promise<CreatorAccountRow | undefined> {
    const rows = await executor
      .select()
      .from(creatorAccounts)
      .where(eq(creatorAccounts.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Creates the creator capability for an AUTH principal, or returns nothing
   * when one already exists.
   *
   * The unique index on `auth_account_id` is what makes concurrent first calls
   * converge on a single row: the loser's insert is discarded by the conflict
   * clause rather than by a read that could race. No lock is taken, because a
   * unique constraint already expresses the invariant and an advisory lock
   * would only add a way to get it wrong.
   */
  async insertIfAbsent(
    executor: AnyExecutor,
    input: {
      readonly authAccountId: string;
      readonly now: Date;
      readonly status: CreatorAccountStatus;
      readonly statusReason: CreatorAccountStatusReason | null;
    },
  ): Promise<CreatorAccountRow | undefined> {
    const inserted = await executor
      .insert(creatorAccounts)
      .values({
        authAccountId: input.authAccountId,
        createdAt: input.now,
        id: crypto.randomUUID(),
        status: input.status,
        statusChangedAt: input.now,
        statusReason: input.statusReason,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: creatorAccounts.authAccountId })
      .returning();
    return inserted[0];
  }

  /**
   * Moves a creator capability between states, only from the state the caller
   * believed it was in.
   *
   * The expected status in the predicate is what makes concurrent transitions
   * safe without a lock: two callers racing to activate the same applicant both
   * write, one matches and one does not, and the loser gets `undefined` rather
   * than overwriting a decision it never saw. A read-then-write would have had
   * a gap between the two where either could win.
   */
  async transitionStatus(
    executor: AnyExecutor,
    input: {
      readonly activatedAt?: Date | undefined;
      readonly closedAt?: Date | undefined;
      readonly creatorId: string;
      readonly expectedStatus: CreatorAccountStatus;
      readonly now: Date;
      readonly status: CreatorAccountStatus;
      readonly statusReason: CreatorAccountStatusReason | null;
      readonly suspendedAt?: Date | undefined;
    },
  ): Promise<CreatorAccountRow | undefined> {
    const updated = await executor
      .update(creatorAccounts)
      .set({
        ...(input.activatedAt === undefined
          ? {}
          : { activatedAt: input.activatedAt }),
        ...(input.closedAt === undefined ? {} : { closedAt: input.closedAt }),
        status: input.status,
        statusChangedAt: input.now,
        statusReason: input.statusReason,
        ...(input.suspendedAt === undefined
          ? {}
          : { suspendedAt: input.suspendedAt }),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(creatorAccounts.id, input.creatorId),
          eq(creatorAccounts.status, input.expectedStatus),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Records acknowledgement evidence. A version already acknowledged is left
   * exactly as it was: re-submitting must never rewrite when a person agreed.
   */
  async recordPolicyAcknowledgements(
    executor: AnyExecutor,
    input: {
      readonly acknowledgedAt: Date;
      readonly audience: string;
      readonly creatorId: string;
      readonly documents: readonly {
        readonly key: CreatorPolicyKey;
        readonly version: string;
      }[];
    },
  ): Promise<void> {
    if (input.documents.length === 0) return;
    await executor
      .insert(creatorPolicyAcknowledgements)
      .values(
        input.documents.map((document) => ({
          acknowledgedAt: input.acknowledgedAt,
          audience: input.audience,
          creatorId: input.creatorId,
          policyKey: document.key,
          policyVersion: document.version,
        })),
      )
      .onConflictDoNothing({
        target: [
          creatorPolicyAcknowledgements.creatorId,
          creatorPolicyAcknowledgements.policyKey,
          creatorPolicyAcknowledgements.policyVersion,
        ],
      });
  }

  /** Acknowledgements the capability holds for the named policy keys. */
  async findPolicyAcknowledgements(
    executor: AnyExecutor,
    input: {
      readonly creatorId: string;
      readonly keys: readonly CreatorPolicyKey[];
    },
  ): Promise<CreatorPolicyAcknowledgementRow[]> {
    if (input.keys.length === 0) return [];
    return executor
      .select()
      .from(creatorPolicyAcknowledgements)
      .where(
        and(
          eq(creatorPolicyAcknowledgements.creatorId, input.creatorId),
          inArray(creatorPolicyAcknowledgements.policyKey, [...input.keys]),
        ),
      );
  }
}
