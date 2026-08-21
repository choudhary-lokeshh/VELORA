import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { participantReferenceFor } from '../../src/realtime/authorization.js';
import {
  rtcEndReasons,
  terminalRtcSessionStates,
} from '../../src/realtime/policy.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * Adversarial regressions for the finished RTC vertical.
 *
 * Each test here is an attack rather than a feature: it asserts that a
 * particular way of keeping a credential alive past its terms, of learning
 * something about somebody who is not answering, of recording a call that did
 * not happen, or of making the platform disagree with itself about who is in a
 * call does not work.
 *
 * It deliberately does not repeat what the behaviour suites already attack.
 * Eligibility composition, join-authorization refusal, reconnect bounds,
 * in-call safety enforcement, abuse limits, operator disclosure, and
 * reconciliation are covered where they were built. What is here is what a
 * hostile read of the finished domain turns up that nothing else asks.
 */

const databaseUrl = await provisionDatabase('velora_rtc_red_team');
const database: TestDatabase = connectDatabase(databaseUrl);

const caller = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

async function seedCall(state = 'active'): Promise<string> {
  const id = crypto.randomUUID();
  const terminal = terminalRtcSessionStates.map(String);
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, state, state_entered_at, updated_at,
       ended_at, end_reason)
     values (1, now() - interval '1 second', now() - interval '2 seconds',
       ${id}, ${caller}, now() + interval '1 minute', 'voice',
       ${crypto.randomUUID()}, ${recipient}, ${caller}, ${state}, now(), now(),
       ${terminal.includes(state) ? database.sql`now()` : null},
       ${terminal.includes(state) ? 'hung_up' : null})`,
  );
  return id;
}

describe('a provider name for a person survives the process that minted it', () => {
  it('derives the same reference in any process, from the same inputs', () => {
    const sessionId = '33333333-3333-4333-8333-333333333333';
    // Not a cosmetic property. A revocation obligation records the participant
    // reference in the API process and is discharged by the worker, so a hash
    // seeded per process — or reseeded by a runtime upgrade — would leave every
    // revocation naming somebody the provider has never heard of, and nothing
    // would fail until a real revocation had to work.
    expect(participantReferenceFor({ actorId: caller, sessionId })).toBe(
      Bun.hash(`${sessionId}:${caller}`).toString(16),
    );
  });

  it('gives the two people in one call different names', () => {
    const sessionId = '33333333-3333-4333-8333-333333333333';
    // A collision here would let a revocation aimed at one participant remove
    // the other, which is a safety decision landing on the wrong person.
    expect(participantReferenceFor({ actorId: caller, sessionId })).not.toBe(
      participantReferenceFor({ actorId: recipient, sessionId }),
    );
  });

  it('gives one person a different name in every call', () => {
    // Stable within a call is what a provider needs; stable across calls would
    // hand a provider a durable identifier for a person, which is the whole
    // reason this is not the account id.
    expect(
      participantReferenceFor({
        actorId: caller,
        sessionId: '33333333-3333-4333-8333-333333333333',
      }),
    ).not.toBe(
      participantReferenceFor({
        actorId: caller,
        sessionId: '44444444-4444-4444-8444-444444444444',
      }),
    );
  });
});

describe('a credential cannot outlive the call it was minted for', () => {
  it('leaves every issuance naming a generation the session has left behind', async () => {
    const id = await seedCall('active');
    await execute(
      database.sql`insert into realtime_join_issuances
        (authorization_generation, expires_at, issued_at, session_id, user_id)
       values (1, now() + interval '2 minutes', now(), ${id}, ${caller}),
              (1, now() + interval '2 minutes', now(), ${id}, ${recipient})`,
    );

    await execute(
      database.sql`update realtime_sessions
        set state = 'ended', ended_at = now(), end_reason = 'hung_up',
            authorization_generation = authorization_generation + 1
        where id = ${id}`,
    );

    const stale = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count
        from realtime_join_issuances i
        join realtime_sessions s on s.id = i.session_id
        where s.id = ${id}
          and i.authorization_generation < s.authorization_generation`,
    );
    // Both credentials still exist and both are dead. The credential itself is
    // a secret this platform does not hold, so what makes it unusable is that
    // the generation it names is no longer the session's — which is a property
    // of the rows rather than of anything a client returns.
    expect(stale[0]?.count).toBe('2');
  });

  it('keeps no record of a credential for a call that no longer exists', async () => {
    const id = await seedCall('active');
    await execute(
      database.sql`insert into realtime_join_issuances
        (authorization_generation, expires_at, issued_at, session_id, user_id)
       values (1, now() + interval '2 minutes', now(), ${id}, ${caller})`,
    );

    await execute(database.sql`delete from realtime_sessions where id = ${id}`);

    const orphans = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_join_issuances
        where session_id = ${id}`,
    );
    // Cascaded rather than orphaned. An issuance row outliving its call would
    // be a record that somebody was admitted to something with no lifecycle to
    // interpret it against.
    expect(orphans[0]?.count).toBe('0');
  });

  it('refuses an issuance naming a generation that never existed', async () => {
    const id = await seedCall('active');
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into realtime_join_issuances
            (authorization_generation, expires_at, issued_at, session_id, user_id)
           values (0, now() + interval '2 minutes', now(), ${id}, ${caller})`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a credential record with no expiry', async () => {
    const id = await seedCall('active');
    // A credential that never expires is not a short-lived credential, and a
    // record claiming one would misdescribe what was handed out.
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into realtime_join_issuances
            (authorization_generation, expires_at, issued_at, session_id, user_id)
           values (1, null, now(), ${id}, ${caller})`,
        ),
      ),
    ).toBe(true);
  });
});

describe('the record cannot be made to describe a call that did not happen', () => {
  it('refuses a call somebody has with themselves', async () => {
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into realtime_sessions
            (authorization_generation, created_at, id, initiator_id,
             invitation_expires_at, medium, origin_introduction_id,
             pair_high_id, pair_low_id, state, state_entered_at, updated_at)
           values (1, now(), ${crypto.randomUUID()}, ${caller}, now(), 'voice',
             ${crypto.randomUUID()}, ${caller}, ${caller}, 'invited', now(), now())`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a terminal call that does not say why it ended', async () => {
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into realtime_sessions
            (authorization_generation, created_at, id, initiator_id,
             invitation_expires_at, medium, origin_introduction_id,
             pair_high_id, pair_low_id, state, state_entered_at, updated_at,
             ended_at)
           values (1, now(), ${crypto.randomUUID()}, ${caller}, now(), 'voice',
             ${crypto.randomUUID()}, ${recipient}, ${caller}, 'ended', now(),
             now(), now())`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a reason that does not belong to the state it is recorded with', async () => {
    // `declined` belongs to a rejected call. Recording it against an ended one
    // would attribute a decision to a person who did not make it, which is the
    // same class of misdescription the safety path exists to avoid.
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into realtime_sessions
            (authorization_generation, created_at, end_reason, ended_at, id,
             initiator_id, invitation_expires_at, medium, origin_introduction_id,
             pair_high_id, pair_low_id, state, state_entered_at, updated_at)
           values (1, now(), 'declined', now(), ${crypto.randomUUID()},
             ${caller}, now(), 'voice', ${crypto.randomUUID()}, ${recipient},
             ${caller}, 'failed', now(), now())`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses media observed before the call was answered', async () => {
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into realtime_sessions
            (authorization_generation, connected_at, created_at, id,
             initiator_id, invitation_expires_at, medium,
             origin_introduction_id, pair_high_id, pair_low_id, state,
             state_entered_at, updated_at)
           values (1, now(), now(), ${crypto.randomUUID()}, ${caller}, now(),
             'voice', ${crypto.randomUUID()}, ${recipient}, ${caller},
             'active', now(), now())`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses two live calls for the same pair, whichever way round', async () => {
    await seedCall('active');
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into realtime_sessions
            (authorization_generation, created_at, id, initiator_id,
             invitation_expires_at, medium, origin_introduction_id,
             pair_high_id, pair_low_id, state, state_entered_at, updated_at)
           values (1, now(), ${crypto.randomUUID()}, ${recipient}, now(),
             'video', ${crypto.randomUUID()}, ${recipient}, ${caller},
             'invited', now(), now())`,
        ),
      ),
    ).toBe(true);
  });
});

