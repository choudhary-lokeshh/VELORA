import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';

import {
  Ed25519AccessTokenAuthority,
  type AccessTokenSigner,
} from '../../src/auth/access-token.js';
import { LocalIdentityProvider } from '../../src/auth/identity-provider.js';
import { browserSessionPolicy } from '../../src/auth/policy.js';
import { AuthRepository } from '../../src/auth/repository.js';
import { AuthService } from '../../src/auth/service.js';
import { digestToken } from '../../src/auth/tokens.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

const databaseUrl = await provisionDatabase('velora_auth_core');
const database: TestDatabase = connectDatabase(databaseUrl);
const repository = new AuthRepository(database.drizzle);
const issuer = 'https://auth.velora.invalid';

const signingKey = generateKeyPairSync('ed25519').privateKey;

/** Deterministically corrupts a base64url signature by one bit. */
function flipFirstBit(signature: string): string {
  const bytes = Buffer.from(signature, 'base64url');
  const first = bytes[0];
  if (first === undefined) throw new Error('signature is empty');
  bytes[0] = first ^ 0x01;
  return bytes.toString('base64url');
}

function signer(): AccessTokenSigner {
  return new Ed25519AccessTokenAuthority({ issuer, signingKey });
}

function serviceAt(clock: { current: Date }): AuthService {
  return new AuthService({
    accessTokenSigner: signer(),
    identityProvider: new LocalIdentityProvider(),
    now: () => clock.current,
    repository,
  });
}

function fixedClock(start = new Date('2026-08-13T10:00:00.000Z')) {
  return { current: start };
}

const service = new AuthService({
  accessTokenSigner: signer(),
  identityProvider: new LocalIdentityProvider(),
  now: () => new Date(),
  repository,
});

