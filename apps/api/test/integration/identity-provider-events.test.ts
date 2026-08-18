import { createHmac } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createIdentityRuntime } from '../../src/identity/composition.js';
import type { TransactionHandle } from '../../src/database/executor.js';
import {
  localTestIdentityCallbackSecret,
  localTestIdentitySignatureHeader,
} from '../../src/identity/local-test-provider.js';
import type { LocalTestIdentityVerificationProvider } from '../../src/identity/local-test-provider.js';
import { maximumIdentityProviderEventBodyBytes } from '../../src/identity/policy.js';
import { IdentityProviderEventService } from '../../src/identity/provider-events.js';
import type { IdentityVerificationProviderPort } from '../../src/identity/provider.js';
import { IdentityRepository } from '../../src/identity/repository.js';
import type { IdentityStartOutcome } from '../../src/identity/orchestrator.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_identity_provider_events');
const database: TestDatabase = connectDatabase(databaseUrl, { max: 60 });
let clock = new Date('2026-08-18T12:00:00.000Z');
const now = () => new Date(clock);
const loggerRecords: unknown[] = [];
const logger = silentLogger(loggerRecords);
const config = testServerConfig({
  IDENTITY_JURISDICTION_POLICY: 'local-test',
  IDENTITY_VERIFICATION_PROVIDER: 'local-test',
});
const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: { rateLimiter: new InMemoryRateLimiter() },
});
const media = testMediaRuntime({
  config,
  database: database.drizzle,
  logger,
  now,
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  media: media.service,
  now,
});
const product = testProductRuntimes({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
  users,
});
const application = createApplication({
  config,
  dependencies: {
    auth,
    ...product,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    ephemeralRedis: healthy,
    logger,
    queueRedis: healthy,
    users,
  },
});
const provider = product.identity
  .provider as LocalTestIdentityVerificationProvider;
const handle = (request: Request) => application.app.handle(request);

beforeEach(async () => {
  clock = new Date('2026-08-18T12:00:00.000Z');
  loggerRecords.length = 0;
  provider.behaveAs('normal');
  await database.truncate();
});

afterAll(async () => {
  await application.close();
  await database.close();
});

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
  const outcome = await product.identity.orchestrator.start({
    callerIdempotencyKey: `identity-callback-${suffix}`,
    correlationId: `identity-correlation-${suffix}`,
    jurisdiction: 'ES',
    ownerDomain: 'auth',
    ownerReference: crypto.randomUUID(),
    purpose: 'adult_assurance',
  });
  if (
    outcome.kind !== 'started' ||
    outcome.attempt.providerReference === null
  ) {
    throw new Error('identity verification setup failed');
  }
  return {
    attempt: outcome.attempt,
    providerReference: outcome.attempt.providerReference,
  };
}

function signedCallback(input: {
  readonly eventId: string;
  readonly eventType?: string;
  readonly occurredAt?: Date;
  readonly padding?: string;
  readonly providerReference: string;
}): Request {
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      eventId: input.eventId,
      eventType: input.eventType ?? 'verification.updated',
      occurredAt: (input.occurredAt ?? clock).toISOString(),
      ...(input.padding === undefined ? {} : { padding: input.padding }),
      providerReference: input.providerReference,
    }),
  );
  const signature = createHmac('sha256', localTestIdentityCallbackSecret)
    .update(rawBody)
    .digest('hex');
  return new Request('http://api.test/v1/identity/provider-events', {
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      [localTestIdentitySignatureHeader]: signature,
    },
    method: 'POST',
  });
}

async function receive(input: Parameters<typeof signedCallback>[0]) {
  return handle(signedCallback(input));
}

function grantedFact(input: {
  readonly effectiveAt?: Date;
  readonly providerFactReference: string;
}) {
  return {
    effectiveAt: input.effectiveAt ?? now(),
    evidenceClass: 'adult_threshold' as const,
    expiresAt: new Date(now().getTime() + 86_400_000),
    normalizedResult: 'granted' as const,
    providerFactReference: input.providerFactReference,
    thresholdContext: 'adult-18-plus',
  };
}

