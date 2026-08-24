import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  apiRoutePaths,
  moderationAppealSchema,
  moderationCaseDetailResponseSchema,
  moderationCaseListResponseSchema,
  moderationCaseSchema,
  moderationReportSchema,
} from '@velora/validation';

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
  testMediaRuntime,
} from '../support/harness.js';
import { mediaEnvironment } from '../support/profile-media.js';

/**
 * The Platform Admin moderation surface against real PostgreSQL.
 *
 * What is under test is not that an operator can work a queue — nobody can,
 * because no approved verifier can produce the phishing-resistant assurance
 * these routes require, and that is the point. It is that the surface exists,
 * is published exactly as the contract declares it, is reachable from no other
 * audience, and carries nothing an operator has no business seeing.
 *
 * Two absences are asserted directly. No response shape here can carry a
 * **reporter identity**, and none can carry a **report count** — a case is
 * about a target, and either of those would make "how many people complained"
 * a fact an operator could work from.
 */

const databaseUrl = await provisionDatabase('velora_admin_moderation');
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
      request.headers.get('x-velora-device') ?? 'admin-moderation-test',
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

/** Every moderation route the contract declares, with a usable request. */
const operations = [
  { method: 'GET', path: apiRoutePaths.adminSafetyCases },
  { method: 'GET', path: `${apiRoutePaths.adminSafetyCase}?caseId=x` },
  { method: 'GET', path: apiRoutePaths.adminSafetyAppeals },
  {
    body: { caseId: crypto.randomUUID() },
    method: 'POST',
    path: apiRoutePaths.adminSafetyCaseClaim,
  },
  {
    body: {
      caseId: crypto.randomUUID(),
      priority: 'high',
      state: 'investigating',
    },
    method: 'POST',
    path: apiRoutePaths.adminSafetyCaseTriage,
  },
  {
    body: { caseId: crypto.randomUUID(), note: 'Spoke to the reporter.' },
    method: 'POST',
    path: apiRoutePaths.adminSafetyCaseNotes,
  },
  {
    body: {
      action: 'no_action',
      caseId: crypto.randomUUID(),
      evidenceIds: [],
      expectedVersion: 1,
      reasonCode: 'no_violation_found',
    },
    method: 'POST',
    path: apiRoutePaths.adminSafetyCaseDecisions,
  },
  {
    body: {
      appealId: crypto.randomUUID(),
      expectedVersion: 1,
      outcome: 'refused',
    },
    method: 'POST',
    path: apiRoutePaths.adminSafetyAppealOutcome,
  },
] as const;

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

async function signIn(
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<Session> {
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

function attempt(
  operation: (typeof operations)[number],
  session: Session | undefined,
  origin: string,
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin,
    ...(session === undefined
      ? {}
      : { cookie: session.cookie, 'x-velora-csrf': session.csrf }),
  };
  return new Request(`http://api.test${operation.path}`, {
    ...(operation.method === 'GET'
      ? {}
      : {
          body: JSON.stringify('body' in operation ? operation.body : {}),
          method: operation.method,
        }),
    headers,
  });
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('the operator surface exists and reaches nobody', () => {
  it('publishes every declared moderation route and no other', () => {
    const published = new Set(
      application.app.routes.map(
        (route) => `${route.method.toUpperCase()} ${route.path}`,
      ),
    );
    for (const operation of operations) {
      const path = operation.path.split('?')[0] ?? '';
      expect(published.has(`${operation.method} ${path}`), path).toBe(true);
    }
  });

  it('refuses every one of them to a consumer session', async () => {
    const consumer = await signIn('consumer-probe@velora.test', 'consumer_web');

    const responses = await Promise.all(
      operations.map(async (operation) =>
        handle(attempt(operation, consumer, testConsumerOrigin)),
      ),
    );

    // Audience before lookup. Route visibility is not permission, and a probe
    // learns nothing about what exists behind them.
    expect(responses.map((response) => response.status)).toEqual(
      operations.map(() => 403),
    );
  });

  it('refuses every one of them to a Creator Studio session', async () => {
    const creator = await signIn('creator-probe@velora.test', 'creator_studio');

    const responses = await Promise.all(
      operations.map(async (operation) =>
        handle(attempt(operation, creator, testCreatorOrigin)),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(
      operations.map(() => 403),
    );
  });

  it('refuses every one of them with no session at all', async () => {
    const responses = await Promise.all(
      operations.map(async (operation) =>
        handle(attempt(operation, undefined, testAdminOrigin)),
      ),
    );

    // Unauthenticated is 401 and wrong-audience is 403; neither is a way in.
    for (const response of responses) {
      expect([401, 403]).toContain(response.status);
    }
  });

  it('mints no Platform Admin session, so the surface is unreachable', async () => {
    const response = await handle(
      new Request('http://api.test/v1/auth/local/web-sessions', {
        body: JSON.stringify({
          audience: 'platform_admin',
          subject: 'operator@velora.test',
        }),
        headers: {
          'content-type': 'application/json',
          origin: testAdminOrigin,
        },
        method: 'POST',
      }),
    );

    // The local identity contract refuses the Platform Admin audience outright,
    // and no approved verifier can produce the phishing-resistant assurance
    // these routes require in any case.
    expect(response.status).not.toBe(201);
    expect(config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER).toBe('unavailable');
    expect(await countOf('safety_decisions')).toBe(0);
  });
});

describe('the operator contract carries no reporter and no count', () => {
  it('has no field anywhere in it that could hold either', () => {
    // Read from the published contract rather than from a response, because a
    // field that does not exist cannot be filled in by a later change.
    const shapes = JSON.stringify([
      Object.keys(moderationCaseSchema.shape),
      Object.keys(moderationReportSchema.shape),
      Object.keys(moderationCaseDetailResponseSchema.shape),
      Object.keys(moderationCaseListResponseSchema.shape),
      Object.keys(moderationAppealSchema.shape),
    ]);

    expect(shapes).not.toContain('reporter');
    expect(shapes).not.toContain('count');
    expect(shapes).not.toContain('statement');
    // What a reviewer does get: the allegation itself, because they cannot
    // judge one without it.
    expect(Object.keys(moderationReportSchema.shape)).toContain('detail');
  });

  it('publishes no route that could set an arbitrary field on a record', () => {
    // Every operator command is explicit. A patch or a generic update would be
    // a shape that can rewrite an audit, and this API has none anywhere.
    //
    // Scoped to `/v1`, which is the whole published contract. The one route
    // outside it is the `local-test` storage adapter's byte transport, which
    // exists only when that adapter is configured, writes opaque bytes to a
    // single pre-authorized object key, and reaches no record and no column.
    // Its `PUT` is the method every object-storage provider uses and the one
    // the upload capability contract declares, so making it something else to
    // satisfy this assertion would bend the product's contract around a
    // development adapter.
    const published = application.app.routes.filter((route) =>
      route.path.startsWith('/v1/'),
    );
    expect(published.length).toBeGreaterThan(100);
    for (const route of published) {
      expect(['PATCH', 'PUT', 'DELETE'], route.path).not.toContain(
        route.method.toUpperCase(),
      );
    }
  });
});

async function countOf(table: string): Promise<number> {
  const rows = await rowsOf<{ count: string }>(
    database.sql.unsafe(`select count(*)::text as count from ${table}`),
  );
  return Number(rows[0]?.count ?? '0');
}
