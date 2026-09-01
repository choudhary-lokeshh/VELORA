import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import type { ConsumerApi } from '@velora/consumer-client';

import { createInMemorySecureTokenStore } from '../src/auth/secure-storage';
import { LiveScreen } from '../src/product/live';
import { useLiveTransport } from '../src/product/live-transport';
import { admittedState, createMobileApiDouble } from './support/api-double';
import { renderScreen } from './support/render';

const noop = () => undefined;

/**
 * What this side of a call publishes, and when it joins and leaves.
 *
 * Every defect asserted here was found by putting a real Android client and a
 * real browser into one LiveKit Cloud room, and not one of them is reachable
 * from the `local-test` adapter: three of them need a room that actually
 * connects, and the fourth needs an operating system that takes a camera away.
 *
 * The shared double in `test/support/live-rtc.ts` refuses to connect on
 * purpose, so that a test which renders Live can never assert a connection this
 * environment cannot have. That refusal is exactly what makes it useless here —
 * this file is the test *of* the transport — so it is replaced for this file
 * alone, by a room that connects and records what it was asked to publish. No
 * other suite sees it.
 */

interface PublishedCamera {
  facingMode: string;
  restarts: string[];
}

interface RoomRecord {
  cameraCalls: { enabled: boolean; facingMode: string | undefined }[];
  /** Makes the next open fail, the way Android does behind a system dialog. */
  refuseCamera: boolean;
  connects: number;
  handlers: { event: string; handler: (...args: unknown[]) => void }[];
  disconnects: number;
  microphoneCalls: boolean[];
  published: PublishedCamera | undefined;
}

const mockRecord: RoomRecord = {
  cameraCalls: [],
  refuseCamera: false,
  connects: 0,
  handlers: [],
  disconnects: 0,
  microphoneCalls: [],
  published: undefined,
};

jest.mock('../src/product/live-rtc', () => {
  const reactNative = jest.requireActual<{ View: unknown }>('react-native');
  class FakeRoom {
    readonly localParticipant = {
      getTrackPublication: () =>
        mockRecord.published === undefined
          ? undefined
          : {
              videoTrack: {
                restartTrack: (options?: { facingMode?: string }) => {
                  const facing = options?.facingMode ?? 'user';
                  mockRecord.published?.restarts.push(facing);
                  if (mockRecord.published !== undefined) {
                    mockRecord.published.facingMode = facing;
                  }
                  return Promise.resolve(undefined);
                },
              },
            },
      setCameraEnabled: (
        enabled: boolean,
        options?: { facingMode?: string },
      ) => {
        mockRecord.cameraCalls.push({
          enabled,
          facingMode: options?.facingMode,
        });
        if (enabled && mockRecord.refuseCamera) {
          mockRecord.refuseCamera = false;
          return Promise.reject(new Error('camera unavailable'));
        }
        mockRecord.published = enabled
          ? { facingMode: options?.facingMode ?? 'user', restarts: [] }
          : undefined;
        return Promise.resolve(undefined);
      },
      setMicrophoneEnabled: (enabled: boolean) => {
        mockRecord.microphoneCalls.push(enabled);
        return Promise.resolve(undefined);
      },
    };

    connect(): Promise<void> {
      mockRecord.connects += 1;
      return Promise.resolve();
    }

    disconnect(): Promise<void> {
      mockRecord.disconnects += 1;
      return Promise.resolve();
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      mockRecord.handlers.push({ event, handler });
      return this;
    }
  }
  return {
    AudioSession: {
      startAudioSession: () => Promise.resolve(undefined),
      stopAudioSession: () => Promise.resolve(undefined),
    },
    ConnectionState: {
      Connected: 'connected',
      Connecting: 'connecting',
      Disconnected: 'disconnected',
      Reconnecting: 'reconnecting',
    },
    Room: FakeRoom,
    RoomEvent: {
      ConnectionStateChanged: 'connectionStateChanged',
      LocalTrackPublished: 'localTrackPublished',
      ParticipantDisconnected: 'participantDisconnected',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
    },
    Track: {
      Kind: { Audio: 'audio', Video: 'video' },
      Source: { Camera: 'camera' },
    },
    VideoTrack: reactNative.View,
    installRealtimeGlobals: () => undefined,
  };
});

