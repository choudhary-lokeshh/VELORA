/**
 * The one module in this application that knows a media provider exists.
 *
 * Everything the RTC library exports reaches the rest of Consumer Mobile
 * through here, so a surface component never imports a vendor, and so the whole
 * native dependency can be replaced in tests by one entry in
 * `jest.config.js`'s `moduleNameMapper`. That indirection is not ceremony: the
 * library is a native module, it cannot load in a JavaScript test environment,
 * and without a single import site every test that renders Live would need its
 * own mock.
 *
 * `registerGlobals` is the library's own installation step. It puts the WebRTC
 * types this platform does not have — `RTCPeerConnection`, `MediaStream`,
 * `navigator.mediaDevices` — onto the global object, and nothing that touches a
 * `Room` works until it has run. It is called exactly once, from here, rather
 * than from a component that might mount twice.
 */
import {
  AudioSession,
  VideoTrack,
  registerGlobals,
} from '@livekit/react-native';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from 'livekit-client';

/**
 * What the provider's video view is handed, declared structurally.
 *
 * The library's own `TrackReference` lives in `@livekit/components-react`,
 * which arrives transitively rather than as something this application depends
 * on. Restating the shape here keeps the dependency graph honest — the
 * application depends on what it imports — and a structural mismatch would be a
 * type error at the one place a view is rendered rather than a runtime
 * surprise.
 */
export interface TrackReference {
  readonly participant: Participant;
  readonly publication: TrackPublication;
  readonly source: Track.Source;
}

let installed = false;

/**
 * Installs the WebRTC globals, once per process.
 *
 * Idempotent by a module-level flag rather than by the library's own behaviour,
 * because a hook that mounted, unmounted, and mounted again would otherwise
 * call it on every mount and there is no documented promise about what that
 * does.
 */
export function installRealtimeGlobals(): void {
  if (installed) return;
  installed = true;
  registerGlobals();
}

export { AudioSession, ConnectionState, Room, RoomEvent, Track, VideoTrack };
export type {
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  TrackPublication,
};
