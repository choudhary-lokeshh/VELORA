import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { AuthRepository } from '../../src/auth/repository.js';
import { createOperationsRuntime } from '../../src/operations/composition.js';
import type { OperationsRuntime } from '../../src/operations/composition.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger } from '../support/harness.js';

/**
 * The two things a deployment needs that a developer's machine never does, and
 * both are about happening exactly once.
 *
 * **The first operator grant.** A deployment where nobody holds a grant has
 * nobody who can issue one, so there is one door out of that and it has to be
 * safe to leave standing: two concurrent attempts must produce one operator,
 * and a replay after a restart must fail the same way a replay a second later
 * does. The exactly-once property is the database's — `singleton` is uniquely
 * indexed — and this suite proves it by racing rather than by reading the
 * schema.
 *
 * **Single-use ceremony state.** A federated sign-in's state and a privileged
 * authenticator's challenge are anti-replay controls and nothing else. Both are
 * claimed by a conditional update, so proving them means asking twice and
 * expecting the second to lose.
 */

const databaseUrl = await provisionDatabase('velora_deployment_enablement');
const database: TestDatabase = connectDatabase(databaseUrl);
const logger = silentLogger();

let clock = new Date();
const now = () => clock;

const secret = 'bootstrap-secret-for-this-suite';
const secretDigest = createHash('sha256').update(secret, 'utf8').digest('hex');

function operations(tokenDigest: string | undefined): OperationsRuntime {
  return createOperationsRuntime({
    // Deployed semantics: an operator holds exactly what somebody granted them,
    // and nobody has granted anything yet.
    bootstrapOperators: false,
    ...(tokenDigest === undefined ? {} : { bootstrapTokenDigest: tokenDigest }),
    database: database.drizzle,
    logger,
    now,
  });
}

const repository = new AuthRepository(database.drizzle);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  clock = new Date();
  await database.truncate();
});

async function liveGrants(): Promise<
  readonly { role: string; grantedBy: string | null }[]
> {
  return rowsOf<{ role: string; grantedBy: string | null }>(
    database.sql`
      select role, granted_by as "grantedBy"
      from operations_operator_grants
      where revoked_at is null
    `,
  );
}

async function bootstrapRows(): Promise<number> {
  const rows = await rowsOf<{ total: number }>(
    database.sql`select count(*)::int as total from operations_operator_bootstraps`,
  );
  return rows[0]?.total ?? 0;
}

async function auditRows(): Promise<readonly { outcome: string }[]> {
  return rowsOf<{ outcome: string }>(
    database.sql`
      select outcome from operations_operator_actions
      where action = 'operator.role.granted'
      order by occurred_at
    `,
  );
}

describe('the first operator grant', () => {
  it('refuses when this deployment has no bootstrap secret configured', async () => {
    const outcome = await operations(undefined).service.bootstrapFirstOperator({
      presentedTokenDigest: secretDigest,
      reason: 'first operator for the rehearsal',
      subjectReference: crypto.randomUUID(),
    });
    expect(outcome.kind).toBe('unchanged');
    expect(await liveGrants()).toHaveLength(0);
    expect(await bootstrapRows()).toBe(0);
    // The attempt is still recorded. An operator who tried and was refused is a
    // thing an incident review needs to see.
    expect(await auditRows()).toEqual([{ outcome: 'refused' }]);
  });

  it('refuses a secret that does not match, without saying so', async () => {
    const outcome = await operations(
      secretDigest,
    ).service.bootstrapFirstOperator({
      presentedTokenDigest: createHash('sha256')
        .update('not-the-secret', 'utf8')
        .digest('hex'),
      reason: 'first operator for the rehearsal',
      subjectReference: crypto.randomUUID(),
    });
    expect(outcome.kind).toBe('unchanged');
    expect(await bootstrapRows()).toBe(0);
  });

  it('creates one super administrator, granted by nobody', async () => {
    const subject = crypto.randomUUID();
    const outcome = await operations(
      secretDigest,
    ).service.bootstrapFirstOperator({
      presentedTokenDigest: secretDigest,
      reason: 'first operator for the rehearsal',
      subjectReference: subject,
    });
    expect(outcome.kind).toBe('granted');
    // Granted by nobody, deliberately: naming the subject would record them
    // granting themselves an authority they did not yet hold.
    expect(await liveGrants()).toEqual([
      { grantedBy: null, role: 'super_admin' },
    ]);
    expect(await bootstrapRows()).toBe(1);
    expect(await auditRows()).toEqual([{ outcome: 'applied' }]);
  });

  it('produces exactly one operator when two attempts race', async () => {
    const service = operations(secretDigest).service;
    const outcomes = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map((subject) =>
        service.bootstrapFirstOperator({
          presentedTokenDigest: secretDigest,
          reason: 'simultaneous first operator attempt',
          subjectReference: subject,
        }),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.kind === 'granted'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.kind === 'unchanged'),
    ).toHaveLength(1);
    expect(await liveGrants()).toHaveLength(1);
    expect(await bootstrapRows()).toBe(1);
  });

  it('refuses a replay from a process that restarted since', async () => {
    const first = operations(secretDigest).service;
    expect(
      (
        await first.bootstrapFirstOperator({
          presentedTokenDigest: secretDigest,
          reason: 'first operator for the rehearsal',
          subjectReference: crypto.randomUUID(),
        })
      ).kind,
    ).toBe('granted');

    // A different service instance holding the same configuration, which is
    // what a restart is. The refusal comes from the row, not from memory.
    const afterRestart = operations(secretDigest).service;
    expect(
      (
        await afterRestart.bootstrapFirstOperator({
          presentedTokenDigest: secretDigest,
          reason: 'replaying the same secret after a restart',
          subjectReference: crypto.randomUUID(),
        })
      ).kind,
    ).toBe('unchanged');
    expect(await liveGrants()).toHaveLength(1);
    expect(await bootstrapRows()).toBe(1);
  });

  it('refuses once anybody holds a grant, whatever the secret says', async () => {
    await execute(database.sql`
      insert into operations_operator_grants (id, granted_at, reason, role, subject_reference)
      values (${crypto.randomUUID()}, ${now()}, 'granted by an existing operator', 'support', ${crypto.randomUUID()})
    `);
    const outcome = await operations(
      secretDigest,
    ).service.bootstrapFirstOperator({
      presentedTokenDigest: secretDigest,
      reason: 'first operator for the rehearsal',
      subjectReference: crypto.randomUUID(),
    });
    expect(outcome.kind).toBe('unchanged');
    expect(await bootstrapRows()).toBe(0);
  });

  it('reports whether the door has been used', async () => {
    const runtime = operations(secretDigest);
    expect(await runtime.service.bootstrapConsumed()).toBe(false);
    await runtime.service.bootstrapFirstOperator({
      presentedTokenDigest: secretDigest,
      reason: 'first operator for the rehearsal',
      subjectReference: crypto.randomUUID(),
    });
    expect(await runtime.service.bootstrapConsumed()).toBe(true);
  });
});

