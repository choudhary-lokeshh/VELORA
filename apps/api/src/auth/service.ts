import {
  type AuthAssurance,
  type AuthAudience,
  type BrowserAuthAudience,
} from '@velora/validation';

import type { AccessTokenSigner } from './access-token.js';
import type { AuthContext } from './context.js';
import type { IdentityProvider } from './identity-provider.js';
import {
  accessTokenLifetimeMilliseconds,
  authMechanismConstants,
  browserSessionPolicy,
  refreshFamilyPolicy,
} from './policy.js';
import type {
  AuthExecutor,
  AuthRefreshFamilyRow,
  AuthRepository,
  AuthSessionRow,
} from './repository.js';
import {
  digestToken,
  digestValue,
  generateOpaqueToken,
  isWellFormedOpaqueToken,
} from './tokens.js';

export interface BrowserSessionIssue {
  readonly context: AuthContext;
  /** Returned to the caller exactly once; only its digest is stored. */
  readonly csrfToken: string;
  readonly sessionToken: string;
}

export interface MobileTokenIssue {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly context: AuthContext;
  readonly refreshToken: string;
  readonly refreshTokenAbsoluteExpiresAt: Date;
  readonly refreshTokenIdleExpiresAt: Date;
}

export type SessionResolution =
  | { readonly kind: 'absent' }
  | { readonly kind: 'rejected' }
  | {
      readonly kind: 'active';
      readonly context: AuthContext;
      readonly csrfDigest: string;
    };

export type RefreshRotationResult =
  | { readonly kind: 'rotated'; readonly tokens: MobileTokenIssue }
  | { readonly kind: 'rejected' };

export interface AuthServiceDependencies {
  readonly accessTokenSigner: AccessTokenSigner;
  readonly identityProvider: IdentityProvider;
  readonly now: () => Date;
  readonly repository: AuthRepository;
}

const localAssurance: AuthAssurance = 'single_factor';

