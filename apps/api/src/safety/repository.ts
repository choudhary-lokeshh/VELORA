import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import { openReportStates } from './policy.js';
import { safetyBlocks, safetyEnforcements, safetyReports } from './schema.js';

export type BlockRow = typeof safetyBlocks.$inferSelect;
export type ReportRow = typeof safetyReports.$inferSelect;
export type EnforcementRow = typeof safetyEnforcements.$inferSelect;

/**
 * Every TRUST & SAFETY read and write.
 *
 * Nothing here touches another domain's tables. What a block means for
 * discovery, messaging, or notifications is decided by those domains asking
 * this one through its published contract.
 */
export class SafetyRepository {
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
   * Records a block, or reports that the same one is already live.
   *
   * The partial unique index decides, not a prior read, so two simultaneous
   * blocks of the same person produce one live record and the caller of the
   * loser still gets a successful, idempotent answer.
   */
  async insertBlock(
    executor: Executor,
    input: {
      readonly blockedId: string;
      readonly blockerId: string;
      readonly now: Date;
    },
  ): Promise<BlockRow | undefined> {
    const inserted = await executor
      .insert(safetyBlocks)
      .values({
        blockedId: input.blockedId,
        blockerId: input.blockerId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findLiveBlock(
    executor: Executor,
    input: { readonly blockedId: string; readonly blockerId: string },
  ): Promise<BlockRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyBlocks)
      .where(
        and(
          eq(safetyBlocks.blockerId, input.blockerId),
          eq(safetyBlocks.blockedId, input.blockedId),
          isNull(safetyBlocks.revokedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** Withdraws the caller's own block. The record of it stays. */
  async revokeBlock(
    executor: Executor,
    input: {
      readonly blockedId: string;
      readonly blockerId: string;
      readonly now: Date;
    },
  ): Promise<BlockRow | undefined> {
    const updated = await executor
      .update(safetyBlocks)
      .set({ revokedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(safetyBlocks.blockerId, input.blockerId),
          eq(safetyBlocks.blockedId, input.blockedId),
          isNull(safetyBlocks.revokedAt),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Whether a live block stands between two people, in either direction.
   *
   * The record is directional and the effect is not: if either person has
   * blocked the other, neither may interact with the other. Asking in one
   * statement rather than twice keeps the answer atomic with respect to the
   * transaction it is asked in.
   */
  async isPairBlocked(
    executor: Executor,
    input: { readonly first: string; readonly second: string },
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: safetyBlocks.id })
      .from(safetyBlocks)
      .where(
        and(
          or(
            and(
              eq(safetyBlocks.blockerId, input.first),
              eq(safetyBlocks.blockedId, input.second),
            ),
            and(
              eq(safetyBlocks.blockerId, input.second),
              eq(safetyBlocks.blockedId, input.first),
            ),
          ),
          isNull(safetyBlocks.revokedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Which of these candidates the viewer may not interact with.
   *
   * Asked about a bounded batch for the same reason discovery's suppression is:
   * "everybody this account has ever blocked or been blocked by" grows for the
   * life of the account, and making that an input to a feed query would make the
   * number of a person's safety relationships a correctness question.
   */
  async blockedAmong(
    executor: Executor,
    input: {
      readonly candidateIds: readonly string[];
      readonly viewerId: string;
    },
  ): Promise<ReadonlySet<string>> {
    if (input.candidateIds.length === 0) return new Set();
    const others = [...input.candidateIds];
    const rows = await executor
      .select({
        blockedId: safetyBlocks.blockedId,
        blockerId: safetyBlocks.blockerId,
      })
      .from(safetyBlocks)
      .where(
        and(
          or(
            and(
              eq(safetyBlocks.blockerId, input.viewerId),
              inArray(safetyBlocks.blockedId, others),
            ),
            and(
              eq(safetyBlocks.blockedId, input.viewerId),
              inArray(safetyBlocks.blockerId, others),
            ),
          ),
          isNull(safetyBlocks.revokedAt),
        ),
      );
    return new Set(
      rows.map((row) =>
        row.blockerId === input.viewerId ? row.blockedId : row.blockerId,
      ),
    );
  }

  /** The caller's own live blocks, newest first. */
  async listBlocks(
    executor: Executor,
    input: {
      readonly before:
        { readonly createdAt: Date; readonly id: number } | undefined;
      readonly blockerId: string;
      readonly limit: number;
    },
  ): Promise<BlockRow[]> {
    const position =
      input.before === undefined
        ? undefined
        : or(
            lt(safetyBlocks.createdAt, input.before.createdAt),
            and(
              eq(safetyBlocks.createdAt, input.before.createdAt),
              lt(safetyBlocks.id, input.before.id),
            ),
          );
    return executor
      .select()
      .from(safetyBlocks)
      .where(
        and(
          eq(safetyBlocks.blockerId, input.blockerId),
          isNull(safetyBlocks.revokedAt),
          position,
        ),
      )
      .orderBy(desc(safetyBlocks.createdAt), desc(safetyBlocks.id))
      .limit(input.limit);
  }

  /**
   * Records a report, or returns nothing when this reporter already used that
   * client identifier. The unique index decides, so a retry cannot become a
   * second report.
   */
  async insertReport(
    executor: Executor,
    input: {
      readonly clientReportId: string;
      readonly conversationId: string | null;
      readonly detail: string | null;
      readonly messageId: string | null;
      readonly now: Date;
      readonly policyVersion: string;
      readonly reasonCode: string;
      readonly reporterId: string;
      readonly subjectId: string;
    },
  ): Promise<ReportRow | undefined> {
    const inserted = await executor
      .insert(safetyReports)
      .values({
        clientReportId: input.clientReportId,
        conversationId: input.conversationId,
        createdAt: input.now,
        detail: input.detail,
        id: crypto.randomUUID(),
        messageId: input.messageId,
        policyVersion: input.policyVersion,
        reasonCode: input.reasonCode,
        reporterId: input.reporterId,
        state: 'received',
        subjectId: input.subjectId,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findReportByClientId(
    executor: Executor,
    input: { readonly clientReportId: string; readonly reporterId: string },
  ): Promise<ReportRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.reporterId, input.reporterId),
          eq(safetyReports.clientReportId, input.clientReportId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * How many reports this account has filed since a moment.
   *
   * Used to bound submission volume. It never removes or refuses to store a
   * report already made: a discarded report is destroyed evidence.
   */
  async countReportsSince(
    executor: Executor,
    input: { readonly reporterId: string; readonly since: Date },
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.reporterId, input.reporterId),
          gt(safetyReports.createdAt, input.since),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /** The caller's own reports, newest first. Never anybody else's. */
  async listReportsBy(
    executor: Executor,
    input: {
      readonly before:
        { readonly createdAt: Date; readonly id: string } | undefined;
      readonly limit: number;
      readonly reporterId: string;
    },
  ): Promise<ReportRow[]> {
    const position =
      input.before === undefined
        ? undefined
        : or(
            lt(safetyReports.createdAt, input.before.createdAt),
            and(
              eq(safetyReports.createdAt, input.before.createdAt),
              lt(safetyReports.id, input.before.id),
            ),
          );
    return executor
      .select()
      .from(safetyReports)
      .where(and(eq(safetyReports.reporterId, input.reporterId), position))
      .orderBy(desc(safetyReports.createdAt), desc(safetyReports.id))
      .limit(input.limit);
  }

  /** The moderation queue: unresolved reports, oldest first. */
  async listOpenReports(
    executor: Executor,
    limit: number,
  ): Promise<ReportRow[]> {
    return executor
      .select()
      .from(safetyReports)
      .where(inArray(safetyReports.state, [...openReportStates]))
      .orderBy(asc(safetyReports.createdAt), asc(safetyReports.id))
      .limit(limit);
  }

  async findReport(
    executor: Executor,
    id: string,
  ): Promise<ReportRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyReports)
      .where(eq(safetyReports.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Moves a report along its lifecycle. Compare-and-set on the version, so two
   * reviewers acting at once produce one transition and the loser is told.
   */
  async transitionReport(
    executor: Executor,
    input: {
      readonly expectedVersion: number;
      readonly id: string;
      readonly now: Date;
      readonly resolved: boolean;
      readonly state: string;
    },
  ): Promise<ReportRow | undefined> {
    const updated = await executor
      .update(safetyReports)
      .set({
        resolvedAt: input.resolved ? input.now : null,
        state: input.state,
        updatedAt: input.now,
        version: sql`${safetyReports.version} + 1`,
      })
      .where(
        and(
          eq(safetyReports.id, input.id),
          eq(safetyReports.version, input.expectedVersion),
          inArray(safetyReports.state, [...openReportStates]),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Appends an enforcement record. Nothing here is ever updated. */
  async insertEnforcement(
    executor: Executor,
    input: {
      readonly actorReference: string;
      readonly effectiveAt: Date;
      readonly now: Date;
      readonly policyVersion: string;
      readonly reasonCode: string;
      readonly reportId: string | null;
      readonly scope: string;
      readonly subjectId: string;
      readonly targetConversationId: string | null;
    },
  ): Promise<EnforcementRow> {
    const rows = await executor
      .insert(safetyEnforcements)
      .values({
        actorReference: input.actorReference,
        createdAt: input.now,
        effectiveAt: input.effectiveAt,
        id: crypto.randomUUID(),
        policyVersion: input.policyVersion,
        reasonCode: input.reasonCode,
        reportId: input.reportId,
        scope: input.scope,
        subjectId: input.subjectId,
        targetConversationId: input.targetConversationId,
      })
      .returning();
    const row = rows[0];
    if (row === undefined)
      throw new Error('Enforcement insert returned no row');
    return row;
  }

  async listEnforcementsFor(
    executor: Executor,
    subjectId: string,
  ): Promise<EnforcementRow[]> {
    return executor
      .select()
      .from(safetyEnforcements)
      .where(eq(safetyEnforcements.subjectId, subjectId))
      .orderBy(desc(safetyEnforcements.effectiveAt));
  }
}
