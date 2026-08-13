import {
  createVeloraApiClient,
  type MobileTokenResponse,
} from '@velora/api-client';

import type { SecureTokenStore, StoredMobileTokens } from './secure-storage';

/**
 * Consumer Mobile session manager.
 *
 * The refresh token is single-use, so two concurrent requests that both see an
 * expired access token must not both try to rotate it: the second exchange
 * would present an already-consumed token and, by ADR-0017, revoke the family.
 * Every rotation therefore goes through one in-flight promise, and every
 * request in the burst awaits that same promise.
 */

export type MobileAuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'authenticated'; readonly accountId: string }
  | {
      readonly status: 'unauthenticated';
      readonly cause: 'initial' | 'signed_out' | 'session_ended';
    }
  | { readonly status: 'unavailable' };

export const initialMobileAuthState: MobileAuthState = { status: 'loading' };

export interface MobileAuthManager {
  /** A valid access token, refreshing at most once across concurrent callers. */
  accessToken(): Promise<string | undefined>;
  readonly refreshExchanges: number;
  restore(): Promise<MobileAuthState>;
  signIn(input: {
    readonly installationId: string;
    readonly subject: string;
  }): Promise<MobileAuthState>;
  signOut(): Promise<MobileAuthState>;
  signOutEverywhere(): Promise<MobileAuthState>;
  readonly state: MobileAuthState;
}

const accessTokenSafetyMarginMilliseconds = 30_000;

function stored(
  tokens: MobileTokenResponse,
  installationId: string,
): StoredMobileTokens {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    installationId,
    refreshToken: tokens.refreshToken,
  };
}

export function createMobileAuthManager(options: {
  readonly apiBaseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly store: SecureTokenStore;
}): MobileAuthManager {
  const api = createVeloraApiClient(options.apiBaseUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const now = options.now ?? (() => new Date());
  let state: MobileAuthState = initialMobileAuthState;
  let held: StoredMobileTokens | undefined;
  let inFlight: Promise<StoredMobileTokens | undefined> | undefined;
  let exchanges = 0;

  const forget = async (
    cause: Extract<MobileAuthState, { status: 'unauthenticated' }>['cause'],
  ): Promise<MobileAuthState> => {
    held = undefined;
    await options.store.clear();
    state = { cause, status: 'unauthenticated' };
    return state;
  };

  const remember = async (
    tokens: MobileTokenResponse,
    installationId: string,
  ): Promise<MobileAuthState> => {
    const next = stored(tokens, installationId);
    held = next;
    try {
      await options.store.write(next);
    } catch {
      // The session is usable for this launch, but it will not survive a
      // restart. That is reported rather than hidden.
      state = { status: 'unavailable' };
      return state;
    }
    state = { accountId: tokens.accountId, status: 'authenticated' };
    return state;
  };

  const isFresh = (tokens: StoredMobileTokens): boolean =>
    new Date(tokens.accessTokenExpiresAt).getTime() - now().getTime() >
    accessTokenSafetyMarginMilliseconds;

  const rotate = async (
    current: StoredMobileTokens,
  ): Promise<StoredMobileTokens | undefined> => {
    exchanges += 1;
    let result;
    try {
      result = await api.POST('/v1/auth/mobile/refresh', {
        body: { refreshToken: current.refreshToken },
      });
    } catch {
      // A transport failure is not an answer about the token. Local material is
      // kept so a device that went offline does not have to re-authenticate.
      state = { status: 'unavailable' };
      return undefined;
    }
    if (result.data === undefined) {
      // Unknown, expired, revoked, and replayed are one answer by design. The
      // only safe response is to drop local material and re-authenticate.
      await forget('session_ended');
      return undefined;
    }
    await remember(result.data, current.installationId);
    return held;
  };

  const revoke = async (
    path: '/v1/auth/logout' | '/v1/auth/logout-all',
  ): Promise<MobileAuthState> => {
    // Refresh first when the access token has aged out, so signing out actually
    // revokes the family server-side instead of sending a token the server will
    // refuse.
    const token = await accessToken();
    if (token !== undefined) {
      try {
        await api.POST(path, { headers: { authorization: `Bearer ${token}` } });
      } catch {
        // The server was not reached, so the family may still be live until it
        // expires. Local material is dropped anyway: the user asked to sign out
        // on this device, and keeping a usable token would be worse.
      }
    }
    return forget('signed_out');
  };

  const accessToken = async (): Promise<string | undefined> => {
    const current = held ?? (await options.store.read());
    if (current === undefined) return undefined;
    held = current;
    if (isFresh(current)) return current.accessToken;

    // Single flight. Concurrent callers share one exchange, so a burst of
    // expired-token requests can never replay a rotated refresh token, which
    // the server would answer by revoking the whole family.
    inFlight ??= rotate(current).finally(() => {
      inFlight = undefined;
    });
    return (await inFlight)?.accessToken;
  };

  return {
    accessToken,

    get refreshExchanges() {
      return exchanges;
    },

    async restore() {
      const current = await options.store.read();
      if (current === undefined) return forget('initial');
      held = current;
      const token = await accessToken();
      if (token === undefined) return state;
      let result;
      try {
        result = await api.GET('/v1/auth/session', {
          headers: { authorization: `Bearer ${token}` },
        });
      } catch {
        // Offline launch: the stored session is kept and the surface says the
        // service could not be reached, rather than claiming the user is out.
        state = { status: 'unavailable' };
        return state;
      }
      if (result.data === undefined) return forget('session_ended');
      state = { accountId: result.data.accountId, status: 'authenticated' };
      return state;
    },

    async signIn(input) {
      let result;
      try {
        result = await api.POST('/v1/auth/local/mobile-sessions', {
          body: {
            installationId: input.installationId,
            subject: input.subject,
          },
        });
      } catch {
        state = { status: 'unavailable' };
        return state;
      }
      if (result.data === undefined) {
        return forget('initial');
      }
      return remember(result.data, input.installationId);
    },

    async signOut() {
      return revoke('/v1/auth/logout');
    },

    async signOutEverywhere() {
      return revoke('/v1/auth/logout-all');
    },

    get state() {
      return state;
    },
  };
}
