import {
  appealPolicyVersion,
  appealableBy,
  denialReasonFor,
  eligibilityPolicyVersion,
  maximumAppealPageSize,
  maximumAppealStatementCharacters,
  type AppealState,
  type AppellantKind,
  type EnforcementScope,
  type SafetyDenialReason,
} from './policy.js';
import type { AppealRow, DecisionRow, SafetyRepository } from './repository.js';

/**
 * Appeals, and what a person may be told about a decision.
 *
 * Two halves of one obligation. Regulation (EU) 2022/2065 Article 17 requires a
 * provider restricting visibility, removing content, or restricting an account
 * to give the affected person the reasons and the redress available; Article 20
 * requires a complaint route usable for a bounded period, handled fairly, and
 * **not decided solely by automated means**. Both are recorded with their
 * source in [surface and distribution eligibility](../../../../docs/compliance/07-surface-and-distribution-eligibility.md),
 * and whether they bind Velora is a legal question left open there.
 *
 * The machinery is built anyway, because notice, reasons, a human decision, and
 * a bounded window are structure rather than copy — and structure added late is
 * far more expensive than structure added now.
 *
 * **A statement of reasons discloses the category and the scope and nothing
 * else.** Not the review's finding, not the evidence, not the reviewer, and
 * nothing that could identify a reporter. The vocabulary it uses is asserted to
 * be disjoint from both the reporter categories and the enforcement findings,
 * so the three cannot converge by accident.
 *
 * **An appeal never erases anything.** Upholding one produces a superseding
 * decision that names the original, which stays exactly as written — the
 * original is the only evidence that the appeal was necessary.
 */

/** How long somebody keeps the right to contest a decision. */
export interface AppealWindowPolicy {
  /** When a complaint about a decision becomes out of time. */
  closesAt(decidedAt: Date): Date | undefined;
  readonly version: string | undefined;
}

/**
 * Publishes no window.
 *
 * A complaint is still accepted; what is absent is a date after which it would
 * be refused. That is the safer half of the question to leave open, and it is
 * the honest one while nobody has approved a period.
 */
export class UnpublishedAppealPolicy implements AppealWindowPolicy {
  readonly version = undefined;

  closesAt(): Date | undefined {
    return undefined;
  }
}

/**
 * Development and test arithmetic.
 *
 * Deterministic so the window is exercisable, and named so nothing using it
 * reads as evidence about a real period. The number is round because it is a
 * placeholder; the six-month figure Article 20 states is deliberately not it.
 */
export class LocalTestAppealPolicy implements AppealWindowPolicy {
  readonly version = 'local-test-v1';

  private static readonly window = 30 * 24 * 60 * 60 * 1_000;

  closesAt(decidedAt: Date): Date {
    return new Date(decidedAt.getTime() + LocalTestAppealPolicy.window);
  }
}

/**
 * What a person may be told about a decision that affected them.
 *
 * The category, the scope, when, whether they may complain, and by when. There
 * is no field here for the finding, the evidence, the reviewer, or the report,
 * so no response built from this shape can carry one.
 */
export interface StatementOfReasons {
  readonly appealable: boolean;
  readonly appealWindowClosesAt: Date | undefined;
  readonly decidedAt: Date;
  readonly decisionId: string;
  readonly policyVersion: string;
  /** Disclosable and coarse. Never the review's finding. */
  readonly reasonCode: SafetyDenialReason;
  readonly scope: EnforcementScope;
}

export interface AppealView {
  readonly appellantKind: AppellantKind;
  readonly decisionId: string;
  readonly id: string;
  readonly outcomeDecisionId: string | null;
  readonly state: AppealState;
  readonly submittedAt: Date;
  readonly version: number;
  readonly windowClosesAt: Date | null;
}

export type AppealSubmission =
  | { readonly kind: 'received'; readonly appeal: AppealView }
  | { readonly kind: 'not_found' }
  /** This kind of person may not complain about this kind of decision. */
  | { readonly kind: 'not_appealable' }
  /** The published window has closed. */
  | { readonly kind: 'out_of_time' }
  /** This person already has a live complaint about this decision. */
  | { readonly kind: 'already_appealed' }
  | { readonly kind: 'invalid_statement' };

