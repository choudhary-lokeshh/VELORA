import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  DepictedPersonConsentService,
  LocalTestConsentPolicy,
  LocalTestDepictedPersonVerifier,
} from '../../src/safety/consent.js';
import { takedownRateLimitCount } from '../../src/safety/policy.js';
import { SafetyRepository } from '../../src/safety/repository.js';
import {
  LocalTestTakedownPolicy,
  TakedownService,
  UnpublishedTakedownPolicy,
} from '../../src/safety/takedown.js';
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
 * Takedown claims and their deadlines against real PostgreSQL.
 *
 * Two properties carry the phase. A claim decides nothing by existing: it opens
 * or joins a case and is reviewed there, and the item it names is untouched
 * until a moderation decision says otherwise. And **no deadline is invented**:
 * a platform that publishes no policy records claims with no deadline at all
 * rather than a number that would look like compliance and carry no authority.
 *
 * The engine itself is exercised against a deterministic development policy,
 * named so nothing here reads as evidence about a real obligation.
 */

const databaseUrl = await provisionDatabase('velora_safety_takedown');
const database: TestDatabase = connectDatabase(databaseUrl);

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

const repository = new SafetyRepository(database.drizzle);

/** The deployed shape: obligations exist, and nobody has said by when. */
const unpublished = new TakedownService({
  now,
  policy: new UnpublishedTakedownPolicy(),
  repository,
});

/** Deterministic arithmetic, so the engine is exercisable. */
const takedown = new TakedownService({
  now,
  policy: new LocalTestTakedownPolicy(),
  repository,
});

const consent = new DepictedPersonConsentService({
  copy: new LocalTestConsentPolicy(),
  now,
  repository,
  verifier: new LocalTestDepictedPersonVerifier(),
});

const hour = 60 * 60 * 1_000;

function item(): { readonly contentId: string; readonly creatorId: string } {
  return { contentId: crypto.randomUUID(), creatorId: crypto.randomUUID() };
}

async function submitted(
  service: TakedownService = takedown,
  overrides: {
    readonly claimantAccountId?: string;
    readonly claimantKind?: 'depicted_person' | 'account_holder' | 'external';
    readonly reasonCode?: 'non_consensual_content' | 'other';
  } = {},
) {
  const target = item();
  const outcome = await service.submit({
    claimantKind: overrides.claimantKind ?? 'depicted_person',
    ...(overrides.claimantAccountId === undefined
      ? {}
      : { claimantAccountId: overrides.claimantAccountId }),
    ...target,
    reasonCode: overrides.reasonCode ?? 'non_consensual_content',
  });
  if (outcome.kind !== 'received') throw new Error('submission failed');
  return { ...target, claim: outcome.claim };
}

async function countOf(table: string, where = 'true'): Promise<number> {
  const rows = await rowsOf<{ count: string }>(
    database.sql.unsafe(
      `select count(*)::text as count from ${table} where ${where}`,
    ),
  );
  return Number(rows[0]?.count ?? '0');
}

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('no deadline is invented', () => {
  it('records a claim with no deadline when no policy is published', async () => {
    const submission = await submitted(unpublished);

    expect(unpublished.deadlinesPublished).toBe(false);
    expect(submission.claim.deadlinePolicyVersion).toBeNull();
    expect(submission.claim.acknowledgementDueAt).toBeNull();
    expect(submission.claim.triageDueAt).toBeNull();
    expect(submission.claim.actionDueAt).toBeNull();
    // The obligation is not gone; nobody has said by when. A number here would
    // look like compliance and carry no authority.
    expect(submission.claim.state).toBe('received');
  });

  it('never treats a claim with no deadline as overdue', async () => {
    await submitted(unpublished);
    clockOffsetMilliseconds = 365 * 24 * hour;

    expect(
      await unpublished.claimOverdue({ actorReference: 'worker:one' }),
    ).toEqual([]);
  });

  it('stamps every deadline with the policy that produced it', async () => {
    const submission = await submitted();

    expect(submission.claim.deadlinePolicyVersion).toBe('local-test-v1');
    // Ordered, and every one of them after the claim arrived.
    const { acknowledgementDueAt, actionDueAt, receivedAt, triageDueAt } =
      submission.claim;
    expect(acknowledgementDueAt?.getTime()).toBeGreaterThan(
      receivedAt.getTime(),
    );
    expect(triageDueAt?.getTime()).toBeGreaterThanOrEqual(
      acknowledgementDueAt?.getTime() ?? 0,
    );
    expect(actionDueAt?.getTime()).toBeGreaterThanOrEqual(
      triageDueAt?.getTime() ?? 0,
    );
  });

  it('refuses a deadline with no policy behind it', async () => {
    const submission = await submitted(unpublished);
    // The database refuses it too, so a deadline cannot arrive without the
    // version that produced it however it is written.
    expect(
      await refused(() =>
        execute(
          database.sql`update safety_takedown_claims
            set action_due_at = now() + interval '1 day'
            where id = ${submission.claim.id}`,
        ),
      ),
    ).toBe(true);
  });

  it('publishes no deadline policy in the default configuration', () => {
    expect(testServerConfig().SAFETY_TAKEDOWN_POLICY).toBe('unpublished');
  });
});

