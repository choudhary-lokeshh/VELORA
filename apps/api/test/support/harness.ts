import { loadServerConfig, type ServerConfig } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import { drizzle } from 'drizzle-orm/bun-sql';

import {
  createAuthRuntime,
  type AuthRuntime,
} from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import type { AuthDatabase } from '../../src/auth/repository.js';

export const testConsumerOrigin = 'http://127.0.0.1:3000';
export const testCreatorOrigin = 'http://127.0.0.1:3001';
export const testAdminOrigin = 'http://127.0.0.1:3002';
export const testForeignOrigin = 'https://evil.test';

export function silentLogger(records: unknown[] = []): SafeLogger {
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

/**
 * Builds a configuration through the real schema, so a test can never assert
 * against a shape the production loader would refuse.
 */
export function testServerConfig(
  overrides: Readonly<Record<string, string | undefined>> = {},
): ServerConfig {
  return loadServerConfig({
    APP_ENV: 'test',
    AUTH_BROWSER_ORIGINS_CONSUMER_WEB: testConsumerOrigin,
    AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: testCreatorOrigin,
    AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: testAdminOrigin,
    DATABASE_URL: 'postgresql://local:local@127.0.0.1:1/velora',
    EPHEMERAL_REDIS_URL: 'redis://127.0.0.1:1/0',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    PORT: '4000',
    QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
    ...overrides,
  });
}

export function testAuthRuntime(input: {
  readonly config: ServerConfig;
  readonly database?: AuthDatabase;
  readonly logger?: SafeLogger;
  readonly now?: () => Date;
}): AuthRuntime {
  return createAuthRuntime({
    config: input.config,
    // `drizzle.mock()` has no connection, so any query throws. Tests that only
    // exercise pre-database rejections use it; behaviour that touches storage
    // runs against real PostgreSQL in the integration suite.
    database: input.database ?? drizzle.mock(),
    logger: input.logger ?? silentLogger(),
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      ...(input.now === undefined ? {} : { now: input.now }),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'test-requester',
    },
  });
}
