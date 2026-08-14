import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import type { ServerConfig } from '@velora/config/server';
import { apiRoutePaths, csrfHeader } from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { LocalTestRecoveryDelivery } from '../../src/auth/recovery.js';
import type { HealthDependency } from '../../src/database/database.service.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testConsumerOrigin,
  testConsumerRuntimes,
  testCreatorOrigin,
  testDatabaseAdmission,
  testForeignOrigin,
  testServerConfig,
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_auth_api');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy: HealthDependency = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

interface Harness {
  close(): Promise<void>;
  handle(request: Request): Promise<Response>;
  readonly logs: unknown[];
  readonly recoveryDelivery: LocalTestRecoveryDelivery;
}

function harness(options?: {
  readonly config?: ServerConfig;
  readonly now?: () => Date;
}): Harness {
  const logs: unknown[] = [];
  const logger = silentLogger(logs);
  const config = options?.config ?? testServerConfig();
  const auth = createAuthRuntime({
    config,
    database: database.drizzle,
    logger,
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      ...(options?.now === undefined ? {} : { now: options.now }),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'api-test',
    },
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: database.drizzle,
    logger,
  });
  const application = createApplication({
    config,
    dependencies: {
      auth,
      ...testConsumerRuntimes({
        config,
        database: database.drizzle,
        logger,
        users,
      }),
      database: healthy,
      databaseAdmission: testDatabaseAdmission(),
      ephemeralRedis: healthy,
      logger,
      queueRedis: healthy,
      users,
    },
  });
  if (!(auth.recoveryDelivery instanceof LocalTestRecoveryDelivery)) {
    throw new Error('Test harness expects the local recovery sink');
  }
  return {
    close: () => application.close(),
    handle: (request) => application.app.handle(request),
    logs,
    recoveryDelivery: auth.recoveryDelivery,
  };
}

function cookieJar(response: Response): Map<string, string> {
  const jar = new Map<string, string>();
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (pair === undefined || separator === -1) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return jar;
}