export type AppealTransition =
  | { readonly kind: 'recorded'; readonly appeal: AppealView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict' }
  /** The outcome named a decision that does not replace the one appealed. */
  | { readonly kind: 'invalid_outcome' };

export interface AppealDependencies {
  readonly now: () => Date;
  readonly policy: AppealWindowPolicy;
  readonly repository: SafetyRepository;
}

/** Decisions a subject may be told about: the ones that imposed something. */
const disclosableActions = new Set([
  'restrict_capability',
  'temporary_hold',
  'unpublish',
]);

export class AppealService {
  constructor(private readonly dependencies: AppealDependencies) {}

  /** Whether any complaint window is published at all. */
  get windowPublished(): boolean {
    return this.dependencies.policy.version !== undefined;
  }

  /**
   * What this subject may be told about what was done to them.
   *
   * Only decisions that imposed something, and only those nothing has replaced
   * — a restriction that was lifted is not something the subject is currently
   * under, and reporting it would be telling somebody they are restricted when
   * they are not. The reason is the disclosable one derived from the scope,
   * never the finding the reviewer recorded.
   */
  async statementsFor(
    subjectId: string,
  ): Promise<readonly StatementOfReasons[]> {
    const { repository } = this.dependencies;
    const rows = await repository.listDecisionsForSubject(
      repository.transactionless,
      { limit: maximumAppealPageSize, subjectId },
    );
    const superseded = new Set(
      rows
        .map((row) => row.supersedesId)
        .filter((id): id is string => id !== null),
    );
    const statements: StatementOfReasons[] = [];
    for (const row of rows) {
      const scope = row.scope;
      if (scope === null) continue;
      if (!disclosableActions.has(row.action)) continue;
      if (superseded.has(row.id)) continue;
      statements.push(this.statement(row, scope));
    }
    return statements;
  }

  /**
   * Records a complaint about a decision.
   *
   * Who may complain about what is a map rather than a check at the call site:
   * a subject complains about something done to them, and a notifier about a
   * decision not to act on what they reported. A notifier is checked against
   * the reports in the case, so nobody can complain about a dismissal of
   * somebody else's report.
   */
  async submit(input: {
    readonly appellantKind: AppellantKind;
    readonly appellantReference: string;
    readonly decisionId: string;
    readonly statement?: string | undefined;
  }): Promise<AppealSubmission> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    if (
      input.statement !== undefined &&
      (input.statement.length === 0 ||
        input.statement.length > maximumAppealStatementCharacters)
    ) {
      return { kind: 'invalid_statement' };
    }

    const decision = await repository.findDecision(
      repository.transactionless,
      input.decisionId,
    );
    if (decision === undefined) return { kind: 'not_found' };
    if (!appealableBy(input.appellantKind).includes(decision.action)) {
      return { kind: 'not_appealable' };
    }
    const entitled =
      input.appellantKind === 'subject'
        ? decision.subjectId === input.appellantReference
        : await repository.isReporterOnCase(repository.transactionless, {
            caseId: decision.caseId,
            reporterId: input.appellantReference,
          });
    // One refusal for a decision about somebody else and for a dismissal of
    // somebody else's report, so probing this path enumerates nothing.
    if (!entitled) return { kind: 'not_appealable' };

    const closesAt = this.dependencies.policy.closesAt(decision.decidedAt);
    if (closesAt !== undefined && closesAt <= now) {
      return { kind: 'out_of_time' };
    }

    const appeal = await repository.insertAppeal(repository.transactionless, {
      appealPolicyVersion: this.dependencies.policy.version ?? null,
      appellantKind: input.appellantKind,
      appellantReference: input.appellantReference,
      caseId: decision.caseId,
      decisionId: decision.id,
      now,
      policyVersion: appealPolicyVersion,
      statement: input.statement ?? null,
      windowClosesAt: closesAt ?? null,
    });
    // The partial unique index decides: this person already has a live
    // complaint about this decision, and one decision is not contested twice
    // at once.
    return appeal === undefined
      ? { kind: 'already_appealed' }
      : { appeal: appealView(appeal), kind: 'received' };
  }

  /** Complaints still owed an answer, oldest first. */
  async openAppeals(
    limit = maximumAppealPageSize,
  ): Promise<readonly AppealView[]> {
    const rows = await this.dependencies.repository.listOpenAppeals(
      this.dependencies.repository.transactionless,
      Math.max(1, Math.min(limit, maximumAppealPageSize)),
    );
    return rows.map(appealView);
  }

  async beginReview(input: {
    readonly appealId: string;
    readonly expectedVersion: number;
  }): Promise<AppealTransition> {
    return this.move({
      appealId: input.appealId,
      expectedVersion: input.expectedVersion,
      from: ['received'],
      state: 'under_review',
    });
  }

  /**
   * Refuses a complaint. The decision it named stands, unchanged.
   *
   * The reviewer's reference is required, because Article 20 forbids a
   * complaint being decided solely by automated means and a column that only a
   * named human fills is how that stops being a promise.
   */
  async refuse(input: {
    readonly appealId: string;
    readonly expectedVersion: number;
    readonly reviewerActorReference: string;
  }): Promise<AppealTransition> {
    return this.move({
      appealId: input.appealId,
      expectedVersion: input.expectedVersion,
      from: ['received', 'under_review'],
      reviewerActorReference: input.reviewerActorReference,
      state: 'refused',
    });
  }

  /**
   * Upholds a complaint, naming the decision that replaced the original.
   *
   * The superseding decision is taken through the moderation seam like any
   * other, and this only records that it was the answer to a complaint. It is
   * checked to genuinely supersede the decision appealed: an appeal pointing at
   * an unrelated record would be a claim that something was put right when
   * nothing was.
   */
  async uphold(input: {
    readonly appealId: string;
    readonly expectedVersion: number;
    readonly outcomeDecisionId: string;
    readonly reviewerActorReference: string;
  }): Promise<AppealTransition> {
    const { repository } = this.dependencies;
    const appeal = await repository.findAppeal(
      repository.transactionless,
      input.appealId,
    );
    if (appeal === undefined) return { kind: 'not_found' };
    const outcome = await repository.findDecision(
      repository.transactionless,
      input.outcomeDecisionId,
    );
    if (outcome?.supersedesId !== appeal.decisionId) {
      return { kind: 'invalid_outcome' };
    }
    return this.move({
      appealId: input.appealId,
      expectedVersion: input.expectedVersion,
      from: ['received', 'under_review'],
      outcomeDecisionId: input.outcomeDecisionId,
      reviewerActorReference: input.reviewerActorReference,
      state: 'upheld',
    });
  }

  /** The appellant's own withdrawal. The record of it stays. */
  async withdraw(input: {
    readonly appealId: string;
    readonly appellantReference: string;
    readonly expectedVersion: number;
  }): Promise<AppealTransition> {
    const { repository } = this.dependencies;
    const appeal = await repository.findAppeal(
      repository.transactionless,
      input.appealId,
    );
    // Withdrawing somebody else's complaint is refused the same way a complaint
    // about somebody else's decision is.
    if (appeal?.appellantReference !== input.appellantReference) {
      return { kind: 'not_found' };
    }
    return this.move({
      appealId: input.appealId,
      expectedVersion: input.expectedVersion,
      from: ['received', 'under_review'],
      state: 'withdrawn',
    });
  }

  private async move(input: {
    readonly appealId: string;
    readonly expectedVersion: number;
    readonly from: readonly AppealState[];
    readonly outcomeDecisionId?: string | undefined;
    readonly reviewerActorReference?: string | undefined;
    readonly state: AppealState;
  }): Promise<AppealTransition> {
    const { repository } = this.dependencies;
    const found = await repository.findAppeal(
      repository.transactionless,
      input.appealId,
    );
    if (found === undefined) return { kind: 'not_found' };
    const moved = await repository.transitionAppeal(
      repository.transactionless,
      {
        appealId: input.appealId,
        expectedVersion: input.expectedVersion,
        from: input.from,
        now: this.dependencies.now(),
        outcomeDecisionId: input.outcomeDecisionId ?? null,
        reviewerActorReference: input.reviewerActorReference ?? null,
        state: input.state,
      },
    );
    return moved === undefined
      ? { kind: 'conflict' }
      : { appeal: appealView(moved), kind: 'recorded' };
  }

  private statement(
    row: DecisionRow,
    scope: EnforcementScope,
  ): StatementOfReasons {
    const closesAt = this.dependencies.policy.closesAt(row.decidedAt);
    return {
      appealable: appealableBy('subject').includes(row.action),
      appealWindowClosesAt: closesAt,
      decidedAt: row.decidedAt,
      decisionId: row.id,
      // The version of the rule that composes a disclosable answer, which is
      // what this is — not the version of the decision's own vocabulary.
      policyVersion: eligibilityPolicyVersion,
      reasonCode: denialReasonFor(scope),
      scope,
    };
  }
}

function appealView(row: AppealRow): AppealView {
  return {
    appellantKind: row.appellantKind,
    decisionId: row.decisionId,
    id: row.id,
    outcomeDecisionId: row.outcomeDecisionId,
    state: row.state,
    submittedAt: row.submittedAt,
    version: row.version,
    windowClosesAt: row.windowClosesAt,
  };
}
