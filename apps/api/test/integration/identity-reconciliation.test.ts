import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createIdentityRuntime } from '../../src/identity/composition.js';
import type { LocalTestIdentityVerificationProvider } from '../../src/identity/local-test-provider.js';
import type { IdentityStartOutcome } from '../../src/identity/orchestrator.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
} from '../support/database.js';
import type { TestDatabase } from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_identity_reconciliation');
const database: TestDatabase = connectDatabase(databaseUrl, { max: 60 });
let clock = new Date('2026-08-19T12:00:00.000Z');
const now = () => new Date(clock);
const loggerRecords: unknown[] = [];
const runtime = createIdentityRuntime({
  config: testServerConfig({
    IDENTITY_JURISDICTION_POLICY: 'local-test',
    IDENTITY_VERIFICATION_PROVIDER: 'local-test',
  }),
  database: database.drizzle,
  logger: silentLogger(loggerRecords),
  now,
  owner: 'identity-reconciliation-test',
});
const provider = runtime.provider as LocalTestIdentityVerificationProvider;

beforeEach(async () => {
  clock = new Date('2026-08-19T12:00:00.000Z');
  loggerRecords.length = 0;
  provider.behaveAs('normal');
  await database.truncate();
});

afterAll(async () => database.close());

async function count(table: string): Promise<number> {
  const rows = await rowsOf<{ total: string }>(
    database.sql`select count(*)::text as total from ${database.sql(table)}`,
  );
  return Number(rows[0]?.total ?? 0);
}

async function start(suffix: string): Promise<{
  readonly attempt: Extract<
    IdentityStartOutcome,
    { kind: 'started' }
  >['attempt'];
  readonly providerReference: string;
}> {
  const outcome = await runtime.orchestrator.start({
    callerIdempotencyKey: `identity-reconciliation-${suffix}`,
    correlationId: `identity-reconciliation-correlation-${suffix}`,
    jurisdiction: 'ES',
    ownerDomain: 'auth',
    ownerReference: crypto.randomUUID(),
    purpose: 'adult_assurance',
  });
  if (
    outcome.kind !== 'started' ||
    outcome.attempt.providerReference === null
  ) {
    throw new Error('identity reconciliation setup failed');
  }
  return {
    attempt: outcome.attempt,
    providerReference: outcome.attempt.providerReference,
  };
}

function grantedFact(providerFactReference: string) {
  return {
    effectiveAt: now(),
    evidenceClass: 'adult_threshold' as const,
    expiresAt: new Date(now().getTime() + 86_400_000),
    normalizedResult: 'granted' as const,
    providerFactReference,
    thresholdContext: 'adult-18-plus',
  };
}

