import { createPrivateKey, createPublicKey } from 'node:crypto';

import {
  localAccessTokenSigner,
  localIdentityProvider,
  localRecoveryDelivery,
  localTestPrivilegedVerifier,
  managedAccessTokenSigner,
  oidcIdentityProvider,
  smtpRecoveryDelivery,
  unavailablePrivilegedVerifier,
  webauthnPrivilegedVerifier,
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
  LocalTestPrivilegedAuthenticatorVerifier,
  UnavailablePrivilegedAuthenticatorVerifier,
  type FederatedIdentityProvider,
  type IdentityProvider,
  type PrivilegedAuthenticatorVerifier,
} from './identity-provider.js';
import { requesterReferenceResolver } from '../http/forwarded.js';
import { AllowlistedOutboundHttp } from '../security/outbound-http.js';
import type { OutboundHttpPort } from '../security/ports.js';
import { OidcIdentityProvider } from './oidc.js';
import { TlsRequiredSmtpSubmission } from '../security/smtp-client.js';
import { SmtpRecoveryDelivery } from './smtp.js';
import { WebAuthnAuthenticatorVerifier } from './webauthn.js';
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
  /**
   * The provider when it can actually authenticate a browser, and undefined
   * when it cannot. The development adapter has no ceremony, so the federated
   * routes are absent rather than present and refusing — a surface asking where
   * to send somebody gets a clear answer either way.
   */
  readonly federatedIdentity: FederatedIdentityProvider | undefined;
  readonly privilegedAccess: PrivilegedAccessService;
  readonly recovery: RecoveryService;
  readonly recoveryDelivery: RecoveryDeliveryPort;
  readonly repository: AuthRepository;
  readonly routes: AuthRoutes;
  readonly service: AuthService;
}

export interface AuthRuntimeOptions {
  readonly now?: () => Date;
  /** Replaces the outbound HTTP adapter. Only a contract harness supplies one. */
  readonly outboundHttp?: OutboundHttpPort;
  /**
   * Replaces the phishing-resistant authenticator verifier. Only tests supply
   * one: no approved implementation exists, so the configured verifier refuses
   * every assertion and no environment can step up.
   */
  readonly privilegedVerifier?: PrivilegedAuthenticatorVerifier;
  readonly rateLimiter?: RateLimiter;
  /**
   * Resolves the per-request abuse-control subject. `X-Forwarded-For` is
   * consulted only when `TRUSTED_PROXY_HOP_COUNT` says how many proxies are in
   * front, and then only at the position that count names — see
   * `http/forwarded.ts` for why any other reading is either a bypass or a
   * shared bucket. With no proxies configured the header is ignored entirely
   * and the device reference the client supplies is the "IP or device baseline"
   * ADR-0017 permits.
   */
  readonly requesterReference?: (request: Request) => string;
}

/**
 * Adapter registries. A configured name with no entry is an error rather than a
 * default, so adding a provider means registering it here deliberately.
 */
const identityProviders: Readonly<
  Record<
    string,
    (config: ServerConfig, http: OutboundHttpPort) => IdentityProvider
  >