function cookieHeaderFrom(jar: Map<string, string>): string {
  return [...jar]
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function browserRequest(
  path: string,
  init: {
    readonly body?: unknown;
    readonly cookies?: string;
    readonly csrf?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
    readonly origin?: string | null;
  } = {},
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    ...init.headers,
  };
  const origin = init.origin === undefined ? testConsumerOrigin : init.origin;
  if (origin !== null) headers.origin = origin;
  if (init.cookies !== undefined) headers.cookie = init.cookies;
  if (init.csrf !== undefined) headers[csrfHeader] = init.csrf;
  return new Request(`http://api.test${path}`, {
    headers,
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function signInWeb(
  application: Harness,
  options: {
    readonly audience?: 'consumer_web' | 'creator_studio';
    readonly headers?: Readonly<Record<string, string>>;
    readonly origin?: string;
    readonly subject: string;
  },
) {
  const audience = options.audience ?? 'consumer_web';
  const response = await application.handle(
    browserRequest(apiRoutePaths.localWebSession, {
      body: { audience, subject: options.subject },
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      origin:
        options.origin ??
        (audience === 'consumer_web' ? testConsumerOrigin : testCreatorOrigin),
    }),
  );
  const jar = cookieJar(response);
  const body = (await response.json()) as { csrfToken?: string };
  return {
    cookies: cookieHeaderFrom(jar),
    csrfToken: body.csrfToken ?? '',
    jar,
    response,
  };
}

async function signInMobile(
  application: Harness,
  subject: string,
  installationId = 'installation-api-0001',
) {
  const response = await application.handle(
    browserRequest(apiRoutePaths.localMobileSession, {
      body: { installationId, subject },
      origin: null,
    }),
  );
  return {
    response,
    tokens: (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    },
  };
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('AUTH API surface', () => {
  it('establishes a browser session and sets the ADR-0017 cookie', async () => {
    const application = harness();
    try {
      const { response } = await signInWeb(application, {
        subject: 'api-web@velora.test',
      });
      expect(response.status).toBe(201);

      const cookies = response.headers.getSetCookie();
      const session = cookies.find((cookie) =>
        cookie.startsWith('__Host-velora_consumer_web_session='),
      );
      expect(session).toBeDefined();
      for (const attribute of [
        'Path=/',
        'Secure',
        'HttpOnly',
        'SameSite=Lax',
      ]) {
        expect(session).toContain(attribute);
      }
      expect(session?.toLowerCase()).not.toContain('domain=');

      const csrf = cookies.find((cookie) =>
        cookie.startsWith('__Host-velora_consumer_web_csrf='),
      );
      expect(csrf).toBeDefined();
      // The CSRF companion must be readable by the surface's own script.
      expect(csrf).not.toContain('HttpOnly');
    } finally {
      await application.close();
    }
  });

  it('restores the session from the cookie and reports server-derived state', async () => {
    const application = harness();
    try {
      const signedIn = await signInWeb(application, {
        subject: 'api-restore@velora.test',
      });
      const restored = await application.handle(
        browserRequest(apiRoutePaths.session, { cookies: signedIn.cookies }),
      );
      expect(restored.status).toBe(200);
      const body = (await restored.json()) as Record<string, unknown>;
      expect(body.audience).toBe('consumer_web');
      expect(body.assurance).toBe('single_factor');
      // Session status never re-issues a credential.
      expect(body.csrfToken).toBeUndefined();
      expect(Object.keys(body)).not.toContain('sessionId');
    } finally {
      await application.close();
    }
  });

  it('answers an anonymous session request with a generic 401', async () => {
    const application = harness();
    try {
      const response = await application.handle(
        browserRequest(apiRoutePaths.session),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: 'AUTH_REQUIRED',
        message: 'Request failed',
      });
    } finally {
      await application.close();
    }
  });

  it('clears a stale cookie instead of leaving the browser stuck', async () => {
    const application = harness();
    try {
      const signedIn = await signInWeb(application, {
        subject: 'api-stale@velora.test',
      });
      await application.handle(
        browserRequest(apiRoutePaths.logout, {
          cookies: signedIn.cookies,
          csrf: signedIn.csrfToken,
          method: 'POST',
        }),
      );
      const response = await application.handle(
        browserRequest(apiRoutePaths.session, { cookies: signedIn.cookies }),
      );
      expect(response.status).toBe(401);
      const cleared = response.headers.getSetCookie();
      expect(
        cleared.some(
          (cookie) =>
            cookie.startsWith('__Host-velora_consumer_web_session=') &&
            cookie.includes('Max-Age=0'),
        ),
      ).toBe(true);
    } finally {
      await application.close();
    }
  });

  it.each([
    ['missing body', undefined],
    ['unknown audience', { audience: 'platform_admin', subject: 'x@y.test' }],
    [
      'unknown field',
      { audience: 'consumer_web', extra: 1, subject: 'x@y.test' },
    ],
    [
      'oversize subject',
      { audience: 'consumer_web', subject: 'a'.repeat(400) },
    ],
    ['wrong types', { audience: 5, subject: null }],
  ])('refuses %s with one generic validation failure', async (_label, body) => {
    const application = harness();
    try {
      const response = await application.handle(
        browserRequest(apiRoutePaths.localWebSession, {
          body: body ?? {},
          method: 'POST',
        }),
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Request failed',
      });
    } finally {
      await application.close();
    }
  });

  it('refuses a body that is not JSON at all', async () => {
    const application = harness();
    try {
      const response = await application.handle(
        new Request(`http://api.test${apiRoutePaths.localWebSession}`, {
          body: 'not json',
          headers: {
            'content-type': 'application/json',
            origin: testConsumerOrigin,
          },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(422);
    } finally {
      await application.close();
    }
  });

  it('refuses an AUTH body beyond the AUTH-specific limit', async () => {
    const application = harness();
    try {
      const response = await application.handle(
        browserRequest(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'a'.repeat(8_000) },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(422);
    } finally {
      await application.close();
    }
  });

  it('rate limits repeated authentication attempts from one requester', async () => {
    const application = harness();
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const response = await application.handle(
          browserRequest(apiRoutePaths.localWebSession, {
            body: {
              audience: 'consumer_web',
              subject: `flood-${String(attempt)}@velora.test`,
            },
            headers: { 'x-velora-device': 'flooding-device' },
            method: 'POST',
          }),
        );
        statuses.push(response.status);
      }
      expect(
        statuses.filter((status) => status === 429).length,
      ).toBeGreaterThan(0);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await application.close();
    }
  });
});

describe('browser origin, Fetch Metadata, and CSRF defences', () => {
  it('accepts a state-changing request carrying valid origin and CSRF evidence', async () => {
    const application = harness();
    try {
      const signedIn = await signInWeb(application, {
        subject: 'csrf-valid@velora.test',
      });
      const response = await application.handle(
        browserRequest(apiRoutePaths.logout, {
          cookies: signedIn.cookies,
          csrf: signedIn.csrfToken,
          method: 'POST',
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'revoked' });
    } finally {
      await application.close();
    }
  });

  it.each([
    ['missing CSRF token', { omitCsrf: true }],
    [
      'wrong CSRF token',
      { csrf: 'v1.wrongwrongwrongwrongwrongwrongwrongwrongwr' },
    ],
    ['empty CSRF token', { csrf: '' }],
  ])('refuses global logout with %s', async (_label, variant) => {
    const application = harness();
    try {
      const signedIn = await signInWeb(application, {
        subject: 'csrf-missing@velora.test',
      });
      const response = await application.handle(
        browserRequest(apiRoutePaths.logoutAll, {
          cookies: signedIn.cookies,
          method: 'POST',
          ...('omitCsrf' in variant ? {} : { csrf: variant.csrf }),
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'AUTH_CSRF_REQUIRED',
      });

      // The session survived the refused attempt.
      const still = await application.handle(
        browserRequest(apiRoutePaths.session, { cookies: signedIn.cookies }),
      );
      expect(still.status).toBe(200);
    } finally {
      await application.close();
    }
  });

  it.each([
    ['a foreign origin', { origin: testForeignOrigin }],
    ['a malformed origin', { origin: 'not-an-origin' }],
    ['the literal null origin', { origin: 'null' }],
    ['no origin at all', { origin: null }],
  ])(
    'refuses a cookie-authenticated request from %s',
    async (_label, variant) => {
      const application = harness();
      try {
        const signedIn = await signInWeb(application, {
          subject: 'origin-attack@velora.test',
        });
        const response = await application.handle(
          browserRequest(apiRoutePaths.logoutAll, {
            cookies: signedIn.cookies,
            csrf: signedIn.csrfToken,
            method: 'POST',
            origin: variant.origin,
          }),
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          code: 'AUTH_ORIGIN_REJECTED',
        });
      } finally {
        await application.close();
      }
    },
  );

  it('refuses a cross-site Fetch Metadata signal even with a valid token', async () => {
    const application = harness();
    try {
      const signedIn = await signInWeb(application, {
        subject: 'fetch-metadata@velora.test',
      });
      const response = await application.handle(
        browserRequest(apiRoutePaths.logoutAll, {
          cookies: signedIn.cookies,
          csrf: signedIn.csrfToken,
          headers: { 'sec-fetch-site': 'cross-site' },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(403);
    } finally {
      await application.close();
    }
  });

  it('refuses to mint a consumer session from the Creator Studio origin', async () => {
    const application = harness();
    try {
      const response = await application.handle(
        browserRequest(apiRoutePaths.localWebSession, {
          body: {
            audience: 'consumer_web',
            subject: 'wrong-origin@velora.test',
          },
          origin: testCreatorOrigin,
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'AUTH_ORIGIN_REJECTED',
      });
    } finally {
      await application.close();
    }
  });

  it('answers a CORS preflight only for an allowlisted origin', async () => {
    const application = harness();
    try {
      const allowed = await application.handle(
        new Request(`http://api.test${apiRoutePaths.logout}`, {
          headers: {
            'access-control-request-method': 'POST',
            origin: testConsumerOrigin,
          },
          method: 'OPTIONS',
        }),
      );
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        testConsumerOrigin,
      );
      expect(allowed.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
      expect(allowed.headers.get('vary')).toBe('origin');

      const refused = await application.handle(
        new Request(`http://api.test${apiRoutePaths.logout}`, {
          headers: {
            'access-control-request-method': 'POST',
            origin: testForeignOrigin,
          },
          method: 'OPTIONS',
        }),
      );
      expect(refused.status).toBe(403);
      expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await application.close();
    }
  });

  it('never echoes a wildcard or a foreign origin on a real response', async () => {
    const application = harness();
    try {
      const response = await application.handle(
        browserRequest(apiRoutePaths.session, { origin: testForeignOrigin }),
      );
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(
        response.headers.get('access-control-allow-credentials'),
      ).toBeNull();
      expect(response.headers.get('vary')).toBe('origin');
    } finally {
      await application.close();
    }
  });
});

describe('Consumer Mobile API flow', () => {
  it('issues, refreshes, and rotates tokens over HTTP', async () => {
    const application = harness();
    try {
      const signedIn = await signInMobile(
        application,
        'mobile-api@velora.test',
      );
      expect(signedIn.response.status).toBe(201);
      // A bearer flow sets no cookie at all.
      expect(signedIn.response.headers.getSetCookie()).toEqual([]);

      const restored = await application.handle(
        browserRequest(apiRoutePaths.session, {
          headers: { authorization: `Bearer ${signedIn.tokens.accessToken}` },
          origin: null,
        }),
      );
      expect(restored.status).toBe(200);
      expect((await restored.json()) as Record<string, unknown>).toMatchObject({
        audience: 'consumer_mobile',
      });

      const refreshed = await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: signedIn.tokens.refreshToken },
          origin: null,
        }),
      );
      expect(refreshed.status).toBe(200);
      const rotated = (await refreshed.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      expect(rotated.refreshToken).not.toBe(signedIn.tokens.refreshToken);
    } finally {
      await application.close();
    }
  });

  it('answers a replayed refresh token exactly like an unknown one', async () => {
    const application = harness();
    try {
      const signedIn = await signInMobile(
        application,
        'mobile-replay@velora.test',
        'installation-api-0002',
      );
      await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: signedIn.tokens.refreshToken },
          origin: null,
        }),
      );

      const replayed = await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: signedIn.tokens.refreshToken },
          origin: null,
        }),
      );
      const unknown = await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: {
            refreshToken: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
          origin: null,
        }),
      );
      expect(replayed.status).toBe(unknown.status);
      expect(await replayed.json()).toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });
      expect(await unknown.json()).toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });
    } finally {
      await application.close();
    }
  });

  it('revokes the family when a rotated token is presented again, however soon', async () => {
    const application = harness();
    try {
      const signedIn = await signInMobile(
        application,
        'mobile-strict@velora.test',
        'installation-api-0003',
      );
      const first = await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: signedIn.tokens.refreshToken },
          origin: null,
        }),
      );
      expect(first.status).toBe(200);
      const rotated = (await first.json()) as { refreshToken: string };

      // No client-supplied value can make a second presentation of a consumed
      // token acceptable: there is no grace path to enter.
      const replayed = await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: signedIn.tokens.refreshToken },
          headers: { 'x-velora-refresh-attempt': 'same-attempt' },
          origin: null,
        }),
      );
      expect(replayed.status).toBe(401);
      expect(await replayed.json()).toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });

      // The family died with the replay, so the descendant is dead too.
      const descendant = await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: rotated.refreshToken },
          origin: null,
        }),
      );
      expect(descendant.status).toBe(401);
    } finally {
      await application.close();
    }
  });

  it('lets exactly one of many simultaneous HTTP refreshes succeed', async () => {
    const application = harness();
    try {
      const signedIn = await signInMobile(
        application,
        'mobile-race@velora.test',
        'installation-api-0004',
      );
      const responses = await Promise.all(
        Array.from({ length: 10 }, async () =>
          application.handle(
            browserRequest(apiRoutePaths.mobileRefresh, {
              body: { refreshToken: signedIn.tokens.refreshToken },
              origin: null,
            }),
          ),
        ),
      );
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 200).length).toBe(1);
      expect(statuses.filter((status) => status === 401).length).toBe(9);
    } finally {
      await application.close();
    }
  });

  it('revokes the refresh family on bearer logout and global logout', async () => {
    const application = harness();
    try {
      const signedIn = await signInMobile(
        application,
        'mobile-logout@velora.test',
        'installation-api-0005',
      );
      const loggedOut = await application.handle(
        browserRequest(apiRoutePaths.logout, {
          headers: { authorization: `Bearer ${signedIn.tokens.accessToken}` },
          method: 'POST',
          origin: null,
        }),
      );
      expect(loggedOut.status).toBe(200);

      const afterLogout = await application.handle(
        browserRequest(apiRoutePaths.session, {
          headers: { authorization: `Bearer ${signedIn.tokens.accessToken}` },
          origin: null,
        }),
      );
      expect(afterLogout.status).toBe(401);

      const refused = await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: signedIn.tokens.refreshToken },
          origin: null,
        }),
      );
      expect(refused.status).toBe(401);
    } finally {
      await application.close();
    }
  });

  it('requires no CSRF evidence for a bearer request that carries no cookie', async () => {
    const application = harness();
    try {
      const signedIn = await signInMobile(
        application,
        'mobile-nocsrf@velora.test',
        'installation-api-0006',
      );
      const response = await application.handle(
        browserRequest(apiRoutePaths.logout, {
          headers: { authorization: `Bearer ${signedIn.tokens.accessToken}` },
          method: 'POST',
          origin: null,
        }),
      );
      expect(response.status).toBe(200);
    } finally {
      await application.close();
    }
  });
});

