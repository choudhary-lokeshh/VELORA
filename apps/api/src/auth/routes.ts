import type { AppEnvironment } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import {
  apiErrorSchema,
  authAcknowledgementSchema,
  authErrorCodes,
  authSessionResponseSchema,
  deviceHeader,
  localAdminSessionRequestSchema,
  localMobileSessionRequestSchema,
  localWebSessionRequestSchema,
  maximumAuthRequestBodyBytes,
  mobileRefreshRequestSchema,
  mobileTokenResponseSchema,
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
import type { AuthContext } from './context.js';
import { issuedSessionCookie, presentedSessionCookie } from './cookies.js';
import type { PrivilegedAuthenticatorVerifier } from './identity-provider.js';
import { authAttemptLimits, type RateLimiter } from './rate-limit.js';
import type { RecoveryService } from './recovery.js';
import type { AuthService } from './service.js';

export interface AuthRouteRequest {
  readonly body: string;
  readonly correlationId: string;
  readonly request: Request;
}

export interface AuthRouteResult {
  readonly body: unknown;
  readonly cookies?: readonly string[];
  readonly status: number;
}

export interface AuthRoutesDependencies {
  readonly allowedOrigins: Readonly<
    Record<BrowserAuthAudience, readonly string[]>
  >;
  readonly appEnvironment: AppEnvironment;
  readonly authService: AuthService;
  readonly caller: CallerResolver;
  readonly localIdentityEnabled: boolean;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly privilegedVerifier?: PrivilegedAuthenticatorVerifier | undefined;
  readonly rateLimiter: RateLimiter;
  readonly recoveryService: RecoveryService;
  readonly requesterReference: (request: Request) => string;
}

function failure(
  status: number,
  code: AuthErrorCode,
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
