'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import {
  createCreatorApi,
  createMediaAddressBook,
  type MediaVariant,
  type PublicCreatorDirectory,
  type PublicCreatorSummary,
} from '@velora/creator-client';

import {
  Avatar,
  Button,
  EmptyState,
  ErrorMessage,
  Skeleton,
} from '../design/primitives';
import { useAddressesFrom } from './imagery';
import { useResource } from './resource';

/**
 * Creators, as somebody browsing rather than somebody who already knows a
 * handle.
 *
 * A section of Discover rather than a sixth destination, and deliberately its
 * own section rather than rows mixed into the candidate feed. Those are two
 * different questions with two different answers behind them: the people feed
 * is a fixed eligibility conjunction about who may be introduced to whom, and
 * this is a listing of pages their authors decided to publish. Blending them
 * would make one ranking rule have to mean both things, and it would put
 * creator business in the middle of Social Discovery, which `AGENTS.md`
 * forbids in as many words.
 *
 * There are no clubs here for the same reason, and that is not an omission:
 * Creator Private Clubs stay separate from Social Discovery, so a club is
 * reached from the page of the creator who runs it and from nowhere else.
 *
 * Ordering is publication order, which the server decides and this surface does
 * not restate as anything else. There is no popularity here, no follower count,
 * no featured row, and nothing purchasable — a listing that could be bought into
 * would be the first place on this platform where money moved attention.
 */

/** How many pages one screenful asks for. */
const pageSize = 24;

export function CreatorDirectory({
  apiBaseUrl,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the section renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const api = useMemo(
    () =>
      createCreatorApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
        // No credential. A published page answers identically for everybody, so
        // attaching a session would collect an identity for no purpose.
        transport: { headers: () => Promise.resolve({}) },
      }),
    [apiBaseUrl, fetchImplementation],
  );
  const media = useMemo(
    () =>
      createMediaAddressBook<MediaVariant>({
        exchange: async (request) => api.mediaDeliveries(request),
      }),
    [api],
  );

  const [extra, setExtra] = useState<readonly PublicCreatorSummary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async () => api.publicCreatorDirectory({ pageSize }),
    [api],
  );
  const first = useResource<PublicCreatorDirectory>(load);

  const creators = [...(first.value?.creators ?? []), ...extra];
  const next = cursor ?? first.value?.nextCursor;
  const portraits = useAddressesFrom(
    creators.flatMap((one) =>
      one.avatar === undefined ? [] : [one.avatar.id],
    ),
    'avatar_large',
    media,
  );

  const more = () => {
    if (next === undefined || loadingMore) return;
    setLoadingMore(true);
    void api
      .publicCreatorDirectory({ cursor: next, pageSize })
      .then((result) => {
        if (result.kind !== 'ok') return;
        setExtra((held) => [...held, ...result.value.creators]);
        setCursor(result.value.nextCursor);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  };

  if (first.loading && first.value === undefined) {
    return (
      <>
        <p className="v-visually-hidden" role="status">
          Looking for creators
        </p>
        <ul className="v-creator-grid" data-testid="creators-loading">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index}>
              <Skeleton height={104} width="100%" />
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (first.error !== undefined) {
    return (
      <div className="v-stack v-stack--3">
        <ErrorMessage testId="creators-failed">{first.error}</ErrorMessage>
        {first.retryable ? (
          <div>
            <Button onClick={first.reload}>Try again</Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (creators.length === 0) {
    return (
      <EmptyState
        body="Creators appear here once they publish a page. Nobody has yet."
        icon="sparkle"
        testId="creators-empty"
        title="No published pages yet"
      />
    );
  }

  return (
    <>
      <ul className="v-creator-grid" data-testid="creator-directory">
        {creators.map((creator) => (
          <li key={creator.handle}>
            <Link
              className="v-creator-card"
              data-testid={`creator-${creator.handle}`}
              href={`/c/${creator.handle}`}
            >
              <Avatar
                displayName={creator.displayName}
                seed={creator.handle}
                size="md"
                src={
                  creator.avatar === undefined
                    ? undefined
                    : portraits.get(creator.avatar.id)
                }
              />
              <span className="v-creator-card__body">
                <span className="v-subheading v-truncate">
                  {creator.displayName}
                </span>
                <span className="v-caption v-quiet v-truncate">
                  @{creator.handle}
                </span>
                {creator.bio === undefined ? null : (
                  <span className="v-small v-muted v-clamp-2">
                    {creator.bio}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {next === undefined ? null : (
        <div className="v-continue">
          <Button busy={loadingMore} onClick={more}>
            Show more creators
          </Button>
        </div>
      )}
    </>
  );
}
