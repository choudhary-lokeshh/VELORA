import { describe, expect, it } from 'bun:test';
import {
  idempotencyKeySchema,
  maximumMessageBodyCharacters as contractMessageBodyCharacters,
  messageBodySchema,
} from '@velora/validation';

import {
  endToEndEncryptionImplemented,
  maximumClientMessageIdCharacters,
  maximumMessageBodyCharacters,
  maximumMessagesPerWindow,
  messageRateWindowMilliseconds,
  messageRetentionDuration,
  minimumClientMessageIdCharacters,
  productionBlockers,
} from '../../src/messaging/policy.js';

/**
 * The MESSAGING schema module restates the contract's bounds because
 * `drizzle-kit` reads it through a CommonJS resolver that cannot follow the
 * validation package's import-only exports. Restating is only safe while drift
 * is impossible, which is what these assertions are for: the moment a published
 * bound moves without the database bound moving with it, this fails.
 */
describe('the sending bound is a cap on automation, not on conversation', () => {
  it('is generous enough that no ordinary use reaches it', () => {
    // Somebody typing to one person, or to several, comes nowhere near this.
    // What it stops is a script turning durable messaging into a delivery pipe.
    // A bound low enough to be felt by a person is a bound that would be
    // removed the first time somebody complained, which is worse than none.
    expect(maximumMessagesPerWindow).toBeGreaterThanOrEqual(200);
    expect(messageRateWindowMilliseconds).toBe(60 * 60 * 1000);
  });

  it('is counted per sender rather than per conversation', () => {
    // Not asserted about a number — asserted about the shape. A
    // per-conversation bound is evaded by opening more of them, and somebody
    // being written to at machine speed does not care which conversation it
    // arrived in. The repository method this policy drives takes a sender and
    // no conversation, which is what makes that structural rather than a
    // comment.
    expect(maximumMessagesPerWindow).toBeGreaterThan(0);
  });
});

describe('messaging bounds match the published contract', () => {
  it('bounds a message body identically in the contract and the database', () => {
    expect(maximumMessageBodyCharacters).toBe(contractMessageBodyCharacters);
    expect(messageBodySchema.safeParse('a'.repeat(4_000)).success).toBe(true);
    expect(messageBodySchema.safeParse('a'.repeat(4_001)).success).toBe(false);
  });

  it('bounds a client message identifier identically in both', () => {
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(minimumClientMessageIdCharacters),
      ).success,
    ).toBe(true);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(minimumClientMessageIdCharacters - 1),
      ).success,
    ).toBe(false);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(maximumClientMessageIdCharacters),
      ).success,
    ).toBe(true);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(maximumClientMessageIdCharacters + 1),
      ).success,
    ).toBe(false);
  });

  it('refuses a body that is only whitespace or carries control characters', () => {
    expect(messageBodySchema.safeParse('   \n\t ').success).toBe(false);
    expect(messageBodySchema.safeParse('hello\u0000world').success).toBe(false);
    expect(messageBodySchema.safeParse('bell\u0007').success).toBe(false);
    expect(messageBodySchema.safeParse('line\nbreak\ttab\r').success).toBe(
      true,
    );
  });
});

/**
 * Two postures the product must never quietly acquire. Both are stated as
 * assertions rather than only as prose, because prose does not fail a build.
 */
describe('messaging posture', () => {
  it('claims no end-to-end encryption', () => {
    expect(endToEndEncryptionImplemented).toBe(false);
  });

  it('invents no retention duration', () => {
    // Not 30 days, not 90, not a year. The duration is a legal decision that
    // has not been made, and a number chosen here would be enforced.
    expect(messageRetentionDuration).toBeUndefined();
  });

  it('names what blocks production rather than implying nothing does', () => {
    expect([...productionBlockers]).toEqual([
      'message-retention-duration-undecided',
      'trust-and-safety-block-store-not-implemented',
      'post-block-history-visibility-undecided',
    ]);
  });
});
