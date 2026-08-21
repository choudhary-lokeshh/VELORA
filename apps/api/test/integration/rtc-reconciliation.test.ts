import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import {
  maximumRtcObligationAttempts,
  rtcObligationBackoffMilliseconds,
} from '../../src/realtime/policy.js';
import { RtcReconciler } from '../../src/realtime/reconciliation.js';
import { RtcRepository } from '../../src/realtime/repository.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * Discharging what calling owes a provider, against real PostgreSQL.
 *
 * The rule this whole path is shaped by is that no provider call may run inside
 * a database transaction, so a cycle is a claim, then network calls holding
 * nothing, then a settle. What is worth proving is the parts that are easy to
 * get wrong and invisible when they are: that two workers take disjoint work,
 * that a worker dying mid-discharge does not park an obligation forever, that
 * failure defers rather than deletes, and that giving up leaves evidence rather
 * than a clean table.
 */

const databaseUrl = await provisionDatabase('velora_rtc_reconciliation');
const database: TestDatabase = connectDatabase(databaseUrl);

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);
const logs: unknown[] = [];
const logger = silentLogger(logs);

const config = testServerConfig({
  REALTIME_CALL_ELIGIBILITY: 'composed',
  REALTIME_RTC_PROVIDER: 'local-test',
});

const repository = new RtcRepository(database.drizzle);

const realtime = createRealtimeRuntime({
  config,
  connections: {
    isMutuallyIntroduced: () => Promise.resolve(false),
    mutualConnectionFor: () => Promise.resolve(undefined),
  },
  database: database.drizzle,
  eligibility: { mayCall: () => Promise.resolve(false) },
  logger,
  now,
  onboarding: {
    evaluate: () =>
      Promise.resolve({
        adultAssurance: 'none',
        adultAssuranceRefused: false,
        outstandingPolicies: [],
        outstandingProfile: [],
        step: 'adult_declaration',
      } as const),
  },
  workerName: 'test-worker',
});

const caller = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  logs.length = 0;
  await database.truncate();
});

/** A call bound to a provider room, with a teardown owed against it. */
async function owedTeardown(
  input: { readonly reference?: string } = {},
): Promise<{
  readonly obligationId: number;
  readonly sessionId: string;
}> {
  const sessionId = crypto.randomUUID();
  const reference = input.reference ?? crypto.randomUUID();
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, provider, provider_bound_at,
       provider_reference, state, state_entered_at, updated_at, ended_at, end_reason)
     values (1, now() - interval '1 second', now() - interval '2 seconds',
       ${sessionId}, ${caller}, now() + interval '1 minute', 'voice',
       ${crypto.randomUUID()}, ${recipient}, ${caller}, 'local-test', now(),
       ${reference}, 'ended', now(), now(), now(), 'hung_up')`,
  );
  const inserted = await rowsOf<{ id: number }>(
    database.sql`insert into realtime_provider_obligations
      (attempts, available_at, created_at, kind, provider, provider_reference,
       session_id, state, updated_at)
     values (0, now(), now(), 'terminate_session', 'local-test', ${reference},
       ${sessionId}, 'pending', now())
     returning id`,
  );
  const obligationId = inserted[0]?.id;
  if (obligationId === undefined) throw new Error('no obligation');
  return { obligationId, sessionId };
}

async function obligationRow(id: number) {
  const rows = await rowsOf<{
    attempts: number;
    available_at: Date;
    failure_reason: string | null;
    lease_owner: string | null;
    state: string;
  }>(
    database.sql`select attempts, available_at, failure_reason, lease_owner, state
      from realtime_provider_obligations where id = ${id}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no obligation');
  return row;
}

/**
 * A reconciler whose provider behaves however the test needs.
 *
 * A stub of the three members the reconciler actually touches, rather than a
 * real adapter with one method swapped: spreading a class instance loses its
 * prototype, and a stub that names exactly what is used documents the surface
 * this path depends on.
 */
function reconcilerWith(provider: {
  endSession?: (reference: string) => Promise<void>;
  revokeParticipant?: (input: {
    readonly participantReference: string;
    readonly providerReference: string;
  }) => Promise<void>;
}): RtcReconciler {
  return new RtcReconciler({
    logger,
    now,
    owner: 'test-worker',
    provider: {
      endSession: provider.endSession ?? (() => Promise.resolve()),
      provider: 'local-test',
      revokeParticipant:
        provider.revokeParticipant ?? (() => Promise.resolve()),
    } as never,
    repository,
  });
}

