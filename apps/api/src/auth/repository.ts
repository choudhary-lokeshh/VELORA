import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

import {
  authAccounts,
  authIdentities,
  authKnownDevices,
  authRefreshFamilies,
  authRefreshTokens,
  authSecurityEvents,
  authSessions,
} from './schema.js';

export type AuthDatabase = BunSQLDatabase;
export type AuthExecutor = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];
type AnyExecutor = AuthDatabase | AuthExecutor;

export type AuthAccountRow = typeof authAccounts.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type AuthRefreshFamilyRow = typeof authRefreshFamilies.$inferSelect;
export type AuthRefreshTokenRow = typeof authRefreshTokens.$inferSelect;

export interface SecurityEventInput {
  readonly accountId?: string | undefined;
  readonly audience?: string | undefined;
  readonly correlationId: string;
  readonly eventType: (typeof authSecurityEvents.$inferInsert)['eventType'];
  readonly reason?: string | undefined;
  readonly refreshFamilyId?: string | undefined;
  readonly sessionId?: string | undefined;
}

/**
 * Every AUTH read and write. PostgreSQL is the authority for session existence,
 * expiry, and revocation; nothing here consults or trusts a cache.
 */
export class AuthRepository {
  constructor(private readonly database: AuthDatabase) {}

  /**
   * The connection used for reads and single-statement writes that need no
   * transaction of their own. Named so a caller cannot mistake it for one.
   */
  get transactionless(): AuthDatabase {
    return this.database;
  }

  transaction<T>(work: (executor: AuthExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  async recordSecurityEvent(
    executor: AnyExecutor,
    event: SecurityEventInput,
  ): Promise<void> {
    await executor.insert(authSecurityEvents).values({
      accountId: event.accountId ?? null,
      audience: event.audience ?? null,
      correlationId: event.correlationId,
      eventType: event.eventType,
      reason: event.reason ?? null,
      refreshFamilyId: event.refreshFamilyId ?? null,
      sessionId: event.sessionId ?? null,
    });
  }

  /**
   * Resolves the account behind a provider assertion, creating it on first use.
   * The unique provider/subject index makes concurrent first authentication
   * converge on one account rather than producing two.
   */
  async resolveAccountForIdentity(
    executor: AnyExecutor,
    input: {
      readonly now: Date;
      readonly provider: string;
      readonly providerSubject: string;
    },
  ): Promise<string> {
    const existing = await executor
      .select({ accountId: authIdentities.accountId })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, input.provider),
          eq(authIdentities.providerSubject, input.providerSubject),
        ),
      )
      .limit(1);
    const found = existing[0];
    if (found !== undefined) {
      await executor
        .update(authIdentities)
        .set({ lastAuthenticatedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(authIdentities.provider, input.provider),
            eq(authIdentities.providerSubject, input.providerSubject),
          ),
        );
      return found.accountId;
    }

    const accountId = crypto.randomUUID();
    await executor.insert(authAccounts).values({
      createdAt: input.now,
      id: accountId,
      status: 'active',
      updatedAt: input.now,
    });
    const inserted = await executor
      .insert(authIdentities)
      .values({
        accountId,
        createdAt: input.now,
        id: crypto.randomUUID(),
        lastAuthenticatedAt: input.now,
        provider: input.provider,
        providerSubject: input.providerSubject,
        updatedAt: input.now,
      })
      .onConflictDoNothing({
        target: [authIdentities.provider, authIdentities.providerSubject],
      })
      .returning({ accountId: authIdentities.accountId });
    const claimed = inserted[0];
    if (claimed !== undefined) return claimed.accountId;

