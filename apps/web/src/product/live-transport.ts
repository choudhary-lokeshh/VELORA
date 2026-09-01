'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  RoomEvent,
  Track,
  type RemoteTrack,
  type Room,
} from 'livekit-client';

import { isOk, type ConsumerApi } from '@velora/consumer-client';

/**
 * The other person's media, as a product state rather than an SDK.
 *
 * The whole of this file exists so that the rest of live discovery does not
 * know a provider exists. Nothing outside it imports `livekit-client`, no
 * component holds a `Room`, and the surface renders one of five honest states
 * rather than a vendor's connection enumeration.
 *
 * Five rules shape it, and each is a thing that goes wrong when a call is wired
 * straight into a component.
 *
 * **Nothing connects without an authorized session.** A credential is asked for
 * per encounter, from the server, which re-composes eligibility on every single
 * issuance. There is no path from a render to a provider, and no credential is
 * ever stored, logged, or put in a URL — it lives in a local variable for the
 * length of one connect.
 *
 * **An encounter that is over is disconnected, completely.** Room, listeners,
 * publications, and remote streams are torn down when the call identifier
 * changes or the component goes away. Pressing Next twenty times must leave
 * exactly one room open, and the abort guard below is what makes a response
 * that arrives after Next harmless instead of a second connection.
 *
 * **The local tracks are the ones the preview already opened.** They are
 * published rather than re-acquired, so there is one camera prompt, one set of
 * devices, and one place that releases them.
 *
 * **Mute is signalled, not simulated.** Disabling a track locally sends black
 * frames and silence, which look identical to a frozen connection from the
 * other side. The publication is muted instead, so the peer is told.
 *
 * **A failure is a state, not an exception.** A provider that refuses, a
 * credential that is declined, and a network that will not carry media all lead
 * to `failed`, which the surface renders as a truthful account of an absence —
 * never as a connection that has not started yet.
 */

export type LiveTransportState =
  /** Nothing is being carried, because nothing has asked for anything. */
  | 'idle'
  /** A credential has been asked for, or a room is being joined. */
  | 'connecting'
  /** Media is flowing, or is about to: the room is joined and publishing. */
  | 'connected'
  /** The provider dropped and is trying again. Still the same encounter. */
  | 'reconnecting'
  /** This encounter cannot be carried. Honest, and not retried silently. */
  | 'failed';

export interface LiveTransport {
  /** True once a remote video track has actually been subscribed. */
  readonly peerVideo: boolean;
  /** True once a remote audio track has actually been subscribed. */
  readonly peerAudio: boolean;
  /** What the peer is sending, ready to attach to a `<video>`. */
  readonly remoteStream: MediaStream | undefined;
  readonly state: LiveTransportState;
}

export interface LiveTransportOptions {
  readonly api: ConsumerApi;
  /**
   * The realtime session carrying this encounter, or nothing.
   *
   * The identity of a connection. When it changes, everything above is torn
   * down and rebuilt — which is what makes Next a clean break rather than a
   * room that quietly keeps running behind the next person's face.
   */
  readonly callId: string | undefined;
  readonly cameraOn: boolean;
  /**
   * The local devices, already opened by the preview.
   *
   * Published rather than re-acquired. A hook that opened its own would prompt
   * twice, hold two camera handles, and leave one of them running.
   */
  readonly localStream: MediaStream | undefined;
  /**
   * Whether a provider is actually carrying media for this encounter.
   *
   * The server's answer, read from the encounter rather than inferred from a
   * configuration name. `none` means there is nothing to connect to and this
   * hook stays idle — which is what stops a surface claiming a connection in an
   * environment that has no provider.
   */
  readonly mediaTransport: 'none' | 'provider' | undefined;
  readonly microphoneOn: boolean;
}

/** The remote media element sink, when this runtime has one. */
function canPlayMedia(): boolean {
  return typeof MediaStream === 'function';
}

