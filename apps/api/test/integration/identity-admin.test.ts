import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { bindHighImpactAction } from '../../src/auth/privileged.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testAdminOrigin,
  testConsumerOrigin,
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * The V1 Identity Admin seam is intentionally two reads and nothing else.
 *
 * These checks use a hand-seeded privileged session only because no approved
 * verifier can mint one. They prove the authority it will demand instead of
 * creating a test-only route that would be mistaken for product capability.
 */

const databaseUrl = await provisionDatabase('velora_identity_admin');
const database: TestDatabase = connectDatabase(databaseUrl);
const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};
const logger = silentLogger();
const config = testServerConfig({
  IDENTITY_JURISDICTION_POLICY: 'local-test',
  IDENTITY_VERIFICATION_PROVIDER: 'local-test',
});
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'identity-admin-test',
  },
});
const media = testMediaRuntime({ config, database: database.drizzle, logger });
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  media: media.service,
});
const runtimes = testProductRuntimes({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  privilegedAccess: auth.privilegedAccess,
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

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

interface Operator {
  readonly cookie: string;
  readonly csrf: string;
}

async function operatorSession(
  audience: 'consumer_web' | 'platform_admin' = 'platform_admin',
): Promise<Operator> {
  const accountId = crypto.randomUUID();
  await execute(
    database.sql`insert into auth_accounts (id, status) values (${accountId}, 'active')`,
  );
  const opaque = () =>
    `v1.${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
  const token = opaque();
  const csrf = opaque();
  const digest = (value: string) => Bun.SHA256.hash(value, 'hex');
  const now = new Date();
  await execute(database.sql`
    insert into auth_sessions (
      id, account_id, audience, assurance, assurance_established_at,
      authenticated_at, created_at, csrf_digest, idle_expires_at,
      last_active_at, absolute_expires_at, token_digest
    ) values (
      ${crypto.randomUUID()}, ${accountId}, ${audience},
      ${audience === 'platform_admin' ? 'phishing_resistant' : 'single_factor'},
      ${now}, ${now}, ${now}, ${digest(csrf)},
      ${new Date(now.getTime() + 3_600_000)}, ${now},
      ${new Date(now.getTime() + 3_600_000)}, ${digest(token)}
    )`);
  return {
    cookie: `__Host-velora_${audience}_session=${token}`,
    csrf,
  };
}

function request(
  path: string,
  operator: Operator,
  options: { readonly authorizationId?: string; readonly origin?: string } = {},
): Request {
  return new Request(`http://api.test${path}`, {
    headers: {
      ...(options.authorizationId === undefined
        ? {}
        : { 'x-velora-action-authorization': options.authorizationId }),
      cookie: operator.cookie,
      origin: options.origin ?? testAdminOrigin,
      'x-velora-csrf': operator.csrf,
    },
  });
}

async function exactReadAuthorization(
  operator: Operator,
  input: {
    readonly ownerDomain: 'auth' | 'creators' | 'safety';
    readonly ownerReference: string;
  },
): Promise<string> {
  const resolved = await auth.caller.resolve(
    request('/v1/admin/identity/subject', operator),
  );
  if (resolved.kind !== 'authenticated') {
    throw new Error('operator session did not resolve');
  }
  const target = {
    ownerDomain: input.ownerDomain,
    ownerReference: input.ownerReference,
  };
  const authorized = await auth.privilegedAccess.authorizeHighImpact({
    binding: bindHighImpactAction({
      argumentsValue: target,
      beforeState: target,
      expectedEffect: { kind: 'identity_subject_read' },
      operation: 'identity.read_subject',
      targetId: `${input.ownerDomain}:${input.ownerReference}`,
      targetType: 'identity_subject',
    }),
    context: resolved.context,
    correlationId: 'identity-admin-exact-read',
    validForMilliseconds: 60_000,
  });
  if (authorized.kind !== 'authorized') {
    throw new Error(
      `could not authorize exact identity read: ${authorized.reason}`,
    );
  }
  return authorized.authorizationId;
}