describe('cross-surface authority', () => {
  it('revokes every surface for the account on global logout', async () => {
    const application = harness();
    try {
      const subject = 'cross-surface@velora.test';
      const web = await signInWeb(application, { subject });
      const studio = await signInWeb(application, {
        audience: 'creator_studio',
        subject,
      });
      const mobile = await signInMobile(
        application,
        subject,
        'installation-api-0007',
      );

      const response = await application.handle(
        browserRequest(apiRoutePaths.logoutAll, {
          cookies: web.cookies,
          csrf: web.csrfToken,
          method: 'POST',
        }),
      );
      expect(response.status).toBe(200);

      for (const cookies of [web.cookies, studio.cookies]) {
        const check = await application.handle(
          browserRequest(apiRoutePaths.session, {
            cookies,
            origin:
              cookies === web.cookies ? testConsumerOrigin : testCreatorOrigin,
          }),
        );
        expect(check.status).toBe(401);
      }
      const mobileCheck = await application.handle(
        browserRequest(apiRoutePaths.session, {
          headers: { authorization: `Bearer ${mobile.tokens.accessToken}` },
          origin: null,
        }),
      );
      expect(mobileCheck.status).toBe(401);
    } finally {
      await application.close();
    }
  });

  it('refuses to resolve two audience cookies presented together', async () => {
    const application = harness();
    try {
      const subject = 'ambiguous@velora.test';
      const web = await signInWeb(application, { subject });
      const studio = await signInWeb(application, {
        audience: 'creator_studio',
        subject,
      });
      const merged = `${web.cookies}; ${studio.cookies}`;
      const response = await application.handle(
        browserRequest(apiRoutePaths.session, { cookies: merged }),
      );
      expect(response.status).toBe(401);
    } finally {
      await application.close();
    }
  });

  it('never mints Platform Admin authority from the local adapter', async () => {
    const application = harness();
    try {
      for (const body of [
        { audience: 'platform_admin', subject: 'admin@velora.test' },
        { audience: 'PLATFORM_ADMIN', subject: 'admin@velora.test' },
      ]) {
        const response = await application.handle(
          browserRequest(apiRoutePaths.localWebSession, {
            body,
            method: 'POST',
          }),
        );
        expect(response.status).toBe(422);
      }
      const sessions = await rowsOf<{ total: number }>(
        database.sql`select count(*)::int as total from auth_sessions where audience = 'platform_admin'`,
      );
      expect(sessions[0]?.total).toBe(0);
    } finally {
      await application.close();
    }
  });
});

