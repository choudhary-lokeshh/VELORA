import { createHash, randomBytes } from 'node:crypto';

import type { AppEnvironment } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import {
  apiErrorSchema,
  authAcknowledgementSchema,
  authErrorCodes,
  authSessionResponseSchema,
  deviceHeader,
  federatedAuthorizationRequestSchema,
  federatedAuthorizationResponseSchema,
  localAdminSessionRequestSchema,
  privilegedChallengeRequestSchema,
  privilegedChallengeResponseSchema,
  privilegedEnrolmentRequestSchema,
  privilegedEnrolmentResponseSchema,
  privilegedStepUpRequestSchema,
  localMobileSessionRequestSchema,
  localWebSessionRequestSchema,
  maximumAuthRequestBodyBytes,
  mobileRefreshRequestSchema,
  mobileTokenResponseSchema,
  productErrorCodes,
  recoveryCompletionRequestSchema,
  recoveryStartRequestSchema,
  type AuthErrorCode,
  type BrowserAuthAudience,
} from '@velora/validation';

import {
  csrfCookie,
  expiredCookiesFor,
  type CallerResolver,
  type ResolvedCaller,
} from './caller.js';
import { AuthorizationError, type AuthContext } from './context.js';
import {
  clearedFederatedStateCookie,
  issuedFederatedStateCookie,
  issuedSessionCookie,
  presentedFederatedState,
  presentedSessionCookie,
} from './cookies.js';
import type {
  FederatedIdentityProvider,
  PrivilegedAuthenticatorVerifier,
} from './identity-provider.js';
import { authMechanismConstants } from './policy.js';
import type { PrivilegedAccessService } from './privileged.js';
import { authAttemptLimits, type RateLimiter } from './rate-limit.js';
import type { RecoveryService } from './recovery.js';
import type { AuthRepository } from './repository.js';
import type { AuthService } from './service.js';
import { digestsEqual, digestToken, generateOpaqueToken } from './tokens.js';

export interface AuthRouteRequest {
  readonly body: string;
  readonly correlationId: string;
  readonly request: Request;
}

export interface AuthRouteResult {
  readonly body: unknown;
  readonly cookies?: readonly string[];
  /** Only a redirect uses this. See `RouteResult` for why it exists at all. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface AuthRoutesDependencies {
  readonly allowedOrigins: Readonly<
    Record<BrowserAuthAudience, readonly string[]>
  >;
  readonly appEnvironment: AppEnvironment;
  readonly authService: AuthService;
  readonly caller: CallerResolver;
  /** Present only when the configured provider can authenticate a browser. */
  readonly federatedIdentity?: FederatedIdentityProvider | undefined;
  readonly localIdentityEnabled: boolean;
  readonly privilegedAccess: PrivilegedAccessService;
  readonly repository: AuthRepository;
  /**
   * The relying party a browser must scope its ceremony to. Absent when the
   * configured verifier is not the WebAuthn one, which is what makes the
   * privileged routes refuse rather than issue a challenge nothing can answer.
   */
  readonly webAuthnRelyingPartyId?: string | undefined;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly privilegedVerifier?: PrivilegedAuthenticatorVerifier | undefined;
  readonly rateLimiter: RateLimiter;
  readonly recoveryService: RecoveryService;
  readonly requesterReference: (request: Request) => string;
}

function failure(
  status: number,
  code: AuthErrorCode | typeof productErrorCodes.actionNotPermitted,
  correlationId: string,
  cookies?: readonly string[],
): AuthRouteResult {
  return {
    body: apiErrorSchema.parse({
      code,
      correlationId,
      // One generic message for every rejection. The stable code tells a client
      // what to do; nothing tells it anything about accounts or storage.
      message: 'Request failed',
    }),
    ...(cookies === undefined ? {} : { cookies }),
    status,
  };
}

/**
 * A browser redirect and nothing else: a status, a destination, and no body.
 *
 * `303` rather than `302`, so the browser issues a GET for the destination
 * whatever method brought it here, and so a person who reloads the page they
 * land on does not replay a callback.
 */
