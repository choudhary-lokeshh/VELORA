'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';

import type {
  ConsumerApi,
  ConsumerSubscription,
  GiftCatalog,
  GiftCatalogItem,
  MembershipOffer,
  PublicClub,
} from '@velora/consumer-client';
import { createConsumerApi, failureMessage } from '@velora/consumer-client';
import { formatMinorUnits } from '@velora/validation';

import {
  createCreatorApi,
  createMediaAddressBook,
  type CreatorApi,
  type MediaAddressBook,
  type MediaVariant,
  type PublicCreator,
  type PublicCreatorCatalog,
} from '@velora/creator-client';

import { Icon } from '../design/icons';
import { ConfirmDialog } from '../design/dialog';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ErrorMessage,
  Skeleton,
} from '../design/primitives';
import { backTarget, signInHref } from '../app/navigation';
import { useApi, useSession, useToast } from '../app/providers';
import {
  cadenceLabels,
  commerceGateLabels,
  formatPrice,
  membershipSourceLabels,
  subscriptionStateMeaning,
} from './commerce';
import { GiftArt } from './gift-art';
import { useAddressesFrom } from './imagery';
import { useResource } from './resource';

/**
 * A creator's public page.
 *
 * The only VELORA surface a person with no account is meant to reach, and the
 * only one whose whole job is to render somebody else. Everything it shows came
 * from the explicitly public projection the server publishes: there is no
 * creator identifier, no account state, and no member count, because none of
 * those are in the response and none could be added here without the server
 * deciding to publish them first. The signed-in gift control is a separate
 * BILLING projection; it never widens this public creator projection.
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
  consumerApi,
  signedIn = false,
  showToast,
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the page renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
  readonly handle: string;
  readonly consumerApi?: ConsumerApi;
  readonly signedIn?: boolean;
  readonly showToast?: (message: string, tone: 'critical' | 'positive') => void;
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

  /*
   * This page is public and sits outside the application shell, so it carries
   * its own way back. It appears only for somebody who arrived from inside the
   * product: a visitor who followed a creator's link from elsewhere has no
   * VELORA page behind them, and offering them "back" to Discover would be
   * inventing a history they never had.
   */
  /*
   * A consumer view of the same public routes for somebody with no session.
   *
   * The membership answer is public — a price is not a secret — but a session
   * adds two things to it: whether this person already holds the club, and
   * which eligibility gates are shut for them. Rather than keep two code paths,
   * the section takes whichever client is available and the server decides how
   * much of the answer it is entitled to.
   */
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

  const arrivedFrom = useSearchParams().get('from');
  const back =
    arrivedFrom === null ? undefined : backTarget(usePathname(), arrivedFrom);

  return (
    <div className="v-landing">
      <header className="v-landing__bar">
        {back === undefined ? null : (
          <Link
            aria-label="Back"
            className="v-icon-btn"
            data-testid="topbar-back"
            href={back}
          >
            <Icon name="arrowLeft" size="md" />
          </Link>
        )}
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
            <GiftPicker
              api={consumerApi}
              handle={handle}
              showToast={showToast}
              signedIn={signedIn}
            />
            <CreatorCatalogView api={api} handle={handle} media={media} />
            <CreatorMembershipsView
              api={consumerApi ?? visitorApi}
              handle={handle}
              signedIn={signedIn}
            />
          </div>
        )}
      </main>
    </div>
  );
}

/** Binds the public projection to the optional signed-in gift experience. */
export function ConnectedCreatorPublicPage(props: {
  readonly apiBaseUrl: string;
  readonly handle: string;
}) {
  const api = useApi();
  const session = useSession();
  const toast = useToast();
  return (
    <CreatorPublicPage
      {...props}
      consumerApi={api}
      showToast={(message, tone) => {
        toast.show(message, tone);
      }}
      signedIn={session.signedIn}
    />
  );
}

