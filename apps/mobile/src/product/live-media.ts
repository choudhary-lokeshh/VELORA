import {
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
} from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  openApplicationSettings,
  readPermissionState,
  type PermissionState,
} from '../device/permissions';

/**
 * The camera, as a product state rather than a native module.
 *
 * Four rules shape this, and each is a thing that goes wrong when it is left to
 * the screen.
 *
 * **Nothing opens without an intent.** Opening the Live tab shows a door, not a
 * viewfinder. The permission is asked for when somebody presses a control that
 * says what pressing it will do, and the preview mounts only after that — so
 * there is no path from a navigation to a camera.
 *
 * **The preview closes when the application is not in front.** Android keeps a
 * mounted camera bound while an app is backgrounded, which is a camera nobody
 * remembers is open. `active` is false the moment the app leaves the
 * foreground, which unmounts the view and releases the device; it comes back
 * when the app does, and no permission is re-requested because none was lost.
 *
 * **The preview yields the camera to the provider.** Android gives one client
 * the camera, and `expo-camera`'s preview is a native view rather than a
 * stream, so it cannot be published into a session. Once an encounter is being
 * carried, this preview unmounts and the RTC room opens both devices itself —
 * `yielded` is what says so, and it is set before the room asks rather than
 * after it succeeds, because yielding late is the same as not yielding.
 *
 * **The microphone is asked for on the same terms as the camera, and only
 * after an intent.** This build now carries voice, so a microphone permission
 * is one it can actually use — and it is requested when somebody presses Start,
 * never at launch and never on a render. A refusal narrows the encounter to
 * video rather than stopping it: being seen without being heard is a worse
 * call than a full one and a much better one than none.
 *
 * **Muting is a product state and is never quietly reversed.** Somebody who
 * muted themselves and then backgrounded the application must not come back
 * unmuted, so the intent is held here and applied to whatever is publishing
 * rather than read back off it.
 *
 * **A refusal is a state, not an exception.** `denied` is answerable by asking
 * again; `blocked` is Android refusing to ask again, which only the settings
 * screen can change, so a surface offering "try again" there has built a button
 * that does nothing. The distinction is the one `src/device/permissions.ts`
 * already draws, reused rather than redrawn.
 */

export interface LiveMediaState {
  /** Whether the preview should currently be mounted and bound to the device. */
  readonly active: boolean;
  /** Whether the person has the camera switched on for this session. */
  readonly cameraOn: boolean;
  readonly facing: CameraType;
  /**
   * Whether this build can carry a microphone anywhere.
   *
   * True when the person has granted it, false otherwise — including where they
   * refused, where Android will not ask again, and where no provider is
   * carrying anything. Read from here rather than written as a literal in the
   * screen, so there is one place that decides whether the mute control is
   * describing something real.
   *
   * The mute control still exists and is still authoritative over intent when
   * this is false: it is what somebody presses to say they do not want to be
   * heard, and the surface says plainly that nothing is carrying audio.
   */
  readonly microphoneAvailable: boolean;
  readonly microphoneOn: boolean;
  /** What Android has said about the microphone, in the four states. */
  readonly microphonePermission: PermissionState;
  readonly permission: PermissionState;
  /**
   * Asks Android for the camera and the microphone, in that order.
   *
   * Both, from the one gesture that says what it will do, because a person
   * pressing Start is agreeing to a video call rather than to a camera. Safe to
   * call when either is already granted.
   */
  readonly request: () => Promise<void>;
  /** Opens this application's settings, the only way out of `blocked`. */
  readonly openSettings: () => Promise<boolean>;
  readonly switchCamera: () => void;
  readonly toggleCamera: () => void;
  readonly toggleMicrophone: () => void;
}

export function useLiveMedia(options: {
  /**
   * Whether the person has asked for the camera to be open.
   *
   * The only thing that mounts a preview. A prop rather than a method so a
   * screen cannot open one and forget to close it: turning it off is the same
   * gesture as turning it on.
   */
  readonly enabled: boolean;
  /**
   * Whether a provider has taken the camera for a live encounter.
   *
   * Android hands the camera to one client. While this is true the preview must
   * be unmounted, so `active` is false regardless of everything else — and it
   * is the transport that sets it, before the room asks for the device.
   */
  readonly yielded?: boolean;
}): LiveMediaState {
  const [permission, requestPermission] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [cameraOn, setCameraOn] = useState(true);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [facing, setFacing] = useState<CameraType>('front');
  const [foreground, setForeground] = useState(true);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      // `inactive` is the transitional state a phone passes through when the
      // app switcher opens or a call arrives. It is treated as background,
      // because a camera that stays bound through it is a camera bound behind
      // another application's window.
      setForeground(next === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const request = useCallback(async () => {
    try {
      await requestPermission();
    } catch {
      // A module that refuses to answer is reported through `permission`
      // rather than thrown at a caller. Nothing on this screen except the
      // preview depends on a camera, so a failure here must not stop somebody
      // being matched, chatting, or connecting.
    }
    try {
      // Second, and separately. Android shows one dialog at a time, and a
      // person who refuses the camera should still be asked about the
      // microphone rather than having the question withdrawn — a voice-only
      // encounter is a real thing this product offers.
      await requestMicrophone();
    } catch {
      // Reported through `microphonePermission`, for the same reason.
    }
  }, [requestMicrophone, requestPermission]);

  // `null` is the state before the module has answered at all, which reads the
  // same way an undetermined permission does: ask. `readPermissionState` draws
  // the four-way distinction, so this only has to hand it the two shapes it
  // knows about.
  const state = readPermissionState(permission ?? undefined);
  const microphoneState = readPermissionState(microphone ?? undefined);

  return {
    active:
      options.enabled &&
      foreground &&
      state === 'granted' &&
      cameraOn &&
      // The provider has the camera. Rendering a preview here would be a second
      // client asking Android for a device it has already given away, which
      // fails rather than sharing.
      options.yielded !== true,
    cameraOn,
    facing,
    microphoneAvailable: microphoneState === 'granted',
    microphoneOn,
    microphonePermission: microphoneState,
    openSettings: openApplicationSettings,
    permission: state,
    request,
    switchCamera: useCallback(() => {
      setFacing((current) => (current === 'front' ? 'back' : 'front'));
    }, []),
    toggleCamera: useCallback(() => {
      setCameraOn((current) => !current);
    }, []),
    toggleMicrophone: useCallback(() => {
      setMicrophoneOn((current) => !current);
    }, []),
  };
}
