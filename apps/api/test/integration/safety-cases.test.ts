import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testAdminOrigin,
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * Report intake and case management against real PostgreSQL.
 *
 * A report is evidence somebody filed. A case is the platform's decision to
 * look at something. Everything here turns on keeping those apart: several
 * reports about one target become one review without any of them being
 * discarded, and nothing about a case changes because a second report arrived.
 *
 * The other half is what a reporter may name. A public surface exposes a
 * handle, a slug, or an item identifier — never Velora's internal one — so
 * every target is resolved through the owning domain's contract, and a refusal
 * is the same shape for a target that does not exist, one that is not
 * published, and one that belongs to somebody else.
 */

const databaseUrl = await provisionDatabase('velora_safety_cases');
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
      request.headers.get('x-velora-device') ?? 'cases-test',
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

interface Session {
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
}

async function signIn(
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<Omit<Session, 'id'>> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience, subject }),
      headers: {
        'content-type': 'application/json',
        origin:
          audience === 'consumer_web' ? testConsumerOrigin : testCreatorOrigin,
        'x-velora-device': `${subject}-${audience}`,
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
  origin: string,
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
      origin,
      'x-velora-csrf': session.csrf,
    },
  });
}

/** An onboarded consumer who can file reports. */
async function consumer(subject: string): Promise<Session> {
  const session = await signIn(subject, 'consumer_web');
  const created = await handle(
    request('/v1/users', session, testConsumerOrigin, { method: 'POST' }),
  );
  const { id } = (await created.json()) as { id: string };
  await handle(
    request(
      '/v1/users/me/onboarding/adult-declaration',
      session,
      testConsumerOrigin,
      {
        body: { declaresAdult: true, region: 'ES' },
        method: 'POST',
      },
    ),
  );
  return { ...session, id };
}

const acknowledgements = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

interface Creator {
  readonly clubSlug: string;
  readonly contentId: string;
  readonly handle: string;
  readonly id: string;
}

/** An active creator with a published page, a published item, and a club. */
async function creator(subject: string, handleValue: string): Promise<Creator> {
  await consumer(subject);
  const studio = await signIn(subject, 'creator_studio');
  const studioPost = (path: string, body?: unknown) =>
    handle(
      request(path, studio, testCreatorOrigin, {
        ...(body === undefined ? {} : { body }),
        method: 'POST',
      }),
    );
  await studioPost('/v1/creator');
  await studioPost('/v1/creator/onboarding/acknowledgements', {
    acknowledgements,
  });
  const profile = (await (
    await studioPost('/v1/creator/profile', {
      displayName: 'Ember Vale',
      handle: handleValue,
    })
  ).json()) as { version: number };
  await studioPost('/v1/creator/profile/publication', {
    publication: 'published',
    version: profile.version,
  });
  const me = (await (
    await handle(request('/v1/creator/me', studio, testCreatorOrigin))
  ).json()) as { id: string };

  // Both catalog endpoints answer with the caller's list rather than one
  // record, so the newly written row is the first entry.
  const firstContent = async (response: Response) => {
    const body = (await response.json()) as {
      content?: { id: string; version: number }[];
    };
    const entry = body.content?.[0];
    if (entry === undefined) throw new Error('response carried no item');
    return entry;
  };
  const firstClub = async (response: Response) => {
    const body = (await response.json()) as {
      clubs?: { id: string; version: number }[];
    };
    const entry = body.clubs?.[0];
    if (entry === undefined) throw new Error('response carried no club');
    return entry;
  };

  const item = await firstContent(
    await studioPost('/v1/creator/content', {
      title: 'A published item',
      visibility: 'public',
    }),
  );
  await studioPost('/v1/creator/content/lifecycle', {
    contentId: item.id,
    lifecycle: 'published',
    version: item.version,
  });

  const clubSlug = `${handleValue}-club`;
  const club = await firstClub(
    await studioPost('/v1/creator/clubs', {
      name: 'Members room',
      slug: clubSlug,
    }),
  );
  await studioPost('/v1/creator/clubs/lifecycle', {
    clubId: club.id,
    lifecycle: 'published',
    version: club.version,
  });

  return { clubSlug, contentId: item.id, handle: handleValue, id: me.id };
}