function earliest(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

/**
 * AUTH application service. It owns authentication, session lifecycle, refresh
 * rotation, and revocation. It stores no profile field and reads no other
 * domain's tables.
 */
export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  get signerKind(): string {
    return this.dependencies.accessTokenSigner.kind;
  }

  /** The key new access tokens are signed with. */
  get signingKeyId(): string {
    return this.dependencies.accessTokenSigner.signingKeyId;
  }

  /** Every key whose access tokens still verify, so rotation is observable. */
  get verificationKeyIds(): readonly string[] {
    return this.dependencies.accessTokenSigner.verificationKeyIds;
  }

  get identityProviderName(): string {
    return this.dependencies.identityProvider.name;
  }

  /**
   * Establishes a browser session from a provider assertion. A session is always
   * newly created, which is session-fixation protection and the post-
   * authentication rotation ADR-0017 requires.
   */
  async authenticateBrowser(input: {
    readonly audience: BrowserAuthAudience;
    readonly correlationId: string;
    readonly deviceReference?: string | undefined;
    readonly subject: string;
    /**
     * The session this caller already holds for the audience, if any. It is
     * revoked in the same transaction, so re-authenticating rotates the session
     * rather than leaving a live one the user can no longer see or manage.
     */
    readonly supersedeSessionToken?: string | undefined;
  }): Promise<BrowserSessionIssue> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const assertion = this.dependencies.identityProvider.assert(input.subject);
    const policy = browserSessionPolicy[input.audience];
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const deviceDigest =
      input.deviceReference === undefined
        ? undefined
        : digestValue(input.deviceReference);

    const session = await repository.transaction(async (executor) => {
      const accountId = await repository.resolveAccountForIdentity(executor, {
        now,
        provider: assertion.provider,
        providerSubject: assertion.providerSubject,
      });
      if (
        input.supersedeSessionToken !== undefined &&
        isWellFormedOpaqueToken(input.supersedeSessionToken)
      ) {
        const previous = await repository.findSessionByDigest(
          executor,
          digestToken(input.supersedeSessionToken),
        );
        if (previous?.accountId === accountId) {
          await repository.revokeSession(executor, {
            now,
            reason: 'superseded',
            sessionId: previous.id,
          });
        }
      }
      const created = await repository.createBrowserSession(executor, {
        absoluteExpiresAt: new Date(
          now.getTime() + policy.absoluteMilliseconds,
        ),
        accountId,
        assurance: localAssurance,
        audience: input.audience,
        csrfDigest: digestToken(csrfToken),
        deviceDigest,
        idleExpiresAt: new Date(now.getTime() + policy.idleMilliseconds),
        now,
        tokenDigest: digestToken(sessionToken),
      });
      if (deviceDigest !== undefined) {
        await repository.rememberDevice(executor, {
          accountId,
          deviceDigest,
          now,
        });
      }
      await repository.recordSecurityEvent(executor, {
        accountId,
        audience: input.audience,
        correlationId: input.correlationId,
        eventType: 'authentication_succeeded',
      });
      await repository.recordSecurityEvent(executor, {
        accountId,
        audience: input.audience,
        correlationId: input.correlationId,
        eventType: 'session_created',
        sessionId: created.id,
      });
      return created;
    });

    return {
      context: browserContext(session),
      csrfToken,
      sessionToken,
    };
  }

  /**
   * Establishes a browser session for an account whose control has already been
   * proven by another means, such as a consumed recovery token. It performs no
   * identity assertion of its own and grants ordinary assurance only.
   */
  async reissueBrowserSession(input: {
    readonly accountId: string;
    readonly audience: BrowserAuthAudience;
    readonly correlationId: string;
    readonly deviceReference?: string | undefined;
  }): Promise<BrowserSessionIssue> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const policy = browserSessionPolicy[input.audience];
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const deviceDigest =
      input.deviceReference === undefined
        ? undefined
        : digestValue(input.deviceReference);

    const session = await repository.transaction(async (executor) => {
      const created = await repository.createBrowserSession(executor, {
        absoluteExpiresAt: new Date(
          now.getTime() + policy.absoluteMilliseconds,
        ),
        accountId: input.accountId,
        assurance: localAssurance,
        audience: input.audience,
        csrfDigest: digestToken(csrfToken),
        deviceDigest,
        idleExpiresAt: new Date(now.getTime() + policy.idleMilliseconds),
        now,
        tokenDigest: digestToken(sessionToken),
      });
      await repository.recordSecurityEvent(executor, {
        accountId: input.accountId,
        audience: input.audience,
        correlationId: input.correlationId,
        eventType: 'session_created',
        reason: 'reissued',
        sessionId: created.id,
      });
      return created;
    });

    return { context: browserContext(session), csrfToken, sessionToken };
  }

  /** Establishes a Consumer Mobile access token and a fresh refresh family. */
  async authenticateMobile(input: {
    readonly correlationId: string;
    readonly deviceReference?: string | undefined;
    readonly installationId: string;
    readonly subject: string;
  }): Promise<MobileTokenIssue> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const assertion = this.dependencies.identityProvider.assert(input.subject);
    const refreshToken = generateOpaqueToken();
    const deviceDigest =
      input.deviceReference === undefined
        ? undefined
        : digestValue(input.deviceReference);

    const family = await repository.transaction(async (executor) => {
      const accountId = await repository.resolveAccountForIdentity(executor, {
        now,
        provider: assertion.provider,
        providerSubject: assertion.providerSubject,
      });
      const created = await repository.createRefreshFamily(executor, {
        absoluteExpiresAt: new Date(
          now.getTime() + refreshFamilyPolicy.absoluteMilliseconds,
        ),
        accountId,
        assurance: localAssurance,
        deviceDigest,
        idleExpiresAt: new Date(
          now.getTime() + refreshFamilyPolicy.idleMilliseconds,
        ),
        installationId: input.installationId,
        now,
        tokenDigest: digestToken(refreshToken),
      });
      if (deviceDigest !== undefined) {
        await repository.rememberDevice(executor, {
          accountId,
          deviceDigest,
          now,
        });
      }
      await repository.recordSecurityEvent(executor, {
        accountId,
        audience: 'consumer_mobile',
        correlationId: input.correlationId,
        eventType: 'authentication_succeeded',
      });
      await repository.recordSecurityEvent(executor, {
        accountId,
        audience: 'consumer_mobile',
        correlationId: input.correlationId,
        eventType: 'session_created',
        refreshFamilyId: created.family.id,
      });
      return created.family;
    });

    return this.issueMobileTokens(family, refreshToken, now);
  }

  /**
   * Resolves a browser session cookie into a server-derived context.
   * PostgreSQL is the sole authority here; there is no cache to consult and no
   * fallback that grants access when a lookup fails.
   */
  async resolveBrowserSession(
    sessionToken: string | undefined,
  ): Promise<SessionResolution> {
    if (sessionToken === undefined) return { kind: 'absent' };
    if (!isWellFormedOpaqueToken(sessionToken)) return { kind: 'rejected' };

    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const found = await repository.findSessionWithAccount(
      repository.transactionless,
      digestToken(sessionToken),
    );
    if (found === undefined) return { kind: 'rejected' };
    const { accountStatus, session } = found;
    if (accountStatus !== 'active') return { kind: 'rejected' };
    if (session.revokedAt !== null) return { kind: 'rejected' };
    if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
      return { kind: 'rejected' };
    }
    if (session.idleExpiresAt.getTime() <= now.getTime()) {
      return { kind: 'rejected' };
    }

    const policy =
      browserSessionPolicy[session.audience as BrowserAuthAudience];
    const slidIdleExpiry = earliest(
      new Date(now.getTime() + policy.idleMilliseconds),
      session.absoluteExpiresAt,
    );
    const sinceLastWrite = now.getTime() - session.lastActiveAt.getTime();
    if (
      sinceLastWrite >=
      authMechanismConstants.sessionActivityWriteIntervalMilliseconds
    ) {
      await repository.recordSessionActivity(repository.transactionless, {
        idleExpiresAt: slidIdleExpiry,
        now,
        sessionId: session.id,
      });
    }

    return {
      context: browserContext({ ...session, idleExpiresAt: slidIdleExpiry }),
      csrfDigest: session.csrfDigest,
      kind: 'active',
    };
  }

  /**
   * Resolves a Consumer Mobile access token. The signature is necessary but not
   * sufficient: the backing refresh family is rechecked online on every request,
   * so revocation takes effect immediately instead of after the token's
   * remaining lifetime.
   */
  async resolveAccessToken(
    accessToken: string | undefined,
  ): Promise<AuthContext | undefined> {
    if (accessToken === undefined) return undefined;
    const now = this.dependencies.now();
    const claims = this.dependencies.accessTokenSigner.verify(accessToken, now);
    if (claims === undefined) return undefined;
    if (claims.audience !== 'consumer_mobile') return undefined;

    const { repository } = this.dependencies;
    const found = await repository.findRefreshFamilyWithAccount(
      repository.transactionless,
      claims.refreshFamilyId,
    );
    if (found === undefined) return undefined;
    const { accountStatus, family } = found;
    if (accountStatus !== 'active') return undefined;
    if (family.accountId !== claims.accountId) return undefined;
    if (!isFamilyUsable(family, now)) return undefined;

    return familyContext(family);
  }

  /**
   * Single-use refresh rotation.
   *
   * The family row is locked before any decision is made, so concurrent
   * exchanges of the same token serialise: exactly one consumes it, and every
   * later arrival observes a consumed token. Every such arrival is replay, and
   * the whole family is revoked and marked compromised.
   *
   * There is deliberately no retry tolerance. A grace window keyed on anything
   * the client sends is a window an attacker who already holds the token can
   * also enter, and its only effect would be to suppress replay detection. A
   * legitimate client avoids the situation with single-flight refresh; when it
   * cannot, ADR-0017 prefers family revocation and a clear re-authentication
   * path over silent acceptance.
   */
  async rotateRefreshToken(input: {
    readonly correlationId: string;
    readonly refreshToken: string;
  }): Promise<RefreshRotationResult> {
    if (!isWellFormedOpaqueToken(input.refreshToken)) {
      return { kind: 'rejected' };
    }
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const presentedDigest = digestToken(input.refreshToken);
    const nextToken = generateOpaqueToken();

    const outcome = await repository.transaction(
      async (
        executor: AuthExecutor,
      ): Promise<
        | { readonly kind: 'rejected' }
        | { readonly kind: 'rotated'; readonly family: AuthRefreshFamilyRow }
      > => {
        const located = await repository.findRefreshTokenByDigest(
          executor,
          presentedDigest,
        );
        if (located === undefined) return { kind: 'rejected' };

        const family = await repository.lockRefreshFamily(
          executor,
          located.familyId,
        );
        if (family === undefined) return { kind: 'rejected' };

        // Re-read under the family lock. Anything decided before this point
        // could be stale by the time the lock is granted.
        const current = await repository.findRefreshTokenByDigest(
          executor,
          presentedDigest,
        );
        if (current === undefined) return { kind: 'rejected' };

        if (current.consumedAt !== null) {
          // A consumed token presented again is replay, whoever sent it and
          // however soon. Fail closed.
          await repository.revokeRefreshFamily(executor, {
            compromised: true,
            familyId: family.id,
            now,
            reason: 'refresh_reuse_detected',
          });
          await repository.recordSecurityEvent(executor, {
            accountId: family.accountId,
            audience: 'consumer_mobile',
            correlationId: input.correlationId,
            eventType: 'refresh_reuse_detected',
            refreshFamilyId: family.id,
          });
          await repository.recordSecurityEvent(executor, {
            accountId: family.accountId,
            audience: 'consumer_mobile',
            correlationId: input.correlationId,
            eventType: 'refresh_family_revoked',
            reason: 'refresh_reuse_detected',
            refreshFamilyId: family.id,
          });
          return { kind: 'rejected' };
        }

        if (!isFamilyUsable(family, now)) return { kind: 'rejected' };
        const account = await repository.findAccount(
          executor,
          family.accountId,
        );
        if (account?.status !== 'active') return { kind: 'rejected' };

        const idleExpiresAt = earliest(
          new Date(now.getTime() + refreshFamilyPolicy.idleMilliseconds),
          family.absoluteExpiresAt,
        );
        await repository.consumeAndReplaceRefreshToken(executor, {
          currentTokenId: current.id,
          familyId: family.id,
          idleExpiresAt,
          nextGeneration: current.generation + 1,
          nextTokenDigest: digestToken(nextToken),
          now,
        });
        await repository.recordSecurityEvent(executor, {
          accountId: family.accountId,
          audience: 'consumer_mobile',
          correlationId: input.correlationId,
          eventType: 'refresh_rotated',
          refreshFamilyId: family.id,
        });
        return {
          family: { ...family, idleExpiresAt, lastUsedAt: now },
          kind: 'rotated',
        };
      },
    );

    if (outcome.kind !== 'rotated') return outcome;
    return {
      kind: 'rotated',
      tokens: this.issueMobileTokens(outcome.family, nextToken, now),
    };
  }

  /** Revokes the current authority. Idempotent by contract. */
  async revokeCurrentAuthority(input: {
    readonly context: AuthContext;
    readonly correlationId: string;
  }): Promise<void> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    await repository.transaction(async (executor) => {
      if (input.context.sessionId !== undefined) {
        const revoked = await repository.revokeSession(executor, {
          now,
          reason: 'logout',
          sessionId: input.context.sessionId,
        });
        if (revoked) {
          await repository.recordSecurityEvent(executor, {
            accountId: input.context.accountId,
            audience: input.context.audience,
            correlationId: input.correlationId,
            eventType: 'session_revoked',
            reason: 'logout',
            sessionId: input.context.sessionId,
          });
        }
        return;
      }
      if (input.context.refreshFamilyId !== undefined) {
        const revoked = await repository.revokeRefreshFamily(executor, {
          compromised: false,
          familyId: input.context.refreshFamilyId,
          now,
          reason: 'logout',
        });
        if (revoked) {
          await repository.recordSecurityEvent(executor, {
            accountId: input.context.accountId,
            audience: input.context.audience,
            correlationId: input.correlationId,
            eventType: 'refresh_family_revoked',
            reason: 'logout',
            refreshFamilyId: input.context.refreshFamilyId,
          });
        }
      }
    });
  }

  /** Revokes every browser session and refresh family for the account. */
  async revokeAllAuthority(input: {
    readonly accountId: string;
    readonly audience: AuthAudience;
    readonly correlationId: string;
    readonly reason: 'logout_all' | 'account_recovery' | 'privileged_recovery';
  }): Promise<{ readonly families: number; readonly sessions: number }> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const revoked = await repository.revokeAccountAuthority(executor, {
        accountId: input.accountId,
        now,
        reason: input.reason,
      });
      await repository.recordSecurityEvent(executor, {
        accountId: input.accountId,
        audience: input.audience,
        correlationId: input.correlationId,
        eventType: 'sessions_revoked_all',
        reason: input.reason,
      });
      return revoked;
    });
  }

  private issueMobileTokens(
    family: AuthRefreshFamilyRow,
    refreshToken: string,
    now: Date,
  ): MobileTokenIssue {
    const accessTokenExpiresAt = new Date(
      now.getTime() + accessTokenLifetimeMilliseconds,
    );
    const context = familyContext(family);
    const accessToken = this.dependencies.accessTokenSigner.sign({
      accountId: family.accountId,
      assurance: context.assurance,
      audience: 'consumer_mobile',
      expiresAt: accessTokenExpiresAt,
      issuedAt: now,
      refreshFamilyId: family.id,
      tokenId: crypto.randomUUID(),
    });
    return {
      accessToken,
      accessTokenExpiresAt,
      context,
      refreshToken,
      refreshTokenAbsoluteExpiresAt: family.absoluteExpiresAt,
      refreshTokenIdleExpiresAt: family.idleExpiresAt,
    };
  }
}

