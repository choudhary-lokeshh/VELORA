import { describe, expect, it } from 'vitest';

import { loadClientConfig } from '../src/client.js';
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
