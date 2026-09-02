import { View } from 'react-native';

/**
 * The RTC library, stood in for.
 *
 * `@livekit/react-native` is a native module: it links a WebRTC implementation
 * into the Android binary and does not exist in a JavaScript test environment.
 * `jest.config.js` maps `src/product/live-rtc` to this file, which is why that
 * module exists at all — one import site, one place to replace.
 *
 * Everything here is inert on purpose. Nothing connects, nothing publishes, and
 * `installRealtimeGlobals` installs nothing, so a test that renders Live
 * exercises the *product* — the states, the copy, the yield of the preview, the
 * teardown — and never a vendor's transport. A double that pretended to connect
 * would let a test assert a connection this environment cannot have.
 */

export const ConnectionState = {
  Connected: 'connected',
  Connecting: 'connecting',
  Disconnected: 'disconnected',
  Reconnecting: 'reconnecting',
} as const;

export const RoomEvent = {
  ConnectionStateChanged: 'connectionStateChanged',
  LocalTrackPublished: 'localTrackPublished',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  TrackMuted: 'trackMuted',
  TrackSubscribed: 'trackSubscribed',
  TrackUnmuted: 'trackUnmuted',
  TrackUnsubscribed: 'trackUnsubscribed',
} as const;

export const Track = {
  Kind: { Audio: 'audio', Video: 'video' },
  Source: { Camera: 'camera' },
} as const;

export const AudioSession = {
  startAudioSession: () => Promise.resolve(undefined),
  stopAudioSession: () => Promise.resolve(undefined),
};

/** Renders nothing. A video view with no transport has nothing to show. */
export const VideoTrack = View;

export class Room {
  readonly localParticipant = {
    setCameraEnabled: () => Promise.resolve(undefined),
    setMicrophoneEnabled: () => Promise.resolve(undefined),
    videoTrackPublications: new Map<string, unknown>(),
  };

  readonly remoteParticipants = new Map<string, unknown>();

  connect(): Promise<void> {
    // Refuses rather than resolving. A double that connected would let the
    // surface reach `connected` in an environment with no media at all, and a
    // test asserting that would be asserting a lie.
    return Promise.reject(
      new Error('no realtime transport in the test environment'),
    );
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  on(): this {
    return this;
  }
}

export function installRealtimeGlobals(): void {
  return undefined;
}

/** Only ever imported as a type by product code; declared so the map resolves. */
export interface TrackReference {
  readonly participant: unknown;
  readonly publication: unknown;
  readonly source: unknown;
}
