'use client';

import { useCallback, useMemo } from 'react';

import {
  createCreatorApi,
  type CreatorApi,
  type PublicClubList,
  type PublicCreator,
  type PublicCreatorCatalog,
} from '@velora/creator-client';

import { useResource } from './resource';
import { ErrorMessage, StatusMessage } from './ui';

/**
 * A creator's public page.
 *
 * The only VELORA surface a person with no account is meant to reach, and the
 * only one whose whole job is to render somebody else. Everything it shows came
 * from the explicitly public projection the server publishes: there is no
 * creator identifier, no account state, no member count, and nothing
 * purchasable, because none of those are in the response and none of them could
 * be added here without the server deciding to publish them first.
 *
 * There is deliberately no control that suggests somebody can buy something. No
 * payment path exists, and a button offering one would be a lie regardless of
 * what it did when pressed.
 *
 * An unknown handle, a draft page, and a suspended creator are one answer,
 * because the server gives one answer. This surface does not try to tell them
 * apart and must not: doing so would turn the page into a way to discover that
 * somebody exists.
 */
export function CreatorPublicPage({
  apiBaseUrl,
  fetchImplementation,
  handle,
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the page renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
  readonly handle: string;
}) {
  const api = useMemo(
    () =>
      createCreatorApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
        // No credential is sent. The answer is identical for every requester,
        // so attaching a session to the request would collect an identity for
        // no purpose.
        transport: { headers: () => Promise.resolve({}) },
      }),
    [apiBaseUrl, fetchImplementation],
  );

  const load = useCallback(
    async () => api.publicCreator(handle),
    [api, handle],
  );
  const creator = useResource<PublicCreator>(load);

  return (
    <div className="shell">
      <header>
        <p className="wordmark">VELORA</p>
      </header>
      <main>
        {creator.loading && creator.value === undefined ? (
          <StatusMessage testId="creator-page-loading">Loading…</StatusMessage>
        ) : null}

        {creator.value === undefined && !creator.loading ? (
          <section aria-labelledby="creator-missing-heading">
            <h1 id="creator-missing-heading">This page is not available</h1>
            <ErrorMessage testId="creator-page-missing">
              There is nothing to show at this address.
            </ErrorMessage>
            {creator.retryable ? (
              <button onClick={creator.reload} type="button">
                Try again
              </button>
            ) : null}
          </section>
        ) : null}

        {creator.value === undefined ? null : (
          <>
            <CreatorProfileView creator={creator.value} />
            <CreatorCatalogView api={api} handle={handle} />
            <CreatorClubsView api={api} handle={handle} />
          </>
        )}
      </main>
    </div>
  );
}

/**
 * What this creator has published.
 *
 * A separate read from the profile, because the two answer different questions
 * and one being unavailable should not blank the other. An empty catalog is a
 * real and ordinary state — somebody published a page before they published
 * anything on it — and it is said plainly rather than shown as a failure.
 */
function CreatorCatalogView({
  api,
  handle,
}: {
  readonly api: CreatorApi;
  readonly handle: string;
}) {
  const load = useCallback(
    async () => api.publicCatalog({ handle }),
    [api, handle],
  );
  const catalog = useResource<PublicCreatorCatalog>(load);

  if (catalog.value === undefined) return null;
  return (
    <section aria-labelledby="creator-catalog-heading">
      <h2 id="creator-catalog-heading">Published</h2>
      {catalog.value.content.length === 0 ? (
        <p data-testid="creator-catalog-empty">Nothing published yet.</p>
      ) : (
        <ul data-testid="creator-catalog">
          {catalog.value.content.map((item) => (
            <li key={item.id}>
              <h3>{item.title}</h3>
              {item.summary === undefined ? null : <p>{item.summary}</p>}
              {item.body === undefined ? null : <p>{item.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Clubs this creator has published.
 *
 * Metadata only: a name and a description. No member count, no member list, no
 * invitation, no content, and no control implying anybody can pay to join — no
 * payment path exists, so a join button would be a lie regardless of what it
 * did when pressed. Access to a club comes from an invitation the creator
 * sends, which is not something a public page can offer.
 */
function CreatorClubsView({
  api,
  handle,
}: {
  readonly api: CreatorApi;
  readonly handle: string;
}) {
  const load = useCallback(async () => api.publicClubs(handle), [api, handle]);
  const clubs = useResource<PublicClubList>(load);

  if (clubs.value === undefined || clubs.value.clubs.length === 0) return null;
  return (
    <section aria-labelledby="creator-clubs-heading">
      <h2 id="creator-clubs-heading">Private clubs</h2>
      <ul data-testid="creator-public-clubs">
        {clubs.value.clubs.map((club) => (
          <li key={club.slug}>
            <h3>{club.name}</h3>
            {club.description === undefined ? null : <p>{club.description}</p>}
          </li>
        ))}
      </ul>
      <p className="hint">Membership is by invitation from this creator.</p>
    </section>
  );
}

function CreatorProfileView({ creator }: { readonly creator: PublicCreator }) {
  return (
    <article aria-labelledby="creator-name" data-testid="creator-page">
      <h1 id="creator-name">{creator.displayName}</h1>
      <p data-testid="creator-page-handle">@{creator.handle}</p>
      {creator.bio === undefined ? null : (
        <p data-testid="creator-page-bio">{creator.bio}</p>
      )}

      {creator.links.length === 0 ? null : (
        <nav aria-label="Links this creator chose to show">
          <ul data-testid="creator-page-links">
            {creator.links.map((link) => (
              <li key={link.url}>
                {/*
                  A link somebody else supplied. `noopener` and `noreferrer`
                  keep the new document away from this one and stop this page's
                  address travelling with the click; `nofollow` keeps the
                  platform from lending its standing to a destination nobody
                  reviewed. The server never fetches any of these.
                */}
                <a href={link.url} rel="nofollow noopener noreferrer">
                  {link.label ?? link.url}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}
