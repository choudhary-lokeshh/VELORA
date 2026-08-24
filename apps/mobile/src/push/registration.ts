import type { ConsumerApi } from '@velora/consumer-client';

import type { InstallationIdentity } from '../device/installation';
import type { PermissionState } from '../device/permissions';
import type { DevicePushTokenSource } from './token';

/**
 * This device's push registration, and its whole life.
 *
 * The contract is small — register a token against an installation, revoke by
 * installation — and almost every defect in a push client lives in the order
 * these two calls happen in rather than in either call. The ones this is built
 * to survive, each of which is a test:
 *
 * - **A token rotation arriving during sign-out.** The provider hands over a
 *   new token while the revocation is in flight. Registering it would put a
 *   live registration back on an account that has just signed out, and the
 *   next notice would ring a phone that nobody is signed in on. Every
 *   registration is stamped with the generation it belongs to and a stale one
 *   is dropped rather than sent.
 * - **Registering the same token repeatedly.** The server treats a repeat as a
 *   heartbeat rather than a second device, so it is safe — but doing it on
 *   every foreground is a request per glance at the phone for no new fact, so
 *   a token that has not changed is not re-sent.
 * - **Two callers at once.** A foreground revalidation and a sign-in can land
 *   in the same frame. One in-flight registration is shared, exactly as the
 *   session manager shares one token rotation.
 * - **Losing the network mid-registration.** Reported and left retryable. It
 *   is retried when the application next comes to the foreground, not on a
 *   timer that would spend a battery.
 * - **Signing out with no token.** Revocation names the *installation*, never
 *   the token, so signing out stops delivery even when the token can no longer
 *   be obtained — permission withdrawn, keystore unopenable, provider retired.
 *
 * What this module never does is claim delivery. Registering a token proves
 * that a token exists and that the server has it. It proves nothing about
 * whether any notification will ever arrive, which needs an approved provider
 * that VELORA does not have.
 */

export type PushRegistrationState =
  /** Nobody is signed in, so there is nothing to register. */
  | { readonly status: 'idle' }
  | { readonly status: 'working' }
  /** Registered with the server. Not a claim that anything will be delivered. */
  | { readonly status: 'registered'; readonly devices: number }
  /** Android has not granted `POST_NOTIFICATIONS`, or will not be asked again. */
  | {
      readonly status: 'permission_required';
      readonly permission: PermissionState;
    }
  /** No provider is configured in this build, so no token exists to register. */
  | { readonly status: 'provider_unavailable'; readonly detail: string }
  | { readonly status: 'failed'; readonly detail: string };

export const initialPushRegistrationState: PushRegistrationState = {
  status: 'idle',
};

export interface PushRegistrar {
  /**
   * Brings the registration up to date for a signed-in account.
   *
   * `requestPermission` is false by default so that a launch never produces an
   * unexplained system prompt; a screen that has explained itself passes true.
   */
  ensure(options?: {
    readonly requestPermission?: boolean;
  }): Promise<PushRegistrationState>;
  /** Takes this installation off the record and stops watching for rotations. */
  revoke(): Promise<PushRegistrationState>;
  readonly state: PushRegistrationState;
  /** Starts watching for provider token rotations. Returns an unsubscribe. */
  watch(): () => void;
}

export function createPushRegistrar(options: {
  readonly api: ConsumerApi;
  readonly installation: InstallationIdentity;
  readonly onStateChange?: (state: PushRegistrationState) => void;
  readonly source: DevicePushTokenSource;
}): PushRegistrar {
  let state: PushRegistrationState = initialPushRegistrationState;
  let registeredToken: string | undefined;
  let inFlight: Promise<PushRegistrationState> | undefined;
  /**
   * Bumped by every revocation. A registration that was started before the
   * bump refuses to publish its result, which is what closes the rotation
   * during sign-out.
   */
  let generation = 0;

  const settle = (next: PushRegistrationState): PushRegistrationState => {
    state = next;
    options.onStateChange?.(next);
    return next;
  };

  const send = async (token: string, era: number) => {
    const installationId = await options.installation.current();
    const result = await options.api.registerPushDevice({
      installationId,
      platform: 'android',
      token,
    });
    if (era !== generation) {
      // Signed out while this was in flight. The registration this created is
      // undone rather than reported, so the server is not left addressing a
      // device whose person has left.
      await options.api.revokePushDevice(installationId).catch(() => undefined);
      return state;
    }
    if (result.kind !== 'ok') {
      registeredToken = undefined;
      return settle({
        detail:
          result.kind === 'unauthenticated'
            ? 'The session ended before this device could be registered.'
            : 'This device could not be registered for notifications.',
        status: 'failed',
      });
    }
    registeredToken = token;
    return settle({
      devices: result.value.devices.length,
      status: 'registered',
    });
  };

  const perform = async (requestPermission: boolean) => {
    const era = generation;
    settle({ status: 'working' });
    const acquired = await options.source.acquire({ requestPermission });
    if (era !== generation) return state;

    switch (acquired.kind) {
      case 'acquired': {
        // A token the server already has is a heartbeat nobody asked for.
        if (acquired.token === registeredToken) {
          return state.status === 'registered'
            ? state
            : settle({ devices: 1, status: 'registered' });
        }
        return send(acquired.token, era);
      }
      case 'permission_required':
        registeredToken = undefined;
        return settle({
          permission: acquired.permission,
          status: 'permission_required',
        });
      case 'provider_unconfigured':
        registeredToken = undefined;
        return settle({
          detail: acquired.detail,
          status: 'provider_unavailable',
        });
      case 'unsupported':
        registeredToken = undefined;
        return settle({
          detail: acquired.detail,
          status: 'provider_unavailable',
        });
      case 'failed':
      default:
        registeredToken = undefined;
        return settle({ detail: acquired.detail, status: 'failed' });
    }
  };

  return {
    async ensure(request) {
      // One in-flight attempt, shared. Two callers in the same frame must not
      // produce two registrations of the same device.
      inFlight ??= perform(request?.requestPermission ?? false).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },

    async revoke() {
      generation += 1;
      registeredToken = undefined;
      const installationId = await options.installation.current();
      // The answer is not inspected and a failure is not surfaced. Signing out
      // must clear local state whether or not the server was reachable, in
      // exactly the way the session manager already drops token material it
      // could not revoke — leaving a usable registration on the device would
      // be the worse outcome.
      await options.api.revokePushDevice(installationId).catch(() => undefined);
      return settle({ status: 'idle' });
    },

    get state() {
      return state;
    },

    watch() {
      return options.source.watch((rotated) => {
        if (rotated === registeredToken) return;
        // A rotation is only worth acting on for an account that is registered.
        // Rotating into an idle or refused state would register a device
        // nobody asked to be reachable on.
        if (state.status !== 'registered') return;
        const era = generation;
        void send(rotated, era).catch(() => undefined);
      });
    },
  };
}
