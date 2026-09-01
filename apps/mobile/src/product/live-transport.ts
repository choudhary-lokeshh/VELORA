import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isOk,
  type ConsumerApi,
  type JoinAuthorization,
} from '@velora/consumer-client';

import {
  AudioSession,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  installRealtimeGlobals,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackReference,
} from './live-rtc';

/**
 * The other person's media on a phone, as a product state rather than an SDK.
 *
 * The web hook of the same name and this one share their rules and differ in
 * one thing that matters, and the difference is a platform constraint rather
 * than a preference.
 *
 * **On Android the provider owns the devices, not the preview.** A browser
 * hands out a `MediaStream` that can be published into a room; Android's camera
 * is bound by whichever native view opened it, and `expo-camera`'s preview is
 * a native view rather than a stream. Two clients cannot hold one camera, so
 * once an encounter is being carried, the preview yields and the room opens the
 * camera and the microphone itself. `yielded` below is what the screen reads to
 * unmount the preview, and getting that ordering wrong is the difference
 * between a working call and a black rectangle nobody can explain.
 *
 * Everything else is the same and for the same reasons: a credential is asked
 * for per encounter and never stored, an encounter that ends is disconnected
 * completely, mute is signalled rather than simulated, and a failure is a state
 * the surface can render honestly rather than an exception.
 */

export type LiveTransportState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface LiveTransport {
  /**
   * The remote camera, in the shape the provider's video view takes.
   *
   * A reference rather than a track: the view needs the participant, the
   * publication, and which source it is, and assembling those at the render
   * site would put three vendor types into a component.
   */
  readonly peerVideo: TrackReference | undefined;
  readonly peerAudio: boolean;
  readonly state: LiveTransportState;
  /**
   * Whether the provider currently owns the camera and the microphone.
   *
   * True from the moment a connection is attempted until it is torn down. The
   * screen unmounts its own preview while this is true, because Android will
   * not give the same camera to two clients and the second one to ask simply
   * fails.
   */
  readonly yielded: boolean;
  /** The local camera the room opened, for the self-view. */
  readonly localVideo: TrackReference | undefined;
}

export interface LiveTransportOptions {
  readonly api: ConsumerApi;
  readonly callId: string | undefined;
  readonly cameraOn: boolean;
  readonly mediaTransport: 'none' | 'provider' | undefined;
  readonly microphoneOn: boolean;
  /**
   * Whether the person has granted the microphone.
   *
   * Passed in rather than requested here: asking for a permission is a product
   * moment that belongs to the screen with the button on it, and a hook that
   * prompted would prompt on a render. A denied microphone still carries video
   * — a call somebody can be seen in is better than no call — so this narrows
   * what is published rather than refusing to connect.
   */
  readonly microphoneGranted: boolean;
}

/**
 * The one refusal that means "ask again", and the bound on doing so.
 *
 * REALTIME answers `STATE_CONFLICT` when this person may join and the room they
 * would join has not been created yet. It is the only refusal this hook does
 * not treat as final, and the distinction is the server's rather than a guess
 * made here from a status code: every other refusal — a block, an encounter
 * that ended, a bound reached — is a decision that will not change by being
 * asked a second time.
 *
 * The same values as the web hook, for the same window: LIVE reaches the
 * provider before it publishes the session, so an ordinary match never sees
 * this, and what remains is a create the provider left unresolved.
 */
const sessionNotReadyCode = 'STATE_CONFLICT';
const notReadyAttempts = 6;
const notReadyDelayMilliseconds = 500;

/**
 * Asks for this participant's credential, waiting out a room that is still
 * being created.
 *
 * Returns nothing on every other answer, which the caller renders as failed.
 * The abort signal is checked around the wait as well as around the request, so
 * a Next pressed mid-retry stops here rather than connecting afterwards.
 */
async function authorizeJoin(input: {
  readonly api: ConsumerApi;
  readonly callId: string;
  readonly cancelled: () => boolean;
}): Promise<JoinAuthorization | undefined> {
  for (let attempt = 0; attempt < notReadyAttempts; attempt += 1) {
    const issued = await input.api.joinAuthorization(input.callId);
    if (input.cancelled()) return undefined;
    if (isOk(issued)) return issued.value;
    if (issued.kind !== 'refused' || issued.code !== sessionNotReadyCode) {
      return undefined;
    }
    await new Promise((resume) => {
      setTimeout(resume, notReadyDelayMilliseconds);
    });
    if (input.cancelled()) return undefined;
  }
  return undefined;
}

