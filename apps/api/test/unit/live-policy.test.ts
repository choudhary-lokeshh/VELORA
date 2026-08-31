import { describe, expect, it } from 'bun:test';
import {
  idempotencyKeySchema,
  liveEndReasonSchema,
  liveMediumSchema,
  liveStateSchema,
  maximumMessageBodyCharacters as contractMessageBodyCharacters,
  messageBodySchema,
  sendLiveMessageRequestSchema,
} from '@velora/validation';

import {
  liveEncounterStates,
  liveEndReasons,
  liveMediums,
  liveParticipationEncounterStates,
  liveParticipationLiveStates,
  liveParticipationStates,
  livePresenceGraceMilliseconds,
  liveRecordingImplemented,
  liveRematchSuppressionMilliseconds,
  liveRetentionDuration,
  liveSearchGraceMilliseconds,
  maximumLiveClientMessageIdCharacters,
  maximumLiveMessageBodyCharacters,
  minimumLiveClientMessageIdCharacters,
  productionBlockers,
} from '../../src/live/policy.js';

/**
 * The LIVE schema module restates the contract's message bounds because
 * `drizzle-kit` reads it through a CommonJS resolver that cannot follow the
 * validation package's import-only exports — the same constraint MESSAGING
 * records. Restating is only safe while drift is impossible, which is what
 * these assertions are for: the moment a published bound moves without the
 * database bound moving with it, this fails.
 */
describe('live bounds match the published contract', () => {
  it('bounds a live message body identically in the contract and the database', () => {
    expect(maximumLiveMessageBodyCharacters).toBe(
      contractMessageBodyCharacters,
    );
    expect(messageBodySchema.safeParse('a'.repeat(4_000)).success).toBe(true);
    expect(messageBodySchema.safeParse('a'.repeat(4_001)).success).toBe(false);
  });

  it('bounds the client message identifier identically', () => {
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(minimumLiveClientMessageIdCharacters),
      ).success,
    ).toBe(true);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(minimumLiveClientMessageIdCharacters - 1),
      ).success,
    ).toBe(false);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(maximumLiveClientMessageIdCharacters),
      ).success,
    ).toBe(true);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(maximumLiveClientMessageIdCharacters + 1),
      ).success,
    ).toBe(false);
  });

  it('accepts the same live message body the database will', () => {
    const parsed = sendLiveMessageRequestSchema.safeParse({
      body: 'hello',
      clientMessageId: 'abcdefgh',
      encounterId: '00000000-0000-4000-8000-000000000000',
    });
    expect(parsed.success).toBe(true);
    // A body of whitespace passes a naive length check and is refused by both
    // the contract and the `btrim(...) <> ''` constraint, which is the pairing
    // this asserts rather than either half of it.
    expect(
      sendLiveMessageRequestSchema.safeParse({
        body: '   ',
        clientMessageId: 'abcdefgh',
        encounterId: '00000000-0000-4000-8000-000000000000',
      }).success,
    ).toBe(false);
  });
});

describe('live vocabularies match the published contract', () => {
  it('publishes the same two mediums RTC does', () => {
    expect([...liveMediums]).toEqual([...liveMediumSchema.options]);
  });

  it('never publishes an internal end reason on the wire', () => {
    // The two safety reasons are separate decisions with separate owners and
    // neither is a peer's business, so the wire vocabulary must not carry
    // either of them. This is the assertion that fails if somebody adds one.
    const wire = new Set<string>(liveEndReasonSchema.options);
    expect(wire.has('safety_block')).toBe(false);
    expect(wire.has('safety_enforcement')).toBe(false);
    expect(wire.has('ended_by_platform')).toBe(true);
    // And every internal reason has somewhere to go, so no encounter can end
    // for a reason a surface cannot render.
    for (const reason of liveEndReasons) {
      const disclosable =
        reason === 'departed'
          ? ['left', 'peer_left']
          : reason === 'presence_lapsed'
            ? ['timed_out']
            : reason === 'session_failed'
              ? ['failed']
              : ['ended_by_platform'];
      for (const value of disclosable) expect(wire.has(value)).toBe(true);
    }
  });

  it('keeps the client states the surface renders and the server owns apart', () => {
    // `permissions` and `preview` are client states and must never appear here:
    // the server has no opinion about whether a camera is open, and a state
    // that claimed to would be a client asserting a fact about itself.
    const published = new Set<string>(liveStateSchema.options);
    expect(published.has('permissions')).toBe(false);
    expect(published.has('preview')).toBe(false);
    expect([...published].sort()).toEqual([
      'ended',
      'idle',
      'matched',
      'searching',
    ]);
  });
});

describe('live participation states', () => {
  it('treats every state but `left` as occupying the pool', () => {
    // The partial unique index that guarantees one live participation per
    // person is written as `state <> 'left'`, so this list and that predicate
    // have to agree — and a new state that forgot to be in the list would be a
    // person the matcher could hand to two people at once.
    expect([...liveParticipationLiveStates]).toEqual(
      liveParticipationStates.filter((state) => state !== 'left'),
    );
  });

  it('names an encounter in exactly the states that have one', () => {
    expect([...liveParticipationEncounterStates]).toEqual(['matched', 'ended']);
  });

  it('has exactly two encounter states, and no invitation among them', () => {
    // Both people entered the pool, which is a stronger and earlier consent
    // than answering a ring, so there is nothing to accept and nothing to
    // decline. A vocabulary with `invited` in it would be a random encounter
    // pretending to be a call.
    expect([...liveEncounterStates]).toEqual(['live', 'ended']);
  });
});

describe('live posture', () => {
  it('records no live encounter, and says so', () => {
    expect(liveRecordingImplemented).toBe(false);
  });

  it('approves no retention duration', () => {
    expect(liveRetentionDuration).toBeUndefined();
  });

  it('keeps the production blockers real', () => {
    expect(productionBlockers).toContain('no-approved-rtc-provider');
    expect(productionBlockers).toContain('recording-posture-undecided');
    expect(productionBlockers.length).toBeGreaterThan(0);
  });

  it('gives an encounter longer to survive a quiet client than a search', () => {
    // A phone changing networks should not cost somebody the person they were
    // talking to; a stale searcher is worse than an absent one, because it is
    // what a real person gets matched with.
    expect(livePresenceGraceMilliseconds).toBeGreaterThan(
      liveSearchGraceMilliseconds,
    );
  });

  it('suppresses a rematch for longer than an encounter can go unattended', () => {
    expect(liveRematchSuppressionMilliseconds).toBeGreaterThan(
      livePresenceGraceMilliseconds,
    );
  });
});
