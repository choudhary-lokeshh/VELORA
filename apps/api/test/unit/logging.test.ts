import { describe, expect, it } from 'bun:test';
import { createLogger } from '@velora/observability/server';

function outputFor(fields: Readonly<Record<string, unknown>>, message: string) {
  let output = '';
  const destination = {
    write(value: string) {
      output += value;
    },
  };
  const logger = createLogger(
    { level: 'info', serviceName: 'logging-test' },
    destination,
  );
  logger.info(fields, message);
  return output;
}

describe('structured logging redaction', () => {
  it('redacts root, nested, and deeply nested secrets while preserving safe fields', () => {
    const output = outputFor(
      {
        access_token: 'root-access',
        apiKey: 'root-api-key',
        currentPassword: 'old-password',
        databaseUrl: 'postgresql://user:db-secret@db/velora',
        nested: {
          refreshToken: 'nested-refresh',
          safe: 'keep-me',
          deeper: { token: 'deep-token' },
        },
        password: 'root-password',
      },
      'safe message',
    );

    for (const secret of [
      'root-access',
      'root-api-key',
      'old-password',
      'db-secret',
      'nested-refresh',
      'deep-token',
      'root-password',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('keep-me');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts secret query values and secret-bearing URLs in errors', () => {
    const namedError = new Error(
      'failed https://example.com/callback?access_token=error-secret',
    );
    namedError.name = 'token=error-name-secret';
    const output = outputFor(
      {
        error: namedError,
        url: 'https://example.com/path?safe=visible&refresh_token=query-secret#access_token=fragment-secret',
      },
      'request failed: password=plain-secret, authorization: Bearer bearer-secret; https://example.com/?api_key=message-secret',
    );

    expect(output).not.toContain('error-secret');
    expect(output).not.toContain('error-name-secret');
    expect(output).not.toContain('query-secret');
    expect(output).not.toContain('fragment-secret');
    expect(output).not.toContain('plain-secret');
    expect(output).not.toContain('bearer-secret');
    expect(output).not.toContain('message-secret');
    expect(output).toContain('visible');
  });

  it('redacts arbitrary credential keys and bounds adversarial object depth', () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let depth = 0; depth < 20; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    cursor.password = 'unreachable-deep-secret';

    const output = outputFor(
      {
        clientSecret: 'client-secret-value',
        credentials: 'credential-value',
        deeplyNested,
        private_key: 'private-key-value',
        proxyAuthorization: 'proxy-authorization-value',
      },
      'safe message',
    );

    for (const secret of [
      'client-secret-value',
      'credential-value',
      'unreachable-deep-secret',
      'private-key-value',
      'proxy-authorization-value',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[MAX_DEPTH]');
  });
});
