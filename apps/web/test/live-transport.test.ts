import { describe, expect, it, vi } from 'vitest';

import type { ConsumerApi } from '@velora/consumer-client';

import { authorizeJoin } from '../src/product/live-transport';

/**
 * Which refusals a live surface asks again about, and which it accepts.
 *
 * A real provider found the rule this file protects. LIVE publishes a call
 * identifier for an encounter, and REALTIME refuses a join credential for a
 * session whose provider room does not exist yet; those two facts together
 * meant the person who read the encounter in the moment before the room was
 * created was told they could not join a call they were in. The client treated
 * that refusal as final, so they never asked again, never joined, and the other
 * person sat alone in a room.
 *
 * LIVE now reaches the provider before it publishes anything, which removes the
 * window. This is the second half of the answer: the one refusal that means
 * "not yet" is asked again, and every refusal that means "no" is still final —
 * because a client that retried a block would be arguing with a safety
 * decision, and one that gave up on "not yet" is the defect above.
 */

const credential = {
  callId: '11111111-1111-4111-8111-111111111111',
  credential: 'issued',
  expiresAt: new Date().toISOString(),
  medium: 'video' as const,
  transport: { provider: 'livekit', url: 'wss://example.test' },
};

type JoinAnswer = Awaited<ReturnType<ConsumerApi['joinAuthorization']>>;

/** Answers in order, then repeats the last one for as long as it is asked. */
function apiAnswering(answers: readonly JoinAnswer[]): {
  api: ConsumerApi;
  asked: () => number;
} {
  let asked = 0;
  const joinAuthorization = vi.fn(() => {
    const answer: JoinAnswer = answers[Math.min(asked, answers.length - 1)] ?? {
      kind: 'unavailable',
    };
    asked += 1;
    return Promise.resolve(answer);
  });
  return {
    api: { joinAuthorization } as unknown as ConsumerApi,
    asked: () => asked,
  };
}

const notReady = {
  code: 'STATE_CONFLICT',
  kind: 'refused',
  status: 409,
} as const;

describe('asking for a join credential', () => {
  it('asks again while the room is still being created', async () => {
    const { api, asked } = apiAnswering([
      notReady,
      notReady,
      { kind: 'ok', value: credential },
    ]);

    const issued = await authorizeJoin({
      api,
      callId: credential.callId,
      cancelled: () => false,
    });

    expect(issued?.credential).toBe('issued');
    expect(asked()).toBe(3);
  });

  it('accepts a refusal that is a decision, without asking twice', async () => {
    // Anything that is not "not yet" is a decision about this person or this
    // encounter. Asking again would neither change the answer nor be an honest
    // thing for a client to do about a safety refusal.
    for (const answer of [
      { code: 'ACTION_NOT_PERMITTED', kind: 'refused', status: 409 } as const,
      { code: 'RATE_LIMITED', kind: 'refused', status: 409 } as const,
      { kind: 'not-found' } as const,
      { kind: 'unauthenticated' } as const,
      { kind: 'unavailable' } as const,
    ]) {
      const { api, asked } = apiAnswering([answer]);
      const issued = await authorizeJoin({
        api,
        callId: credential.callId,
        cancelled: () => false,
      });
      expect(issued).toBeUndefined();
      expect(asked()).toBe(1);
    }
  });

  it('gives up rather than asking forever', async () => {
    const { api, asked } = apiAnswering([notReady]);

    const issued = await authorizeJoin({
      api,
      callId: credential.callId,
      cancelled: () => false,
    });

    expect(issued).toBeUndefined();
    // Bounded, and the surface then says the camera and voice could not be
    // connected — which is true, and is a better answer than a spinner.
    expect(asked()).toBeLessThanOrEqual(6);
    expect(asked()).toBeGreaterThan(1);
  });

  it('stops the moment the encounter it was for is gone', async () => {
    // Next, pressed while a credential was being waited for. Nothing may be
    // returned afterwards, because the room it would open belongs to somebody
    // this person has already moved on from.
    const { api, asked } = apiAnswering([
      notReady,
      { kind: 'ok', value: credential },
    ]);
    let cancelled = false;

    const issued = await authorizeJoin({
      api,
      callId: credential.callId,
      cancelled: () => {
        cancelled = true;
        return cancelled;
      },
    });

    expect(issued).toBeUndefined();
    expect(asked()).toBe(1);
  });
});
