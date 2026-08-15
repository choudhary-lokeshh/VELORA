import { describe, expect, it } from 'vitest';

import { browserSecurityHeaders, loadClientConfig } from '../src/client.js';
import { loadServerConfig, redactServerConfig } from '../src/server.js';

/** Returns the failure message so a test can assert which gate refused. */
function loadServerConfigResult(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  try {
    loadServerConfig(environment);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const validEnvironment = {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/velora',
  EPHEMERAL_REDIS_URL: 'redis://127.0.0.1:6379/0',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  PORT: '4000',
  QUEUE_REDIS_URL: 'redis://127.0.0.1:6379/1',
} as const;

describe('server configuration', () => {
  it('parses typed configuration and keeps Redis duties separate', () => {
    const config = loadServerConfig(validEnvironment);

    expect(config.APP_ENV).toBe('test');
    expect(config.PORT).toBe(4000);
    expect(config.EPHEMERAL_REDIS_URL).not.toBe(config.QUEUE_REDIS_URL);
  });

  it('fails startup for invalid protected service URLs', () => {
    expect(() =>
      loadServerConfig({
        ...validEnvironment,
        DATABASE_URL: 'https://example.com/database',
      }),
    ).toThrow();
  });

  it('refuses every unapproved provider adapter in deployed environments', () => {
    for (const appEnvironment of ['staging', 'production']) {
      const failure = loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: appEnvironment,
      });
      // Every AUTH adapter currently available is a development or test one,
      // so a deployed environment refuses to start rather than running on one.
      expect(failure).toContain('AUTH_IDENTITY_PROVIDER');
      expect(failure).toContain('AUTH_ACCESS_TOKEN_SIGNER');
      expect(failure).toContain('AUTH_RECOVERY_DELIVERY');
      expect(failure).toContain('AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER');
    }
  });

  it('defaults adult assurance to the verifier that refuses everything', () => {
    const config = loadServerConfig(validEnvironment);
    expect(config.USERS_ADULT_ASSURANCE_VERIFIER).toBe('unavailable');
  });

  it('permits the local-test assurance adapter only outside deployed environments', () => {
    expect(
      loadServerConfig({
        ...validEnvironment,
        USERS_ADULT_ASSURANCE_VERIFIER: 'local-test',
      }).USERS_ADULT_ASSURANCE_VERIFIER,
    ).toBe('local-test');
    expect(
      loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: 'production',
        USERS_ADULT_ASSURANCE_VERIFIER: 'local-test',
      }),
    ).toContain('USERS_ADULT_ASSURANCE_VERIFIER');
  });

  /**
   * Every seam that could move money, refused in every deployed environment.
   *
   * This is what "live money movement is blocked" actually rests on. Each of
   * these refusals exists in the loader, and until now not one of them was
   * asserted anywhere — which is the same state the payout overdraw trigger was
   * in before it turned out to have never run. An enforcement nothing exercises
   * is an enforcement nobody notices has stopped.
   *
   * The `local-test` adapters are deterministic and reach no network, but they
   * fabricate successful payments, priced offers, and paid instructions. One of
   * them reachable in production would mean fake paid subscriptions and a
   * creator balance nobody was ever charged for.
   */
  const moneySeams = [
    ['BILLING_COMMERCE_ELIGIBILITY', 'local-test', 'unavailable'],
    ['BILLING_COMMERCE_POLICY', 'local-test', 'unpublished'],
    ['BILLING_PAYMENT_PROVIDER', 'local-test', 'unavailable'],
    ['BILLING_TAX_AUTHORITY', 'local-test', 'unavailable'],
    ['CLUBS_BILLING_ENTITLEMENT', 'local-test', 'unavailable'],
    ['PAYOUTS_POLICY', 'local-test', 'unpublished'],
    ['PAYOUTS_PROVIDER', 'local-test', 'unavailable'],
  ] as const;

  for (const [seam, live, blocked] of moneySeams) {
    it(`defaults ${seam} to the adapter that refuses, and blocks the other when deployed`, () => {
      // What a deployed environment gets when nobody sets anything.
      expect(
        loadServerConfig(validEnvironment)[
          seam as keyof ReturnType<typeof loadServerConfig>
        ],
      ).toBe(blocked);

      // Usable where money cannot actually move.
      expect(
        loadServerConfig({ ...validEnvironment, [seam]: live })[
          seam as keyof ReturnType<typeof loadServerConfig>
        ],
      ).toBe(live);

      // And refused in both deployed environments, by name.
      for (const environment of ['staging', 'production'] as const) {
        expect(
          loadServerConfigResult({
            ...validEnvironment,
            APP_ENV: environment,
            [seam]: live,
          }),
          `${seam} in ${environment}`,
        ).toContain(seam);
      }
    });
  }

  it('defaults safety eligibility to the source that denies everything', () => {
    // Message retention duration and post-block history visibility are both
    // undecided, so messaging in a deployed environment refuses to carry a
    // message rather than carrying one under a policy nobody has approved.
    const config = loadServerConfig(validEnvironment);
    expect(config.MESSAGING_SAFETY_ELIGIBILITY).toBe('unavailable');
  });

  it('permits the real safety source only outside deployed environments', () => {
    expect(
      loadServerConfig({
        ...validEnvironment,
        MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
      }).MESSAGING_SAFETY_ELIGIBILITY,
    ).toBe('trust-and-safety');
    // The block store existing does not by itself unblock production: the
    // blocker is the open legal decision, and naming it in the message keeps
    // that visible to whoever hits it.
    for (const appEnvironment of ['staging', 'production']) {
      const failure = loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: appEnvironment,
        MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
      });
      expect(failure).toContain('MESSAGING_SAFETY_ELIGIBILITY');
      expect(failure).toContain('retention');
    }
  });

  it('defaults notification delivery to the channel that sends nothing', () => {
    // No email, push, or SMS provider is approved. `unavailable` does not
    // discard a notice: it reports that no attempt was made, so the notice
    // stays owed in PostgreSQL and is deliverable once a provider exists.
    const config = loadServerConfig(validEnvironment);
    expect(config.NOTIFICATIONS_DELIVERY_CHANNEL).toBe('unavailable');
  });

  it('permits the development notification channel only outside deployed environments', () => {
    expect(
      loadServerConfig({
        ...validEnvironment,
        NOTIFICATIONS_DELIVERY_CHANNEL: 'local-test',
      }).NOTIFICATIONS_DELIVERY_CHANNEL,
    ).toBe('local-test');
    for (const appEnvironment of ['staging', 'production']) {
      const failure = loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: appEnvironment,
        NOTIFICATIONS_DELIVERY_CHANNEL: 'local-test',
      });
      expect(failure).toContain('NOTIFICATIONS_DELIVERY_CHANNEL');
      expect(failure).toContain('DECISIONS_REQUIRED');
    }
  });

  it('redacts every connection string', () => {
    const redacted = redactServerConfig(loadServerConfig(validEnvironment));
    const output = JSON.stringify(redacted);

    expect(output).not.toContain('local@');
    expect(output).not.toContain('6379');
    expect(redacted.databaseConfigured).toBe(true);
    expect(redacted.queueRedisConfigured).toBe(true);
  });
});

