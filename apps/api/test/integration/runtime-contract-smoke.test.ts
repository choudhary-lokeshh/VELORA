import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import type { HealthDependency } from '../../src/database/database.service.js';
import { EmptyIdentityAdultAssuranceReader } from '../../src/identity/assurance-reader.js';
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
  testConsumerOrigin,
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * Every published operation answers, from the application the product runs.
 *
 * This is a thin layer on purpose and it does not duplicate a single domain
 * assertion. What it owns is the class of failure the domain suites cannot see,
 * because each of them composes the one runtime it is about: the application
 * itself failing to come up, a route that stopped being registered, a runtime
 * export that no longer exists, an unexpected 500 from wiring rather than from
 * business logic, and a route reachable with no session at all.
 *
 * The operation list is read from the generated OpenAPI document rather than
 * written here. A route added to the contract and never registered fails
 * immediately, and nobody has to remember to add it below.
 *
 * The probe is deliberately the weakest possible request: no session, no CSRF
 * token, an approved browser origin, and an empty body. Every product route
 * must refuse it. What separates "refused" from "absent" is the error code, not
 * the status: an unregistered path falls through to the framework handler and
 * is answered `HTTP_404`, while a registered route that decides a resource is
 * missing answers with its own contract code. That distinction is the whole
 * point of this file.
 */

const contractPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/validation/openapi/velora.v1.json',
);

interface ContractOperation {
  readonly declaredStatuses: readonly number[];
  readonly method: string;
  readonly path: string;
}

function publishedOperations(): readonly ContractOperation[] {
  const document = JSON.parse(readFileSync(contractPath, 'utf8')) as {
    paths: Record<
      string,
      Record<string, { responses?: Record<string, unknown> }>
    >;
  };
  const operations: ContractOperation[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['delete', 'get', 'patch', 'post', 'put'].includes(method)) continue;
      operations.push({
        declaredStatuses: Object.keys(operation.responses ?? {}).map(Number),
        method: method.toUpperCase(),
        path,
      });
    }
  }
  return operations;
}

const databaseUrl = await provisionDatabase('velora_runtime_smoke');
const database: TestDatabase = connectDatabase(databaseUrl);
const healthy: HealthDependency = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};
const logger = silentLogger();
const config = testServerConfig();

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'runtime-smoke',
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
  identityAdultAssurance: new EmptyIdentityAdultAssuranceReader(),
  logger,
  media: mediaRuntime.service,
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

afterAll(async () => {
  await application.close();
  await database.close();
});

async function probe(operation: ContractOperation): Promise<Response> {
  const headers: Record<string, string> = {
    origin: testConsumerOrigin,
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
  if (operation.method !== 'GET') headers['content-type'] = 'application/json';
  return application.app.handle(
    new Request(`http://127.0.0.1${operation.path}`, {
      ...(operation.method === 'GET' ? {} : { body: '{}' }),
      headers,
      method: operation.method,
    }),
  );
}

async function errorCodeOf(response: Response): Promise<string | undefined> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return (JSON.parse(text) as { code?: string }).code;
  } catch {
    return undefined;
  }
}

const operations = publishedOperations();

describe('the running application answers its whole published contract', () => {
  it('publishes operations at all', () => {
    // A contract that generated nothing would make every assertion below pass
    // by having nothing to check.
    expect(operations.length).toBeGreaterThan(100);
  });

  it('registers a route for every published operation', async () => {
    const absent: string[] = [];
    for (const operation of operations) {
      const response = await probe(operation);
      // `HTTP_404` is the framework answering for a path nothing claimed.
      // A registered route that finds no resource answers `RESOURCE_NOT_FOUND`.
      if ((await errorCodeOf(response)) === 'HTTP_404') {
        absent.push(`${operation.method} ${operation.path}`);
      }
    }
    expect(absent).toEqual([]);
  });

  it('never answers a bare probe with an internal error', async () => {
    // 503 is deliberately not a failure here. Every operation declares it, and
    // a capability whose provider is unavailable answering `503` is the
    // platform failing closed exactly as it is supposed to — this suite runs
    // with several of them unavailable on purpose. What must never appear is
    // 500: nothing in this file supplies a body worth a business decision, so
    // an internal error is the application being wrong rather than the request.
    const failed: string[] = [];
    for (const operation of operations) {
      const response = await probe(operation);
      const internal =
        response.status === 500 ||
        (await errorCodeOf(response)) === 'INTERNAL_ERROR';
      if (internal) {
        failed.push(
          `${operation.method} ${operation.path} -> ${String(response.status)}`,
        );
      }
    }
    expect(failed).toEqual([]);
  });

  it('answers every probe with a status its own contract declares', async () => {
    const undeclared: string[] = [];
    for (const operation of operations) {
      const response = await probe(operation);
      if (!operation.declaredStatuses.includes(response.status)) {
        undeclared.push(
          `${operation.method} ${operation.path} -> ${String(response.status)}`,
        );
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('refuses every product operation to a caller with no session', async () => {
    // Six paths may answer a caller holding nothing, and each is deliberate.
    // The health checks are the platform's liveness surface. Logging out
    // without a session is a success rather than a refusal, because the state
    // the caller asked for is the state they are in. The creator directory is
    // the public listing of pages their authors chose to publish, and the live
    // windows are the times the platform is announcing to everybody: both
    // answer identically for every caller, so requiring a credential would
    // collect an identity for no purpose. Everything else is either a session
    // audience or a provider callback with its own authentication, and none of
    // it may answer a bare browser request.
    //
    // The other public creator routes are absent from this list on purpose:
    // they need a handle, and a bare probe carries none, so they refuse. So
    // does `/v1/media/deliveries`, which is open to a caller with no credential
    // and still requires a body naming what to serve, and so does the
    // invitation opening, which needs a code and a key.
    const open = [
      '/v1/health/live',
      '/v1/health/ready',
      '/v1/auth/logout',
      '/v1/auth/logout-all',
      '/v1/creators/directory',
      '/v1/growth/live-windows',
    ];
    const admitted: string[] = [];
    for (const operation of operations) {
      if (open.includes(operation.path)) continue;
      const response = await probe(operation);
      if (response.status < 400) {
        admitted.push(
          `${operation.method} ${operation.path} -> ${String(response.status)}`,
        );
      }
    }
    expect(admitted).toEqual([]);
  });

  it('answers both health checks', async () => {
    for (const path of ['/v1/health/live', '/v1/health/ready']) {
      const response = await application.app.handle(
        new Request(`http://127.0.0.1${path}`),
      );
      expect(response.status, path).toBe(200);
    }
  });
});