    // Another request created the identity first. Drop the account this
    // request speculatively created and use the winner's.
    await executor.delete(authAccounts).where(eq(authAccounts.id, accountId));
    const settled = await executor
      .select({ accountId: authIdentities.accountId })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, input.provider),
          eq(authIdentities.providerSubject, input.providerSubject),
        ),
      )
      .limit(1);
    const winner = settled[0];
    if (winner === undefined) {
      throw new Error('Identity resolution failed to converge');
    }
    return winner.accountId;
  }

  async findAccount(
    executor: AnyExecutor,
    accountId: string,
  ): Promise<AuthAccountRow | undefined> {
    const rows = await executor
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.id, accountId))
      .limit(1);
    return rows[0];
  }

  async findAccountIdBySubject(
    executor: AnyExecutor,
    input: { readonly provider: string; readonly providerSubject: string },
  ): Promise<string | undefined> {
    const rows = await executor
      .select({ accountId: authIdentities.accountId })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, input.provider),
          eq(authIdentities.providerSubject, input.providerSubject),
        ),
      )
      .limit(1);
    return rows[0]?.accountId;
  }

  async restrictHighImpactActions(
    executor: AnyExecutor,
    input: {
      readonly accountId: string;
      readonly now: Date;
      readonly reason: 'account_recovery' | 'privileged_recovery';
      readonly until: Date;
    },
  ): Promise<void> {
    await executor
      .update(authAccounts)
      .set({
        highImpactRestrictedUntil: input.until,
        highImpactRestrictionReason: input.reason,
        updatedAt: input.now,
      })
      .where(eq(authAccounts.id, input.accountId));
  }

  async rememberDevice(
    executor: AnyExecutor,
    input: {
      readonly accountId: string;
      readonly deviceDigest: string;
      readonly now: Date;
    },
  ): Promise<void> {
    await executor
      .insert(authKnownDevices)
      .values({
        accountId: input.accountId,
        deviceDigest: input.deviceDigest,
        firstSeenAt: input.now,
        id: crypto.randomUUID(),
        lastSeenAt: input.now,
      })
      .onConflictDoUpdate({
        set: { lastSeenAt: input.now },
        target: [authKnownDevices.accountId, authKnownDevices.deviceDigest],
      });
  }

  async isKnownDevice(
    executor: AnyExecutor,
    input: { readonly accountId: string; readonly deviceDigest: string },
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: authKnownDevices.id })
      .from(authKnownDevices)
      .where(
        and(
          eq(authKnownDevices.accountId, input.accountId),
          eq(authKnownDevices.deviceDigest, input.deviceDigest),
        ),
      )
      .limit(1);
    return rows[0] !== undefined;
  }

  async createBrowserSession(
    executor: AnyExecutor,
    input: {
      readonly absoluteExpiresAt: Date;
      readonly accountId: string;
      readonly assurance: string;
      readonly audience: string;
      readonly csrfDigest: string;
      readonly deviceDigest?: string | undefined;
      readonly idleExpiresAt: Date;
      readonly now: Date;
      readonly tokenDigest: string;
    },
  ): Promise<AuthSessionRow> {
    const rows = await executor
      .insert(authSessions)
      .values({
        absoluteExpiresAt: input.absoluteExpiresAt,
        accountId: input.accountId,
        assurance: input.assurance,
        assuranceEstablishedAt: input.now,
        audience: input.audience,
        authenticatedAt: input.now,
        createdAt: input.now,
        csrfDigest: input.csrfDigest,
        deviceDigest: input.deviceDigest ?? null,
        id: crypto.randomUUID(),
        idleExpiresAt: input.idleExpiresAt,
        lastActiveAt: input.now,
        tokenDigest: input.tokenDigest,
      })
      .returning();
    const created = rows[0];
    if (created === undefined) throw new Error('Session creation failed');
    return created;
  }

  async findSessionById(
    executor: AnyExecutor,
    sessionId: string,
  ): Promise<AuthSessionRow | undefined> {
    const rows = await executor
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, sessionId))
      .limit(1);
    return rows[0];
  }

  /**
   * The browser-session hot path. Session and account state are read together
   * because every authenticated request needs both, and two round trips per
   * request is a cost that multiplies with every replica.
   */
  async findSessionWithAccount(
    executor: AnyExecutor,
    tokenDigest: string,
  ): Promise<
    | { readonly accountStatus: string; readonly session: AuthSessionRow }
    | undefined
  > {
    const rows = await executor
      .select({ accountStatus: authAccounts.status, session: authSessions })
      .from(authSessions)
      .innerJoin(authAccounts, eq(authSessions.accountId, authAccounts.id))
      .where(eq(authSessions.tokenDigest, tokenDigest))
      .limit(1);
    return rows[0];
  }

  /** The Consumer Mobile hot path, read in one round trip for the same reason. */
  async findRefreshFamilyWithAccount(
    executor: AnyExecutor,
    familyId: string,
  ): Promise<
    | { readonly accountStatus: string; readonly family: AuthRefreshFamilyRow }
    | undefined
  > {
    const rows = await executor
      .select({
        accountStatus: authAccounts.status,
        family: authRefreshFamilies,
      })
      .from(authRefreshFamilies)
      .innerJoin(
        authAccounts,
        eq(authRefreshFamilies.accountId, authAccounts.id),
      )
      .where(eq(authRefreshFamilies.id, familyId))
      .limit(1);
    return rows[0];
  }

  async findSessionByDigest(
    executor: AnyExecutor,
    tokenDigest: string,
  ): Promise<AuthSessionRow | undefined> {
    const rows = await executor
      .select()
      .from(authSessions)
      .where(eq(authSessions.tokenDigest, tokenDigest))
      .limit(1);
    return rows[0];
  }

  /**
   * Slides idle expiry. It never extends beyond the absolute lifetime and never
   * revives a session that already expired, because the caller only reaches
   * here after validating the stored row.
   */
  async recordSessionActivity(
    executor: AnyExecutor,
    input: {
      readonly idleExpiresAt: Date;
      readonly now: Date;
      readonly sessionId: string;
    },
  ): Promise<void> {
    await executor
      .update(authSessions)
      .set({ idleExpiresAt: input.idleExpiresAt, lastActiveAt: input.now })
      .where(
        and(
          eq(authSessions.id, input.sessionId),
          isNull(authSessions.revokedAt),
        ),
      );
  }

  async refreshSessionAssurance(
    executor: AnyExecutor,
    input: {
      readonly assurance: string;
      readonly now: Date;
      readonly sessionId: string;
    },
  ): Promise<void> {
    await executor
      .update(authSessions)
      .set({ assurance: input.assurance, assuranceEstablishedAt: input.now })
      .where(
        and(
          eq(authSessions.id, input.sessionId),
          isNull(authSessions.revokedAt),
        ),
      );
  }

  async revokeSession(
    executor: AnyExecutor,
    input: {
      readonly now: Date;
      readonly reason: string;
      readonly sessionId: string;
    },
  ): Promise<boolean> {
    const rows = await executor
      .update(authSessions)
      .set({ revocationReason: input.reason, revokedAt: input.now })
      .where(
        and(
          eq(authSessions.id, input.sessionId),
          isNull(authSessions.revokedAt),
        ),
      )
      .returning({ id: authSessions.id });
    return rows[0] !== undefined;
  }

  async revokeAccountAuthority(
    executor: AnyExecutor,
    input: {
      readonly accountId: string;
      readonly now: Date;
      readonly reason: string;
    },
  ): Promise<{ readonly families: number; readonly sessions: number }> {
    const sessions = await executor
      .update(authSessions)
      .set({ revocationReason: input.reason, revokedAt: input.now })
      .where(
        and(
          eq(authSessions.accountId, input.accountId),
          isNull(authSessions.revokedAt),
        ),
      )
      .returning({ id: authSessions.id });
    const families = await executor
      .update(authRefreshFamilies)
      .set({ revocationReason: input.reason, revokedAt: input.now })
      .where(
        and(
          eq(authRefreshFamilies.accountId, input.accountId),
          isNull(authRefreshFamilies.revokedAt),
        ),
      )
      .returning({ id: authRefreshFamilies.id });
    return { families: families.length, sessions: sessions.length };
  }

  /**
   * Starts a refresh family for one installation. Any live family for the same
   * installation is superseded in the same transaction, so the partial unique
   * index that permits one live family per installation always holds.
   */
  async createRefreshFamily(
    executor: AnyExecutor,
    input: {
      readonly absoluteExpiresAt: Date;
      readonly accountId: string;
      readonly assurance: string;
      readonly deviceDigest?: string | undefined;
      readonly idleExpiresAt: Date;
      readonly installationId: string;
      readonly now: Date;
      readonly tokenDigest: string;
    },
  ): Promise<{
    readonly family: AuthRefreshFamilyRow;
    readonly token: AuthRefreshTokenRow;
  }> {
    await executor
      .update(authRefreshFamilies)
      .set({ revocationReason: 'superseded', revokedAt: input.now })
      .where(
        and(
          eq(authRefreshFamilies.accountId, input.accountId),
          eq(authRefreshFamilies.installationId, input.installationId),
          isNull(authRefreshFamilies.revokedAt),
        ),
      );

    const familyRows = await executor
      .insert(authRefreshFamilies)
      .values({
        absoluteExpiresAt: input.absoluteExpiresAt,
        accountId: input.accountId,
        assurance: input.assurance,
        assuranceEstablishedAt: input.now,
        audience: 'consumer_mobile',
        authenticatedAt: input.now,
        createdAt: input.now,
        deviceDigest: input.deviceDigest ?? null,
        id: crypto.randomUUID(),
        idleExpiresAt: input.idleExpiresAt,
        installationId: input.installationId,
        lastUsedAt: input.now,
      })
      .returning();
    const family = familyRows[0];
    if (family === undefined) throw new Error('Refresh family creation failed');

    const tokenRows = await executor
      .insert(authRefreshTokens)
      .values({
        createdAt: input.now,
        familyId: family.id,
        generation: 0,
        id: crypto.randomUUID(),
        tokenDigest: input.tokenDigest,
      })
      .returning();
    const token = tokenRows[0];
    if (token === undefined) throw new Error('Refresh token creation failed');
    return { family, token };
  }

  async findRefreshFamily(
    executor: AnyExecutor,
    familyId: string,
  ): Promise<AuthRefreshFamilyRow | undefined> {
    const rows = await executor
      .select()
      .from(authRefreshFamilies)
      .where(eq(authRefreshFamilies.id, familyId))
      .limit(1);
    return rows[0];
  }

  async countLiveRefreshTokens(
    executor: AnyExecutor,
    familyId: string,
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(authRefreshTokens)
      .where(
        and(
          eq(authRefreshTokens.familyId, familyId),
          isNull(authRefreshTokens.consumedAt),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  async listRefreshTokens(
    executor: AnyExecutor,
    familyId: string,
  ): Promise<readonly AuthRefreshTokenRow[]> {
    return executor
      .select()
      .from(authRefreshTokens)
      .where(eq(authRefreshTokens.familyId, familyId))
      .orderBy(authRefreshTokens.generation);
  }

  async revokeRefreshFamily(
    executor: AnyExecutor,
    input: {
      readonly compromised: boolean;
      readonly familyId: string;
      readonly now: Date;
      readonly reason: string;
    },
  ): Promise<boolean> {
    const rows = await executor
      .update(authRefreshFamilies)
      .set({
        compromisedAt: input.compromised ? input.now : null,
        revocationReason: input.reason,
        revokedAt: input.now,
      })
      .where(
        and(
          eq(authRefreshFamilies.id, input.familyId),
          isNull(authRefreshFamilies.revokedAt),
        ),
      )
      .returning({ id: authRefreshFamilies.id });
    if (rows[0] !== undefined) return true;
    if (!input.compromised) return false;
    // Already revoked for another reason; still record the compromise.
    await executor
      .update(authRefreshFamilies)
      .set({ compromisedAt: input.now })
      .where(
        and(
          eq(authRefreshFamilies.id, input.familyId),
          isNull(authRefreshFamilies.compromisedAt),
        ),
      );
    return false;
  }

  async findRefreshTokenByDigest(
    executor: AnyExecutor,
    tokenDigest: string,
  ): Promise<AuthRefreshTokenRow | undefined> {
    const rows = await executor
      .select()
      .from(authRefreshTokens)
      .where(eq(authRefreshTokens.tokenDigest, tokenDigest))
      .limit(1);
    return rows[0];
  }

  /**
   * Takes the family row lock. Every rotation for one family serialises here,
   * which is what makes "exactly one of N concurrent exchanges succeeds" a
   * database property rather than an application hope.
   */
  async lockRefreshFamily(
    executor: AuthExecutor,
    familyId: string,
  ): Promise<AuthRefreshFamilyRow | undefined> {
    const rows = await executor
      .select()
      .from(authRefreshFamilies)
      .where(eq(authRefreshFamilies.id, familyId))
      .for('update')
      .limit(1);
    return rows[0];
  }

  async consumeAndReplaceRefreshToken(
    executor: AuthExecutor,
    input: {
      readonly currentTokenId: string;
      readonly familyId: string;
      readonly idleExpiresAt: Date;
      readonly nextGeneration: number;
      readonly nextTokenDigest: string;
      readonly now: Date;
    },
  ): Promise<AuthRefreshTokenRow> {
    // Consumption comes first. The partial unique index permits one live token
    // per family, so the successor cannot be inserted while its predecessor is
    // still live; ordering it this way makes the index an invariant the happy
    // path also obeys, not just a backstop.
    const consumed = await executor
      .update(authRefreshTokens)
      .set({ consumedAt: input.now })
      .where(
        and(
          eq(authRefreshTokens.id, input.currentTokenId),
          isNull(authRefreshTokens.consumedAt),
        ),
      )
      .returning({ id: authRefreshTokens.id });
    if (consumed[0] === undefined) {
      throw new Error('Refresh rotation lost its exclusive claim');
    }

    const nextRows = await executor
      .insert(authRefreshTokens)
      .values({
        createdAt: input.now,
        familyId: input.familyId,
        generation: input.nextGeneration,
        id: crypto.randomUUID(),
        tokenDigest: input.nextTokenDigest,
      })
      .returning();
    const next = nextRows[0];
    if (next === undefined) throw new Error('Refresh rotation failed');

    await executor
      .update(authRefreshTokens)
      .set({ replacedById: next.id })
      .where(eq(authRefreshTokens.id, input.currentTokenId));

    await executor
      .update(authRefreshFamilies)
      .set({ idleExpiresAt: input.idleExpiresAt, lastUsedAt: input.now })
      .where(eq(authRefreshFamilies.id, input.familyId));
    return next;
  }
}