async function countRows(table: string): Promise<number> {
  const rows = await rowsOf<{ total: number }>(
    database.sql.unsafe(`select count(*)::int as total from ${table}`),
  );
  return rows[0]?.total ?? 0;
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('AUTH persistence and invariants', () => {
  it('owns exactly the auth-prefixed tables and no other domain table', async () => {
    const rows = await rowsOf<{ table_name: string }>(database.sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);
    const names = rows.map((row) => row.table_name);

    // Every table AUTH owns carries the prefix `docs/architecture/05-data-ownership.md`
    // assigns it, and AUTH owns nothing outside that prefix. Other domains
    // appear here because they share one database, never because AUTH created
    // them.
    expect(names.filter((name) => name.startsWith('auth_'))).toEqual([
      'auth_accounts',
      'auth_admin_authenticators',
      'auth_high_impact_authorizations',
      'auth_identities',
      'auth_known_devices',
      'auth_privileged_recovery_approvals',
      'auth_privileged_recovery_requests',
      'auth_recovery_rate_events',
      'auth_recovery_requests',
      'auth_refresh_families',
      'auth_refresh_tokens',
      'auth_security_events',
      'auth_security_owners',
      'auth_sessions',
    ]);
    expect(names.filter((name) => !name.startsWith('auth_'))).toEqual([
      'clubs_clubs',
      'clubs_content',
      'clubs_invites',
      'clubs_memberships',
      'creators_accounts',
      'creators_policy_acknowledgements',
      'creators_profile_links',
      'creators_profiles',
      'discovery_introductions',
      'discovery_outbox',
      'discovery_passes',
      'discovery_presentations',
      'messaging_conversations',
      'messaging_messages',
      'messaging_outbox',
      'messaging_participants',
      'notifications_attempts',
      'notifications_feed',
      'notifications_intents',
      'safety_blocks',
      'safety_enforcements',
      'safety_reports',
      'users_accounts',
      'users_adult_assurances',
      'users_availability',
      'users_policy_acknowledgements',
      'users_preferences',
      'users_profile_languages',
      'users_profile_media',
      'users_profiles',
    ]);
  });

  it('creates every index the AUTH access paths need and no duplicate of one', async () => {
    const indexes = await rowsOf<{ indexname: string; tablename: string }>(
      database.sql`select tablename, indexname from pg_indexes where schemaname = 'public' order by tablename, indexname`,
    );
    const names = indexes.map((row) => row.indexname);
    for (const required of [
      'auth_identities_provider_subject_uk',
      'auth_sessions_token_digest_uk',
      'auth_sessions_account_active_idx',
      'auth_refresh_tokens_token_digest_uk',
      'auth_refresh_tokens_live_family_uk',
      'auth_refresh_tokens_family_generation_uk',
      'auth_refresh_families_active_installation_uk',
      'auth_refresh_families_account_idx',
      'auth_recovery_requests_token_digest_uk',
      'auth_recovery_requests_account_idx',
      'auth_recovery_rate_events_scope_idx',
      'auth_security_events_account_idx',
      'auth_known_devices_account_device_uk',
      'auth_admin_authenticators_credential_uk',
      'auth_high_impact_authorizations_actor_idx',
    ]) {
      expect(names, required).toContain(required);
    }
    // A leading-column duplicate of a composite index earns nothing and costs
    // every write.
    expect(names).not.toContain('auth_sessions_account_idx');
    expect(names).not.toContain('auth_refresh_tokens_family_idx');
  });

  it('rejects a session token digest that is not a SHA-256 hex digest', async () => {
    const issued = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'digest-shape',
      subject: 'digest@velora.test',
    });
    let rejected = false;
    try {
      await execute(database.sql`
        update auth_sessions set token_digest = 'not-a-digest'
        where account_id = ${issued.context.accountId}
      `);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('permits at most one live refresh token per family', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'live-token-invariant',
      installationId: 'installation-0001',
      subject: 'live@velora.test',
    });
    const familyId = issued.context.refreshFamilyId;
    expect(familyId).toBeDefined();

    let rejected = false;
    try {
      await execute(database.sql`
        insert into auth_refresh_tokens (id, family_id, generation, token_digest, created_at)
        values (${crypto.randomUUID()}, ${familyId ?? ''}, 99, ${digestToken('v1.second-live')}, now())
      `);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('permits at most one live refresh family per installation', async () => {
    const first = await service.authenticateMobile({
      correlationId: 'installation-uniqueness',
      installationId: 'installation-0002',
      subject: 'installation@velora.test',
    });
    const second = await service.authenticateMobile({
      correlationId: 'installation-uniqueness',
      installationId: 'installation-0002',
      subject: 'installation@velora.test',
    });
    expect(second.context.refreshFamilyId).not.toBe(
      first.context.refreshFamilyId,
    );

    const live = await rowsOf<{ total: number }>(database.sql`
      select count(*)::int as total from auth_refresh_families
      where installation_id = 'installation-0002' and revoked_at is null
    `);
    expect(live[0]?.total).toBe(1);
  });

  it('refuses a compromised refresh family that is not also revoked', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'compromise-implies-revoked',
      installationId: 'installation-0003',
      subject: 'compromise@velora.test',
    });
    let rejected = false;
    try {
      await execute(database.sql`
        update auth_refresh_families set compromised_at = now()
        where id = ${issued.context.refreshFamilyId ?? ''}
      `);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe('AUTH identity resolution', () => {
  it('creates one account on first authentication and reuses it afterwards', async () => {
    const first = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'identity-1',
      subject: 'Reuse@Velora.Test',
    });
    const second = await service.authenticateBrowser({
      audience: 'creator_studio',
      correlationId: 'identity-2',
      subject: 'reuse@velora.test',
    });

    expect(second.context.accountId).toBe(first.context.accountId);
    expect(await countRows('auth_accounts')).toBe(1);
    expect(await countRows('auth_identities')).toBe(1);
  });

  it('converges on one account when the same subject authenticates concurrently', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        service.authenticateBrowser({
          audience: 'consumer_web',
          correlationId: `race-${String(index)}`,
          subject: 'race@velora.test',
        }),
      ),
    );
    const fulfilled = attempts.filter(
      (attempt) => attempt.status === 'fulfilled',
    );
    expect(fulfilled.length).toBeGreaterThan(0);
    expect(await countRows('auth_identities')).toBe(1);

    const accounts = new Set(
      fulfilled.map((attempt) => attempt.value.context.accountId),
    );
    expect(accounts.size).toBe(1);
  });
});

