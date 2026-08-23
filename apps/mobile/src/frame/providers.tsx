import type { ConsumerApi } from '@velora/consumer-client';
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
  readonly busy: boolean;
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
}

export function ConsumerProviders({
  apiBaseUrl,
  children,
  fetchImplementation,
  store,
  unavailable,
}: {
  readonly apiBaseUrl?: string;
  readonly children: ReactNode;
  readonly fetchImplementation?: typeof globalThis.fetch;
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
      return {
        api: createMobileConsumerApi({
          apiBaseUrl: resolved,
          auth,
          ...(fetchImplementation === undefined
            ? {}
            : { fetch: fetchImplementation }),
        }),
        auth,
      };
    } catch {
      return undefined;
    }
  }, [apiBaseUrl, fetchImplementation, store]);

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
  const { api, auth } = wiring;
  const [state, setState] = useState<MobileAuthState>(initialMobileAuthState);
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
      restore,
      signIn: (subject: string) => {
        perform(async () =>
          auth.signIn({ installationId: 'installation-local-device', subject }),
        );
      },
      signOut: () => {
        perform(async () => auth.signOut());
      },
      signOutEverywhere: () => {
        perform(async () => auth.signOutEverywhere());
      },
      signedIn,
      state,
    };
  }, [account, api, auth, busy, restore, run, signedIn, state]);

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
