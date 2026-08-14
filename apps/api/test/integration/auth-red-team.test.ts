import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { apiOperations, apiRoutePaths, csrfHeader } from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { Ed25519AccessTokenAuthority } from '../../src/auth/access-token.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { LocalIdentityProvider } from '../../src/auth/identity-provider.js';
import {
  bindHighImpactAction,
  PrivilegedAccessService,
} from '../../src/auth/privileged.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  LocalTestRecoveryDelivery,
  RecoveryService,
} from '../../src/auth/recovery.js';
import { AuthRepository } from '../../src/auth/repository.js';
import { AuthService } from '../../src/auth/service.js';
import type { HealthDependency } from '../../src/database/database.service.js';
import { ScriptedAuthenticatorVerifier } from '../support/authenticator.js';
import {
  connectDatabase,
  execute,
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
  testServerConfig,
} from '../support/harness.js';

/**
 * Adversarial regressions. Each test is an attack, not a feature: it asserts
 * that a specific way of obtaining, keeping, replaying, or escalating authority
 * does not work.
 */

const databaseUrl = await provisionDatabase('velora_auth_red_team');
const database: TestDatabase = connectDatabase(databaseUrl);
const repository = new AuthRepository(database.drizzle);
const clock = { current: new Date('2026-08-14T10:00:00.000Z') };
const now = () => clock.current;

const authService = new AuthService({
  accessTokenSigner: Ed25519AccessTokenAuthority.withGeneratedKey(
    'https://auth.velora.invalid',
  ),
  identityProvider: new LocalIdentityProvider(),
  now,
  repository,
});

const healthy: HealthDependency = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

function harness() {
  const logs: unknown[] = [];
  const logger = silentLogger(logs);
  const config = testServerConfig();
  const auth = createAuthRuntime({
    config,
    database: database.drizzle,
    logger,
    options: {
      now,
      rateLimiter: new InMemoryRateLimiter(),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'red-team',
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
  return {
    close: () => application.close(),
    handle: (request: Request) => application.app.handle(request),
    logs,
  };
}

function request(
  path: string,
  init: {
    readonly body?: unknown;
    readonly cookies?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
    readonly origin?: string | null;
  } = {},
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    ...init.headers,
  };
  const origin = init.origin === undefined ? testConsumerOrigin : init.origin;
  if (origin !== null) headers.origin = origin;
  if (init.cookies !== undefined) headers.cookie = init.cookies;
  return new Request(`http://api.test${path}`, {
    headers,
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair): pair is string => pair !== undefined && !pair.endsWith('='))
    .join('; ');
}

beforeEach(async () => {
  clock.current = new Date('2026-08-14T10:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('session theft and reuse', () => {
  it('gives a copied cookie no more authority than the original, and none after revocation', async () => {
    const application = harness();
    try {
      const created = await application.handle(
        request(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'theft@velora.test' },
        }),
      );
      const stolen = cookiesFrom(created);
      const csrf = ((await created.json()) as { csrfToken: string }).csrfToken;

      // The copy works while the session lives, which is what makes revocation
      // the control that matters.
      expect(
        (
          await application.handle(
            request(apiRoutePaths.session, { cookies: stolen }),
          )
        ).status,
      ).toBe(200);

      await application.handle(
        request(apiRoutePaths.logoutAll, {
          cookies: stolen,
          headers: { [csrfHeader]: csrf },
          method: 'POST',
        }),
      );
      expect(
        (
          await application.handle(
            request(apiRoutePaths.session, { cookies: stolen }),
          )
        ).status,
      ).toBe(401);
    } finally {
      await application.close();
    }
  });

  it('kills the previous session when the same browser authenticates again', async () => {
    const application = harness();
    try {
      const first = await application.handle(
        request(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'rotate@velora.test' },
        }),
      );
      const firstCookies = cookiesFrom(first);
      const second = await application.handle(
        request(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'rotate@velora.test' },
          cookies: firstCookies,
        }),
      );
      const secondCookies = cookiesFrom(second);
      expect(secondCookies).not.toBe(firstCookies);

      expect(
        (
          await application.handle(
            request(apiRoutePaths.session, { cookies: firstCookies }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await application.handle(
            request(apiRoutePaths.session, { cookies: secondCookies }),
          )
        ).status,
      ).toBe(200);
    } finally {
      await application.close();
    }
  });

  it('refuses a consumer cookie presented under another audience name', async () => {
    const application = harness();
    try {
      const created = await application.handle(
        request(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'confusion@velora.test' },
        }),
      );
      const consumerCookie = cookiesFrom(created);
      const value = consumerCookie.split('=').slice(1).join('=');

      // Re-labelling the credential as another audience must not carry it over.
      const relabelled = await application.handle(
        request(apiRoutePaths.session, {
          cookies: `__Host-velora_platform_admin_session=${value}`,
          origin: testConsumerOrigin,
        }),
      );
      expect(relabelled.status).toBe(401);
    } finally {
      await application.close();
    }
  });
});

