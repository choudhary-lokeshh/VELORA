'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  createMediaAddressBook,
  type ConsumerApi,
  type ConversationList,
  type MediaAddressBook,
  type NotificationList,
} from '@velora/consumer-client';

import {
  createConsumerWebAuthClient,
  type ConsumerWebAuthClient,
} from '../auth/client';
import {
  initialConsumerAuthState,
  reduceConsumerAuth,
  type ConsumerAuthState,
} from '../auth/state';
import { useAccountState, type AccountState } from '../product/account';
import { createWebConsumerApi } from '../product/api';
import {
  useResource,
  useRevalidateOnFocus,
  useSingleFlight,
  type Resource,
} from '../product/resource';

/**
 * Everything the application shell knows, and nothing any screen decides.
 *
 * Four things live above the routes because more than one route needs the same
 * answer and asking twice would mean two answers: whether there is a session,
 * what the server says about this account, what is currently unread, and what
 * the last action reported. Everything else a screen reads for itself.
 *
 * No authorization is cached here. A tab that has been in the background asks
 * again before somebody acts on what it is showing, and a request the server
 * refuses is rendered as a refusal rather than reconciled against whatever this
 * tab last believed.
 */

interface ApiValue {
  readonly api: ConsumerApi;
  readonly authClient: ConsumerWebAuthClient;
  /**
   * Where image references become addresses.
   *
   * Above the routes because two screens rendering the same person must not
   * hold two grants for the same photograph, and because signing out has to be
   * able to drop every address at once.
   */
  readonly media: MediaAddressBook;
}

const ApiContext = createContext<ApiValue | undefined>(undefined);

export function useApi(): ConsumerApi {
  const value = useContext(ApiContext);
  if (value === undefined) {
    throw new Error('useApi used outside VeloraProviders');
  }
  return value.api;
}

export function useMediaAddressBook(): MediaAddressBook {
  const value = useContext(ApiContext);
  if (value === undefined) {
    throw new Error('useMediaAddressBook used outside VeloraProviders');
  }
  return value.media;
}

export interface SessionValue {
  readonly auth: ConsumerAuthState;
  readonly busy: boolean;
  /** Re-reads session state from the server. */
  readonly refresh: () => void;
  readonly signIn: (subject: string) => void;
  readonly signOut: () => void;
  readonly signOutEverywhere: () => void;
  /** False until the first session answer has arrived. */
  readonly known: boolean;
  readonly signedIn: boolean;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === undefined) {
    throw new Error('useSession used outside VeloraProviders');
  }
  return value;
}

const AccountContext = createContext<AccountState | undefined>(undefined);

export function useAccount(): AccountState {
  const value = useContext(AccountContext);
  if (value === undefined) {
    throw new Error('useAccount used outside VeloraProviders');
  }
  return value;
}

export interface FeedsValue {
  readonly conversations: Resource<ConversationList>;
  readonly notifications: Resource<NotificationList>;
  readonly unreadConversations: number;
  readonly unreadNotifications: number;
}

const FeedsContext = createContext<FeedsValue | undefined>(undefined);

export function useFeeds(): FeedsValue {
  const value = useContext(FeedsContext);
  if (value === undefined) {
    throw new Error('useFeeds used outside VeloraProviders');
  }
  return value;
}

/** How many notices the shared first page holds. */
const notificationPageSize = 20;

