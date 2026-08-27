'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import type {
  ClubDetail,
  ConsumerApi,
  MediaVariant,
  MembershipOffer,
} from '@velora/consumer-client';
import {
  createConsumerApi,
  createMediaAddressBook,
} from '@velora/consumer-client';

import { Icon } from '../design/icons';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorMessage,
  Skeleton,
} from '../design/primitives';
import { backTarget } from '../app/navigation';
import { useApi, useSession } from '../app/providers';
import { cadenceLabels, formatPrice, membershipSourceLabels } from './commerce';
import { useAddressesFrom } from './imagery';
import { formatDay } from './locale';
import { useResource } from './resource';

/**
 * A private club as its own destination.
 *
 * Safe to reach by typed address, and that is the property the whole screen is
 * built around. The server decides on every request whether this person may
 * read the feed, and answers with an empty one when they may not — so there is
 * no protected body, summary, or image reference in the response to hide. A
 * locked state assembled by not rendering fields would be a locked state
 * anybody could open with a developer console.
 *
 * The three states it has to be honest about are all real and all different. A
 * member reads the feed. Somebody who could buy their way in is offered that.
 * Somebody who cannot — because they are signed out, because VELORA may not
 * sell to them, or because this club has no offer and never had one — is told
 * which of those it is rather than meeting a control that refuses.
 */
export function ClubDestination({
  apiBaseUrl,
  consumerApi,
  fetchImplementation,
  handle,
  signedIn = false,
  slug,
}: {
  readonly apiBaseUrl: string;
  readonly consumerApi?: ConsumerApi;
  /** Injected by tests so the page renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
  readonly handle: string;
  readonly signedIn?: boolean;
  readonly slug: string;
}) {
  // The same arrangement the public creator page uses: this screen sits outside
  // the signed-in shell because a visitor with no account may reach it, so it
  // builds its own client when there is no session to borrow one from.
  const visitorApi = useMemo(
    () =>
      createConsumerApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
        transport: { headers: () => Promise.resolve({}) },
      }),
    [apiBaseUrl, fetchImplementation],
  );
  const api = consumerApi ?? visitorApi;

  const load = useCallback(
    async (signal: AbortSignal) => api.club({ handle, slug }, signal),
    [api, handle, slug],
  );
  const detail = useResource<ClubDetail>(load);

  const loadOffers = useCallback(
    async (signal: AbortSignal) => api.membershipOffers(handle, signal),
    [api, handle],
  );
  const offers = useResource(loadOffers);

  const media = useMemo(
    () =>
      createMediaAddressBook<MediaVariant>({
        exchange: async (request) => api.mediaDeliveries(request),
      }),
    [api],
  );
  const covers = (detail.value?.content ?? []).flatMap((item) => {
    const first = item.media[0]?.id;
    return first === undefined ? [] : [first];
  });
  const addresses = useAddressesFrom(covers, 'card', media);

  // Always a way out, and never a guessed one. Unlike the public creator page,
  // a club always has somewhere to go: its declared parent is the creator's own
  // page, which exists by construction. A carried `from` only refines that.
  const back = backTarget(usePathname(), useSearchParams().get('from'));

  const club = detail.value?.club;
  const offer = useMemo((): MembershipOffer | undefined => {
    if (club === undefined) return undefined;
    return (offers.value?.offers ?? []).find(
      (candidate) => candidate.resource.id === club.id,
    );
  }, [club, offers.value]);

  return (
    <div className="v-landing">
      <header className="v-landing__bar">
        <Link
          aria-label="Back"
          className="v-icon-btn"
          data-testid="topbar-back"
          href={back ?? `/c/${handle}`}
        >
          <Icon name="arrowLeft" size="md" />
        </Link>
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
        {detail.loading && detail.value === undefined ? (
          <div className="v-stack v-stack--5" data-testid="club-page-loading">
            <p className="v-visually-hidden" role="status">
              Loading
            </p>
            <Skeleton height={24} width="40%" />
            <Skeleton height={14} width="80%" />
          </div>
        ) : null}

        {detail.value === undefined && !detail.loading ? (
          <section className="v-stack v-stack--5">
            <h1 className="v-title">This club is not available</h1>
            <ErrorMessage testId="club-page-missing">
              There is nothing to show at this address.
            </ErrorMessage>
            {detail.retryable ? (
              <div>
                <Button onClick={detail.reload}>Try again</Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {detail.value === undefined || club === undefined ? null : (
          <div className="v-stack v-stack--8">
            <section className="v-stack v-stack--3">
              <p className="v-label v-quiet">
                <Link href={`/c/${detail.value.creatorHandle}`}>
                  @{detail.value.creatorHandle}
                </Link>
              </p>
              <div className="v-inline v-inline--between">
                <h1 className="v-title v-wrap">{club.name}</h1>
                {club.membership === undefined ? (
                  <Badge tone="neutral">
                    <Icon name="lock" size="sm" />
                    Members only
                  </Badge>
                ) : (
                  <Badge tone="positive">
                    <Icon name="check" size="sm" />
                    You are in
                  </Badge>
                )}
              </div>
              {club.description === undefined ? null : (
                <p className="v-body v-wrap">{club.description}</p>
              )}
              {club.benefits.length === 0 ? null : (
                <ul className="v-benefits" data-testid="club-benefits">
                  {club.benefits.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {club.membership === undefined ? null : (
                <p className="v-caption v-quiet" data-testid="club-membership">
                  {membershipSourceLabels[club.membership.source] ??
                    'Access granted'}
                  {' · joined '}
                  {formatDay(club.membership.grantedAt)}
                </p>
              )}
            </section>

            {club.membership === undefined ? (
              <LockedClub
                gates={offers.value?.gates ?? []}
                handle={handle}
                offer={offer}
                signedIn={signedIn}
                slug={slug}
              />
            ) : (
              <section
                aria-labelledby="club-feed-heading"
                className="v-stack v-stack--4"
              >
                <h2 className="v-label v-quiet" id="club-feed-heading">
                  Members only
                </h2>
                {detail.value.content.length === 0 ? (
                  <p className="v-small v-quiet" data-testid="club-feed-empty">
                    Nothing has been published in this club yet. What appears
                    here is written by the creator, for its members.
                  </p>
                ) : (
                  <ul className="v-stack v-stack--3" data-testid="club-feed">
                    {detail.value.content.map((item) => {
                      const cover = addresses.get(item.media[0]?.id ?? '');
                      return (
                        <li key={item.id}>
                          <Card>
                            {cover === undefined ? null : (
                              <div
                                className="v-item-cover"
                                data-testid={`club-item-cover-${item.id}`}
                              >
                                {/* A plain element rather than the framework's
                                  optimised one: the address is issued per
                                  request and expires. */}
                                <img
                                  alt=""
                                  className="v-item-cover__image"
                                  src={cover}
                                />
                              </div>
                            )}
                            <div className="v-stack v-stack--2">
                              <h3 className="v-subheading v-wrap">
                                {item.title}
                              </h3>
                              {item.summary === undefined ? null : (
                                <p className="v-small v-muted v-wrap">
                                  {item.summary}
                                </p>
                              )}
                              {item.body === undefined ? null : (
                                <p className="v-body v-wrap">{item.body}</p>
                              )}
                              <p className="v-caption v-quiet">
                                <time dateTime={item.publishedAt}>
                                  {formatDay(item.publishedAt)}
                                </time>
                              </p>
                            </div>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * What somebody outside the club is told.
 *
 * Never "you do not have permission". Each of these is a different fact with a
 * different thing the reader could do about it, and collapsing them into one
 * message would leave somebody who could simply sign in believing they had been
 * turned away.
 */
