import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  AppealService,
  LocalTestAppealPolicy,
  UnpublishedAppealPolicy,
} from '../../src/safety/appeals.js';
import { EnforcementAuthority } from '../../src/safety/enforcement.js';
import { ModerationService } from '../../src/safety/moderation.js';
import { SafetyRepository } from '../../src/safety/repository.js';
import {
  casePolicyVersion,
  evidencePolicyVersion,
  reportPolicyVersion,
} from '../../src/safety/policy.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { testServerConfig } from '../support/harness.js';

/**
 * Appeals and statements of reasons against real PostgreSQL.
 *
 * Three properties carry the phase. What a subject is told is the category and
 * the scope and nothing else — never the finding, the evidence, the reviewer,
 * or the report. An appeal never erases anything: upholding one produces a
 * superseding decision and the original stays exactly as written. And a
 * complaint is not decided by anything automated, which is structural here
 * because the outcome carries the reviewer who reached it and nothing writes
 * that column without one.
 *
 * The moderation seam is exercised directly, because it deliberately publishes
 * no HTTP surface.
 */

const databaseUrl = await provisionDatabase('velora_safety_appeals');
const database: TestDatabase = connectDatabase(databaseUrl);

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

const repository = new SafetyRepository(database.drizzle);
const authority = new EnforcementAuthority({ now, repository });

/** Restores an account so a reversal is applicable, and nothing else. */
const accounts = {
  restore: (input: { readonly userId: string }) =>
    Promise.resolve({ id: input.userId } as never),
  restrict: (input: { readonly userId: string }) =>
    Promise.resolve({ id: input.userId } as never),
};
const conversations = { close: () => Promise.resolve(true) };

const moderation = new ModerationService({
  accounts,
  authority,
  conversations,
  now,
  repository,
});

/** The deployed shape: complaints accepted, with no closing date published. */
const unpublished = new AppealService({
  now,
  policy: new UnpublishedAppealPolicy(),
  repository,
});

/** A deterministic window, so being out of time is exercisable. */
const appeals = new AppealService({
  now,
  policy: new LocalTestAppealPolicy(),
  repository,
});

const operator = 'session:operator-under-test';
const day = 24 * 60 * 60 * 1_000;

interface Settled {
  readonly caseId: string;
  readonly decisionId: string;
  readonly reporterId: string;
  readonly subjectId: string;
}

/**
 * A case about one consumer account, carrying one report, settled by the
 * decision the test asks for.
 */
async function settled(
  action: 'restrict_capability' | 'no_action',
): Promise<Settled> {
  const subjectId = crypto.randomUUID();
  const reporterId = crypto.randomUUID();
  const opened = await repository.transaction(async (executor) => {
    const created = await repository.insertCase(executor, {
      now: now(),
      policyVersion: casePolicyVersion,
      priority: 'untriaged',
      queue: 'consumer_conduct',
      targetId: subjectId,
      targetType: 'consumer_account',
    });
    if (created === undefined) throw new Error('case insert failed');
    const report = await repository.insertReport(executor, {
      caseId: created.id,
      clientReportId: crypto.randomUUID(),
      conversationId: null,
      detail: null,
      messageId: null,
      now: now(),
      policyVersion: reportPolicyVersion,
      reasonCode: 'harassment',
      reporterId,
      sourceSurface: 'consumer_web',
      subjectId,
      targetType: 'consumer_account',
    });
    if (report === undefined) throw new Error('report insert failed');
    await repository.insertEvidence(executor, {
      actorReference: null,
      caseId: created.id,
      externalReference: null,
      kind: 'report',
      note: null,
      now: now(),
      observedAt: null,
      policyVersion: evidencePolicyVersion,
      referenceId: report.id,
      referenceType: 'safety_report',
      stateLabel: null,
    });
    return created;
  });

  const evidenceIds = (
    await rowsOf<{ id: string }>(
      database.sql`select id from safety_evidence where case_id = ${opened.id}`,
    )
  ).map((row) => row.id);

  const decision = await moderation.decideCase({
    action,
    actorReference: operator,
    caseId: opened.id,
    evidenceIds: action === 'no_action' ? [] : evidenceIds,
    expectedVersion: opened.version,
    reasonCode: action === 'no_action' ? 'no_violation_found' : 'harassment',
    ...(action === 'no_action'
      ? {}
      : { scope: 'account_restriction' as const }),
  });
  if (decision.kind !== 'recorded') throw new Error('decision failed');
  return {
    caseId: opened.id,
    decisionId: decision.decision.id,
    reporterId,
    subjectId,
  };
}