describe('verified identity-provider callback intake and processing', () => {
  it('fails closed when no provider is configured', async () => {
    const unavailable = createIdentityRuntime({
      config: testServerConfig(),
      database: database.drizzle,
      logger,
      now,
      owner: 'identity-unavailable-test',
    });
    const rawBody = new TextEncoder().encode('{}');
    const result = await unavailable.providerEventRoutes.receive({
      body: '{}',
      correlationId: 'identity-unavailable-correlation',
      rawBody,
      request: new Request('http://api.test/v1/identity/provider-events', {
        body: rawBody,
        method: 'POST',
      }),
    });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(await count('identity_provider_events')).toBe(0);
  });

  it('authenticates exact bytes before parsing and refuses malformed UTF-8 opaquely', async () => {
    const unsigned = await handle(
      new Request('http://api.test/v1/identity/provider-events', {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(unsigned.status).toBe(401);

    const invalid = Uint8Array.from([0xff, 0xfe, 0xfd]);
    const signature = createHmac('sha256', localTestIdentityCallbackSecret)
      .update(invalid)
      .digest('hex');
    const malformed = await handle(
      new Request('http://api.test/v1/identity/provider-events', {
        body: invalid,
        headers: {
          'content-type': 'application/json',
          [localTestIdentitySignatureHeader]: signature,
        },
        method: 'POST',
      }),
    );
    expect(malformed.status).toBe(401);
    expect(await count('identity_provider_events')).toBe(0);
  });

  it('refuses an oversized callback before provider verification', async () => {
    const setup = await start('oversized');
    const response = await receive({
      eventId: 'identity-event-oversized',
      padding: 'x'.repeat(maximumIdentityProviderEventBodyBytes),
      providerReference: setup.providerReference,
    });
    expect(response.status).toBe(413);
    expect(await count('identity_provider_events')).toBe(0);
  });

  it('converges fifty signed duplicates and rejects changed content under one event identity', async () => {
    const setup = await start('duplicates');
    const first = {
      eventId: 'identity-event-duplicate',
      providerReference: setup.providerReference,
    };
    const responses = await Promise.all(
      Array.from({ length: 50 }, async () => receive(first)),
    );
    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(await count('identity_provider_events')).toBe(1);

    const mismatch = await receive({
      ...first,
      eventType: 'verification.changed-content',
    });
    expect(mismatch.status).toBe(401);
    expect(await count('identity_provider_events')).toBe(1);
  });

  it('applies one current provider fact atomically and persists no callback or handoff body', async () => {
    const setup = await start('success');
    provider.setResult({
      evidence: [grantedFact({ providerFactReference: 'fact-success-1' })],
      providerReference: setup.providerReference,
      state: 'succeeded',
    });
    expect(
      (
        await receive({
          eventId: 'identity-event-success',
          providerReference: setup.providerReference,
        })
      ).status,
    ).toBe(202);

    const reports = await Promise.all([
      product.identity.providerEvents.processOnce(),
      product.identity.providerEvents.processOnce(),
    ]);
    expect(reports.reduce((total, report) => total + report.processed, 0)).toBe(
      1,
    );
    expect(await count('identity_evidence')).toBe(1);
    expect(await count('identity_outbox')).toBe(1);

    const attempts = await rowsOf<{ state: string }>(
      database.sql`select state from identity_attempts`,
    );
    const inbox = await rowsOf<Record<string, unknown>>(
      database.sql`select * from identity_provider_events`,
    );
    const outbox = await rowsOf<{
      event_name: string;
      payload: string;
    }>(database.sql`select event_name, payload from identity_outbox`);
    expect(attempts).toEqual([{ state: 'succeeded' }]);
    expect(inbox).toHaveLength(1);
    expect(JSON.stringify(inbox)).not.toContain('hostedUrl');
    expect(JSON.stringify(inbox)).not.toContain('identity.velora.invalid');
    expect(outbox[0]?.event_name).toBe(
      'identity.assurance.evidence.recorded.v1',
    );
    const payload = JSON.parse(outbox[0]?.payload ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual([
      'effectiveAt',
      'evidenceClass',
      'evidenceId',
      'expiresAt',
      'normalizedResult',
      'policyVersion',
      'subjectId',
      'thresholdContext',
    ]);
  });

  it('retrieves provider truth before opening the evidence transaction', async () => {
    const setup = await start('transaction-boundary');
    provider.setResult({
      evidence: [grantedFact({ providerFactReference: 'fact-transaction' })],
      providerReference: setup.providerReference,
      state: 'succeeded',
    });
    await receive({
      eventId: 'identity-event-transaction',
      providerReference: setup.providerReference,
    });

    let transactionOpen = false;
    let retrievalObserved = false;
    class ObservedRepository extends IdentityRepository {
      override transaction<T>(
        work: (executor: TransactionHandle) => Promise<T>,
      ): Promise<T> {
        return super.transaction(async (executor) => {
          transactionOpen = true;
          try {
            return await work(executor);
          } finally {
            transactionOpen = false;
          }
        });
      }
    }
    const observedProvider: IdentityVerificationProviderPort = {
      account: provider.account,
      cancel: (reference) => provider.cancel(reference),
      capabilities: provider.capabilities,
      createHostedSession: (request) => provider.createHostedSession(request),
      environment: provider.environment,
      provider: provider.provider,
      retrieveByIdempotencyKey: (key) => provider.retrieveByIdempotencyKey(key),
      retrieveCurrentState: (reference) => {
        retrievalObserved = true;
        expect(transactionOpen).toBe(false);
        return provider.retrieveCurrentState(reference);
      },
      verifyCallback: (input) => provider.verifyCallback(input),
    };
    const observed = new IdentityProviderEventService({
      events: product.identity.events,
      logger,
      now,
      outbox: product.identity.outbox,
      owner: 'identity-transaction-observer',
      provider: observedProvider,
      repository: new ObservedRepository(database.drizzle),
    });
    const report = await observed.processOnce();
    expect(retrievalObserved).toBe(true);
    expect(report.processed).toBe(1);
  });

  it('appends revocation and refuses a later success callback to resurrect assurance', async () => {
    const setup = await start('revocation');
    provider.setResult({
      evidence: [grantedFact({ providerFactReference: 'fact-granted' })],
      providerReference: setup.providerReference,
      state: 'succeeded',
    });
    await receive({
      eventId: 'identity-event-granted',
      providerReference: setup.providerReference,
    });
    await product.identity.providerEvents.processOnce();

    clock = new Date(clock.getTime() + 60_000);
    provider.setResult({
      evidence: [
        {
          effectiveAt: now(),
          evidenceClass: 'adult_threshold',
          normalizedResult: 'revoked',
          providerFactReference: 'fact-revoked',
          thresholdContext: 'adult-18-plus',
        },
      ],
      providerReference: setup.providerReference,
      state: 'revoked',
    });
    await receive({
      eventId: 'identity-event-revoked',
      providerReference: setup.providerReference,
    });
    await product.identity.providerEvents.processOnce();

    clock = new Date(clock.getTime() + 60_000);
    provider.setResult({
      evidence: [
        grantedFact({
          effectiveAt: now(),
          providerFactReference: 'fact-late-success',
        }),
      ],
      providerReference: setup.providerReference,
      state: 'succeeded',
    });
    await receive({
      eventId: 'identity-event-late-success',
      providerReference: setup.providerReference,
    });
    await product.identity.providerEvents.processOnce();

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

  it('recovers an expired lease and permits only one worker to apply a receipt', async () => {
    const setup = await start('lease');
    provider.setResult({
      evidence: [grantedFact({ providerFactReference: 'fact-lease' })],
      providerReference: setup.providerReference,
      state: 'succeeded',
    });
    await receive({
      eventId: 'identity-event-lease',
      providerReference: setup.providerReference,
    });

    const first = await product.identity.events.claim({
      leaseMilliseconds: 60_000,
      limit: 1,
      now: now(),
      owner: 'crashed-worker',
    });
    expect(first).toHaveLength(1);
    const blocked = await product.identity.events.claim({
      leaseMilliseconds: 60_000,
      limit: 1,
      now: new Date(now().getTime() + 30_000),
      owner: 'replacement-worker',
    });
    expect(blocked).toHaveLength(0);
    const recovered = await product.identity.events.claim({
      leaseMilliseconds: 60_000,
      limit: 1,
      now: new Date(now().getTime() + 60_001),
      owner: 'replacement-worker',
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.attempts).toBe(2);

    clock = new Date(clock.getTime() + 120_002);
    const reports = await Promise.all([
      product.identity.providerEvents.processOnce(),
      product.identity.providerEvents.processOnce(),
    ]);
    expect(reports.reduce((total, report) => total + report.processed, 0)).toBe(
      1,
    );
    expect(await count('identity_evidence')).toBe(1);
  });

  it('bounds provider retrieval retries and dead-letters without logging identity data', async () => {
    const setup = await start('dead-letter');
    await receive({
      eventId: 'identity-event-dead-letter',
      providerReference: setup.providerReference,
    });
    provider.behaveAs('retrieval-outage');

    let finalReport;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      finalReport = await product.identity.providerEvents.processOnce();
      clock = new Date(clock.getTime() + 360_000);
    }
    expect(finalReport?.deadLettered).toBe(1);
    const rows = await rowsOf<{
      attempts: number;
      failure_reason: string;
      state: string;
    }>(
      database.sql`select attempts, failure_reason, state from identity_provider_events`,
    );
    expect(rows).toEqual([
      {
        attempts: 5,
        failure_reason: 'processing_failed',
        state: 'dead_letter',
      },
    ]);
    const logs = JSON.stringify(loggerRecords);
    expect(logs).not.toContain(setup.providerReference);
    expect(logs).not.toContain(setup.attempt.subjectId);
  });
});