export function VeloraProviders({
  apiBaseUrl,
  children,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  readonly children: ReactNode;
  /** Injected by tests so the whole journey runs without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const clients = useMemo<ApiValue>(() => {
    const api = createWebConsumerApi({
      apiBaseUrl,
      ...(fetchImplementation === undefined
        ? {}
        : { fetch: fetchImplementation }),
    });
    return {
      api,
      authClient: createConsumerWebAuthClient({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
      media: createMediaAddressBook({ api }),
    };
  }, [apiBaseUrl, fetchImplementation]);

  return (
    <ApiContext.Provider value={clients}>
      <SessionProvider clients={clients}>{children}</SessionProvider>
    </ApiContext.Provider>
  );
}

function SessionProvider({
  children,
  clients,
}: {
  readonly children: ReactNode;
  readonly clients: ApiValue;
}) {
  const { api, authClient } = clients;
  const [auth, dispatch] = useReducer(
    reduceConsumerAuth,
    initialConsumerAuthState,
  );
  const { busy, run } = useSingleFlight();

  const refresh = useCallback(() => {
    void authClient.session().then((outcome) => {
      dispatch({ outcome, type: 'session-result' });
    });
  }, [authClient]);

  // The browser holds no session state of its own, so the first thing this
  // surface does is ask whether the cookie it may be carrying is still live.
  useEffect(refresh, [refresh]);

  // A session can end in another tab, on another device, or by expiring. This
  // tab therefore asks again whenever it becomes the one being looked at.
  useRevalidateOnFocus(refresh);

  const signedIn = auth.status === 'authenticated';

  const session = useMemo<SessionValue>(
    () => ({
      auth,
      busy,
      known: auth.status !== 'loading',
      refresh,
      signedIn,
      signIn: (subject: string) => {
        run(async () => {
          dispatch({
            outcome: await authClient.signIn(subject),
            type: 'sign-in-result',
          });
        });
      },
      signOut: () => {
        run(async () => {
          // Dropped before the request rather than after it. Every held
          // address is a bearer credential for one of these photographs, and
          // the point of signing out is that this browser stops holding them.
          clients.media.clear();
          dispatch({
            outcome: await authClient.logout(),
            type: 'logout-result',
          });
        });
      },
      signOutEverywhere: () => {
        run(async () => {
          clients.media.clear();
          dispatch({
            outcome: await authClient.logoutEverywhere(),
            type: 'logout-everywhere-result',
          });
        });
      },
    }),
    [auth, authClient, busy, clients, refresh, run, signedIn],
  );

  return (
    <SessionContext.Provider value={session}>
      <AccountProvider api={api} enabled={signedIn} onSessionEnded={refresh}>
        {children}
      </AccountProvider>
    </SessionContext.Provider>
  );
}

function AccountProvider({
  api,
  children,
  enabled,
  onSessionEnded,
}: {
  readonly api: ConsumerApi;
  readonly children: ReactNode;
  readonly enabled: boolean;
  readonly onSessionEnded: () => void;
}) {
  const account = useAccountState({ api, enabled, onSessionEnded });
  return (
    <AccountContext.Provider value={account}>
      <FeedsProvider api={api} enabled={enabled}>
        {children}
      </FeedsProvider>
    </AccountContext.Provider>
  );
}

/**
 * Conversations and notices, read once for the whole application.
 *
 * The navigation needs to know whether anything is unread and the two screens
 * need the same lists, so they are read here rather than in each place. Two
 * components asking the same question separately is two requests and, briefly,
 * two different answers.
 */
function FeedsProvider({
  api,
  children,
  enabled,
}: {
  readonly api: ConsumerApi;
  readonly children: ReactNode;
  readonly enabled: boolean;
}) {
  const loadConversations = useCallback(
    async (signal: AbortSignal) => api.conversations({}, signal),
    [api],
  );
  const loadNotifications = useCallback(
    async (signal: AbortSignal) =>
      api.notifications({ pageSize: notificationPageSize }, signal),
    [api],
  );
  const conversations = useResource(loadConversations, { enabled });
  const notifications = useResource(loadNotifications, { enabled });

  const reload = useCallback(() => {
    conversations.reload();
    notifications.reload();
  }, [conversations, notifications]);
  useRevalidateOnFocus(reload);

  const value = useMemo<FeedsValue>(
    () => ({
      conversations,
      notifications,
      unreadConversations: (conversations.value?.conversations ?? []).filter(
        (row) => row.lastMessageSequence > row.lastReadSequence,
      ).length,
      unreadNotifications: (notifications.value?.notifications ?? []).filter(
        (entry) => entry.readAt === undefined,
      ).length,
    }),
    [conversations, notifications],
  );

  return (
    <FeedsContext.Provider value={value}>{children}</FeedsContext.Provider>
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

/** How long a confirmation stays before it clears itself. */
const toastLifetimeMilliseconds = 6000;

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