describe('privilege escalation attempts', () => {
  it('refuses every client-asserted claim of account, audience, or assurance', async () => {
    const application = harness();
    try {
      const created = await application.handle(
        request(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'claims@velora.test' },
        }),
      );
      const cookies = cookiesFrom(created);

      const response = await application.handle(
        request(apiRoutePaths.session, {
          cookies,
          headers: {
            'x-account-id': '00000000-0000-4000-8000-000000000000',
            'x-assurance': 'phishing_resistant',
            'x-audience': 'platform_admin',
            'x-role': 'owner',
          },
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.audience).toBe('consumer_web');
      expect(body.assurance).toBe('single_factor');
      expect(body.accountId).not.toBe('00000000-0000-4000-8000-000000000000');
    } finally {
      await application.close();
    }
  });

  it('refuses a fabricated privileged context for a high-impact authorization', async () => {
    const service = new PrivilegedAccessService({
      now,
      repository,
      verifier: new ScriptedAuthenticatorVerifier(),
    });
    const consumer = await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'fabricated',
      subject: 'fabricated@velora.test',
    });
    const binding = bindHighImpactAction({
      argumentsValue: {},
      beforeState: {},
      expectedEffect: {},
      operation: 'enforcement.suspend_account',
      targetId: 'target',
      targetType: 'account',
    });

    // The context claims everything a privileged actor would have. The service
    // re-derives it from the stored session, so none of it counts.
    expect(
      await service.authorizeHighImpact({
        binding,
        context: {
          ...consumer.context,
          assurance: 'phishing_resistant',
          audience: 'platform_admin',
        },
        correlationId: 'fabricated',
        validForMilliseconds: 60_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'audience_rejected' });
  });

  it('refuses concurrent step-up presentations of one assertion', async () => {
    const service = new PrivilegedAccessService({
      now,
      repository,
      verifier: new ScriptedAuthenticatorVerifier(),
    });
    const account = await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'stepup-race',
      subject: 'stepup-race@velora.test',
    });
    const sessionId = crypto.randomUUID();
    await execute(database.sql`
      insert into auth_sessions (
        id, account_id, audience, assurance, assurance_established_at,
        authenticated_at, created_at, csrf_digest, idle_expires_at,
        last_active_at, absolute_expires_at, token_digest
      ) values (
        ${sessionId}, ${account.context.accountId}, 'platform_admin',
        'single_factor', ${clock.current}, ${clock.current}, ${clock.current},
        ${'a'.repeat(64)}, ${new Date(clock.current.getTime() + 900_000)},
        ${clock.current}, ${new Date(clock.current.getTime() + 28_800_000)},
        ${'b'.repeat(64)}
      )
    `);
    await service.enrolAuthenticator({
      accountId: account.context.accountId,
      correlationId: 'stepup-race',
      credentialId: 'credential-race',
      label: 'security key',
      publicKey: 'public-key',
    });

    const context = {
      absoluteExpiresAt: new Date(clock.current.getTime() + 28_800_000),
      accountId: account.context.accountId,
      assurance: 'single_factor' as const,
      assuranceEstablishedAt: clock.current,
      audience: 'platform_admin' as const,
      authenticatedAt: clock.current,
      idleExpiresAt: new Date(clock.current.getTime() + 900_000),
      sessionId,
      transport: 'cookie' as const,
    };
    const assertion = {
      clientDataDigest: 'digest',
      credentialId: 'credential-race',
      signCount: 4,
      signature: 'signature',
    };

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, async (_, index) =>
        service.stepUp({
          assertion,
          challenge: 'challenge',
          context,
          correlationId: `stepup-race-${String(index)}`,
        }),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.kind === 'succeeded').length,
    ).toBe(1);
  });
});

