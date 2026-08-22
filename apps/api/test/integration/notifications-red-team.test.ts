import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * Adversarial regressions for the notification delivery platform.
 *
 * Each test is an attack rather than a feature, and each one is aimed at the
 * database rather than at a route. That is the point: application code can be
 * bypassed by the next code path somebody writes, and every invariant below is
 * one where being wrong means a person receives somebody else's notice, stops
 * receiving their own, or is told something the platform never established.
 *
 * It deliberately does not repeat what the behaviour suite already attacks.
 * Cross-account preference reads, cross-account device revocation, forged and
 * replayed callbacks, opted-out delivery, and destination resolution are
 * covered where they were built. What is here is what a hostile read of the
 * finished schema turns up.
 */

const databaseUrl = await provisionDatabase('velora_notifications_red_team');
const database: TestDatabase = connectDatabase(databaseUrl);

const recipient = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const subject = '33333333-3333-4333-8333-333333333333';
const digest = 'a'.repeat(64);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

async function registerDevice(
  owner: string,
  fingerprint: string,
  installation: string,
): Promise<void> {
  await execute(
    database.sql`insert into notifications_push_devices
      (created_at, id, installation_id, last_seen_at, platform, recipient_id,
       token_fingerprint)
     values (now(), ${crypto.randomUUID()}, ${installation}, now(), 'ios',
       ${owner}, ${fingerprint})`,
  );
}

