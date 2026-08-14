import { lockPair } from '../database/pair-lock.js';
import type { UserAccountRow } from '../users/repository.js';
import type { UsersService } from '../users/service.js';
import {
  decodeBlockCursor,
  decodeReportCursor,
  encodeBlockCursor,
  encodeReportCursor,
} from './cursor.js';
import {
  maximumSafetyPageSize,
  reportPolicyVersion,
  reportRateLimitCount,
  reportRateWindowMilliseconds,
  type ReportReasonCode,
} from './policy.js';
import type { BlockRow, ReportRow, SafetyRepository } from './repository.js';

export interface BlockView {
  readonly blockedId: string;
  readonly createdAt: Date;
}

export interface ReportView {
  readonly createdAt: Date;
  readonly id: string;
  readonly reasonCode: ReportReasonCode;
  readonly state: 'received' | 'under_review' | 'actioned' | 'dismissed';
  readonly subjectId: string;
}

export type BlockOutcome =
  | { readonly kind: 'blocked'; readonly view: BlockView }
  | { readonly kind: 'not_eligible' }
  /** A block of oneself, or of an account that does not exist. */
  | { readonly kind: 'invalid_target' };

export type BlockRemovalOutcome =
  | { readonly kind: 'removed'; readonly view: BlockView }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'not_found' };