> = {
  [localIdentityProvider]: () => new LocalIdentityProvider(),
  [oidcIdentityProvider]: (config, http) =>
    new OidcIdentityProvider({
      // Configuration guarantees all four are present when this adapter is
      // selected, in every environment, so an absent one here is a schema bug
      // rather than a state to degrade into.
      clientId: required(config.AUTH_OIDC_CLIENT_ID, 'AUTH_OIDC_CLIENT_ID'),
      clientSecret: required(
        config.AUTH_OIDC_CLIENT_SECRET,
        'AUTH_OIDC_CLIENT_SECRET',
      ),
      http,
      issuer: required(config.AUTH_OIDC_ISSUER, 'AUTH_OIDC_ISSUER'),
      redirectUri: required(
        config.AUTH_OIDC_REDIRECT_URI,
        'AUTH_OIDC_REDIRECT_URI',
      ),
    }),
};

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required by the selected adapter`);
  }
  return value;
}

function selectIdentityProvider(
  config: ServerConfig,
  http: OutboundHttpPort,
): IdentityProvider {
  const build = identityProviders[config.AUTH_IDENTITY_PROVIDER];
  if (build === undefined) {
    throw new Error('No approved identity provider is configured');
  }
  return build(config, http);
}

function asFederated(
  provider: IdentityProvider,
): FederatedIdentityProvider | undefined {
  return provider instanceof OidcIdentityProvider ? provider : undefined;
}

const accessTokenSigners: Readonly<
  Record<
    string,
    (config: ServerConfig, logger: SafeLogger) => AccessTokenSigner
  >
> = {
  [localAccessTokenSigner]: (config, logger) =>
    buildLocalSigner(config, logger),
  [managedAccessTokenSigner]: (config) => buildManagedSigner(config),
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

/**
 * The deployable signer.
 *
 * Same Ed25519 authority the local one uses, with the property that made the
 * local one undeployable removed: there is no generated key and no fallback.
 * Configuration has already refused this selection without key material, so
 * absence here is a schema bug rather than a state to recover from.
 */
function buildManagedSigner(config: ServerConfig): AccessTokenSigner {
  const configured = required(
    config.AUTH_ACCESS_TOKEN_SIGNING_KEY,
    'AUTH_ACCESS_TOKEN_SIGNING_KEY',
  );
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

const recoveryDeliveries: Readonly<
  Record<string, (config: ServerConfig) => RecoveryDeliveryPort>
> = {
  [localRecoveryDelivery]: () => new LocalTestRecoveryDelivery(),
  [smtpRecoveryDelivery]: (config) =>
    new SmtpRecoveryDelivery({
      senderAddress: required(
        config.AUTH_RECOVERY_SENDER_ADDRESS,
        'AUTH_RECOVERY_SENDER_ADDRESS',
      ),
      submission: new TlsRequiredSmtpSubmission({
        submissionUrl: required(
          config.AUTH_RECOVERY_SMTP_URL,
          'AUTH_RECOVERY_SMTP_URL',
        ),
      }),
    }),
};

function selectRecoveryDelivery(config: ServerConfig): RecoveryDeliveryPort {
  const build = recoveryDeliveries[config.AUTH_RECOVERY_DELIVERY];
  if (build === undefined) {
    throw new Error('No approved recovery delivery channel is configured');
  }
  return build(config);
}

const privilegedVerifiers: Readonly<
  Record<string, (config: ServerConfig) => PrivilegedAuthenticatorVerifier>
> = {
  [localTestPrivilegedVerifier]: () =>
    new LocalTestPrivilegedAuthenticatorVerifier(),
  [unavailablePrivilegedVerifier]: () =>
    new UnavailablePrivilegedAuthenticatorVerifier(),
  [webauthnPrivilegedVerifier]: (config) =>
    new WebAuthnAuthenticatorVerifier({
      origins: config.AUTH_WEBAUTHN_ORIGINS,
      relyingPartyId: required(
        config.AUTH_WEBAUTHN_RELYING_PARTY_ID,
        'AUTH_WEBAUTHN_RELYING_PARTY_ID',
      ),
    }),
};

function selectPrivilegedVerifier(
  config: ServerConfig,
): PrivilegedAuthenticatorVerifier {
  const build =
    privilegedVerifiers[config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER];
  if (build === undefined) {
    throw new Error('No approved authenticator verifier is configured');
  }
  return build(config);
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
  const identityProvider = selectIdentityProvider(
    input.config,
    // Loopback destinations are permitted only where a contract harness stands
    // a provider up in this process. A deployed environment refuses them, so a
    // configuration naming one fails rather than reaching something local.
    input.options?.outboundHttp ??
      new AllowlistedOutboundHttp({
        allowLoopback:
          input.config.APP_ENV === 'local' || input.config.APP_ENV === 'test',
      }),
  );
  const federatedIdentity = asFederated(identityProvider);
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
    logger: input.logger,
    identitySubjectFor: (subject) =>
      identityProvider.assert(subject).providerSubject,
    now,
    repository,
  });
  const verifier =
    input.options?.privilegedVerifier ?? selectPrivilegedVerifier(input.config);
  const privilegedAccess = new PrivilegedAccessService({
    now,
    repository,
    verifier,
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
    federatedIdentity,
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
      ...(federatedIdentity === undefined ? {} : { federatedIdentity }),
      localIdentityEnabled,
      logger: input.logger,
      privilegedAccess,
      repository,
      ...(input.config.AUTH_WEBAUTHN_RELYING_PARTY_ID === undefined
        ? {}
        : {
            webAuthnRelyingPartyId: input.config.AUTH_WEBAUTHN_RELYING_PARTY_ID,
          }),
      now,
      privilegedVerifier: verifier,
      rateLimiter: ownedRateLimiter,
      recoveryService: recovery,
      requesterReference:
        input.options?.requesterReference ??
        requesterReferenceResolver({
          trustedProxyHopCount: input.config.TRUSTED_PROXY_HOP_COUNT,
        }),
    }),
    service,
  };
}