async function owedNotice(
  overrides: {
    readonly state?: string;
    readonly suppressionReason?: string | null;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await execute(
    database.sql`insert into notifications_intents
      (attempts, channel, created_at, expires_at, id, next_attempt_at, payload,
       purpose, recipient_id, source_event_id, source_producer, state,
       subject_id, suppression_reason, template_key, updated_at)
     values (0, 'push', now(), now() + interval '1 day', ${id}, now(),
       '{"conversationId":"00000000-0000-4000-8000-000000000000"}',
       'transactional', ${recipient}, ${crypto.randomUUID()}, 'messaging',
       ${overrides.state ?? 'queued'}, ${subject},
       ${overrides.suppressionReason ?? null},
       'messaging.message.received.v1', now())`,
  );
  return id;
}

describe('a device cannot be addressed for two people at once', () => {
  it('refuses a second live registration holding the same token', async () => {
    await registerDevice(recipient, digest, 'installation-1');

    // The attack: sign in as somebody else on a device that is still
    // registered to its previous owner and keep both registrations live. If
    // this succeeded, one person's notice would arrive on another person's
    // phone.
    expect(
      await refused(async () =>
        registerDevice(other, digest, 'installation-2'),
      ),
    ).toBe(true);
  });

  it('refuses a second live registration for one installation', async () => {
    await registerDevice(recipient, digest, 'installation-1');

    // A device that rotates its token must replace its registration, not
    // accumulate one. Two live rows would double every notice.
    expect(
      await refused(async () =>
        registerDevice(recipient, 'b'.repeat(64), 'installation-1'),
      ),
    ).toBe(true);
  });

  it('allows the token again only once the earlier registration is retired', async () => {
    await registerDevice(recipient, digest, 'installation-1');
    await execute(
      database.sql`update notifications_push_devices
        set disabled_at = now(), disable_reason = 'signed_out'
        where recipient_id = ${recipient}`,
    );

    // The uniqueness is partial on purpose: a retired row keeps its
    // fingerprint as evidence while the same device may register again.
    await registerDevice(other, digest, 'installation-2');
    expect(
      await rowsOf(
        database.sql`select id from notifications_push_devices
          where token_fingerprint = ${digest} and disabled_at is null`,
      ),
    ).toHaveLength(1);
  });

  it('refuses to resurrect a retired registration into a live conflict', async () => {
    await registerDevice(recipient, digest, 'installation-1');
    await execute(
      database.sql`update notifications_push_devices
        set disabled_at = now(), disable_reason = 'provider_invalidated'
        where recipient_id = ${recipient}`,
    );
    await registerDevice(other, digest, 'installation-2');

    // The attack: clear `disabled_at` on a registration a provider retired,
    // while somebody else legitimately holds the token now. A registration is
    // never re-enabled precisely so this has no supported path — and the index
    // refuses it even when the update is written by hand.
    expect(
      await refused(async () =>
        execute(
          database.sql`update notifications_push_devices
            set disabled_at = null, disable_reason = null
            where recipient_id = ${recipient}`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a registration whose fingerprint is not a digest', async () => {
    // A raw token stored in the fingerprint column would be a credential at
    // rest in a column nothing treats as one.
    expect(
      await refused(async () =>
        registerDevice(recipient, 'not-a-sha256-digest', 'installation-1'),
      ),
    ).toBe(true);
  });

  it('refuses a retirement with no reason and a reason with no retirement', async () => {
    await registerDevice(recipient, digest, 'installation-1');

    for (const change of [
      database.sql`update notifications_push_devices set disabled_at = now()
        where recipient_id = ${recipient}`,
      database.sql`update notifications_push_devices
        set disable_reason = 'signed_out' where recipient_id = ${recipient}`,
    ]) {
      expect(await refused(async () => execute(change))).toBe(true);
    }
  });
});

describe('a notice cannot claim something the platform never established', () => {
  it('accepts a well-formed owed notice', async () => {
    // The control for the refusals below: the shape is right, so each refusal
    // is caused by the one field it changes.
    const id = await owedNotice();

    expect(
      await rowsOf(
        database.sql`select id from notifications_intents where id = ${id}`,
      ),
    ).toHaveLength(1);
  });

  it('refuses a delivered notice with no instant of delivery', async () => {
    // "Delivered" with no instant is a claim nobody can check.
    expect(await refused(async () => owedNotice({ state: 'delivered' }))).toBe(
      true,
    );
  });

  it('refuses a suppressed notice with no reason', async () => {
    expect(await refused(async () => owedNotice({ state: 'suppressed' }))).toBe(
      true,
    );
  });

  it('refuses a reason on a notice that was not suppressed', async () => {
    expect(
      await refused(async () =>
        owedNotice({ state: 'queued', suppressionReason: 'safety_block' }),
      ),
    ).toBe(true);
  });

  it('refuses a lease held on a notice that is already finished', async () => {
    const id = await owedNotice();

    // A terminal row holding a lease is indistinguishable from work somebody
    // is still doing, which is how a finished notice gets retried forever.
    expect(
      await refused(async () =>
        execute(
          database.sql`update notifications_intents
            set state = 'dead_letter', lease_owner = 'worker',
                lease_expires_at = now() + interval '1 minute'
            where id = ${id}`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a notice about the person receiving it', async () => {
    // A notice telling somebody about their own action is at best noise and at
    // worst a way to make the feed report a relationship that does not exist.
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into notifications_intents
            (attempts, channel, created_at, expires_at, id, next_attempt_at,
             payload, purpose, recipient_id, source_event_id, source_producer,
             state, subject_id, template_key, updated_at)
           values (0, 'push', now(), now() + interval '1 day',
             ${crypto.randomUUID()}, now(), '{}', 'transactional', ${recipient},
             ${crypto.randomUUID()}, 'messaging', 'queued', ${recipient},
             'messaging.message.received.v1', now())`,
        ),
      ),
    ).toBe(true);
  });
});

describe('an attempt cannot hide why it failed', () => {
  /**
   * The control every refusal below depends on.
   *
   * A refusal test whose statement is malformed passes for the wrong reason,
   * and a suite of those is worse than no suite. This asserts the shape is
   * accepted when it should be, so each refusal that follows is caused by the
   * one field it changes.
   */
  it('accepts a well-formed failed attempt', async () => {
    const intentId = await owedNotice();

    await execute(
      database.sql`insert into notifications_attempts
        (attempt_number, channel, created_at, failure_class, failure_reason,
         intent_id, outcome)
       values (1, 'push', now(), 'transport', 'provider_rejected',
         ${intentId}, 'failed')`,
    );

    expect(
      await rowsOf(
        database.sql`select id from notifications_attempts
          where intent_id = ${intentId}`,
      ),
    ).toHaveLength(1);
  });

  it('refuses a failed attempt with no class', async () => {
    const intentId = await owedNotice();

    // The retry policy reads the class and nothing else. A failure without one
    // is a failure the policy would have to guess about.
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into notifications_attempts
            (attempt_number, channel, created_at, failure_reason, intent_id,
             outcome)
           values (1, 'push', now(), 'provider_rejected', ${intentId},
             'failed')`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a class on an attempt that did not fail', async () => {
    const intentId = await owedNotice();

    // A delivered attempt carrying a failure class invites a reader to branch
    // on it.
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into notifications_attempts
            (attempt_number, channel, created_at, failure_class, intent_id,
             outcome, provider_reference)
           values (1, 'push', now(), 'transport', ${intentId}, 'delivered',
             'receipt-1')`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a delivered attempt with no receipt', async () => {
    const intentId = await owedNotice();

    expect(
      await refused(async () =>
        execute(
          database.sql`insert into notifications_attempts
            (attempt_number, channel, created_at, intent_id, outcome)
           values (1, 'push', now(), ${intentId}, 'delivered')`,
        ),
      ),
    ).toBe(true);
  });
});

describe('a preference cannot silence what is not an offer', () => {
  it('accepts a well-formed optional preference', async () => {
    // The control for the refusals below.
    await execute(
      database.sql`insert into notifications_preferences
        (category, channel, created_at, enabled, recipient_id, updated_at)
       values ('direct_message', 'push', now(), false, ${recipient}, now())`,
    );

    expect(
      await rowsOf(
        database.sql`select category from notifications_preferences
          where recipient_id = ${recipient}`,
      ),
    ).toHaveLength(1);
  });

  it('accepts a mandatory category that is enabled', async () => {
    // The constraint is about the decision, not about the category existing.
    await execute(
      database.sql`insert into notifications_preferences
        (category, channel, created_at, enabled, recipient_id, updated_at)
       values ('account_security', 'push', now(), true, ${recipient}, now())`,
    );

    expect(
      await rowsOf(
        database.sql`select category from notifications_preferences
          where recipient_id = ${recipient}`,
      ),
    ).toHaveLength(1);
  });

  it.each([['account_security'], ['safety_legal']])(
    'refuses a disabled %s preference',
    async (category) => {
      expect(
        await refused(async () =>
          execute(
            database.sql`insert into notifications_preferences
              (category, channel, created_at, enabled, recipient_id, updated_at)
             values (${category}, 'push', now(), false, ${recipient}, now())`,
          ),
        ),
      ).toBe(true);
    },
  );

  it('refuses a preference for a channel nobody publishes', async () => {
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into notifications_preferences
            (category, channel, created_at, enabled, recipient_id, updated_at)
           values ('direct_message', 'carrier_pigeon', now(), false,
             ${recipient}, now())`,
        ),
      ),
    ).toBe(true);
  });
});

describe('a provider cannot say the same thing twice and be believed twice', () => {
  async function recordEvent(eventId: string): Promise<void> {
    await execute(
      database.sql`insert into notifications_provider_events
        (attempts, available_at, feedback_type, id, occurred_at,
         payload_digest, provider, provider_account, provider_environment,
         provider_event_id, received_at, state)
       values (0, now(), 'delivered', ${crypto.randomUUID()}, now(),
         ${digest}, 'local-test', 'account-1', 'local-test', ${eventId},
         now(), 'received')`,
    );
  }

  it('refuses a duplicate of the same provider event', async () => {
    await recordEvent('event-1');

    expect(await refused(async () => recordEvent('event-1'))).toBe(true);
  });

  it('keeps the same event identifier distinct across environments', async () => {
    await recordEvent('event-1');

    // The account and environment are part of the identity so a sandbox event
    // can never be mistaken for a production one.
    await execute(
      database.sql`insert into notifications_provider_events
        (attempts, available_at, feedback_type, id, occurred_at,
         payload_digest, provider, provider_account, provider_environment,
         provider_event_id, received_at, state)
       values (0, now(), 'delivered', ${crypto.randomUUID()}, now(),
         ${digest}, 'local-test', 'account-1', 'production', 'event-1',
         now(), 'received')`,
    );
    expect(
      await rowsOf(database.sql`select id from notifications_provider_events`),
    ).toHaveLength(2);
  });

  it('refuses a callback body digest that is not a digest', async () => {
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into notifications_provider_events
            (attempts, available_at, feedback_type, id, occurred_at,
             payload_digest, provider, provider_account, provider_environment,
             provider_event_id, received_at, state)
           values (0, now(), 'delivered', ${crypto.randomUUID()}, now(),
             'the-raw-callback-body', 'local-test', 'account-1', 'local-test',
             'event-2', now(), 'received')`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a feedback type this domain has no vocabulary for', async () => {
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into notifications_provider_events
            (attempts, available_at, feedback_type, id, occurred_at,
             payload_digest, provider, provider_account, provider_environment,
             provider_event_id, received_at, state)
           values (0, now(), 'quarantined', ${crypto.randomUUID()}, now(),
             ${digest}, 'local-test', 'account-1', 'local-test', 'event-3',
             now(), 'received')`,
        ),
      ),
    ).toBe(true);
  });
});