describe('browser session lifecycle', () => {
  it('stores only a digest and never the session or CSRF token', async () => {
    const issued = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'digest-only',
      subject: 'digest-only@velora.test',
    });

    const rows = await rowsOf<{
      csrf_digest: string;
      token_digest: string;
    }>(database.sql`
      select token_digest, csrf_digest from auth_sessions
      where account_id = ${issued.context.accountId}
    `);
    const stored = rows[0];
    expect(stored?.token_digest).toBe(digestToken(issued.sessionToken));
    expect(stored?.csrf_digest).toBe(digestToken(issued.csrfToken));

    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(issued.sessionToken);
    expect(serialised).not.toContain(issued.csrfToken);
  });

  it('applies the audience lifetime from ADR-0017 to each browser surface', async () => {
    const clock = fixedClock();
    const scoped = serviceAt(clock);
    for (const audience of ['consumer_web', 'creator_studio'] as const) {
      const issued = await scoped.authenticateBrowser({
        audience,
        correlationId: `lifetime-${audience}`,
        subject: `lifetime-${audience}@velora.test`,
      });
      const policy = browserSessionPolicy[audience];
      expect(
        issued.context.idleExpiresAt.getTime() - clock.current.getTime(),
      ).toBe(policy.idleMilliseconds);
      expect(
        issued.context.absoluteExpiresAt.getTime() - clock.current.getTime(),
      ).toBe(policy.absoluteMilliseconds);
    }
  });

  it('rejects a session after its idle window elapses without use', async () => {
    const clock = fixedClock();
    const scoped = serviceAt(clock);
    const active = await scoped.authenticateBrowser({
      audience: 'creator_studio',
      correlationId: 'idle-expiry',
      subject: 'idle-active@velora.test',
    });
    const idle = await scoped.authenticateBrowser({
      audience: 'creator_studio',
      correlationId: 'idle-expiry',
      subject: 'idle-lapsed@velora.test',
    });

    // Two sessions with identical windows: one is checked a second before its
    // idle limit, the other a second after. Resolving slides the limit, so the
    // two observations must not share a session.
    clock.current = new Date(active.context.idleExpiresAt.getTime() - 1_000);
    expect((await scoped.resolveBrowserSession(active.sessionToken)).kind).toBe(
      'active',
    );

    clock.current = new Date(idle.context.idleExpiresAt.getTime() + 1_000);
    expect((await scoped.resolveBrowserSession(idle.sessionToken)).kind).toBe(
      'rejected',
    );
  });

  it('rejects a session after its absolute window elapses even with activity', async () => {
    const clock = fixedClock();
    const scoped = serviceAt(clock);
    const issued = await scoped.authenticateBrowser({
      audience: 'creator_studio',
      correlationId: 'absolute-expiry',
      subject: 'absolute@velora.test',
    });

    // Keep the session busy for the whole absolute window.
    for (
      let cursor = clock.current.getTime();
      cursor < issued.context.absoluteExpiresAt.getTime();
      cursor += 3_600_000
    ) {
      clock.current = new Date(cursor);
      const resolution = await scoped.resolveBrowserSession(
        issued.sessionToken,
      );
      expect(resolution.kind).toBe('active');
      if (resolution.kind !== 'active') return;
      // Sliding idle expiry never reaches past the absolute lifetime.
      expect(resolution.context.idleExpiresAt.getTime()).toBeLessThanOrEqual(
        issued.context.absoluteExpiresAt.getTime(),
      );
    }

    clock.current = new Date(
      issued.context.absoluteExpiresAt.getTime() + 1_000,
    );
    expect((await scoped.resolveBrowserSession(issued.sessionToken)).kind).toBe(
      'rejected',
    );
  });

  it('rejects a revoked session immediately', async () => {
    const issued = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'revoke-now',
      subject: 'revoke@velora.test',
    });
    await service.revokeCurrentAuthority({
      context: issued.context,
      correlationId: 'revoke-now',
    });
    expect(
      (await service.resolveBrowserSession(issued.sessionToken)).kind,
    ).toBe('rejected');
  });

  it('rejects an unknown, malformed, or truncated session token', async () => {
    const issued = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'malformed',
      subject: 'malformed@velora.test',
    });
    for (const candidate of [
      'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      issued.sessionToken.slice(0, -1),
      issued.sessionToken.replace('v1.', 'v2.'),
      '',
      'not-a-token',
    ]) {
      expect((await service.resolveBrowserSession(candidate)).kind).toBe(
        'rejected',
      );
    }
  });

  it('keeps each audience structurally separate', async () => {
    const consumer = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'audience-isolation',
      subject: 'audience@velora.test',
    });
    const creator = await service.authenticateBrowser({
      audience: 'creator_studio',
      correlationId: 'audience-isolation',
      subject: 'audience@velora.test',
    });
    expect(consumer.context.audience).toBe('consumer_web');
    expect(creator.context.audience).toBe('creator_studio');
    expect(consumer.sessionToken).not.toBe(creator.sessionToken);

    const audiences = await rowsOf<{ audience: string }>(database.sql`
      select distinct audience from auth_sessions
      where account_id = ${consumer.context.accountId}
      order by audience
    `);
    expect(audiences.map((row) => row.audience)).toEqual([
      'consumer_web',
      'creator_studio',
    ]);
  });

  it('revokes every session and family for the account on global logout', async () => {
    const web = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'global-logout',
      subject: 'global@velora.test',
    });
    const studio = await service.authenticateBrowser({
      audience: 'creator_studio',
      correlationId: 'global-logout',
      subject: 'global@velora.test',
    });
    const mobile = await service.authenticateMobile({
      correlationId: 'global-logout',
      installationId: 'installation-0004',
      subject: 'global@velora.test',
    });

    const revoked = await service.revokeAllAuthority({
      accountId: web.context.accountId,
      audience: 'consumer_web',
      correlationId: 'global-logout',
      reason: 'logout_all',
    });
    expect(revoked.sessions).toBe(2);
    expect(revoked.families).toBe(1);

    expect((await service.resolveBrowserSession(web.sessionToken)).kind).toBe(
      'rejected',
    );
    expect(
      (await service.resolveBrowserSession(studio.sessionToken)).kind,
    ).toBe('rejected');
    expect(
      await service.resolveAccessToken(mobile.accessToken),
    ).toBeUndefined();

    // Idempotent: a second global logout is a no-op, not a failure.
    const again = await service.revokeAllAuthority({
      accountId: web.context.accountId,
      audience: 'consumer_web',
      correlationId: 'global-logout',
      reason: 'logout_all',
    });
    expect(again.sessions).toBe(0);
    expect(again.families).toBe(0);
  });
});

