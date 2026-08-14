'use client';

import { useCallback, useState } from 'react';

import type {
  ApiResult,
  ConsumerApi,
  Introduction,
} from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { useResource, useRevalidateOnFocus, useSingleFlight } from './resource';
import { EmptyState, ResourceState, Section, StatusMessage } from './ui';

/**
 * Pending signals and mutual introductions.
 *
 * A pending signal is an offer with an end. Its validity is bounded by the
 * availability that produced it or by a day, whichever comes first, and the
 * server closes it where it finds it expired rather than sweeping it on a
 * timer. This surface therefore does not compute or count down an expiry it
 * would only get wrong — it shows what the server currently reports, and asks
 * again when the tab comes back.
 *
 * Nothing here tells anybody who declined them, who withdrew, or who let a
 * signal lapse. A closed introduction simply stops being listed, which is the
 * same thing somebody sees when the other person was never there.
 */
export function IntroductionsPanel({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.introductions({}, signal),
    [api],
  );
  const introductions = useResource(load);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const action = useSingleFlight();

  useRevalidateOnFocus(introductions.reload);

  const act = (id: string, work: () => Promise<ApiResult<unknown>>) => {
    action.run(async () => {
      setPending(id);
      setNotice(undefined);
      try {
        setNotice(failureMessage(await work()));
        // Re-read either way. The server decides what state the pair is in, and
        // an accepted action can still have been overtaken by the other side.
        introductions.reload();
      } finally {
        setPending(undefined);
      }
    });
  };

  const rows = introductions.value?.introductions ?? [];
  const mutual = rows.filter((row) => row.state === 'mutual');
  const waiting = rows.filter((row) => row.state === 'pending');

  return (
    <Section headingId="introductions-heading" title="Introductions">
      <ResourceState resource={introductions} testId="introductions" />
      {notice === undefined ? null : (
        <StatusMessage testId="introductions-notice">{notice}</StatusMessage>
      )}
      {!introductions.loading &&
      introductions.error === undefined &&
      rows.length === 0 ? (
        <EmptyState testId="introductions-empty">
          No introductions yet. They appear when two people both say they are
          interested.
        </EmptyState>
      ) : null}

      <h3>Mutual</h3>
      <ul data-testid="introductions-mutual">
        {mutual.map((row) => (
          <li key={row.id}>
            <IntroductionSummary introduction={row} />
            <button
              data-testid={`introduction-open-${row.id}`}
              disabled={action.busy || pending !== undefined}
              onClick={() => {
                act(row.id, async () => api.openConversation(row.id));
              }}
              type="button"
            >
              Open conversation
            </button>
          </li>
        ))}
      </ul>

      <h3>Waiting</h3>
      <ul data-testid="introductions-pending">
        {waiting.map((row) => (
          <li key={row.id}>
            <IntroductionSummary introduction={row} />
            {row.role === 'initiator' ? (
              <button
                data-testid={`introduction-withdraw-${row.id}`}
                disabled={action.busy || pending !== undefined}
                onClick={() => {
                  act(row.id, async () => api.withdrawIntroduction(row.id));
                }}
                type="button"
              >
                Withdraw
              </button>
            ) : (
              <div className="row">
                <button
                  data-testid={`introduction-accept-${row.id}`}
                  disabled={action.busy || pending !== undefined}
                  onClick={() => {
                    act(row.id, async () =>
                      api.signalIntroduction(row.counterpart.id),
                    );
                  }}
                  type="button"
                >
                  Say you are interested too
                </button>
                <button
                  data-testid={`introduction-decline-${row.id}`}
                  disabled={action.busy || pending !== undefined}
                  onClick={() => {
                    act(row.id, async () => api.declineIntroduction(row.id));
                  }}
                  type="button"
                >
                  Decline
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function IntroductionSummary({
  introduction,
}: {
  readonly introduction: Introduction;
}) {
  return (
    <div>
      <h4>{introduction.counterpart.displayName}</h4>
      <p className="hint">
        {introduction.state === 'mutual'
          ? 'You both said yes.'
          : introduction.role === 'initiator'
            ? 'Waiting for them. They only hear about it if they are interested too.'
            : 'They are interested in meeting you.'}
      </p>
    </div>
  );
}
