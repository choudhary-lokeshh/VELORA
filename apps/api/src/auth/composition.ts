import { createPrivateKey, createPublicKey } from 'node:crypto';

import {
  localAccessTokenSigner,
  localIdentityProvider,
  localRecoveryDelivery,
  unavailablePrivilegedVerifier,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import type { BrowserAuthAudience } from '@velora/validation';

import {
  Ed25519AccessTokenAuthority,
  type AccessTokenSigner,
} from './access-token.js';
import { CallerResolver } from './caller.js';
import {
  LocalIdentityProvider,
  UnavailablePrivilegedAuthenticatorVerifier,
  type IdentityProvider,
  type PrivilegedAuthenticatorVerifier,
} from './identity-provider.js';
import { PrivilegedAccessService } from './privileged.js';
import {
  LocalTestRecoveryDelivery,
  RecoveryService,
  type RecoveryDeliveryPort,
} from './recovery.js';
import { AuthRepository, type AuthDatabase } from './repository.js';
import { AuthRoutes } from './routes.js';
import { RedisRateLimiter, type RateLimiter } from './rate-limit.js';
import { AuthService } from './service.js';

export interface AuthRuntime {
  readonly allowedOrigins: Readonly<
    Record<BrowserAuthAudience, readonly string[]>
  >;
  /** Every origin any audience may use, for the CORS reply. */
  readonly allowedOriginUnion: readonly string[];
  /**
   * The one credential resolver. Product domains authorize with it rather than
   * re-deriving a caller from cookies and headers themselves.
   */
  readonly caller: CallerResolver;
  close(): Promise<void>;
  readonly privilegedAccess: PrivilegedAccessService;
  readonly recovery: RecoveryService;
  readonly recoveryDelivery: RecoveryDeliveryPort;
  readonly repository: AuthRepository;
  readonly routes: AuthRoutes;
  readonly service: AuthService;
}

export interface AuthRuntimeOptions {
  readonly now?: () => Date;
  /**
   * Replaces the phishing-resistant authenticator verifier. Only tests supply
   * one: no approved implementation exists, so the configured verifier refuses
   * every assertion and no environment can step up.
   */
  readonly privilegedVerifier?: PrivilegedAuthenticatorVerifier;
  readonly rateLimiter?: RateLimiter;
  /**
   * Resolves the per-request abuse-control subject. `X-Forwarded-For` is
   * deliberately never consulted: no reviewed edge or trusted-proxy
   * configuration exists yet (ADR-0014), so honouring it would hand every
   * caller a free rate-limit bypass. The device reference the client supplies
   * is the "IP or device baseline" ADR-0017 permits, and a caller that supplies
   * none shares one bucket rather than getting an unlimited private one.
   */
  readonly requesterReference?: (request: Request) => string;
}

/**
 * Adapter registries. A configured name with no entry is an error rather than a
 * default, so adding a provider means registering it here deliberately.
 */
const identityProviders: Readonly<Record<string, () => IdentityProvider>> = {
  [localIdentityProvider]: () => new LocalIdentityProvider(),
};

function selectIdentityProvider(config: ServerConfig): IdentityProvider {
  const build = identityProviders[config.AUTH_IDENTITY_PROVIDER];
  if (build === undefined) {
    throw new Error('No approved identity provider is configured');
  }
  return build();
}

const accessTokenSigners: Readonly<
  Record<
    string,
    (config: ServerConfig, logger: SafeLogger) => AccessTokenSigner
  >
> = {
  [localAccessTokenSigner]: (config, logger) =>
    buildLocalSigner(config, logger),
};

function selectAccessTokenSigner(
  config: ServerConfig,
  logger: SafeLogger,
): AccessTokenSigner {
  const build = accessTokenSigners[config.AUTH_ACCESS_TOKEN_SIGNER];
  if (build === undefined) {
    throw new Error('No approved access-token signing authority is configured');
  }
  return build(config, logger);
}

function buildLocalSigner(
  config: ServerConfig,
  logger: SafeLogger,
): AccessTokenSigner {
  const configured = config.AUTH_ACCESS_TOKEN_SIGNING_KEY;
  if (configured === undefined) {
    logger.warn(
      { signer: localAccessTokenSigner },
      'no access-token signing key configured; generating an ephemeral development key that does not survive restart',
    );
    return Ed25519AccessTokenAuthority.withGeneratedKey(
      config.AUTH_TOKEN_ISSUER,
    );
  }
  // Key material is parsed here, at the composition root, so malformed or
  // wrong-type material fails startup rather than surfacing at the first
  // authentication.
  return new Ed25519AccessTokenAuthority({
    additionalVerificationKeys: config.AUTH_ACCESS_TOKEN_VERIFICATION_KEYS.map(
      (key) =>
        createPublicKey({
          format: 'der',
          key: Buffer.from(key, 'base64'),
          type: 'spki',
        }),
    ),
    issuer: config.AUTH_TOKEN_ISSUER,
    signingKey: createPrivateKey({
      format: 'der',
      key: Buffer.from(configured, 'base64'),
      type: 'pkcs8',
    }),
  });
}

const recoveryDeliveries: Readonly<Record<string, () => RecoveryDeliveryPort>> =
  {
    [localRecoveryDelivery]: () => new LocalTestRecoveryDelivery(),
  };

function selectRecoveryDelivery(config: ServerConfig): RecoveryDeliveryPort {
  const build = recoveryDeliveries[config.AUTH_RECOVERY_DELIVERY];
  if (build === undefined) {
    throw new Error('No approved recovery delivery channel is configured');
  }
  return build();
}

const privilegedVerifiers: Readonly<
  Record<string, () => PrivilegedAuthenticatorVerifier>
> = {
  [unavailablePrivilegedVerifier]: () =>
    new UnavailablePrivilegedAuthenticatorVerifier(),
};

function selectPrivilegedVerifier(
  config: ServerConfig,
): PrivilegedAuthenticatorVerifier {
  const build =
    privilegedVerifiers[config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER];
  if (build === undefined) {
    throw new Error('No approved authenticator verifier is configured');
  }
  return build();
}

function defaultRequesterReference(request: Request): string {
  const device = request.headers.get('x-velora-device');
  if (device !== null && device.length > 0) return `device:${device}`;
  return 'unattributed';
}

/**
 * AUTH composition root. Adapter selection happens here and nowhere else, and
 * every selection is fail-closed: an environment with no approved provider gets
 * an error, never a development stand-in.
 */
export function createAuthRuntime(input: {
  readonly config: ServerConfig;
  readonly database: AuthDatabase;
  readonly logger: SafeLogger;
  readonly options?: AuthRuntimeOptions;
}): AuthRuntime {
  const now = input.options?.now ?? (() => new Date());
  const repository = new AuthRepository(input.database);
  const identityProvider = selectIdentityProvider(input.config);
  const localIdentityEnabled =
    identityProvider instanceof LocalIdentityProvider;
  const service = new AuthService({
    accessTokenSigner: selectAccessTokenSigner(input.config, input.logger),
    identityProvider,
    now,
    repository,
  });
  const recoveryDelivery = selectRecoveryDelivery(input.config);
  const recovery = new RecoveryService({
    authService: service,
    delivery: recoveryDelivery,
    identitySubjectFor: (subject) =>
      identityProvider.assert(subject).providerSubject,
    now,
    repository,
  });
  const privilegedAccess = new PrivilegedAccessService({
    now,
    repository,
    verifier:
      input.options?.privilegedVerifier ??
      selectPrivilegedVerifier(input.config),
  });
  const ownedRateLimiter =
    input.options?.rateLimiter ??
    new RedisRateLimiter(input.config.EPHEMERAL_REDIS_URL);
  const allowedOrigins: Record<BrowserAuthAudience, readonly string[]> = {
    consumer_web: input.config.AUTH_BROWSER_ORIGINS_CONSUMER_WEB,
    creator_studio: input.config.AUTH_BROWSER_ORIGINS_CREATOR_STUDIO,
    platform_admin: input.config.AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN,
  };
  const caller = new CallerResolver({ allowedOrigins, authService: service });

  return {
    allowedOrigins,
    allowedOriginUnion: [...new Set(Object.values(allowedOrigins).flat())],
    caller,
    async close() {
      if (input.options?.rateLimiter === undefined) {
        await ownedRateLimiter.close();
      }
    },
    privilegedAccess,
    recovery,
    recoveryDelivery,
    repository,
    routes: new AuthRoutes({
      allowedOrigins,
      appEnvironment: input.config.APP_ENV,
      authService: service,
      caller,
      localIdentityEnabled,
      logger: input.logger,
      now,
      rateLimiter: ownedRateLimiter,
      recoveryService: recovery,
      requesterReference:
        input.options?.requesterReference ?? defaultRequesterReference,
    }),
    service,
  };
}
