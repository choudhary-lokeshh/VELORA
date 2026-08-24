import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  readPermissionState,
  type PermissionState,
} from '../device/permissions';

/**
 * Where a device push token comes from, behind a seam.
 *
 * No push delivery provider is approved for VELORA. That is recorded in
 * `docs/compliance/11-notification-provider-eligibility.md` and it has not
 * changed. What *has* changed is the second, independent blocker beside it:
 * this repository now has a native Android build, so a token can be issued at
 * all. This module resolves that half and no more.
 *
 * The distinction it exists to keep visible is between three different things
 * that all look like "push does not work":
 *
 * - **No permission.** Android 13 and later require `POST_NOTIFICATIONS`, and
 *   a person can refuse it or refuse it permanently. Nothing is wrong.
 * - **No provider configuration.** `expo-notifications` reaches Firebase Cloud
 *   Messaging on Android, and Firebase needs a `google-services.json` this
 *   repository does not have and will not fabricate. Registration fails at the
 *   first call, loudly and locally, and no token is ever produced. That is
 *   fail-closed and it is the state every build is in today.
 * - **Something else went wrong.** A transport failure, a Play Services
 *   version that cannot answer, a device with no Play Services at all.
 *
 * A surface that collapses those into "notifications are off" cannot tell
 * somebody which of them they can do something about.
 *
 * Nothing here names a vendor in a way that leaks upward. The port returns a
 * token or a reason, and the registrar above it neither knows nor cares that
 * Firebase produced one.
 */

export type TokenAcquisition =
  | { readonly kind: 'acquired'; readonly token: string }
  | {
      readonly kind: 'permission_required';
      readonly permission: PermissionState;
    }
  | { readonly kind: 'provider_unconfigured'; readonly detail: string }
  | { readonly kind: 'unsupported'; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string };

export interface DevicePushTokenSource {
  /**
   * Asks for a token, requesting permission first when that is what is
   * missing. Never throws: every failure is one of the answers above.
   */
  acquire(options?: {
    readonly requestPermission?: boolean;
  }): Promise<TokenAcquisition>;
  /** Reads the current permission without asking for it. */
  permission(): Promise<PermissionState>;
  /**
   * Watches for the provider rotating this device's token, which it does on
   * reinstall, on a data clear, and at its own discretion. A rotation that
   * nothing listened for would leave the server addressing a token that no
   * longer resolves, and the notice would be silently undeliverable.
   */
  watch(onRotated: (token: string) => void): () => void;
  readonly kind: string;
}

/**
 * The registration token is a bearer credential for reaching this device, so
 * it is never logged, never rendered, and never put in an error message. Only
 * its shape is ever reported.
 */
function usableToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // The contract bounds a token at 32–4096 characters. A shorter answer is a
  // provider stub or an error string, not a token, and sending it would be a
  // registration that can never receive anything.
  if (trimmed.length < 32 || trimmed.length > 4096) return undefined;
  return trimmed;
}

/**
 * Whether a failure is Firebase saying it was never configured.
 *
 * Matched on the platform's own initialization vocabulary rather than on an
 * exact string, and anything unrecognized falls through to `failed` rather
 * than being reported as "no provider configured" — claiming to know why
 * something failed is worse than saying it failed.
 */
function isProviderUnconfigured(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('firebaseapp is not initialized') ||
    lowered.includes('default firebaseapp') ||
    lowered.includes('google-services.json') ||
    lowered.includes('firebase has not been configured') ||
    lowered.includes('no firebase app')
  );
}

export function createNativeDevicePushTokenSource(): DevicePushTokenSource {
  return {
    kind: 'expo-notifications',

    async acquire(options) {
      if (Platform.OS !== 'android') {
        return {
          detail: 'Android is the only platform this application builds for.',
          kind: 'unsupported',
        };
      }

      let permission: PermissionState;
      try {
        permission = readPermissionState(
          await Notifications.getPermissionsAsync(),
        );
        if (permission !== 'granted' && options?.requestPermission === true) {
          permission = readPermissionState(
            await Notifications.requestPermissionsAsync(),
          );
        }
      } catch (error) {
        return { detail: describe(error), kind: 'failed' };
      }
      if (permission !== 'granted') {
        return { kind: 'permission_required', permission };
      }

      try {
        const issued = await Notifications.getDevicePushTokenAsync();
        const token = usableToken(issued.data);
        if (token === undefined) {
          return {
            detail: 'The provider returned no usable registration token.',
            kind: 'provider_unconfigured',
          };
        }
        return { kind: 'acquired', token };
      } catch (error) {
        const message = describe(error);
        return isProviderUnconfigured(message)
          ? {
              detail:
                'No push provider is configured in this build, so no device ' +
                'token can be issued.',
              kind: 'provider_unconfigured',
            }
          : { detail: message, kind: 'failed' };
      }
    },

    async permission() {
      if (Platform.OS !== 'android') return 'unavailable';
      try {
        return readPermissionState(await Notifications.getPermissionsAsync());
      } catch {
        return 'unavailable';
      }
    },

    watch(onRotated) {
      if (Platform.OS !== 'android') return () => undefined;
      const subscription = Notifications.addPushTokenListener((issued) => {
        const token = usableToken(issued.data);
        if (token !== undefined) onRotated(token);
      });
      return () => {
        subscription.remove();
      };
    },
  };
}

/**
 * The source a build with no provider uses, and the one every deployed
 * environment gets until a provider is approved and configured.
 *
 * It exists so that "there is no provider" is a value rather than an exception
 * path, and so that a test can assert the fail-closed behaviour without a
 * device. It never asks for a permission, because a prompt for a capability
 * that does not exist teaches somebody to grant one for nothing.
 */
export function createUnavailableDevicePushTokenSource(
  detail = 'No push delivery provider is approved for VELORA.',
): DevicePushTokenSource {
  return {
    kind: 'unavailable',
    acquire() {
      return Promise.resolve({ detail, kind: 'provider_unconfigured' });
    },
    permission() {
      return Promise.resolve('unavailable');
    },
    watch() {
      return () => undefined;
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown failure';
}
