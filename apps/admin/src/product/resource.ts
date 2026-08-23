'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '@velora/api-client';
import { failureMessage, isRetryable } from '../api/messages';

/**
 * One server-owned value, and every state it can be in.
 *
 * There are exactly four things a surface needs to know and this shape carries
 * all of them: whether a request is in flight, what the last successful answer
 * was, what went wrong if anything did, and whether trying again could help.
 * A component rendering these cannot produce an infinite spinner — `loading`
 * always ends — and cannot swallow a failure, because `error` is not optional
 * to think about.
 *
 * Keeping the previous value while reloading is deliberate. A revalidation
 * that blanked the screen would punish the user for the app being careful; a
 * revalidation that fails leaves the last known answer visible next to an
 * honest message saying it could not be refreshed.
 */
export interface Resource<T> {
  readonly error: string | undefined;
  readonly loading: boolean;
  /**
   * The server said the thing does not exist.
   *
   * Deliberately not an error. A creator with no capability yet, and a creator
   * with no public page yet, both get the same 404 the API gives a route that
   * is not there — that is the platform's way of saying "there is nothing here"
   * without disclosing whether there could be. A surface that rendered it as a
   * failure would tell somebody their account was broken when in fact they had
   * simply not started.
   */
  readonly missing: boolean;
  /** Re-reads from the server, superseding any request already in flight. */
  readonly reload: () => void;
  readonly retryable: boolean;
  readonly value: T | undefined;
}

export interface ResourceOptions {
  /**
   * Called when the server says the session is gone. The surface hands this to
   * the session layer rather than deciding for itself: a 401 is the one answer
   * a client may act on without asking anything further.
   */
  readonly onUnauthenticated?: () => void;
  /** When false the resource holds still and reads nothing. */
  readonly enabled?: boolean;
}

/**
 * Reads one value, and keeps reading it whenever asked.
 *
 * `load` must be stable — wrap it in `useCallback` — because it is what decides
 * when a re-read happens. Every read carries an `AbortSignal` and a newer read
 * aborts the one before it, so a fast sequence of navigations cannot end with
 * an older answer overwriting a newer one.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<ApiResult<T>>,
  options: ResourceOptions = {},
): Resource<T> {
  const enabled = options.enabled ?? true;
  const { onUnauthenticated } = options;
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [reading, setReading] = useState(enabled);
  /**
   * Whether a read has ever answered.
   *
   * Needed because a resource that is enabled part-way through — which is what
   * happens when the session answer arrives — is not reading yet during the
   * render that enables it, and would otherwise report itself as finished with
   * nothing. A screen reading that would show a creator who already has a page
   * the form for claiming one, for a frame.
   */
  const [answered, setAnswered] = useState(false);
  const inFlight = useRef<AbortController | undefined>(undefined);
  // Held in a ref so a caller that passes an inline callback does not restart
  // every read on every render.
  const expired = useRef(onUnauthenticated);
  expired.current = onUnauthenticated;

  const reload = useCallback(() => {
    if (!enabled) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setReading(true);
    void load(controller.signal).then((result) => {
      // A superseded read has no answer worth showing. Returning here is what
      // stops a slow first request from overwriting a fast second one.
      if (controller.signal.aborted) return;
      setReading(false);
      setAnswered(true);
      if (result.kind === 'ok') {
        setValue(result.value);
        setError(undefined);
        setMissing(false);
        setRetryable(false);
        return;
      }
      if (result.kind === 'not-found') {
        setValue(undefined);
        setError(undefined);
        setMissing(true);
        setRetryable(false);
        return;
      }
      if (result.kind === 'unauthenticated') expired.current?.();
      setError(failureMessage(result));
      setMissing(false);
      setRetryable(isRetryable(result));
    });
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) {
      setReading(false);
      return undefined;
    }
    reload();
    return () => {
      inFlight.current?.abort();
    };
  }, [enabled, reload]);

  return {
    error,
    loading: enabled && (reading || !answered),
    missing,
    reload,
    retryable,
    value,
  };
}

/**
 * Re-reads whenever this tab becomes the one being looked at.
 *
 * The server is the only authority on session, block, availability, and
 * profile state, and another tab — or another device — can change any of them
 * without this one hearing about it. Rather than a synchronisation framework,
 * the rule is simply that a tab which has been away asks again before the user
 * acts on what it is showing. `docs/architecture` has no realtime transport in
 * V1 and this does not invent one.
 */
export function useRevalidateOnFocus(revalidate: () => void): void {
  const latest = useRef(revalidate);
  latest.current = revalidate;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const wake = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, []);
}