describe('AUTH environment gating and log hygiene', () => {
  it('refuses the local identity adapter outside local and test', async () => {
    // Configuration refuses staging outright, so the edge guard is exercised
    // with a configuration object that a loader would never produce. Both gates
    // must hold independently.
    const staging = {
      ...testServerConfig(),
      APP_ENV: 'staging',
    } as unknown as ServerConfig;
    const application = harness({ config: staging });
    try {
      for (const path of [
        apiRoutePaths.localWebSession,
        apiRoutePaths.localMobileSession,
      ]) {
        const response = await application.handle(
          browserRequest(path, {
            body: {
              audience: 'consumer_web',
              installationId: 'installation-staging',
              subject: 'staging@velora.test',
            },
            method: 'POST',
          }),
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          code: 'AUTH_IDENTITY_DISABLED',
        });
      }
    } finally {
      await application.close();
    }
  });

  it('never writes a session, CSRF, refresh, or access token to the log', async () => {
    const application = harness();
    try {
      const web = await signInWeb(application, { subject: 'logs@velora.test' });
      const mobile = await signInMobile(
        application,
        'logs@velora.test',
        'installation-api-0008',
      );
      await application.handle(
        browserRequest(apiRoutePaths.session, { cookies: web.cookies }),
      );
      await application.handle(
        browserRequest(apiRoutePaths.mobileRefresh, {
          body: { refreshToken: mobile.tokens.refreshToken },
          origin: null,
        }),
      );

      const written = JSON.stringify(application.logs);
      for (const secret of [
        web.csrfToken,
        mobile.tokens.accessToken,
        mobile.tokens.refreshToken,
        web.cookies,
      ]) {
        expect(secret.length).toBeGreaterThan(0);
        expect(written).not.toContain(secret);
      }
    } finally {
      await application.close();
    }
  });

  it('answers every AUTH failure with the same opaque message', async () => {
    const application = harness();
    try {
      const responses = await Promise.all([
        application.handle(browserRequest(apiRoutePaths.session)),
        application.handle(
          browserRequest(apiRoutePaths.mobileRefresh, {
            body: {
              refreshToken: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            },
            origin: null,
          }),
        ),
        application.handle(
          browserRequest(apiRoutePaths.localWebSession, {
            body: { audience: 'consumer_web' },
            method: 'POST',
          }),
        ),
      ]);
      for (const response of responses) {
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.message).toBe('Request failed');
        expect(Object.keys(body).sort()).toEqual([
          'code',
          'correlationId',
          'message',
        ]);
      }
    } finally {
      await application.close();
    }
  });
});