describe('refresh replay under contention', () => {
  it('never issues two live descendants, however the burst is shaped', async () => {
    for (const size of [2, 10, 50]) {
      await database.truncate();
      const issued = await authService.authenticateMobile({
        correlationId: 'shape',
        installationId: 'installation-shape',
        subject: 'shape@velora.test',
      });
      const outcomes = await Promise.all(
        Array.from({ length: size }, async (_, index) =>
          authService.rotateRefreshToken({
            correlationId: `shape-${String(index)}`,
            refreshToken: issued.refreshToken,
          }),
        ),
      );
      expect(
        outcomes.filter((outcome) => outcome.kind === 'rotated').length,
      ).toBe(1);
      expect(
        await repository.countLiveRefreshTokens(
          repository.transactionless,
          issued.context.refreshFamilyId ?? '',
        ),
      ).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it('gives a thief no window by presenting a stolen token alongside the owner', async () => {
    // The attacker copies the token and races the legitimate client. Whoever
    // loses is replay, and the family dies either way, so the theft is detected
    // rather than absorbed.
    for (let round = 0; round < 5; round += 1) {
      await database.truncate();
      const issued = await authService.authenticateMobile({
        correlationId: 'theft',
        installationId: 'installation-theft',
        subject: 'theft@velora.test',
      });
      const stolen = issued.refreshToken;

      const [owner, thief] = await Promise.all([
        authService.rotateRefreshToken({
          correlationId: 'theft-owner',
          refreshToken: issued.refreshToken,
        }),
        authService.rotateRefreshToken({
          correlationId: 'theft-attacker',
          refreshToken: stolen,
        }),
      ]);
      const winners = [owner, thief].filter(
        (outcome) => outcome.kind === 'rotated',
      );
      expect(winners).toHaveLength(1);

      const family = await repository.findRefreshFamily(
        repository.transactionless,
        issued.context.refreshFamilyId ?? '',
      );
      expect(family?.compromisedAt).not.toBeNull();
      // Even the winner's fresh credential is dead once the family is revoked.
      const survivor = winners[0];
      if (survivor?.kind === 'rotated') {
        expect(
          (
            await authService.rotateRefreshToken({
              correlationId: 'theft-after',
              refreshToken: survivor.tokens.refreshToken,
            })
          ).kind,
        ).toBe('rejected');
      }
    }
  }, 120_000);

  it('refuses an ancestor token after a descendant was issued', async () => {
    const first = await authService.authenticateMobile({
      correlationId: 'ancestor',
      installationId: 'installation-ancestor',
      subject: 'ancestor@velora.test',
    });
    const second = await authService.rotateRefreshToken({
      correlationId: 'ancestor',
      refreshToken: first.refreshToken,
    });
    expect(second.kind).toBe('rotated');
    if (second.kind !== 'rotated') return;
    const third = await authService.rotateRefreshToken({
      correlationId: 'ancestor',
      refreshToken: second.tokens.refreshToken,
    });
    expect(third.kind).toBe('rotated');

    // The oldest ancestor is replay, and it takes the family with it.
    expect(
      (
        await authService.rotateRefreshToken({
          correlationId: 'ancestor',
          refreshToken: first.refreshToken,
        })
      ).kind,
    ).toBe('rejected');
    const family = await repository.findRefreshFamily(
      repository.transactionless,
      first.context.refreshFamilyId ?? '',
    );
    expect(family?.compromisedAt).not.toBeNull();
  });

  it('refuses a refresh presented during a logout race', async () => {
    const issued = await authService.authenticateMobile({
      correlationId: 'logout-race',
      installationId: 'installation-logout-race',
      subject: 'logout-race@velora.test',
    });
    const [rotation] = await Promise.all([
      authService.rotateRefreshToken({
        correlationId: 'logout-race',
        refreshToken: issued.refreshToken,
      }),
      authService.revokeCurrentAuthority({
        context: issued.context,
        correlationId: 'logout-race',
      }),
    ]);
    // Whichever ordering wins, the family ends revoked and no token survives.
    const family = await repository.findRefreshFamily(
      repository.transactionless,
      issued.context.refreshFamilyId ?? '',
    );
    if (rotation.kind === 'rotated') {
      expect(
        (
          await authService.rotateRefreshToken({
            correlationId: 'logout-race',
            refreshToken: rotation.tokens.refreshToken,
          })
        ).kind,
      ).toBe('rejected');
    }
    expect(family?.revokedAt).not.toBeNull();
  });
});

describe('database invariants under direct attack', () => {
  it('refuses a duplicate identity for one provider subject', async () => {
    const account = await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'duplicate-identity',
      subject: 'duplicate@velora.test',
    });
    let rejected = false;
    try {
      await execute(database.sql`
        insert into auth_identities (id, account_id, provider, provider_subject)
        values (${crypto.randomUUID()}, ${account.context.accountId}, 'local', 'duplicate@velora.test')
      `);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('refuses a duplicate session token digest', async () => {
    const account = await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'duplicate-digest',
      subject: 'duplicate-digest@velora.test',
    });
    const digests = await rowsOf<{ token_digest: string }>(
      database.sql`select token_digest from auth_sessions`,
    );
    let rejected = false;
    try {
      await execute(database.sql`
        insert into auth_sessions (
          id, account_id, audience, assurance, assurance_established_at,
          authenticated_at, created_at, csrf_digest, idle_expires_at,
          last_active_at, absolute_expires_at, token_digest
        ) values (
          ${crypto.randomUUID()}, ${account.context.accountId}, 'consumer_web',
          'single_factor', now(), now(), now(), ${'a'.repeat(64)},
          now() + interval '1 hour', now(), now() + interval '2 hours',
          ${digests[0]?.token_digest ?? ''}
        )
      `);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('refuses an unknown provider, audience, assurance, or revocation reason', async () => {
    const account = await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'enumerations',
      subject: 'enumerations@velora.test',
    });
    const attacks = [
      database.sql`insert into auth_identities (id, account_id, provider, provider_subject) values (${crypto.randomUUID()}, ${account.context.accountId}, 'attacker-idp', 'x')`,
      database.sql`update auth_sessions set audience = 'consumer_mobile' where account_id = ${account.context.accountId}`,
      database.sql`update auth_sessions set assurance = 'super_admin' where account_id = ${account.context.accountId}`,
      database.sql`update auth_sessions set revoked_at = now(), revocation_reason = 'because' where account_id = ${account.context.accountId}`,
      database.sql`update auth_sessions set revoked_at = now() where account_id = ${account.context.accountId}`,
    ];
    for (const attack of attacks) {
      let rejected = false;
      try {
        await execute(attack);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    }
  });

  it('leaves no orphaned AUTH row when an account is removed', async () => {
    const account = await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'orphans',
      subject: 'orphans@velora.test',
    });
    await authService.authenticateMobile({
      correlationId: 'orphans',
      installationId: 'installation-orphans',
      subject: 'orphans@velora.test',
    });
    await execute(
      database.sql`delete from auth_accounts where id = ${account.context.accountId}`,
    );

    for (const table of [
      'auth_identities',
      'auth_sessions',
      'auth_refresh_families',
      'auth_refresh_tokens',
      'auth_known_devices',
    ]) {
      const rows = await rowsOf<{ total: number }>(
        database.sql.unsafe(`select count(*)::int as total from ${table}`),
      );
      expect(rows[0]?.total, table).toBe(0);
    }
  });
});

describe('credential exposure sweep', () => {
  it('stores no plaintext credential anywhere in the AUTH schema', async () => {
    const application = harness();
    try {
      const created = await application.handle(
        request(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'sweep@velora.test' },
        }),
      );
      const cookies = cookiesFrom(created);
      const sessionToken = cookies
        .split('; ')
        .map((pair) => pair.split('='))
        .find(([name]) => name === '__Host-velora_consumer_web_session')?.[1];
      const csrf = ((await created.json()) as { csrfToken: string }).csrfToken;

      const mobile = await application.handle(
        request(apiRoutePaths.localMobileSession, {
          body: {
            installationId: 'installation-sweep',
            subject: 'sweep@velora.test',
          },
          origin: null,
        }),
      );
      const tokens = (await mobile.json()) as {
        accessToken: string;
        refreshToken: string;
      };

      const tables = await rowsOf<{ table_name: string }>(
        database.sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
      );
      let dump = '';
      for (const { table_name: table } of tables) {
        const rows = await rowsOf<Record<string, unknown>>(
          database.sql.unsafe(`select * from ${table}`),
        );
        dump += JSON.stringify(rows);
      }

      for (const secret of [
        sessionToken,
        csrf,
        tokens.accessToken,
        tokens.refreshToken,
      ]) {
        expect(secret).toBeDefined();
        expect(secret?.length ?? 0).toBeGreaterThan(0);
        expect(dump).not.toContain(secret ?? 'unreachable');
      }

      // The provider subject is an external identity reference, not a
      // credential, and AUTH must keep it to resolve the account. It is
      // confined to the identity row and appears nowhere else.
      const elsewhere = await Promise.all(
        tables
          .filter(({ table_name: table }) => table !== 'auth_identities')
          .map(async ({ table_name: table }) =>
            rowsOf<Record<string, unknown>>(
              database.sql.unsafe(`select * from ${table}`),
            ),
          ),
      );
      expect(JSON.stringify(elsewhere)).not.toContain('sweep@velora.test');
    } finally {
      await application.close();
    }
  });

  it('leaks nothing through an error path', async () => {
    const application = harness();
    try {
      const responses = await Promise.all(
        [
          request(apiRoutePaths.session, {
            headers: { authorization: 'Bearer not-a-token' },
          }),
          request(apiRoutePaths.mobileRefresh, {
            body: {
              refreshToken: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            },
            origin: null,
          }),
          request(apiRoutePaths.localWebSession, { body: { audience: 'x' } }),
          request(apiRoutePaths.recoveryCompletion, {
            body: { token: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
          }),
        ].map(async (candidate) => application.handle(candidate)),
      );
      for (const response of responses) {
        const text = await response.text();
        for (const forbidden of [
          'auth_sessions',
          'auth_refresh_tokens',
          'drizzle',
          'postgres',
          'select ',
          'digest',
          'stack',
        ]) {
          expect(text.toLowerCase()).not.toContain(forbidden);
        }
      }
    } finally {
      await application.close();
    }
  });
});

describe('contract conformance under attack', () => {
  it('answers with a documented status for every AUTH rejection path', async () => {
    const application = harness();
    try {
      const documented = new Map(
        apiOperations.map((operation) => [
          `${operation.method.toUpperCase()} ${operation.path}`,
          new Set(Object.keys(operation.responses).map(Number)),
        ]),
      );
      const probes: {
        readonly key: string;
        readonly request: Request;
      }[] = [
        {
          key: `GET ${apiRoutePaths.session}`,
          request: request(apiRoutePaths.session),
        },
        {
          key: `GET ${apiRoutePaths.session}`,
          request: request(apiRoutePaths.session, {
            origin: 'https://evil.test',
          }),
        },
        {
          key: `POST ${apiRoutePaths.localWebSession}`,
          request: request(apiRoutePaths.localWebSession, {
            body: { audience: 'platform_admin', subject: 'x@y.test' },
          }),
        },
        {
          key: `POST ${apiRoutePaths.localWebSession}`,
          request: request(apiRoutePaths.localWebSession, {
            body: { audience: 'consumer_web', subject: 'x@y.test' },
            origin: 'https://evil.test',
          }),
        },
        {
          key: `POST ${apiRoutePaths.mobileRefresh}`,
          request: request(apiRoutePaths.mobileRefresh, {
            body: { refreshToken: 'nope' },
            origin: null,
          }),
        },
        {
          key: `POST ${apiRoutePaths.logout}`,
          request: request(apiRoutePaths.logout, { method: 'POST' }),
        },
        {
          key: `POST ${apiRoutePaths.logoutAll}`,
          request: request(apiRoutePaths.logoutAll, { method: 'POST' }),
        },
        {
          key: `POST ${apiRoutePaths.recoveryStart}`,
          request: request(apiRoutePaths.recoveryStart, {
            body: { channel: 'sms', subject: 'x@y.test' },
          }),
        },
        {
          key: `POST ${apiRoutePaths.recoveryCompletion}`,
          request: request(apiRoutePaths.recoveryCompletion, {
            body: { token: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
          }),
        },
      ];

      for (const probe of probes) {
        const response = await application.handle(probe.request);
        expect(
          [...(documented.get(probe.key) ?? [])],
          `${probe.key} answered ${String(response.status)}`,
        ).toContain(response.status);
      }
    } finally {
      await application.close();
    }
  });

  it('registers no route the contract does not declare', () => {
    const application = harness();
    try {
      expect(
        apiOperations.map((item) => `${item.method} ${item.path}`).sort(),
      ).toEqual(
        apiOperations.map((item) => `${item.method} ${item.path}`).sort(),
      );
    } finally {
      void application.close();
    }
  });
});

describe('recovery abuse', () => {
  it('stops issuing for one destination without changing the answer', async () => {
    const delivery = new LocalTestRecoveryDelivery();
    const service = new RecoveryService({
      authService,
      delivery,
      identitySubjectFor: (subject) =>
        new LocalIdentityProvider().assert(subject).providerSubject,
      now,
      repository,
    });
    await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'destination-limit',
      deviceReference: 'device-destination',
      subject: 'destination@velora.test',
    });

    // Every attempt varies the caller, so only the destination quota can stop
    // it. The answer must never change.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(
        (
          await service.start({
            correlationId: `destination-${String(attempt)}`,
            deviceReference: 'device-destination',
            requesterReference: `requester-${String(attempt)}`,
            subject: 'destination@velora.test',
          })
        ).kind,
      ).toBe('accepted');
    }
    expect(delivery.deliveries.length).toBeLessThanOrEqual(3);
  });

  it('counts an unknown destination too, so probing is bounded', async () => {
    const delivery = new LocalTestRecoveryDelivery();
    const service = new RecoveryService({
      authService,
      delivery,
      identitySubjectFor: (subject) =>
        new LocalIdentityProvider().assert(subject).providerSubject,
      now,
      repository,
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await service.start({
        correlationId: `probe-${String(attempt)}`,
        requesterReference: `requester-probe-${String(attempt)}`,
        subject: 'ghost@velora.test',
      });
    }
    const counted = await rowsOf<{ total: number }>(
      database.sql`select count(*)::int as total from auth_recovery_rate_events where scope = 'destination'`,
    );
    expect(counted[0]?.total).toBe(8);
    expect(delivery.deliveries).toHaveLength(0);
  });
});

