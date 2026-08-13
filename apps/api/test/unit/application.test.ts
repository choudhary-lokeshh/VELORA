import { describe, expect, it } from 'bun:test';
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
import type { HealthDependency } from '../../src/database/database.service.js';
import { DenyAllOutboundHttp } from '../../src/security/ports.js';
import { testAuthRuntime, testServerConfig } from '../support/harness.js';

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
  readonly ephemeralRedis?: HealthDependency;
  readonly logger?: SafeLogger;
  readonly queueRedis?: HealthDependency;
}) {
  return createApplication({
    config,
    dependencies: {
      auth: testAuthRuntime({ config }),
      database: options?.database ?? health(true),
      ephemeralRedis: options?.ephemeralRedis ?? health(true),
      logger: options?.logger ?? testLogger(),
      queueRedis: options?.queueRedis ?? health(true),
    },
  });
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