describe('identity reconciliation', () => {
  it('recovers an ambiguous hosted-session create without a second instruction', async () => {
    provider.behaveAs('ambiguous');
    const outcome = await runtime.orchestrator.start({
      callerIdempotencyKey: 'identity-reconciliation-ambiguous',
      correlationId: 'identity-reconciliation-correlation-ambiguous',
      jurisdiction: 'ES',
      ownerDomain: 'auth',
      ownerReference: crypto.randomUUID(),
      purpose: 'adult_assurance',
    });
    expect(outcome.kind).toBe('started');
    if (outcome.kind !== 'started') throw new Error('setup failed');
    expect(outcome.attempt.state).toBe('provider_starting');

    provider.behaveAs('normal');
    const report = await runtime.reconciliation.reconcileOnce();
    expect(report).toMatchObject({
      examined: 1,
      failed: 0,
      found: 1,
      outstanding: 0,
      repaired: 1,
    });
    const attempts = await rowsOf<{
      reconciliation_checked_at: Date | null;
      state: string;
    }>(
      database.sql`select reconciliation_checked_at, state from identity_attempts`,
    );
    expect(attempts).toEqual([
      { reconciliation_checked_at: now(), state: 'provider_pending' },
    ]);
    const findings = await rowsOf<{ kind: string; state: string }>(
      database.sql`select kind, state from identity_reconciliation_findings`,
    );
    expect(findings).toEqual([{ kind: 'callback_gap', state: 'resolved' }]);
  });

  it('recovers a missing callback through append-only evidence and one outbox fact', async () => {
    const setup = await start('succeeded');
    provider.setResult({
      evidence: [grantedFact('identity-reconciliation-granted')],
      providerReference: setup.providerReference,
      state: 'succeeded',
    });

    const reports = await Promise.all([
      runtime.reconciliation.reconcileOnce(),
      runtime.reconciliation.reconcileOnce(),
    ]);
    expect(reports.reduce((total, report) => total + report.repaired, 0)).toBe(
      1,
    );
    expect(await count('identity_evidence')).toBe(1);
    expect(await count('identity_outbox')).toBe(1);
    expect(await count('identity_reconciliation_findings')).toBe(1);
    expect(
      await rowsOf<{ state: string }>(
        database.sql`select state from identity_attempts`,
      ),
    ).toEqual([{ state: 'succeeded' }]);
  });

  it('refuses an impossible first revocation before it can bind a provider reference', async () => {
    provider.behaveAs('ambiguous');
    const outcome = await runtime.orchestrator.start({
      callerIdempotencyKey: 'identity-reconciliation-impossible-revocation',
      correlationId:
        'identity-reconciliation-correlation-impossible-revocation',
      jurisdiction: 'ES',
      ownerDomain: 'auth',
      ownerReference: crypto.randomUUID(),
      purpose: 'adult_assurance',
    });
    expect(outcome.kind).toBe('started');
    if (outcome.kind !== 'started') throw new Error('setup failed');
    const session = await provider.retrieveByIdempotencyKey(
      outcome.attempt.providerIdempotencyKey,
    );
    if (session === undefined)
      throw new Error('provider session was not created');
    provider.setResult({
      evidence: [
        {
          effectiveAt: now(),
          evidenceClass: 'adult_threshold',
          normalizedResult: 'revoked',
          providerFactReference:
            'identity-reconciliation-impossible-revocation',
          thresholdContext: 'adult-18-plus',
        },
      ],
      providerReference: session.snapshot.providerReference,
      state: 'revoked',
    });
    const current = await provider.retrieveCurrentState(
      session.snapshot.providerReference,
    );
    expect(
      await runtime.providerEvents.applyRetrievedProviderSnapshot(current),
    ).toBe(false);
    expect(
      await rowsOf<{
        provider_reference: string | null;
        state: string;
      }>(database.sql`select provider_reference, state from identity_attempts`),
    ).toEqual([{ provider_reference: null, state: 'provider_starting' }]);
    expect(await count('identity_evidence')).toBe(0);
  });

  it('recovers a later revocation as a successor fact without rewriting a grant', async () => {
    const setup = await start('revocation');
    provider.setResult({
      evidence: [grantedFact('identity-reconciliation-grant')],
      providerReference: setup.providerReference,
      state: 'succeeded',
    });
    await runtime.reconciliation.reconcileOnce();

    clock = new Date(clock.getTime() + 60_001);
    provider.setResult({
      evidence: [
        {
          effectiveAt: now(),
          evidenceClass: 'adult_threshold',
          normalizedResult: 'revoked',
          providerFactReference: 'identity-reconciliation-revocation',
          thresholdContext: 'adult-18-plus',
        },
      ],
      providerReference: setup.providerReference,
      state: 'revoked',
    });
    const report = await runtime.reconciliation.reconcileOnce();
    expect(report).toMatchObject({ failed: 0, found: 1, repaired: 1 });
    const evidence = await rowsOf<{
      normalized_result: string;
      supersedes_id: string | null;
    }>(
      database.sql`select normalized_result, supersedes_id from identity_evidence order by effective_at`,
    );
    expect(evidence.map((row) => row.normalized_result)).toEqual([
      'granted',
      'revoked',
    ]);
    expect(evidence[1]?.supersedes_id).not.toBeNull();
    expect(await count('identity_outbox')).toBe(2);
  });

  it('records a retrieval failure without creating evidence, a finding, or an identity-bearing log', async () => {
    const setup = await start('outage');
    provider.behaveAs('retrieval-outage');
    const report = await runtime.reconciliation.reconcileOnce();
    expect(report).toMatchObject({
      examined: 1,
      failed: 1,
      found: 0,
      repaired: 0,
    });
    expect(await count('identity_evidence')).toBe(0);
    expect(await count('identity_reconciliation_findings')).toBe(0);
    const logs = JSON.stringify(loggerRecords);
    expect(logs).not.toContain(setup.attempt.subjectId);
    expect(logs).not.toContain(setup.providerReference);
  });

  it('only records a stuck pre-provider attempt; it never starts one autonomously', async () => {
    const established = await runtime.repository.establishAttempt({
      callerIdempotencyKey: 'identity-reconciliation-created',
      inputDigest: 'a'.repeat(64),
      jurisdiction: 'ES',
      now: now(),
      ownerDomain: 'auth',
      ownerReference: crypto.randomUUID(),
      policyVersion: 'local-test-v1',
      provider: 'local-test',
      providerIdempotencyKey: 'identity-provider-key-created',
      purpose: 'adult_assurance',
      requiredEvidenceClass: 'adult_threshold',
      requiredThreshold: 'adult-18-plus',
    });
    expect(established.kind).toBe('created');
    const before = provider.createCallCount();
    const report = await runtime.reconciliation.reconcileOnce();
    expect(report).toMatchObject({ failed: 0, found: 1, repaired: 0 });
    expect(provider.createCallCount()).toBe(before);
    expect(
      await rowsOf<{ state: string }>(
        database.sql`select state from identity_attempts`,
      ),
    ).toEqual([{ state: 'created' }]);
    expect(
      await rowsOf<{ kind: string; reason_code: string }>(
        database.sql`select kind, reason_code from identity_reconciliation_findings`,
      ),
    ).toEqual([
      { kind: 'stuck_attempt', reason_code: 'provider_start_not_claimed' },
    ]);
  });
});
