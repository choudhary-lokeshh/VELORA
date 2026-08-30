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
  CardHead,
  CardSkeleton,
  EmptyState,
  ErrorState,
  PageHeader,
} from '../design/primitives';
import { formatDate, giftStateLook, giftStateMeaning } from './format';
import { GiftArt } from './gift-art';
import { MoneyNav } from './money-nav';
import { useResource } from './resource';

/**
 * Gifts somebody sent, from the receiving side.
 *
 * Everything here is a figure the ledger posted: the gross the sender paid and
 * the share credited to the creator, each in its own currency, never summed.
 * Nothing counts: there is no total received, no best month, no top sender, and
 * no rank — none of those is computed anywhere and a number with nothing behind
 * it is the first fabricated thing on a money screen.
 *
 * The sender is not named and never has been. The contract publishes
 * `senderVisibility: 'withheld'` and nothing else about them, so the screen says
 * so plainly rather than leaving a gap somebody reads as a loading failure.
 */
export function ReceivedGifts() {
  const api = useApi();
  const load = useCallback(async () => api.receivedGifts(), [api]);
  const history = useResource<CreatorReceivedGiftList>(load);
  const rows = history.value?.gifts ?? [];

  return (
    <>
      <PageHeader
        lede="Virtual gifts received, with the exact gross payment and creator share the ledger posted."
        title="Money"
      />
      <MoneyNav />

      <Card flush testId="received-gifts">
        <CardHead
          lede="Each gift is shown in the currency it was paid in. VELORA does not add them together."
          title="Received gifts"
        />
        {history.error !== undefined ? (
          <ErrorState
            body={history.error}
            onRetry={history.retryable ? history.reload : undefined}
            testId="received-gifts-error"
          />
        ) : history.loading && history.value === undefined ? (
          <div className="s-card__pad">
            <CardSkeleton rows={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            body="A gift appears here once somebody sends one from your public page."
            icon="sparkle"
            testId="received-gifts-empty"
            title="No gifts received"
          />
        ) : (
          <ul className="s-list" data-testid="received-gifts-list">
            {rows.map((row) => {
              const state = giftStateLook(row.state);
              return (
                <li className="s-row" key={row.id}>
                  <span className="s-gift-mark">
                    <GiftArt className="s-gift-art" visual={row.gift.visual} />
                  </span>
                  <span className="s-row__body">
                    <span className="s-subheading s-wrap">{row.gift.name}</span>
                    <span className="s-caption s-quiet s-wrap">
                      Gross{' '}
                      <span className="s-numeric">
                        {formatMoney(row.gross)}
                      </span>{' '}
                      · Your ledger share{' '}
                      <span className="s-numeric">
                        {formatMoney(row.earning)}
                      </span>
                    </span>
                    <span className="s-caption s-quiet s-wrap">
                      {giftStateMeaning[row.state] ??
                        'VELORA cannot say where this one stands.'}
                    </span>
                    <span className="s-caption s-quiet s-wrap">
                      Sender identity withheld ·{' '}
                      <time dateTime={row.sentAt ?? row.createdAt}>
                        {formatDate(row.sentAt ?? row.createdAt)}
                      </time>
                    </span>
                  </span>
                  <span className="s-row__aside">
                    <Badge
                      icon={state.icon}
                      testId={`received-gift-state-${row.id}`}
                      tone={state.tone}
                    >
                      {state.label}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="s-caption s-quiet">
        Payout transfer remains unavailable until an approved payout provider
        and channel are configured. This page does not imply funds were
        disbursed.
      </p>
    </>
  );
}