async function seedSubject(
  ownerReference = crypto.randomUUID(),
): Promise<string> {
  const established = await runtimes.identity.repository.establishAttempt({
    callerIdempotencyKey: `identity-admin-${crypto.randomUUID()}`,
    inputDigest: 'a'.repeat(64),
    jurisdiction: 'ES',
    now: new Date(),
    ownerDomain: 'auth',
    ownerReference,
    policyVersion: 'local-test-v1',
    provider: 'local-test',
    providerIdempotencyKey: `identity-admin-provider-${crypto.randomUUID()}`,
    purpose: 'adult_assurance',
    requiredEvidenceClass: 'adult_threshold',
    requiredThreshold: 'adult-18-plus',
  });
  if (established.kind !== 'created') throw new Error('identity seed failed');
  return ownerReference;
}

describe('read-only identity Admin operations', () => {
  it('registers exactly the aggregate and exact-subject reads', () => {
    const routes = application.app.routes
      .filter((route) => route.path.startsWith('/v1/admin/identity'))
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(routes).toEqual([
      'GET /v1/admin/identity/state',
      'GET /v1/admin/identity/subject',
    ]);
  });

  it('returns aggregate state without any subject or provider reference', async () => {
    const operator = await operatorSession();
    const ownerReference = await seedSubject();

    const response = await handle(
      request('/v1/admin/identity/state', operator),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.provider).toBe('local-test');
    expect(body.attempts).toEqual([
      expect.objectContaining({
        count: 1,
        purpose: 'adult_assurance',
        state: 'created',
      }),
    ]);
    const rendered = JSON.stringify(body);
    expect(rendered).not.toContain(ownerReference);
    expect(rendered).not.toContain('identity-admin-provider-');
  });

  it('requires a current exact action for one known subject and consumes it', async () => {
    const operator = await operatorSession();
    const ownerReference = await seedSubject();
    const path = `/v1/admin/identity/subject?ownerDomain=auth&ownerReference=${ownerReference}`;

    expect((await handle(request(path, operator))).status).toBe(422);
    const authorizationId = await exactReadAuthorization(operator, {
      ownerDomain: 'auth',
      ownerReference,
    });
    const response = await handle(request(path, operator, { authorizationId }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      subject: { attempts: { purpose: string; state: string }[] };
    };
    expect(
      body.subject.attempts.map(({ purpose, state }) => ({ purpose, state })),
    ).toEqual([{ purpose: 'adult_assurance', state: 'created' }]);
    const rendered = JSON.stringify(body);
    expect(rendered).not.toContain(ownerReference);
    expect(rendered).not.toContain('identity-admin-provider-');

    expect(
      await handle(request(path, operator, { authorizationId })).then(
        (result) => result.status,
      ),
    ).toBe(403);
  });

  it('refuses cross-target, cross-audience, and query-shaped probing', async () => {
    const operator = await operatorSession();
    const secondOperator = await operatorSession();
    const consumer = await operatorSession('consumer_web');
    const first = await seedSubject();
    const second = await seedSubject();
    const authorizationId = await exactReadAuthorization(operator, {
      ownerDomain: 'auth',
      ownerReference: first,
    });
    const subject = (reference: string) =>
      `/v1/admin/identity/subject?ownerDomain=auth&ownerReference=${reference}`;

    expect(
      (await handle(request(subject(second), operator, { authorizationId })))
        .status,
    ).toBe(403);
    expect(
      (
        await handle(
          request(subject(first), secondOperator, { authorizationId }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handle(request(subject(first), operator, { authorizationId })))
        .status,
    ).toBe(200);
    expect(
      (
        await handle(
          request(subject(first), consumer, { origin: testConsumerOrigin }),
        )
      ).status,
    ).toBe(403);
    const freshAuthorizationId = await exactReadAuthorization(operator, {
      ownerDomain: 'auth',
      ownerReference: first,
    });
    expect(
      (
        await handle(
          request(`${subject(first)}&search=no`, operator, {
            authorizationId: freshAuthorizationId,
          }),
        )
      ).status,
    ).toBe(422);
  });
});
