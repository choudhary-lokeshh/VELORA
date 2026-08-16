import { lockSubject } from '../database/subject-lock.js';
import {
  casePolicyVersion,
  maximumTakedownPageSize,
  queueFor,
  takedownLeaseMilliseconds,
  takedownPolicyVersion,
  takedownRateLimitCount,
  takedownRateWindowMilliseconds,
  urgencyFor,
  type TakedownClaimantKind,
  type TakedownReasonCode,
  type TakedownState,
  type TakedownUrgency,
} from './policy.js';
import type { SafetyRepository, TakedownClaimRow } from './repository.js';

/**
 * Takedown claims and the deadlines they carry.
 *
 * A claim asks for one specific item to be removed. It is not a report: a
 * report is filed by a Velora account about a target, and a claim can come from
 * somebody with no account at all — a depicted person asking for a depiction of
 * themselves to come down is the case
 * [surface and distribution eligibility](../../../../docs/compliance/07-surface-and-distribution-eligibility.md)
 * records, where the card-network requirement is exactly that route.
 *
 * **A claim decides nothing by existing.** It opens or joins a case and is
 * reviewed there like any other allegation. What it adds is *when the platform
 * is owed an answer*, and every one of those instants comes from a published
 * policy rather than from arithmetic written here. Production publishes none,
 * so production records claims with no deadlines at all — which is the accurate
 * state of a platform whose obligations nobody has approved, and is better than
 * a hard-coded number that would look like compliance and carry no authority.
 */

export interface TakedownDeadlines {
  readonly acknowledgementDueAt: Date;
  readonly actionDueAt: Date;
  readonly triageDueAt: Date;
}

/**
 * The published deadline policy, or the absence of one.
 *
 * `version` is `undefined` when nothing is published, and the authority then
 * records no deadline rather than inventing one. The version travels onto every
 * claim it produced, so a claim decided under an older policy stays explicable.
 */
export interface TakedownDeadlinePolicy {
  deadlinesFor(input: {
    readonly receivedAt: Date;
    readonly urgency: TakedownUrgency;
  }): TakedownDeadlines | undefined;
  readonly version: string | undefined;
}

/** Publishes no deadline, which is the only honest state today. */
export class UnpublishedTakedownPolicy implements TakedownDeadlinePolicy {
  readonly version = undefined;

  deadlinesFor(): TakedownDeadlines | undefined {
    return undefined;
  }
}

/**
 * Development and test arithmetic.
 *
 * Deterministic so the engine is exercisable, and named so nothing using it can
 * be read as evidence about a real obligation. The numbers are round because
 * they are placeholders; none of them is derived from a source, and the
 * seven-business-day card-network figure is deliberately not among them.
 */
export class LocalTestTakedownPolicy implements TakedownDeadlinePolicy {
  readonly version = 'local-test-v1';

  private static readonly hours = 60 * 60 * 1_000;

  private static readonly windows: Readonly<
    Record<TakedownUrgency, readonly [number, number, number]>
  > = {
    standard: [24, 72, 168],
    urgent: [1, 4, 24],
  };

  deadlinesFor(input: {
    readonly receivedAt: Date;
    readonly urgency: TakedownUrgency;
  }): TakedownDeadlines {
    const [acknowledge, triage, act] =
      LocalTestTakedownPolicy.windows[input.urgency];
    const after = (hours: number) =>
      new Date(
        input.receivedAt.getTime() + hours * LocalTestTakedownPolicy.hours,
      );
    return {
      acknowledgementDueAt: after(acknowledge),
      actionDueAt: after(act),
      triageDueAt: after(triage),
    };
  }
}

export interface TakedownClaimView {
  readonly acknowledgementDueAt: Date | null;
  readonly actionDueAt: Date | null;
  readonly caseId: string;
  readonly claimantKind: TakedownClaimantKind;
  readonly contentId: string;
  readonly deadlinePolicyVersion: string | null;
  readonly id: string;
  readonly reasonCode: TakedownReasonCode;
  readonly receivedAt: Date;
  readonly state: TakedownState;
  readonly triageDueAt: Date | null;
  readonly urgency: TakedownUrgency;
  readonly version: number;
}