describe('what the platform owes is recorded when it is incurred', () => {
  it('owes a teardown from the moment a room is bound', async () => {
    const sessionId = crypto.randomUUID();
    await execute(
      database.sql`insert into realtime_sessions
        (authorization_generation, accepted_at, created_at, id, initiator_id,
         invitation_expires_at, medium, origin_introduction_id,
         pair_high_id, pair_low_id, state, state_entered_at, updated_at)
       values (1, now() - interval '1 second', now() - interval '2 seconds',
         ${sessionId}, ${caller}, now() + interval '1 minute', 'voice',
         ${crypto.randomUUID()}, ${recipient}, ${caller}, 'accepted', now(), now())`,
    );
    await execute(
      database.sql`insert into realtime_participants
        (invited_at, accepted_at, role, session_id, user_id)
       values (now(), now(), 'caller', ${sessionId}, ${caller}),
              (now(), now(), 'recipient', ${sessionId}, ${recipient})`,
    );

    await realtime.service.establishProviderSession(sessionId);

    const owed = await rowsOf<{ count: string; kind: string }>(
      database.sql`select count(*)::text as count, kind
        from realtime_provider_obligations
        where session_id = ${sessionId} group by kind`,
    );
    // Recorded by the transaction that bound the room, not when the call ends.
    // A crash between ending and recording would otherwise leak the room, and
    // nothing would know it had.
    expect(owed[0]?.count).toBe('1');
    expect(owed[0]?.kind).toBe('terminate_session');
  });
});

describe('a cycle claims, calls, and settles', () => {
  it('discharges a teardown and keeps the row', async () => {
    const { obligationId } = await owedTeardown();
    const torn: string[] = [];

    const report = await reconcilerWith({
      endSession: (reference) => {
        torn.push(reference);
        return Promise.resolve();
      },
    }).dischargeOnce();

    expect(report).toEqual({
      abandoned: 0,
      deferred: 0,
      discharged: 1,
      examined: 1,
    });
    expect(torn).toHaveLength(1);
    const row = await obligationRow(obligationId);
    // Discharged is a state, not a deletion: what the platform owed and did is
    // the record an operator reads later.
    expect(row.state).toBe('discharged');
    expect(row.lease_owner).toBeNull();
  });

  it('does not claim the same work twice', async () => {
    await owedTeardown();
    const reconciler = reconcilerWith({ endSession: () => Promise.resolve() });

    const first = await reconciler.dischargeOnce();
    const second = await reconciler.dischargeOnce();
    // A discharged obligation is finished. Draining again is a cycle that finds
    // nothing, which is what an idle worker should do all day.
    expect(first.discharged).toBe(1);
    expect(second.examined).toBe(0);
  });

  it('gives two workers draining at once disjoint work', async () => {
    for (let index = 0; index < 6; index += 1) await owedTeardown();
    const torn: string[] = [];
    const provider = {
      endSession: (reference: string) => {
        torn.push(reference);
        return Promise.resolve();
      },
    };

    const [first, second] = await Promise.all([
      reconcilerWith(provider).dischargeOnce(),
      reconcilerWith(provider).dischargeOnce(),
    ]);

    // Six rooms, six teardowns. Two workers both tearing down the same room
    // would be a duplicate request to a vendor and a lease that meant nothing.
    expect(first.discharged + second.discharged).toBe(6);
    expect(new Set(torn).size).toBe(6);
  });

  it('does nothing at all when no provider is approved', async () => {
    await owedTeardown();
    const report = await new RtcReconciler({
      logger,
      now,
      owner: 'test-worker',
      provider: { provider: 'unavailable' } as never,
      repository,
    }).dischargeOnce();

    // Nothing is owed to a provider that does not exist, and claiming here
    // would take a lease nobody could discharge and hold it until it expired.
    expect(report.examined).toBe(0);
  });
});

