import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

import {
  userAccounts,
  userAdultDeclarations,
  userPolicyAcknowledgements,
  type AdultDeclarationOutcome,
  type ConsumerPolicyKey,
  type UserAccountStatus,
  type UserAccountStatusReason,
} from './schema.js';

export type UsersDatabase = BunSQLDatabase;
export type UsersExecutor = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];
type AnyExecutor = UsersDatabase | UsersExecutor;

export type UserAccountRow = typeof userAccounts.$inferSelect;
export type UserAdultDeclarationRow = typeof userAdultDeclarations.$inferSelect;
export type UserPolicyAcknowledgementRow =
  typeof userPolicyAcknowledgements.$inferSelect;

/**
 * Every USERS read and write. PostgreSQL is the authority for consumer account
 * existence and lifecycle state; nothing here consults a cache, and no other
 * domain reaches these tables.
 */
export class UsersRepository {
  constructor(private readonly database: UsersDatabase) {}

  /** For reads and single-statement writes that need no transaction. */
  get transactionless(): UsersDatabase {
    return this.database;
  }

  transaction<T>(work: (executor: UsersExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  async findByAuthAccountId(
    executor: AnyExecutor,
    authAccountId: string,
  ): Promise<UserAccountRow | undefined> {
    const rows = await executor
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.authAccountId, authAccountId))
      .limit(1);
    return rows[0];
  }

