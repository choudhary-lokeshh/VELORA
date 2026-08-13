'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { createConsumerWebAuthClient } from './client';
import {
  consumerAuthCauseMessages,
  consumerAuthMessages,
  initialConsumerAuthState,
  reduceConsumerAuth,
} from './state';

/**
 * Minimum Consumer Web authentication surface. It exists to exercise the
 * session lifecycle end to end; the production sign-in experience is
 * `DESIGN REQUIRED` and is not invented here.
 */
export function AuthPanel({ apiBaseUrl }: { readonly apiBaseUrl: string }) {
  const client = useMemo(
    () => createConsumerWebAuthClient({ apiBaseUrl }),
    [apiBaseUrl],
  );
  const [state, dispatch] = useReducer(
    reduceConsumerAuth,
    initialConsumerAuthState,
  );
  const [subject, setSubject] = useState('person@velora.test');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    dispatch({ outcome: await client.session(), type: 'session-result' });
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      try {
        await work();
      } finally {
        setBusy(false);
      }
    },
    [setBusy],
  );

  return (
    <section aria-labelledby="auth-heading" data-testid="auth-panel">
      <h2 id="auth-heading">Session</h2>
      <p data-testid="auth-status">{consumerAuthMessages[state.status]}</p>
      {state.status === 'unauthenticated' ? (
        <p data-testid="auth-cause">{consumerAuthCauseMessages[state.cause]}</p>
      ) : null}
      {state.status === 'authenticated' ? (
        <dl>
          <dt>Audience</dt>
          <dd data-testid="auth-audience">{state.session.audience}</dd>
          <dt>Assurance</dt>
          <dd data-testid="auth-assurance">{state.session.assurance}</dd>
        </dl>
      ) : null}
      <label htmlFor="auth-subject">Development identity</label>
      <input
        autoComplete="username"
        id="auth-subject"
        name="subject"
        onChange={(event) => {
          setSubject(event.target.value);
        }}
        value={subject}
      />

      <button
        data-testid="auth-sign-in"
        disabled={busy}
        onClick={() => {
          void run(async () => {
            dispatch({
              outcome: await client.signIn(subject),
              type: 'sign-in-result',
            });
          });
        }}
        type="button"
      >
        Sign in
      </button>
      <button
        data-testid="auth-refresh"
        disabled={busy}
        onClick={() => {
          void run(refresh);
        }}
        type="button"
      >
        Check session
      </button>
      <button
        data-testid="auth-sign-out"
        disabled={busy}
        onClick={() => {
          void run(async () => {
            dispatch({
              outcome: await client.logout(),
              type: 'logout-result',
            });
          });
        }}
        type="button"
      >
        Sign out
      </button>
      <button
        data-testid="auth-sign-out-everywhere"
        disabled={busy}
        onClick={() => {
          void run(async () => {
            dispatch({
              outcome: await client.logoutEverywhere(),
              type: 'logout-everywhere-result',
            });
          });
        }}
        type="button"
      >
        Sign out everywhere
      </button>
    </section>
  );
}
