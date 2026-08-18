import { describe, expect, it } from 'bun:test';
import type { ServerConfig } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import {
  apiErrorCodes,
  apiErrorSchema,
  apiOperations,
  apiRoutePaths,
  correlationResponseHeader,
  livenessResponseSchema,
  maximumRequestBodyBytes,
  readinessResponseSchema,
} from '@velora/validation';

import { createApplication } from '../../src/application.js';
import type { AuthRuntime } from '../../src/auth/composition.js';
import { DatabaseAdmission } from '../../src/database/admission.js';
import type { HealthDependency } from '../../src/database/database.service.js';
import { DenyAllOutboundHttp } from '../../src/security/ports.js';
import {
  testAuthRuntime,
  testBillingRuntime,
  testDiscoveryRuntime,
  testMediaRuntime,
  testMessagingRuntime,
  testNotificationsApiRuntime,
  testSafetyRuntime,
  testServerConfig,
  testUsersRuntime,
  testCreatorsRuntime,
  testClubsRuntime,
  testAdminRuntime,
  testPayoutsRuntime,
  testIdentityRuntime,
} from '../support/harness.js';

const config = testServerConfig();

function health(ready: boolean, error?: Error): HealthDependency {
  return {
    close: () => Promise.resolve(),
    isReady: () =>
      error === undefined ? Promise.resolve(ready) : Promise.reject(error),
  };
}

function testLogger(records: unknown[] = []): SafeLogger {
  const record = (
    fields: Readonly<Record<string, unknown>>,
    message: string,
  ) => {
    records.push({ fields, message });
  };
  return {
    debug: record,
    error: record,
    fatal: record,
    info: record,
    trace: record,
    warn: record,
  };
}

function runtime(options?: {
  readonly database?: HealthDependency;
  readonly databaseAdmission?: DatabaseAdmission;
  readonly ephemeralRedis?: HealthDependency;
  readonly logger?: SafeLogger;
  readonly queueRedis?: HealthDependency;
}) {
  const auth = testAuthRuntime({ config });
  return createApplication({
    config,
    dependencies: {
      auth,
      database: options?.database ?? health(true),
      databaseAdmission: options?.databaseAdmission ?? new DatabaseAdmission(),
      ephemeralRedis: options?.ephemeralRedis ?? health(true),
      logger: options?.logger ?? testLogger(),
      queueRedis: options?.queueRedis ?? health(true),
      ...productDomains(auth, config),
    },
  });
}

/**
 * The product domains are built together because each consumes what the one
 * before it publishes: TRUST & SAFETY takes USERS' enforcement contract,
 * DISCOVERY takes USERS' directory and SAFETY's eligibility answer, MESSAGING
 * takes DISCOVERY's connection contract and the same safety answer, and
 * CREATORS takes USERS' adult standing. Wiring them separately would give one
 * test several views of the same data.
 */
function productDomains(auth: AuthRuntime, config: ServerConfig) {
  const users = testUsersRuntime({ auth, config });
  // CREATORS and PRIVATE CLUBS before TRUST & SAFETY: safety consumes two
  // narrow answers from them about what a report may name.
  const creators = testCreatorsRuntime({ caller: auth.caller, users });
  const clubs = testClubsRuntime({ config, creators, users });
  const safety = testSafetyRuntime({ config, creators, users });
  const discovery = testDiscoveryRuntime({ safety, users });
  // BILLING before ADMIN, exactly as the application composes them: an operator
  // reversal is BILLING's decision taken with an operator's authority.
  const billing = testBillingRuntime({ clubs, config, creators, users });
  // MEDIA before ADMIN, exactly as the application composes them: an operator
  // taking an object out of public view owes the cache the news.
  const media = testMediaRuntime({ config });
  return {
    admin: testAdminRuntime({
      billing,
      caller: auth.caller,
      clubs,
      config,
      creators,
      media,
      safety,
    }),
    billing,
    clubs,
    creators,
    discovery,
    identity: testIdentityRuntime({ config }),
    media,
    messaging: testMessagingRuntime({
      config,
      discovery,
      safety: safety.directory,
      users,
    }),
    notifications: testNotificationsApiRuntime({ safety, users }),
    payouts: testPayoutsRuntime({ config, creators }),
    safety,
    users,
  };
}