export function isFamilyUsable(
  family: AuthRefreshFamilyRow,
  now: Date,
): boolean {
  if (family.revokedAt !== null || family.compromisedAt !== null) return false;
  if (family.absoluteExpiresAt.getTime() <= now.getTime()) return false;
  return family.idleExpiresAt.getTime() > now.getTime();
}

function browserContext(session: AuthSessionRow): AuthContext {
  return {
    absoluteExpiresAt: session.absoluteExpiresAt,
    accountId: session.accountId,
    assurance: session.assurance as AuthAssurance,
    assuranceEstablishedAt: session.assuranceEstablishedAt,
    audience: session.audience as AuthAudience,
    authenticatedAt: session.authenticatedAt,
    idleExpiresAt: session.idleExpiresAt,
    sessionId: session.id,
    transport: 'cookie',
  };
}

function familyContext(family: AuthRefreshFamilyRow): AuthContext {
  return {
    absoluteExpiresAt: family.absoluteExpiresAt,
    accountId: family.accountId,
    assurance: family.assurance as AuthAssurance,
    assuranceEstablishedAt: family.assuranceEstablishedAt,
    audience: 'consumer_mobile',
    authenticatedAt: family.authenticatedAt,
    idleExpiresAt: family.idleExpiresAt,
    refreshFamilyId: family.id,
    transport: 'bearer',
  };
}