export type TakedownSubmission =
  | { readonly kind: 'received'; readonly claim: TakedownClaimView }
  /** This account has filed as many as the window allows. */
  | { readonly kind: 'rate_limited' }
  /** A withdrawal that names a consent record for a different item. */
  | { readonly kind: 'invalid_claim' };

export type TakedownTransition =
  | { readonly kind: 'recorded'; readonly claim: TakedownClaimView }
  | { readonly kind: 'not_found' }
  /** Somebody moved it first, or the read was stale. */
  | { readonly kind: 'conflict' };

export interface TakedownDependencies {
  readonly now: () => Date;
  readonly policy: TakedownDeadlinePolicy;
  readonly repository: SafetyRepository;
}

export class TakedownService {
  constructor(private readonly dependencies: TakedownDependencies) {}

  /** Whether any deadline is published at all. */
  get deadlinesPublished(): boolean {
    return this.dependencies.policy.version !== undefined;
  }

  /**
   * Records a claim, opening or joining the case it will be reviewed in.
   *
   * The case comes first and under the subject lock, exactly as a report's
   * does, so several claims about one item converge on one review rather than
   * opening a review each. Urgency is derived from what is alleged, so a
   * claimant cannot mark their own complaint urgent, and it affects only the
   * deadline — never the decision, and never a reviewer's priority.
   */
  async submit(input: {
    readonly claimantAccountId?: string | undefined;
    readonly claimantKind: TakedownClaimantKind;
    readonly consentRecordId?: string | undefined;
    readonly contentId: string;
    readonly creatorId: string;
    readonly reasonCode: TakedownReasonCode;
  }): Promise<TakedownSubmission> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();

    if (input.consentRecordId !== undefined) {
      const record = await repository.findConsentRecord(
        repository.transactionless,
        input.consentRecordId,
      );
      // A withdrawal has to name a withdrawal of *this* item, or the claim
      // would carry evidence about something else entirely.
      if (
        record?.contentId !== input.contentId ||
        input.reasonCode !== 'consent_withdrawn'
      ) {
        return { kind: 'invalid_claim' };
      }
    }

    if (input.claimantAccountId !== undefined) {
      const recent = await repository.countTakedownClaimsSince(
        repository.transactionless,
        {
          claimantAccountId: input.claimantAccountId,
          since: new Date(now.getTime() - takedownRateWindowMilliseconds),
        },
      );
      // Volume is bounded and truth is not: reaching the bound refuses further
      // submissions and never removes or alters a claim already made.
      if (recent >= takedownRateLimitCount) return { kind: 'rate_limited' };
    }

    const urgency = urgencyFor(input.reasonCode);
    const deadlines = this.dependencies.policy.deadlinesFor({
      receivedAt: now,
      urgency,
    });