/** The superseding decision an upheld appeal would produce. */
async function reversal(subject: Settled): Promise<string> {
  const [row] = await rowsOf<{ version: number }>(
    database.sql`select version from safety_cases where id = ${subject.caseId}`,
  );
  const evidenceIds = (
    await rowsOf<{ id: string }>(
      database.sql`select id from safety_evidence where case_id = ${subject.caseId}`,
    )
  ).map((row_) => row_.id);
  const outcome = await moderation.decideCase({
    action: 'revoke_restriction',
    actorReference: 'session:appeal-reviewer',
    caseId: subject.caseId,
    evidenceIds,
    expectedVersion: row?.version ?? 0,
    reasonCode: 'platform_integrity',
    scope: 'account_restriction',
    supersedesDecisionId: subject.decisionId,
  });
  if (outcome.kind !== 'recorded') throw new Error('reversal failed');
  return outcome.decision.id;
}

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('a subject is told the category and nothing else', () => {
  it('discloses the scope and a coarse reason, never the finding', async () => {
    const subject = await settled('restrict_capability');

    const statements = await appeals.statementsFor(subject.subjectId);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      appealable: true,
      reasonCode: 'account_restricted',
      scope: 'account_restriction',
    });
    // The review recorded `harassment`. What the subject may be told says only
    // that the account is restricted, because a finding disclosed to a subject
    // is a step from there to the reporter.
    const disclosed = JSON.stringify(statements);
    expect(disclosed).not.toContain('harassment');
    expect(disclosed).not.toContain(operator);
    expect(disclosed).not.toContain(subject.reporterId);
  });

  it('stops disclosing a restriction once something replaced it', async () => {
    const subject = await settled('restrict_capability');
    await reversal(subject);

    // Telling somebody they are restricted when they are not would be worse
    // than telling them nothing.
    expect(await appeals.statementsFor(subject.subjectId)).toEqual([]);
  });

  it('says nothing about a decision that did nothing', async () => {
    const subject = await settled('no_action');
    expect(await appeals.statementsFor(subject.subjectId)).toEqual([]);
  });

  it('offers a closing date only when one is published', async () => {
    const subject = await settled('restrict_capability');

    const [withWindow] = await appeals.statementsFor(subject.subjectId);
    const [without] = await unpublished.statementsFor(subject.subjectId);

    expect(withWindow?.appealWindowClosesAt).toBeInstanceOf(Date);
    expect(without?.appealWindowClosesAt).toBeUndefined();
    // A complaint is still available; what is absent is a date after which it
    // would be refused.
    expect(without?.appealable).toBe(true);
    expect(unpublished.windowPublished).toBe(false);
    expect(testServerConfig().SAFETY_APPEAL_POLICY).toBe('unpublished');
  });
});