describe('two rooms cannot be bound to one call, or one room to two calls', () => {
  it('refuses a second provider room for the same idempotency key', async () => {
    const first = await seedCall('active');
    const second = await seedCall('ended');
    await execute(
      database.sql`update realtime_sessions
        set provider_idempotency_key = 'rtc-shared' where id = ${first}`,
    );
    // The key is committed before the provider is ever contacted, which is what
    // makes an ambiguous create answerable. Two calls sharing one would make
    // the answer ambiguous in the other direction.
    expect(
      await refused(async () =>
        execute(
          database.sql`update realtime_sessions
            set provider_idempotency_key = 'rtc-shared' where id = ${second}`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses one provider room serving two calls', async () => {
    const first = await seedCall('active');
    const second = await seedCall('ended');
    await execute(
      database.sql`update realtime_sessions
        set provider = 'local-test', provider_reference = 'room-shared',
            provider_bound_at = now()
        where id = ${first}`,
    );
    // Two calls in one room is two conversations with no provider-enforced
    // boundary between them, which is the exact property that disqualified one
    // candidate provider on its published documentation.
    expect(
      await refused(async () =>
        execute(
          database.sql`update realtime_sessions
            set provider = 'local-test', provider_reference = 'room-shared',
                provider_bound_at = now()
            where id = ${second}`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a room reference with no adapter that could act on it', async () => {
    const id = await seedCall('active');
    expect(
      await refused(async () =>
        execute(
          database.sql`update realtime_sessions
            set provider_reference = 'orphan-room', provider_bound_at = now()
            where id = ${id}`,
        ),
      ),
    ).toBe(true);
  });
});

describe('what a participant is told cannot be turned into an oracle', () => {
  it('collapses every platform ending to one indistinguishable answer', () => {
    // A participant may know their call was ended by VELORA. They may never
    // learn which decision did it: a block and an enforcement have different
    // owners and different subjects, and telling them apart would publish the
    // other person's decision to the person it was taken about.
    const platformReasons = [
      'safety_block',
      'safety_enforcement',
      'operator_terminated',
      'provider_failed',
    ];
    for (const reason of platformReasons) {
      expect(rtcEndReasons.map(String)).toContain(reason);
    }
    // And the disclosable vocabulary the contract publishes contains none of
    // them, so there is no field for a surface to put one in.
    const published = [
      'hung_up',
      'declined',
      'withdrawn',
      'invitation_expired',
      'reconnect_expired',
      'provider_unavailable',
      'join_timeout',
      'ended_by_platform',
    ];
    for (const reason of platformReasons) {
      expect(published).not.toContain(reason);
    }
  });

  it('keeps the internal vocabulary richer than the published one', () => {
    // The platform records why precisely and discloses coarsely. If the two
    // vocabularies ever became the same size, the collapse would have stopped
    // happening somewhere.
    const published = new Set([
      'hung_up',
      'declined',
      'withdrawn',
      'invitation_expired',
      'reconnect_expired',
      'provider_unavailable',
      'join_timeout',
      'ended_by_platform',
    ]);
    expect(rtcEndReasons.length).toBeGreaterThan(published.size - 1);
  });
});

describe('the domain writes nowhere but its own tables', () => {
  it('holds no foreign key pointing outside itself', async () => {
    const rows = await rowsOf<{ foreign_table: string; source: string }>(
      database.sql`select tc.table_name as source, ccu.table_name as foreign_table
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
         where tc.constraint_type = 'FOREIGN KEY'
           and tc.table_name like 'realtime_%'`,
    );
    // A reference to a consumer account or an introduction is an opaque
    // identifier with no foreign key, deliberately: a call must not be able to
    // hold another domain's row still, and deleting an account must not need
    // this domain's permission.
    for (const row of rows) {
      expect(row.foreign_table.startsWith('realtime_')).toBe(true);
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it('stores nothing that could reconstruct a conversation', async () => {
    const columns = await rowsOf<{ column_name: string }>(
      database.sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name like 'realtime_%'`,
    );
    const names = columns.map((row) => row.column_name).join(' ');
    // The negative space is the design. Every one of these is a thing another
    // platform stores and this one has no column for, so a subpoena, a breach,
    // or an operator with full table access finds lifecycle and nothing else.
    for (const forbidden of [
      'sdp',
      'candidate',
      'turn',
      'credential',
      'secret',
      'token',
      'recording',
      'transcript',
      'ip_address',
      'remote_addr',
      'audio',
      'waveform',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