/**
 * Runs one action at a time, whatever a fast pointer does.
 *
 * A guard held in component state is not a guard: two clicks in the same frame
 * both read the state as it was before either committed, and both fire. A ref
 * is written synchronously, so the second click sees the first.
 *
 * This matters beyond tidiness. Two signals are two writes the server has to
 * make idempotent; two sends are two messages unless both carry the same client
 * identifier. Not sending them at all is better than relying on the server to
 * sort them out.
 */
export function useSingleFlight(): {
  readonly busy: boolean;
  readonly run: (work: () => Promise<void>) => void;
} {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback((work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    void work().finally(() => {
      inFlight.current = false;
      setBusy(false);
    });
  }, []);

  return { busy, run };
}

/**
 * One page of a keyset-paged list, in the shape every caller reduces to.
 *
 * The API publishes a differently named array per route — `content`, `clubs`,
 * `memberships`, `entries` — and a cursor beside it. Reducing each to this pair
 * at the call site keeps one paging implementation instead of five.
 */
export interface Page<TItem, TMeta = undefined> {
  readonly items: readonly TItem[];
  /**
   * Whatever the route publishes beside its page. Some lists carry a statement
   * about the whole capability — whether selling is enabled at all, for
   * instance — and reading it from the same response is one request rather than
   * two answers that could disagree.
   */
  readonly meta?: TMeta;
  readonly nextCursor: string | undefined;
}

export interface Collection<TItem, TMeta = undefined> {
  readonly error: string | undefined;
  /** True while the server has told us there is another page. */
  readonly hasMore: boolean;
  readonly items: readonly TItem[];
  /** The first read, with nothing on the screen yet. */
  readonly loading: boolean;
  /** A later page, with the earlier ones still on the screen. */
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
  /** What the most recent page carried beside its items. */
  readonly meta: TMeta | undefined;
  readonly reload: () => void;
  readonly retryable: boolean;
  /** False until the first read has finished, however it finished. */
  readonly settled: boolean;
}

/**
 * A list the server hands over one page at a time.
 *
 * Keyset paging, because that is what the contract publishes: there is no page
 * number and no total, so this never claims one. `hasMore` is the presence of a
 * cursor and nothing else — a short page with a cursor is not the end, and a
 * surface that guessed otherwise would silently hide a creator's own work.
 *
 * Reloading returns to the first page rather than re-reading every page that
 * was open. A creator who has just archived something is looking at the top of
 * the list; refetching four pages to preserve a scroll position they have
 * already left would be four requests to show them the same thing.
 */
export function useCollection<TItem, TMeta = undefined>(
  load: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<ApiResult<Page<TItem, TMeta>>>,
  options: ResourceOptions = {},
): Collection<TItem, TMeta> {
  const enabled = options.enabled ?? true;
  const { onUnauthenticated } = options;
  const [items, setItems] = useState<readonly TItem[]>([]);
  const [meta, setMeta] = useState<TMeta | undefined>(undefined);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [retryable, setRetryable] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [settled, setSettled] = useState(false);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const expired = useRef(onUnauthenticated);
  expired.current = onUnauthenticated;

  const read = useCallback(
    (from: string | undefined) => {
      if (!enabled) return;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (from === undefined) setLoading(true);
      else setLoadingMore(true);

      void load(from, controller.signal).then((result) => {
        // A superseded read has no answer worth showing. Returning here is what
        // stops a slow first request from overwriting a fast second one.
        if (controller.signal.aborted) return;
        setLoading(false);
        setLoadingMore(false);
        setSettled(true);
        if (result.kind === 'ok') {
          setItems((existing) =>
            from === undefined
              ? result.value.items
              : [...existing, ...result.value.items],
          );
          setCursor(result.value.nextCursor);
          setMeta(result.value.meta);
          setError(undefined);
          setRetryable(false);
          return;
        }
        if (result.kind === 'unauthenticated') expired.current?.();
        setError(failureMessage(result));
        setRetryable(isRetryable(result));
      });
    },
    [enabled, load],
  );

  const reload = useCallback(() => {
    setCursor(undefined);
    read(undefined);
  }, [read]);

  const loadMore = useCallback(() => {
    if (cursor === undefined || loadingMore || loading) return;
    read(cursor);
  }, [cursor, loading, loadingMore, read]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setSettled(true);
      return undefined;
    }
    read(undefined);
    return () => {
      inFlight.current?.abort();
    };
  }, [enabled, read]);

  return {
    error,
    hasMore: cursor !== undefined,
    items,
    loading,
    loadingMore,
    loadMore,
    meta,
    reload,
    retryable,
    settled,
  };
}