describe('mobile access and refresh lifecycle', () => {
  it('issues a signed, audience-bound access token and an opaque refresh token', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'mobile-issue',
      installationId: 'installation-0005',
      subject: 'mobile@velora.test',
    });

    expect(issued.refreshToken).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/u);
    const claims = signer().verify(issued.accessToken, new Date());
    expect(claims?.audience).toBe('consumer_mobile');
    expect(claims?.accountId).toBe(issued.context.accountId);

    const stored = await rowsOf<{ token_digest: string }>(database.sql`
      select token_digest from auth_refresh_tokens
    `);
    expect(stored[0]?.token_digest).toBe(digestToken(issued.refreshToken));
    expect(JSON.stringify(stored)).not.toContain(issued.refreshToken);
  });

  it('rejects an access token whose algorithm, issuer, key, or audience differs', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'token-forgery',
      installationId: 'installation-0006',
      subject: 'forge@velora.test',
    });
    const now = new Date();
    const [header, payload, signature] = issued.accessToken.split('.');
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const decode = (value: string) =>
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;

    const forged = [
      `${encode({ ...decode(header ?? ''), alg: 'none' })}.${payload ?? ''}.`,
      `${encode({ ...decode(header ?? ''), alg: 'HS512' })}.${payload ?? ''}.${signature ?? ''}`,
      `${encode({ ...decode(header ?? ''), kid: 'other' })}.${payload ?? ''}.${signature ?? ''}`,
      `${header ?? ''}.${encode({ ...decode(payload ?? ''), aud: 'platform_admin' })}.${signature ?? ''}`,
      `${header ?? ''}.${encode({ ...decode(payload ?? ''), iss: 'https://attacker.test' })}.${signature ?? ''}`,
      // A base64url signature's final character carries only four significant
      // bits, so substituting one character can decode to the identical bytes.
      // The mutation flips a bit in the decoded signature instead, which always
      // changes it.
      `${header ?? ''}.${payload ?? ''}.${flipFirstBit(signature ?? '')}`,
      `${header ?? ''}.${payload ?? ''}.${(signature ?? '').slice(0, -8)}`,
      `${header ?? ''}.${payload ?? ''}`,
      '',
    ];
    for (const candidate of forged) {
      expect(signer().verify(candidate, now)).toBeUndefined();
      expect(await service.resolveAccessToken(candidate)).toBeUndefined();
    }
  });

  it('rejects an access token whose backing family was revoked, without waiting for expiry', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'online-recheck',
      installationId: 'installation-0007',
      subject: 'recheck@velora.test',
    });
    expect(await service.resolveAccessToken(issued.accessToken)).toBeDefined();

    await service.revokeCurrentAuthority({
      context: issued.context,
      correlationId: 'online-recheck',
    });
    expect(
      await service.resolveAccessToken(issued.accessToken),
    ).toBeUndefined();
  });

  it('rotates the refresh token on every successful exchange', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'rotate',
      installationId: 'installation-0008',
      subject: 'rotate@velora.test',
    });

    let current = issued.refreshToken;
    const seen = new Set([current]);
    for (let round = 0; round < 5; round += 1) {
      const outcome = await service.rotateRefreshToken({
        correlationId: `rotate-${String(round)}`,
        refreshToken: current,
      });
      expect(outcome.kind).toBe('rotated');
      if (outcome.kind !== 'rotated') return;
      expect(seen.has(outcome.tokens.refreshToken)).toBe(false);
      seen.add(outcome.tokens.refreshToken);
      current = outcome.tokens.refreshToken;
    }

    const generations = await rowsOf<{
      consumed_at: Date | null;
      generation: number;
    }>(database.sql`
      select generation, consumed_at from auth_refresh_tokens
      order by generation
    `);
    expect(generations.map((row) => row.generation)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(generations.filter((row) => row.consumed_at === null).length).toBe(
      1,
    );
  });

  it('revokes the whole family and records evidence when a rotated token is replayed', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'replay',
      installationId: 'installation-0009',
      subject: 'replay@velora.test',
    });
    const rotated = await service.rotateRefreshToken({
      correlationId: 'replay-1',
      refreshToken: issued.refreshToken,
    });
    expect(rotated.kind).toBe('rotated');
    if (rotated.kind !== 'rotated') return;

    const replay = await service.rotateRefreshToken({
      correlationId: 'replay-2',
      refreshToken: issued.refreshToken,
    });
    expect(replay.kind).toBe('rejected');

    const family = await rowsOf<{
      compromised_at: Date | null;
      revocation_reason: string | null;
      revoked_at: Date | null;
    }>(database.sql`
      select revoked_at, revocation_reason, compromised_at
      from auth_refresh_families where id = ${issued.context.refreshFamilyId ?? ''}
    `);
    expect(family[0]?.revoked_at).not.toBeNull();
    expect(family[0]?.compromised_at).not.toBeNull();
    expect(family[0]?.revocation_reason).toBe('refresh_reuse_detected');

    // The descendant issued before the replay is dead too.
    const afterCompromise = await service.rotateRefreshToken({
      correlationId: 'replay-3',
      refreshToken: rotated.tokens.refreshToken,
    });
    expect(afterCompromise.kind).toBe('rejected');
    expect(
      await service.resolveAccessToken(rotated.tokens.accessToken),
    ).toBeUndefined();

    const events = await rowsOf<{ event_type: string }>(database.sql`
      select event_type from auth_security_events order by id
    `);
    const types = events.map((row) => row.event_type);
    expect(types).toContain('refresh_reuse_detected');
    expect(types).toContain('refresh_family_revoked');
  });

  it('revokes the family on any second presentation of a consumed token', async () => {
    const issued = await service.authenticateMobile({
      correlationId: 'strict-replay',
      installationId: 'installation-0010',
      subject: 'strict@velora.test',
    });
    const first = await service.rotateRefreshToken({
      correlationId: 'strict-replay-1',
      refreshToken: issued.refreshToken,
    });
    expect(first.kind).toBe('rotated');

    // Immediately, with no delay and nothing else changed. There is no window
    // in which a consumed token is tolerated.
    const replay = await service.rotateRefreshToken({
      correlationId: 'strict-replay-1',
      refreshToken: issued.refreshToken,
    });
    expect(replay.kind).toBe('rejected');
    const family = await rowsOf<{ revoked_at: Date | null }>(
      database.sql`select revoked_at from auth_refresh_families where id = ${issued.context.refreshFamilyId ?? ''}`,
    );
    expect(family[0]?.revoked_at).not.toBeNull();
  });

  it('rejects rotation once the refresh family exceeds its absolute lifetime', async () => {
    const clock = fixedClock();
    const scoped = serviceAt(clock);
    const issued = await scoped.authenticateMobile({
      correlationId: 'family-expiry',
      installationId: 'installation-0011',
      subject: 'expiry@velora.test',
    });

    clock.current = new Date(
      issued.refreshTokenAbsoluteExpiresAt.getTime() + 1_000,
    );
    const outcome = await scoped.rotateRefreshToken({
      correlationId: 'family-expiry',
      refreshToken: issued.refreshToken,
    });
    expect(outcome.kind).toBe('rejected');
  });

  it('rejects rotation once the refresh family exceeds its idle window', async () => {
    const clock = fixedClock();
    const scoped = serviceAt(clock);
    const issued = await scoped.authenticateMobile({
      correlationId: 'family-idle',
      installationId: 'installation-0012',
      subject: 'idle-family@velora.test',
    });

    clock.current = new Date(
      issued.refreshTokenIdleExpiresAt.getTime() + 1_000,
    );
    const outcome = await scoped.rotateRefreshToken({
      correlationId: 'family-idle',
      refreshToken: issued.refreshToken,
    });
    expect(outcome.kind).toBe('rejected');
  });

  it('rejects a refresh token that was never issued', async () => {
    const outcome = await service.rotateRefreshToken({
      correlationId: 'unknown-refresh',
      refreshToken: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(outcome.kind).toBe('rejected');
  });
});

