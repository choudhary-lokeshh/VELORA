import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { appealRateLimitCount } from '../../src/safety/policy.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testConsumerOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';
import {
  mediaEnvironment,
  readyProfileImage,
} from '../support/profile-media.js';

/**
 * Moderation evidence and decisions against real PostgreSQL.
 *
 * A case could be worked but not explained. What is under test is that it can
 * now be explained, and that the explanation cannot be rewritten afterwards:
 * evidence is a reference or a bounded snapshot rather than a copy, a decision
 * names what it cited and what changed, a correction is a second record that
 * leaves the first byte-for-byte as written, and PostgreSQL refuses every
 * update and delete on all of it.
 *
 * The other half is that exactly one reviewer settles a case however many are
 * looking at it, and that a refusal discovered halfway through leaves nothing
 * behind — no restricted account with no decision, no decided case with no
 * decision, no report resolved under a decision that was rolled back.
 *
 * The seam is exercised directly, because it deliberately has no HTTP surface.
 */

const databaseUrl = await provisionDatabase('velora_safety_decisions');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();
const config = testServerConfig(mediaEnvironment);
const now = () => new Date();

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'decisions-test',
  },
});
const mediaRuntime = testMediaRuntime({
  config,
  database: database.drizzle,
  logger,
  now,
});

const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
  media: mediaRuntime.service,
});
const runtimes = testProductRuntimes({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
  users,
});
const application = createApplication({
  config,
  dependencies: {
    auth,
    ...runtimes,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    ephemeralRedis: healthy,
    logger,
    queueRedis: healthy,
    users,
  },
});
const handle = (request: Request) => application.app.handle(request);
const { safety } = runtimes;
const moderation = safety.moderation;

interface Session {
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
}

async function signIn(subject: string): Promise<Omit<Session, 'id'>> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'consumer_web', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testConsumerOrigin,
        'x-velora-device': `${subject}-consumer_web`,
      },
      method: 'POST',
    }),
  );
  if (response.status !== 201) {
    throw new Error(`sign-in failed with ${String(response.status)}`);
  }
  const body = (await response.json()) as { csrfToken: string };
  return {
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0] ?? '')
      .filter((pair) => pair.length > 0)
      .join('; '),
    csrf: body.csrfToken,
  };
}

function request(
  path: string,
  session: Omit<Session, 'id'>,
  init: { readonly body?: unknown; readonly method?: string } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: session.cookie,
      origin: testConsumerOrigin,
      'x-velora-csrf': session.csrf,
    },
  });
}

/**
 * An onboarded consumer in active standing.
 *
 * Fully onboarded on purpose: USERS restricts an account only from `active`, so
 * an account that never finished onboarding is one this seam cannot act on.
 * Stopping short would make every enforcing decision here refuse for a reason
 * that has nothing to do with what is under test.
 */
async function consumer(subject: string): Promise<Session> {
  const session = await signIn(subject);
  const created = await handle(
    request('/v1/users', session, { method: 'POST' }),
  );
  const { id } = (await created.json()) as { id: string };
  const post = async (path: string, body: unknown = {}) =>
    handle(request(path, session, { body, method: 'POST' }));

  await post('/v1/users/me/onboarding/adult-declaration', {
    declaresAdult: true,
    region: 'ES',
  });
  await post('/v1/users/me/onboarding/acknowledgements', {
    acknowledgements: requiredPolicyDocuments.map((document) => ({
      key: document.key,
      version: document.version,
    })),
  });
  await post('/v1/users/me/profile', {
    displayName: subject.split('@')[0] ?? 'Consumer',
    languages: ['es'],
  });
  const upload = await post('/v1/users/me/profile/media');
  const { mediaId } = (await upload.json()) as { mediaId: string };
  await readyProfileImage({
    database,
    media: mediaRuntime,
    slotId: mediaId,
    users,
  });
  return { ...session, id };
}

let reportSequence = 0;
async function fileReport(
  reporter: Omit<Session, 'id'>,
  subjectId: string,
  detail = 'what the reporter wrote, which stays on the report',
): Promise<string> {
  reportSequence += 1;
  const response = await handle(
    request('/v1/safety/reports', reporter, {
      body: {
        clientReportId: `decide-key-${String(reportSequence).padStart(4, '0')}`,
        detail,
        reasonCode: 'harassment',
        target: { accountId: subjectId, type: 'consumer_account' },
      },
      method: 'POST',
    }),
  );
  if (response.status !== 200) {
    throw new Error(`report failed with ${String(response.status)}`);
  }
  return ((await response.json()) as { id: string }).id;
}

interface OpenCase {
  readonly evidenceIds: readonly string[];
  readonly id: string;
  readonly reportId: string;
  readonly subjectId: string;
  readonly version: number;
}

/** One reporter, one subject, one report, and the case that opened. */
async function reportedCase(prefix: string): Promise<OpenCase> {
  const reporter = await consumer(`${prefix}-reporter@velora.test`);
  const subject = await consumer(`${prefix}-subject@velora.test`);
  const reportId = await fileReport(reporter, subject.id);
  const [row] = await rowsOf<{ id: string; version: number }>(
    database.sql`select id, version from safety_cases
      where target_id = ${subject.id} order by opened_at desc limit 1`,
  );
  if (row === undefined) throw new Error('no case opened');
  return {
    evidenceIds: await evidenceIds(row.id),
    id: row.id,
    reportId,
    subjectId: subject.id,
    version: row.version,
  };
}