describe('Elysia API foundation', () => {
  it('serves liveness with safe headers and a bounded correlation ID', async () => {
    const application = runtime();
    const response = await application.app.handle(
      new Request('http://api.test/v1/health/live', {
        headers: { 'x-correlation-id': 'test-correlation' },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('x-correlation-id')).toBe('test-correlation');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reports readiness across PostgreSQL and both Redis responsibilities', async () => {
    const application = runtime({ queueRedis: health(false) });
    const response = await application.app.handle(
      new Request('http://api.test/v1/health/ready'),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      dependencies: {
        ephemeralRedis: 'up',
        postgres: 'up',
        queueRedis: 'down',
      },
      status: 'unavailable',
    });
  });

  it('returns and logs a safe unhandled-error envelope', async () => {
    const records: unknown[] = [];
    const application = runtime({
      database: health(false, new Error('postgresql://user:secret@db/private')),
      logger: testLogger(records),
    });
    const response = await application.app.handle(
      new Request(
        'http://api.test/v1/health/ready?access_token=request-secret',
        { headers: { authorization: 'Bearer header-secret' } },
      ),
    );
    const body = await response.text();
    const logs = JSON.stringify(records);

    expect(response.status).toBe(500);
    expect(body).toContain('Internal server error');
    expect(body).not.toContain('secret');
    expect(logs).not.toContain('request-secret');
    expect(logs).not.toContain('user:secret');
  });

  it('rejects declared oversized requests before routing', async () => {
    const application = runtime();
    const response = await application.app.handle(
      new Request('http://api.test/v1/not-present', {
        headers: { 'content-length': '1048577' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request failed',
    });
  });

  it('refuses a product request when the instance has no database capacity', async () => {
    const logs: unknown[] = [];
    // A bound of one, already taken, with no wait left to give: the state a
    // saturated instance is in, without needing a database to reach it.
    const databaseAdmission = new DatabaseAdmission({
      limit: 1,
      waitMilliseconds: 0,
    });
    const application = runtime({
      databaseAdmission,
      logger: testLogger(logs),
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = databaseAdmission.run(() => held);

    const response = await application.app.handle(
      new Request(`http://api.test${apiRoutePaths.consumerAccountSelf}`, {
        headers: { origin: 'http://127.0.0.1:3000' },
      }),
    );

    expect(response.status).toBe(503);
    // The client is told when to come back, and nothing else.
    expect(response.headers.get('retry-after')).toBe('1');
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      code: apiErrorCodes.serviceUnavailable,
      message: 'Request failed',
    });
    expect(JSON.stringify(body)).not.toContain('pool');
    expect(JSON.stringify(body)).not.toContain('admission');
    // The saturation is logged as an operational fact, with counters and a
    // correlation identifier rather than anything about who was refused.
    expect(JSON.stringify(logs)).toContain('database admission saturated');

    release();
    await holder;
  });

  it('registers only OpenAPI-declared HTTP routes', () => {
    const application = runtime();
    const actual = application.app.routes
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    const documented = apiOperations
      .map((item) => `${item.method.toUpperCase()} ${item.path}`)
      .sort();

    expect(actual).toEqual(documented);
  });

  it('produces every documented error status with the documented shape', async () => {
    const application = runtime();
    const cases = [
      {
        expectedCode: apiErrorCodes.notFound,
        request: new Request(`http://api.test${apiRoutePaths.liveness}`, {
          method: 'DELETE',
        }),
        status: 404,
      },
      {
        expectedCode: apiErrorCodes.payloadTooLarge,
        request: new Request(`http://api.test${apiRoutePaths.readiness}`, {
          headers: {
            'content-length': String(maximumRequestBodyBytes + 1),
          },
          method: 'POST',
        }),
        status: 413,
      },
    ];

    for (const testCase of cases) {
      const response = await application.app.handle(testCase.request);
      expect(response.status).toBe(testCase.status);
      expect(response.headers.get(correlationResponseHeader)).toBeTruthy();
      const body = apiErrorSchema.parse(await response.json());
      expect(body.code).toBe(testCase.expectedCode);
      expect(body.message).toBe('Request failed');
    }
  });

  it('answers every documented success status with the documented schema', async () => {
    const ready = runtime();
    const liveness = await ready.app.handle(
      new Request(`http://api.test${apiRoutePaths.liveness}`),
    );
    expect(liveness.status).toBe(200);
    expect(liveness.headers.get(correlationResponseHeader)).toBeTruthy();
    livenessResponseSchema.parse(await liveness.json());

    const readiness = await ready.app.handle(
      new Request(`http://api.test${apiRoutePaths.readiness}`),
    );
    expect(readiness.status).toBe(200);
    readinessResponseSchema.parse(await readiness.json());

    const degraded = runtime({ queueRedis: health(false) });
    const unavailable = await degraded.app.handle(
      new Request(`http://api.test${apiRoutePaths.readiness}`),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get(correlationResponseHeader)).toBeTruthy();
    expect(readinessResponseSchema.parse(await unavailable.json()).status).toBe(
      'unavailable',
    );
  });

  it('documents every status the runtime can return', () => {
    const documented = new Map(
      apiOperations.map((operation) => [
        `${operation.method.toUpperCase()} ${operation.path}`,
        new Set(Object.keys(operation.responses)),
      ]),
    );
    for (const statuses of documented.values()) {
      for (const status of ['404', '413', '500']) {
        expect([...statuses]).toContain(status);
      }
    }
    expect(documented.get(`GET ${apiRoutePaths.readiness}`)?.has('503')).toBe(
      true,
    );
  });

  it('registers a deny-all outbound adapter at composition root', () => {
    expect(runtime().dependencies.outboundHttp).toBeInstanceOf(
      DenyAllOutboundHttp,
    );
  });
});
