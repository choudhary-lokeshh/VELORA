'use client';

import { useCallback } from 'react';

import type { ConsumerGiftList } from '@velora/consumer-client';
import { formatMinorUnits } from '@velora/validation';

import { useApi } from '../app/providers';
import {
  Badge,
  Card,
  EmptyState,
  ErrorMessage,
  PageHeader,
  RowSkeleton,
} from '../design/primitives';
import { useResource } from './resource';

const stateLabel = {
  failed: 'Failed',
  partially_reversed: 'Partly returned',
  pending: 'Sending',
  reversed: 'Returned',
  sent: 'Sent',
} as const;

export function SentGifts() {
  const api = useApi();
  const load = useCallback(async () => api.sentGifts(), [api]);
  const history = useResource<ConsumerGiftList>(load);
  const rows = history.value?.gifts ?? [];
  return (
    <>
      <PageHeader
        lede="Every virtual gift you have sent, from settled payment truth."
        title="Sent gifts"
      />
      {history.error !== undefined ? (
        <Card>
          <ErrorMessage testId="sent-gifts-error">{history.error}</ErrorMessage>
        </Card>
      ) : history.loading && history.value === undefined ? (
        <Card>
          {Array.from({ length: 3 }, (_, index) => (
            <RowSkeleton key={index} />
          ))}
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            body="Gifts you send from a creator page appear here."
            icon="sparkle"
            testId="sent-gifts-empty"
            title="No gifts sent"
          />
        </Card>
      ) : (
        <Card flush>
          <ul className="v-list v-list--divided" data-testid="sent-gifts-list">
            {rows.map((row) => (
              <li key={row.id}>
                <div className="v-row">
                  <span className="v-notification__mark">
                    <span aria-hidden="true" className="v-gift-history-mark">
                      {row.gift.name.slice(0, 1)}
                    </span>
                  </span>
                  <span className="v-row__body">
                    <span className="v-subheading">
                      {row.gift.name} to {row.creator.displayName}
                    </span>
                    <span className="v-caption v-quiet">
                      {formatMinorUnits(
                        row.price.amountMinor,
                        row.price.currency,
                      )}{' '}
                      {row.price.currency} ·{' '}
                      <time dateTime={row.createdAt}>
                        {new Date(row.createdAt).toLocaleDateString()}
                      </time>
                    </span>
                  </span>
                  <Badge
                    tone={
                      row.state === 'sent'
                        ? 'positive'
                        : row.state === 'pending'
                          ? 'caution'
                          : 'neutral'
                    }
                  >
                    {stateLabel[row.state]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