describe('who may complain about what', () => {
  it('lets the subject of a restriction complain', async () => {
    const subject = await settled('restrict_capability');

    const outcome = await appeals.submit({
      appellantKind: 'subject',
      appellantReference: subject.subjectId,
      decisionId: subject.decisionId,
      statement: 'This was not me.',
    });

    expect(outcome.kind).toBe('received');
    if (outcome.kind !== 'received') return;
    expect(outcome.appeal.state).toBe('received');
    expect(outcome.appeal.windowClosesAt).toBeInstanceOf(Date);
  });

  it('lets the person whose report was dismissed complain', async () => {
    const subject = await settled('no_action');

    const notifier = await appeals.submit({
      appellantKind: 'notifier',
      appellantReference: subject.reporterId,
      decisionId: subject.decisionId,
    });
    // A decision not to act leaves the notifier affected and the subject
    // untouched, which is why they are two kinds of appellant rather than one.
    expect(notifier.kind).toBe('received');

    const bySubject = await appeals.submit({
      appellantKind: 'subject',
      appellantReference: subject.subjectId,
      decisionId: subject.decisionId,
    });
    expect(bySubject.kind).toBe('not_appealable');
  });

  it('refuses a complaint about somebody else, identically to a wrong kind', async () => {
    const subject = await settled('restrict_capability');
    const dismissed = await settled('no_action');

    const outcomes = await Promise.all([
      // Somebody else's restriction.
      appeals.submit({
        appellantKind: 'subject',
        appellantReference: crypto.randomUUID(),
        decisionId: subject.decisionId,
      }),
      // Somebody else's dismissed report.
      appeals.submit({
        appellantKind: 'notifier',
        appellantReference: crypto.randomUUID(),
        decisionId: dismissed.decisionId,
      }),
      // A notifier complaining about a restriction, which is not their decision
      // to contest.
      appeals.submit({
        appellantKind: 'notifier',
        appellantReference: subject.reporterId,
        decisionId: subject.decisionId,
      }),
    ]);

    // One refusal shape for all three, so probing this path enumerates nothing.
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      'not_appealable',
      'not_appealable',
      'not_appealable',
    ]);
    expect(await countOf('safety_appeals')).toBe(0);
  });

  it('refuses a second live complaint and allows one after a withdrawal', async () => {
    const subject = await settled('restrict_capability');
    const submit = () =>
      appeals.submit({
        appellantKind: 'subject',
        appellantReference: subject.subjectId,
        decisionId: subject.decisionId,
      });

    const first = await submit();
    if (first.kind !== 'received') throw new Error('setup failed');
    expect((await submit()).kind).toBe('already_appealed');

    const withdrawn = await appeals.withdraw({
      appealId: first.appeal.id,
      appellantReference: subject.subjectId,
      expectedVersion: first.appeal.version,
    });
    expect(withdrawn.kind).toBe('recorded');
    // The withdrawal is a record and the person is free again; what was refused
    // was contesting one decision twice at once.
    expect((await submit()).kind).toBe('received');
    expect(await countOf('safety_appeals')).toBe(2);
  });

  it('refuses somebody withdrawing a complaint that is not theirs', async () => {
    const subject = await settled('restrict_capability');
    const first = await appeals.submit({
      appellantKind: 'subject',
      appellantReference: subject.subjectId,
      decisionId: subject.decisionId,
    });
    if (first.kind !== 'received') throw new Error('setup failed');

    expect(
      (
        await appeals.withdraw({
          appealId: first.appeal.id,
          appellantReference: crypto.randomUUID(),
          expectedVersion: first.appeal.version,
        })
      ).kind,
    ).toBe('not_found');
  });

  it('refuses a complaint that is out of time, and accepts one with no window', async () => {
    const subject = await settled('restrict_capability');
    clockOffsetMilliseconds = 31 * day;

    expect(
      (
        await appeals.submit({
          appellantKind: 'subject',
          appellantReference: subject.subjectId,
          decisionId: subject.decisionId,
        })
      ).kind,
    ).toBe('out_of_time');
    // The same complaint, on a platform that published no window, is in time
    // because there is no time to be out of.
    expect(
      (
        await unpublished.submit({
          appellantKind: 'subject',
          appellantReference: subject.subjectId,
          decisionId: subject.decisionId,
        })
      ).kind,
    ).toBe('received');
  });

  it('bounds the statement and refuses one that is not', async () => {
    const subject = await settled('restrict_capability');
    expect(
      (
        await appeals.submit({
          appellantKind: 'subject',
          appellantReference: subject.subjectId,
          decisionId: subject.decisionId,
          statement: 'x'.repeat(2001),
        })
      ).kind,
    ).toBe('invalid_statement');
  });
});

