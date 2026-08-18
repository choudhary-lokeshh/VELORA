import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createIdentityRuntime } from '../../src/identity/composition.js';
import { LocalTestIdentityJurisdictionPolicy } from '../../src/identity/jurisdiction.js';
import { LocalTestIdentityVerificationProvider } from '../../src/identity/local-test-provider.js';
import {
  IdentityOrchestrator,
  type AuthorizedIdentityStart,
} from '../../src/identity/orchestrator.js';
import {
  IdentityProviderUnavailableError,
  type CreateIdentityHostedSessionRequest,
  type IdentityHostedSession,
} from '../../src/identity/provider.js';
import { IdentityRepository } from '../../src/identity/repository.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { testServerConfig } from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_identity_orchestration');
const database: TestDatabase = connectDatabase(databaseUrl, { max: 60 });
const config = testServerConfig({
  IDENTITY_JURISDICTION_POLICY: 'local-test',
  IDENTITY_VERIFICATION_PROVIDER: 'local-test',
});
const runtime = createIdentityRuntime({
  config,
  database: database.drizzle,
});
const provider = runtime.provider as LocalTestIdentityVerificationProvider;

beforeEach(async () => {
  provider.behaveAs('normal');
  await database.truncate();
});
afterAll(async () => database.close());

function request(
  suffix: string,
  overrides: Partial<AuthorizedIdentityStart> = {},
): AuthorizedIdentityStart {
  return {
    callerIdempotencyKey: `identity-operation-${suffix}`,
    correlationId: `correlation-${suffix}`,
    jurisdiction: 'ES',
    ownerDomain: 'auth',
    ownerReference: crypto.randomUUID(),
    purpose: 'adult_assurance',
    ...overrides,
  };
}

async function count(table: string): Promise<number> {
  const rows = await rowsOf<{ total: string }>(
    database.sql`select count(*)::text as total from ${database.sql(table)}`,
  );
  return Number(rows[0]?.total ?? 0);
}