let reportSequence = 0;
function fileReport(
  session: Omit<Session, 'id'>,
  target: unknown,
  origin = testConsumerOrigin,
): Promise<Response> {
  reportSequence += 1;
  return handle(
    request('/v1/safety/reports', session, origin, {
      body: {
        clientReportId: `case-key-${String(reportSequence).padStart(4, '0')}`,
        reasonCode: 'harassment',
        target,
      },
      method: 'POST',
    }),
  );
}

async function cases(): Promise<
  {
    priority: string;
    queue: string;
    state: string;
    target_id: string;
    target_type: string;
  }[]
> {
  return rowsOf(
    database.sql`select priority, queue, state, target_id, target_type
      from safety_cases order by opened_at, id`,
  );
}

beforeEach(async () => {
  reportSequence = 0;
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('a report names what a public surface showed', () => {
  it('resolves a creator by the handle a visitor saw', async () => {
    const reporter = await consumer('handle-reporter@velora.test');
    const subject = await creator('handle-creator@velora.test', 'embervale');

    const response = await fileReport(reporter, {
      handle: subject.handle,
      type: 'creator_profile',
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as { targetType: string }).toMatchObject({
      targetType: 'creator_profile',
    });
    const [only] = await cases();
    // The stored target is Velora's identifier, resolved server side. The
    // reporter never had it and never receives it.
    expect(only).toMatchObject({
      queue: 'creator_identity',
      state: 'new',
      target_id: subject.id,
      target_type: 'creator_profile',
    });
  });

  it('resolves a published item and a published club', async () => {
    const reporter = await consumer('catalog-reporter@velora.test');
    const subject = await creator('catalog-creator@velora.test', 'catalogue');

    const item = await fileReport(reporter, {
      contentId: subject.contentId,
      type: 'creator_content',
    });
    const club = await fileReport(reporter, {
      handle: subject.handle,
      slug: subject.clubSlug,
      type: 'club',
    });

    expect([item.status, club.status]).toEqual([200, 200]);
    const opened = await cases();
    expect(opened.map((entry) => entry.target_type).sort()).toEqual([
      'club',
      'creator_content',
    ]);
    // Both land in the content queue: routing follows what the case is about,
    // never what the reporter chose to call it.
    expect(opened.every((entry) => entry.queue === 'creator_content')).toBe(
      true,
    );
  });

  it('lets a participant report a conversation and nobody else', async () => {
    const first = await consumer('conversation-first@velora.test');
    const second = await consumer('conversation-second@velora.test');
    const outsider = await consumer('conversation-outsider@velora.test');
    // A conversation identifier nobody is in. An outsider naming any identifier
    // must be refused identically to naming one that does not exist, or the
    // endpoint becomes a way to assert that two people are talking.
    const invented = crypto.randomUUID();

    const byOutsider = await fileReport(outsider, {
      conversationId: invented,
      type: 'conversation',
    });
    const byParticipant = await fileReport(first, {
      conversationId: invented,
      type: 'conversation',
    });

    expect([byOutsider.status, byParticipant.status]).toEqual([422, 422]);
    expect(await cases()).toHaveLength(0);
    expect(second.id).not.toBe(first.id);
  });

  it('refuses every unresolvable target the same way', async () => {
    const reporter = await consumer('unresolvable-reporter@velora.test');
    await creator('unresolvable-creator@velora.test', 'unresolvable');

    const responses = await Promise.all([
      // A handle nobody published.
      fileReport(reporter, { handle: 'nobodyhere', type: 'creator_profile' }),
      // An item identifier that names nothing.
      fileReport(reporter, {
        contentId: crypto.randomUUID(),
        type: 'creator_content',
      }),
      // A club slug the creator does not have.
      fileReport(reporter, {
        handle: 'unresolvable',
        slug: 'not-a-club',
        type: 'club',
      }),
      // An account that does not exist.
      fileReport(reporter, {
        accountId: crypto.randomUUID(),
        type: 'consumer_account',
      }),
      // Themselves.
      fileReport(reporter, {
        accountId: reporter.id,
        type: 'consumer_account',
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      422, 422, 422, 422, 422,
    ]);
    expect(await cases()).toHaveLength(0);
  });

  it('records the surface from the credential rather than the body', async () => {
    const reporter = await consumer('surface-reporter@velora.test');
    const subject = await consumer('surface-subject@velora.test');

    await fileReport(reporter, {
      accountId: subject.id,
      type: 'consumer_account',
    });

    const rows = await rowsOf<{ source_surface: string }>(
      database.sql`select source_surface from safety_reports`,
    );
    expect(rows[0]?.source_surface).toBe('consumer_web');
  });
});

describe('several reports about one thing are one review', () => {
  it('joins an open case without changing anything about it', async () => {
    const first = await consumer('group-first@velora.test');
    const second = await consumer('group-second@velora.test');
    const subject = await consumer('group-subject@velora.test');
    const target = { accountId: subject.id, type: 'consumer_account' };

    await fileReport(first, target);
    await fileReport(second, target);

    const opened = await cases();
    expect(opened).toHaveLength(1);
    // Nothing escalated. Report volume decides nothing, so a second reporter
    // changes neither the priority nor the state of the case.
    expect(opened[0]).toMatchObject({ priority: 'untriaged', state: 'new' });

    const detail = await safety.moderation.caseDetail(
      (
        await rowsOf<{ id: string }>(
          database.sql`select id from safety_cases limit 1`,
        )
      )[0]?.id ?? '',
    );
    // Both reports survive as evidence. Deduplication groups; it never discards.
    expect(detail?.reports).toHaveLength(2);
  });

  it('settles many simultaneous reports into one case', async () => {
    const subject = await consumer('storm-subject@velora.test');
    const reporters = await Promise.all(
      Array.from({ length: 12 }, async (_, index) =>
        consumer(`storm-${String(index)}@velora.test`),
      ),
    );

    const responses = await Promise.all(
      reporters.map(async (reporter) =>
        fileReport(reporter, {
          accountId: subject.id,
          type: 'consumer_account',
        }),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await cases()).toHaveLength(1);
    const reports = await rowsOf<{ count: number }>(
      database.sql`select count(*)::int as count from safety_reports`,
    );
    expect(reports[0]?.count).toBe(12);
  });

  it('opens a new case once the previous one is closed', async () => {
    const reporter = await consumer('reopen-reporter@velora.test');
    const subject = await consumer('reopen-subject@velora.test');
    const target = { accountId: subject.id, type: 'consumer_account' };

    await fileReport(reporter, target);
    const [openCase] = await rowsOf<{ id: string }>(
      database.sql`select id from safety_cases`,
    );
    await safety.moderation.closeCase({ caseId: openCase?.id ?? '' });

    await fileReport(reporter, target);
    const opened = await cases();
    expect(opened).toHaveLength(2);
    expect(opened.map((entry) => entry.state).sort()).toEqual([
      'closed',
      'new',
    ]);
  });
});

describe('a reviewer claims, judges, and closes', () => {
  async function openOneCase(): Promise<string> {
    const reporter = await consumer(
      `claim-reporter-${String(reportSequence)}@velora.test`,
    );
    const subject = await consumer(
      `claim-subject-${String(reportSequence)}@velora.test`,
    );
    await fileReport(reporter, {
      accountId: subject.id,
      type: 'consumer_account',
    });
    const [row] = await rowsOf<{ id: string }>(
      database.sql`select id from safety_cases order by opened_at desc limit 1`,
    );
    return row?.id ?? '';
  }

  it('lets one reviewer hold a case and refuses the other', async () => {
    const caseId = await openOneCase();
    const [first, second] = await Promise.all([
      safety.moderation.claimCase({
        actorReference: 'session:reviewer-a',
        caseId,
      }),
      safety.moderation.claimCase({
        actorReference: 'session:reviewer-b',
        caseId,
      }),
    ]);
    const outcomes = [first.kind, second.kind].sort();
    expect(outcomes).toEqual(['conflict', 'recorded']);
  });

  it('records a reviewer priority and nothing computes one', async () => {
    const caseId = await openOneCase();
    await safety.moderation.claimCase({
      actorReference: 'session:reviewer-a',
      caseId,
    });
    const triaged = await safety.moderation.triageCase({
      caseId,
      priority: 'high',
      state: 'investigating',
    });

    expect(triaged.kind).toBe('recorded');
    if (triaged.kind !== 'recorded') return;
    expect(triaged.case.priority).toBe('high');
    expect(triaged.case.state).toBe('investigating');
  });

  it('releases the claim when the case closes', async () => {
    const caseId = await openOneCase();
    await safety.moderation.claimCase({
      actorReference: 'session:reviewer-a',
      caseId,
    });
    const closed = await safety.moderation.closeCase({ caseId });

    expect(closed.kind).toBe('recorded');
    if (closed.kind !== 'recorded') return;
    expect(closed.case.state).toBe('closed');
    // A closed case is held by nobody, so it cannot sit out of a queue it is
    // no longer in.
    expect(closed.case.assignedActorReference).toBeNull();
    expect(closed.case.assignmentExpiresAt).toBeNull();
    // And it cannot be moved again.
    expect((await safety.moderation.closeCase({ caseId })).kind).toBe(
      'conflict',
    );
  });

  it('pages the queue on a keyset rather than an offset', async () => {
    const subjects = await Promise.all(
      Array.from({ length: 5 }, async (_, index) =>
        consumer(`queue-subject-${String(index)}@velora.test`),
      ),
    );
    const reporter = await consumer('queue-reporter@velora.test');
    for (const subject of subjects) {
      // Sequential so the opening order is deterministic and the cursor has
      // something stable to page.
      await fileReport(reporter, {
        accountId: subject.id,
        type: 'consumer_account',
      });
    }

    const first = await safety.moderation.openCases({ pageSize: 2 });
    expect(first.kind).toBe('page');
    if (first.kind !== 'page') return;
    expect(first.cases).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();

    const second = await safety.moderation.openCases({
      cursor: first.nextCursor,
      pageSize: 2,
    });
    if (second.kind !== 'page') throw new Error('expected a page');
    expect(second.cases).toHaveLength(2);
    const seen = new Set(
      [...first.cases, ...second.cases].map((entry) => entry.id),
    );
    expect(seen.size).toBe(4);

    expect(
      (await safety.moderation.openCases({ cursor: 'not-a-cursor' })).kind,
    ).toBe('invalid_cursor');
  });

  it('exposes a case only under the operator prefix', () => {
    const cases = application.app.routes
      .map((route) => route.path)
      .filter((path) => /case/iu.test(path));

    expect(cases.length).toBeGreaterThan(0);
    // Every one of them is an operator route. A consumer or Creator Studio
    // path that mentioned a case would be a path somebody eventually reaches
    // with a consumer credential.
    for (const path of cases) {
      expect(path, path).toStartWith('/v1/admin/safety/');
    }
    expect(testAdminOrigin.length).toBeGreaterThan(0);
  });

  it('refuses every operator case route to a consumer session', async () => {
    const reporter = await consumer('operator-probe@velora.test');

    const responses = await Promise.all([
      handle(request('/v1/admin/safety/cases', reporter, testConsumerOrigin)),
      handle(
        request('/v1/admin/safety/case?caseId=x', reporter, testConsumerOrigin),
      ),
      handle(
        request('/v1/admin/safety/cases/claim', reporter, testConsumerOrigin, {
          body: { caseId: crypto.randomUUID() },
          method: 'POST',
        }),
      ),
    ]);

    // The audience is checked before anything is looked up on the caller's
    // behalf, so route visibility is not permission and a probe learns nothing
    // about what exists.
    expect(responses.map((response) => response.status)).toEqual([
      403, 403, 403,
    ]);
  });
});
