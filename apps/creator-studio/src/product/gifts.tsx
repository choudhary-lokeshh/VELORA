'use client';

import { useCallback } from 'react';

import {
  formatMoney,
  type CreatorReceivedGiftList,
} from '@velora/creator-client';

import { useApi } from '../app/providers';
import {
  Badge,
  Card,
  CardSkeleton,
  EmptyState,
  ErrorState,
  PageHeader,
} from '../design/primitives';
import { MoneyNav } from './money-nav';
import { useResource } from './resource';

const stateLabel = {
  failed: 'Failed',
  partially_reversed: 'Partly reversed',
  pending: 'Pending',
  reversed: 'Reversed',
  sent: 'Settled',
} as const;

export function ReceivedGifts() {
  const api = useApi();
  const load = useCallback(async () => api.receivedGifts(), [api]);
  const history = useResource<CreatorReceivedGiftList>(load);
  const rows = history.value?.gifts ?? [];
  return (
    <>
      <PageHeader
        lede="Virtual gifts received, with the exact gross payment and creator share posted by the ledger."
        title="Received gifts"
      />
      <MoneyNav />
      {history.error !== undefined ? (
        <Card>
          <ErrorState
            body={history.error}
            onRetry={history.retryable ? history.reload : undefined}
            testId="received-gifts-error"
          />
        </Card>
      ) : history.loading && history.value === undefined ? (
        <Card>
          <CardSkeleton rows={4} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            body="Settled gifts appear here after somebody sends one from your public page."
            icon="sparkle"
            testId="received-gifts-empty"
            title="No gifts received"
          />
        </Card>
      ) : (
        <Card flush>
          <ul className="s-list" data-testid="received-gifts-list">
            {rows.map((row) => (
              <li className="s-row" key={row.id}>
                <span aria-hidden="true" className="s-gift-mark">
                  {row.gift.name.slice(0, 1)}
                </span>
                <span className="s-row__body">
                  <span className="s-subheading">{row.gift.name}</span>
                  <span className="s-caption s-quiet">
                    Gross {formatMoney(row.gross)} · Your ledger share{' '}
                    {formatMoney(row.earning)}
                  </span>
                  <span className="s-caption s-quiet">
                    Sender identity withheld ·{' '}
                    <time dateTime={row.createdAt}>
                      {new Date(row.createdAt).toLocaleDateString()}
                    </time>
                  </span>
                </span>
                <span className="s-row__aside">
                  <Badge tone={row.state === 'sent' ? 'positive' : 'neutral'}>
                    {stateLabel[row.state]}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="s-caption s-quiet">
        Payout transfer remains unavailable until an approved payout provider
        and channel are configured. This page does not imply funds were
        disbursed.
      </p>
    </>
  );
}