export function useLiveTransport(options: LiveTransportOptions): LiveTransport {
  const [state, setState] = useState<LiveTransportState>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | undefined>(
    undefined,
  );
  const [peerVideo, setPeerVideo] = useState(false);
  const [peerAudio, setPeerAudio] = useState(false);

  /**
   * The joined room, in state rather than only in a ref.
   *
   * It was a ref alone, and that was a real defect a real provider found. The
   * SDK reports `Connected` from inside `connect()`, so `state` reached
   * `connected` *before* the ref was assigned; the publish effect then ran
   * against an empty ref, returned early, and never ran again because neither
   * of its dependencies changed afterwards. Two people joined one room and
   * neither ever published a track.
   *
   * Depending on the room itself is what makes "publish once there is somewhere
   * to publish to" true regardless of the order those two happen in.
   */
  const [room, setRoom] = useState<Room | undefined>(undefined);
  /**
   * The same room, for the teardown paths that cannot read state.
   *
   * An effect cleanup and an event listener both run with whatever they closed
   * over, and a disconnect that used a stale value would leave a room open.
   */
  const active = useRef<Room | undefined>(undefined);
  const { api, callId, localStream, mediaTransport } = options;
  const carried = mediaTransport === 'provider' && callId !== undefined;

  const clearRemote = useCallback(() => {
    setRemoteStream(undefined);
    setPeerAudio(false);
    setPeerVideo(false);
  }, []);

  useEffect(() => {
    if (!carried || !canPlayMedia()) {
      setState('idle');
      clearRemote();
      return undefined;
    }

    // An `AbortController` rather than a captured boolean, so a guard that
    // follows an `await` is a real check rather than something a reader — or a
    // linter — can prove is constant.
    const scope = new AbortController();
    const cancelled = () => scope.signal.aborted;
    let joined: Room | undefined;
    setState('connecting');

    const open = async () => {
      // Asked for per encounter and never held. The server re-composes
      // eligibility on every issuance, so a block landing between the match and
      // here refuses the credential — which is the whole reason this is not
      // cached.
      const authorization = await api.joinAuthorization(callId);
      if (cancelled()) return;
      if (!isOk(authorization)) {
        setState('failed');
        return;
      }
      const transport = authorization.value.transport;
      if (transport === undefined) {
        // A session exists and nothing is carrying it. Reported as a failure
        // rather than a pending connection, because a spinner that never
        // resolves is the least honest thing this screen could show.
        setState('failed');
        return;
      }

      // Imported here rather than at module scope. The SDK reaches for browser
      // APIs on load, and this surface is server-rendered first; a static import
      // would run that during the render pass.
      const { Room: LiveKitRoom } = await import('livekit-client');
      if (cancelled()) return;
      const opened = new LiveKitRoom({
        // Adaptive streaming and dynacast both need a subscriber the SDK can
        // observe. This is one remote participant on one full-bleed stage, so
        // neither buys anything and both add a way for the picture to be
        // degraded for reasons nobody can see.
        adaptiveStream: false,
        dynacast: false,
      });
      joined = opened;

      opened
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (cancelled()) return;
          // A *new* stream every time, rather than a mutated one.
          //
          // React bails out of a state update that returns the same reference,
          // so adding a second track to the stream already in state changes
          // nothing that anything downstream can observe — and the element that
          // mounts when the first video track arrives is then never handed the
          // stream at all. Audio arriving before video is the ordinary case,
          // which is why this looked like "a video element with no picture"
          // rather than like nothing working.
          setRemoteStream((current) => {
            const next = new MediaStream(current?.getTracks() ?? []);
            next.addTrack(track.mediaStreamTrack);
            return next;
          });
          if (track.kind === Track.Kind.Video) setPeerVideo(true);
          if (track.kind === Track.Kind.Audio) setPeerAudio(true);
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (cancelled()) return;
          setRemoteStream((current) => {
            if (current === undefined) return current;
            const remaining = current
              .getTracks()
              .filter((existing) => existing !== track.mediaStreamTrack);
            return remaining.length === 0
              ? undefined
              : new MediaStream(remaining);
          });
          if (track.kind === Track.Kind.Video) setPeerVideo(false);
          if (track.kind === Track.Kind.Audio) setPeerAudio(false);
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          if (cancelled()) return;
          // The other person's media is gone. The *encounter* is not over —
          // that is the server's decision, arriving through the authoritative
          // read — so this reports an absence of media and nothing more.
          clearRemote();
        })
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
          if (connection === ConnectionState.Disconnected) {
            // Not `failed`: a disconnect after a deliberate end is ordinary,
            // and the encounter's own state is what says whether anything is
            // wrong. The cleanup below has already run in that case.
            clearRemote();
          }
        });

      try {
        await opened.connect(transport.url, authorization.value.credential);
      } catch {
        if (cancelled()) return;
        setState('failed');
        return;
      }
      if (cancelled()) {
        // Next was pressed while the connection was being established. The room
        // that arrived is disconnected immediately rather than stored, which is
        // the one window in which a room can outlive the encounter it was for.
        await opened.disconnect();
        return;
      }
      active.current = opened;
      setRoom(opened);
      setState('connected');
    };
    void open();

    return () => {
      scope.abort();
      const open_ = joined ?? active.current;
      active.current = undefined;
      setRoom(undefined);
      clearRemote();
      setState('idle');
      // Fire and forget: a component going away must not wait on a network
      // teardown, and the provider closes the room on its own timeout even if
      // this never lands.
      void open_?.disconnect();
    };
  }, [api, callId, carried, clearRemote]);

  /**
   * Publishes the preview's tracks into the joined room, once there is one.
   *
   * Separate from the connect effect on purpose. The devices can be granted
   * after the room is joined, revoked mid-encounter, or reacquired when a
   * hidden tab comes back — and each of those is a change to what is published
   * rather than a reason to rebuild the connection.
   */
  useEffect(() => {
    if (room === undefined || localStream === undefined) return undefined;
    const joined = room;

    const scope = new AbortController();
    const published: MediaStreamTrack[] = [];
    const publish = async () => {
      for (const track of localStream.getTracks()) {
        if (scope.signal.aborted) return;
        try {
          await joined.localParticipant.publishTrack(track, {
            /*
             * The source, stated rather than inferred.
             *
             * The credential permits exactly two sources, because a live
             * encounter is two people looking at each other and a screen share
             * is content nobody agreed to be shown. A provider that is told
             * which sources are permitted enforces it against the source a
             * track *declares* — and a raw `MediaStreamTrack` declares none,
             * so publishing one without this is refused as "insufficient
             * permissions to publish", by the provider, correctly.
             *
             * That refusal is silent on this side: the room stays joined, the
             * surface stays connected, and nothing is ever carried. It was
             * found by connecting two browsers to a real media server, and it
             * is not reachable from any simulated adapter.
             */
            source:
              track.kind === 'video'
                ? Track.Source.Camera
                : Track.Source.Microphone,
          });
          published.push(track);
        } catch {
          // One track failing is not the call failing. A device that will not
          // publish leaves the other one carrying the encounter, which is a
          // better outcome than tearing down a working audio path because a
          // camera refused.
        }
      }
    };
    void publish();

    return () => {
      scope.abort();
      for (const track of published) {
        // Never `stopOnUnpublish`. These tracks belong to the preview, which
        // releases them; stopping them here would turn a reconnect into a dead
        // camera.
        void joined.localParticipant.unpublishTrack(track, false);
      }
    };
  }, [localStream, room]);

  /**
   * Tells the other side about mute, rather than sending silence.
   *
   * Disabling a track locally produces black frames and silence, which are
   * indistinguishable from a frozen connection at the far end. Muting the
   * publication is what makes "their camera is off" a fact the peer's client
   * can render.
   */
  useEffect(() => {
    if (room === undefined) return;
    for (const publication of room.localParticipant.trackPublications.values()) {
      const wanted =
        publication.kind === Track.Kind.Video
          ? options.cameraOn
          : options.microphoneOn;
      if (publication.isMuted === !wanted) continue;
      void (wanted ? publication.unmute() : publication.mute());
    }
  }, [options.cameraOn, options.microphoneOn, room]);

  return { peerAudio, peerVideo, remoteStream, state };
}
