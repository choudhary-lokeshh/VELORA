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

/**
 * AUTH adapters currently available. Each name is a development/test
 * implementation: no credential, social, OTP, passkey, or KMS provider has been
 * selected, and every one of them is `DEFER UNTIL PROVIDER INTEGRATION` in
 * `docs/decisions/DECISIONS_REQUIRED.md`. Staging and production reject them,
 * so a surface that needs real authentication fails closed rather than running
 * on a development stand-in.
 */
export const localIdentityProvider = 'local';
export const localAccessTokenSigner = 'local-development-ed25519';
export const localRecoveryDelivery = 'local-test';
export const unavailablePrivilegedVerifier = 'unavailable';

// A browser only ever sends a concrete host, so anything that is not a real
// hostname or IP literal is refused. That keeps a wildcard-looking entry such
// as `https://*.velora.test` out of the allowlist, where it would read as a
// pattern and silently match nothing.
const originHostPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$|^\[[0-9a-f:.]+\]$/u;

function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '' &&
      originHostPattern.test(url.hostname)
    );
  } catch {
    return false;
  }
}

const originListSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine(
    (origins) => origins.every(isExactOrigin),
    'Allowed browser origins must be exact scheme://host[:port] values',
  )
  .transform((origins): readonly string[] => [...new Set(origins)]);

/**
 * Key material is only shape-checked here. Whether the bytes are a usable
 * Ed25519 key is decided by the signing authority at composition, which fails
 * closed; duplicating that parse in configuration would put a second, weaker
 * opinion about key validity in the trust boundary.
 */
const minimumKeyMaterialBytes = 32;

function decodedLength(value: string): number | undefined {
  try {
    return atob(value.replaceAll('-', '+').replaceAll('_', '/')).length;
  } catch {
    return undefined;
  }
}

function isKeyMaterial(value: string): boolean {
  const length = decodedLength(value);
  return length !== undefined && length >= minimumKeyMaterialBytes;
}

// An empty value is the documented way to say "no key configured"; it must not
// be mistaken for a key that fails validation.
const signingKeySchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value.length === 0 ? undefined : value,
  )
  .refine(
    (value) => value === undefined || isKeyMaterial(value),
    'AUTH_ACCESS_TOKEN_SIGNING_KEY must be base64 PKCS8 Ed25519 key material',
  );

/**
 * Public keys retired from signing whose tokens must still verify. Listing a
 * key here is how a signing key is rotated without invalidating live access
 * tokens; removing one is how its tokens are revoked immediately.
 */
const verificationKeysSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine(
    (keys) => keys.every(isKeyMaterial),
    'AUTH_ACCESS_TOKEN_VERIFICATION_KEYS must be base64 SPKI Ed25519 public keys',
  )
  .transform((keys): readonly string[] => [...new Set(keys)]);

export const serverConfigSchema = z
  .object({
    APP_ENV: appEnvironmentSchema.default('local'),
    AUTH_ACCESS_TOKEN_SIGNER: z
      .enum([localAccessTokenSigner])
      .default(localAccessTokenSigner),
    AUTH_ACCESS_TOKEN_SIGNING_KEY: signingKeySchema,
    AUTH_ACCESS_TOKEN_VERIFICATION_KEYS: verificationKeysSchema,
    AUTH_BROWSER_ORIGINS_CONSUMER_WEB: originListSchema,
    AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: originListSchema,
    AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: originListSchema,
    AUTH_IDENTITY_PROVIDER: z
      .enum([localIdentityProvider])
      .default(localIdentityProvider),
    AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER: z
      .enum([unavailablePrivilegedVerifier])
      .default(unavailablePrivilegedVerifier),
    AUTH_RECOVERY_DELIVERY: z
      .enum([localRecoveryDelivery])
      .default(localRecoveryDelivery),
    AUTH_TOKEN_ISSUER: z.url().default('https://auth.velora.invalid'),
    DATABASE_URL: postgresUrlSchema,
    EPHEMERAL_REDIS_URL: redisUrlSchema,
    HOST: z.string().min(1).optional(),
    LOG_LEVEL: logLevelSchema.default('info'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    QUEUE_REDIS_URL: redisUrlSchema,
  })
  .superRefine((config, context) => {
    if (config.APP_ENV !== 'staging' && config.APP_ENV !== 'production') return;
    // Fail closed. A development identity adapter, a development signing key,
    // a test recovery sink, or an absent privileged authenticator verifier must
    // never carry real authentication authority, and no replacement provider is
    // approved yet, so these environments refuse to start at all.
    for (const [path, message] of [
      [
        'AUTH_IDENTITY_PROVIDER',
        'no production identity provider is approved; see DECISIONS_REQUIRED',
      ],
      [
        'AUTH_ACCESS_TOKEN_SIGNER',
        'no production signing authority is approved; see DECISIONS_REQUIRED',
      ],
      [
        'AUTH_RECOVERY_DELIVERY',
        'no production recovery delivery channel is approved; see DECISIONS_REQUIRED',
      ],
      [
        'AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER',
        'no phishing-resistant authenticator verifier is approved; see DECISIONS_REQUIRED',
      ],
    ] as const) {
      context.addIssue({
        code: 'custom',
        message: `${path} is not usable in ${config.APP_ENV}: ${message}`,
        path: [path],
      });
    }
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
    accessTokenSigner: config.AUTH_ACCESS_TOKEN_SIGNER,
    accessTokenSigningKeyConfigured:
      config.AUTH_ACCESS_TOKEN_SIGNING_KEY !== undefined,
    accessTokenVerificationKeyCount:
      config.AUTH_ACCESS_TOKEN_VERIFICATION_KEYS.length,
    appEnvironment: config.APP_ENV,
    browserOriginCount:
      config.AUTH_BROWSER_ORIGINS_CONSUMER_WEB.length +
      config.AUTH_BROWSER_ORIGINS_CREATOR_STUDIO.length +
      config.AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN.length,
    databaseConfigured: config.DATABASE_URL.length > 0,
    ephemeralRedisConfigured: config.EPHEMERAL_REDIS_URL.length > 0,
    host: config.HOST,
    identityProvider: config.AUTH_IDENTITY_PROVIDER,
    logLevel: config.LOG_LEVEL,
    port: config.PORT,
    privilegedAuthenticatorVerifier:
      config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER,
    queueRedisConfigured: config.QUEUE_REDIS_URL.length > 0,
    recoveryDelivery: config.AUTH_RECOVERY_DELIVERY,
    tokenIssuer: config.AUTH_TOKEN_ISSUER,
  } as const;
}

export { appEnvironmentSchema, logLevelSchema } from './shared.js';
export type { AppEnvironment } from './shared.js';