async function evidenceIds(caseId: string): Promise<string[]> {
  const rows = await rowsOf<{ id: string }>(
    database.sql`select id from safety_evidence
      where case_id = ${caseId} order by recorded_at, id`,
  );
  return rows.map((row) => row.id);
}

async function caseVersion(caseId: string): Promise<number> {
  const [row] = await rowsOf<{ version: number }>(
    database.sql`select version from safety_cases where id = ${caseId}`,
  );
  return row?.version ?? 0;
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
  reportSequence = 0;
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('evidence is a reference, never a copy', () => {
  it('records every report as evidence at intake, by reference', async () => {
    const opened = await reportedCase('intake');

    const rows = await rowsOf<{
      kind: string;
      note: string | null;
      reference_id: string;
      reference_type: string;
      state_label: string | null;
    }>(
      database.sql`select kind, note, reference_id, reference_type, state_label
        from safety_evidence where case_id = ${opened.id}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'report',
      note: null,
      reference_id: opened.reportId,
      reference_type: 'safety_report',
      state_label: null,
    });
    // The narrative stays on the report. Evidence names it and copies nothing,
    // so there is no second, less protected store of what somebody wrote.
    const stored = await rowsOf<{ detail: string }>(
      database.sql`select detail from safety_reports where id = ${opened.reportId}`,
    );
    expect(stored[0]?.detail).toContain('stays on the report');
  });

  it('keeps every report in a case as its own evidence', async () => {
    const opened = await reportedCase('several');
    const second = await consumer('several-second@velora.test');
    await fileReport(second, opened.subjectId);

    expect(await evidenceIds(opened.id)).toHaveLength(2);
    // Grouping, never discarding: both allegations survive as separate records.
    expect(await countOf('safety_reports')).toBe(2);
  });

  it('takes a reviewer note only with an author, and bounded', async () => {
    const opened = await reportedCase('note');

    const anonymous = await moderation.recordEvidence({
      caseId: opened.id,
      evidence: { kind: 'operator_note', note: 'no author' },
    });
    const oversized = await moderation.recordEvidence({
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidence: { kind: 'operator_note', note: 'x'.repeat(2001) },
    });
    const written = await moderation.recordEvidence({
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidence: { kind: 'operator_note', note: 'Spoke to the reporter.' },
    });

    expect([anonymous.kind, oversized.kind, written.kind]).toEqual([
      'invalid_reference',
      'invalid_reference',
      'recorded',
    ]);
    if (written.kind !== 'recorded') return;
    expect(written.evidence.actorReference).toBe('session:reviewer-a');
    expect(written.evidence.note).toBe('Spoke to the reporter.');
  });

  it('refuses a snapshot label that is prose rather than a code', async () => {
    const opened = await reportedCase('label');
    const observedAt = new Date();

    const sentence = await moderation.recordEvidence({
      caseId: opened.id,
      evidence: {
        kind: 'system_fact',
        observedAt,
        // A label field that accepted this would be the place a message body
        // or a reporter's narrative eventually ends up.
        stateLabel: 'the account was created on a burner address',
      },
    });
    const code = await moderation.recordEvidence({
      caseId: opened.id,
      evidence: { kind: 'system_fact', observedAt, stateLabel: 'rate_limited' },
    });

    expect([sentence.kind, code.kind]).toEqual([
      'invalid_reference',
      'recorded',
    ]);
  });

  it('refuses evidence naming something the case is not about', async () => {
    const first = await reportedCase('scope-first');
    const second = await reportedCase('scope-second');

    const foreign = await moderation.recordEvidence({
      caseId: first.id,
      evidence: { kind: 'report', reportId: second.reportId },
    });
    const wrongKind = await moderation.recordEvidence({
      caseId: first.id,
      evidence: {
        contentId: crypto.randomUUID(),
        kind: 'creator_content_reference',
      },
    });
    const unreported = await moderation.recordEvidence({
      caseId: first.id,
      evidence: { kind: 'message_reference', messageId: crypto.randomUUID() },
    });
    const missing = await moderation.recordEvidence({
      caseId: crypto.randomUUID(),
      evidence: { kind: 'report', reportId: first.reportId },
    });

    expect([
      foreign.kind,
      wrongKind.kind,
      unreported.kind,
      missing.kind,
    ]).toEqual([
      'invalid_reference',
      'invalid_reference',
      'invalid_reference',
      'not_found',
    ]);
    expect(await evidenceIds(first.id)).toHaveLength(1);
  });

  it('refuses consent and verification evidence no authority publishes', async () => {
    const opened = await reportedCase('unavailable');

    const consent = await moderation.recordEvidence({
      caseId: opened.id,
      evidence: {
        consentRecordId: crypto.randomUUID(),
        kind: 'consent_evidence_reference',
      },
    });
    const verification = await moderation.recordEvidence({
      caseId: opened.id,
      evidence: {
        externalReference: 'verifier-outcome-0001',
        kind: 'external_verification_reference',
      },
    });

    // Fail closed rather than accept an assertion dressed as evidence. The
    // external reference is refused by name: Velora has no approved verifier of
    // that kind. The consent reference is refused because there is nothing to
    // name — a consent record only exists if an approved verifier captured it
    // under approved wording, and this environment has neither.
    expect([consent.kind, verification.kind]).toEqual([
      'invalid_reference',
      'unavailable',
    ]);
    expect(await evidenceIds(opened.id)).toHaveLength(1);
  });
});

describe('a decision is explainable, or it is refused', () => {
  it('records what was decided, about whom, citing what', async () => {
    const opened = await reportedCase('record');

    const outcome = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });

    expect(outcome.kind).toBe('recorded');
    if (outcome.kind !== 'recorded') return;
    expect(outcome.decision).toMatchObject({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: [...opened.evidenceIds],
      policyVersion: 'v1-provisional',
      priorState: 'unrestricted',
      reasonCode: 'harassment',
      resultingState: 'restricted',
      scope: 'account_restriction',
      subjectId: opened.subjectId,
      supersedesId: null,
      targetType: 'consumer_account',
    });
    expect(outcome.decision.enforcementId).not.toBeNull();
    expect(outcome.decision.decidedAt).toBeInstanceOf(Date);

    // The case has left the queue as decided rather than merely closed, the
    // report it carried is resolved, and the account is restricted.
    const [settled] = await rowsOf<{ closed_at: string; state: string }>(
      database.sql`select closed_at, state from safety_cases where id = ${opened.id}`,
    );
    expect(settled?.state).toBe('decided');
    expect(settled?.closed_at).not.toBeNull();
    expect(await countOf('safety_reports', "state = 'actioned'")).toBe(1);
    const [account] = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts where id = ${opened.subjectId}`,
    );
    expect(account?.status).toBe('restricted');
  });

  it('records a hold as its own action, with an end', async () => {
    const opened = await reportedCase('hold');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const outcome = await moderation.decideCase({
      action: 'temporary_hold',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      expiresAt,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });

    expect(outcome.kind).toBe('recorded');
    if (outcome.kind !== 'recorded') return;
    // A hold is distinguishable in the schema from a final finding, because an
    // accusation recorded as guilt is a defamation the platform authored.
    expect(outcome.decision.action).toBe('temporary_hold');
    expect(outcome.decision.expiresAt?.getTime()).toBe(expiresAt.getTime());
    const [enforcement] = await rowsOf<{ expires_at: Date }>(
      database.sql`select expires_at from safety_enforcements`,
    );
    expect(enforcement?.expires_at).not.toBeNull();
  });

  it('dismisses without an enforcement and without a finding', async () => {
    const opened = await reportedCase('dismiss');

    const outcome = await moderation.decideCase({
      action: 'no_action',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      reasonCode: 'no_violation_found',
    });

    expect(outcome.kind).toBe('recorded');
    if (outcome.kind !== 'recorded') return;
    expect(outcome.decision.scope).toBeNull();
    expect(outcome.decision.enforcementId).toBeNull();
    expect(outcome.decision.priorState).toBeNull();
    expect(await countOf('safety_enforcements')).toBe(0);
    expect(await countOf('safety_reports', "state = 'dismissed'")).toBe(1);
  });

  it('escalates without settling, and a settlement still follows', async () => {
    const opened = await reportedCase('escalate');

    const escalated = await moderation.decideCase({
      action: 'escalate',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      priority: 'urgent',
      reasonCode: 'requires_specialist_review',
    });
    expect(escalated.kind).toBe('recorded');

    // Handing a case on is not settling it: the case is still in the queue and
    // its report is still open.
    const [held] = await rowsOf<{ priority: string; state: string }>(
      database.sql`select priority, state from safety_cases where id = ${opened.id}`,
    );
    expect(held).toMatchObject({ priority: 'urgent', state: 'new' });
    expect(await countOf('safety_reports', "state = 'received'")).toBe(1);

    const settled = await moderation.decideCase({
      action: 'no_action',
      actorReference: 'session:reviewer-b',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: await caseVersion(opened.id),
      reasonCode: 'insufficient_evidence',
    });
    expect(settled.kind).toBe('recorded');
    expect(await countOf('safety_decisions')).toBe(2);
    expect(await countOf('safety_cases', "state = 'decided'")).toBe(1);
  });

  it('refuses a decision the vocabulary cannot express', async () => {
    const opened = await reportedCase('vocabulary');
    const base = {
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
    } as const;

    const outcomes = await Promise.all([
      // A restriction citing nothing.
      moderation.decideCase({
        ...base,
        action: 'restrict_capability',
        evidenceIds: [],
        reasonCode: 'harassment',
        scope: 'account_restriction',
      }),
      // A restriction recorded as a review that found nothing.
      moderation.decideCase({
        ...base,
        action: 'restrict_capability',
        reasonCode: 'no_violation_found',
        scope: 'account_restriction',
      }),
      // An action carrying a scope it may not name.
      moderation.decideCase({
        ...base,
        action: 'unpublish',
        reasonCode: 'harassment',
        scope: 'account_restriction',
      }),
      // A hold with no end.
      moderation.decideCase({
        ...base,
        action: 'temporary_hold',
        reasonCode: 'harassment',
        scope: 'account_restriction',
      }),
      // An end with no hold.
      moderation.decideCase({
        ...base,
        action: 'restrict_capability',
        expiresAt: new Date(Date.now() + 60_000),
        reasonCode: 'harassment',
        scope: 'account_restriction',
      }),
      // A settlement with no scope where one is required.
      moderation.decideCase({
        ...base,
        action: 'restrict_capability',
        reasonCode: 'harassment',
      }),
      // An escalation with no urgency to record.
      moderation.decideCase({
        ...base,
        action: 'escalate',
        reasonCode: 'requires_specialist_review',
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(
      Array.from({ length: 7 }, () => 'invalid_decision'),
    );
    expect(await countOf('safety_decisions')).toBe(0);
    expect(await countOf('safety_enforcements')).toBe(0);
    expect(await countOf('safety_cases', "state = 'new'")).toBe(1);
  });

  it('refuses a decision citing evidence from another case', async () => {
    const first = await reportedCase('citation-first');
    const second = await reportedCase('citation-second');

    const outcome = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: first.id,
      evidenceIds: [...first.evidenceIds, ...second.evidenceIds],
      expectedVersion: first.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });

    expect(outcome.kind).toBe('invalid_decision');
    expect(await countOf('safety_decisions')).toBe(0);
    expect(await countOf('safety_cases', "state = 'new'")).toBe(2);
  });

  it('leaves nothing behind when the enforcement cannot be carried out', async () => {
    const opened = await reportedCase('unapplicable');

    const outcome = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      reasonCode: 'harassment',
      // A creator scope. This seam holds no contract that changes a creator's
      // state, and a record claiming an effect that never happened is worse
      // than a refusal.
      scope: 'creator_suspension',
    });

    expect(outcome.kind).toBe('not_applicable');
    expect(await countOf('safety_decisions')).toBe(0);
    expect(await countOf('safety_enforcements')).toBe(0);
    expect(await countOf('safety_cases', "state = 'new'")).toBe(1);
    expect(await countOf('safety_reports', "state = 'received'")).toBe(1);
  });
});

describe('a correction supersedes and never edits', () => {
  async function settled(prefix: string): Promise<{
    readonly decisionId: string;
    readonly opened: OpenCase;
  }> {
    const opened = await reportedCase(prefix);
    const outcome = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (outcome.kind !== 'recorded') throw new Error('settlement failed');
    return { decisionId: outcome.decision.id, opened };
  }

  it('names what it replaces and leaves the original as written', async () => {
    const { decisionId, opened } = await settled('correct');
    const before = await moderation.caseDecisions(opened.id);

    const reversal = await moderation.decideCase({
      action: 'revoke_restriction',
      actorReference: 'session:reviewer-b',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: await caseVersion(opened.id),
      reasonCode: 'platform_integrity',
      scope: 'account_restriction',
      supersedesDecisionId: decisionId,
    });

    expect(reversal.kind).toBe('recorded');
    if (reversal.kind !== 'recorded') return;
    expect(reversal.decision.supersedesId).toBe(decisionId);
    expect(reversal.decision.priorState).toBe('restricted');
    expect(reversal.decision.resultingState).toBe('unrestricted');

    const after = await moderation.caseDecisions(opened.id);
    expect(after).toHaveLength(2);
    expect(after.find((entry) => entry.id === decisionId)).toEqual(before[0]);
    const [account] = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts where id = ${opened.subjectId}`,
    );
    expect(account?.status).toBe('active');
  });

  it('refuses a second settlement of the same case', async () => {
    const { opened } = await settled('resettle');

    const again = await moderation.decideCase({
      action: 'no_action',
      actorReference: 'session:reviewer-b',
      caseId: opened.id,
      evidenceIds: [],
      expectedVersion: await caseVersion(opened.id),
      reasonCode: 'no_violation_found',
    });

    expect(again.kind).toBe('conflict');
    expect(await countOf('safety_decisions')).toBe(1);
  });

  it('refuses two corrections of the same decision', async () => {
    const { decisionId, opened } = await settled('fork');
    const version = await caseVersion(opened.id);
    const correction = () =>
      moderation.decideCase({
        action: 'escalate',
        actorReference: 'session:reviewer-b',
        caseId: opened.id,
        evidenceIds: opened.evidenceIds,
        expectedVersion: version,
        priority: 'high',
        reasonCode: 'requires_specialist_review',
        supersedesDecisionId: decisionId,
      });

    const first = await correction();
    const second = await correction();

    // The chain does not fork into two equally valid histories: at most one
    // record may supersede a given one, and the database is what decides.
    expect(first.kind).toBe('recorded');
    expect(second.kind).toBe('conflict');
    expect(await countOf('safety_decisions')).toBe(2);
  });

  it('refuses a correction of a decision in another case', async () => {
    const mine = await settled('foreign-mine');
    const theirs = await settled('foreign-theirs');

    const outcome = await moderation.decideCase({
      action: 'no_action',
      actorReference: 'session:reviewer-b',
      caseId: mine.opened.id,
      evidenceIds: [],
      expectedVersion: await caseVersion(mine.opened.id),
      reasonCode: 'no_violation_found',
      supersedesDecisionId: theirs.decisionId,
    });

    expect(outcome.kind).toBe('not_found');
    expect(await countOf('safety_decisions')).toBe(2);
  });
});

describe('however many reviewers, one outcome', () => {
  it('settles sixteen simultaneous decisions into one', async () => {
    const opened = await reportedCase('storm');

    const outcomes = await Promise.all(
      Array.from({ length: 16 }, async (_, index) =>
        moderation.decideCase({
          action: 'restrict_capability',
          actorReference: `session:reviewer-${String(index)}`,
          caseId: opened.id,
          evidenceIds: opened.evidenceIds,
          expectedVersion: opened.version,
          reasonCode: 'harassment',
          scope: 'account_restriction',
        }),
      ),
    );

    expect(
      outcomes.filter((outcome) => outcome.kind === 'recorded'),
    ).toHaveLength(1);
    expect(await countOf('safety_decisions')).toBe(1);
    expect(await countOf('safety_enforcements')).toBe(1);
  });

  it('refuses a decision taken against a stale read', async () => {
    const opened = await reportedCase('stale');
    await moderation.claimCase({
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
    });

    const stale = await moderation.decideCase({
      action: 'no_action',
      actorReference: 'session:reviewer-b',
      caseId: opened.id,
      evidenceIds: [],
      // The version before the claim. The case has moved underneath this
      // reviewer, so their decision is about a case they did not read.
      expectedVersion: opened.version,
      reasonCode: 'no_violation_found',
    });

    expect(stale.kind).toBe('conflict');
    expect(await countOf('safety_decisions')).toBe(0);
  });

  it('resolves a closure racing a decision to one of the two', async () => {
    const opened = await reportedCase('closure-race');

    const [closed, decided] = await Promise.all([
      moderation.closeCase({ caseId: opened.id }),
      moderation.decideCase({
        action: 'no_action',
        actorReference: 'session:reviewer-a',
        caseId: opened.id,
        evidenceIds: opened.evidenceIds,
        expectedVersion: opened.version,
        reasonCode: 'no_violation_found',
      }),
    ]);

    const won = [closed.kind, decided.kind].filter(
      (kind) => kind === 'recorded',
    );
    expect(won).toHaveLength(1);
    const [state] = await rowsOf<{ state: string }>(
      database.sql`select state from safety_cases where id = ${opened.id}`,
    );
    expect(['closed', 'decided']).toContain(state?.state ?? '');
    // A case closed without a decision has no decision; a decided one has one.
    expect(await countOf('safety_decisions')).toBe(
      decided.kind === 'recorded' ? 1 : 0,
    );
  });

  it('loses no evidence when a report arrives while a decision commits', async () => {
    const opened = await reportedCase('interleave');
    const late = await consumer('interleave-late@velora.test');

    const [decision] = await Promise.all([
      moderation.decideCase({
        action: 'no_action',
        actorReference: 'session:reviewer-a',
        caseId: opened.id,
        evidenceIds: opened.evidenceIds,
        expectedVersion: opened.version,
        reasonCode: 'no_violation_found',
      }),
      fileReport(late, opened.subjectId),
    ]);

    expect(decision.kind).toBe('recorded');
    // Either the second report joined the case before it settled or it opened
    // a new one afterwards. Both reports exist, both are evidence, and the
    // decision cites exactly what its reviewer read.
    expect(await countOf('safety_reports')).toBe(2);
    expect(await countOf('safety_evidence')).toBe(2);
    if (decision.kind !== 'recorded') return;
    expect(decision.decision.evidenceIds).toEqual([...opened.evidenceIds]);
  });

  it('takes no deadlock when every part of the vertical contends at once', async () => {
    const deadlocks = async () => {
      const rows = await rowsOf<{ deadlocks: string }>(
        database.sql`select deadlocks from pg_stat_database
          where datname = current_database()`,
      );
      return Number(rows[0]?.deadlocks ?? 0);
    };
    const opened = await reportedCase('vertical');
    const others = await Promise.all(
      Array.from({ length: 4 }, async (_, index) =>
        consumer(`vertical-reporter-${String(index)}@velora.test`),
      ),
    );
    const before = await deadlocks();

    // Intake, review, and closure all reach for the same subject lock and the
    // same case row, from different directions, at the same moment. The
    // ordering rule the whole domain follows — subject lock before any row lock
    // — is what makes this a serial order rather than a cycle.
    await Promise.all([
      ...others.map(async (reporter) => fileReport(reporter, opened.subjectId)),
      moderation.claimCase({
        actorReference: 'session:reviewer-a',
        caseId: opened.id,
      }),
      moderation.decideCase({
        action: 'restrict_capability',
        actorReference: 'session:reviewer-b',
        caseId: opened.id,
        evidenceIds: opened.evidenceIds,
        expectedVersion: opened.version,
        reasonCode: 'harassment',
        scope: 'account_restriction',
      }),
      moderation.decideCase({
        action: 'no_action',
        actorReference: 'session:reviewer-c',
        caseId: opened.id,
        evidenceIds: [],
        expectedVersion: opened.version,
        reasonCode: 'no_violation_found',
      }),
      moderation.closeCase({ caseId: opened.id }),
      moderation.recordEvidence({
        actorReference: 'session:reviewer-d',
        caseId: opened.id,
        evidence: { kind: 'operator_note', note: 'Looking at this now.' },
      }),
    ]);

    expect(await deadlocks()).toBe(before);
    // At most one settlement, whatever order they arrived in, and every report
    // filed survives as its own record.
    expect(await countOf('safety_decisions')).toBeLessThanOrEqual(1);
    expect(await countOf('safety_reports')).toBe(5);
    // And the case left the queue exactly once, by one route or the other.
    expect(
      await countOf('safety_cases', "state in ('decided', 'closed')"),
    ).toBeLessThanOrEqual(1);
  });

  it('takes no deadlock across a batch of contended decisions', async () => {
    const deadlocks = async () => {
      const rows = await rowsOf<{ deadlocks: string }>(
        database.sql`select deadlocks from pg_stat_database
          where datname = current_database()`,
      );
      return Number(rows[0]?.deadlocks ?? 0);
    };
    const cases = await Promise.all(
      Array.from({ length: 4 }, async (_, index) =>
        reportedCase(`deadlock-${String(index)}`),
      ),
    );
    const before = await deadlocks();

    await Promise.all(
      cases.flatMap((opened) => [
        moderation.decideCase({
          action: 'restrict_capability',
          actorReference: 'session:reviewer-a',
          caseId: opened.id,
          evidenceIds: opened.evidenceIds,
          expectedVersion: opened.version,
          reasonCode: 'harassment',
          scope: 'account_restriction',
        }),
        moderation.decideCase({
          action: 'no_action',
          actorReference: 'session:reviewer-b',
          caseId: opened.id,
          evidenceIds: [],
          expectedVersion: opened.version,
          reasonCode: 'no_violation_found',
        }),
        moderation.closeCase({ caseId: opened.id }),
      ]),
    );

    expect(await deadlocks()).toBe(before);
  });
});

describe('the database keeps the record', () => {
  it('refuses to edit or remove anything a decision rests on', async () => {
    const opened = await reportedCase('append-only');
    const decided = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');

    const refusals = await Promise.all([
      refused(() =>
        execute(
          database.sql`update safety_evidence set kind = 'operator_note'`,
        ),
      ),
      refused(() => execute(database.sql`delete from safety_evidence`)),
      refused(() =>
        execute(database.sql`update safety_decisions set action = 'no_action'`),
      ),
      refused(() => execute(database.sql`delete from safety_decisions`)),
      refused(() =>
        execute(
          database.sql`update safety_decision_evidence set recorded_at = now()`,
        ),
      ),
      refused(() =>
        execute(database.sql`delete from safety_decision_evidence`),
      ),
      refused(() =>
        execute(
          database.sql`update safety_enforcements set disposition = 'lift'`,
        ),
      ),
      refused(() => execute(database.sql`delete from safety_enforcements`)),
    ]);

    expect(refusals.every(Boolean)).toBe(true);
    expect(refusals).toHaveLength(8);
  });

  it('refuses evidence and citations the application would never write', async () => {
    const opened = await reportedCase('constraints');
    const other = await reportedCase('constraints-other');
    const insertEvidence = (values: Record<string, unknown>) =>
      execute(
        database.sql`insert into safety_evidence ${database.sql({
          actor_reference: null,
          case_id: opened.id,
          external_reference: null,
          id: crypto.randomUUID(),
          kind: 'system_fact',
          note: null,
          observed_at: new Date(),
          policy_version: 'v1-provisional',
          recorded_at: new Date(),
          reference_id: null,
          reference_type: null,
          state_label: 'observed',
          ...values,
        })}`,
      );

    expect(
      await refused(() =>
        // A snapshot label holding a sentence, which is how a narrative would
        // reach a column nobody expected to find one in.
        insertEvidence({ state_label: 'a whole sentence about somebody' }),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        insertEvidence({
          kind: 'operator_note',
          note: 'no author',
          state_label: null,
          observed_at: null,
        }),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        // A reference kind naming nothing.
        insertEvidence({
          kind: 'report',
          observed_at: null,
          state_label: null,
        }),
      ),
    ).toBe(true);

    // And a decision cannot cite evidence that belongs to another case: both
    // sides of the citation carry the case, so PostgreSQL refuses it.
    const decided = await moderation.decideCase({
      action: 'no_action',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: opened.evidenceIds,
      expectedVersion: opened.version,
      reasonCode: 'no_violation_found',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');
    expect(
      await refused(() =>
        execute(
          database.sql`insert into safety_decision_evidence ${database.sql({
            case_id: opened.id,
            decision_id: decided.decision.id,
            evidence_id: other.evidenceIds[0] ?? '',
            recorded_at: new Date(),
          })}`,
        ),
      ),
    ).toBe(true);
  });
});

describe('a person is told what was done and can contest it', () => {
  it('discloses the category and the scope, never the finding', async () => {
    const opened = await reportedCase('standing');
    const subject = await consumer('standing-subject-account@velora.test');
    // The decision has to be about an account that can sign in, so the case is
    // opened against that account rather than the generated one.
    const theirCase = await (async () => {
      const reporter = await consumer('standing-reporter@velora.test');
      await fileReport(reporter, subject.id);
      const [row] = await rowsOf<{ id: string; version: number }>(
        database.sql`select id, version from safety_cases
          where target_id = ${subject.id} order by opened_at desc limit 1`,
      );
      if (row === undefined) throw new Error('no case opened');
      return row;
    })();
    expect(opened.id).not.toBe(theirCase.id);

    const decided = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: theirCase.id,
      evidenceIds: await evidenceIds(theirCase.id),
      expectedVersion: theirCase.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');

    const response = await handle(request('/v1/safety/standing', subject));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('account_restricted');
    expect(body).toContain('account_restriction');
    // The review recorded `harassment`. Nothing the subject can read says so.
    expect(body).not.toContain('harassment');
    expect(body).not.toContain('session:reviewer-a');
  });

  it('accepts one complaint per decision, and another after a withdrawal', async () => {
    const subject = await consumer('appeal-subject@velora.test');
    const reporter = await consumer('appeal-reporter@velora.test');
    await fileReport(reporter, subject.id);
    const [row] = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${subject.id} limit 1`,
    );
    if (row === undefined) throw new Error('no case opened');
    const decided = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: row.id,
      evidenceIds: await evidenceIds(row.id),
      expectedVersion: row.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');
    const complain = (session: typeof subject) =>
      handle(
        request('/v1/safety/appeals', session, {
          body: { decisionId: decided.decision.id },
          method: 'POST',
        }),
      );

    const first = await complain(subject);
    expect(first.status).toBe(200);
    const appeal = (await first.json()) as { id: string };
    // One decision is not contested twice at once.
    expect((await complain(subject)).status).toBe(409);
    // And somebody else's decision is refused exactly as a decision that does
    // not exist would be, so probing enumerates nothing.
    expect((await complain(reporter)).status).toBe(422);

    const withdrawn = await handle(
      request('/v1/safety/appeals/withdrawal', subject, {
        body: { appealId: appeal.id },
        method: 'POST',
      }),
    );
    expect(withdrawn.status).toBe(200);
    expect((await complain(subject)).status).toBe(200);

    // Withdrawing somebody else's complaint is answered as if it were not
    // there at all.
    expect(
      (
        await handle(
          request('/v1/safety/appeals/withdrawal', reporter, {
            body: { appealId: appeal.id },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(422);
  });

  it('never echoes the appellant statement back', async () => {
    const subject = await consumer('statement-subject@velora.test');
    const reporter = await consumer('statement-reporter@velora.test');
    await fileReport(reporter, subject.id);
    const [row] = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${subject.id} limit 1`,
    );
    if (row === undefined) throw new Error('no case opened');
    const decided = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: row.id,
      evidenceIds: await evidenceIds(row.id),
      expectedVersion: row.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');

    await handle(
      request('/v1/safety/appeals', subject, {
        body: {
          decisionId: decided.decision.id,
          statement: 'a private explanation nobody else should read',
        },
        method: 'POST',
      }),
    );
    const listed = await handle(request('/v1/safety/appeals', subject));

    expect(listed.status).toBe(200);
    // Sent once and never read back: the appellant already knows what they
    // wrote, and echoing it would turn a record into a readable store.
    expect(await listed.text()).not.toContain('private explanation');
  });
});

describe('what a person is told cannot be pushed out of view', () => {
  /** A subject with a restriction and then a great deal of noise after it. */
  async function buriedRestriction(): Promise<{
    readonly decisionId: string;
    readonly subject: Session;
  }> {
    const subject = await consumer('buried-subject@velora.test');
    const reporter = await consumer('buried-reporter@velora.test');
    await fileReport(reporter, subject.id);
    const [row] = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${subject.id} limit 1`,
    );
    if (row === undefined) throw new Error('no case opened');
    const decided = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: row.id,
      evidenceIds: await evidenceIds(row.id),
      expectedVersion: row.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');

    // Sixty later decisions about the same subject that say nothing. Written
    // directly, because reaching sixty through the product would be sixty
    // cases and this is about what the read returns.
    await execute(
      database.sql`insert into safety_decisions
        (action, actor_reference, case_id, decided_at, id, policy_version,
         reason_code, subject_id, target_type)
        select 'escalate', 'session:reviewer-a', ${row.id},
               now() + (n || ' seconds')::interval, gen_random_uuid(),
               'v1-provisional', 'requires_specialist_review',
               ${subject.id}, 'consumer_account'
        from generate_series(1, 60) as n`,
    );
    return { decisionId: decided.decision.id, subject };
  }

  it('still discloses a restriction buried under newer decisions', async () => {
    const buried = await buriedRestriction();

    const response = await handle(
      request('/v1/safety/standing', buried.subject),
    );
    const body = (await response.json()) as {
      statements: { decisionId: string; reasonCode: string }[];
    };

    // The restriction is older than a page of decisions that say nothing. A
    // read that filtered after limiting would tell this person nothing is in
    // force while they are restricted, which is the one answer this surface
    // must never give.
    expect(body.statements.map((entry) => entry.decisionId)).toEqual([
      buried.decisionId,
    ]);
    expect(body.statements[0]?.reasonCode).toBe('account_restricted');
  });

  it('stops disclosing it once a lift lands, however much came between', async () => {
    const buried = await buriedRestriction();
    const [settled] = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${buried.subject.id} limit 1`,
    );
    if (settled === undefined) throw new Error('setup failed');
    const reversed = await moderation.decideCase({
      action: 'revoke_restriction',
      actorReference: 'session:reviewer-b',
      caseId: settled.id,
      evidenceIds: await evidenceIds(settled.id),
      expectedVersion: settled.version,
      reasonCode: 'platform_integrity',
      scope: 'account_restriction',
      supersedesDecisionId: buried.decisionId,
    });
    expect(reversed.kind).toBe('recorded');

    const response = await handle(
      request('/v1/safety/standing', buried.subject),
    );
    const body = (await response.json()) as { statements: unknown[] };

    // The supersession is a fact about a row far outside any page. Telling
    // somebody they are restricted when they are not is worse than telling
    // them nothing.
    expect(body.statements).toEqual([]);
  });
});

describe('a partial case says it is partial', () => {
  it('reports truncation rather than looking complete', async () => {
    const opened = await reportedCase('truncation');
    const complete = await moderation.caseDetail(opened.id);
    expect(complete?.truncated).toBe(false);

    // One more than the bound, written directly because what is under test is
    // what the read says about itself rather than how the rows got there.
    await execute(
      database.sql`insert into safety_evidence
        (actor_reference, case_id, id, kind, note, policy_version, recorded_at)
        select 'session:reviewer-a', ${opened.id}, gen_random_uuid(),
               'operator_note', 'note ' || n, 'v1-provisional',
               now() + (n || ' seconds')::interval
        from generate_series(1, 201) as n`,
    );

    const partial = await moderation.caseDetail(opened.id);

    // A reviewer looking at a partial case that looked complete would be
    // deciding on less than they thought they had.
    expect(partial?.truncated).toBe(true);
    expect(partial?.evidence).toHaveLength(200);
  });
});

describe('a complaint stays reachable and bounded', () => {
  async function decidedAgainst(prefix: string): Promise<{
    readonly decisionId: string;
    readonly subject: Session;
  }> {
    const subject = await consumer(`${prefix}-subject@velora.test`);
    const reporter = await consumer(`${prefix}-reporter@velora.test`);
    await fileReport(reporter, subject.id);
    const [row] = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${subject.id} limit 1`,
    );
    if (row === undefined) throw new Error('no case opened');
    const decided = await moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: row.id,
      evidenceIds: await evidenceIds(row.id),
      expectedVersion: row.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');
    return { decisionId: decided.decision.id, subject };
  }

  it('withdraws a complaint older than a page of the caller own', async () => {
    const against = await decidedAgainst('withdraw-reach');
    const first = await handle(
      request('/v1/safety/appeals', against.subject, {
        body: { decisionId: against.decisionId },
        method: 'POST',
      }),
    );
    const appeal = (await first.json()) as { id: string };

    // Sixty later complaints, so the first is well outside any page of the
    // caller's own. Written directly for the same reason as above.
    await execute(
      database.sql`insert into safety_appeals
        (appellant_kind, appellant_reference, case_id, decision_id, id,
         policy_version, state, submitted_at, updated_at)
        select 'subject', ${against.subject.id}, c.id, d.id, gen_random_uuid(),
               'v1-provisional', 'withdrawn', now() + (n || ' seconds')::interval,
               now()
        from generate_series(1, 60) as n,
             lateral (select id from safety_cases limit 1) as c,
             lateral (select id from safety_decisions
                      where id = ${against.decisionId}) as d`,
    );

    const withdrawn = await handle(
      request('/v1/safety/appeals/withdrawal', against.subject, {
        body: { appealId: appeal.id },
        method: 'POST',
      }),
    );

    // Resolved by identity. Looking through a page of the caller's own would
    // answer this exactly as though the complaint were somebody else's.
    expect(withdrawn.status).toBe(200);
    expect((await withdrawn.json()) as { state: string }).toMatchObject({
      state: 'withdrawn',
    });
  });

  it('bounds how many complaints one account may make', async () => {
    const against = await decidedAgainst('appeal-bound');
    const complain = () =>
      handle(
        request('/v1/safety/appeals', against.subject, {
          body: { decisionId: against.decisionId },
          method: 'POST',
        }),
      );
    const withdraw = async (appealId: string) =>
      handle(
        request('/v1/safety/appeals/withdrawal', against.subject, {
          body: { appealId },
          method: 'POST',
        }),
      );

    // Withdrawing frees somebody to complain again, which is right. Without a
    // bound it also lets one account cycle indefinitely, writing a row each
    // time and pushing its own live complaint out of its own reach.
    let refusedAt = 0;
    for (let attempt = 1; attempt <= appealRateLimitCount + 2; attempt += 1) {
      const response = await complain();
      if (response.status !== 200) {
        refusedAt = attempt;
        expect(response.status).toBe(409);
        break;
      }
      const created = (await response.json()) as { id: string };
      await withdraw(created.id);
    }

    expect(refusedAt).toBe(appealRateLimitCount + 1);
    // And nothing already made was removed or altered.
    expect(await countOf('safety_appeals')).toBe(appealRateLimitCount);
  });
});

describe('none of it is reachable from outside', () => {
  it('publishes evidence, decisions, and notes only to an operator', () => {
    const operatorOnly = application.app.routes
      .map((route) => route.path)
      .filter((path) => /evidence|decision|note/iu.test(path));

    expect(operatorOnly.length).toBeGreaterThan(0);
    for (const path of operatorOnly) {
      expect(path, path).toStartWith('/v1/admin/');
    }
  });

  it('refuses an operator decision route to a consumer session', async () => {
    const opened = await reportedCase('probe');
    const reporter = await consumer('decision-probe@velora.test');

    const response = await handle(
      request('/v1/admin/safety/cases/decisions', reporter, {
        body: {
          action: 'no_action',
          caseId: opened.id,
          evidenceIds: [],
          expectedVersion: opened.version,
          reasonCode: 'no_violation_found',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    // Nothing was decided, and nothing about the case moved.
    expect(await countOf('safety_decisions')).toBe(0);
    expect(await countOf('safety_cases', "state = 'new'")).toBe(1);
  });

  it('keeps privileged authentication refused, so no Admin authority exists', () => {
    // Operator access to evidence requires Admin authority, and the only thing
    // that makes that true today is that no Admin authority can be minted.
    expect(config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER).toBe('unavailable');
  });
});
