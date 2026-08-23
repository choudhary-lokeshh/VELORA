'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiResult, DiscoveryCandidate } from '@velora/consumer-client';
import { availabilityView, failureMessage } from '@velora/consumer-client';

import { useApi, useToast } from '../app/providers';
import {
  Button,
  Chip,
  EmptyState,
  ErrorMessage,
  Notice,
  PageHeader,
  Skeleton,
  initialsOf,
  toneOf,
} from '../design/primitives';
import { languageNames, regionName } from './locale';
import { PersonSafetyMenu } from './safety-actions';
import { useResource, useSingleFlight } from './resource';

/**
 * Discovery.
 *
 * Two decisions, both the server's to accept. A pass and a signal are sent and
 * the answer is rendered; a candidate leaves the list because the request
 * succeeded, never in anticipation of it succeeding. A refusal — the pair is no
 * longer eligible, the account is not active, the candidate went away — is shown
 * as a refusal, and this surface does not guess which of those it was, because
 * the API deliberately does not say.
 *
 * Nothing on a card is invented. There is no distance, no compatibility score,
 * no popularity, no "online now", and no view count, because
 * `packages/validation` publishes none of them and the ranking that produced the
 * page is a fixed deterministic rule rather than a model. What a card shows is
 * exactly the minimized projection the server sent.
 */

/** How many candidates one screenful tries to hold. */
const targetCandidateCount = 12;

