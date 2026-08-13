import { describe, expect, it } from 'vitest';

import { browserSecurityHeaders, loadClientConfig } from '../src/client.js';
import { loadServerConfig, redactServerConfig } from '../src/server.js';

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
