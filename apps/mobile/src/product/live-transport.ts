import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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
  type TrackPublication,
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
   *
   * Present only while the track is subscribed *and* unmuted. A web peer who
   * turns their camera off mutes the publication rather than unpublishing it,
   * so the subscription survives — and a reference that only tracked
   * subscription kept the provider's video view mounted over a track that had
   * stopped producing frames. What that renders is the last frame the camera
   * sent, frozen, wearing a live person's face.
   */
  readonly peerVideo: TrackReference | undefined;
  /** True while a remote audio track is subscribed and unmuted. */
  readonly peerAudio: boolean;
  /**
   * True while the other person is in the room, whatever they are sending.
   *
   * A separate fact because their absence is ambiguous without it: no video
   * and no audio is what "not here yet" looks like, and also what "here, with
   * the camera and microphone off" looks like. The first should read as
   * waiting and the second as a person who is present and can still be typed
   * to, and only the room knows which.
   */
  readonly peerJoined: boolean;
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

/** Which way the camera points, in the screen's own vocabulary. */
export type CameraFacing = 'back' | 'front';

/** The same fact, in the vocabulary a capture constraint is written in. */
function captureFacing(facing: CameraFacing): 'environment' | 'user' {
  return facing === 'front' ? 'user' : 'environment';
}

