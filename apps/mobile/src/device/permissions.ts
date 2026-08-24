import { Linking } from 'react-native';

/**
 * What Android has said about a permission, in the four answers that lead to
 * four different things a product should do.
 *
 * The platform APIs report a status and a separate "can this be asked again"
 * flag, and almost every bug in permission handling comes from collapsing the
 * two. `denied` and `blocked` look identical to a naive check and could not be
 * more different to a person: one is answered by asking, and the other can
 * only be answered in the system settings, because Android will not show the
 * dialog again and calling `request` returns `denied` instantly with nothing
 * on screen. A product that keeps calling `request` there has built a button
 * that does nothing.
 *
 * `unavailable` is the fourth: the capability does not exist on this build or
 * this device at all. It is distinct from `blocked` because there is nothing a
 * person can do about it, so the surface must not offer them a settings link.
 */
export type PermissionState = 'granted' | 'denied' | 'blocked' | 'unavailable';

/**
 * The platform's answer, in the shape both `expo-notifications` and
 * `expo-image-picker` return it.
 *
 * Declared here rather than imported so that the interpretation below is
 * testable without either native module, and so that a module changing its
 * exported type does not silently change what `blocked` means.
 */
export interface PlatformPermissionResponse {
  readonly canAskAgain?: boolean;
  readonly granted?: boolean;
  readonly status?: string;
}

/**
 * Reads one platform answer into the four states.
 *
 * `undetermined` is reported as `denied` deliberately: to a caller they mean
 * the same thing — ask — and the distinction only matters to a screen that
 * wants to explain itself first, which asks `wasAsked` instead.
 */
export function readPermissionState(
  response: PlatformPermissionResponse | undefined,
): PermissionState {
  if (response === undefined) return 'unavailable';
  if (response.granted === true || response.status === 'granted') {
    return 'granted';
  }
  if (response.status === 'denied' && response.canAskAgain === false) {
    return 'blocked';
  }
  return 'denied';
}

/** Whether the platform has already put this question to the person. */
export function wasAsked(
  response: PlatformPermissionResponse | undefined,
): boolean {
  return response !== undefined && response.status !== 'undetermined';
}

/**
 * Opens the application's own settings page, which is the only way out of
 * `blocked`.
 *
 * It is a request rather than a guarantee: a device with no settings activity
 * for this intent answers by failing, and that is reported rather than thrown,
 * because a person who cannot reach settings still needs the screen they were
 * on to keep working.
 */
export async function openApplicationSettings(): Promise<boolean> {
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * What a screen should say about a permission it does not have.
 *
 * Kept here rather than in each screen so the same refusal reads the same way
 * everywhere, and so that no screen invents a sentence promising a capability
 * this build does not have.
 */
export function permissionExplanation(
  state: PermissionState,
  capability: 'camera' | 'notifications' | 'photos',
): string | undefined {
  if (state === 'granted') return undefined;
  const subject = {
    camera: 'the camera',
    notifications: 'notifications',
    photos: 'your photos',
  }[capability];
  if (state === 'unavailable') {
    return `This build cannot use ${subject}.`;
  }
  if (state === 'blocked') {
    return `VELORA does not have access to ${subject}. Android will not ask again, so it has to be turned on in Settings.`;
  }
  return `VELORA needs access to ${subject} for this.`;
}