/**
 * How many requests one fill may make.
 *
 * The bound is the point. A short page carrying a continuation cursor does not
 * mean there is nothing left, so the client keeps asking — but a client that
 * kept asking without a ceiling would turn one scroll into an unbounded walk of
 * somebody's entire suppression history. When the ceiling is reached the screen
 * shows what it has and offers to continue.
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

export function Discovery() {
  const api = useApi();
  const toast = useToast();
  const [feed, setFeed] = useState<FeedState>(emptyFeed);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [retryable, setRetryable] = useState(false);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const decision = useSingleFlight();
  const inFlight = useRef<AbortController | undefined>(undefined);

  const loadAvailability = useCallback(
    async (signal: AbortSignal) => api.availability(signal),
    [api],
  );
  const availability = useResource(loadAvailability);
  const view = availabilityView(availability.value);

  /**
   * Fills the list from a starting position.
   *
   * Candidates are deduplicated by identifier as they arrive. The server does
   * not promise a candidate cannot appear twice across pages — a profile that
   * changes between requests can move — and a list that rendered the same person
   * twice would invite two conflicting decisions about them.
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

  const drop = (candidateId: string) => {
    setFeed((current) => ({
      ...current,
      candidates: current.candidates.filter(
        (candidate) => candidate.id !== candidateId,
      ),
    }));
  };

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
      try {
        const result = await work();
        if (result.kind === 'ok') {
          toast.show(success, 'positive');
          // Removed because the server accepted it, not in anticipation.
          drop(candidateId);
          return;
        }
        toast.show(failureMessage(result) ?? 'That did not work.', 'critical');
        // A refused decision leaves the candidate where it was and re-reads, so
        // the list reflects the server rather than this tab's optimism.
        await fill(emptyFeed);
      } finally {
        setPending(undefined);
      }
    });
  };

  const busy = decision.busy || pending !== undefined;
  const empty = !loading && error === undefined && feed.candidates.length === 0;

  return (
    <>
      <PageHeader
        lede="People who are available right now, who can see you, and who you have not already decided about."
        title="Discover"
      />

      {view === 'available' ? null : (
        <div className="v-lede-gap">
          <Notice
            icon="clock"
            testId="discovery-availability"
            title={
              view === 'expired'
                ? 'Your availability window ended'
                : 'You are not visible right now'
            }
            tone="caution"
          >
            Other people only see you while you are available, and being
            available is also how you appear to them.{' '}
            <Link href="/you">Set a window on your profile.</Link>
          </Notice>
        </div>
      )}

      {error === undefined ? null : (
        <div className="v-stack v-stack--3 v-lede-gap">
          <ErrorMessage testId="discovery-failed">{error}</ErrorMessage>
          {retryable ? (
            <div>
              <Button
                onClick={() => {
                  void fill(emptyFeed);
                }}
              >
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {loading && feed.candidates.length === 0 ? (
        <>
          <p className="v-visually-hidden" role="status">
            Looking for people
          </p>
          <div className="v-deck" data-testid="discovery-loading">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="v-person" key={index}>
                <Skeleton height="0" width="100%" />
                <div style={{ aspectRatio: '4 / 5' }}>
                  <Skeleton height="100%" width="100%" />
                </div>
                <div
                  className="v-person__body"
                  style={{ paddingTop: 'var(--space-4)' }}
                >
                  <Skeleton height={12} width="60%" />
                  <Skeleton height={12} width="90%" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {empty ? (
        <EmptyState
          actions={
            <Button
              icon="refresh"
              onClick={() => {
                void fill(emptyFeed);
              }}
            >
              Look again
            </Button>
          }
          body={
            feed.exhausted
              ? 'You have seen everybody available to you for now. People appear here when they make themselves available, so it is worth coming back.'
              : 'Nobody is available to you right now. Being available yourself is what makes you visible to other people too.'
          }
          icon="compass"
          testId="discovery-empty"
          title={
            feed.exhausted ? 'That is everybody for now' : 'Nobody right now'
          }
        />
      ) : null}

      {feed.candidates.length === 0 ? null : (
        <ul className="v-deck" data-testid="discovery-candidates">
          {feed.candidates.map((candidate) => (
            <li key={candidate.id}>
              <CandidateCard
                busy={busy}
                candidate={candidate}
                onBlocked={() => {
                  drop(candidate.id);
                }}
                onPass={() => {
                  decide(
                    candidate.id,
                    async () => api.pass(candidate.id),
                    'Passed. They are not told, and you will not see them for a while.',
                  );
                }}
                onSignal={() => {
                  decide(
                    candidate.id,
                    async () => api.signalIntroduction(candidate.id),
                    'Interest sent. They only hear about it if they say yes too.',
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {feed.exhausted || feed.cursor === undefined ? null : (
        <div className="v-continue">
          <Button
            busy={loading}
            data-testid="discovery-more"
            onClick={() => {
              void fill(feed);
            }}
          >
            Look for more
          </Button>
        </div>
      )}
    </>
  );
}

function CandidateCard({
  busy,
  candidate,
  onBlocked,
  onPass,
  onSignal,
}: {
  readonly busy: boolean;
  readonly candidate: DiscoveryCandidate;
  readonly onBlocked: () => void;
  readonly onPass: () => void;
  readonly onSignal: () => void;
}) {
  const region = regionName(candidate.region);
  return (
    <article className="v-person" data-testid={`candidate-${candidate.id}`}>
      <div
        className={`v-person__portrait v-avatar--tone-${String(
          toneOf(candidate.id),
        )}`}
      >
        <span aria-hidden="true" className="v-person__portrait-mark">
          {initialsOf(candidate.displayName)}
        </span>
        <div className="v-person__identity">
          <h2 className="v-heading v-wrap">{candidate.displayName}</h2>
          <div className="v-inline v-inline--tight">
            {region === undefined ? null : <Chip>{region}</Chip>}
            {candidate.sharedLanguages.length === 0 ? null : (
              <Chip>Both speak {languageNames(candidate.sharedLanguages)}</Chip>
            )}
          </div>
        </div>
      </div>

      <div className="v-person__body">
        {candidate.bio === undefined ? (
          <p className="v-small v-quiet">No bio yet.</p>
        ) : (
          <p className="v-person__bio v-small v-wrap">{candidate.bio}</p>
        )}

        <div className="v-person__actions">
          <Button
            data-testid={`discovery-pass-${candidate.id}`}
            disabled={busy}
            onClick={onPass}
            tone="secondary"
          >
            Pass
          </Button>
          <Button
            data-testid={`discovery-signal-${candidate.id}`}
            disabled={busy}
            icon="heart"
            onClick={onSignal}
            tone="primary"
          >
            Interested
          </Button>
          <PersonSafetyMenu
            onBlocked={onBlocked}
            person={{ displayName: candidate.displayName, id: candidate.id }}
          />
        </div>
      </div>
    </article>
  );
}
