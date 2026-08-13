import { z } from 'zod';

import {
  appEnvironmentSchema,
  logLevelSchema,
  serviceUrlSchema,
} from './shared.js';

const postgresUrlSchema = serviceUrlSchema('DATABASE_URL', [
  'postgres:',
  'postgresql:',
]);
const redisUrlSchema = serviceUrlSchema('Redis URL', ['redis:', 'rediss:']);

export const serverConfigSchema = z
  .object({
    APP_ENV: appEnvironmentSchema.default('local'),
    DATABASE_URL: postgresUrlSchema,
    EPHEMERAL_REDIS_URL: redisUrlSchema,
    HOST: z.string().min(1).optional(),
    LOG_LEVEL: logLevelSchema.default('info'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    QUEUE_REDIS_URL: redisUrlSchema,
  })
  .transform((config) => ({
    ...config,
    HOST:
      config.HOST ??
      (config.APP_ENV === 'local' || config.APP_ENV === 'test'
        ? '127.0.0.1'
        : '0.0.0.0'),
  }))
  .readonly();

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function loadServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  return serverConfigSchema.parse(environment);
}

const migrationConfigSchema = z
  .object({
    DATABASE_URL: postgresUrlSchema,
  })
  .readonly();

export type MigrationConfig = z.infer<typeof migrationConfigSchema>;

export function loadMigrationConfig(
  environment: Readonly<Record<string, string | undefined>>,
): MigrationConfig {
  return migrationConfigSchema.parse(environment);
}

export function redactServerConfig(config: ServerConfig) {
  return {
    appEnvironment: config.APP_ENV,
    databaseConfigured: config.DATABASE_URL.length > 0,
    ephemeralRedisConfigured: config.EPHEMERAL_REDIS_URL.length > 0,
    host: config.HOST,
    logLevel: config.LOG_LEVEL,
    port: config.PORT,
    queueRedisConfigured: config.QUEUE_REDIS_URL.length > 0,
  } as const;
}

export { appEnvironmentSchema, logLevelSchema } from './shared.js';
export type { AppEnvironment } from './shared.js';