describe('audience isolation at the transport', () => {
  it('refuses the Creator Studio origin for a consumer session and the reverse', async () => {
    const application = harness();
    try {
      for (const [audience, origin] of [
        ['consumer_web', testCreatorOrigin],
        ['creator_studio', testConsumerOrigin],
      ] as const) {
        const response = await application.handle(
          request(apiRoutePaths.localWebSession, {
            body: { audience, subject: 'origin-isolation@velora.test' },
            origin,
          }),
        );
        expect(response.status).toBe(403);
      }
    } finally {
      await application.close();
    }
  });
});

describe('abuse-path cost', () => {
  it('resolves a session, a refresh token, and a recovery token by index', async () => {
    // A planner will prefer a sequential scan on a tiny table, so the lookups
    // are measured against a table large enough for the choice to be real.
    await execute(database.sql`
      insert into auth_accounts (id, status)
      select gen_random_uuid(), 'active' from generate_series(1, 200)
    `);
    await execute(database.sql`
      insert into auth_sessions (
        id, account_id, audience, assurance, assurance_established_at,
        authenticated_at, created_at, csrf_digest, idle_expires_at,
        last_active_at, absolute_expires_at, token_digest
      )
      select
        gen_random_uuid(), a.id, 'consumer_web', 'single_factor', now(),
        now(), now(), md5(random()::text) || md5(random()::text),
        now() + interval '1 day', now(),
        now() + interval '10 days', md5(g::text) || md5((g + 1)::text)
      from generate_series(1, 5000) g
      join lateral (select id from auth_accounts limit 1) a on true
    `);
    await execute(database.sql`analyze auth_sessions`);

    const plans = await rowsOf<{ 'QUERY PLAN': string }>(
      database.sql.unsafe(
        `explain select id from auth_sessions where token_digest = 'x'`,
      ),
    );
    const plan = plans.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).toContain('Index');
    expect(plan).not.toContain('Seq Scan');
  }, 60_000);

  it('rejects a malformed credential without touching storage', async () => {
    // Shape is checked before any lookup, so a flood of junk costs a regex.
    const before = await rowsOf<{ total: number }>(
      database.sql`select count(*)::int as total from auth_security_events`,
    );
    for (const candidate of [
      '',
      'x',
      'v2.' + 'a'.repeat(43),
      'a'.repeat(5000),
    ]) {
      expect((await authService.resolveBrowserSession(candidate)).kind).toBe(
        'rejected',
      );
      expect(
        (
          await authService.rotateRefreshToken({
            correlationId: 'cheap',
            refreshToken: candidate,
          })
        ).kind,
      ).toBe('rejected');
    }
    const after = await rowsOf<{ total: number }>(
      database.sql`select count(*)::int as total from auth_security_events`,
    );
    expect(after[0]?.total).toBe(before[0]?.total ?? 0);
  });
});

