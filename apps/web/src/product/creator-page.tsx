'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';

import {
  createCreatorApi,
  createMediaAddressBook,
  type CreatorApi,
  type MediaAddressBook,
  type MediaVariant,
  type PublicClubList,
  type PublicCreator,
  type PublicCreatorCatalog,
} from '@velora/creator-client';

import { Icon } from '../design/icons';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorMessage,
  Skeleton,
} from '../design/primitives';
import { useAddressesFrom } from './imagery';
import { useResource } from './resource';

/**
 * A creator's public page.
 *
 * The only VELORA surface a person with no account is meant to reach, and the
 * only one whose whole job is to render somebody else. Everything it shows came
 * from the explicitly public projection the server publishes: there is no
 * creator identifier, no account state, no member count, and nothing
 * purchasable, because none of those are in the response and none could be added
 * here without the server deciding to publish them first.
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
        // No credential is sent. The answer is identical for every requester, so
        // attaching a session would collect an identity for no purpose.
        transport: { headers: () => Promise.resolve({}) },
      }),
    [apiBaseUrl, fetchImplementation],
  );

  const load = useCallback(
    async () => api.publicCreator(handle),
    [api, handle],
  );
  const creator = useResource<PublicCreator>(load);
  // This page has no provider above it — it is the one surface somebody with no
  // account reaches — so it holds its own book. The exchange is the same one
  // every other surface makes, and it is sent without a credential because the
  // imagery on a published page is public.
  const media = useMemo(
    () =>
      createMediaAddressBook<MediaVariant>({
        exchange: async (request) => api.mediaDeliveries(request),
      }),
    [api],
  );

  return (
    <div className="v-landing">
      <header className="v-landing__bar">
        <Link className="v-wordmark" href="/">
          <Icon name="sparkle" size="md" />
          VELORA
        </Link>
      </header>

      <main
        className="v-view"
        id="main"
        style={{ margin: '0 auto', maxWidth: '760px', width: '100%' }}
      >
        {creator.loading && creator.value === undefined ? (
          <div
            className="v-stack v-stack--5"
            data-testid="creator-page-loading"
          >
            <p className="v-visually-hidden" role="status">
              Loading
            </p>
            <Skeleton circle height={88} width={88} />
            <Skeleton height={24} width="40%" />
            <Skeleton height={14} width="80%" />
          </div>
        ) : null}

        {creator.value === undefined && !creator.loading ? (
          <section
            aria-labelledby="creator-missing-heading"
            className="v-stack v-stack--5"
          >
            <h1 className="v-title" id="creator-missing-heading">
              This page is not available
            </h1>
            <ErrorMessage testId="creator-page-missing">
              There is nothing to show at this address.
            </ErrorMessage>
            {creator.retryable ? (
              <div>
                <Button onClick={creator.reload}>Try again</Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {creator.value === undefined ? null : (
          <div className="v-stack v-stack--8">
            <CreatorProfileView creator={creator.value} media={media} />
            <CreatorCatalogView api={api} handle={handle} media={media} />
            <CreatorClubsView api={api} handle={handle} />
          </div>
        )}
      </main>
    </div>
  );
}

function CreatorProfileView({
  creator,
  media,
}: {
  readonly creator: PublicCreator;
  readonly media: MediaAddressBook<MediaVariant>;
}) {
  const avatarRef = creator.avatar?.id;
  const coverRef = creator.cover?.id;
  const avatars = useAddressesFrom(
    avatarRef === undefined ? [] : [avatarRef],
    'avatar_large',
    media,
  );
  const covers = useAddressesFrom(
    coverRef === undefined ? [] : [coverRef],
    'display',
    media,
  );
  const cover = coverRef === undefined ? undefined : covers.get(coverRef);
  return (
    <article
      aria-labelledby="creator-name"
      className="v-profile-hero"
      data-testid="creator-page"
    >
      {cover === undefined ? null : (
        /* A band behind the identity rather than a picture beside it: a cover
           is the page's first impression, and it is drawn only when there is
           genuinely one to draw. */
        <div className="v-creator-cover" data-testid="creator-page-cover">
          {/* A plain element rather than the framework's optimised one: the
              address is issued per request and cannot be fetched upstream. */}
          <img alt="" className="v-creator-cover__image" src={cover} />
        </div>
      )}
      <Avatar
        displayName={creator.displayName}
        seed={creator.handle}
        size="lg"
        src={avatarRef === undefined ? undefined : avatars.get(avatarRef)}
      />
      <div className="v-profile-hero__body">
        <h1 className="v-title v-wrap" id="creator-name">
          {creator.displayName}
        </h1>
        <p className="v-small v-quiet" data-testid="creator-page-handle">
          @{creator.handle}
        </p>
        {creator.bio === undefined ? null : (
          <p className="v-muted v-wrap" data-testid="creator-page-bio">
            {creator.bio}
          </p>
        )}

        {creator.links.length === 0 ? null : (
          <nav aria-label="Links this creator chose to show">
            <ul className="v-chip-set" data-testid="creator-page-links">
              {creator.links.map((link) => (
                <li key={link.url}>
                  {/*
                    A link somebody else supplied. `noopener` and `noreferrer`
                    keep the new document away from this one and stop this page's
                    address travelling with the click; `nofollow` keeps the
                    platform from lending its standing to a destination nobody
                    reviewed. The server never fetches any of these.
                  */}
                  <a
                    className="v-chip"
                    href={link.url}
                    rel="nofollow noopener noreferrer"
                  >
                    {link.label ?? link.url}
                    <Icon name="link" size="sm" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </article>
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
  media,
}: {
  readonly api: CreatorApi;
  readonly handle: string;
  readonly media: MediaAddressBook<MediaVariant>;
}) {
  const load = useCallback(
    async () => api.publicCatalog({ handle }),
    [api, handle],
  );
  const catalog = useResource<PublicCreatorCatalog>(load);
  // One exchange for the page. An item shows the image its creator put first,
  // and an item with none shows its words, which is an ordinary state rather
  // than a gap to apologise for.
  const covers = (catalog.value?.content ?? []).flatMap((item) => {
    const first = item.media[0]?.id;
    return first === undefined ? [] : [first];
  });
  const addresses = useAddressesFrom(covers, 'card', media);

  if (catalog.value === undefined) return null;
  return (
    <section
      aria-labelledby="creator-catalog-heading"
      className="v-stack v-stack--4"
    >
      <h2 className="v-label v-quiet" id="creator-catalog-heading">
        Published
      </h2>
      {catalog.value.content.length === 0 ? (
        <p className="v-small v-quiet" data-testid="creator-catalog-empty">
          Nothing published yet.
        </p>
      ) : (
        <ul className="v-stack v-stack--3" data-testid="creator-catalog">
          {catalog.value.content.map((item) => {
            const cover = addresses.get(item.media[0]?.id ?? '');
            return (
              <li key={item.id}>
                <Card>
                  {cover === undefined ? null : (
                    <div
                      className="v-item-cover"
                      data-testid={`creator-item-cover-${item.id}`}
                    >
                      {/* A plain element rather than the framework's optimised
                        one: the address is issued per request. */}
                      <img alt="" className="v-item-cover__image" src={cover} />
                    </div>
                  )}
                  <div className="v-stack v-stack--2">
                    <h3 className="v-subheading v-wrap">{item.title}</h3>
                    {item.summary === undefined ? null : (
                      <p className="v-small v-muted v-wrap">{item.summary}</p>
                    )}
                    {item.body === undefined ? null : (
                      <p className="v-small v-wrap">{item.body}</p>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
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
 * payment path exists, so a join button would be a lie regardless of what it did
 * when pressed. Access to a club comes from an invitation the creator sends,
 * which is not something a public page can offer.
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
    <section
      aria-labelledby="creator-clubs-heading"
      className="v-stack v-stack--4"
    >
      <h2 className="v-label v-quiet" id="creator-clubs-heading">
        Private clubs
      </h2>
      <ul className="v-stack v-stack--3" data-testid="creator-public-clubs">
        {clubs.value.clubs.map((club) => (
          <li key={club.slug}>
            <Card>
              <div className="v-stack v-stack--2">
                <div className="v-inline v-inline--between">
                  <h3 className="v-subheading v-wrap">{club.name}</h3>
                  <Badge tone="neutral">
                    <Icon name="lock" size="sm" />
                    By invitation
                  </Badge>
                </div>
                {club.description === undefined ? null : (
                  <p className="v-small v-muted v-wrap">{club.description}</p>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="v-caption v-quiet">
        Membership is by invitation from this creator. Nothing here can be
        bought.
      </p>
    </section>
  );
}
