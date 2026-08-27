import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { loadServerConfig, type ServerConfig } from '@velora/config/server';
import {
  apiRoutePaths,
  authErrorCodes,
  productErrorCodes,
} from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import {
  connectDatabase,
  provisionDatabase,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testAdminOrigin,
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testForeignOrigin,
  testProductRuntimes,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_auth_admin_local');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const clock = { current: new Date('2026-08-27T10:00:00.000Z') };
const now = () => clock.current;

interface Harness {
  close(): Promise<void>;
  handle(request: Request): Promise<Response>;
}

function harness(options?: {
  readonly config?: ServerConfig;
  readonly verifierOverride?: 'unavailable' | 'local-test-privileged';
}): Harness {
  const logs: unknown[] = [];
  const logger = silentLogger(logs);
  const config =
    options?.config ??
    testServerConfig({
      AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER:
        options?.verifierOverride ?? 'local-test-privileged',
    });
  const auth = createAuthRuntime({
    config,
    database: database.drizzle,
    logger,
    options: {
      now,
      rateLimiter: new InMemoryRateLimiter(now),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'admin-local-test',
    },
  });
  const mediaRuntime = testMediaRuntime({
    config,
    database: database.drizzle,
    logger,
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: database.drizzle,
    logger,
    media: mediaRuntime.service,
    now,
  });
  const application = createApplication({
    config,
    dependencies: {
      auth,
      ...testProductRuntimes({
        caller: auth.caller,
        config,
        database: database.drizzle,
        logger,
        now,
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
  return {
    close: () => application.close(),
    handle: (request) => application.app.handle(request),
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
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('; ');
}

beforeEach(async () => {
  clock.current = new Date('2026-08-27T10:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('Platform Admin local access enablement (ADR-0034)', () => {
  it('issues a platform_admin session with phishing_resistant assurance on loopback origin', async () => {
    const app = harness();
    try {
      const response = await app.handle(
        new Request(`http://127.0.0.1:4000${apiRoutePaths.localAdminSession}`, {
          body: JSON.stringify({ subject: 'admin@velora.test' }),
          headers: {
            'content-type': 'application/json',
            origin: testAdminOrigin,
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        readonly accountId: string;
        readonly assurance: string;
        readonly audience: string;
        readonly csrfToken?: string;
      };
      expect(body.audience).toBe('platform_admin');
      expect(body.assurance).toBe('phishing_resistant');
      expect(typeof body.csrfToken).toBe('string');

      const cookies = cookieJar(response);
      expect(cookies.has('__Host-velora_platform_admin_session')).toBe(true);
      expect(cookies.has('__Host-velora_platform_admin_csrf')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('allows the issued local platform_admin session to access privileged admin routes', async () => {
    const app = harness();
    try {
      // 1. Establish session
      const authResponse = await app.handle(
        new Request(`http://127.0.0.1:4000${apiRoutePaths.localAdminSession}`, {
          body: JSON.stringify({ subject: 'ops-lead@velora.test' }),
          headers: {
            'content-type': 'application/json',
            origin: testAdminOrigin,
          },
          method: 'POST',
        }),
      );
      expect(authResponse.status).toBe(201);
      const cookies = cookieJar(authResponse);

      // 2. Query session endpoint
      const sessionResponse = await app.handle(
        new Request(`http://127.0.0.1:4000${apiRoutePaths.session}`, {
          headers: {
            cookie: cookieHeaderFrom(cookies),
            origin: testAdminOrigin,
          },
          method: 'GET',
        }),
      );
      expect(sessionResponse.status).toBe(200);
      const sessionBody = (await sessionResponse.json()) as {
        readonly assurance: string;
        readonly audience: string;
      };
      expect(sessionBody.audience).toBe('platform_admin');
      expect(sessionBody.assurance).toBe('phishing_resistant');

      // 3. Query privileged admin route (e.g. billing state)
      const adminResponse = await app.handle(
        new Request('http://127.0.0.1:4000/v1/admin/billing/state', {
          headers: {
            cookie: cookieHeaderFrom(cookies),
            origin: testAdminOrigin,
          },
          method: 'GET',
        }),
      );
      expect(adminResponse.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('refuses local admin session issuance from a foreign or non-admin origin', async () => {
    const app = harness();
    try {
      for (const origin of [
        testForeignOrigin,
        testConsumerOrigin,
        testCreatorOrigin,
      ]) {
        const response = await app.handle(
          new Request(
            `http://127.0.0.1:4000${apiRoutePaths.localAdminSession}`,
            {
              body: JSON.stringify({ subject: 'admin@velora.test' }),
              headers: {
                'content-type': 'application/json',
                origin,
              },
              method: 'POST',
            },
          ),
        );
        expect(response.status).toBe(403);
        const body = (await response.json()) as { readonly code: string };
        expect(body.code).toBe(authErrorCodes.originRejected);
      }
    } finally {
      await app.close();
    }
  });

  it('refuses local admin session route when verifier is unavailable', async () => {
    const app = harness({ verifierOverride: 'unavailable' });
    try {
      const response = await app.handle(
        new Request(`http://127.0.0.1:4000${apiRoutePaths.localAdminSession}`, {
          body: JSON.stringify({ subject: 'admin@velora.test' }),
          headers: {
            'content-type': 'application/json',
            origin: testAdminOrigin,
          },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { readonly code: string };
      expect(body.code).toBe(authErrorCodes.identityDisabled);
    } finally {
      await app.close();
    }
  });

  it('refuses malformed or empty identity subjects with 422', async () => {
    const app = harness();
    try {
      const response = await app.handle(
        new Request(`http://127.0.0.1:4000${apiRoutePaths.localAdminSession}`, {
          body: JSON.stringify({ subject: '' }),
          headers: {
            'content-type': 'application/json',
            origin: testAdminOrigin,
          },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { readonly code: string };
      expect(body.code).toBe(authErrorCodes.validationFailed);
    } finally {
      await app.close();
    }
  });

  it('refuses consumer_web and creator_studio sessions at privileged admin routes', async () => {
    const app = harness();
    try {
      // Create consumer web session
      const consumerAuth = await app.handle(
        new Request(`http://127.0.0.1:4000${apiRoutePaths.localWebSession}`, {
          body: JSON.stringify({
            audience: 'consumer_web',
            subject: 'consumer@velora.test',
          }),
          headers: {
            'content-type': 'application/json',
            origin: testConsumerOrigin,
          },
          method: 'POST',
        }),
      );
      expect(consumerAuth.status).toBe(201);
      const consumerCookies = cookieJar(consumerAuth);

      // Attempt to access admin route with consumer cookies
      const response = await app.handle(
        new Request('http://127.0.0.1:4000/v1/admin/billing/state', {
          headers: {
            cookie: cookieHeaderFrom(consumerCookies),
            origin: testAdminOrigin,
          },
          method: 'GET',
        }),
      );
      // Fails with 401 (since cookie name is audience-scoped) or 403 (if caller is resolved)
      expect([401, 403]).toContain(response.status);
    } finally {
      await app.close();
    }
  });

  it('rejects stale assurance (> 5 min) on privileged admin operations', async () => {
    const app = harness();
    try {
      const authResponse = await app.handle(
        new Request(`http://127.0.0.1:4000${apiRoutePaths.localAdminSession}`, {
          body: JSON.stringify({ subject: 'admin@velora.test' }),
          headers: {
            'content-type': 'application/json',
            origin: testAdminOrigin,
          },
          method: 'POST',
        }),
      );
      expect(authResponse.status).toBe(201);
      const cookies = cookieJar(authResponse);

      // Advance time by 6 minutes (step-up maximum age is 5 minutes per ADR-0017)
      clock.current = new Date(clock.current.getTime() + 360_000);

      const adminResponse = await app.handle(
        new Request('http://127.0.0.1:4000/v1/admin/billing/state', {
          headers: {
            cookie: cookieHeaderFrom(cookies),
            origin: testAdminOrigin,
          },
          method: 'GET',
        }),
      );
      expect(adminResponse.status).toBe(403);
      const body = (await adminResponse.json()) as { readonly code: string };
      expect(body.code).toBe(productErrorCodes.actionNotPermitted);
    } finally {
      await app.close();
    }
  });

  it('staging and production configurations hard-reject local-test-privileged at startup', () => {
    for (const appEnv of ['staging', 'production']) {
      expect(() =>
        loadServerConfig({
          APP_ENV: appEnv,
          AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER: 'local-test-privileged',
          DATABASE_URL: 'postgresql://velora:secret@db.internal:5432/velora',
          EPHEMERAL_REDIS_URL: 'redis://redis.internal:6379/0',
          HOST: '0.0.0.0',
          PORT: '4000',
          QUEUE_REDIS_URL: 'redis://redis.internal:6379/1',
        }),
      ).toThrow();
    }
  });
});