function LockedClub({
  gates,
  handle,
  offer,
  signedIn,
  slug,
}: {
  readonly gates: readonly string[];
  readonly handle: string;
  readonly offer: MembershipOffer | undefined;
  readonly signedIn: boolean;
  readonly slug: string;
}) {
  const prices = offer?.prices ?? [];
  return (
    <Card testId="club-locked">
      <div className="v-stack v-stack--3">
        <h2 className="v-heading">You are not in this club</h2>
        {prices.length === 0 ? (
          <p className="v-small v-muted">
            Membership of this club is by invitation from its creator. There is
            nothing to buy here, and there is no way to ask.
          </p>
        ) : (
          <>
            <p className="v-small v-muted">
              What its members read is not published here.
            </p>
            <div className="v-inline v-inline--tight">
              {prices.map((price) => (
                <Chip key={price.id}>
                  <span className="v-numeric">{formatPrice(price.amount)}</span>
                  {price.interval === undefined
                    ? null
                    : ` ${cadenceLabels[price.interval] ?? ''}`}
                </Chip>
              ))}
            </div>
            <div>
              {signedIn ? (
                gates.length === 0 ? (
                  <Link
                    className="v-btn v-btn--primary"
                    data-testid="club-join"
                    href={`/c/${handle}/club/${slug}/join`}
                  >
                    Join this club
                  </Link>
                ) : null
              ) : (
                <Link
                  className="v-btn v-btn--primary"
                  data-testid="club-join-signin"
                  href={`/sign-in?returnTo=${encodeURIComponent(`/c/${handle}/club/${slug}`)}`}
                >
                  Sign in to join
                </Link>
              )}
            </div>
          </>
        )}
        {signedIn && prices.length > 0 && gates.length > 0 ? (
          <p className="v-caption v-quiet" data-testid="club-join-blocked">
            You cannot join this today. Nothing about that is something you can
            fix from here.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** Binds the destination to the signed-in session when there is one. */
export function ConnectedClubPage(props: {
  readonly apiBaseUrl: string;
  readonly handle: string;
  readonly slug: string;
}) {
  const api = useApi();
  const session = useSession();
  return (
    <ClubDestination
      {...props}
      {...(session.signedIn ? { consumerApi: api } : {})}
      signedIn={session.signedIn}
    />
  );
}