function redirect(location: string): AuthRouteResult {
  return { body: undefined, headers: { location }, status: 303 };
}

/**
 * The same destination, marked as a sign-in that did not complete.
 *
 * The surface reads the marker and says so; this side deliberately does not say
 * why, because the difference between a person declining consent, a provider
 * refusing, and a forged code is information about this platform's trust
 * decisions.
 */
function refusedDestination(destination: string): string {
  try {
    const url = new URL(destination);
    url.searchParams.set('velora_auth', 'refused');
    return url.toString();
  } catch {
    return destination;
  }
}

/**
 * Structural view of a contract schema. AUTH validates with the published
 * contract schemas without the API taking a runtime dependency on the schema
 * library, which the workspace dependency policy does not approve for it.
 */
interface ContractSchema<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

function parseBody<T>(
  schema: ContractSchema<T>,
  raw: string,
): { readonly ok: true; readonly value: T } | { readonly ok: false } {
  if (raw.length > maximumAuthRequestBodyBytes) return { ok: false };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

function sessionBody(
  context: AuthContext,
  csrfToken?: string,
): ReturnType<typeof authSessionResponseSchema.parse> {
  return authSessionResponseSchema.parse({
    absoluteExpiresAt: context.absoluteExpiresAt.toISOString(),
    accountId: context.accountId,
    assurance: context.assurance,
    assuranceEstablishedAt: context.assuranceEstablishedAt.toISOString(),
    audience: context.audience,
    authenticatedAt: context.authenticatedAt.toISOString(),
    ...(csrfToken === undefined ? {} : { csrfToken }),
    idleExpiresAt: context.idleExpiresAt.toISOString(),
  });
}

function optionalHeader(request: Request, name: string): string | undefined {
  const value = request.headers.get(name);
  return value === null || value.length === 0 ? undefined : value;
}

/**
 * AUTH HTTP handlers. Every one of them derives authority from stored state and
 * from the credential presented; no handler reads a role, an account id, an
 * audience, or an assurance level out of the request.
 */
export class AuthRoutes {
  constructor(private readonly dependencies: AuthRoutesDependencies) {}

  private get caller(): CallerResolver {
    return this.dependencies.caller;
  }

  private get localIdentityUsable(): boolean {
    const { appEnvironment, localIdentityEnabled } = this.dependencies;
    // Two independent gates. Configuration already refuses the local adapter in
    // staging and production; this repeats the decision at the edge so a
    // mis-wired composition root still cannot expose it.
    return (
      localIdentityEnabled &&
      (appEnvironment === 'local' || appEnvironment === 'test')
    );
  }

  private async throttle(
    bucket: keyof typeof authAttemptLimits,
    request: Request,
    correlationId: string,
  ): Promise<boolean> {
    const limit = authAttemptLimits[bucket];
    const decision = await this.dependencies.rateLimiter.consume({
      bucket,
      limit: limit.limit,
      subject: this.dependencies.requesterReference(request),
      windowSeconds: limit.windowSeconds,
    });
    if (decision.degraded) {
      this.dependencies.logger.warn(
        { bucket, correlationId },
        'auth rate limiter unavailable; PostgreSQL invariants remain authoritative',
      );
    }
    return decision.allowed;
  }

  private browserVerdict(
    request: Request,
    audience: BrowserAuthAudience,
    cookiePresent: boolean,
  ): AuthErrorCode | undefined {
    return this.caller.browserVerdict(request, audience, cookiePresent);
  }

  async createLocalWebSession(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    if (!this.localIdentityUsable) {
      return failure(403, authErrorCodes.identityDisabled, input.correlationId);
    }
    if (
      !(await this.throttle('authenticate', input.request, input.correlationId))
    ) {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    const parsed = parseBody(localWebSessionRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }
    const rejection = this.browserVerdict(
      input.request,
      parsed.value.audience,
      false,
    );
    if (rejection !== undefined) {
      return failure(403, rejection, input.correlationId);
    }

    // Re-authenticating in a browser that already holds a session for this
    // audience rotates it rather than leaving the previous one live.
    const presented = presentedSessionCookie(
      input.request.headers.get('cookie'),
    );
    const issued = await this.dependencies.authService.authenticateBrowser({
      audience: parsed.value.audience,
      correlationId: input.correlationId,
      deviceReference:
        parsed.value.deviceId ?? optionalHeader(input.request, deviceHeader),
      subject: parsed.value.subject,
      ...(presented?.audience === parsed.value.audience
        ? { supersedeSessionToken: presented.token }
        : {}),
    });
    const now = this.dependencies.now();
    const maxAgeSeconds = Math.max(
      0,
      Math.floor(
        (issued.context.absoluteExpiresAt.getTime() - now.getTime()) / 1000,
      ),
    );
    return {
      body: sessionBody(issued.context, issued.csrfToken),
      cookies: [
        issuedSessionCookie({
          audience: parsed.value.audience,
          expiresAt: issued.context.absoluteExpiresAt,
          now,
          token: issued.sessionToken,
        }),
        csrfCookie(parsed.value.audience, issued.csrfToken, maxAgeSeconds),
      ],
      status: 201,
    };
  }

  async createLocalAdminSession(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    if (
      !this.localIdentityUsable ||
      this.dependencies.privilegedVerifier?.kind !== 'local-test-privileged'
    ) {
      return failure(403, authErrorCodes.identityDisabled, input.correlationId);
    }
    if (
      !(await this.throttle('authenticate', input.request, input.correlationId))
    ) {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    const parsed = parseBody(localAdminSessionRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }
    const rejection = this.browserVerdict(
      input.request,
      'platform_admin',
      false,
    );
    if (rejection !== undefined) {
      return failure(403, rejection, input.correlationId);
    }

    const presented = presentedSessionCookie(
      input.request.headers.get('cookie'),
    );
    const issued = await this.dependencies.authService.authenticateBrowser({
      assuranceOverride: 'phishing_resistant',
      audience: 'platform_admin',
      correlationId: input.correlationId,
      deviceReference:
        parsed.value.deviceId ?? optionalHeader(input.request, deviceHeader),
      subject: parsed.value.subject,
      ...(presented?.audience === 'platform_admin'
        ? { supersedeSessionToken: presented.token }
        : {}),
    });
    const now = this.dependencies.now();
    const maxAgeSeconds = Math.max(
      0,
      Math.floor(
        (issued.context.absoluteExpiresAt.getTime() - now.getTime()) / 1000,
      ),
    );
    return {
      body: sessionBody(issued.context, issued.csrfToken),
      cookies: [
        issuedSessionCookie({
          audience: 'platform_admin',
          expiresAt: issued.context.absoluteExpiresAt,
          now,
          token: issued.sessionToken,
        }),
        csrfCookie('platform_admin', issued.csrfToken, maxAgeSeconds),
      ],
      status: 201,
    };
  }

  /**
   * Opens a federated sign-in.
   *
   * Everything single-use about the attempt is minted here and committed
   * before the browser is sent anywhere: the state the provider will echo back,
   * the nonce the ID token must carry, and the PKCE verifier the code exchange
   * will need. An attempt that existed only after the provider answered would
   * be an attempt nothing had committed to.
   *
   * The audience in the body is a request, not a selection. It is checked
   * against the origin the request actually came from, so a page on the
   * consumer origin cannot open an attempt that would end in a Platform Admin
   * session.
   */
  async createFederatedAuthorization(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    const provider = this.dependencies.federatedIdentity;
    if (provider === undefined) {
      return failure(
        501,
        authErrorCodes.federatedUnavailable,
        input.correlationId,
      );
    }
    if (
      !(await this.throttle('authenticate', input.request, input.correlationId))
    ) {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    const parsed = parseBody(federatedAuthorizationRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }
    const rejection = this.browserVerdict(
      input.request,
      parsed.value.audience,
      false,
    );
    if (rejection !== undefined) {
      return failure(403, rejection, input.correlationId);
    }
    // The verdict above already required the origin to be one this deployment
    // allows for this audience, so reading it here is reading a value that has
    // been checked rather than trusting a header.
    const origin = input.request.headers.get('origin');
    if (origin === null) {
      return failure(403, authErrorCodes.originRejected, input.correlationId);
    }

    const state = generateOpaqueToken();
    const nonce = generateOpaqueToken();
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier, 'utf8')
      .digest('base64url');
    const now = this.dependencies.now();
    const expiresAt = new Date(
      now.getTime() +
        authMechanismConstants.federatedAuthorizationLifetimeMilliseconds,
    );

    let authorizationUrl: string;
    try {
      authorizationUrl = await provider.authorizationUrl({
        codeChallenge,
        nonce,
        state,
      });
    } catch (error) {
      // A provider that cannot be reached is an availability fact, not a
      // decision about this caller, and nothing about it belongs in the answer.
      this.dependencies.logger.error(
        { correlationId: input.correlationId, error },
        'federated authorization could not be opened',
      );
      return failure(
        501,
        authErrorCodes.federatedUnavailable,
        input.correlationId,
      );
    }

    await this.dependencies.repository.createFederatedAuthorization({
      audience: parsed.value.audience,
      codeVerifier,
      createdAt: now,
      expiresAt,
      nonce,
      returnTo: `${origin}${parsed.value.returnTo ?? '/'}`,
      stateDigest: digestToken(state),
    });

    return {
      body: federatedAuthorizationResponseSchema.parse({
        authorizationUrl,
        expiresAt: expiresAt.toISOString(),
      }),
      // The attempt is bound to this browser. Without it the callback would
      // accept any code and state pair from any browser, which is how somebody
      // hands a victim a session for an account that is not theirs.
      cookies: [
        issuedFederatedStateCookie(
          state,
          Math.floor(
            authMechanismConstants.federatedAuthorizationLifetimeMilliseconds /
              1000,
          ),
        ),
      ],
      status: 201,
    };
  }

  /**
   * The address the provider returns a browser to.
   *
   * It is a top-level navigation this platform did not compose, so nothing in
   * the query is trusted for anything except finding the attempt: the state is
   * looked up as a digest and claimed by a conditional update, and every other
   * value is checked against what that row already said. A state naming no open
   * attempt has no destination to return to and is the one case that answers
   * with a body instead of a redirect.
   */
  async completeFederatedAuthorization(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    const provider = this.dependencies.federatedIdentity;
    if (provider === undefined) {
      return failure(
        501,
        authErrorCodes.federatedUnavailable,
        input.correlationId,
      );
    }
    const query = new URL(input.request.url).searchParams;
    const state = query.get('authorizationState');
    if (state === null || state.length === 0) {
      return failure(400, authErrorCodes.validationFailed, input.correlationId);
    }
    // The same browser, or nobody. The cookie was set on this origin when the
    // attempt was opened, so a browser that did not open it cannot present one.
    const bound = presentedFederatedState(input.request.headers.get('cookie'));
    if (
      bound === undefined ||
      !digestsEqual(digestToken(bound), digestToken(state))
    ) {
      return failure(
        400,
        authErrorCodes.validationFailed,
        input.correlationId,
        [clearedFederatedStateCookie()],
      );
    }
    const now = this.dependencies.now();
    const attempt =
      await this.dependencies.repository.consumeFederatedAuthorization({
        now,
        stateDigest: digestToken(state),
      });
    if (attempt === undefined) {
      return failure(
        400,
        authErrorCodes.validationFailed,
        input.correlationId,
        [clearedFederatedStateCookie()],
      );
    }
    const destination = attempt.returnTo ?? '/';
    // Consumed either way. The attempt is over the moment it is claimed, and a
    // stale binding left in the browser is a value with nothing behind it.
    const releaseBinding = [clearedFederatedStateCookie()];

    const code = query.get('authorizationCode');
    if (query.get('authorizationError') !== null || code === null) {
      return {
        ...redirect(refusedDestination(destination)),
        cookies: releaseBinding,
      };
    }

    const assertion = await provider.completeAuthorization({
      code,
      codeVerifier: attempt.codeVerifier,
      nonce: attempt.nonce,
    });
    if (assertion === undefined) {
      return {
        ...redirect(refusedDestination(destination)),
        cookies: releaseBinding,
      };
    }

    const audience = attempt.audience as BrowserAuthAudience;
    const presented = presentedSessionCookie(
      input.request.headers.get('cookie'),
    );
    const issued = await this.dependencies.authService.authenticateBrowser({
      audience,
      correlationId: input.correlationId,
      deviceReference: optionalHeader(input.request, deviceHeader),
      subject: assertion.providerSubject,
      ...(presented?.audience === audience
        ? { supersedeSessionToken: presented.token }
        : {}),
    });
    const maxAgeSeconds = Math.max(
      0,
      Math.floor(
        (issued.context.absoluteExpiresAt.getTime() - now.getTime()) / 1000,
      ),
    );
    return {
      ...redirect(destination),
      cookies: [
        ...releaseBinding,
        issuedSessionCookie({
          audience,
          expiresAt: issued.context.absoluteExpiresAt,
          now,
          token: issued.sessionToken,
        }),
        csrfCookie(audience, issued.csrfToken, maxAgeSeconds),
      ],
    };
  }

  /**
   * Issues a single-use challenge for one privileged ceremony.
   *
   * Bound to the operator and to the ceremony at the moment it is written, so a
   * challenge issued for an enrolment cannot be answered with an assertion and
   * a challenge issued to one operator cannot be presented by another. It is
   * durable rather than in-memory because single use is the whole of the
   * anti-replay property and a control that a restart forgets is not one.
   */
  async createPrivilegedChallenge(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    const resolved = await this.requirePrivilegedCaller(input);
    if ('failure' in resolved) return resolved.failure;
    const relyingPartyId = this.dependencies.webAuthnRelyingPartyId;
    if (relyingPartyId === undefined) {
      return failure(
        501,
        authErrorCodes.federatedUnavailable,
        input.correlationId,
      );
    }
    const parsed = parseBody(privilegedChallengeRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }

    const challenge = randomBytes(32).toString('base64url');
    const now = this.dependencies.now();
    const expiresAt = new Date(
      now.getTime() +
        authMechanismConstants.privilegedChallengeLifetimeMilliseconds,
    );
    await this.dependencies.repository.createPrivilegedChallenge({
      accountId: resolved.context.accountId,
      challengeDigest: digestToken(challenge),
      createdAt: now,
      expiresAt,
      purpose: parsed.value.purpose,
    });
    const credentialIds =
      await this.dependencies.privilegedAccess.listCredentialIds(
        resolved.context.accountId,
      );

    return {
      body: privilegedChallengeResponseSchema.parse({
        challenge,
        credentialIds,
        expiresAt: expiresAt.toISOString(),
        relyingPartyId,
      }),
      status: 201,
    };
  }

  /**
   * Enrols a phishing-resistant authenticator for the calling operator.
   *
   * The challenge is consumed first and the registration is verified against
   * it, so a credential can only be enrolled by somebody who held a live
   * Platform Admin session at the moment this server issued the challenge. What
   * is stored is the credential the verifier returned, never the one the
   * request named.
   */
  async enrolPrivilegedAuthenticator(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    const resolved = await this.requirePrivilegedCaller(input);
    if ('failure' in resolved) return resolved.failure;
    const verifier = this.dependencies.privilegedVerifier;
    if (verifier === undefined) {
      return failure(
        501,
        authErrorCodes.federatedUnavailable,
        input.correlationId,
      );
    }
    const parsed = parseBody(privilegedEnrolmentRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }
    const consumed =
      await this.dependencies.repository.consumePrivilegedChallenge({
        accountId: resolved.context.accountId,
        challengeDigest: digestToken(parsed.value.challenge),
        now: this.dependencies.now(),
        purpose: 'enrolment',
      });
    if (!consumed) {
      return failure(
        409,
        authErrorCodes.privilegedChallengeInvalid,
        input.correlationId,
      );
    }
    const verified = await verifier.register({
      challenge: parsed.value.challenge,
      registration: {
        algorithm: parsed.value.algorithm,
        authenticatorData: parsed.value.authenticatorData,
        clientDataJSON: parsed.value.clientDataJSON,
        credentialId: parsed.value.credentialId,
        publicKey: parsed.value.publicKey,
      },
    });
    if (verified === undefined) {
      return failure(
        409,
        authErrorCodes.privilegedVerificationFailed,
        input.correlationId,
      );
    }

    let authenticatorId: string;
    try {
      authenticatorId =
        await this.dependencies.privilegedAccess.enrolAuthenticator({
          context: resolved.context,
          correlationId: input.correlationId,
          credentialId: verified.credentialId,
          label: parsed.value.label,
          publicKey: verified.publicKey,
          ...(parsed.value.attachment === undefined
            ? {}
            : { attachment: parsed.value.attachment }),
        });
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      // An operator who already holds a key adds another only after proving
      // one of them recently. The refusal is the same one every privileged
      // route gives for stale assurance, so it says nothing about why.
      return failure(
        403,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }
    const readiness =
      await this.dependencies.privilegedAccess.productionReadiness(
        resolved.context.accountId,
      );

    return {
      body: privilegedEnrolmentResponseSchema.parse({
        authenticatorId,
        enrolled: readiness.enrolled,
        ready: readiness.ready,
      }),
      status: 201,
    };
  }

  /**
   * Re-establishes phishing-resistant assurance on a Platform Admin session.
   *
   * Every privileged write checks the assurance this refreshes and its age, so
   * this is the one route that decides whether an operator can act at all.
   */
  async stepUpPrivilegedSession(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    const resolved = await this.requirePrivilegedCaller(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseBody(privilegedStepUpRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }
    const consumed =
      await this.dependencies.repository.consumePrivilegedChallenge({
        accountId: resolved.context.accountId,
        challengeDigest: digestToken(parsed.value.challenge),
        now: this.dependencies.now(),
        purpose: 'assertion',
      });
    if (!consumed) {
      return failure(
        409,
        authErrorCodes.privilegedChallengeInvalid,
        input.correlationId,
      );
    }
    const outcome = await this.dependencies.privilegedAccess.stepUp({
      assertion: {
        authenticatorData: parsed.value.authenticatorData,
        clientDataJSON: parsed.value.clientDataJSON,
        credentialId: parsed.value.credentialId,
        signature: parsed.value.signature,
      },
      challenge: parsed.value.challenge,
      context: resolved.context,
      correlationId: input.correlationId,
    });
    if (outcome.kind !== 'succeeded') {
      return failure(
        409,
        authErrorCodes.privilegedVerificationFailed,
        input.correlationId,
      );
    }
    const refreshed = await this.dependencies.authService.resolveBrowserSession(
      resolved.sessionToken,
    );
    if (refreshed.kind !== 'active') {
      return failure(401, authErrorCodes.required, input.correlationId);
    }
    return { body: sessionBody(refreshed.context), status: 200 };
  }

  /**
   * The caller every privileged ceremony requires: a live Platform Admin
   * browser session, from an allowed origin, with its CSRF companion presented.
   *
   * Assurance is deliberately *not* required here. Enrolment and step-up are
   * how an operator reaches phishing-resistant assurance in the first place, so
   * demanding it would close the only door to itself. A second and later
   * enrolment does require it, and AUTH's service decides that, not this.
   */
  private async requirePrivilegedCaller(
    input: AuthRouteRequest,
  ): Promise<
    | { readonly failure: AuthRouteResult }
    | { readonly context: AuthContext; readonly sessionToken: string }
  > {
    if (
      !(await this.throttle('privileged', input.request, input.correlationId))
    ) {
      return {
        failure: failure(429, authErrorCodes.rateLimited, input.correlationId),
      };
    }
    const resolved = await this.caller.resolve(input.request);
    if (resolved.kind === 'origin-rejected') {
      return {
        failure: failure(403, resolved.code, input.correlationId),
      };
    }
    if (resolved.kind === 'csrf-rejected') {
      return {
        failure: failure(403, resolved.code, input.correlationId),
      };
    }
    if (resolved.kind === 'stale-cookie') {
      return {
        failure: failure(
          401,
          authErrorCodes.required,
          input.correlationId,
          resolved.cookies,
        ),
      };
    }
    if (
      resolved.kind !== 'authenticated' ||
      resolved.context.audience !== 'platform_admin'
    ) {
      return {
        failure: failure(401, authErrorCodes.required, input.correlationId),
      };
    }
    const presented = presentedSessionCookie(
      input.request.headers.get('cookie'),
    );
    if (presented === undefined) {
      return {
        failure: failure(401, authErrorCodes.required, input.correlationId),
      };
    }
    return { context: resolved.context, sessionToken: presented.token };
  }

  async createLocalMobileSession(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    if (!this.localIdentityUsable) {
      return failure(403, authErrorCodes.identityDisabled, input.correlationId);
    }
    if (
      !(await this.throttle('authenticate', input.request, input.correlationId))
    ) {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    const parsed = parseBody(localMobileSessionRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }

    const issued = await this.dependencies.authService.authenticateMobile({
      correlationId: input.correlationId,
      deviceReference:
        parsed.value.deviceId ?? optionalHeader(input.request, deviceHeader),
      installationId: parsed.value.installationId,
      subject: parsed.value.subject,
    });
    return {
      body: mobileTokenResponseSchema.parse({
        accessToken: issued.accessToken,
        accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
        accountId: issued.context.accountId,
        assurance: issued.context.assurance,
        audience: 'consumer_mobile',
        refreshToken: issued.refreshToken,
        refreshTokenAbsoluteExpiresAt:
          issued.refreshTokenAbsoluteExpiresAt.toISOString(),
        refreshTokenIdleExpiresAt:
          issued.refreshTokenIdleExpiresAt.toISOString(),
      }),
      status: 201,
    };
  }

  async getSession(input: AuthRouteRequest): Promise<AuthRouteResult> {
    const resolved = await this.resolveCaller(input.request);
    if (resolved.kind !== 'authenticated') {
      return failure(
        401,
        authErrorCodes.required,
        input.correlationId,
        resolved.kind === 'stale-cookie' ? resolved.cookies : undefined,
      );
    }
    return { body: sessionBody(resolved.context), status: 200 };
  }

  async refreshMobileSession(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    if (!(await this.throttle('refresh', input.request, input.correlationId))) {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    const parsed = parseBody(mobileRefreshRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }

    const outcome = await this.dependencies.authService.rotateRefreshToken({
      correlationId: input.correlationId,
      refreshToken: parsed.value.refreshToken,
    });
    if (outcome.kind === 'rejected') {
      // Unknown, expired, revoked, and replayed all answer identically. A
      // caller learns that it must authenticate again and nothing else.
      return failure(401, authErrorCodes.refreshInvalid, input.correlationId);
    }
    return {
      body: mobileTokenResponseSchema.parse({
        accessToken: outcome.tokens.accessToken,
        accessTokenExpiresAt: outcome.tokens.accessTokenExpiresAt.toISOString(),
        accountId: outcome.tokens.context.accountId,
        assurance: outcome.tokens.context.assurance,
        audience: 'consumer_mobile',
        refreshToken: outcome.tokens.refreshToken,
        refreshTokenAbsoluteExpiresAt:
          outcome.tokens.refreshTokenAbsoluteExpiresAt.toISOString(),
        refreshTokenIdleExpiresAt:
          outcome.tokens.refreshTokenIdleExpiresAt.toISOString(),
      }),
      status: 200,
    };
  }

  async logout(input: AuthRouteRequest): Promise<AuthRouteResult> {
    const resolved = await this.resolveCaller(input.request);
    if (
      resolved.kind === 'csrf-rejected' ||
      resolved.kind === 'origin-rejected'
    ) {
      return failure(403, resolved.code, input.correlationId);
    }
    if (resolved.kind === 'authenticated') {
      await this.dependencies.authService.revokeCurrentAuthority({
        context: resolved.context,
        correlationId: input.correlationId,
      });
    }
    // Idempotent: nothing to revoke is a success, and the browser is told to
    // drop its cookies either way.
    return {
      body: authAcknowledgementSchema.parse({ status: 'revoked' }),
      cookies: expiredCookiesFor(input.request),
      status: 200,
    };
  }

  async logoutAll(input: AuthRouteRequest): Promise<AuthRouteResult> {
    const resolved = await this.resolveCaller(input.request);
    if (
      resolved.kind === 'csrf-rejected' ||
      resolved.kind === 'origin-rejected'
    ) {
      return failure(403, resolved.code, input.correlationId);
    }
    if (resolved.kind !== 'authenticated') {
      return failure(
        401,
        authErrorCodes.required,
        input.correlationId,
        expiredCookiesFor(input.request),
      );
    }
    await this.dependencies.authService.revokeAllAuthority({
      accountId: resolved.context.accountId,
      audience: resolved.context.audience,
      correlationId: input.correlationId,
      reason: 'logout_all',
    });
    return {
      body: authAcknowledgementSchema.parse({ status: 'revoked' }),
      cookies: expiredCookiesFor(input.request),
      status: 200,
    };
  }

  /**
   * Recovery initiation. The answer is identical for a known subject, an unknown
   * one, and an account that has reached its own limit, so nothing here reveals
   * whether an account exists.
   */
  async startAccountRecovery(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    if (
      !(await this.throttle('recovery', input.request, input.correlationId))
    ) {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    const parsed = parseBody(recoveryStartRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }
    const rejection = this.browserVerdict(input.request, 'consumer_web', false);
    if (rejection !== undefined) {
      return failure(403, rejection, input.correlationId);
    }

    const outcome = await this.dependencies.recoveryService.start({
      correlationId: input.correlationId,
      deviceReference:
        parsed.value.deviceId ?? optionalHeader(input.request, deviceHeader),
      requesterReference: this.dependencies.requesterReference(input.request),
      subject: parsed.value.subject,
    });
    if (outcome.kind === 'rate_limited') {
      // Caller-scoped, so it discloses nothing about any account.
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    return {
      body: authAcknowledgementSchema.parse({ status: 'accepted' }),
      status: 202,
    };
  }

  async completeAccountRecovery(
    input: AuthRouteRequest,
  ): Promise<AuthRouteResult> {
    if (
      !(await this.throttle('recovery', input.request, input.correlationId))
    ) {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    const parsed = parseBody(recoveryCompletionRequestSchema, input.body);
    if (!parsed.ok) {
      return failure(422, authErrorCodes.validationFailed, input.correlationId);
    }
    const rejection = this.browserVerdict(input.request, 'consumer_web', false);
    if (rejection !== undefined) {
      return failure(403, rejection, input.correlationId);
    }

    const outcome = await this.dependencies.recoveryService.complete({
      correlationId: input.correlationId,
      deviceReference:
        parsed.value.deviceId ?? optionalHeader(input.request, deviceHeader),
      requesterReference: this.dependencies.requesterReference(input.request),
      token: parsed.value.token,
    });
    if (outcome.kind === 'rate_limited') {
      return failure(429, authErrorCodes.rateLimited, input.correlationId);
    }
    if (outcome.kind === 'review_required') {
      return failure(
        403,
        authErrorCodes.recoveryReviewRequired,
        input.correlationId,
      );
    }
    if (outcome.kind === 'invalid') {
      // Unknown, expired, and already consumed answer identically.
      return failure(401, authErrorCodes.recoveryInvalid, input.correlationId);
    }

    const now = this.dependencies.now();
    const maxAgeSeconds = Math.max(
      0,
      Math.floor(
        (outcome.session.context.absoluteExpiresAt.getTime() - now.getTime()) /
          1000,
      ),
    );
    return {
      body: sessionBody(outcome.session.context, outcome.session.csrfToken),
      cookies: [
        issuedSessionCookie({
          audience: 'consumer_web',
          expiresAt: outcome.session.context.absoluteExpiresAt,
          now,
          token: outcome.session.sessionToken,
        }),
        csrfCookie('consumer_web', outcome.session.csrfToken, maxAgeSeconds),
      ],
      status: 200,
    };
  }

  /** Delegates to the shared resolver so AUTH has one credential path. */
  private async resolveCaller(request: Request): Promise<ResolvedCaller> {
    return this.caller.resolve(request);
  }
}