export function useLiveTransport(options: LiveTransportOptions): LiveTransport {
  const [state, setState] = useState<LiveTransportState>('idle');
  const [peerVideo, setPeerVideo] = useState<TrackReference | undefined>(
    undefined,
  );
  const [localVideo, setLocalVideo] = useState<TrackReference | undefined>(
    undefined,
  );
  const [peerAudio, setPeerAudio] = useState(false);
  /**
   * The joined room, in state rather than only in a ref.
   *
   * The same defect the web hook had, and it would have had the same
   * consequence here: the SDK reports `Connected` from inside `connect()`, so a
   * mute effect keyed on a connection *state* can run before the ref holding
   * the room is assigned and then never run again. Depending on the room itself
   * makes the ordering irrelevant.
   */
  const [room, setRoom] = useState<Room | undefined>(undefined);
  /** The same room, for teardown paths that cannot read state. */
  const active = useRef<Room | undefined>(undefined);

  const { api, callId, mediaTransport, microphoneGranted } = options;
  const carried = mediaTransport === 'provider' && callId !== undefined;

  const clearRemote = useCallback(() => {
    setPeerVideo(undefined);
    setPeerAudio(false);
  }, []);

  useEffect(() => {
    if (!carried) {
      setState('idle');
      setLocalVideo(undefined);
      clearRemote();
      return undefined;
    }

    const scope = new AbortController();
    const cancelled = () => scope.signal.aborted;
    let joined: Room | undefined;
    setState('connecting');

    const open = async () => {
      installRealtimeGlobals();
      // Asked for per encounter and never held. The server re-composes
      // eligibility on every issuance, so a block landing between the match and
      // here refuses the credential.
      const authorization = await authorizeJoin({ api, callId, cancelled });
      if (cancelled()) return;
      if (authorization === undefined) {
        setState('failed');
        return;
      }
      const transport = authorization.transport;
      if (transport === undefined) {
        setState('failed');
        return;
      }

      // Claims the platform's audio session before anything is published, so
      // the call is routed to the earpiece and the speaker rather than to the
      // media stream a phone uses for music. Released in the cleanup below,
      // whatever happens in between.
      await AudioSession.startAudioSession();
      if (cancelled()) {
        await AudioSession.stopAudioSession();
        return;
      }

      const opened = new Room({ adaptiveStream: false, dynacast: false });
      joined = opened;

      opened
        .on(
          RoomEvent.TrackSubscribed,
          (
            track: RemoteTrack,
            publication: RemoteTrackPublication,
            participant: Participant,
          ) => {
            if (cancelled()) return;
            if (track.kind === Track.Kind.Video) {
              setPeerVideo({
                participant,
                publication,
                source: Track.Source.Camera,
              });
            }
            if (track.kind === Track.Kind.Audio) setPeerAudio(true);
          },
        )
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (cancelled()) return;
          if (track.kind === Track.Kind.Video) setPeerVideo(undefined);
          if (track.kind === Track.Kind.Audio) setPeerAudio(false);
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          if (cancelled()) return;
          // Their media is gone. The encounter is not over — that is the
          // server's decision, arriving through the authoritative read — so
          // this reports an absence of media and nothing more.
          clearRemote();
        })
        .on(
          RoomEvent.LocalTrackPublished,
          (publication: LocalTrackPublication, participant: Participant) => {
            if (cancelled()) return;
            if (publication.kind !== Track.Kind.Video) return;
            setLocalVideo({
              participant,
              publication,
              source: Track.Source.Camera,
            });
          },
        )
        .on(RoomEvent.ConnectionStateChanged, (connection: ConnectionState) => {
          if (cancelled()) return;
          if (connection === ConnectionState.Reconnecting) {
            setState('reconnecting');
            return;
          }
          if (connection === ConnectionState.Connected) {
            setState('connected');
            return;
          }
          if (connection === ConnectionState.Disconnected) clearRemote();
        });

      try {
        await opened.connect(transport.url, authorization.credential);
      } catch {
        if (cancelled()) return;
        await AudioSession.stopAudioSession();
        setState('failed');
        return;
      }
      if (cancelled()) {
        // Next was pressed while the connection was being established. The room
        // that arrived is disconnected immediately rather than stored, which is
        // the one window in which a room can outlive the encounter it was for.
        await opened.disconnect();
        await AudioSession.stopAudioSession();
        return;
      }
      active.current = opened;
      setRoom(opened);
      setState('connected');

      // The camera and the microphone are opened by the room, because Android
      // gives one client the camera and the preview has already yielded it.
      // Each is attempted separately: a microphone the person refused must not
      // stop the video, and a camera that will not open must not take the audio
      // with it.
      try {
        await opened.localParticipant.setCameraEnabled(true);
      } catch {
        // Reported by the absence of a local track rather than by a failure
        // state: the call is still a call, and the surface says the camera is
        // off, which is true.
      }
      if (microphoneGranted) {
        try {
          await opened.localParticipant.setMicrophoneEnabled(true);
        } catch {
          // Same reasoning. Somebody who cannot be heard can still be seen.
        }
      }
    };
    void open();

    return () => {
      scope.abort();
      const open_ = joined ?? active.current;
      active.current = undefined;
      setRoom(undefined);
      setLocalVideo(undefined);
      clearRemote();
      setState('idle');
      // Fire and forget in both cases: a screen going away must not wait on a
      // network teardown, and the audio session must be released even if the
      // disconnect never lands.
      void open_?.disconnect();
      void AudioSession.stopAudioSession();
    };
  }, [api, callId, carried, clearRemote, microphoneGranted]);

  /**
   * Tells the other side about mute, rather than sending silence.
   *
   * `setCameraEnabled(false)` unpublishes and releases the camera, which is
   * what "camera off" should mean on a phone: the indicator goes out and the
   * device is free. `setMicrophoneEnabled(false)` does the same for audio.
   */
  useEffect(() => {
    if (room === undefined) return;
    void room.localParticipant.setCameraEnabled(options.cameraOn);
    void room.localParticipant.setMicrophoneEnabled(
      microphoneGranted && options.microphoneOn,
    );
  }, [microphoneGranted, options.cameraOn, options.microphoneOn, room]);

  return {
    localVideo,
    peerAudio,
    peerVideo,
    state,
    // True from the first attempt rather than from a successful connection.
    // The preview has to be gone *before* the room asks for the camera, so
    // yielding on success would yield too late to work.
    yielded: carried,
  };
}
