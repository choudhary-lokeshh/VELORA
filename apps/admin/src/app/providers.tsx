'use client';

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

import { createAdminApi, type AdminApi } from '../api/client';
import type { AdminSession } from '../api/contract';
import {
  useResource,
  useRevalidateOnFocus,
  useSingleFlight,
  type Resource,
} from '../product/resource';

/**
 * Everything the console knows, and nothing any screen decides.
 *
 * Two things live above the routes because more than one route needs the same
 * answer and asking twice would mean two answers: what session this browser
 * actually holds, and what the last operation reported. Everything else a
 * screen reads for itself.
 *
 * No authorization is cached here, and nothing here grants anything. The
 * session read reports what the server said this browser is — its audience and
 * its assurance — so the console can explain a refusal instead of printing one
 * on every panel. Every request behind that is authorized again by the server,
 * and every refusal is rendered as a refusal.
 */

const ApiContext = createContext<AdminApi | undefined>(undefined);

export function useApi(): AdminApi {
  const value = useContext(ApiContext);
  if (value === undefined) {
    throw new Error('useApi used outside AdminProviders');
  }
  return value;
}

export interface SessionValue {
  /**
   * True when the platform answered the session question at all.
   *
   * Distinct from "there is no session", and the distinction is the whole
   * point: this origin is not in the platform's allowed browser origins, so the
   * request does not arrive. A console that read a failed request as "you are
   * signed out" would be stating something it does not know, on the one surface
   * built to never do that.
   */
  readonly answered: boolean;
  readonly appEnvironment: string;
  /**
   * The audience this browser's session belongs to, if it has one at all.
   *
   * Reported rather than trusted. It is what the console uses to say "this is a
   * consumer session" instead of "something went wrong", and it decides
   * nothing: the server refuses a consumer session at every privileged route
   * whatever this says.
   */
  readonly audience: string | undefined;
  readonly assurance: string | undefined;
  readonly busy: boolean;
  /** False until the first session answer has arrived. */
  readonly known: boolean;
  /**
   * True only when the server itself published a Platform Admin audience at
   * phishing-resistant assurance. It gates what is worth rendering and never
   * what is permitted.
   */
  readonly privileged: boolean;
  readonly refresh: () => void;
  readonly session: Resource<AdminSession | undefined>;
  readonly signedIn: boolean;
  readonly signOut: () => void;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === undefined) {
    throw new Error('useSession used outside AdminProviders');
  }
  return value;
}

export function AdminProviders({
  apiBaseUrl,
  appEnvironment = 'local',
  children,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  readonly appEnvironment?: string | undefined;
  readonly children: ReactNode;
  /** Injected by tests so the console runs without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const api = useMemo(
    () =>
      createAdminApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
    [apiBaseUrl, fetchImplementation],
  );

  return (
    <ApiContext.Provider value={api}>
      <SessionProvider api={api} appEnvironment={appEnvironment}>
        {children}
      </SessionProvider>
    </ApiContext.Provider>
  );
}

function SessionProvider({
  api,
  appEnvironment,
  children,
}: {
  readonly api: AdminApi;
  readonly appEnvironment: string;
  readonly children: ReactNode;
}) {
  /**
   * A 401 here is an answer rather than a failure: it is how the platform says
   * this browser holds nothing. It is mapped to an empty value so that the one
   * remaining error state means what it says — the platform could not be asked.
   */
  const load = useCallback(async () => {
    const result = await api.session();
    return result.kind === 'unauthenticated'
      ? { kind: 'ok' as const, value: undefined }
      : result;
  }, [api]);
  const session = useResource<AdminSession | undefined>(load);
  const { busy, run } = useSingleFlight();

  // A privileged session is the shortest-lived session in the product. A tab
  // that has been away asks again before an operator acts on what it shows.
  useRevalidateOnFocus(session.reload);

  const value = useMemo<SessionValue>(() => {
    const current = session.value;
    return {
      answered: !session.loading && session.error === undefined,
      appEnvironment,
      assurance: current?.assurance,
      audience: current?.audience,
      busy,
      known: !session.loading,
      privileged:
        current?.audience === 'platform_admin' &&
        current.assurance === 'phishing_resistant',
      refresh: session.reload,
      session,
      signedIn: current !== undefined,
      signOut: () => {
        run(async () => {
          await api.signOut();
          session.reload();
        });
      },
    };
  }, [api, appEnvironment, busy, run, session]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
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
 * Longer than the other surfaces use. What a toast reports here is a privileged
 * operation that has already happened, and an operator who looked away should
 * still find out that it did.
 */
const toastLifetimeMilliseconds = 9000;

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
