import { createCreatorApi, type CreatorApi } from '@velora/creator-client';
import {
  createMediaAddressBook,
  type ConsumerApi,
  type MediaAddressBook,
  type MediaVariant,
} from '@velora/consumer-client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { resolveApiBaseUrl } from '../api';
import { createPlatformSecureTokenStore } from '../auth/secure-storage';
import type { SecureTokenStore } from '../auth/secure-storage';
import {
  createInstallationIdentity,
  createPlatformInstallationStore,
  type InstallationIdentity,
} from '../device/installation';
import {
  createPushRegistrar,
  initialPushRegistrationState,
  type PushRegistrar,
  type PushRegistrationState,
} from '../push/registration';
import {
  createNativeDevicePushTokenSource,
  type DevicePushTokenSource,
} from '../push/token';
import {
  createMobileAuthManager,
  initialMobileAuthState,
  type MobileAuthManager,
  type MobileAuthState,
} from '../auth/session';
import { createMobileConsumerApi } from '../product/api';
import { useAccountState, type AccountState } from '../product/account';
import {
  useResource,
  useRevalidateOnForeground,
  useSingleFlight,
} from '../product/resource';

/**
 * Everything the application knows, and nothing any screen decides.
 *
 * Three things live above the routes because more than one route needs the same
 * answer and asking twice would mean two answers: what session this device
 * holds, what the server says about this account, and what the last action
 * reported. Everything else a screen reads for itself.
 *
 * Nothing here is authorization. The session state decides what is worth
 * rendering; every request behind it is authorized again by the server, and a
 * refusal is rendered as a refusal. A phone is the device most likely to be
 * holding a decision the server has since changed, which is why the account is
 * re-read every time the application is looked at.
 */

export interface TabSignalValue {
  readonly conversations: number;
  readonly notifications: number;
  readonly refresh: () => void;
}

export interface SessionValue {
  readonly account: AccountState;
  readonly api: ConsumerApi;
  readonly auth: MobileAuthManager;
  /** The public creator projection, asked without a credential. */
  readonly creators: CreatorApi;
  readonly busy: boolean;
  /** This installation's identifier, for anything that has to name the device. */
  readonly installation: InstallationIdentity;
  /** Where image references become addresses, shared by every screen. */
  readonly media: MediaAddressBook<MediaVariant>;
  /**
   * What the platform has been told about reaching this device, and what is
   * stopping it. Never a claim that anything will be delivered.
   */
  readonly push: PushRegistrationState;
  /** Asks for the notification permission and registers. Explained first. */
  readonly enablePush: () => void;
  readonly restore: () => void;
  readonly signIn: (subject: string) => void;
  readonly signOut: () => void;
  readonly signOutEverywhere: () => void;
  readonly signedIn: boolean;
  readonly state: MobileAuthState;
}

const SignalContext = createContext<TabSignalValue>({
  conversations: 0,
  notifications: 0,
  refresh: () => undefined,
});

export function useTabSignals(): TabSignalValue {
  return useContext(SignalContext);
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === undefined) {
    throw new Error('useSession used outside ConsumerProviders');
  }
  return value;
}

export function useApi(): ConsumerApi {
  return useSession().api;
}

/**
 * The public creator projection: the directory and a creator's own page.
 *
 * A separate client on purpose. These answers are identical for every
 * requester, so no credential travels with them — attaching a session would
 * collect an identity for no purpose, which is the same reasoning Consumer
 * Web records at its own call site.
 */
export function useCreatorApi(): CreatorApi {
  return useSession().creators;
}

export function useMediaAddressBook(): MediaAddressBook<MediaVariant> {
  return useSession().media;
}

/**
 * The one thing a build can get wrong before any screen renders.
 *
 * `resolveApiBaseUrl` throws when the build carries no usable endpoint, and a
 * throw inside a hook would take the whole application down with a stack trace.
 * It is caught here and reported as a state, because "this build cannot reach
 * VELORA" is something a person can be told and a crash is not.
 */
interface Wiring {
  readonly api: ConsumerApi;
  readonly auth: MobileAuthManager;
  readonly creators: CreatorApi;
  readonly installation: InstallationIdentity;
  /**
   * Where image references become addresses.
   *
   * Above the screens because two of them rendering the same person must not
   * hold two grants for the same photograph, and because signing out has to be
   * able to drop every address at once.
   */
  readonly media: MediaAddressBook<MediaVariant>;
  readonly push: PushRegistrar;
}