describe('a claim is reviewed, and decides nothing by existing', () => {
  it('opens a case about the item and touches nothing else', async () => {
    const submission = await submitted();

    const cases = await rowsOf<{ queue: string; target_type: string }>(
      database.sql`select queue, target_type from safety_cases`,
    );
    expect(cases).toEqual([
      { queue: 'creator_content', target_type: 'creator_content' },
    ]);
    expect(submission.claim.caseId.length).toBeGreaterThan(0);
    // No enforcement, no decision. A claim is an allegation, and only a review
    // makes it anything more.
    expect(await countOf('safety_enforcements')).toBe(0);
    expect(await countOf('safety_decisions')).toBe(0);
  });

  it('settles several claims about one item into one review', async () => {
    const target = item();
    const submissions = await Promise.all(
      Array.from({ length: 6 }, async () =>
        takedown.submit({
          claimantKind: 'external',
          ...target,
          reasonCode: 'illegal_content',
        }),
      ),
    );

    expect(submissions.every((entry) => entry.kind === 'received')).toBe(true);
    expect(await countOf('safety_cases')).toBe(1);
    // Grouping, never discarding: every claim survives as its own record.
    expect(await takedown.claimsForContent(target.contentId)).toHaveLength(6);
  });

  it('derives urgency from what is alleged rather than from who is asking', async () => {
    const urgent = await submitted(takedown, {
      reasonCode: 'non_consensual_content',
    });
    const standard = await submitted(takedown, { reasonCode: 'other' });

    expect(urgent.claim.urgency).toBe('urgent');
    expect(standard.claim.urgency).toBe('standard');
    // Urgency moves the deadline and nothing else. The case a reviewer sees is
    // untriaged either way, because priority is their judgement.
    const priorities = await rowsOf<{ priority: string }>(
      database.sql`select priority from safety_cases`,
    );
    expect(priorities.every((row) => row.priority === 'untriaged')).toBe(true);
  });

  it('moves received to acknowledged to decided to completed, and no further', async () => {
    const submission = await submitted();
    const acknowledged = await takedown.acknowledge({
      claimId: submission.claim.id,
      expectedVersion: submission.claim.version,
    });
    if (acknowledged.kind !== 'recorded') throw new Error('setup failed');

    const decided = await takedown.decide({
      claimId: submission.claim.id,
      dismissed: false,
      expectedVersion: acknowledged.claim.version,
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');
    // Decided and completed are separate instants: a decision to remove
    // something and the removal taking effect are different facts, and an
    // obligation measured against the wrong one is measured against a promise.
    expect(decided.claim.state).toBe('decided');

    const completed = await takedown.complete({
      claimId: submission.claim.id,
      expectedVersion: decided.claim.version,
    });
    expect(completed.kind).toBe('recorded');

    const again = await takedown.complete({
      claimId: submission.claim.id,
      expectedVersion: (completed as { claim: { version: number } }).claim
        .version,
    });
    expect(again.kind).toBe('conflict');
  });

  it('refuses a transition taken against a stale read', async () => {
    const submission = await submitted();
    await takedown.acknowledge({
      claimId: submission.claim.id,
      expectedVersion: submission.claim.version,
    });

    const stale = await takedown.acknowledge({
      claimId: submission.claim.id,
      expectedVersion: submission.claim.version,
    });
    expect(stale.kind).toBe('conflict');
    expect(
      (
        await takedown.acknowledge({
          claimId: crypto.randomUUID(),
          expectedVersion: 1,
        })
      ).kind,
    ).toBe('not_found');
  });

  it('lets a withdrawal name the consent it withdrew, and refuses another item', async () => {
    const target = item();
    await consent.declare({ ...target, declaration: 'depicted_persons' });
    const declared = await consent.declareParticipant(target);
    if (declared.kind !== 'declared') throw new Error('setup failed');
    const verified = await consent.verifyParticipant({
      actorReference: 'session:operator',
      participantId: declared.participant.id,
      scopes: ['publication'],
    });
    if (verified.kind !== 'verified') throw new Error('setup failed');
    const [grant] = await consent.consentRecordsFor(target.contentId);
    if (grant === undefined) throw new Error('setup failed');
    const revoked = await consent.revokeConsent({
      actorReference: 'session:operator',
      consentId: grant.id,
    });
    if (revoked.kind !== 'revoked') throw new Error('setup failed');

    const named = await takedown.submit({
      claimantKind: 'depicted_person',
      consentRecordId: revoked.consent.id,
      ...target,
      reasonCode: 'consent_withdrawn',
    });
    expect(named.kind).toBe('received');

    // A withdrawal naming a record about a different item would carry evidence
    // about something else entirely.
    const elsewhere = await takedown.submit({
      claimantKind: 'depicted_person',
      consentRecordId: revoked.consent.id,
      ...item(),
      reasonCode: 'consent_withdrawn',
    });
    expect(elsewhere.kind).toBe('invalid_claim');
    // And a withdrawal is not the removal: the consent record and the claim are
    // separate facts, and neither takes anything down on its own.
    expect(await countOf('safety_enforcements')).toBe(0);
  });

  it('bounds how many claims one account may file', async () => {
    const claimant = crypto.randomUUID();
    const target = item();
    for (let filed = 0; filed < takedownRateLimitCount; filed += 1) {
      const outcome = await takedown.submit({
        claimantAccountId: claimant,
        claimantKind: 'account_holder',
        ...target,
        reasonCode: 'illegal_content',
      });
      expect(outcome.kind).toBe('received');
    }

    const refusedSubmission = await takedown.submit({
      claimantAccountId: claimant,
      claimantKind: 'account_holder',
      ...target,
      reasonCode: 'illegal_content',
    });
    expect(refusedSubmission.kind).toBe('rate_limited');
    // Bounded volume, and nothing already filed removed or altered.
    expect(await countOf('safety_takedown_claims')).toBe(
      takedownRateLimitCount,
    );
  });
});

describe('a deadline is a row, not a timer', () => {
  it('hands an overdue claim to one worker and not to another', async () => {
    const submission = await submitted();
    clockOffsetMilliseconds = 48 * hour;

    const [first, second] = await Promise.all([
      takedown.claimOverdue({ actorReference: 'worker:one' }),
      takedown.claimOverdue({ actorReference: 'worker:two' }),
    ]);

    const taken = [...first, ...second].map((claim) => claim.id);
    expect(taken).toEqual([submission.claim.id]);
  });

  it('offers a lapsed lease again, so a worker that died holds nothing', async () => {
    await submitted();
    clockOffsetMilliseconds = 48 * hour;
    expect(
      await takedown.claimOverdue({ actorReference: 'worker:one' }),
    ).toHaveLength(1);
    // Held, so nobody else may take it.
    expect(
      await takedown.claimOverdue({ actorReference: 'worker:two' }),
    ).toEqual([]);

    clockOffsetMilliseconds = 48 * hour + 16 * 60 * 1_000;
    // The lease lapsed. The deadline survived it, because the deadline is a row.
    expect(
      await takedown.claimOverdue({ actorReference: 'worker:two' }),
    ).toHaveLength(1);
  });

  it('stops offering a claim once it has been answered', async () => {
    const submission = await submitted();
    const acknowledged = await takedown.acknowledge({
      claimId: submission.claim.id,
      expectedVersion: submission.claim.version,
    });
    if (acknowledged.kind !== 'recorded') throw new Error('setup failed');
    await takedown.decide({
      claimId: submission.claim.id,
      dismissed: false,
      expectedVersion: acknowledged.claim.version,
    });

    clockOffsetMilliseconds = 48 * hour;
    expect(
      await takedown.claimOverdue({ actorReference: 'worker:one' }),
    ).toEqual([]);
  });

  it('offers nothing before the action deadline passes', async () => {
    await submitted();
    // Urgent in the development policy is twenty-four hours; an hour in is not
    // overdue, and a queue that offered it would be measuring the wrong thing.
    clockOffsetMilliseconds = 2 * hour;
    expect(
      await takedown.claimOverdue({ actorReference: 'worker:one' }),
    ).toEqual([]);
  });

  it('releases the lease when the claim moves', async () => {
    const submission = await submitted();
    clockOffsetMilliseconds = 48 * hour;
    const [held] = await takedown.claimOverdue({
      actorReference: 'worker:one',
    });
    if (held === undefined) throw new Error('setup failed');

    await takedown.acknowledge({
      claimId: held.id,
      expectedVersion: held.version,
    });

    const rows = await rowsOf<{ lease_actor_reference: string | null }>(
      database.sql`select lease_actor_reference from safety_takedown_claims
        where id = ${submission.claim.id}`,
    );
    // The work the lease was held for is the work that just happened.
    expect(rows[0]?.lease_actor_reference).toBeNull();
  });
});

describe('a passed deadline is recorded, and decides nothing', () => {
  it('writes a code on the case and never a sentence', async () => {
    const submission = await submitted();
    clockOffsetMilliseconds = 48 * hour;

    const swept = await takedown.recordOverdue({
      actorReference: 'worker:one',
    });

    expect(swept.recorded).toBe(1);
    const evidence = await rowsOf<{
      kind: string;
      note: string | null;
      state_label: string;
    }>(
      database.sql`select kind, note, state_label from safety_evidence
        where case_id = ${submission.claim.caseId} and kind = 'system_fact'`,
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      kind: 'system_fact',
      note: null,
      state_label: 'takedown_action_deadline_passed',
    });
    // A fact about the platform's own timeliness. Nothing was decided, nothing
    // was enforced, and the claim is still owed a reviewer's answer.
    expect(await countOf('safety_decisions')).toBe(0);
    expect(await countOf('safety_enforcements')).toBe(0);
    expect(await countOf('safety_takedown_claims', "state = 'received'")).toBe(
      1,
    );
  });

  it('records one breach however many times the sweep runs', async () => {
    await submitted();
    clockOffsetMilliseconds = 48 * hour;

    const first = await takedown.recordOverdue({
      actorReference: 'worker:one',
    });
    const second = await takedown.recordOverdue({
      actorReference: 'worker:two',
    });
    const third = await takedown.recordOverdue({
      actorReference: 'worker:one',
    });

    expect([first.recorded, second.recorded, third.recorded]).toEqual([
      1, 0, 0,
    ]);
    // One passed deadline, one record of it, however many workers looked.
    expect(await countOf('safety_evidence', "kind = 'system_fact'")).toBe(1);
  });

  it('records nothing at all when no deadline policy is published', async () => {
    await submitted(unpublished);
    clockOffsetMilliseconds = 365 * 24 * hour;

    const swept = await unpublished.recordOverdue({
      actorReference: 'worker:one',
    });

    // Nothing to pass, so nothing passed. An empty cycle here is the accurate
    // answer rather than a loop pretending to work.
    expect(swept.recorded).toBe(0);
    expect(await countOf('safety_evidence', "kind = 'system_fact'")).toBe(0);
  });

  it('lets two workers sweep at once and record one breach between them', async () => {
    await submitted();
    clockOffsetMilliseconds = 48 * hour;

    const swept = await Promise.all([
      takedown.recordOverdue({ actorReference: 'worker:one' }),
      takedown.recordOverdue({ actorReference: 'worker:two' }),
    ]);

    expect(swept.reduce((total, cycle) => total + cycle.recorded, 0)).toBe(1);
    expect(await countOf('safety_evidence', "kind = 'system_fact'")).toBe(1);
  });
});

describe('the database keeps the claim honest', () => {
  it('refuses a claimant identity nobody is entitled to record', async () => {
    const submission = await submitted();
    // Only an account holder has an identifier here, because that is the only
    // claimant this domain already knows.
    expect(
      await refused(() =>
        execute(
          database.sql`update safety_takedown_claims
            set claimant_account_id = ${crypto.randomUUID()}
            where id = ${submission.claim.id}`,
        ),
      ),
    ).toBe(true);
  });

  it('has no column that could hold a name or a way to reach somebody', async () => {
    const rows = await rowsOf<{ column_name: string }>(
      database.sql`select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = 'safety_takedown_claims'
        order by column_name`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        ['email', 'phone', 'name', 'address', 'contact'].some((forbidden) =>
          row.column_name.includes(forbidden),
        ),
        row.column_name,
      ).toBe(false);
    }
  });

  it('refuses a state whose moment never happened', async () => {
    const submission = await submitted();
    expect(
      await refused(() =>
        execute(
          database.sql`update safety_takedown_claims set state = 'completed'
            where id = ${submission.claim.id}`,
        ),
      ),
    ).toBe(true);
  });
});