const api = {
  joinAuthorization: () =>
    Promise.resolve({
      kind: 'ok' as const,
      value: {
        credential: 'not-a-real-credential',
        expiresAt: new Date(),
        medium: 'video' as const,
        providerReference: 'room-1',
        sessionId: 'call-1',
        transport: { provider: 'livekit', url: 'wss://example.invalid' },
      },
    }),
} as unknown as ConsumerApi;

function options(overrides: {
  cameraOn?: boolean;
  facing?: 'back' | 'front';
  microphoneGranted?: boolean;
  microphoneOn?: boolean;
}) {
  return {
    api,
    callId: 'call-1',
    cameraOn: overrides.cameraOn ?? true,
    facing: overrides.facing ?? ('front' as const),
    mediaTransport: 'provider' as const,
    microphoneGranted: overrides.microphoneGranted ?? true,
    microphoneOn: overrides.microphoneOn ?? true,
  };
}

/** Lets the credential request and the connection settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockRecord.cameraCalls = [];
  mockRecord.refuseCamera = false;
  mockRecord.connects = 0;
  mockRecord.handlers = [];
  mockRecord.disconnects = 0;
  mockRecord.microphoneCalls = [];
  mockRecord.published = undefined;
});

describe('what a phone publishes into a call', () => {
  it('stays in the room when the microphone is granted', async () => {
    // The permission dialog arrives beside the search, so this is the ordinary
    // order of events rather than an edge case: matched, connected, and only
    // then does the person say yes to being heard.
    const view = await renderHook(useLiveTransport, {
      initialProps: options({ microphoneGranted: false }),
    });
    await settle();
    expect(mockRecord.connects).toBe(1);

    await act(async () => {
      await view.rerender(options({ microphoneGranted: true }));
    });
    await settle();

    // One connection, no teardown. Keying the join on a publishing decision
    // disconnected a live call and rejoined it, which cost the audio session,
    // both publications, and about a second of the call.
    expect(mockRecord.connects).toBe(1);
    expect(mockRecord.disconnects).toBe(0);
    expect(mockRecord.microphoneCalls.at(-1)).toBe(true);
  });

  it('publishes no camera the person has switched off', async () => {
    await renderHook(useLiveTransport, {
      initialProps: options({ cameraOn: false }),
    });
    await settle();

    expect(mockRecord.connects).toBe(1);
    expect(mockRecord.cameraCalls.some((call) => call.enabled)).toBe(false);
  });

  it('switches the camera without dropping the publication', async () => {
    const view = await renderHook(useLiveTransport, {
      initialProps: options({ facing: 'front' }),
    });
    await settle();
    expect(mockRecord.cameraCalls).toEqual([
      { enabled: true, facingMode: 'user' },
    ]);

    await act(async () => {
      await view.rerender(options({ facing: 'back' }));
    });
    await settle();

    // Restarted rather than republished: the other person's subscription
    // survives, and the device underneath it changes.
    expect(mockRecord.published?.restarts).toEqual(['environment']);
    expect(mockRecord.cameraCalls).toHaveLength(1);
  });

  it('tries the camera again after an open the system refused', async () => {
    // The microphone dialog stands over this screen while the match is being
    // made, and Android refuses the camera to an application that is not in
    // front. Opening once and never again left a call whose video never
    // started, for the whole of the call — and it was hidden for as long as a
    // separate defect happened to rebuild the room a second later.
    mockRecord.refuseCamera = true;
    const listeners: ((next: AppStateStatus) => void)[] = [];
    const original = AppState.addEventListener.bind(AppState);
    AppState.addEventListener = (_event, listener) => {
      listeners.push(listener);
      return { remove: () => undefined };
    };
    try {
      await renderHook(useLiveTransport, { initialProps: options({}) });
      await settle();
      expect(mockRecord.published).toBeUndefined();

      await act(async () => {
        for (const listener of listeners) listener('active');
        await Promise.resolve();
      });
      await settle();

      expect(mockRecord.published?.facingMode).toBe('user');
    } finally {
      AppState.addEventListener = original;
    }
  });

  it('opens the camera again when the application comes back', async () => {
    const listeners: ((next: AppStateStatus) => void)[] = [];
    /*
     * Saved and put back by hand rather than with a Jest spy. `mockRestore`
     * leaves the property as an implementation-less mock, which returns no
     * subscription — and every later component in this file that listens for a
     * foreground then throws in its own cleanup. Restoring the function itself
     * leaves nothing behind.
     */
    const original = AppState.addEventListener.bind(AppState);
    AppState.addEventListener = (_event, listener) => {
      listeners.push(listener);
      return { remove: () => undefined };
    };
    try {
      await renderHook(useLiveTransport, { initialProps: options({}) });
      await settle();
      expect(mockRecord.published?.restarts).toEqual([]);

      await act(async () => {
        for (const listener of listeners) listener('active');
        await Promise.resolve();
      });

      // Android takes the camera from an application that is not in front and
      // hands nothing back. Without this the far end keeps a frozen frame of
      // somebody who is still in the call, for the rest of the encounter.
      expect(mockRecord.published?.restarts).toEqual(['user']);
    } finally {
      AppState.addEventListener = original;
    }
  });
});

