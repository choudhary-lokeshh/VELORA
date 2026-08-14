import { describe, expect, it } from 'bun:test';

import { notificationKindSchema } from '@velora/validation';

import {
  introductionMutualEventName,
  introductionMutualEventVersion,
  parseIntroductionMutualEvent,
} from '../../src/discovery/events.js';
import {
  messageSentEventName,
  messageSentEventVersion,
  parseMessageSentEvent,
} from '../../src/messaging/events.js';
import {
  decodeFeedCursor,
  encodeFeedCursor,
} from '../../src/notifications/cursor.js';
import { notificationDeliveryPayload } from '../../src/notifications/jobs.js';
import {
  channelUnavailableRetryMilliseconds,
  deliveryBackoffMilliseconds,
  isTerminal,
  maximumDeliveryAttempts,
  notificationKinds,
  notificationTemplateByKey,
  notificationTemplates,
  suppressionReasons,
} from '../../src/notifications/policy.js';

const sender = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';
const conversation = '33333333-3333-4333-8333-333333333333';
const message = '44444444-4444-4444-8444-444444444444';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: conversation,
    messageId: message,
    recipientId: recipient,
    senderId: sender,
    sequence: 1,
    ...overrides,
  };
}

describe('published messaging facts', () => {
  it('carries no message body, sender name, or other renderable content', () => {
    const parsed = parseMessageSentEvent(validPayload());
    expect(parsed).toBeDefined();
    // The contract is the whole surface a notification template can draw on.
    // Anything not listed here cannot end up on a lock screen.
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      'conversationId',
      'messageId',
      'recipientId',
      'senderId',
      'sequence',
    ]);
  });

  it('is parsed rather than trusted, because it was stored by another version', () => {
    expect(parseMessageSentEvent(undefined)).toBeUndefined();
    expect(parseMessageSentEvent('not an object')).toBeUndefined();
    expect(
      parseMessageSentEvent(validPayload({ conversationId: 'x' })),
    ).toBeUndefined();
    expect(
      parseMessageSentEvent(validPayload({ sequence: 0 })),
    ).toBeUndefined();
    expect(
      parseMessageSentEvent(validPayload({ sequence: 1.5 })),
    ).toBeUndefined();
  });

  it('refuses a fact that would notify somebody about themselves', () => {
    expect(
      parseMessageSentEvent(validPayload({ recipientId: sender })),
    ).toBeUndefined();
  });

  it('names its version in the event name', () => {
    expect(
      messageSentEventName.endsWith(`.v${String(messageSentEventVersion)}`),
    ).toBe(true);
  });
});

describe('notification templates', () => {
  it('binds each template to the one producer allowed to trigger it', () => {
    const template = notificationTemplates[messageSentEventName];
    expect(template?.allowedProducer).toBe('messaging');
    // A source domain cannot reach a template with weaker safety rules, because
    // it does not name the template at all.
    for (const entry of Object.values(notificationTemplates)) {
      expect(entry.allowedProducer.length).toBeGreaterThan(0);
    }
  });

  it('requires a live pair eligibility answer for every notice V1 sends', () => {
    for (const template of Object.values(notificationTemplates)) {
      expect(template.requiresPairEligibility).toBe(true);
      expect(template.purpose).toBe('transactional');
      expect(template.timeToLiveMilliseconds).toBeGreaterThan(0);
    }
  });

  it('is reachable from a stored intent as well as from an event', () => {
    const template = notificationTemplates[messageSentEventName];
    expect(template).toBeDefined();
    if (template === undefined) return;
    expect(notificationTemplateByKey[template.key]).toEqual(template);
  });
});

