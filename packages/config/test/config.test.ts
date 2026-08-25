import { describe, expect, it } from 'vitest';

import {
  browserSecurityHeaders,
  loadClientConfig,
  loopbackApiBaseUrl,
  resolveSurfaceConfig,
} from '../src/client.js';
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

  it('keeps Identity provider and jurisdiction policy separately fail-closed', () => {
    const defaults = loadServerConfig(validEnvironment);
    expect(defaults.IDENTITY_VERIFICATION_PROVIDER).toBe('unavailable');
    expect(defaults.IDENTITY_JURISDICTION_POLICY).toBe('unpublished');

    const local = loadServerConfig({
      ...validEnvironment,
      IDENTITY_JURISDICTION_POLICY: 'local-test',
      IDENTITY_VERIFICATION_PROVIDER: 'local-test',
    });
    expect(local.IDENTITY_VERIFICATION_PROVIDER).toBe('local-test');
    expect(local.IDENTITY_JURISDICTION_POLICY).toBe('local-test');

    for (const appEnvironment of ['staging', 'production']) {
      const failure = loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: appEnvironment,
        IDENTITY_JURISDICTION_POLICY: 'local-test',
        IDENTITY_VERIFICATION_PROVIDER: 'local-test',
      });
      expect(failure).toContain('IDENTITY_VERIFICATION_PROVIDER');
      expect(failure).toContain('IDENTITY_JURISDICTION_POLICY');
    }
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

  it('refuses the media platform in every deployed environment', () => {
    // Nothing set is the answer a deployed environment gets, and it refuses
    // every upload, read, write, deletion, delivery authorization, and purge.
    expect(loadServerConfig(validEnvironment).MEDIA_STORAGE_PROVIDER).toBe(
      'unavailable',
    );

    for (const environment of ['staging', 'production'] as const) {
      expect(
        loadServerConfigResult({
          ...validEnvironment,
          APP_ENV: environment,
          MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
          MEDIA_LOCAL_STORAGE_DIRECTORY: '/tmp/velora-media',
          MEDIA_STORAGE_PROVIDER: 'local-test',
        }),
        `media storage in ${environment}`,
      ).toContain('MEDIA_STORAGE_PROVIDER');
    }
  });

  it('refuses every media scanner in a deployed environment', () => {
    // The scanning position is undecided, not merely unimplemented, so a
    // refusal is the only honest value. Inspection turns that refusal into a
    // quarantine rather than a pass.
    expect(loadServerConfig(validEnvironment).MEDIA_MALWARE_SCANNER).toBe(
      'unavailable',
    );
    for (const environment of ['staging', 'production'] as const) {
      expect(
        loadServerConfigResult({
          ...validEnvironment,
          APP_ENV: environment,
          MEDIA_MALWARE_SCANNER: 'local-test',
        }),
        `media scanner in ${environment}`,
      ).toContain('MEDIA_MALWARE_SCANNER');
    }
  });

  it('will not run the development media adapter half-configured', () => {
    // A directory and a signing key or nothing. An adapter that fell back to a
    // temporary directory or a per-process key would work on one replica and
    // fail across two, which is the failure hardest to find later.
    expect(
      loadServerConfigResult({
        ...validEnvironment,
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
    ).toContain('MEDIA_LOCAL_STORAGE_DIRECTORY');
    expect(
      loadServerConfigResult({
        ...validEnvironment,
        MEDIA_LOCAL_STORAGE_DIRECTORY: '/tmp/velora-media',
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
    ).toContain('MEDIA_DELIVERY_SIGNING_KEY');
    // An injected empty string is absent, not configured.
    expect(
      loadServerConfigResult({
        ...validEnvironment,
        MEDIA_DELIVERY_SIGNING_KEY: '   ',
        MEDIA_LOCAL_STORAGE_DIRECTORY: '/tmp/velora-media',
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
    ).toContain('MEDIA_DELIVERY_SIGNING_KEY');
    expect(
      loadServerConfigResult({
        ...validEnvironment,
        MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
        MEDIA_LOCAL_STORAGE_DIRECTORY: '/tmp/velora-media',
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
    ).toBe('');
  });

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

  it('holds depicted-person evidence and consent wording as two gates', () => {
    // Provider availability and legal copy fail for different reasons. Neither
    // alone enables a mature-content path, and SAFETY configures only wording.
    const config = loadServerConfig(validEnvironment);
    expect(config.IDENTITY_VERIFICATION_PROVIDER).toBe('unavailable');
    expect(config.SAFETY_CONSENT_POLICY).toBe('unpublished');

    for (const appEnvironment of ['staging', 'production']) {
      const policy = loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: appEnvironment,
        SAFETY_CONSENT_POLICY: 'local-test',
      });
      expect(policy).toContain('SAFETY_CONSENT_POLICY');
      expect(policy).toContain('revocation withdraws');
    }
  });

  it('publishes no takedown deadline, and refuses to in a deployed environment', () => {
    // Inventing one is worse than having none: a hard-coded number would look
    // like compliance, carry no authority, and be the value an operator later
    // defended in writing.
    expect(loadServerConfig(validEnvironment).SAFETY_TAKEDOWN_POLICY).toBe(
      'unpublished',
    );
    for (const appEnvironment of ['staging', 'production']) {
      const failure = loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: appEnvironment,
        SAFETY_TAKEDOWN_POLICY: 'local-test',
      });
      expect(failure).toContain('SAFETY_TAKEDOWN_POLICY');
      expect(failure).toContain('carry no authority');
    }
  });

  it('publishes no appeal window, and refuses to in a deployed environment', () => {
    // A separate gate from the takedown deadlines, because the two are lifted
    // by different answers: one is how fast the platform must act on a claim,
    // the other is how long somebody keeps the right to contest what was
    // already decided. An appeal is still accepted with no window published;
    // what is absent is a date after which it would be refused, which is the
    // safer half of the question to leave open.
    expect(loadServerConfig(validEnvironment).SAFETY_APPEAL_POLICY).toBe(
      'unpublished',
    );
    for (const appEnvironment of ['staging', 'production']) {
      const failure = loadServerConfigResult({
        ...validEnvironment,
        APP_ENV: appEnvironment,
        SAFETY_APPEAL_POLICY: 'local-test',
      });
      expect(failure).toContain('SAFETY_APPEAL_POLICY');
      expect(failure).toContain('carry no authority');
    }
  });

  it('gives mature content one value, which is off, everywhere', () => {
    // Not a feature flag. A flag that could be flipped is enablement waiting
    // for an accident, and Apple treats a dormant remotely-enabled feature as a
    // violation in its own right, so the schema admits no other value at all —
    // in local and test as much as in production.
    expect(loadServerConfig(validEnvironment).SAFETY_MATURE_CONTENT).toBe(
      'disabled',
    );
    for (const appEnvironment of ['local', 'test', 'staging', 'production']) {
      expect(
        loadServerConfigResult({
          ...validEnvironment,
          APP_ENV: appEnvironment,
          SAFETY_MATURE_CONTENT: 'enabled',
        }),
        appEnvironment,
      ).toContain('SAFETY_MATURE_CONTENT');
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

  it('never reports media delivery key material when redacting', () => {
    const redacted = redactServerConfig(
      loadServerConfig({
        ...validEnvironment,
        MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
        MEDIA_LOCAL_STORAGE_DIRECTORY: '/tmp/velora-media',
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
    );

    expect(JSON.stringify(redacted)).not.toContain('development-only-key');
    expect(redacted.mediaDeliverySigningKeyConfigured).toBe(true);
    expect(redacted.mediaStorageProvider).toBe('local-test');
    expect(redacted.mediaMalwareScanner).toBe('unavailable');
  });

  it('reports only Identity adapter names when redacting configuration', () => {
    const redacted = redactServerConfig(
      loadServerConfig({
        ...validEnvironment,
        IDENTITY_JURISDICTION_POLICY: 'local-test',
        IDENTITY_VERIFICATION_PROVIDER: 'local-test',
      }),
    );
    expect(redacted.identityVerificationProvider).toBe('local-test');
    expect(redacted.identityJurisdictionPolicy).toBe('local-test');
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

  /**
   * The loopback address has more than one spelling, and the guard used to
   * know only two of them. It tested for the hostname `'::1'`, which `URL`
   * never produces — `http://[::1]:4000` arrives with the brackets attached —
   * so the IPv6 loopback was accepted in production while the header layer,
   * checking the bracketed form, treated the same address as local.
   *
   * Every case below is the loopback written differently. A deployed surface
   * accepting any of them points at an endpoint that exists nowhere and
   * publishes a Content-Security-Policy permitting it.
   */
  it.each([
    ['IPv6 loopback', 'http://[::1]:4000'],
    ['expanded IPv6 loopback', 'http://[0:0:0:0:0:0:0:1]:4000'],
    ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]:4000'],
    ['the mapped form already in hex', 'http://[::ffff:7f00:1]:4000'],
    ['another address in 127.0.0.0/8', 'http://127.0.0.2:4000'],
    ['IPv4 shorthand', 'http://127.1:4000'],
    ['the address as one integer', 'http://2130706433:4000'],
  ])('rejects %s when deployed', (_label, apiBaseUrl) => {
    for (const appEnvironment of ['staging', 'production']) {
      expect(() => loadClientConfig({ apiBaseUrl, appEnvironment })).toThrow(
        'cannot use localhost',
      );
    }
    // The same address is usable where a loopback endpoint is the point, and
    // is recognised as loopback there too: the upgrade directive is omitted
    // rather than left to break a plain-HTTP local API in WebKit.
    const headers = browserSecurityHeaders({
      apiBaseUrl,
      appEnvironment: 'local',
      referrerPolicy: 'same-origin',
    });
    expect(headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it('still accepts a real endpoint in every environment', () => {
    for (const appEnvironment of ['local', 'test', 'staging', 'production']) {
      expect(
        loadClientConfig({
          apiBaseUrl: 'https://api.velora.test',
          appEnvironment,
        }).apiBaseUrl,
      ).toBe('https://api.velora.test');
    }
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

describe('Next.js surface environment resolution', () => {
  it('falls back to the loopback API only where a loopback API is allowed', () => {
    expect(resolveSurfaceConfig({}).apiBaseUrl).toBe(loopbackApiBaseUrl);
    expect(resolveSurfaceConfig({ VELORA_APP_ENV: 'local' }).apiBaseUrl).toBe(
      loopbackApiBaseUrl,
    );
    expect(() => resolveSurfaceConfig({ NODE_ENV: 'production' })).toThrow();
    expect(() =>
      resolveSurfaceConfig({
        VELORA_API_BASE_URL: loopbackApiBaseUrl,
        VELORA_APP_ENV: 'production',
      }),
    ).toThrow();
  });

  it('reads the runtime signal only when nobody declared an environment', () => {
    expect(
      resolveSurfaceConfig({ NODE_ENV: 'development' }).appEnvironment,
    ).toBe('local');
    expect(
      resolveSurfaceConfig({
        NODE_ENV: 'production',
        VELORA_API_BASE_URL: 'https://api.velora.test',
      }).appEnvironment,
    ).toBe('production');
    // An explicit declaration outranks the runtime's guess in both directions.
    expect(
      resolveSurfaceConfig({
        NODE_ENV: 'production',
        VELORA_APP_ENV: 'staging',
        VELORA_API_BASE_URL: 'https://api.velora.test',
      }).appEnvironment,
    ).toBe('staging');
  });

  /**
   * The regression this function exists for.
   *
   * The origin a surface's pages call and the origin its
   * Content-Security-Policy permits are one fact. They were derived twice from
   * the same variables — resolved in `src/api.ts`, read raw in `middleware.ts`
   * — and a local surface with neither variable set therefore advertised
   * `connect-src 'self'` while serving pages that called the loopback API.
   * Every request the browser made was refused by the policy the same process
   * had just set, and it surfaced as the API being unreachable rather than as
   * a configuration mistake.
   *
   * Asserting the two agree is the only form of this test that would have
   * caught it: each half was individually correct.
   */
  it.each([
    ['nothing configured, as in local development', {}],
    ['an explicit local environment', { VELORA_APP_ENV: 'local' }],
    [
      'a deployed environment',
      {
        VELORA_API_BASE_URL: 'https://api.velora.test',
        VELORA_APP_ENV: 'production',
      },
    ],
    [
      'a deployed environment on a non-default port',
      {
        VELORA_API_BASE_URL: 'https://api.velora.test:8443',
        VELORA_APP_ENV: 'staging',
      },
    ],
  ])(
    'permits exactly the origin its pages will call, given %s',
    (_label, environment) => {
      const config = resolveSurfaceConfig(environment);
      const headers = browserSecurityHeaders({
        apiBaseUrl: config.apiBaseUrl,
        appEnvironment: config.appEnvironment,
        referrerPolicy: 'same-origin',
      });

      expect(headers['content-security-policy']).toContain(
        `connect-src 'self' ${new URL(config.apiBaseUrl).origin}`,
      );
    },
  );
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

  it('lets a page render an image from the origin it may call', () => {
    // Media delivery issues a signed address on whichever origin serves the
    // bytes, and today that is the API's own. A policy permitting the surface
    // to ask for one but not to render it would leave every person on the
    // platform drawn as an identity mark for a reason nothing surfaces.
    expect(policy({ apiBaseUrl: 'https://api.velora.test' })).toContain(
      "img-src 'self' data: https://api.velora.test",
    );
  });

  it('permits no image origin at all when there is no endpoint', () => {
    expect(policy()).toContain("img-src 'self' data:;");
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