describe('single-use ceremony state', () => {
  async function account(): Promise<string> {
    const accountId = crypto.randomUUID();
    await execute(
      database.sql`insert into auth_accounts (id, status) values (${accountId}, 'active')`,
    );
    return accountId;
  }

  it('claims a federated sign-in attempt exactly once', async () => {
    const stateDigest = createHash('sha256')
      .update('state-value', 'utf8')
      .digest('hex');
    await repository.createFederatedAuthorization({
      audience: 'platform_admin',
      codeVerifier: 'verifier',
      createdAt: now(),
      expiresAt: new Date(now().getTime() + 600_000),
      nonce: 'nonce',
      returnTo: 'https://admin.velora.test/',
      stateDigest,
    });

    const first = await repository.consumeFederatedAuthorization({
      now: now(),
      stateDigest,
    });
    expect(first?.audience).toBe('platform_admin');
    expect(first?.returnTo).toBe('https://admin.velora.test/');

    // A replayed callback, a double submit, a retry. All the same request, and
    // the second one has nothing left to claim.
    expect(
      await repository.consumeFederatedAuthorization({
        now: now(),
        stateDigest,
      }),
    ).toBeUndefined();
  });

  it('refuses an attempt whose window has closed', async () => {
    const stateDigest = createHash('sha256')
      .update('expired-state', 'utf8')
      .digest('hex');
    await repository.createFederatedAuthorization({
      audience: 'consumer_web',
      codeVerifier: 'verifier',
      createdAt: new Date(now().getTime() - 1_200_000),
      expiresAt: new Date(now().getTime() - 600_000),
      nonce: 'nonce',
      returnTo: undefined,
      stateDigest,
    });
    expect(
      await repository.consumeFederatedAuthorization({
        now: now(),
        stateDigest,
      }),
    ).toBeUndefined();
  });

  it('claims a privileged challenge exactly once, for one operator and one ceremony', async () => {
    const accountId = await account();
    const other = await account();
    const challengeDigest = createHash('sha256')
      .update('challenge-value', 'utf8')
      .digest('hex');
    await repository.createPrivilegedChallenge({
      accountId,
      challengeDigest,
      createdAt: now(),
      expiresAt: new Date(now().getTime() + 300_000),
      purpose: 'assertion',
    });

    // Somebody else's challenge is not claimable, and neither is the right
    // challenge answered with the wrong ceremony.
    expect(
      await repository.consumePrivilegedChallenge({
        accountId: other,
        challengeDigest,
        now: now(),
        purpose: 'assertion',
      }),
    ).toBe(false);
    expect(
      await repository.consumePrivilegedChallenge({
        accountId,
        challengeDigest,
        now: now(),
        purpose: 'enrolment',
      }),
    ).toBe(false);

    expect(
      await repository.consumePrivilegedChallenge({
        accountId,
        challengeDigest,
        now: now(),
        purpose: 'assertion',
      }),
    ).toBe(true);
    expect(
      await repository.consumePrivilegedChallenge({
        accountId,
        challengeDigest,
        now: now(),
        purpose: 'assertion',
      }),
    ).toBe(false);
  });
});