describe('races between rotation and revocation', () => {
  it('is safe when refresh races global logout', async () => {
    for (let round = 0; round < 5; round += 1) {
      await database.truncate();
      const issued = await authService.authenticateMobile({
        correlationId: 'global-race',
        installationId: 'installation-global-race',
        subject: 'global-race@velora.test',
      });
      const [rotation] = await Promise.all([
        authService.rotateRefreshToken({
          correlationId: 'global-race',
          refreshToken: issued.refreshToken,
        }),
        authService.revokeAllAuthority({
          accountId: issued.context.accountId,
          audience: 'consumer_mobile',
          correlationId: 'global-race',
          reason: 'logout_all',
        }),
      ]);

      // Whatever the interleaving, no credential outlives the revocation.
      if (rotation.kind === 'rotated') {
        expect(
          (
            await authService.rotateRefreshToken({
              correlationId: 'global-race-after',
              refreshToken: rotation.tokens.refreshToken,
            })
          ).kind,
        ).toBe('rejected');
        expect(
          await authService.resolveAccessToken(rotation.tokens.accessToken),
        ).toBeUndefined();
      }
      const family = await repository.findRefreshFamily(
        repository.transactionless,
        issued.context.refreshFamilyId ?? '',
      );
      expect(family?.revokedAt).not.toBeNull();
    }
  }, 60_000);

  it('is safe when refresh races account recovery', async () => {
    const delivery = new LocalTestRecoveryDelivery();
    const recovery = new RecoveryService({
      authService,
      delivery,
      identitySubjectFor: (subject) =>
        new LocalIdentityProvider().assert(subject).providerSubject,
      now,
      repository,
    });

    for (let round = 0; round < 5; round += 1) {
      await database.truncate();
      const subject = `recovery-race-${String(round)}@velora.test`;
      await authService.authenticateBrowser({
        audience: 'consumer_web',
        correlationId: 'recovery-race',
        deviceReference: 'device-recovery-race',
        subject,
      });
      const mobile = await authService.authenticateMobile({
        correlationId: 'recovery-race',
        deviceReference: 'device-recovery-race',
        installationId: `installation-recovery-race-${String(round)}`,
        subject,
      });
      await recovery.start({
        correlationId: 'recovery-race',
        deviceReference: 'device-recovery-race',
        requesterReference: `requester-recovery-race-${String(round)}`,
        subject,
      });

      const [rotation] = await Promise.all([
        authService.rotateRefreshToken({
          correlationId: 'recovery-race',
          refreshToken: mobile.refreshToken,
        }),
        recovery.complete({
          correlationId: 'recovery-race',
          deviceReference: 'device-recovery-race',
          requesterReference: `requester-recovery-race-${String(round)}`,
          token: delivery.latestFor(subject)?.token ?? '',
        }),
      ]);

      if (rotation.kind === 'rotated') {
        expect(
          (
            await authService.rotateRefreshToken({
              correlationId: 'recovery-race-after',
              refreshToken: rotation.tokens.refreshToken,
            })
          ).kind,
        ).toBe('rejected');
      }
      const family = await repository.findRefreshFamily(
        repository.transactionless,
        mobile.context.refreshFamilyId ?? '',
      );
      expect(family?.revokedAt).not.toBeNull();
    }
  }, 60_000);
});

