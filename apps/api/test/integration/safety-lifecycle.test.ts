import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { LocalTestProfileMediaStorage } from '../../src/users/media.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testConsumerOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * One safety story, from the report to the reversal.
 *
 * Every piece of this vertical is tested where it lives. What nothing tested
 * was the *chain*: that a report becomes a case, that a case carries evidence,
 * that a decision on that evidence reaches USERS and changes an account, that
 * the person it happened to can read why and contest it, that upholding the
 * complaint produces a superseding decision, and that the surface then stops
 * saying they are restricted.
 *
 * A vertical whose parts each pass and whose chain does not is a vertical that
 * passes its tests and fails its user. This walks the chain once, through the
 * real HTTP surface wherever one exists and through the operator seam where one
 * deliberately does not.
 */

const databaseUrl = await provisionDatabase('velora_safety_lifecycle');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();
const config = testServerConfig({ USERS_PROFILE_MEDIA_STORAGE: 'local-test' });
const now = () => new Date();

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'lifecycle-test',
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
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

const configuredStorage = users.profileMediaStorage;
if (!(configuredStorage instanceof LocalTestProfileMediaStorage)) {
  throw new Error('Lifecycle tests expect the development storage adapter');
}
const storage: LocalTestProfileMediaStorage = configuredStorage;
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

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

/** An onboarded consumer in active standing, which is what can be restricted. */
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
  const [media] = await rowsOf<{ storage_key: string }>(
    database.sql`select storage_key from users_profile_media where id = ${mediaId}`,
  );
  storage.put(media?.storage_key ?? '', jpegBytes);
  await post('/v1/users/me/profile/media/completion', { mediaId });
  return { ...session, id };
}

