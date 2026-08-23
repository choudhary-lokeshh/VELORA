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

import type {
  CreatorApi,
  CreatorOnboardingState,
  CreatorProfile,
} from '@velora/creator-client';
import { creatorStage, type CreatorStage } from '@velora/creator-client';

import {
  createCreatorStudioAuthClient,
  type CreatorAuthClient,
} from '../auth/client';
import {
  initialCreatorAuthState,
  reduceCreatorAuth,
  type CreatorAuthState,
} from '../auth/state';
import { createStudioCreatorApi } from '../product/api';
import {
  useResource,
  useRevalidateOnFocus,
  useSingleFlight,
  type Resource,
} from '../product/resource';

/**
 * Everything the workspace knows, and nothing any screen decides.
 *
 * Three things live above the routes because more than one route needs the same
 * answer and asking twice would mean two answers: whether there is a Creator
 * Studio session, where the server says this creator stands, and what the last
 * action reported. Everything else a screen reads for itself.
 *
 * No authorization is cached here. Studio sessions are shorter than consumer
 * ones by policy, so a tab that has been in the background asks again before
 * somebody acts on what it is showing, and a request the server refuses is
 * rendered as a refusal rather than reconciled against whatever this tab last
 * believed.
 */

interface ApiValue {
  readonly api: CreatorApi;
  readonly authClient: CreatorAuthClient;
}

const ApiContext = createContext<ApiValue | undefined>(undefined);

export function useApi(): CreatorApi {
  const value = useContext(ApiContext);
  if (value === undefined) {
    throw new Error('useApi used outside StudioProviders');
  }
  return value.api;
}

export interface SessionValue {
  readonly auth: CreatorAuthState;
  readonly busy: boolean;
  /** False until the first session answer has arrived. */
  readonly known: boolean;
  /** Re-reads session state from the server. */
  readonly refresh: () => void;
  readonly signIn: (subject: string) => void;
  readonly signedIn: boolean;
  readonly signOut: () => void;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === undefined) {
    throw new Error('useSession used outside StudioProviders');
  }
  return value;
}

export interface CreatorValue {
  /**
   * True while the capability may actually operate. Not an authorization — the
   * server decides every write — but the difference between offering a control
   * and offering a control that is certain to be refused.
   */
  readonly canWrite: boolean;
  /**
   * True when the creator capability does not exist yet. The server answers the
   * same 404 it answers for a route that is not there, so this is read from the
   * absence the resource reports rather than from an error message.
   */
  readonly needsActivation: boolean;
  readonly onboarding: Resource<CreatorOnboardingState>;
  readonly profile: Resource<CreatorProfile>;
  readonly reloadAll: () => void;
  /** False until there is a session and both reads have answered. */
  readonly settled: boolean;
  readonly stage: CreatorStage;
}

const CreatorContext = createContext<CreatorValue | undefined>(undefined);

export function useCreator(): CreatorValue {
  const value = useContext(CreatorContext);
  if (value === undefined) {
    throw new Error('useCreator used outside StudioProviders');
  }
  return value;
}

export function StudioProviders({
  apiBaseUrl,
  children,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  readonly children: ReactNode;
  /** Injected by tests so the whole journey runs without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const clients = useMemo<ApiValue>(
    () => ({
      api: createStudioCreatorApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
      authClient: createCreatorStudioAuthClient({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
    }),
    [apiBaseUrl, fetchImplementation],
  );

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
    reduceCreatorAuth,
    initialCreatorAuthState,
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

  // A session can end in another tab, on another device, or by expiring.
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
          dispatch({
            outcome: await authClient.logout(),
            type: 'logout-result',
          });
        });
      },
    }),
    [auth, authClient, busy, refresh, run, signedIn],
  );

  return (
    <SessionContext.Provider value={session}>
      <CreatorProvider api={api} enabled={signedIn} onSessionEnded={refresh}>
        {children}
      </CreatorProvider>
    </SessionContext.Provider>
  );
}

/**
 * Where the server says this creator stands.
 *
 * Read once for the whole workspace rather than per screen, because the shell,
 * the gate, and three screens all need the same answer and two components
 * asking the same question separately is two requests and, briefly, two
 * different answers.
 */
function CreatorProvider({
  api,
  children,
  enabled,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  readonly children: ReactNode;
  readonly enabled: boolean;
  readonly onSessionEnded: () => void;
}) {
  const loadOnboarding = useCallback(async () => api.onboarding(), [api]);
  const loadProfile = useCallback(async () => api.profile(), [api]);

  const onboarding = useResource<CreatorOnboardingState>(loadOnboarding, {
    enabled,
    onUnauthenticated: onSessionEnded,
  });
  const profile = useResource<CreatorProfile>(loadProfile, {
    enabled,
    onUnauthenticated: onSessionEnded,
  });

  const reloadAll = useCallback(() => {
    onboarding.reload();
    profile.reload();
  }, [onboarding, profile]);

  useRevalidateOnFocus(reloadAll);

  const value = useMemo<CreatorValue>(() => {
    // Settled means an answer has arrived, not merely that nothing is in
    // flight. Before there is a session there is nothing to read, and a screen
    // that treated that as "read, and empty" would offer somebody a blank form
    // for the fraction of a second before the session answer lands.
    const settled = enabled && !onboarding.loading && !profile.loading;
    return {
      canWrite: onboarding.value?.account.status === 'active',
      needsActivation: settled && onboarding.missing,
      onboarding,
      profile,
      reloadAll,
      settled,
      stage: creatorStage({
        onboarding: onboarding.value,
        profile: profile.value,
      }),
    };
  }, [enabled, onboarding, profile, reloadAll]);

  return (
    <CreatorContext.Provider value={value}>{children}</CreatorContext.Provider>
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