describe('client configuration', () => {
  it.each(['file:///tmp/api', 'data:text/plain,hello', 'javascript:alert(1)'])(
    'rejects unsupported protocol %s',
    (apiBaseUrl) => {
      expect(() =>
        loadClientConfig({ apiBaseUrl, appEnvironment: 'local' }),
      ).toThrow();
    },
  );

  it('allows a localhost default only for explicit local/test use', () => {
    expect(
      loadClientConfig({
        appEnvironment: 'local',
        localDefaultApiBaseUrl: 'http://127.0.0.1:4000',
      }).apiBaseUrl,
    ).toBe('http://127.0.0.1:4000');
    expect(() =>
      loadClientConfig({
        appEnvironment: 'production',
        localDefaultApiBaseUrl: 'http://127.0.0.1:4000',
      }),
    ).toThrow('required outside explicit local/test');
  });

  it('rejects localhost in staging and production', () => {
    expect(() =>
      loadClientConfig({
        apiBaseUrl: 'http://localhost:4000',
        appEnvironment: 'staging',
      }),
    ).toThrow('cannot use localhost');
  });
});

describe('AUTH provider configuration', () => {
  it('defaults to the development adapters in local and test', () => {
    const config = loadServerConfig(validEnvironment);

    expect(config.AUTH_IDENTITY_PROVIDER).toBe('local');
    expect(config.AUTH_ACCESS_TOKEN_SIGNER).toBe('local-development-ed25519');
    expect(config.AUTH_RECOVERY_DELIVERY).toBe('local-test');
    expect(config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER).toBe('unavailable');
  });

  it.each(['staging', 'production'])(
    'fails closed in %s because no real AUTH provider is approved',
    (appEnvironment) => {
      let thrown: unknown;
      try {
        loadServerConfig({ ...validEnvironment, APP_ENV: appEnvironment });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = String(thrown);
      expect(message).toContain('AUTH_IDENTITY_PROVIDER');
      expect(message).toContain('AUTH_ACCESS_TOKEN_SIGNER');
      expect(message).toContain('AUTH_RECOVERY_DELIVERY');
      expect(message).toContain('AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER');
    },
  );

  it('accepts only exact browser origins', () => {
    const config = loadServerConfig({
      ...validEnvironment,
      AUTH_BROWSER_ORIGINS_CONSUMER_WEB:
        'http://127.0.0.1:3000, https://web.velora.test , http://127.0.0.1:3000',
    });
    expect(config.AUTH_BROWSER_ORIGINS_CONSUMER_WEB).toEqual([
      'http://127.0.0.1:3000',
      'https://web.velora.test',
    ]);
    expect(config.AUTH_BROWSER_ORIGINS_CREATOR_STUDIO).toEqual([]);
  });

  it.each([
    'https://web.velora.test/',
    'https://web.velora.test/path',
    'https://web.velora.test?query=1',
    'https://*.velora.test',
    'velora.test',
    'ftp://web.velora.test',
  ])('rejects %s as a browser origin', (origin) => {
    expect(() =>
      loadServerConfig({
        ...validEnvironment,
        AUTH_BROWSER_ORIGINS_CONSUMER_WEB: origin,
      }),
    ).toThrow();
  });

  it('accepts retired verification keys so a signing key can be rotated', () => {
    const config = loadServerConfig({
      ...validEnvironment,
      AUTH_ACCESS_TOKEN_VERIFICATION_KEYS: `${Buffer.alloc(44, 2).toString('base64')}, ${Buffer.alloc(44, 3).toString('base64')}`,
    });
    expect(config.AUTH_ACCESS_TOKEN_VERIFICATION_KEYS).toHaveLength(2);
    expect(
      loadServerConfig(validEnvironment).AUTH_ACCESS_TOKEN_VERIFICATION_KEYS,
    ).toEqual([]);
    expect(() =>
      loadServerConfig({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_VERIFICATION_KEYS: 'not-key-material',
      }),
    ).toThrow();
  });

  it('rejects a signing key with insufficient material', () => {
    expect(() =>
      loadServerConfig({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_SIGNING_KEY: Buffer.alloc(31, 1).toString('base64'),
      }),
    ).toThrow();
    expect(
      loadServerConfig({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_SIGNING_KEY: Buffer.alloc(32, 1).toString('base64'),
      }).AUTH_ACCESS_TOKEN_SIGNING_KEY,
    ).toBeDefined();
  });

  it('never reports signing key material when redacting', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    const redacted = redactServerConfig(
      loadServerConfig({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_SIGNING_KEY: key,
      }),
    );
    expect(JSON.stringify(redacted)).not.toContain(key);
    expect(redacted.accessTokenSigningKeyConfigured).toBe(true);
  });
});