/**
 * Where the other person's picture is mounted, which is a different question
 * from whether it arrives.
 *
 * On a phone an absolutely-positioned layer fills its own parent and nothing
 * further. The picture used to be mounted inside the pane that names somebody —
 * a column sized to a name, a country and a sentence — so the first real camera
 * to reach an Android device arrived as a strip across the middle of the screen
 * with the text drawn over it. Nothing simulated can show that: without a
 * provider there is no track, and with no track there is no layer to misplace.
 */
describe('where the other person is drawn', () => {
  it('puts their picture behind the whole stage rather than inside their name', async () => {
    const state = admittedState();
    state.live = {
      ...state.live,
      encounter: {
        call: {
          id: 'call-1',
          mediaTransport: 'provider',
          medium: 'video',
          state: 'connecting',
        },
        connection: { state: 'none' },
        id: 'encounter-1',
        messageSequence: 0,
        peer: {
          displayName: 'Robin',
          id: '11111111-1111-4111-8111-111111111111',
          region: 'PT',
          sharedLanguages: ['en'],
        },
        startedAt: new Date().toISOString(),
      },
      state: 'matched',
    };

    const double = createMobileApiDouble(state);
    const store = createInMemorySecureTokenStore();
    await store.write({
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      installationId: 'installation-local-device',
      refreshToken: 'refresh-stored',
    });
    const view = await renderScreen(
      <LiveScreen onOpenConversation={noop} onOpenPerson={noop} />,
      double,
      { store },
    );

    await waitFor(() => {
      expect(
        mockRecord.handlers.some((each) => each.event === 'trackSubscribed'),
      ).toBe(true);
    });

    const subscribed = mockRecord.handlers.filter(
      (each) => each.event === 'trackSubscribed',
    );
    await act(async () => {
      for (const each of subscribed) {
        each.handler({ kind: 'video' }, {}, { identity: 'them' });
      }
      await Promise.resolve();
    });

    const picture = view.getByTestId('live-peer-video');
    // Walked rather than asserted on a style, because the defect was a
    // containing block: the layer was the right size for the wrong parent.
    const ancestors: (string | undefined)[] = [];
    let node = picture.parent;
    while (node !== null) {
      const id: unknown = node.props.testID;
      ancestors.push(typeof id === 'string' ? id : undefined);
      node = node.parent;
    }
    expect(ancestors).toContain('live-room');
    expect(ancestors).not.toContain('live-peer');
  });
});