describe('concurrent refresh rotation against real PostgreSQL', () => {
  const contenders = 12;

  it('lets exactly one concurrent exchange succeed and leaves no duplicate live descendant', async () => {
    for (let round = 0; round < 10; round += 1) {
      await database.truncate();
      const issued = await service.authenticateMobile({
        correlationId: `concurrency-${String(round)}`,
        installationId: `installation-race-${String(round)}`,
        subject: `race-${String(round)}@velora.test`,
      });

      const outcomes = await Promise.all(
        Array.from({ length: contenders }, async (_, index) =>
          service.rotateRefreshToken({
            correlationId: `concurrency-${String(round)}-${String(index)}`,
            refreshToken: issued.refreshToken,
          }),
        ),
      );

      const rotated = outcomes.filter((outcome) => outcome.kind === 'rotated');
      expect(rotated.length).toBe(1);
      expect(
        outcomes.filter((outcome) => outcome.kind === 'rejected').length,
      ).toBe(contenders - 1);

      const familyId = issued.context.refreshFamilyId ?? '';
      const live = await repository.countLiveRefreshTokens(
        repository.transactionless,
        familyId,
      );
      // Either the family survived with exactly one live descendant, or the
      // replay response revoked it; both leave at most one live token.
      expect(live).toBeLessThanOrEqual(1);

      const tokens = await repository.listRefreshTokens(
        repository.transactionless,
        familyId,
      );
      expect(tokens.length).toBe(2);
      expect(tokens.map((token) => token.generation)).toEqual([0, 1]);

      // The family is compromised because the losers replayed a consumed
      // token, which is the fail-closed behaviour ADR-0017 requires.
      const family = await repository.findRefreshFamily(
        repository.transactionless,
        familyId,
      );
      expect(family?.compromisedAt).not.toBeNull();
    }
  }, 120_000);

  it('leaves at most one live descendant under a large simultaneous burst', async () => {
    const burst = 50;
    for (let round = 0; round < 5; round += 1) {
      await database.truncate();
      const issued = await service.authenticateMobile({
        correlationId: `burst-${String(round)}`,
        installationId: `installation-burst-${String(round)}`,
        subject: `burst-${String(round)}@velora.test`,
      });

      const outcomes = await Promise.all(
        Array.from({ length: burst }, async (_, index) =>
          service.rotateRefreshToken({
            correlationId: `burst-${String(round)}-${String(index)}`,
            refreshToken: issued.refreshToken,
          }),
        ),
      );
      expect(
        outcomes.filter((outcome) => outcome.kind === 'rotated').length,
      ).toBe(1);
      expect(
        outcomes.filter((outcome) => outcome.kind === 'rejected').length,
      ).toBe(burst - 1);

      const familyId = issued.context.refreshFamilyId ?? '';
      expect(
        await repository.countLiveRefreshTokens(
          repository.transactionless,
          familyId,
        ),
      ).toBeLessThanOrEqual(1);
      const family = await repository.findRefreshFamily(
        repository.transactionless,
        familyId,
      );
      expect(family?.compromisedAt).not.toBeNull();
    }
  }, 180_000);
});

describe('AUTH security events', () => {
  it('records authentication and session facts without any secret material', async () => {
    const issued = await service.authenticateBrowser({
      audience: 'consumer_web',
      correlationId: 'event-hygiene',
      subject: 'events@velora.test',
    });
    await service.revokeCurrentAuthority({
      context: issued.context,
      correlationId: 'event-hygiene',
    });

    const events = await rowsOf<Record<string, unknown>>(database.sql`
      select * from auth_security_events order by id
    `);
    expect(events.map((event) => event.event_type)).toEqual([
      'authentication_succeeded',
      'session_created',
      'session_revoked',
    ]);

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(issued.sessionToken);
    expect(serialised).not.toContain(issued.csrfToken);
    expect(serialised).not.toContain('events@velora.test');
  });
});