async function accountStatus(id: string): Promise<string> {
  const [row] = await rowsOf<{ status: string }>(
    database.sql`select status from users_accounts where id = ${id}`,
  );
  return row?.status ?? 'missing';
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('a report becomes a decision, and a complaint undoes it', () => {
  it('walks the whole chain and leaves every record behind it', async () => {
    const reporter = await consumer('lifecycle-reporter@velora.test');
    const subject = await consumer('lifecycle-subject@velora.test');

    // 1. Somebody reports somebody. The narrative is theirs and is never
    //    echoed back on any surface.
    const filed = await handle(
      request('/v1/safety/reports', reporter, {
        body: {
          clientReportId: 'lifecycle-0001',
          detail: 'what the reporter wrote',
          reasonCode: 'harassment',
          target: { accountId: subject.id, type: 'consumer_account' },
        },
        method: 'POST',
      }),
    );
    expect(filed.status).toBe(200);
    // The person reported is told nothing at all.
    expect(await accountStatus(subject.id)).toBe('active');

    // 2. The report opened a case, and is evidence in it.
    const [opened] = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${subject.id}`,
    );
    if (opened === undefined) throw new Error('no case opened');
    const detail = await safety.moderation.caseDetail(opened.id);
    expect(detail?.reports).toHaveLength(1);
    expect(detail?.evidence).toHaveLength(1);
    expect(detail?.evidence[0]?.kind).toBe('report');

    // 3. A reviewer claims it, records what they thought, and decides.
    const claimed = await safety.moderation.claimCase({
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
    });
    if (claimed.kind !== 'recorded') throw new Error('claim failed');
    await safety.moderation.recordEvidence({
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidence: { kind: 'operator_note', note: 'Spoke to the reporter.' },
    });
    const cited = (await safety.moderation.caseEvidence(opened.id)).map(
      (entry) => entry.id,
    );
    const decided = await safety.moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds: cited,
      expectedVersion: claimed.case.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('decision failed');

    // 4. The decision reached USERS. The account is restricted, the case left
    //    the queue as decided, and the report it carried is resolved.
    expect(await accountStatus(subject.id)).toBe('restricted');
    const [settled] = await rowsOf<{ state: string; version: number }>(
      database.sql`select state, version from safety_cases where id = ${opened.id}`,
    );
    expect(settled?.state).toBe('decided');
    const [report] = await rowsOf<{ state: string }>(
      database.sql`select state from safety_reports`,
    );
    expect(report?.state).toBe('actioned');

    // 5. The person it happened to can read why, and it says the category and
    //    the scope and nothing else.
    const standing = await handle(request('/v1/safety/standing', subject));
    const statements = (await standing.json()) as {
      statements: { appealable: boolean; decisionId: string }[];
    };
    expect(statements.statements).toHaveLength(1);
    expect(statements.statements[0]).toMatchObject({
      appealable: true,
      decisionId: decided.decision.id,
    });

    // 6. They contest it.
    const complained = await handle(
      request('/v1/safety/appeals', subject, {
        body: {
          decisionId: decided.decision.id,
          statement: 'This was not me.',
        },
        method: 'POST',
      }),
    );
    expect(complained.status).toBe(200);
    const appeal = (await complained.json()) as { id: string };

    // 7. A person answers it, and upholding produces a superseding decision
    //    rather than an edit of the first.
    const [open] = await safety.appeals.openAppeals();
    if (open === undefined) throw new Error('no appeal to answer');
    const reviewed = await safety.appeals.beginReview({
      appealId: open.id,
      expectedVersion: open.version,
    });
    if (reviewed.kind !== 'recorded') throw new Error('review failed');
    const reversal = await safety.moderation.decideCase({
      action: 'revoke_restriction',
      actorReference: 'session:reviewer-b',
      caseId: opened.id,
      evidenceIds: cited,
      expectedVersion: settled?.version ?? 0,
      reasonCode: 'platform_integrity',
      scope: 'account_restriction',
      supersedesDecisionId: decided.decision.id,
    });
    if (reversal.kind !== 'recorded') throw new Error('reversal failed');
    const upheld = await safety.appeals.uphold({
      appealId: open.id,
      expectedVersion: reviewed.appeal.version,
      outcomeDecisionId: reversal.decision.id,
      reviewerActorReference: 'session:reviewer-b',
    });
    expect(upheld.kind).toBe('recorded');

    // 8. The account is back, and the surface stops saying otherwise.
    expect(await accountStatus(subject.id)).toBe('active');
    const after = await handle(request('/v1/safety/standing', subject));
    expect((await after.clone().json()) as { statements: unknown[] }).toEqual({
      statements: [],
    });

    // 9. And nothing was erased on the way. Every record of what happened is
    //    still there, including the decision that was overturned.
    const counts = await rowsOf<{
      appeals: number;
      decisions: number;
      enforcements: number;
      evidence: number;
      reports: number;
    }>(
      database.sql`select
        (select count(*)::int from safety_reports) as reports,
        (select count(*)::int from safety_evidence) as evidence,
        (select count(*)::int from safety_decisions) as decisions,
        (select count(*)::int from safety_enforcements) as enforcements,
        (select count(*)::int from safety_appeals) as appeals`,
    );
    expect(counts[0]).toEqual({
      appeals: 1,
      // The restriction and the reversal. The first was never edited.
      decisions: 2,
      // The imposition and the lift, likewise.
      enforcements: 2,
      // The report, plus the reviewer's note.
      evidence: 2,
      reports: 1,
    });
    const [original] = await rowsOf<{ action: string; scope: string }>(
      database.sql`select action, scope from safety_decisions
        where id = ${decided.decision.id}`,
    );
    expect(original).toEqual({
      action: 'restrict_capability',
      scope: 'account_restriction',
    });

    // 10. The reporter's narrative, the reviewer's note, and the appellant's
    //     statement were each stored and none of them ever left the domain.
    const mine = await handle(request('/v1/safety/appeals', subject));
    const listed = (await mine.clone().json()) as {
      appeals: { decisionId: string; id: string; state: string }[];
    };
    expect(listed.appeals).toHaveLength(1);
    expect(listed.appeals[0]).toMatchObject({
      decisionId: decided.decision.id,
      id: appeal.id,
      state: 'upheld',
    });
    const filedByMe = await handle(request('/v1/safety/reports', reporter));
    const published = [
      await after.clone().text(),
      await mine.text(),
      await filedByMe.text(),
    ].join('\n');
    expect(published).not.toContain('what the reporter wrote');
    expect(published).not.toContain('Spoke to the reporter');
    expect(published).not.toContain('This was not me');
    expect(published).not.toContain(reporter.id);
  });
});
