import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsumerApi } from '@velora/consumer-client';

import { authorizeJoin, useLiveTransport } from '../src/product/live-transport';

/**
 * The provider, stood in for.
 *
 * The SDK reaches for a media stack jsdom does not have, so the hook below is
 * exercised against a room that records what it was told and fires whatever
 * events a test hands it. That is exactly what the mute rules need: they are a
 * mapping from provider events to rendered facts, and the mapping is the thing
 * that must not drift — a real provider proved what happens when it does, and
 * what happens is a frozen last frame wearing a live person's face.
 */
const rtc = vi.hoisted(() => {
  const record = {
    connects: 0,
    disconnects: 0,
    handlers: [] as { event: string; handler: (...args: unknown[]) => void }[],
    /** How many peers are already in the room when this side arrives. */
    remoteCount: 0,
  };
  class FakeRoom {
    readonly localParticipant = {
      publishTrack: () => Promise.resolve(undefined),
      trackPublications: new Map<string, unknown>(),
      unpublishTrack: () => Promise.resolve(undefined),
    };

    get remoteParticipants(): Map<string, unknown> {
      return new Map(
        Array.from({ length: record.remoteCount }, (_, index) => [
          String(index),
          {},
        ]),
      );
    }

    connect(): Promise<void> {
      record.connects += 1;
      return Promise.resolve();
    }

    disconnect(): Promise<void> {
      record.disconnects += 1;
      return Promise.resolve();
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      record.handlers.push({ event, handler });
      return this;
    }
  }
  return { FakeRoom, record };
});

vi.mock('livekit-client', () => ({
  ConnectionState: {
    Connected: 'connected',
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
  },
  Room: rtc.FakeRoom,
  RoomEvent: {
    ConnectionStateChanged: 'connectionStateChanged',
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackMuted: 'trackMuted',
    TrackSubscribed: 'trackSubscribed',
    TrackUnmuted: 'trackUnmuted',
    TrackUnsubscribed: 'trackUnsubscribed',
  },
  Track: {
    Kind: { Audio: 'audio', Video: 'video' },
    Source: { Camera: 'camera', Microphone: 'microphone' },
  },
}));

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

/**
 * What the other person's mute means on this side.
 *
 * A peer's camera toggle mutes the publication rather than unpublishing it, so
 * the subscription — and the `<video>` mounted on it — survives. Before these
 * facts existed the element stayed on screen over a track that had stopped
 * producing frames, which renders as the last frame the camera sent, frozen,
 * while the caption went on saying "Connected."
 */
describe("the other person's mute, on this side", () => {
  const hadMediaStream = 'MediaStream' in globalThis;
  const priorMediaStream = (globalThis as { MediaStream?: unknown })
    .MediaStream;

  beforeEach(() => {
    rtc.record.connects = 0;
    rtc.record.disconnects = 0;
    rtc.record.handlers = [];
    rtc.record.remoteCount = 0;
    // jsdom has no media stack; the hook needs only a bag of tracks.
    class FakeMediaStream {
      private readonly tracks: unknown[];
      constructor(tracks: unknown[] = []) {
        this.tracks = [...tracks];
      }
      addTrack(track: unknown): void {
        this.tracks.push(track);
      }
      getTracks(): unknown[] {
        return this.tracks;
      }
    }
    (globalThis as { MediaStream?: unknown }).MediaStream = FakeMediaStream;
  });

  afterEach(() => {
    cleanup();
    if (hadMediaStream) {
      (globalThis as { MediaStream?: unknown }).MediaStream = priorMediaStream;
    } else {
      delete (globalThis as { MediaStream?: unknown }).MediaStream;
    }
  });

  const api = {
    joinAuthorization: () =>
      Promise.resolve({ kind: 'ok' as const, value: credential }),
  } as unknown as ConsumerApi;

  function transportOptions() {
    return {
      api,
      callId: credential.callId,
      cameraOn: true,
      localStream: undefined,
      mediaTransport: 'provider' as const,
      microphoneOn: true,
    };
  }

  /** Fires every handler registered for one of the provider's events. */
  async function fire(event: string, ...args: unknown[]): Promise<void> {
    await act(async () => {
      for (const each of rtc.record.handlers) {
        if (each.event === event) each.handler(...args);
      }
      await Promise.resolve();
    });
  }

  async function connected() {
    const view = renderHook(useLiveTransport, {
      initialProps: transportOptions(),
    });
    await waitFor(() => {
      expect(view.result.current.state).toBe('connected');
    });
    return view;
  }

  const peer = { isLocal: false };
  const me = { isLocal: true };
  const videoTrack = { kind: 'video', mediaStreamTrack: {} };
  const audioTrack = { kind: 'audio', mediaStreamTrack: {} };

  it('takes a muted camera off the stage and keeps the audio', async () => {
    const view = await connected();
    await fire('trackSubscribed', videoTrack, { isMuted: false }, peer);
    await fire('trackSubscribed', audioTrack, { isMuted: false }, peer);
    expect(view.result.current.peerVideo).toBe(true);
    expect(view.result.current.peerAudio).toBe(true);

    await fire('trackMuted', { kind: 'video' }, peer);

    // The picture is gone, the voice is not, and the person has not left.
    expect(view.result.current.peerVideo).toBe(false);
    expect(view.result.current.peerAudio).toBe(true);
    expect(view.result.current.peerJoined).toBe(true);

    await fire('trackUnmuted', { kind: 'video' }, peer);
    expect(view.result.current.peerVideo).toBe(true);
  });

  it("ignores this side's own mute", async () => {
    const view = await connected();
    await fire('trackSubscribed', videoTrack, { isMuted: false }, peer);

    await fire('trackMuted', { kind: 'video' }, me);

    // The event reports local mutes too, and blanking the peer because *this*
    // person covered their camera would be the wrong face going dark.
    expect(view.result.current.peerVideo).toBe(true);
  });

  it('never renders a track that arrives already muted', async () => {
    const view = await connected();
    await fire('trackSubscribed', videoTrack, { isMuted: true }, peer);
    expect(view.result.current.peerVideo).toBe(false);

    await fire('trackUnmuted', { kind: 'video' }, peer);
    expect(view.result.current.peerVideo).toBe(true);
  });

  it('knows a silent peer has joined', async () => {
    const view = await connected();
    expect(view.result.current.peerJoined).toBe(false);

    await fire('participantConnected');

    // Camera and microphone both off publishes no tracks at all. Present and
    // quiet is a different fact from absent, and the surface says which.
    expect(view.result.current.peerJoined).toBe(true);
    expect(view.result.current.peerVideo).toBe(false);
    expect(view.result.current.peerAudio).toBe(false);

    await fire('participantDisconnected');
    expect(view.result.current.peerJoined).toBe(false);
  });

  it('sees a peer who was in the room first', async () => {
    rtc.record.remoteCount = 1;
    const view = await connected();

    // No ParticipantConnected ever fires for somebody already there.
    expect(view.result.current.peerJoined).toBe(true);
  });
});
