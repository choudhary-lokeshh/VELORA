'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The browser's camera and microphone, as a product state rather than an API.
 *
 * Four rules shape this, and each is a thing that goes wrong when it is left to
 * the component.
 *
 * **Nothing opens without an intent.** Loading a page is not consent to be
 * seen, so this hook holds still until `enabled` becomes true — which happens
 * when somebody presses a control that says what it is about to do. There is no
 * path from a render to a camera.
 *
 * **Every device is released when it is not being used.** Leaving `stop()` to a
 * component means the one code path somebody forgets is the one that leaves a
 * camera light on in a background tab. So this releases on teardown, on the
 * page being hidden, and on the page going away — and reacquires when the page
 * comes back, which costs nothing once permission has been granted.
 *
 * **Muting is remembered across a reacquisition.** Somebody who muted
 * themselves and then switched tabs must not come back unmuted. The remembered
 * intent is applied to the new tracks rather than the tracks being trusted to
 * carry it, because they are new tracks.
 *
 * **A refusal is a state, not an exception.** Denied, blocked, and "this
 * browser has no camera" lead to three different things a person should do, so
 * they are three values rather than one error string, and none of them traps
 * anybody: the surface stays usable and offers the way out that actually
 * applies.
 */

/**
 * What the browser has said, in the states that lead somewhere different.
 *
 * `denied` is answerable by asking again — the person dismissed the prompt, or
 * has not answered it yet. `blocked` is a decision the browser is holding on to
 * and will not re-prompt for, which only the site settings can change, so a
 * surface offering "try again" there has built a button that does nothing.
 * `unavailable` is a device or a build with no camera at all, where there is
 * nothing for anybody to do and no settings link to offer.
 */
export type LiveMediaPermission =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable'
  | 'failed';

export interface LiveMediaState {
  /** Whether the camera track is currently sending frames. */
  readonly cameraOn: boolean;
  /** True once a camera track has ever been granted on this device. */
  readonly hasCamera: boolean;
  /** True once a microphone track has ever been granted on this device. */
  readonly hasMicrophone: boolean;
  readonly microphoneOn: boolean;
  readonly permission: LiveMediaPermission;
  /** Whether more than one camera exists, so the switch control is truthful. */
  readonly switchable: boolean;
  readonly stream: MediaStream | undefined;
  /** Releases every device now. Safe to call when nothing is open. */
  readonly release: () => void;
  readonly switchCamera: () => void;
  readonly toggleCamera: () => void;
  readonly toggleMicrophone: () => void;
}

export interface LiveMediaOptions {
  /**
   * Whether the person has asked for their devices to be open.
   *
   * The only thing that opens a camera. It is a prop rather than a method so a
   * component cannot open one and forget to close it: turning it off is the
   * same gesture as turning it on.
   */
  readonly enabled: boolean;
  /** Whether the microphone is asked for at all. Voice-only still needs it. */
  readonly wantsAudio?: boolean;
  /** Whether the camera is asked for at all. */
  readonly wantsVideo?: boolean;
}

/**
 * Reads a `getUserMedia` rejection into one of the four states above.
 *
 * The names are the ones the specification fixes, and they are checked rather
 * than the message, because a message is localized, differs per browser, and is
 * exactly the string somebody eventually matched on.
 */
function permissionFromError(error: unknown): LiveMediaPermission {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String(error.name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    // The specification does not distinguish "dismissed once" from "blocked for
    // this site", and browsers report both as this. `denied` is the honest
    // reading, and the surface offers both asking again and the settings route
    // rather than guessing which applies.
    return 'denied';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'unavailable';
  }
  // NotReadableError, AbortError, and anything a future browser invents. The
  // device exists and could not be opened — another application is holding it,
  // or the driver failed — and asking again is a reasonable thing to offer.
  return 'failed';
}

function stopStream(stream: MediaStream | undefined): void {
  if (stream === undefined) return;
  for (const track of stream.getTracks()) track.stop();
}