describe('failing to discharge is deferral, never deletion', () => {
  it('backs off and records why', async () => {
    const { obligationId } = await owedTeardown();

    const report = await reconcilerWith({
      endSession: () => Promise.reject(new Error('provider is unreachable')),
    }).dischargeOnce();

    expect(report.deferred).toBe(1);
    const row = await obligationRow(obligationId);
    expect(row.state).toBe('pending');
    expect(row.attempts).toBe(1);
    // The reason is written to a column an operator reads, so it is this
    // domain's own words rather than whatever a vendor's client threw.
    expect(row.failure_reason).toBe('provider is unreachable');
    // And it is not due again immediately: a provider that is down is not
    // helped by being asked faster.
    expect(row.available_at.getTime()).toBeGreaterThan(now().getTime());
  });

  it('leaves a deferred obligation alone until its backoff has passed', async () => {
    await owedTeardown();
    const reconciler = reconcilerWith({
      endSession: () => Promise.reject(new Error('provider is unreachable')),
    });
    await reconciler.dischargeOnce();

    // Immediately after, there is nothing due.
    expect((await reconciler.dischargeOnce()).examined).toBe(0);

    clockOffsetMilliseconds = rtcObligationBackoffMilliseconds(1) + 1_000;
    expect((await reconciler.dischargeOnce()).examined).toBe(1);
  });

  it('abandons loudly rather than quietly, and keeps the evidence', async () => {
    const { obligationId } = await owedTeardown();
    const reconciler = reconcilerWith({
      endSession: () => Promise.reject(new Error('provider is unreachable')),
    });

    for (
      let attempt = 1;
      attempt <= maximumRtcObligationAttempts;
      attempt += 1
    ) {
      clockOffsetMilliseconds +=
        rtcObligationBackoffMilliseconds(attempt) + 1_000;
      await reconciler.dischargeOnce();
    }

    const row = await obligationRow(obligationId);
    // The row stays. A provider still holding a room the platform ended is
    // exactly the divergence an operator has to see, and a row deleted after
    // eight tries would be a leak with no evidence of itself.
    expect(row.state).toBe('abandoned');
    expect(row.attempts).toBe(maximumRtcObligationAttempts);
    expect(JSON.stringify(logs)).toContain('rtc provider obligation abandoned');
  });

  it('names no call and nobody in it when it gives up', async () => {
    const { sessionId } = await owedTeardown();
    const reconciler = reconcilerWith({
      endSession: () => Promise.reject(new Error('provider is unreachable')),
    });
    for (
      let attempt = 1;
      attempt <= maximumRtcObligationAttempts;
      attempt += 1
    ) {
      clockOffsetMilliseconds +=
        rtcObligationBackoffMilliseconds(attempt) + 1_000;
      await reconciler.dischargeOnce();
    }

    const written = JSON.stringify(logs);
    // The kind and the provider are what an operator acts on. The row carries
    // the rest for whoever opens it; a log line carrying a call would put two
    // people's conversation somewhere this domain writes nothing else.
    for (const forbidden of [sessionId, caller, recipient]) {
      expect(written).not.toContain(forbidden);
    }
  });

  it('cannot be asked to discharge a revocation that names nobody', async () => {
    const { sessionId } = await owedTeardown();

    // The database refuses it. An obligation that cannot name who it is about
    // could never be discharged, so the guarantee belongs in the schema rather
    // than in a retry loop that would arrive at the same place eight attempts
    // later.
    expect(
      await refused(async () =>
        execute(
          database.sql`update realtime_provider_obligations
            set kind = 'revoke_participant', participant_reference = null
            where session_id = ${sessionId}`,
        ),
      ),
    ).toBe(true);
  });
});

describe('a worker dying does not park the work', () => {
  it('lets another worker take an obligation whose lease expired', async () => {
    const { obligationId } = await owedTeardown();
    await execute(
      database.sql`update realtime_provider_obligations
        set lease_owner = 'dead-worker',
            lease_expires_at = now() - interval '1 minute'
        where id = ${obligationId}`,
    );

    const report = await reconcilerWith({
      endSession: () => Promise.resolve(),
    }).dischargeOnce();

    // The row stayed `pending` through the death, so recovery is a lease
    // expiring rather than anybody noticing.
    expect(report.discharged).toBe(1);
  });

  it('leaves an obligation another worker is actively holding', async () => {
    const { obligationId } = await owedTeardown();
    await execute(
      database.sql`update realtime_provider_obligations
        set lease_owner = 'other-worker',
            lease_expires_at = now() + interval '1 minute'
        where id = ${obligationId}`,
    );

    const report = await reconcilerWith({
      endSession: () => Promise.resolve(),
    }).dischargeOnce();
    expect(report.examined).toBe(0);
  });
});

describe('the reconciler decides nothing about a call', () => {
  it('leaves the call exactly as it found it', async () => {
    const { sessionId } = await owedTeardown();
    const before = await rowsOf<{ generation: number; state: string }>(
      database.sql`select state, authorization_generation as generation
        from realtime_sessions where id = ${sessionId}`,
    );

    await reconcilerWith({
      endSession: () => Promise.resolve(),
    }).dischargeOnce();

    const after = await rowsOf<{ generation: number; state: string }>(
      database.sql`select state, authorization_generation as generation
        from realtime_sessions where id = ${sessionId}`,
    );
    // It carries out decisions already recorded. A reconciler that could end a
    // call, revoke authorization, or move a state would be a second authority
    // over calling that no request path guards.
    expect(after).toEqual(before);
  });

  it('publishes only a drain', () => {
    expect(
      Object.getOwnPropertyNames(RtcReconciler.prototype).toSorted(),
    ).toEqual(['attempt', 'constructor', 'dischargeOnce']);
  });
});
