import type { ApiResult } from '@velora/consumer-client';
import { failureMessage, isRetryable } from '@velora/consumer-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * One server-owned value, and every state it can be in.
 *
 * The same four facts a screen needs: whether a request is in flight, the last
 * successful answer, what went wrong if anything did, and whether trying again
 * could help. A screen rendering these cannot leave a spinner running forever
 * and cannot swallow a failure.
 *
 * The previous value survives a reload so a revalidation never blanks a screen
 * somebody is reading. On a phone that matters more than on the web: a
 * revalidation happens every time the app comes back to the foreground.
 */
export interface Resource<T> {
  readonly error: string | undefined;
  readonly loading: boolean;
  /** Re-reads from the server, superseding any request already in flight. */
  readonly reload: () => void;
  readonly retryable: boolean;
  /**
   * Whether the server has answered at least once since this resource was
   * enabled.
   *
   * `loading` alone cannot carry this. A resource that starts disabled reports
   * `loading: false`, and a caller reading only `value === undefined` in that
   * moment would conclude the value is absent when nobody has asked yet. On a
   * phone that is not a theoretical window: a cold launch reads the keystore
   * before it can enable anything, so the frame after the session becomes real
   * is exactly the frame in which every account read is enabled-but-unasked,
   * and a gate acting on it sends an admitted account back to the beginning of
   * onboarding for a frame the person can see. Nothing may act on an absent
   * value until this is true.
   */
  readonly settled: boolean;
  readonly value: T | undefined;
}

export interface ResourceOptions {
  readonly enabled?: boolean;
  /** Told when the server says the session is gone. */
  readonly onUnauthenticated?: () => void;
}

/**
 * Reads one value, and keeps reading it whenever asked.
 *
 * `load` must be stable — wrap it in `useCallback`. Every read carries an
 * `AbortSignal` and a newer read aborts the one before it, so the rapid screen
 * changes a phone produces cannot end with an older answer overwriting a newer
 * one. The same mechanism makes a duplicate tap harmless: the second read
 * cancels the first and only its answer is rendered.
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
  const [settled, setSettled] = useState(false);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const expired = useRef(onUnauthenticated);
  expired.current = onUnauthenticated;

  const reload = useCallback(() => {
    if (!enabled) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    void load(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      setSettled(true);
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
      setSettled(false);
      return undefined;
    }
    // Set here rather than left to the read: a caller rendering between the
    // moment this resource is enabled and the moment the request starts must
    // see "asking", never "asked and empty".
    setLoading(true);
    reload();
    return () => {
      inFlight.current?.abort();
    };
  }, [enabled, reload]);

  return { error, loading, reload, retryable, settled, value };
}

/**
 * Re-reads whenever the app comes back to the foreground.
 *
 * A phone spends most of its life with the app suspended, and everything the
 * surface is showing can change while it is: a session can expire, an
 * availability window can close, somebody can block, an account can be
 * restricted. Rather than a background poll — which would drain a battery to
 * keep a screen nobody is looking at up to date — the rule is that the app asks
 * again the moment it is looked at, and the server is authoritative when it
 * answers.
 *
 * Nothing here uses the device clock as business truth. An availability window
 * that ended is reported as ended by the server; this only makes sure the
 * question gets asked.
 */
export function useRevalidateOnForeground(revalidate: () => void): void {
  const latest = useRef(revalidate);
  latest.current = revalidate;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') latest.current();
    });
    return () => {
      subscription.remove();
    };
  }, []);
}

/**
 * Runs one action at a time, whatever a fast finger does.
 *
 * A guard held in component state is not a guard: three taps in the same frame
 * all read the state as it was before any of them committed, and all three
 * fire. A ref is written synchronously, so the second tap sees the first.
 *
 * This matters beyond tidiness. Three signals are three writes the server has
 * to make idempotent; three sends are three messages unless every one of them
 * carries the same client identifier. Not sending them at all is better than
 * relying on the server to sort them out.
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