describe('browser security headers', () => {
  const policy = (
    overrides: Partial<Parameters<typeof browserSecurityHeaders>[0]> = {},
  ) =>
    browserSecurityHeaders({ referrerPolicy: 'same-origin', ...overrides })[
      'content-security-policy'
    ] ?? '';

  it('names the exact API origin and never a wildcard', () => {
    expect(policy({ apiBaseUrl: 'https://api.velora.test' })).toContain(
      "connect-src 'self' https://api.velora.test",
    );
    expect(policy()).toContain("connect-src 'self';");
    expect(policy({ apiBaseUrl: 'https://api.velora.test' })).not.toContain(
      '*',
    );
  });

  it.each([
    ['production with an https API', 'production', 'https://api.velora.test'],
    ['staging with an https API', 'staging', 'https://api.velora.test'],
    [
      'production with a plain-HTTP API',
      'production',
      'http://api.velora.test',
    ],
    ['local with an https API', 'local', 'https://api.velora.test'],
    ['local with a non-loopback HTTP API', 'local', 'http://api.velora.test'],
    ['no environment at all', undefined, 'http://127.0.0.1:4100'],
    ['no API endpoint at all', 'local', undefined],
  ])(
    'upgrades insecure requests for %s',
    (_label, appEnvironment, apiBaseUrl) => {
      expect(policy({ apiBaseUrl, appEnvironment })).toContain(
        'upgrade-insecure-requests',
      );
    },
  );

  it.each(['local', 'test'])(
    'omits the upgrade directive only for %s against a loopback API',
    (appEnvironment) => {
      for (const apiBaseUrl of [
        'http://127.0.0.1:4100',
        'http://localhost:4100',
      ]) {
        expect(policy({ apiBaseUrl, appEnvironment })).not.toContain(
          'upgrade-insecure-requests',
        );
      }
    },
  );

  it('keeps every other directive unconditional', () => {
    const local = policy({
      apiBaseUrl: 'http://127.0.0.1:4100',
      appEnvironment: 'local',
    });
    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
    ]) {
      expect(local).toContain(directive);
    }
  });

  it('adds the Admin robots directive and nothing else by default', () => {
    expect(
      browserSecurityHeaders({ referrerPolicy: 'same-origin' })['x-robots-tag'],
    ).toBeUndefined();
    expect(
      browserSecurityHeaders({
        referrerPolicy: 'no-referrer',
        robots: 'noindex, nofollow, noarchive',
      })['x-robots-tag'],
    ).toBe('noindex, nofollow, noarchive');
  });
});