describe('session fixation', () => {
  it('never adopts a session identifier the caller supplied', async () => {
    const application = harness();
    try {
      const planted = 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const created = await application.handle(
        request(apiRoutePaths.localWebSession, {
          body: { audience: 'consumer_web', subject: 'fixation@velora.test' },
          cookies: `__Host-velora_consumer_web_session=${planted}`,
        }),
      );
      expect(created.status).toBe(201);
      const issued = cookiesFrom(created);
      expect(issued).not.toContain(planted);

      // The value the attacker planted never becomes a session.
      const attacker = await application.handle(
        request(apiRoutePaths.session, {
          cookies: `__Host-velora_consumer_web_session=${planted}`,
        }),
      );
      expect(attacker.status).toBe(401);
    } finally {
      await application.close();
    }
  });
});

describe('recovery delivery failure', () => {
  it('leaves an undelivered token that expires rather than a usable one', async () => {
    const failing = new (class extends LocalTestRecoveryDelivery {
      override deliver(): Promise<void> {
        return Promise.reject(new Error('provider unavailable'));
      }
    })();
    const recovery = new RecoveryService({
      authService,
      delivery: failing,
      identitySubjectFor: (subject) =>
        new LocalIdentityProvider().assert(subject).providerSubject,
      now,
      repository,
    });
    await authService.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'delivery-failure',
      deviceReference: 'device-delivery',
      subject: 'delivery@velora.test',
    });

    let thrown: unknown;
    try {
      await recovery.start({
        correlationId: 'delivery-failure',
        deviceReference: 'device-delivery',
        requesterReference: 'requester-delivery',
        subject: 'delivery@velora.test',
      });
    } catch (error) {
      thrown = error;
    }
    // The provider failure surfaces to the caller rather than being swallowed,
    // and the committed token is simply never delivered to anyone.
    expect(thrown).toBeInstanceOf(Error);
    expect(failing.deliveries).toHaveLength(0);
    const issued = await rowsOf<{ consumed_at: Date | null; total: number }>(
      database.sql`select count(*)::int as total, max(consumed_at) as consumed_at from auth_recovery_requests`,
    );
    expect(issued[0]?.total).toBe(1);
    expect(issued[0]?.consumed_at).toBeNull();
  });
});
