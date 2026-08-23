'use client';

import { useCallback, useMemo } from 'react';

import type {
  CommercialOffer,
  CreatorClubList,
  MonetisationReadiness,
} from '@velora/creator-client';
import { formatMoney } from '@velora/creator-client';

import {
  Badge,
  BlockedState,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  PageHeader,
  RowSkeleton,
} from '../design/primitives';
import { useApi } from '../app/providers';
import {
  formatDate,
  offerModeLabels,
  offerStateLook,
  priceIntervalLabels,
} from './format';
import { MoneyNav } from './money-nav';
import { useCollection, useResource } from './resource';

/**
 * What a creator sells, and what the platform may currently sell it for.
 *
 * The readiness statement is the point of this screen today. No payment
 * provider is approved for VELORA's business model and no commercial terms are
 * published — no platform fee, no revenue share, no currency, no price bound,
 * no cadence — so nothing can be made purchasable, and a creator is entitled to
 * be told that plainly rather than meeting a price field that cannot succeed.
 *
 * There is deliberately no control here for creating an offer or publishing a
 * price. Both operations exist in the API and both refuse in every deployed
 * environment, so a form would be a form that always fails. The controls belong
 * here the day approved terms exist, and they will appear because the server
 * says commerce is enabled rather than because a build flag does.
 *
 * A price shown here is the exact frozen row a purchase would reference.
 * Nothing on this screen is a suggested price, an estimate, or an example.
 */

const offersPageSize = 25;

export function Selling() {
  const api = useApi();

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.offers({ cursor, pageSize: offersPageSize });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.offers,
              meta: result.value.readiness,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api],
  );
  const offers = useCollection<CommercialOffer, MonetisationReadiness>(load);

  const loadClubs = useCallback(async () => api.clubs({ pageSize: 50 }), [api]);
  const clubs = useResource<CreatorClubList>(loadClubs);
  const clubNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const club of clubs.value?.clubs ?? []) names.set(club.id, club.name);
    return names;
  }, [clubs.value]);

  const readiness = offers.meta;
  const enabled = readiness?.enabled ?? false;

  return (
    <>
      <PageHeader
        lede="Whether anything of yours can be bought, and on what terms."
        title="Money"
      />
      <MoneyNav />

      {readiness === undefined || enabled ? null : (
        <BlockedState
          label="Not available yet"
          testId="offers-readiness"
          title="Nothing on VELORA can be sold yet"
        >
          <p>
            No payment provider is approved for VELORA and no pricing terms are
            published — no platform share, no currencies, no price limits, no
            billing cadence — so nothing you have can be made purchasable.
          </p>
          <p>
            There is no form here for a reason. A price field that always
            refuses is worse than an explanation, and this is not something you
            can complete from your side.
          </p>
        </BlockedState>
      )}

      <Card flush testId="offers-list">
        <CardHead
          lede="Anything VELORA holds against your work. A price here is the exact figure a purchase would use, never a suggestion."
          title="Your offers"
        />
        {offers.error !== undefined && offers.items.length === 0 ? (
          <ErrorState
            body={offers.error}
            onRetry={offers.retryable ? offers.reload : undefined}
            testId="offers-failed"
          />
        ) : offers.loading && offers.items.length === 0 ? (
          <RowSkeleton rows={2} />
        ) : offers.items.length === 0 ? (
          <EmptyState
            body="Nothing of yours has a commercial offer against it, and nothing can have one until VELORA can sell."
            icon="ledger"
            testId="offers-empty"
            title="You have no offers"
          />
        ) : (
          <ul className="s-list">
            {offers.items.map((offer) => (
              <li key={offer.id}>
                <OfferRow
                  clubName={clubNames.get(offer.resourceId)}
                  offer={offer}
                />
              </li>
            ))}
          </ul>
        )}
        {offers.hasMore ? (
          <div className="s-card__pad s-card__pad--block">
            <Button
              block
              busy={offers.loadingMore}
              data-testid="offers-more"
              onClick={offers.loadMore}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}

function OfferRow({
  clubName,
  offer,
}: {
  readonly clubName: string | undefined;
  readonly offer: CommercialOffer;
}) {
  const state = offerStateLook(offer.state);
  const live = offer.prices.filter((price) => price.state === 'active');

  return (
    <ListRow testId={`offer-${offer.id}`}>
      <span className="s-subheading">
        {offerModeLabels[offer.mode] ?? 'Offer'}
        {clubName === undefined ? null : ` · ${clubName}`}
      </span>
      <span className="s-inline s-inline--tight">
        <Badge icon={state.icon} tone={state.tone}>
          {state.label}
        </Badge>
        {live.length === 0 ? (
          <Chip>No price published</Chip>
        ) : (
          live.map((price) => (
            <Chip key={price.id}>
              <span className="s-numeric">{formatMoney(price.amount)}</span>
              {price.interval === undefined
                ? null
                : ` ${priceIntervalLabels[price.interval] ?? ''}`}
            </Chip>
          ))
        )}
        <span className="s-caption s-quiet">
          Created {formatDate(offer.createdAt)}
        </span>
      </span>
    </ListRow>
  );
}
