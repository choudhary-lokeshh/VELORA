'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '@velora/creator-client';
import { failureMessage, isRetryable } from '@velora/creator-client';

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
  const [retryable, setRetryable] = useState(false);
  const [loading, setLoading] = useState(enabled);
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
    setLoading(true);
    void load(controller.signal).then((result) => {
      // A superseded read has no answer worth showing. Returning here is what
      // stops a slow first request from overwriting a fast second one.
      if (controller.signal.aborted) return;
      setLoading(false);
      if (result.kind === 'ok') {
        setValue(result.value);
        setError(undefined);
        setRetryable(false);
        return;
      }
      if (result.kind === 'unauthenticated') expired.current?.();
      setError(failureMessage(result));
      setRetryable(isRetryable(result));
    });
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    reload();
    return () => {
      inFlight.current?.abort();
    };
  }, [enabled, reload]);

  return { error, loading, reload, retryable, value };
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