describe('account recovery over HTTP', () => {
  it('answers a known and an unknown subject identically', async () => {
    const application = harness();
    try {
      await signInWeb(application, {
        subject: 'recovery-known@velora.test',
      });
      const responses = await Promise.all(
        ['recovery-known@velora.test', 'recovery-nobody@velora.test'].map(
          async (subject) =>
            application.handle(
              browserRequest(apiRoutePaths.recoveryStart, {
                body: { channel: 'email', subject },
                headers: { 'x-velora-device': `device-${subject}` },
                method: 'POST',
              }),
            ),
        ),
      );
      for (const response of responses) {
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ status: 'accepted' });
      }
      // Only the account that exists received anything.
      expect(application.recoveryDelivery.deliveries).toHaveLength(1);
    } finally {
      await application.close();
    }
  });

  it('completes recovery from a known device and revokes prior authority', async () => {
    const application = harness();
    try {
      const subject = 'recovery-complete@velora.test';
      const device = 'device-recovery-complete';
      const signedIn = await signInWeb(application, {
        headers: { 'x-velora-device': device },
        subject,
      });
      await application.handle(
        browserRequest(apiRoutePaths.recoveryStart, {
          body: { channel: 'email', subject },
          headers: { 'x-velora-device': device },
          method: 'POST',
        }),
      );
      const issued = application.recoveryDelivery.latestFor(subject);
      expect(issued).toBeDefined();

      const completed = await application.handle(
        browserRequest(apiRoutePaths.recoveryCompletion, {
          body: { token: issued?.token ?? '' },
          headers: { 'x-velora-device': device },
          method: 'POST',
        }),
      );
      expect(completed.status).toBe(200);
      const body = (await completed.json()) as Record<string, unknown>;
      expect(body.assurance).toBe('single_factor');
      expect(
        completed.headers
          .getSetCookie()
          .some((cookie) =>
            cookie.startsWith('__Host-velora_consumer_web_session='),
          ),
      ).toBe(true);

      const previous = await application.handle(
        browserRequest(apiRoutePaths.session, { cookies: signedIn.cookies }),
      );
      expect(previous.status).toBe(401);
    } finally {
      await application.close();
    }
  });

  it('refuses a high-risk recovery and answers a replayed token like an unknown one', async () => {
    const application = harness();
    try {
      const subject = 'recovery-risky@velora.test';
      await signInWeb(application, {
        headers: { 'x-velora-device': 'device-enrolled' },
        subject,
      });
      await application.handle(
        browserRequest(apiRoutePaths.recoveryStart, {
          body: { channel: 'email', subject },
          headers: { 'x-velora-device': 'device-never-seen' },
          method: 'POST',
        }),
      );
      const issued = application.recoveryDelivery.latestFor(subject);
      const refused = await application.handle(
        browserRequest(apiRoutePaths.recoveryCompletion, {
          body: { token: issued?.token ?? '' },
          headers: { 'x-velora-device': 'device-never-seen' },
          method: 'POST',
        }),
      );
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        code: 'AUTH_RECOVERY_REVIEW_REQUIRED',
      });

      const unknown = await application.handle(
        browserRequest(apiRoutePaths.recoveryCompletion, {
          body: {
            token: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
          method: 'POST',
        }),
      );
      expect(unknown.status).toBe(401);
      expect(await unknown.json()).toMatchObject({
        code: 'AUTH_RECOVERY_INVALID',
      });
    } finally {
      await application.close();
    }
  });

  it('refuses recovery initiation from a foreign browser origin', async () => {
    const application = harness();
    try {
      const response = await application.handle(
        browserRequest(apiRoutePaths.recoveryStart, {
          body: { channel: 'email', subject: 'origin@velora.test' },
          method: 'POST',
          origin: testForeignOrigin,
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'AUTH_ORIGIN_REJECTED',
      });
    } finally {
      await application.close();
    }
  });

  it('never writes a recovery token to the log', async () => {
    const application = harness();
    try {
      const subject = 'recovery-logs@velora.test';
      await signInWeb(application, {
        headers: { 'x-velora-device': 'device-logs' },
        subject,
      });
      await application.handle(
        browserRequest(apiRoutePaths.recoveryStart, {
          body: { channel: 'email', subject },
          headers: { 'x-velora-device': 'device-logs' },
          method: 'POST',
        }),
      );
      const issued = application.recoveryDelivery.latestFor(subject);
      expect(issued?.token.length).toBeGreaterThan(0);
      expect(JSON.stringify(application.logs)).not.toContain(
        issued?.token ?? 'unreachable',
      );
    } finally {
      await application.close();
    }
  });
});