    const claim = await repository.transaction(async (executor) => {
      await lockSubject(executor, input.contentId);
      const open = await repository.findOpenCaseForTarget(executor, {
        targetId: input.contentId,
        targetType: 'creator_content',
      });
      const reviewed =
        open ??
        (await repository.insertCase(executor, {
          now,
          policyVersion: casePolicyVersion,
          priority: 'untriaged',
          queue: queueFor('creator_content'),
          targetId: input.contentId,
          targetType: 'creator_content',
        })) ??
        (await repository.findOpenCaseForTarget(executor, {
          targetId: input.contentId,
          targetType: 'creator_content',
        }));
      if (reviewed === undefined) {
        throw new Error('Case insert conflicted with no open case to join');
      }
      return repository.insertTakedownClaim(executor, {
        acknowledgementDueAt: deadlines?.acknowledgementDueAt ?? null,
        actionDueAt: deadlines?.actionDueAt ?? null,
        caseId: reviewed.id,
        claimantAccountId: input.claimantAccountId ?? null,
        claimantKind: input.claimantKind,
        consentRecordId: input.consentRecordId ?? null,
        contentId: input.contentId,
        creatorId: input.creatorId,
        deadlinePolicyVersion: this.dependencies.policy.version ?? null,
        now,
        policyVersion: takedownPolicyVersion,
        reasonCode: input.reasonCode,
        triageDueAt: deadlines?.triageDueAt ?? null,
        urgency,
      });
    });
    return { claim: claimView(claim), kind: 'received' };
  }

  /** Records that the platform has told the claimant it has the claim. */
  async acknowledge(input: {
    readonly claimId: string;
    readonly expectedVersion: number;
  }): Promise<TakedownTransition> {
    return this.move({
      claimId: input.claimId,
      expectedVersion: input.expectedVersion,
      from: ['received'],
      state: 'acknowledged',
    });
  }

  /**
   * Records the outcome of the review.
   *
   * `decided` and `completed` are separate instants because a decision to
   * remove something and the removal taking effect are different facts, and an
   * obligation measured against the wrong one would be measured against a
   * promise. Removing the item is a moderation decision with its own record;
   * this only says the claim has been answered.
   */
  async decide(input: {
    readonly claimId: string;
    readonly dismissed: boolean;
    readonly expectedVersion: number;
  }): Promise<TakedownTransition> {
    return this.move({
      claimId: input.claimId,
      expectedVersion: input.expectedVersion,
      from: input.dismissed ? ['received', 'acknowledged'] : ['acknowledged'],
      state: input.dismissed ? 'dismissed' : 'decided',
    });
  }

  /** Records that whatever was decided has actually taken effect. */
  async complete(input: {
    readonly claimId: string;
    readonly expectedVersion: number;
  }): Promise<TakedownTransition> {
    return this.move({
      claimId: input.claimId,
      expectedVersion: input.expectedVersion,
      from: ['decided'],
      state: 'completed',
    });
  }

  /**
   * Claims still owed work whose action deadline has passed, oldest first.
   *
   * Empty while no policy is published, because a claim with no deadline is
   * never overdue — the platform owes an answer, and nobody has said by when.
   * Each row is handed out under a lease, so a worker that dies releases what
   * it held and the deadline survives: the deadline is a row, not a timer.
   */
  async claimOverdue(input: {
    readonly actorReference: string;
    readonly limit?: number | undefined;
  }): Promise<readonly TakedownClaimView[]> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const rows = await repository.claimOverdueTakedowns(
      repository.transactionless,
      {
        actorReference: input.actorReference,
        expiresAt: new Date(now.getTime() + takedownLeaseMilliseconds),
        limit: Math.max(
          1,
          Math.min(
            input.limit ?? maximumTakedownPageSize,
            maximumTakedownPageSize,
          ),
        ),
        now,
      },
    );
    return rows.map(claimView);
  }

  async claimsForContent(
    contentId: string,
  ): Promise<readonly TakedownClaimView[]> {
    const rows = await this.dependencies.repository.listTakedownClaims(
      this.dependencies.repository.transactionless,
      { contentId, limit: maximumTakedownPageSize },
    );
    return rows.map(claimView);
  }

  private async move(input: {
    readonly claimId: string;
    readonly expectedVersion: number;
    readonly from: readonly TakedownState[];
    readonly state: TakedownState;
  }): Promise<TakedownTransition> {
    const { repository } = this.dependencies;
    const found = await repository.findTakedownClaim(
      repository.transactionless,
      input.claimId,
    );
    if (found === undefined) return { kind: 'not_found' };
    const moved = await repository.transitionTakedownClaim(
      repository.transactionless,
      {
        claimId: input.claimId,
        expectedVersion: input.expectedVersion,
        from: input.from,
        now: this.dependencies.now(),
        state: input.state,
      },
    );
    return moved === undefined
      ? { kind: 'conflict' }
      : { claim: claimView(moved), kind: 'recorded' };
  }
}

function claimView(row: TakedownClaimRow): TakedownClaimView {
  return {
    acknowledgementDueAt: row.acknowledgementDueAt,
    actionDueAt: row.actionDueAt,
    caseId: row.caseId,
    claimantKind: row.claimantKind,
    contentId: row.contentId,
    deadlinePolicyVersion: row.deadlinePolicyVersion,
    id: row.id,
    reasonCode: row.reasonCode,
    receivedAt: row.receivedAt,
    state: row.state,
    triageDueAt: row.triageDueAt,
    urgency: row.urgency,
    version: row.version,
  };
}
