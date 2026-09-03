import type { TransactionHandle } from '../database/executor.js';
import { lockPair } from '../database/pair-lock.js';
import { lockSubject } from '../database/subject-lock.js';
import type { LiveEncounterEnforcementPort } from '../live/enforcement.js';
import type { RtcCallEnforcementPort } from '../realtime/enforcement.js';
import type { UserAccountRow } from '../users/repository.js';
import type { UsersService } from '../users/service.js';
import {
  decodeBlockCursor,
  decodeReportCursor,
  encodeBlockCursor,
  encodeReportCursor,
} from './cursor.js';
import {
  casePolicyVersion,
  evidencePolicyVersion,
  maximumSafetyPageSize,
  queueFor,
  reportPolicyVersion,
  reportRateLimitCount,
  reportRateWindowMilliseconds,
  type ReportReasonCode,
  type ReportSourceSurface,
  type ReportTargetType,
} from './policy.js';
import type {
  BlockRow,
  CaseRow,
  ReportRow,
  SafetyRepository,
} from './repository.js';
import type {
  ReportTargetRequest,
  ReportTargetResolver,
  ResolvedReportTarget,
} from './targets.js';

export interface BlockView {
  readonly blockedId: string;
  readonly createdAt: Date;
}

export interface ReportView {
  readonly createdAt: Date;
  readonly id: string;
  readonly reasonCode: ReportReasonCode;
  readonly state: 'received' | 'under_review' | 'actioned' | 'dismissed';
  /**
   * What kind of thing was reported, and deliberately not which one.
   *
   * The reporter named it — a handle, a slug, an identifier from a page they
   * were on — so echoing Velora's internal identifier back would hand them one
   * they did not have, for a creator, a club, or a content item they only ever
   * saw addressed publicly. The type is enough to render "you reported a
   * creator" and carries nothing that was not already theirs.
   */
  readonly targetType: ReportTargetType;
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

/**
 * Reporting somebody and separating from them, as one answer.
 *
 * The block is not optional here for the same reason it is not optional in the
 * contract: it is applied first, so anything this returns has a block behind
 * it. `report` absent means the reporting bound was reached — the person is
 * still separated, and saying otherwise would be the one lie a safety response
 * must not tell.
 */
export type ReportWithBlockOutcome =
  | {
      readonly kind: 'applied';
      readonly block: BlockView;
      readonly report: ReportView | undefined;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_target' };

export type ReportListOutcome =
  | {
      readonly kind: 'page';
      readonly reports: readonly ReportView[];
      readonly nextCursor: string | undefined;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_cursor' };

export interface SafetyServiceDependencies {
  /**
   * REALTIME's published enforcement contract, when this composition has one.
   *
   * Optional because a composition without RTC has no calls to end, not
   * because ending them is optional where they exist. When it is absent a
   * block does what it always did; when it is present a block also stops a
   * call in progress, in the same transaction.
   */
  readonly calls?: RtcCallEnforcementPort;
  /**
   * LIVE's published enforcement contract, when this composition has one.
   *
   * Separate from `calls` because they are separate rows with separate owners:
   * ending the RTC session that carries a random encounter does not end the
   * encounter, and ending the encounter does not tear down the session. A block
   * has to do both, in this transaction, under this pair lock.
   */
  readonly liveEncounters?: LiveEncounterEnforcementPort;
  readonly now: () => Date;
  readonly repository: SafetyRepository;
  readonly targets: ReportTargetResolver;
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
        // A call in progress ends with the block, in this transaction, under
        // this pair lock. Refusing the *next* thing the pair does would leave
        // the conversation somebody is having right now running — which is the
        // one moment a block most needs to work. Ending it also advances the
        // call's authorization generation, so a credential either of them is
        // holding dies at the same instant.
        //
        // Deliberately unconditional on `created`: a block that already stood
        // is answered idempotently, and a call that somehow outlived an earlier
        // block should still be ended rather than reported as fine.
        await this.dependencies.calls?.endLiveCallForPair({
          executor,
          first: actor.id,
          now,
          second: targetId,
        });
        // And the random live encounter, if these two were meeting through
        // live discovery. Two calls because they are two rows owned by two
        // domains: the session is REALTIME's and the encounter is LIVE's, and
        // neither writes the other's table. Both end here, together, so a block
        // placed while two strangers are on camera stops that rather than
        // refusing the next thing they try.
        await this.dependencies.liveEncounters?.endLiveEncounterForPair({
          executor,
          first: actor.id,
          now,
          second: targetId,
        });
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
      readonly sourceSurface: ReportSourceSurface;
      readonly target: ReportTargetRequest;
    },
  ): Promise<ReportOutcome> {
    const { repository } = this.dependencies;
    const resolved = await this.dependencies.targets.resolve({
      executor: repository.transactionless,
      reporterId: actor.id,
      target: input.target,
    });
    // One refusal for a target that does not exist, one that is not published,
    // one that belongs to somebody else, and one that is the reporter. A caller
    // probing this endpoint learns nothing finer than "not a thing you can
    // report", which is what stops it becoming an enumeration oracle.
    if (resolved === undefined) return { kind: 'invalid_target' };

    // A conversation attached as evidence is checked the same way a reported
    // conversation is. It used to be stored on the reporter's word alone, which
    // made it a way to point a moderation decision — one that can close a
    // conversation — at two people the reporter had nothing to do with.
    if (
      input.conversationId !== undefined &&
      !(await this.dependencies.targets.participatesIn({
        conversationId: input.conversationId,
        executor: repository.transactionless,
        reporterId: actor.id,
      }))
    ) {
      return { kind: 'invalid_target' };
    }

    const now = this.dependencies.now();
    const existing = await repository.findReportByClientId(
      repository.transactionless,
      { clientReportId: input.clientReportId, reporterId: actor.id },
    );
    if (existing !== undefined) {
      return { kind: 'report', view: reportView(existing) };
    }

    const recent = await repository.countReportsSince(
      repository.transactionless,
      {
        reporterId: actor.id,
        since: new Date(now.getTime() - reportRateWindowMilliseconds),
      },
    );
    if (recent >= reportRateLimitCount) return { kind: 'rate_limited' };

    // The report and the case it joins commit together, under the lock that
    // serializes decisions about this target. Without it two reports arriving
    // at once could each find no open case and each open one, and the target
    // would have two reviews of the same thing.
    const row = await repository.transaction(async (executor) => {
      await lockSubject(executor, resolved.targetId);
      const openCase = await this.caseFor(executor, resolved, now);
      const created = await repository.insertReport(executor, {
        caseId: openCase.id,
        clientReportId: input.clientReportId,
        conversationId: input.conversationId ?? null,
        detail: input.detail ?? null,
        messageId: input.messageId ?? null,
        now,
        policyVersion: reportPolicyVersion,
        reasonCode: input.reasonCode,
        reporterId: actor.id,
        sourceSurface: input.sourceSurface,
        subjectId: resolved.targetId,
        targetType: resolved.targetType,
      });
      if (created !== undefined) {
        // A report is the first evidence in the case it opened or joined, and
        // it is evidence by reference: the narrative, the reporter, and the
        // surface stay on the report itself. Recording it here rather than when
        // a reviewer first cites something is what makes the case's evidence a
        // complete record of what was known, in the order it was known.
        await repository.insertEvidence(executor, {
          actorReference: null,
          caseId: openCase.id,
          externalReference: null,
          kind: 'report',
          note: null,
          now,
          observedAt: null,
          policyVersion: evidencePolicyVersion,
          referenceId: created.id,
          referenceType: 'safety_report',
          stateLabel: null,
        });
      }
      return (
        created ??
        (await repository.findReportByClientId(executor, {
          clientReportId: input.clientReportId,
          reporterId: actor.id,
        }))
      );
    });
    return row === undefined
      ? { kind: 'invalid_target' }
      : { kind: 'report', view: reportView(row) };
  }

  /**
   * Blocks somebody and reports them, in that order.
   *
   * The order is the design. Two clients calls could have the block land and
   * the report be lost, or the report land and the block be lost, and only one
   * of those failures is dangerous: somebody who believes they are separated
   * and is not. So separation happens first and unconditionally, and the report
   * follows. If the reporting bound refuses the second half, the caller is told
   * — with the block that stands — rather than being refused outright and left
   * to guess whether anything happened.
   *
   * They are deliberately not one transaction. A block takes the pair lock and
   * ends whatever is running between these two; a report takes the *subject*
   * lock and joins a moderation case. Holding both at once would introduce a
   * lock order this domain does not otherwise have, for no gain — each half is
   * already idempotent, and a retry after a crash between them re-applies the
   * block it already made and files the report it did not.
   */
  async reportWithBlock(
    actor: UserAccountRow,
    input: {
      readonly clientReportId: string;
      readonly conversationId?: string | undefined;
      readonly detail?: string | undefined;
      readonly messageId?: string | undefined;
      readonly reasonCode: ReportReasonCode;
      readonly sourceSurface: ReportSourceSurface;
      readonly targetAccountId: string;
    },
  ): Promise<ReportWithBlockOutcome> {
    const blocked = await this.block(actor, input.targetAccountId);
    if (blocked.kind === 'invalid_target') return { kind: 'invalid_target' };
    if (blocked.kind !== 'blocked') return { kind: 'not_eligible' };

    const reported = await this.report(actor, {
      clientReportId: input.clientReportId,
      conversationId: input.conversationId,
      detail: input.detail,
      messageId: input.messageId,
      reasonCode: input.reasonCode,
      sourceSurface: input.sourceSurface,
      target: { accountId: input.targetAccountId, type: 'consumer_account' },
    });
    // A rate-limited or unresolvable report is reported as an absent report
    // rather than as a failure of the whole call. The block stands either way,
    // and it is the half that protects somebody.
    return {
      block: blocked.view,
      kind: 'applied',
      report: reported.kind === 'report' ? reported.view : undefined,
    };
  }

  /**
   * The open case this report belongs in, opening one if there is none.
   *
   * Joining an existing case is grouping, not escalation. Nothing about the
   * case changes because a second report arrived: not its priority, not its
   * state, not its queue. `docs/flows/report-to-enforcement.md` forbids report
   * volume from deciding anything, and a case that quietly got more urgent
   * because more people complained would be exactly that rule broken by a
   * side effect.
   */
  private async caseFor(
    executor: TransactionHandle,
    target: ResolvedReportTarget,
    now: Date,
  ): Promise<CaseRow> {
    const { repository } = this.dependencies;
    const open = await repository.findOpenCaseForTarget(executor, target);
    if (open !== undefined) return open;
    const created = await repository.insertCase(executor, {
      now,
      policyVersion: casePolicyVersion,
      // Untriaged is a real answer rather than a missing one: nobody has looked
      // at this yet, and only a reviewer may say how urgent it is.
      priority: 'untriaged',
      queue: queueFor(target.targetType),
      targetId: target.targetId,
      targetType: target.targetType,
    });
    if (created !== undefined) return created;
    // The partial unique index refused the insert, so somebody else opened the
    // case between the read and the write. Theirs is the case.
    const winner = await repository.findOpenCaseForTarget(executor, target);
    if (winner === undefined) {
      throw new Error('Case insert conflicted with no open case to join');
    }
    return winner;
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
    targetType: row.targetType,
  };
}
