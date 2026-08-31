import { useCameraPermissions, type CameraType } from 'expo-camera';
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
 * **Muting is a product state and is never quietly reversed.** There is no
 * microphone here — this build asks for none, because no approved provider
 * carries audio anywhere and asking for a permission the product cannot use
 * would be asking for it under false pretences — so "muted" is what this
 * surface honestly reports and what it keeps across a resume. Nothing turns it
 * back on.
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
   * Always false, and read from here rather than written as a literal in the
   * screen, so the day a provider is approved there is one place that changes.
   * The mute control still exists and is still authoritative over intent — it
   * is what somebody presses to say they do not want to be heard — and the
   * surface says plainly that nothing is carrying audio yet.
   */
  readonly microphoneAvailable: boolean;
  readonly microphoneOn: boolean;
  readonly permission: PermissionState;
  /** Asks Android for the camera. Safe to call when it is already granted. */
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
}): LiveMediaState {
  const [permission, requestPermission] = useCameraPermissions();
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
  }, [requestPermission]);

  // `null` is the state before the module has answered at all, which reads the
  // same way an undetermined permission does: ask. `readPermissionState` draws
  // the four-way distinction, so this only has to hand it the two shapes it
  // knows about.
  const state = readPermissionState(permission ?? undefined);

  return {
    active: options.enabled && foreground && state === 'granted' && cameraOn,
    cameraOn,
    facing,
    microphoneAvailable: false,
    microphoneOn,
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
