'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { ClubDetail, MembershipOffer } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';

import {
  BlockedState,
  Button,
  Card,
  ErrorMessage,
  Notice,
  PageHeader,
  RowSkeleton,
  Segmented,
} from '../design/primitives';
import { useApi } from '../app/providers';
import { cadenceNames, commerceGateLabels, formatPrice } from './commerce';
import { useResource, useSingleFlight } from './resource';

/**
 * The last screen before money.
 *
 * Everything somebody is agreeing to, on one page, in the words the server
 * published: which creator, which club, the exact amount, the currency, how
 * often it recurs, and what happens next. Nothing here is an estimate and
 * nothing is rounded — the figure shown is the frozen price row a purchase
 * references, and the client never computes an amount of its own.
 *
 * What it deliberately does not have is a card field, and it has none because
 * there is none to have: collection happens on the provider's own page, under
 * the provider's own compliance scope, and no primary account number reaches a
 * VELORA process. The button leaves this site.
 *
 * The disclosures are not decoration. A recurring charge, the absence of a
 * stated tax treatment, and the fact that cancelling is not the same as a
 * refund are all things somebody would otherwise discover afterwards, which is
 * the worst moment to discover them.
 */
export function JoinClub({
  handle,
  slug,
}: {
  readonly handle: string;
  readonly slug: string;
}) {
  const api = useApi();
  const loadClub = useCallback(
    async (signal: AbortSignal) => api.club({ handle, slug }, signal),
    [api, handle, slug],
  );
  const club = useResource<ClubDetail>(loadClub);
  const loadOffers = useCallback(
    async (signal: AbortSignal) => api.membershipOffers(handle, signal),
    [api, handle],
  );
  const offers = useResource(loadOffers);

  const clubId = club.value?.club.id;
  const offer = useMemo((): MembershipOffer | undefined => {
    if (clubId === undefined) return undefined;
    return (offers.value?.offers ?? []).find(
      (candidate) => candidate.resource.id === clubId,
    );
  }, [clubId, offers.value]);

  const prices = offer?.prices ?? [];
  const [priceId, setPriceId] = useState<string | undefined>(undefined);
  const chosen = prices.find((price) => price.id === priceId) ?? prices[0];
  const gates = offers.value?.gates ?? [];
  const enabled = offers.value?.readiness.enabled ?? false;

  const { busy, run } = useSingleFlight();
  const [error, setError] = useState<string | undefined>(undefined);
  // Held across attempts on purpose. A retry after a lost answer must present
  // the key the first attempt presented, or the server has nothing to
  // recognise the second by — which for money is the difference between one
  // charge and two. Keyed by price, so choosing a different cadence is a
  // different purchase rather than a retry of the first one.
  const intent = useRef(new Map<string, string>());

  const back = `/c/${handle}/club/${slug}`;

  if (club.loading && club.value === undefined) {
    return (
      <>
        <PageHeader title="Join" />
        <Card>
          <RowSkeleton rows={3} />
        </Card>
      </>
    );
  }

  if (club.value === undefined) {
    return (
      <>
        <PageHeader title="Join" />
        <Card>
          <ErrorMessage testId="join-missing">
            There is nothing to join at this address.
          </ErrorMessage>
        </Card>
      </>
    );
  }

  const detail = club.value;

  if (detail.club.membership !== undefined) {
    return (
      <>
        <PageHeader lede={detail.club.name} title="You are already in" />
        <Card>
          <div className="v-stack v-stack--3">
            <p className="v-small v-muted">
              Nothing more to do. This club is open to you.
            </p>
            <div>
              <Link className="v-btn v-btn--primary" href={back}>
                Open the club
              </Link>
            </div>
          </div>
        </Card>
      </>
    );
  }

  if (!enabled || prices.length === 0 || chosen === undefined) {
    return (
      <>
        <PageHeader lede={detail.club.name} title="Join" />
        <BlockedState testId="join-unavailable" title="This is not for sale">
          <p>
            {prices.length === 0
              ? 'Membership of this club is by invitation from its creator. There is nothing to buy here.'
              : 'Nothing on VELORA can be bought yet: no payment provider is approved for what it does.'}
          </p>
        </BlockedState>
        <div>
          <Link className="v-btn v-btn--secondary" href={back}>
            Back to the club
          </Link>
        </div>
      </>
    );
  }

  if (gates.length > 0) {
    return (
      <>
        <PageHeader lede={detail.club.name} title="Join" />
        <BlockedState
          testId="join-blocked"
          title="VELORA cannot sell this to you"
        >
          <ul className="v-benefits">
            {gates.map((gate) => (
              <li key={gate}>{commerceGateLabels[gate] ?? gate}</li>
            ))}
          </ul>
          <p>
            None of this is something you can change from here, and nothing has
            been charged.
          </p>
        </BlockedState>
        <div>
          <Link className="v-btn v-btn--secondary" href={back}>
            Back to the club
          </Link>
        </div>
      </>
    );
  }

  const start = () => {
    run(async () => {
      setError(undefined);
      // One key per cadence. Holding a single key across a change of mind
      // would present the key of a monthly purchase for a yearly one, which
      // the server refuses as a different purchase wearing a used key.
      const idempotencyKey =
        intent.current.get(chosen.id) ?? crypto.randomUUID();
      intent.current.set(chosen.id, idempotencyKey);
      const result = await api.startCheckout({
        body: {
          currency: chosen.amount.currency,
          // Named rather than inferred. An offer may publish a monthly price
          // and a yearly one in the same currency, and a request that did not
          // say which is a request the server refuses rather than guesses.
          ...(chosen.interval === undefined
            ? {}
            : { interval: chosen.interval }),
          offerId: offer?.id ?? '',
        },
        idempotencyKey,
      });
      if (result.kind !== 'ok') {
        setError(failureMessage(result) ?? 'This could not be started.');
        return;
      }
      const redirect = result.value.redirectUrl;
      if (redirect === undefined) {
        // A replay. The operation already exists, so the honest thing is to
        // send somebody to its state rather than to invent a second link.
        globalThis.location.assign(
          `/checkout/return?payment=${encodeURIComponent(result.value.payment.id)}`,
        );
        return;
      }
      // The provider's own page. VELORA renders no card field anywhere,
      // because there is none to render.
      globalThis.location.assign(redirect);
    });
  };

  return (
    <>
      <PageHeader
        lede={`@${detail.creatorHandle}`}
        title={`Join ${detail.club.name}`}
      />

      <Card testId="join-summary">
        <div className="v-stack v-stack--4">
          {detail.club.benefits.length === 0 ? null : (
            <ul className="v-benefits">
              {detail.club.benefits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          {prices.length === 1 ? null : (
            <Segmented
              // A choice inside a form, not a tab: nothing else on the page
              // is replaced by picking a cadence.
              as="radiogroup"
              label="How often you pay"
              onChange={setPriceId}
              options={prices.map((price) => ({
                label:
                  price.interval === undefined
                    ? 'One payment'
                    : (cadenceNames[price.interval] ?? price.interval),
                value: price.id,
              }))}
              value={chosen.id}
            />
          )}

          <dl className="v-summary" data-testid="join-terms">
            <div>
              <dt>Amount</dt>
              <dd className="v-numeric">{formatPrice(chosen.amount)}</dd>
            </div>
            <div>
              <dt>Charged</dt>
              <dd>
                {chosen.interval === undefined
                  ? 'Once'
                  : `Every ${chosen.interval}, until you stop it`}
              </dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                Everything published in {detail.club.name}, for as long as the
                membership is live
              </dd>
            </div>
          </dl>

          <Notice icon="info" testId="join-disclosures" tone="quiet">
            <p>
              You pay on the payment provider&apos;s own page. VELORA never sees
              a card number, and there is no field on this site that could carry
              one.
            </p>
            {chosen.interval === undefined ? null : (
              <p>
                This renews on its own. You can stop it at any time from
                Memberships, and you keep access until the period you have paid
                for ends.
              </p>
            )}
            <p>
              Stopping a membership is not a refund. VELORA has published no
              refund terms, so nothing here promises one.
            </p>
            <p>
              No tax is shown, because VELORA has no approved way to say what
              would be owed. The amount above is the whole amount you will be
              charged.
            </p>
          </Notice>

          {error === undefined ? null : (
            <ErrorMessage testId="join-error">{error}</ErrorMessage>
          )}

          <div className="v-inline v-inline--tight">
            <Button
              busy={busy}
              data-testid="join-confirm"
              onClick={start}
              tone="primary"
            >
              Continue to payment
            </Button>
            <Link className="v-btn v-btn--secondary" href={back}>
              Not now
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
