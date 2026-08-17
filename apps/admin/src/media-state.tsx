'use client';

import { useCallback, useEffect, useState } from 'react';

import { createVeloraApiClient } from '@velora/api-client';

/**
 * The media platform, as an operator sees it.
 *
 * A read, like the financial panel beside it, and for a stricter reason. The
 * API does carry one media action an operator can take — asking a delivery
 * layer to forget an address — and it is deliberately not on this screen: it
 * names one asset, it is reached from a finding or a report rather than by
 * browsing, and a lookup box on a dashboard is the beginning of a search over
 * everybody's private images. What is here is the state of the platform and
 * nothing that identifies whose media it is.
 *
 * The backlog rows are the point of the screen. A count says how much is owed
 * and nothing about whether it is moving, so each class carries the age of its
 * oldest member and the age at which that becomes an alert. Every class is
 * shown every time, healthy ones included: a list that hid what was fine could
 * not tell an operator "nothing is owed" apart from "the signal stopped
 * arriving", and those are opposite situations.
 */

interface StateRow {
  readonly count: number;
  readonly state: string;
}

interface BacklogRow {
  readonly breached: boolean;
  readonly count: number;
  readonly oldestAgeSeconds?: number;
  readonly state: string;
  readonly thresholdSeconds: number;
}

interface MediaState {
  readonly adapters: Readonly<Record<string, string>>;
  readonly assets: readonly StateRow[];
  readonly attention: readonly StateRow[];
  readonly backlogs: readonly BacklogRow[];
  readonly drift: readonly StateRow[];
  readonly liveMediaAvailable: boolean;
  readonly objects: readonly StateRow[];
  readonly obligations: readonly StateRow[];
}

type Phase =
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: MediaState }
  | { readonly kind: 'unauthorised' };

/**
 * A duration an operator can act on rather than a number of seconds.
 *
 * Rounded down to the largest unit it fills, because "26 hours" is a fact
 * somebody has to convert before they can react to it and "1 day" is not.
 */
function readableAge(seconds: number): string {
  for (const [unit, size] of [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ] as const) {
    if (seconds >= size) {
      const value = Math.floor(seconds / size);
      return `${String(value)} ${unit}${value === 1 ? '' : 's'}`;
    }
  }
  return `${String(seconds)} second${seconds === 1 ? '' : 's'}`;
}

function StateList({
  rows,
  testId,
  title,
}: {
  readonly rows: readonly StateRow[];
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={`${testId}-heading`}>
      <h3 id={`${testId}-heading`}>{title}</h3>
      {rows.length === 0 ? (
        <p data-testid={`${testId}-empty`}>None.</p>
      ) : (
        <dl>
          {rows.map((row) => (
            <div key={row.state}>
              <dt>{row.state}</dt>
              <dd data-testid={`${testId}-${row.state}`}>{row.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function MediaOperations({
  apiBaseUrl,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the screen renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const load = useCallback(async () => {
    const api = createVeloraApiClient(apiBaseUrl, {
      ...(fetchImplementation === undefined
        ? {}
        : { fetch: fetchImplementation }),
    });
    const result = await api.GET('/v1/admin/media/state', {
      credentials: 'include',
    });
    if (result.data === undefined) {
      // One answer for "not signed in" and "step-up has gone stale", because
      // which condition failed is not a caller's business — the same rule the
      // server applies.
      setPhase(
        result.response.status === 401 || result.response.status === 403
          ? { kind: 'unauthorised' }
          : { kind: 'failed', message: 'The media state could not be read.' },
      );
      return;
    }
    setPhase({ kind: 'ready', value: result.data });
  }, [apiBaseUrl, fetchImplementation]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase.kind === 'loading') {
    return (
      <p aria-live="polite" data-testid="media-loading" role="status">
        Loading media state…
      </p>
    );
  }
  if (phase.kind === 'unauthorised') {
    return (
      <p data-testid="media-unauthorised" role="alert">
        This surface requires a Platform Admin session with a recent
        phishing-resistant authenticator. No such verifier is approved, so
        nothing here is reachable in a deployed environment.
      </p>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <div>
        <p data-testid="media-failed" role="alert">
          {phase.message}
        </p>
        <button
          onClick={() => {
            void load();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  const adapters = Object.entries(phase.value.adapters).toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  return (
    <div data-testid="media-state">
      <section aria-labelledby="media-adapters-heading">
        <h3 id="media-adapters-heading">Adapters in force</h3>
        <dl>
          {adapters.map(([name, adapter]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd data-testid={`media-adapter-${name}`}>{adapter}</dd>
            </div>
          ))}
          <div>
            {/* Derived by the server from the adapters this process actually
                composed, so the screen cannot report a configured provider
                while the process runs a different one. */}
            <dt>accepting media</dt>
            <dd data-testid="media-available">
              {phase.value.liveMediaAvailable ? 'yes' : 'no'}
            </dd>
          </div>
        </dl>
      </section>

      <StateList
        rows={phase.value.attention}
        testId="media-attention"
        title="Needs a person"
      />

      <section aria-labelledby="media-backlogs-heading">
        <h3 id="media-backlogs-heading">Owed work</h3>
        <dl>
          {phase.value.backlogs.map((row) => (
            <div key={row.state}>
              <dt>{row.state}</dt>
              <dd data-testid={`media-backlog-${row.state}`}>
                {row.count === 0
                  ? 'nothing owed'
                  : `${String(row.count)} owed, oldest ${
                      row.oldestAgeSeconds === undefined
                        ? 'unknown'
                        : readableAge(row.oldestAgeSeconds)
                    }${row.breached ? ' — late' : ''}`}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <StateList
        rows={phase.value.assets}
        testId="media-assets"
        title="Assets"
      />
      <StateList
        rows={phase.value.objects}
        testId="media-objects"
        title="Stored objects"
      />
      <StateList
        rows={phase.value.obligations}
        testId="media-obligations"
        title="Duties"
      />
      <StateList
        rows={phase.value.drift}
        testId="media-drift"
        title="Disagreements with the provider"
      />
    </div>
  );
}