export type BlockListOutcome =
  | {
      readonly kind: 'page';
      readonly blocks: readonly BlockView[];
      readonly nextCursor: string | undefined;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_cursor' };

export type ReportOutcome =
  | { readonly kind: 'report'; readonly view: ReportView }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_target' }
  | { readonly kind: 'rate_limited' };

export type ReportListOutcome =
  | {
      readonly kind: 'page';
      readonly reports: readonly ReportView[];
      readonly nextCursor: string | undefined;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_cursor' };

export interface SafetyServiceDependencies {
  readonly now: () => Date;
  readonly repository: SafetyRepository;
  readonly users: UsersService;
}

/**
 * Consumer-facing safety actions.
 *
 * Blocking and reporting are the two things a person must be able to do from
 * the first day the product exists, so neither is gated on the admission
 * standing the rest of the consumer product requires: an account whose adult
 * assurance has lapsed, or that is itself restricted, can still stop somebody
 * contacting it and can still report. Requiring standing here would mean the
 * accounts most likely to need protection were the ones denied it.
 *
 * What this service never does is tell anybody about anybody else. A block is
 * not notified. A report is not notified, and its reporter, narrative, and
 * internal state are never visible to the person reported.
 */
export class SafetyService {
  constructor(private readonly dependencies: SafetyServiceDependencies) {}

  /**
   * Blocks another account.
   *
   * The pair lock is taken first and the block is written inside it, so every
   * other decision about this pair — a message being sent, an introduction
   * being signalled — either completes before the block exists or waits and
   * then sees it. There is no window in which one of them read "no block" and
   * the block committed underneath it.
   *
   * Idempotent: blocking somebody already blocked renews nothing and reports
   * the block that stands, so a client that lost a response gets the same
   * answer rather than an error about a decision the person already made.
   */
  async block(actor: UserAccountRow, targetId: string): Promise<BlockOutcome> {
    if (targetId === actor.id) return { kind: 'invalid_target' };
    const target = await this.dependencies.users.findAccountById(targetId);
    if (target === undefined) return { kind: 'invalid_target' };

    const now = this.dependencies.now();
    return this.dependencies.repository.transaction(
      async (executor): Promise<BlockOutcome> => {
        await lockPair(executor, actor.id, targetId);
        const created = await this.dependencies.repository.insertBlock(
          executor,
          { blockedId: targetId, blockerId: actor.id, now },
        );
        const row =
          created ??
          (await this.dependencies.repository.findLiveBlock(executor, {
            blockedId: targetId,
            blockerId: actor.id,
          }));
        return row === undefined
          ? { kind: 'invalid_target' }
          : { kind: 'blocked', view: blockView(row) };
      },
    );
  }

  /**
   * Withdraws the caller's own block.
   *
   * Taken under the same pair lock, for the same reason in reverse: a send that
   * is deciding whether the pair may interact must not observe a half-applied
   * withdrawal. The record of the block and of its withdrawal both stay.
   */
  async removeBlock(
    actor: UserAccountRow,
    targetId: string,
  ): Promise<BlockRemovalOutcome> {
    if (targetId === actor.id) return { kind: 'not_found' };
    const now = this.dependencies.now();
    return this.dependencies.repository.transaction(
      async (executor): Promise<BlockRemovalOutcome> => {
        await lockPair(executor, actor.id, targetId);
        const revoked = await this.dependencies.repository.revokeBlock(
          executor,
          { blockedId: targetId, blockerId: actor.id, now },
        );
        return revoked === undefined
          ? { kind: 'not_found' }
          : { kind: 'removed', view: blockView(revoked) };
      },
    );
  }

  async listBlocks(
    actor: UserAccountRow,
    input: { readonly cursor: string | undefined; readonly pageSize: number },
  ): Promise<BlockListOutcome> {
    const decoded =
      input.cursor === undefined ? undefined : decodeBlockCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }
    const pageSize = Math.max(
      1,
      Math.min(input.pageSize, maximumSafetyPageSize),
    );
    const rows = await this.dependencies.repository.listBlocks(
      this.dependencies.repository.transactionless,
      { before: decoded, blockerId: actor.id, limit: pageSize + 1 },
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      blocks: page.map(blockView),
      kind: 'page',
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeBlockCursor({ createdAt: last.createdAt, id: last.id })
          : undefined,
    };
  }

  /**
   * Files a report.
   *
   * Retry-safe on the caller's own client identifier, so a lost response does
   * not become a second report. A genuinely second report about the same person
   * under a new identifier is a second report: the flow document requires
   * duplicates to be linked under moderation policy rather than refused, because
   * refusing one is discarding evidence.
   *
   * The submission rate is bounded. Reaching the bound refuses further
   * submissions for the window and never removes or alters a report already
   * made.
   */
  async report(
    actor: UserAccountRow,
    input: {
      readonly clientReportId: string;
      readonly conversationId?: string | undefined;
      readonly detail?: string | undefined;
      readonly messageId?: string | undefined;
      readonly reasonCode: ReportReasonCode;
      readonly subjectId: string;
    },
  ): Promise<ReportOutcome> {
    if (input.subjectId === actor.id) return { kind: 'invalid_target' };
    const subject = await this.dependencies.users.findAccountById(
      input.subjectId,
    );
    if (subject === undefined) return { kind: 'invalid_target' };

    const now = this.dependencies.now();
    const existing = await this.dependencies.repository.findReportByClientId(
      this.dependencies.repository.transactionless,
      { clientReportId: input.clientReportId, reporterId: actor.id },
    );
    if (existing !== undefined) {
      return { kind: 'report', view: reportView(existing) };
    }

    const recent = await this.dependencies.repository.countReportsSince(
      this.dependencies.repository.transactionless,
      {
        reporterId: actor.id,
        since: new Date(now.getTime() - reportRateWindowMilliseconds),
      },
    );
    if (recent >= reportRateLimitCount) return { kind: 'rate_limited' };

    const created = await this.dependencies.repository.insertReport(
      this.dependencies.repository.transactionless,
      {
        clientReportId: input.clientReportId,
        conversationId: input.conversationId ?? null,
        detail: input.detail ?? null,
        messageId: input.messageId ?? null,
        now,
        policyVersion: reportPolicyVersion,
        reasonCode: input.reasonCode,
        reporterId: actor.id,
        subjectId: input.subjectId,
      },
    );
    const row =
      created ??
      (await this.dependencies.repository.findReportByClientId(
        this.dependencies.repository.transactionless,
        { clientReportId: input.clientReportId, reporterId: actor.id },
      ));
    return row === undefined
      ? { kind: 'invalid_target' }
      : { kind: 'report', view: reportView(row) };
  }

  /** The caller's own reports. There is no route to anybody else's. */
  async listReports(
    actor: UserAccountRow,
    input: { readonly cursor: string | undefined; readonly pageSize: number },
  ): Promise<ReportListOutcome> {
    const decoded =
      input.cursor === undefined ? undefined : decodeReportCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }
    const pageSize = Math.max(
      1,
      Math.min(input.pageSize, maximumSafetyPageSize),
    );
    const rows = await this.dependencies.repository.listReportsBy(
      this.dependencies.repository.transactionless,
      { before: decoded, limit: pageSize + 1, reporterId: actor.id },
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      kind: 'page',
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeReportCursor({ createdAt: last.createdAt, id: last.id })
          : undefined,
      reports: page.map(reportView),
    };
  }
}

function blockView(row: BlockRow): BlockView {
  return { blockedId: row.blockedId, createdAt: row.createdAt };
}

/**
 * A report as its own reporter may see it.
 *
 * The reporter's narrative is deliberately absent even from their own view:
 * echoing stored evidence back over the API turns a report record into a
 * readable store, and the reporter already knows what they wrote. Nothing here
 * is ever rendered to the subject.
 */
function reportView(row: ReportRow): ReportView {
  return {
    createdAt: row.createdAt,
    id: row.id,
    reasonCode: row.reasonCode as ReportReasonCode,
    state: row.state as ReportView['state'],
    subjectId: row.subjectId,
  };
}