/**
 * The capture API, when this runtime has one.
 *
 * The DOM types declare `navigator.mediaDevices` as always present, and it is
 * absent in three situations this surface genuinely meets: an insecure origin,
 * a test renderer, and a browser old enough not to have it. Read through an
 * explicitly optional shape so the guard below is a real check rather than one
 * the type system believes is dead — which is how a `TypeError` reaches a
 * person instead of a sentence explaining what is missing.
 */
function captureDevices(): MediaDevices | undefined {
  const candidate = (globalThis as { navigator?: Navigator }).navigator
    ?.mediaDevices;
  return typeof candidate?.getUserMedia === 'function' ? candidate : undefined;
}

/** The document, on the same terms and for the same reason. */
function pageDocument(): Document | undefined {
  return (globalThis as { document?: Document }).document;
}

export function useLiveMedia(options: LiveMediaOptions): LiveMediaState {
  const wantsAudio = options.wantsAudio ?? true;
  const wantsVideo = options.wantsVideo ?? true;

  const [stream, setStream] = useState<MediaStream | undefined>(undefined);
  const [permission, setPermission] = useState<LiveMediaPermission>('idle');
  const [cameraOn, setCameraOn] = useState(true);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [hasCamera, setHasCamera] = useState(false);
  const [hasMicrophone, setHasMicrophone] = useState(false);
  const [switchable, setSwitchable] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  /**
   * Bumped whenever the devices should be opened again with the same intent.
   *
   * Switching cameras changes `facing`; coming back from a hidden tab changes
   * nothing except that the tracks were stopped. Both need the acquisition
   * effect to run again, and a counter is what lets the second say so without
   * inventing a fake constraint change.
   */
  const [attempt, setAttempt] = useState(0);

  // The live stream, held in a ref as well as in state, because teardown runs
  // from an effect cleanup and from an event listener — neither of which can
  // read the state value it was rendered with without capturing a stale one.
  const active = useRef<MediaStream | undefined>(undefined);
  // What the person has decided about each device. Applied to whatever tracks
  // exist, so a reacquisition after a hidden tab restores their choice rather
  // than the browser's default. This is the whole of "never silently unmute".
  const intent = useRef({ camera: true, microphone: true });
  const facingRef = useRef(facing);
  facingRef.current = facing;

  const release = useCallback(() => {
    stopStream(active.current);
    active.current = undefined;
    setStream(undefined);
  }, []);

  /** Applies the remembered intent to whatever tracks are open right now. */
  const applyIntent = useCallback((target: MediaStream | undefined) => {
    if (target === undefined) return;
    for (const track of target.getVideoTracks()) {
      track.enabled = intent.current.camera;
    }
    for (const track of target.getAudioTracks()) {
      track.enabled = intent.current.microphone;
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      release();
      setPermission('idle');
      return undefined;
    }

    const devices = captureDevices();
    if (devices === undefined) {
      // No `mediaDevices` at all: an insecure origin, a very old browser, or a
      // test renderer. Reported rather than thrown, because the rest of live
      // discovery — searching, chat, Connect, Next — still works without it.
      setPermission('unavailable');
      return undefined;
    }

    // An `AbortController` rather than a captured boolean, because the guards
    // below run after an `await` and a plain flag reads as a constant to
    // anything analysing this function — including the linter, and including
    // whoever removes one of the guards next year believing it dead.
    const attemptScope = new AbortController();
    // Read through a call rather than as a property, so a check that follows an
    // `await` is a real check. A property read is narrowed by an earlier one
    // and stays narrowed across the awaits below, which turns the guards after
    // them into code that looks dead and behaves as though it is.
    const cancelled = () => attemptScope.signal.aborted;
    setPermission('requesting');

    const open = async () => {
      try {
        const opened = await devices.getUserMedia({
          audio: wantsAudio,
          ...(wantsVideo
            ? { video: { facingMode: facingRef.current } }
            : { video: false }),
        });
        if (cancelled()) {
          // The effect was torn down while the prompt was open. The stream that
          // arrived is stopped immediately rather than stored, which is the one
          // window in which a camera can be left on by a component that
          // unmounted.
          stopStream(opened);
          return;
        }
        stopStream(active.current);
        active.current = opened;
        applyIntent(opened);
        setStream(opened);
        setHasCamera(opened.getVideoTracks().length > 0);
        setHasMicrophone(opened.getAudioTracks().length > 0);
        setPermission('granted');

        // Asked only after permission is granted, because before that the
        // enumeration is deliberately empty of labels and counts on most
        // browsers — and a switch control offered on a device with one camera
        // is a control that does nothing.
        try {
          const all = await devices.enumerateDevices();
          if (!cancelled()) {
            setSwitchable(
              all.filter((device) => device.kind === 'videoinput').length > 1,
            );
          }
        } catch {
          // An enumeration this browser refuses tells us nothing, so the
          // control stays hidden rather than being offered on a guess.
          if (!cancelled()) setSwitchable(false);
        }
      } catch (error) {
        if (cancelled()) return;
        release();
        setPermission(permissionFromError(error));
      }
    };
    void open();

    return () => {
      attemptScope.abort();
      release();
    };
    // `facing` participates: switching cameras is a reacquisition with a
    // different constraint, and the remembered intent is reapplied to the new
    // tracks by `applyIntent`.
  }, [
    applyIntent,
    attempt,
    facing,
    options.enabled,
    release,
    wantsAudio,
    wantsVideo,
  ]);

  /**
   * Releases while the page is hidden, and asks again when it comes back.
   *
   * A camera that keeps running in a background tab is a camera nobody
   * remembers is running. Reacquiring costs a `getUserMedia` call that no
   * longer prompts, because permission has already been granted for this
   * origin — so the only thing a person notices is that the indicator goes out
   * when they leave.
   *
   * Both directions go through the same `attempt` counter the acquisition
   * effect depends on, so there is exactly one code path that opens a camera
   * and it is the one with the cancellation guard in it.
   */
  useEffect(() => {
    if (!options.enabled) return undefined;
    const document_ = pageDocument();
    if (document_ === undefined) return undefined;

    const onVisibility = () => {
      if (document_.visibilityState === 'hidden') {
        release();
        return;
      }
      setAttempt((current) => current + 1);
    };
    const onPageHide = () => {
      release();
    };
    document_.addEventListener('visibilitychange', onVisibility);
    globalThis.addEventListener('pagehide', onPageHide);
    return () => {
      document_.removeEventListener('visibilitychange', onVisibility);
      globalThis.removeEventListener('pagehide', onPageHide);
    };
  }, [options.enabled, release]);

  const toggleCamera = useCallback(() => {
    intent.current = {
      ...intent.current,
      camera: !intent.current.camera,
    };
    setCameraOn(intent.current.camera);
    for (const track of active.current?.getVideoTracks() ?? []) {
      track.enabled = intent.current.camera;
    }
  }, []);

  const toggleMicrophone = useCallback(() => {
    intent.current = {
      ...intent.current,
      microphone: !intent.current.microphone,
    };
    setMicrophoneOn(intent.current.microphone);
    for (const track of active.current?.getAudioTracks() ?? []) {
      track.enabled = intent.current.microphone;
    }
  }, []);

  /**
   * Asks for the other camera.
   *
   * A reacquisition rather than a constraint change, because `applyConstraints`
   * is not supported for a facing change on every browser and a failed
   * constraint change leaves the old track running with no signal that anything
   * happened. Reopening is slower and always tells the truth.
   */
  const switchCamera = useCallback(() => {
    setFacing((current) => (current === 'user' ? 'environment' : 'user'));
  }, []);

  return {
    cameraOn,
    hasCamera,
    hasMicrophone,
    microphoneOn,
    permission,
    release,
    switchCamera,
    switchable,
    stream,
    toggleCamera,
    toggleMicrophone,
  };
}