  async findById(
    executor: AnyExecutor,
    id: string,
  ): Promise<UserAccountRow | undefined> {
    const rows = await executor
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Active consumer accounts, oldest first, excluding one.
   *
   * Deliberately narrow and deliberately not a search: no filter, no cursor, no
   * ordering choice, and a caller-supplied bound that is small. It exists for
   * exactly one consumer — the local live-discovery stand-in, which needs a
   * deterministic eligible account to put in the matching pool so one developer
   * can walk a two-person feature — and `LIVE_DISCOVERY_SIMULATION` is refused
   * outside local and test, so nothing in a deployed environment composes the
   * adapter that calls it.
   *
   * Ordered by creation and then by identifier so the same world produces the
   * same first account every time. A random order would make a walked scenario
   * unrepeatable, which is the one property a simulation has to have.
   */
  async listActive(
    executor: AnyExecutor,
    input: { readonly excludeId: string; readonly limit: number },
  ): Promise<readonly UserAccountRow[]> {
    return executor
      .select()
      .from(userAccounts)
      .where(
        and(
          eq(userAccounts.status, 'active'),
          ne(userAccounts.id, input.excludeId),
        ),
      )
      .orderBy(userAccounts.createdAt, userAccounts.id)
      .limit(input.limit);
  }

  /**
   * Creates the consumer account for an AUTH account, or returns nothing when
   * one already exists. The unique index on `auth_account_id` is what makes
   * concurrent first calls converge on a single row: the loser's insert is
   * discarded by the conflict clause rather than by a read that could race.
   */
  async insertIfAbsent(
    executor: AnyExecutor,
    input: {
      readonly authAccountId: string;
      readonly locale?: string | undefined;
      readonly now: Date;
      readonly status: UserAccountStatus;
      readonly statusReason?: UserAccountStatusReason | undefined;
    },
  ): Promise<UserAccountRow | undefined> {
    const inserted = await executor
      .insert(userAccounts)
      .values({
        authAccountId: input.authAccountId,
        createdAt: input.now,
        id: crypto.randomUUID(),
        locale: input.locale ?? null,
        status: input.status,
        statusChangedAt: input.now,
        statusReason: input.statusReason ?? null,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: userAccounts.authAccountId })
      .returning();
    return inserted[0];
  }

  /**
   * Records acknowledgement evidence. A version already acknowledged is left
   * exactly as it was: re-submitting must never rewrite when a person agreed.
   */
  async recordPolicyAcknowledgements(
    executor: AnyExecutor,
    input: {
      readonly acknowledgedAt: Date;
      readonly audience: 'consumer_web' | 'consumer_mobile';
      readonly documents: readonly {
        readonly key: ConsumerPolicyKey;
        readonly version: string;
      }[];
      readonly userId: string;
    },
  ): Promise<void> {
    if (input.documents.length === 0) return;
    await executor
      .insert(userPolicyAcknowledgements)
      .values(
        input.documents.map((document) => ({
          acknowledgedAt: input.acknowledgedAt,
          audience: input.audience,
          policyKey: document.key,
          policyVersion: document.version,
          userId: input.userId,
        })),
      )
      .onConflictDoNothing({
        target: [
          userPolicyAcknowledgements.userId,
          userPolicyAcknowledgements.policyKey,
          userPolicyAcknowledgements.policyVersion,
        ],
      });
  }

  /** Acknowledgements the account holds for the named policy keys. */
  async findPolicyAcknowledgements(
    executor: AnyExecutor,
    input: {
      readonly keys: readonly ConsumerPolicyKey[];
      readonly userId: string;
    },
  ): Promise<UserPolicyAcknowledgementRow[]> {
    if (input.keys.length === 0) return [];
    return executor
      .select()
      .from(userPolicyAcknowledgements)
      .where(
        and(
          eq(userPolicyAcknowledgements.userId, input.userId),
          inArray(userPolicyAcknowledgements.policyKey, [...input.keys]),
        ),
      );
  }

  async recordAdultDeclaration(
    executor: AnyExecutor,
    input: {
      readonly decidedAt: Date;
      readonly outcome: AdultDeclarationOutcome;
      readonly policyVersion: string;
      readonly recordedAt: Date;
      readonly region?: string | undefined;
      readonly userId: string;
    },
  ): Promise<UserAdultDeclarationRow> {
    const inserted = await executor
      .insert(userAdultDeclarations)
      .values({
        decidedAt: input.decidedAt,
        outcome: input.outcome,
        policyVersion: input.policyVersion,
        recordedAt: input.recordedAt,
        region: input.region ?? null,
        userId: input.userId,
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new Error('Adult declaration insert returned no row');
    }
    return row;
  }

  /**
   * The current assurance is the most recent assessment. Ordering is by the
   * sequence rather than the timestamp, so two assessments recorded in the same
   * instant still have one unambiguous winner.
   */
  async findLatestAdultDeclaration(
    executor: AnyExecutor,
    userId: string,
  ): Promise<UserAdultDeclarationRow | undefined> {
    const rows = await executor
      .select()
      .from(userAdultDeclarations)
      .where(eq(userAdultDeclarations.userId, userId))
      .orderBy(
        desc(userAdultDeclarations.recordedAt),
        desc(userAdultDeclarations.id),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Compare-and-set on the current status. The expected status is part of the
   * predicate, so a concurrent transition is lost rather than silently
   * overwritten, and the caller learns which one happened.
   */
  async transitionAccountStatus(
    executor: AnyExecutor,
    input: {
      readonly deletionRequestedAt?: Date | undefined;
      readonly expectedStatus: UserAccountStatus;
      readonly now: Date;
      readonly region?: string | undefined;
      readonly status: UserAccountStatus;
      readonly statusReason: UserAccountStatusReason | null;
      readonly userId: string;
    },
  ): Promise<UserAccountRow | undefined> {
    const updated = await executor
      .update(userAccounts)
      .set({
        ...(input.deletionRequestedAt === undefined
          ? {}
          : { deletionRequestedAt: input.deletionRequestedAt }),
        ...(input.region === undefined ? {} : { region: input.region }),
        status: input.status,
        statusChangedAt: input.now,
        statusReason: input.statusReason,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(userAccounts.id, input.userId),
          eq(userAccounts.status, input.expectedStatus),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Sets region without touching lifecycle state. */
  async updateRegion(
    executor: AnyExecutor,
    input: {
      readonly now: Date;
      readonly region: string;
      readonly userId: string;
    },
  ): Promise<void> {
    await executor
      .update(userAccounts)
      .set({ region: input.region, updatedAt: input.now })
      .where(eq(userAccounts.id, input.userId));
  }
}