export function ConsumerProviders({
  apiBaseUrl,
  children,
  fetchImplementation,
  installation: providedInstallation,
  pushTokenSource,
  store,
  unavailable,
}: {
  readonly apiBaseUrl?: string;
  readonly children: ReactNode;
  readonly fetchImplementation?: typeof globalThis.fetch;
  readonly installation?: InstallationIdentity;
  readonly pushTokenSource?: DevicePushTokenSource;
  readonly store?: SecureTokenStore;
  /** Rendered instead of the product when this build has no endpoint. */
  readonly unavailable: ReactNode;
}) {
  const wiring = useMemo<Wiring | undefined>(() => {
    try {
      const resolved = apiBaseUrl ?? resolveApiBaseUrl();
      const auth = createMobileAuthManager({
        apiBaseUrl: resolved,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
        store: store ?? createPlatformSecureTokenStore(),
      });
      const api = createMobileConsumerApi({
        apiBaseUrl: resolved,
        auth,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      });
      const installation =
        providedInstallation ??
        createInstallationIdentity({
          store: createPlatformInstallationStore(),
        });
      return {
        api,
        auth,
        creators: createCreatorApi({
          apiBaseUrl: resolved,
          ...(fetchImplementation === undefined
            ? {}
            : { fetch: fetchImplementation }),
          transport: { headers: () => Promise.resolve({}) },
        }),
        installation,
        media: createMediaAddressBook<MediaVariant>({
          exchange: async (request) => api.mediaDeliveries(request),
        }),
        push: createPushRegistrar({
          api,
          installation,
          source: pushTokenSource ?? createNativeDevicePushTokenSource(),
        }),
      };
    } catch {
      return undefined;
    }
  }, [
    apiBaseUrl,
    fetchImplementation,
    providedInstallation,
    pushTokenSource,
    store,
  ]);

  if (wiring === undefined) return <>{unavailable}</>;
  return (
    <SessionProvider wiring={wiring}>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}

function SessionProvider({
  children,
  wiring,
}: {
  readonly children: ReactNode;
  readonly wiring: Wiring;
}) {
  const { api, auth, creators, installation, media, push } = wiring;
  const [state, setState] = useState<MobileAuthState>(initialMobileAuthState);
  const [pushState, setPushState] = useState<PushRegistrationState>(
    initialPushRegistrationState,
  );
  // The shared guard, not a local one. A guard held in component state is not a
  // guard: two taps in the same frame both read it as it was before either
  // committed, so both fire — two sessions created for one press.
  const { busy, run } = useSingleFlight();

  const restore = useCallback(() => {
    void auth.restore().then(setState);
  }, [auth]);

  useEffect(restore, [restore]);
  // Coming back to the foreground is the moment a stored session is most likely
  // to have expired behind the application's back.
  useRevalidateOnForeground(restore);

  const signedIn = state.status === 'authenticated';
  const account = useAccountState({
    api,
    enabled: signedIn,
    onSessionEnded: restore,
  });

  /**
   * The push registration, kept in step with the session and with nothing else.
   *
   * It is brought up to date on sign-in and again on every return to the
   * foreground, because a provider can rotate a token while the application is
   * suspended and a registration nobody refreshed addresses a device that no
   * longer answers. `requestPermission` is false here on purpose: a launch
   * must never produce a system prompt nobody asked for, so the first prompt
   * only ever comes from a screen that has explained itself.
   */
  const syncPush = useCallback(() => {
    if (!signedIn) return;
    void push.ensure().then(setPushState);
  }, [push, signedIn]);

  useEffect(syncPush, [syncPush]);
  useRevalidateOnForeground(syncPush);
  useEffect(() => {
    if (!signedIn) return undefined;
    return push.watch();
  }, [push, signedIn]);

  const value = useMemo<SessionValue>(() => {
    const perform = (work: () => Promise<MobileAuthState>) => {
      run(async () => {
        setState(await work());
      });
    };
    return {
      account,
      api,
      auth,
      busy,
      creators,
      media,
      restore,
      enablePush: () => {
        run(async () => {
          setPushState(await push.ensure({ requestPermission: true }));
        });
      },
      installation,
      push: pushState,
      signIn: (subject: string) => {
        perform(async () =>
          auth.signIn({
            installationId: await installation.current(),
            subject,
          }),
        );
      },
      signOut: () => {
        perform(async () => {
          // Before the session is dropped, not after. Revoking needs the
          // access token the sign-out is about to throw away, and a device
          // left registered would keep being addressed for somebody who has
          // signed out of it.
          setPushState(await push.revoke());
          // Every held address is a bearer credential for one of these
          // photographs, and the point of signing out is that this device
          // stops holding them.
          media.clear();
          return auth.signOut();
        });
      },
      signOutEverywhere: () => {
        perform(async () => {
          setPushState(await push.revoke());
          media.clear();
          return auth.signOutEverywhere();
        });
      },
      signedIn,
      state,
    };
  }, [
    account,
    api,
    auth,
    busy,
    creators,
    installation,
    media,
    push,
    pushState,
    restore,
    run,
    signedIn,
    state,
  ]);

  return (
    <SessionContext.Provider value={value}>
      <SignalProvider enabled={signedIn}>{children}</SignalProvider>
    </SessionContext.Provider>
  );
}

/**
 * What is waiting, for the navigation to show.
 *
 * Two small reads rather than a count the screens hand upwards: the tab bar is
 * visible on every destination and a screen that has not been opened has
 * nothing to hand it. They are the first page only, so what the bar shows is
 * "at least this many" rather than a total — which is why it stops counting at
 * a ceiling and says "9+" instead of pretending to a precise number.
 *
 * Nothing polls. They are read once and again when the application comes back
 * to the foreground, which is the only moment either can have changed without
 * this device knowing.
 */
function SignalProvider({
  children,
  enabled,
}: {
  readonly children: ReactNode;
  readonly enabled: boolean;
}) {
  const api = useApi();
  const loadConversations = useCallback(
    async (signal: AbortSignal) => api.conversations({ pageSize: 50 }, signal),
    [api],
  );
  const loadNotifications = useCallback(
    async (signal: AbortSignal) => api.notifications({ pageSize: 50 }, signal),
    [api],
  );
  const conversations = useResource(loadConversations, { enabled });
  const notifications = useResource(loadNotifications, { enabled });

  const refresh = useCallback(() => {
    conversations.reload();
    notifications.reload();
  }, [conversations, notifications]);

  useRevalidateOnForeground(refresh);

  const value = useMemo<TabSignalValue>(
    () => ({
      conversations: (conversations.value?.conversations ?? []).filter(
        (row) => row.lastMessageSequence > row.lastReadSequence,
      ).length,
      notifications: (notifications.value?.notifications ?? []).filter(
        (entry) => entry.readAt === undefined,
      ).length,
      refresh,
    }),
    [conversations.value, notifications.value, refresh],
  );

  return (
    <SignalContext.Provider value={value}>{children}</SignalContext.Provider>
  );
}

/* ------------------------------------------------------------------ toasts */

export type ToastTone = 'positive' | 'critical' | 'neutral';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

export interface ToastValue {
  readonly dismiss: (id: number) => void;
  readonly show: (message: string, tone?: ToastTone) => void;
  readonly toasts: readonly Toast[];
}

const ToastContext = createContext<ToastValue | undefined>(undefined);

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (value === undefined) {
    throw new Error('useToast used outside ToastProvider');
  }
  return value;
}

/**
 * How long a confirmation stays before it clears itself.
 *
 * Long enough to read at arm's length and short enough not to sit over a
 * conversation. A toast is never the only record of anything: everything it
 * reports is also visible in the thing it happened to.
 */
const toastLifetimeMilliseconds = 5000;

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  // A monotonic identifier held outside render, so two toasts raised in the
  // same commit cannot be given the same key.
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, tone: ToastTone = 'neutral') => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((existing) => [...existing, { id, message, tone }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const oldest = toasts[0];
    if (oldest === undefined) return undefined;
    const timer = setTimeout(() => {
      dismiss(oldest.id);
    }, toastLifetimeMilliseconds);
    return () => {
      clearTimeout(timer);
    };
  }, [dismiss, toasts]);

  const value = useMemo<ToastValue>(
    () => ({ dismiss, show, toasts }),
    [dismiss, show, toasts],
  );

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}