export interface LiveTransportOptions {
  readonly api: ConsumerApi;
  readonly callId: string | undefined;
  readonly cameraOn: boolean;
  /**
   * Which camera to publish.
   *
   * Passed in because the provider owns the device during an encounter and the
   * preview does not exist to be switched. Before this was here the control in
   * the dock flipped a preview that had already been unmounted, so "Switch
   * camera" was a button that did nothing for the whole of every call.
   */
  readonly facing: CameraFacing;
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
  const [peerJoined, setPeerJoined] = useState(false);
  /**
   * The remote camera as subscribed, whether or not it is muted.
   *
   * `peerVideo` above is the *rendered* fact — subscribed and unmuted — so a
   * mute takes the reference out of it. The unmute that follows has to put the
   * same reference back, and by then the subscription events are long past;
   * this ref is where it waits.
   */
  const subscribedVideo = useRef<TrackReference | undefined>(undefined);
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
    subscribedVideo.current = undefined;
    setPeerVideo(undefined);
    setPeerAudio(false);
    setPeerJoined(false);
  }, []);

  /*
   * Joining, and leaving. Keyed only on the four facts that decide *which room
   * this is*: the client, the call, whether anything is carrying it, and the
   * callback that clears the other person. Nothing about what is published
   * belongs in that list, because a change to any of it disconnects a live call
   * and joins it again.
   *
   * `microphoneGranted` used to be in it, and the microphone is granted from a
   * dialog that arrives *beside* the search — so the ordinary case was somebody
   * being matched, connecting, and then having the whole room torn down and
   * rebuilt the moment they said yes to being heard. It cost the audio session,
   * both publications, and about a second of the call. It is a publishing
   * decision, and it is now read where publishing is decided.
   */
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
              const reference = {
                participant,
                publication,
                source: Track.Source.Camera,
              };
              subscribedVideo.current = reference;
              // A track can arrive already muted — a camera switched off
              // before the match publishes, then mutes — and rendering it
              // would mount a video view with nothing behind it.
              setPeerVideo(publication.isMuted ? undefined : reference);
            }
            if (track.kind === Track.Kind.Audio) {
              setPeerAudio(!publication.isMuted);
            }
            setPeerJoined(true);
          },
        )
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (cancelled()) return;
          if (track.kind === Track.Kind.Video) {
            subscribedVideo.current = undefined;
            setPeerVideo(undefined);
          }
          if (track.kind === Track.Kind.Audio) setPeerAudio(false);
        })
        .on(
          RoomEvent.TrackMuted,
          (publication: TrackPublication, participant: Participant) => {
            // A web peer's camera toggle mutes the publication rather than
            // unpublishing it, so the subscription — and without this, the
            // last frame it carried — survives. The event reports the local
            // mute too, and a handler that did not ask whose publication this
            // is would blank the peer every time *this* person muted.
            if (cancelled() || participant.isLocal) return;
            if (publication.kind === Track.Kind.Video) setPeerVideo(undefined);
            if (publication.kind === Track.Kind.Audio) setPeerAudio(false);
          },
        )
        .on(
          RoomEvent.TrackUnmuted,
          (publication: TrackPublication, participant: Participant) => {
            if (cancelled() || participant.isLocal) return;
            if (publication.kind === Track.Kind.Video) {
              setPeerVideo(subscribedVideo.current);
            }
            if (publication.kind === Track.Kind.Audio) setPeerAudio(true);
          },
        )
        .on(RoomEvent.ParticipantConnected, () => {
          if (cancelled()) return;
          // Present before publishing anything. A peer whose camera and
          // microphone are both off sends no tracks at all, and without this
          // fact the surface would go on saying "waiting to join" about a
          // person who is already here and typing.
          setPeerJoined(true);
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
      // The peer may have been in the room before this side joined, in which
      // case no ParticipantConnected ever fires for them here.
      if (opened.remoteParticipants.size > 0) setPeerJoined(true);
      setState('connected');
      // The devices are not opened here. Publishing is owned by the effect
      // below, which is keyed on the room and on what the person has actually
      // asked for — so a camera somebody switched off before being matched
      // stays off instead of being published for the moment it takes an
      // enable-then-disable to settle.
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
  }, [api, callId, carried, clearRemote]);

  /**
   * Everything this side publishes, and the only place that decides it.
   *
   * `setCameraEnabled(false)` unpublishes and releases the camera, which is
   * what "camera off" should mean on a phone: the indicator goes out and the
   * device is free. `setMicrophoneEnabled(false)` does the same for audio. Both
   * are told rather than simulated, so "their camera is off" is a fact the
   * other person's client receives instead of a black rectangle it has to guess
   * about.
   *
   * The camera is opened here rather than at the end of connecting, which is
   * what makes the person's own intent authoritative from the first frame: a
   * camera switched off at the door is never published at all.
   *
   * It is also the only place that can *retry*. Opening a camera is not
   * reliable on a phone and the most common failure is structural rather than
   * exceptional: Android refuses the camera to an application that is not in
   * front, and the microphone permission dialog — which arrives beside the
   * search, over this screen — is exactly that. An open attempted once behind
   * that dialog fails, and before this effect owned the decision nothing tried
   * again for the rest of the call.
   */
  const applied = useRef<{ facing: CameraFacing; resumes: number } | undefined>(
    undefined,
  );
  const { cameraOn, facing, microphoneOn } = options;
  /**
   * How many times the application has come back to the front.
   *
   * A counter rather than a boolean, because what the camera has to react to is
   * the *event* of returning: Android takes the device from an application that
   * leaves the foreground — the eviction is the system's — and hands nothing
   * back, so a publication that survives a background is a publication sending
   * a frozen frame. Measured on a device, the picture never came back for the
   * rest of the encounter and the surface went on saying "Connected."
   */
  const [resumes, setResumes] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      setResumes((count) => count + 1);
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (room === undefined) {
      applied.current = undefined;
      return;
    }
    const local = room.localParticipant;
    void (async () => {
      try {
        if (!cameraOn) {
          await local.setCameraEnabled(false);
          // Forgotten deliberately. The device is released, so turning the
          // camera back on is an open rather than a switch.
          applied.current = undefined;
        } else {
          const current = applied.current;
          const track = local.getTrackPublication(
            Track.Source.Camera,
          )?.videoTrack;
          if (current === undefined || track === undefined) {
            // Nothing is published — either this is the first attempt, or an
            // earlier one failed. `applied` is only written after the open
            // resolves, so a failure leaves this branch armed for the next
            // resume rather than recording a camera that is not there.
            await local.setCameraEnabled(true, {
              facingMode: captureFacing(facing),
            });
            applied.current = { facing, resumes };
          } else if (current.facing !== facing || current.resumes !== resumes) {
            // The person asked for the other camera, or the application has
            // come back and the device underneath the publication is dead.
            // Restarting keeps the publication — and so the other person's
            // subscription — while the device beneath it changes, which is the
            // difference between switching cameras and dropping out of the
            // call for a moment.
            await track.restartTrack({ facingMode: captureFacing(facing) });
            applied.current = { facing, resumes };
          }
        }
      } catch {
        // A device that will not open is reported by the absence of a local
        // track rather than by a failure state: the call is still a call, the
        // surface says the camera is off, which is true, and the next time the
        // application is in front this tries again.
      }
      try {
        await local.setMicrophoneEnabled(microphoneGranted && microphoneOn);
      } catch {
        // Same reasoning. Somebody who cannot be heard can still be seen.
      }
    })();
  }, [cameraOn, facing, microphoneGranted, microphoneOn, resumes, room]);

  return {
    localVideo,
    peerAudio,
    peerJoined,
    peerVideo,
    state,
    // True from the first attempt rather than from a successful connection.
    // The preview has to be gone *before* the room asks for the camera, so
    // yielding on success would yield too late to work.
    yielded: carried,
  };
}