function GiftPicker({
  api,
  handle,
  showToast,
  signedIn,
}: {
  readonly api: ConsumerApi | undefined;
  readonly handle: string;
  readonly showToast:
    ((message: string, tone: 'critical' | 'positive') => void) | undefined;
  readonly signedIn: boolean;
}) {
  const load = useCallback(
    async () =>
      api === undefined
        ? ({ kind: 'unavailable' } as const)
        : api.giftCatalog({ currency: 'USD', handle }),
    [api, handle],
  );
  const catalog = useResource<GiftCatalog>(load, {
    enabled: signedIn && api !== undefined,
  });
  const [selected, setSelected] = useState<GiftCatalogItem>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<GiftCatalogItem>();
  const inFlight = useRef(false);
  const intentKey = useRef<string | undefined>(undefined);

  if (!signedIn) {
    return (
      <Card>
        <div className="v-stack v-stack--3">
          <h2 className="v-heading">Send a gift</h2>
          <p className="v-small v-muted">
            Sign in to support this creator with a virtual gift.
          </p>
          <div>
            <Link
              className="v-btn v-btn--secondary"
              href={signInHref(`/c/${handle}`)}
            >
              Sign in to choose
            </Link>
          </div>
        </div>
      </Card>
    );
  }
  if (catalog.loading && catalog.value === undefined) {
    return (
      <Card>
        <Skeleton height={120} width="100%" />
      </Card>
    );
  }
  if (catalog.value?.enabled !== true) {
    return (
      <Card>
        <div className="v-stack v-stack--3">
          <h2 className="v-heading">Send a gift</h2>
          <p className="v-small v-muted">
            Gifts are not available for this creator right now.
          </p>
          {catalog.retryable ? (
            <div>
              <Button onClick={catalog.reload}>Try again</Button>
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  const send = async () => {
    if (selected === undefined || api === undefined || inFlight.current) return;
    const idempotencyKey = intentKey.current ?? crypto.randomUUID();
    intentKey.current = idempotencyKey;
    inFlight.current = true;
    try {
      setBusy(true);
      const result = await api.sendGift({
        body: {
          context: { type: 'creator_profile' },
          currency: selected.price.currency,
          giftItemId: selected.id,
          handle,
        },
        idempotencyKey,
      });
      if (result.kind === 'ok') {
        setConfirming(false);
        if (result.value.gift.state === 'sent') {
          setSent(selected);
          intentKey.current = undefined;
          showToast?.(`${selected.name} sent.`, 'positive');
        } else if (result.value.gift.state === 'pending') {
          setSent(undefined);
          showToast?.(
            'Gift not sent yet. Payment confirmation is pending.',
            'critical',
          );
        } else {
          setSent(undefined);
          intentKey.current = undefined;
          showToast?.('Gift payment failed. Nothing was sent.', 'critical');
        }
        return;
      }
      showToast?.(
        failureMessage(result) ?? 'Gift could not be sent.',
        'critical',
      );
    } catch {
      showToast?.('Gift could not be sent.', 'critical');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="gift-picker-heading"
      className={`v-card v-gifts${sent === undefined ? '' : ' v-gifts--sent'}`}
    >
      <div className="v-stack v-stack--3">
        <div>
          <h2 className="v-heading" id="gift-picker-heading">
            Send a gift
          </h2>
          <p className="v-small v-muted">
            Choose a gesture of support. A gift provides no access or
            entitlement.
          </p>
        </div>
        <ul className="v-gift-grid">
          {catalog.value.items.map((item) => (
            <li key={item.id}>
              <button
                aria-pressed={selected?.id === item.id}
                className="v-gift-choice"
                data-testid={`gift-choice-${item.visual}`}
                onClick={() => {
                  setSelected(item);
                  setSent(undefined);
                  intentKey.current = crypto.randomUUID();
                }}
                type="button"
              >
                <GiftArt visual={item.visual} />
                <span className="v-gift-choice__name">{item.name}</span>
                <span className="v-caption v-quiet">
                  {formatGiftPrice(item)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button
          block
          disabled={selected === undefined}
          onClick={() => {
            setConfirming(true);
          }}
          tone="primary"
        >
          {selected === undefined ? 'Choose a gift' : `Send ${selected.name}`}
        </Button>
        {sent === undefined ? null : (
          <p aria-live="polite" className="v-gift-success">
            Gift sent. Thank you for supporting this creator.
          </p>
        )}
      </div>
      {confirming && selected !== undefined ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel={`Send ${selected.name}`}
          confirmTone="primary"
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            void send();
          }}
          testId="gift-confirm"
          title="Confirm gift"
        >
          <p>
            You are sending {selected.name} for {formatGiftPrice(selected)}.
            This supports the creator and unlocks no content.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function formatGiftPrice(item: GiftCatalogItem): string {
  return `${formatMinorUnits(item.price.amountMinor, item.price.currency)} ${item.price.currency}`;
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
    <article aria-labelledby="creator-name" data-testid="creator-page">
      {cover === undefined ? null : (
        /* A band above the identity rather than a picture beside it, and its
           own element rather than a child of the hero: the hero is a row on a
           wide viewport, so a cover inside it would sit next to the avatar. It
           is drawn only when there is genuinely one to draw. */
        <div className="v-creator-cover" data-testid="creator-page-cover">
          {/* A plain element rather than the framework's optimised one: the
              address is issued per request and cannot be fetched upstream. */}
          <img alt="" className="v-creator-cover__image" src={cover} />
        </div>
      )}
      <div className="v-profile-hero">
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
          <p
            className="v-small v-quiet v-wrap"
            data-testid="creator-page-handle"
          >
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
/**
 * What this creator sells, and what a visitor already holds.
 *
 * Two answers joined here rather than on a server. PRIVATE CLUBS publishes what
 * a club is — its name, what its creator promises, and whether this person is
 * already in it — and BILLING publishes what it costs against the same opaque
 * identifier. Neither domain reads the other, and neither route knows the other
 * exists; the join happens on the surface that asked for both, which is where a
 * join between two owners belongs.
 *
 * A club with no offer still appears. Invitation-only clubs are a real product
 * and always have been, and hiding one because nobody priced it would make the
 * page a catalogue of what is for sale rather than of what the creator has.
 */
function CreatorMembershipsView({
  api,
  handle,
  signedIn,
}: {
  readonly api: ConsumerApi;
  readonly handle: string;
  readonly signedIn: boolean;
}) {
  const loadClubs = useCallback(
    async (signal: AbortSignal) => api.publicClubs(handle, signal),
    [api, handle],
  );
  const loadOffers = useCallback(
    async (signal: AbortSignal) => api.membershipOffers(handle, signal),
    [api, handle],
  );
  const clubs = useResource(loadClubs);
  const offers = useResource(loadOffers);

  const offerByResource = useMemo(() => {
    const found = new Map<string, MembershipOffer>();
    for (const offer of offers.value?.offers ?? []) {
      found.set(offer.resource.id, offer);
    }
    return found;
  }, [offers.value]);
  const subscriptionByOffer = useMemo(() => {
    const found = new Map<string, ConsumerSubscription>();
    for (const held of offers.value?.subscriptions ?? []) {
      // Newest first from the server, so the first one seen is the current
      // relationship and an older ended one never overwrites it.
      if (!found.has(held.offerId)) found.set(held.offerId, held);
    }
    return found;
  }, [offers.value]);

  const rows = clubs.value?.clubs ?? [];
  if (rows.length === 0) return null;
  const gates = offers.value?.gates ?? [];
  const enabled = offers.value?.readiness.enabled ?? false;

  return (
    <section
      aria-labelledby="creator-clubs-heading"
      className="v-stack v-stack--4"
    >
      <h2 className="v-label v-quiet" id="creator-clubs-heading">
        Private clubs
      </h2>
      <ul className="v-stack v-stack--3" data-testid="creator-public-clubs">
        {rows.map((club) => {
          const offer = offerByResource.get(club.id);
          const held =
            offer === undefined ? undefined : subscriptionByOffer.get(offer.id);
          return (
            <li key={club.slug}>
              <MembershipCard
                club={club}
                commerceEnabled={enabled}
                gates={gates}
                handle={handle}
                held={held}
                offer={offer}
                signedIn={signedIn}
              />
            </li>
          );
        })}
      </ul>
      {enabled ? null : (
        <p className="v-caption v-quiet" data-testid="creator-clubs-blocked">
          Nothing on VELORA can be bought yet: no payment provider is approved
          for what it does. Membership of these clubs is by invitation from this
          creator.
        </p>
      )}
    </section>
  );
}

function MembershipCard({
  club,
  commerceEnabled,
  gates,
  handle,
  held,
  offer,
  signedIn,
}: {
  readonly club: PublicClub;
  readonly commerceEnabled: boolean;
  readonly gates: readonly string[];
  readonly handle: string;
  readonly held: ConsumerSubscription | undefined;
  readonly offer: MembershipOffer | undefined;
  readonly signedIn: boolean;
}) {
  const prices = offer?.prices ?? [];
  const member = club.membership !== undefined;
  const live =
    held !== undefined &&
    (held.state === 'active' || held.state === 'cancel_at_period_end');

  return (
    <Card>
      <div className="v-stack v-stack--3">
        <div className="v-inline v-inline--between">
          <h3 className="v-subheading v-wrap">{club.name}</h3>
          {member ? (
            <Badge tone="positive">
              <Icon name="check" size="sm" />
              You are in
            </Badge>
          ) : prices.length === 0 ? (
            <Badge tone="neutral">
              <Icon name="lock" size="sm" />
              By invitation
            </Badge>
          ) : null}
        </div>

        {club.description === undefined ? null : (
          <p className="v-small v-muted v-wrap">{club.description}</p>
        )}

        {club.benefits.length === 0 ? null : (
          <ul className="v-benefits" data-testid={`club-benefits-${club.slug}`}>
            {club.benefits.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {prices.length === 0 ? null : (
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
        )}

        {member ? (
          <>
            <p className="v-caption v-quiet">
              {held === undefined
                ? (membershipSourceLabels[club.membership?.source ?? ''] ??
                  'Access granted')
                : subscriptionStateMeaning[held.state]}
            </p>
            <div className="v-inline v-inline--tight">
              <Link
                className="v-btn v-btn--primary"
                data-testid={`club-open-${club.slug}`}
                href={`/c/${handle}/club/${club.slug}`}
              >
                Open the club
              </Link>
              {live ? (
                <Link
                  className="v-btn v-btn--secondary"
                  href="/you/memberships"
                >
                  Manage membership
                </Link>
              ) : null}
            </div>
          </>
        ) : prices.length === 0 ? (
          <p className="v-caption v-quiet">
            Membership is by invitation from this creator. There is nothing to
            buy here.
          </p>
        ) : !signedIn ? (
          <div>
            <Link
              className="v-btn v-btn--primary"
              data-testid={`club-join-signin-${club.slug}`}
              href={signInHref(`/c/${handle}`)}
            >
              Sign in to join
            </Link>
          </div>
        ) : !commerceEnabled || gates.length > 0 ? (
          <div
            className="v-stack v-stack--2"
            data-testid={`club-join-blocked-${club.slug}`}
          >
            <p className="v-caption v-quiet">You cannot join this today.</p>
            <ul className="v-benefits">
              {(gates.length > 0 ? gates : ['payment_capability']).map(
                (gate) => (
                  <li key={gate}>{commerceGateLabels[gate] ?? gate}</li>
                ),
              )}
            </ul>
          </div>
        ) : (
          <div>
            <Link
              className="v-btn v-btn--primary"
              data-testid={`club-join-${club.slug}`}
              href={`/c/${handle}/club/${club.slug}/join`}
            >
              Join this club
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}