describe('delivery policy', () => {
  it('treats only the three outcomes that end a notice as terminal', () => {
    expect(isTerminal('delivered')).toBe(true);
    expect(isTerminal('suppressed')).toBe(true);
    expect(isTerminal('dead_letter')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    // `attempted` is not terminal: it is what a crashed worker leaves behind,
    // and treating it as final would strand exactly the notices that need
    // recovering.
    expect(isTerminal('attempted')).toBe(false);
  });

  it('backs off further each attempt and then stops growing', () => {
    let previous = 0;
    for (let attempt = 1; attempt <= maximumDeliveryAttempts; attempt += 1) {
      const delay = deliveryBackoffMilliseconds(attempt);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
    expect(deliveryBackoffMilliseconds(1_000)).toBe(
      deliveryBackoffMilliseconds(2_000),
    );
  });

  it('waits longer for a missing provider than for a failure, and never gives up on it', () => {
    // A notice nobody attempted is not a failing notice. It must still be
    // deliverable on the day a provider is approved.
    expect(channelUnavailableRetryMilliseconds).toBeGreaterThan(
      deliveryBackoffMilliseconds(1),
    );
  });

  it('never records a suppression reason a recipient could be shown', () => {
    // Every reason here is operator-facing. None of them is ever returned to
    // the person: `safety_block` would disclose somebody else's block.
    expect([...suppressionReasons]).toEqual([
      'safety_block',
      'recipient_not_deliverable',
      'expired',
    ]);
  });
});

describe('delivery job payload', () => {
  it('parses job data rather than trusting what came back off the queue', () => {
    expect(
      notificationDeliveryPayload.parse({ intentId: conversation }),
    ).toEqual({
      intentId: conversation,
    });
    expect(() => notificationDeliveryPayload.parse(undefined)).toThrow();
    expect(() => notificationDeliveryPayload.parse({})).toThrow();
    expect(() =>
      notificationDeliveryPayload.parse({ intentId: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('published discovery facts', () => {
  it('names the person being told and the person it is about', () => {
    const parsed = parseIntroductionMutualEvent({
      initiatorId: sender,
      introductionId: conversation,
      respondingActorId: recipient,
    });
    // The whole surface a template can draw on. No display name, no profile
    // field, nothing that would let a lock screen say more than the product
    // decided it may.
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      'initiatorId',
      'introductionId',
      'respondingActorId',
    ]);
  });

  it('refuses a fact that would notify somebody about themselves', () => {
    expect(
      parseIntroductionMutualEvent({
        initiatorId: sender,
        introductionId: conversation,
        respondingActorId: sender,
      }),
    ).toBeUndefined();
  });

  it('is parsed rather than trusted', () => {
    expect(parseIntroductionMutualEvent(undefined)).toBeUndefined();
    expect(
      parseIntroductionMutualEvent({ initiatorId: sender }),
    ).toBeUndefined();
    expect(
      parseIntroductionMutualEvent({
        initiatorId: sender,
        introductionId: 'not-a-uuid',
        respondingActorId: recipient,
      }),
    ).toBeUndefined();
  });

  it('names its version in the event name', () => {
    expect(
      introductionMutualEventName.endsWith(
        `.v${String(introductionMutualEventVersion)}`,
      ),
    ).toBe(true);
  });
});

describe('notification event coverage', () => {
  it('covers exactly the two V1 events judged to warrant telling somebody', () => {
    expect(Object.keys(notificationTemplates).sort()).toEqual(
      [introductionMutualEventName, messageSentEventName].sort(),
    );
  });

  it('gives every notice an in-app kind the contract publishes', () => {
    for (const template of Object.values(notificationTemplates)) {
      expect(notificationKinds).toContain(template.kind);
      expect(notificationKindSchema.safeParse(template.kind).success).toBe(
        true,
      );
    }
    // Two templates, two distinct kinds: a client renders one line per kind and
    // could not tell two notices apart if they shared one.
    const kinds = Object.values(notificationTemplates).map(
      (template) => template.kind,
    );
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('binds each template to a different producer than the one it tells about', () => {
    expect(
      notificationTemplates[introductionMutualEventName]?.allowedProducer,
    ).toBe('discovery');
    expect(notificationTemplates[messageSentEventName]?.allowedProducer).toBe(
      'messaging',
    );
  });
});

describe('the in-app feed cursor', () => {
  it('survives a round trip', () => {
    const moment = new Date('2026-03-04T05:06:07.008Z');
    const decoded = decodeFeedCursor(
      encodeFeedCursor({ createdAt: moment, id: conversation }),
    );
    expect(decoded?.id).toBe(conversation);
    expect(decoded?.createdAt.toISOString()).toBe(moment.toISOString());
  });

  it('refuses anything it did not produce', () => {
    // A tampered cursor is a validation failure rather than a different query.
    // It is not a credential either: the query is scoped to the caller, so the
    // worst a forged one could do is move them around their own notices.
    expect(decodeFeedCursor('not base64url!!')).toBeUndefined();
    expect(
      decodeFeedCursor(Buffer.from('{}', 'utf8').toString('base64url')),
    ).toBeUndefined();
    expect(
      decodeFeedCursor(
        Buffer.from(
          JSON.stringify({ i: 'not-a-uuid', t: '2026-01-01T00:00:00.000Z' }),
          'utf8',
        ).toString('base64url'),
      ),
    ).toBeUndefined();
    expect(
      decodeFeedCursor(
        Buffer.from(
          JSON.stringify({ i: conversation, t: 'not a date' }),
          'utf8',
        ).toString('base64url'),
      ),
    ).toBeUndefined();
  });
});
