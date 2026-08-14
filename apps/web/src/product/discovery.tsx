'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApiResult,
  ConsumerApi,
  DiscoveryCandidate,
} from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';

import { useSingleFlight } from './resource';
import {
  EmptyState,
  ErrorMessage,
  MoreButton,
  Section,
  StatusMessage,
} from './ui';

/**
 * How many candidates one screenful tries to hold.
 *
 * The server pages independently of this, and a page it returns may be much
 * shorter after its own eligibility filtering. That is why the fill below is a
 * loop rather than a single request.
 */
const targetCandidateCount = 12;

/**
 * How many requests one fill may make.
 *
 * The bound is the point. A short page carrying a continuation cursor does not
 * mean there is nothing left, so the client keeps asking — but a client that
 * kept asking without a ceiling would turn one scroll into an unbounded walk of
 * somebody's entire suppression history. When the ceiling is reached the screen
 * shows what it has and offers to continue, which is an honest description of
 * where it stopped.
 */
const maximumFillRequests = 5;

interface FeedState {
  readonly candidates: readonly DiscoveryCandidate[];
  readonly cursor: string | undefined;
  /** True once the server stopped offering a continuation. */
  readonly exhausted: boolean;
}

const emptyFeed: FeedState = {
  candidates: [],
  cursor: undefined,
  exhausted: false,
};

/**
 * The discovery feed, and the two decisions it offers.
 *
 * Both decisions are the server's to accept. A pass and a signal are sent and
 * the answer is rendered; the candidate leaves the list because the request
 * succeeded, never in anticipation of it succeeding. A refusal — the pair is no
 * longer eligible, the account is not active, the candidate went away — is
 * shown as a refusal, and this surface does not guess which of those it was,
 * because the API deliberately does not say.
 */
export function DiscoveryPanel({ api }: { readonly api: ConsumerApi }) {
  const [feed, setFeed] = useState<FeedState>(emptyFeed);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [retryable, setRetryable] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const decision = useSingleFlight();
  const inFlight = useRef<AbortController | undefined>(undefined);

  /**
   * Fills the list from a starting position.
   *
   * Candidates are deduplicated by identifier as they arrive. The server does
   * not promise a candidate cannot appear twice across pages — a profile that
   * changes between requests can move — and a list that rendered the same
   * person twice would invite two conflicting decisions about them.
   */
  const fill = useCallback(
    async (from: FeedState) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      setError(undefined);

      const seen = new Set(from.candidates.map((candidate) => candidate.id));
      const collected = [...from.candidates];
      let cursor = from.cursor;
      let exhausted = from.exhausted;
      let failure: ApiResult<unknown> | undefined;

      for (
        let request = 0;
        request < maximumFillRequests &&
        collected.length < targetCandidateCount;
        request += 1
      ) {
        const result = await api.candidates(
          { cursor, pageSize: targetCandidateCount },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (result.kind !== 'ok') {
          failure = result;
          break;
        }
        for (const candidate of result.value.candidates) {
          if (seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          collected.push(candidate);
        }
        cursor = result.value.nextCursor;
        if (cursor === undefined) {
          exhausted = true;
          break;
        }
      }

      if (controller.signal.aborted) return;
      setLoading(false);
      setFeed({ candidates: collected, cursor, exhausted });
      if (failure !== undefined) {
        setError(failureMessage(failure));
        setRetryable(failure.kind === 'unavailable');
        return;
      }
      setRetryable(false);
    },
    [api],
  );

  useEffect(() => {
    void fill(emptyFeed);
    return () => {
      inFlight.current?.abort();
    };
  }, [fill]);

  const decide = (
    candidateId: string,
    work: () => Promise<ApiResult<unknown>>,
    success: string,
  ) => {
    // The guard is a ref inside `useSingleFlight`, not component state: two
    // clicks in the same frame would both read a state flag as it was before
    // either committed, and both would fire.
    decision.run(async () => {
      setPending(candidateId);
      setNotice(undefined);
      try {
        const result = await work();
        if (result.kind === 'ok') {
          setNotice(success);
          // Removed because the server accepted it, not in anticipation.
          setFeed((current) => ({
            ...current,
            candidates: current.candidates.filter(
              (candidate) => candidate.id !== candidateId,
            ),
          }));
          return;
        }
        setNotice(failureMessage(result));
        // A refused decision leaves the candidate where it was and re-reads, so
        // the list reflects the server rather than this tab's optimism.
        await fill(emptyFeed);
      } finally {
        setPending(undefined);
      }
    });
  };

  return (
    <Section headingId="discovery-heading" title="Discovery">
      {notice === undefined ? null : (
        <StatusMessage testId="discovery-notice">{notice}</StatusMessage>
      )}
      {error === undefined ? null : (
        <div>
          <ErrorMessage testId="discovery-failed">{error}</ErrorMessage>
          {retryable ? (
            <button
              onClick={() => {
                void fill(emptyFeed);
              }}
              type="button"
            >
              Try again
            </button>
          ) : null}
        </div>
      )}
      {loading && feed.candidates.length === 0 ? (
        <StatusMessage testId="discovery-loading">
          Looking for people…
        </StatusMessage>
      ) : null}
      {!loading && error === undefined && feed.candidates.length === 0 ? (
        <EmptyState testId="discovery-empty">
          Nobody is available for you right now. Being available yourself makes
          you visible to other people too.
        </EmptyState>
      ) : null}

      <ul className="candidates" data-testid="discovery-candidates">
        {feed.candidates.map((candidate) => (
          <li key={candidate.id}>
            <h3>{candidate.displayName}</h3>
            {candidate.region === undefined ? null : (
              <p className="hint">{candidate.region}</p>
            )}
            {candidate.bio === undefined ? null : <p>{candidate.bio}</p>}
            {candidate.sharedLanguages.length === 0 ? null : (
              <p className="hint">
                Shared languages: {candidate.sharedLanguages.join(', ')}
              </p>
            )}
            <div className="row">
              <button
                data-testid={`discovery-signal-${candidate.id}`}
                disabled={decision.busy || pending !== undefined}
                onClick={() => {
                  decide(
                    candidate.id,
                    async () => api.signalIntroduction(candidate.id),
                    'Interest sent. They will only hear about it if they say yes too.',
                  );
                }}
                type="button"
              >
                Say you are interested
              </button>
              <button
                data-testid={`discovery-pass-${candidate.id}`}
                disabled={decision.busy || pending !== undefined}
                onClick={() => {
                  decide(
                    candidate.id,
                    async () => api.pass(candidate.id),
                    'Passed. They are not told, and you will not see them for a while.',
                  );
                }}
                type="button"
              >
                Pass
              </button>
            </div>
          </li>
        ))}
      </ul>

      {feed.exhausted || feed.cursor === undefined ? null : (
        <MoreButton
          busy={loading}
          label="Look for more"
          onClick={() => {
            void fill(feed);
          }}
          testId="discovery-more"
        />
      )}
    </Section>
  );
}
