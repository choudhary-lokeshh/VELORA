'use client';

import { useCallback } from 'react';

import type { CommercialOfferList, CreatorApi } from '@velora/creator-client';
import { formatMoney } from '@velora/creator-client';

import { useResource } from './resource';
import { EmptyState, ResourceState, Section, StatusMessage } from './ui';

/**
 * What a creator sells, and what the platform may currently sell it for.
 *
 * The readiness statement is the point of this screen today. No payment
 * provider is approved for Velora's business model and no commercial terms are
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
export function Offers({
  api,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  readonly onSessionEnded: () => void;
}) {
  const load = useCallback(async () => api.offers(), [api]);
  const offers = useResource<CommercialOfferList>(load, {
    onUnauthenticated: onSessionEnded,
  });
  const readiness = offers.value?.readiness;
  const rows = offers.value?.offers ?? [];

  return (
    <Section headingId="offers-heading" title="Selling">
      <ResourceState resource={offers} testId="offers" />

      {readiness === undefined ? null : (
        <StatusMessage testId="offers-readiness">
          {readiness.enabled
            ? `Selling is enabled in ${readiness.currencies.join(', ')}.`
            : 'Selling is not enabled yet. No payment provider is approved and no pricing terms are published, so nothing can be made purchasable.'}
        </StatusMessage>
      )}

      {offers.value === undefined ? null : rows.length === 0 ? (
        <EmptyState testId="offers-empty">
          You have no commercial offers.
        </EmptyState>
      ) : (
        <ul>
          {rows.map((offer) => (
            <li data-testid={`offer-${offer.id}`} key={offer.id}>
              {offer.mode === 'subscription' ? 'Subscription' : 'One-time'} ·{' '}
              {offer.state}
              {offer.prices.length === 0 ? (
                <> · no price published</>
              ) : (
                <ul>
                  {offer.prices.map((price) => (
                    <li data-testid={`price-${price.id}`} key={price.id}>
                      {formatMoney(price.amount)}
                      {price.interval === undefined
                        ? null
                        : ` per ${price.interval}`}{' '}
                      · {price.state}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