describe('authorized verification start', () => {
  it('converges fifty duplicate starts on one attempt and one provider instruction', async () => {
    const input = request('fifty');
    const before = provider.createCallCount();
    const outcomes = await Promise.all(
      Array.from({ length: 50 }, () => runtime.orchestrator.start(input)),
    );
    const started = outcomes.filter((outcome) => outcome.kind === 'started');

    expect(started).toHaveLength(50);
    expect(new Set(started.map((outcome) => outcome.attempt.id)).size).toBe(1);
    expect(provider.createCallCount() - before).toBe(1);
    expect(await count('identity_subjects')).toBe(1);
    expect(await count('identity_attempts')).toBe(1);
    expect(started.some((outcome) => outcome.handoff !== undefined)).toBe(true);

    const states = await rowsOf<{ state: string }>(
      database.sql`select state from identity_attempts`,
    );
    expect(states).toEqual([{ state: 'provider_pending' }]);
  });

  it('rejects changed canonical input under one key', async () => {
    const ownerReference = crypto.randomUUID();
    const first = request('mismatch', { ownerReference });
    expect((await runtime.orchestrator.start(first)).kind).toBe('started');

    const changed = await runtime.orchestrator.start({
      ...first,
      jurisdiction: 'US-CA',
    });
    expect(changed).toEqual({
      kind: 'refused',
      reason: 'idempotency_mismatch',
    });
    expect(await count('identity_attempts')).toBe(1);
  });

  it('canonicalizes an opaque UUID before idempotency comparison', async () => {
    const ownerReference = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const input = request('canonical', { ownerReference });
    const first = await runtime.orchestrator.start(input);
    const replay = await runtime.orchestrator.start({
      ...input,
      ownerReference: ownerReference.toUpperCase(),
    });
    expect(first.kind).toBe('started');
    expect(replay.kind).toBe('started');
    if (first.kind !== 'started' || replay.kind !== 'started') {
      throw new Error('setup failed');
    }
    expect(replay.attempt.id).toBe(first.attempt.id);
    expect(await count('identity_subjects')).toBe(1);
  });

  it('keeps a different key from opening a second active purpose', async () => {
    const ownerReference = crypto.randomUUID();
    expect(
      (
        await runtime.orchestrator.start(
          request('active-first', { ownerReference }),
        )
      ).kind,
    ).toBe('started');
    expect(
      await runtime.orchestrator.start(
        request('active-second', { ownerReference }),
      ),
    ).toEqual({ kind: 'refused', reason: 'active_attempt_exists' });
  });

  it('recovers an ambiguous create by provider idempotency without a second instruction', async () => {
    const input = request('ambiguous');
    const before = provider.createCallCount();
    provider.behaveAs('ambiguous');
    const first = await runtime.orchestrator.start(input);
    expect(first.kind).toBe('started');
    if (first.kind !== 'started') throw new Error('setup failed');
    expect(first.attempt.state).toBe('provider_starting');
    expect(first.recoverable).toBe(true);

    provider.behaveAs('normal');
    const recovered = await runtime.orchestrator.start(input);
    expect(recovered.kind).toBe('started');
    if (recovered.kind !== 'started') throw new Error('recovery failed');
    expect(recovered.attempt.state).toBe('provider_pending');
    expect(recovered.handoff?.url).toStartWith('https://');
    expect(provider.createCallCount() - before).toBe(1);
  });

  it('persists nothing for unknown, blocked, unavailable, or malformed input', async () => {
    expect(
      await runtime.orchestrator.start(
        request('unknown', { jurisdiction: 'FR' }),
      ),
    ).toEqual({ kind: 'refused', reason: 'policy_unknown' });
    expect(
      await runtime.orchestrator.start(
        request('blocked', { jurisdiction: 'AQ' }),
      ),
    ).toEqual({ kind: 'refused', reason: 'policy_blocked' });
    expect(
      await runtime.orchestrator.start(
        request('malformed', { ownerReference: 'not-a-uuid' }),
      ),
    ).toEqual({ kind: 'refused', reason: 'invalid_input' });
    expect(
      await runtime.orchestrator.start(
        request('bad-key', { callerIdempotencyKey: 'bad\nkey!!' }),
      ),
    ).toEqual({ kind: 'refused', reason: 'invalid_input' });
    expect(
      await runtime.orchestrator.start(
        request('bad-correlation', { correlationId: 'bad\ncorrelation' }),
      ),
    ).toEqual({ kind: 'refused', reason: 'invalid_input' });

    const unavailable = createIdentityRuntime({
      config: testServerConfig({
        IDENTITY_JURISDICTION_POLICY: 'local-test',
      }),
      database: database.drizzle,
    });
    expect(
      await unavailable.orchestrator.start(request('unavailable')),
    ).toEqual({ kind: 'refused', reason: 'provider_unavailable' });
    expect(await count('identity_subjects')).toBe(0);
    expect(await count('identity_attempts')).toBe(0);
  });

  it('records an explicit provider outage as terminal unavailable', async () => {
    class OutageProvider extends LocalTestIdentityVerificationProvider {
      override createHostedSession(): Promise<IdentityHostedSession> {
        return Promise.reject(new IdentityProviderUnavailableError());
      }
    }

    const orchestrator = new IdentityOrchestrator({
      jurisdictionPolicy: new LocalTestIdentityJurisdictionPolicy(),
      now: () => new Date(),
      provider: new OutageProvider(),
      repository: new IdentityRepository(database.drizzle),
    });
    expect(await orchestrator.start(request('provider-outage'))).toEqual({
      kind: 'refused',
      reason: 'provider_unavailable',
    });
    const states = await rowsOf<{ state: string }>(
      database.sql`select state from identity_attempts`,
    );
    expect(states).toEqual([{ state: 'unavailable' }]);
  });

  it('does not bind a provider response for a different subject', async () => {
    class WrongSubjectProvider extends LocalTestIdentityVerificationProvider {
      override async createHostedSession(
        input: CreateIdentityHostedSessionRequest,
      ): Promise<IdentityHostedSession> {
        const session = await super.createHostedSession(input);
        return {
          ...session,
          snapshot: {
            ...session.snapshot,
            platformSubjectReference: crypto.randomUUID(),
          },
        };
      }
    }

    const orchestrator = new IdentityOrchestrator({
      jurisdictionPolicy: new LocalTestIdentityJurisdictionPolicy(),
      now: () => new Date(),
      provider: new WrongSubjectProvider(),
      repository: new IdentityRepository(database.drizzle),
    });
    const outcome = await orchestrator.start(request('wrong-subject'));
    expect(outcome.kind).toBe('started');
    if (outcome.kind !== 'started') throw new Error('setup failed');
    expect(outcome.attempt.state).toBe('provider_starting');
    expect(outcome.handoff).toBeUndefined();
  });

  it('keeps malformed adapter output recoverable instead of throwing', async () => {
    class MalformedProvider extends LocalTestIdentityVerificationProvider {
      override async createHostedSession(
        input: CreateIdentityHostedSessionRequest,
      ): Promise<IdentityHostedSession> {
        await super.createHostedSession(input);
        return { snapshot: null } as unknown as IdentityHostedSession;
      }
    }

    const orchestrator = new IdentityOrchestrator({
      jurisdictionPolicy: new LocalTestIdentityJurisdictionPolicy(),
      now: () => new Date(),
      provider: new MalformedProvider(),
      repository: new IdentityRepository(database.drizzle),
    });
    const outcome = await orchestrator.start(request('malformed-provider'));
    expect(outcome.kind).toBe('started');
    if (outcome.kind !== 'started') throw new Error('setup failed');
    expect(outcome.attempt.state).toBe('provider_starting');
    expect(outcome.recoverable).toBe(true);
    expect(outcome.handoff).toBeUndefined();
  });

  it('never returns an insecure or expired provider handoff', async () => {
    const fixedNow = new Date('2026-08-18T12:00:00.000Z');

    class UnsafeHandoffProvider extends LocalTestIdentityVerificationProvider {
      override async createHostedSession(
        input: CreateIdentityHostedSessionRequest,
      ): Promise<IdentityHostedSession> {
        const session = await super.createHostedSession(input);
        return {
          ...session,
          expiresAt: new Date(fixedNow.getTime() - 1),
          hostedUrl: 'http://127.0.0.1/private',
        };
      }
    }

    const orchestrator = new IdentityOrchestrator({
      jurisdictionPolicy: new LocalTestIdentityJurisdictionPolicy(),
      now: () => fixedNow,
      provider: new UnsafeHandoffProvider(() => fixedNow),
      repository: new IdentityRepository(database.drizzle),
    });
    const outcome = await orchestrator.start(request('unsafe-handoff'));
    expect(outcome.kind).toBe('started');
    if (outcome.kind !== 'started') throw new Error('setup failed');
    expect(outcome.attempt.state).toBe('provider_pending');
    expect(outcome.handoff).toBeUndefined();
  });
});

describe('provider I/O boundary', () => {
  it('calls the provider with no PostgreSQL transaction held open', async () => {
    class TransactionProbeProvider extends LocalTestIdentityVerificationProvider {
      idleInTransaction = -1;

      override async createHostedSession(
        input: CreateIdentityHostedSessionRequest,
      ): Promise<IdentityHostedSession> {
        const rows = await rowsOf<{ total: string }>(database.sql`
          select count(*)::text as total
          from pg_stat_activity
          where datname = current_database()
            and application_name = 'velora-test-harness'
            and state = 'idle in transaction'
        `);
        this.idleInTransaction = Number(rows[0]?.total ?? -1);
        return super.createHostedSession(input);
      }
    }

    const probe = new TransactionProbeProvider();
    const repository = new IdentityRepository(database.drizzle);
    const orchestrator = new IdentityOrchestrator({
      jurisdictionPolicy: new LocalTestIdentityJurisdictionPolicy(),
      now: () => new Date(),
      provider: probe,
      repository,
    });
    expect((await orchestrator.start(request('transaction-probe'))).kind).toBe(
      'started',
    );
    expect(probe.idleInTransaction).toBe(0);
  });
});