describe('an appeal is answered by a person, and erases nothing', () => {
  async function complained(): Promise<{
    readonly appealId: string;
    readonly subject: Settled;
    readonly version: number;
  }> {
    const subject = await settled('restrict_capability');
    const outcome = await appeals.submit({
      appellantKind: 'subject',
      appellantReference: subject.subjectId,
      decisionId: subject.decisionId,
    });
    if (outcome.kind !== 'received') throw new Error('setup failed');
    return {
      appealId: outcome.appeal.id,
      subject,
      version: outcome.appeal.version,
    };
  }

  it('upholds by naming the decision that replaced the original', async () => {
    const complaint = await complained();
    const outcomeDecisionId = await reversal(complaint.subject);

    const upheld = await appeals.uphold({
      appealId: complaint.appealId,
      expectedVersion: complaint.version,
      outcomeDecisionId,
      reviewerActorReference: 'session:appeal-reviewer',
    });

    expect(upheld.kind).toBe('recorded');
    if (upheld.kind !== 'recorded') return;
    expect(upheld.appeal.state).toBe('upheld');
    expect(upheld.appeal.outcomeDecisionId).toBe(outcomeDecisionId);
    // The decision complained about is exactly what was written, and both it
    // and its replacement survive.
    expect(await countOf('safety_decisions')).toBe(2);
    const [original] = await rowsOf<{ action: string }>(
      database.sql`select action from safety_decisions
        where id = ${complaint.subject.decisionId}`,
    );
    expect(original?.action).toBe('restrict_capability');
  });

  it('refuses an outcome that does not replace what was appealed', async () => {
    const complaint = await complained();
    const unrelated = await settled('restrict_capability');

    const outcome = await appeals.uphold({
      appealId: complaint.appealId,
      expectedVersion: complaint.version,
      outcomeDecisionId: unrelated.decisionId,
      reviewerActorReference: 'session:appeal-reviewer',
    });

    // An appeal pointing at an unrelated record would claim something was put
    // right when nothing was.
    expect(outcome.kind).toBe('invalid_outcome');
  });

  it('records the reviewer on every outcome, and refuses one without', async () => {
    const complaint = await complained();

    const refusal = await appeals.refuse({
      appealId: complaint.appealId,
      expectedVersion: complaint.version,
      reviewerActorReference: 'session:appeal-reviewer',
    });
    expect(refusal.kind).toBe('recorded');

    const rows = await rowsOf<{ reviewer_actor_reference: string | null }>(
      database.sql`select reviewer_actor_reference from safety_appeals`,
    );
    expect(rows[0]?.reviewer_actor_reference).toBe('session:appeal-reviewer');
    // A complaint may not be decided solely by automated means, and the
    // database is what makes that structural rather than a promise.
    expect(
      await refused(() =>
        execute(
          database.sql`update safety_appeals
            set reviewer_actor_reference = null
            where id = ${complaint.appealId}`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses an answer taken against a stale read, and answers once', async () => {
    const complaint = await complained();
    const reviewed = await appeals.beginReview({
      appealId: complaint.appealId,
      expectedVersion: complaint.version,
    });
    if (reviewed.kind !== 'recorded') throw new Error('setup failed');

    const stale = await appeals.refuse({
      appealId: complaint.appealId,
      expectedVersion: complaint.version,
      reviewerActorReference: 'session:appeal-reviewer',
    });
    expect(stale.kind).toBe('conflict');

    const answered = await appeals.refuse({
      appealId: complaint.appealId,
      expectedVersion: reviewed.appeal.version,
      reviewerActorReference: 'session:appeal-reviewer',
    });
    expect(answered.kind).toBe('recorded');
    if (answered.kind !== 'recorded') return;
    // Answered once. A second answer is not a second opinion, it is a rewrite.
    expect(
      (
        await appeals.refuse({
          appealId: complaint.appealId,
          expectedVersion: answered.appeal.version,
          reviewerActorReference: 'session:appeal-reviewer',
        })
      ).kind,
    ).toBe('conflict');
  });

  it('leaves an answered complaint out of the queue', async () => {
    const complaint = await complained();
    expect(await appeals.openAppeals()).toHaveLength(1);

    await appeals.refuse({
      appealId: complaint.appealId,
      expectedVersion: complaint.version,
      reviewerActorReference: 'session:appeal-reviewer',
    });

    expect(await appeals.openAppeals()).toEqual([]);
  });
});

describe('the database keeps the complaint honest', () => {
  it('refuses an upheld complaint that names no replacement', async () => {
    const subject = await settled('restrict_capability');
    const outcome = await appeals.submit({
      appellantKind: 'subject',
      appellantReference: subject.subjectId,
      decisionId: subject.decisionId,
    });
    if (outcome.kind !== 'received') throw new Error('setup failed');

    expect(
      await refused(() =>
        execute(
          database.sql`update safety_appeals
            set state = 'upheld', decided_at = now(),
                reviewer_actor_reference = 'session:reviewer'
            where id = ${outcome.appeal.id}`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a closing date with no policy behind it', async () => {
    const subject = await settled('restrict_capability');
    const outcome = await unpublished.submit({
      appellantKind: 'subject',
      appellantReference: subject.subjectId,
      decisionId: subject.decisionId,
    });
    if (outcome.kind !== 'received') throw new Error('setup failed');

    expect(
      await refused(() =>
        execute(
          database.sql`update safety_appeals
            set window_closes_at = now() + interval '30 days'
            where id = ${outcome.appeal.id}`,
        ),
      ),
    ).toBe(true);
  });
});

async function countOf(table: string): Promise<number> {
  const rows = await rowsOf<{ count: string }>(
    database.sql.unsafe(`select count(*)::text as count from ${table}`),
  );
  return Number(rows[0]?.count ?? '0');
}
