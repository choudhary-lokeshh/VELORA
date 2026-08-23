'use client';

import { useCallback, useState } from 'react';

import type {
  CreatorCurrencyEarnings,
  CreatorEarnings,
  CreatorEarningsEntry,
} from '@velora/creator-client';
import { formatAmount, formatMoney } from '@velora/creator-client';

import {
  Badge,
  BlockedState,
  Button,
  Card,
  CardHead,
  CardSkeleton,
  EmptyState,
  ErrorState,
  InfoRow,
  ListRow,
  Metric,
  PageHeader,
  RowSkeleton,
  Segmented,
} from '../design/primitives';
import { useApi } from '../app/providers';
import { earningsKindLabels, formatDateTime } from './format';
import { MoneyNav } from './money-nav';
import { useCollection, useResource } from './resource';

/**
 * A creator's money, shown exactly as the server holds it.
 *
 * Every figure on this screen came from one read of one currency's ledger and
 * commercial records. There is no chart, no trend, no month-over-month, no
 * projection, and no total across currencies — none of those exist as platform
 * truth, and a creator planning against a number nobody computed is worse off
 * than a creator looking at an empty screen.
 *
 * Currencies are separate everywhere, including visually. Somebody paid in
 * euros and yen sees two blocks of figures and never a third that adds them
 * up, because the sum of a euro and a yen is not an amount.
 *
 * The amounts are rendered against the published minor-unit exponent for their
 * own currency, so a yen shows no decimal places and a dinar shows three. No
 * currency symbol and no grouping: those are locale decisions nobody has
 * approved, and guessing one would put a formatting opinion where a number
 * belongs.
 */

const historyPageSize = 25;

/** What each figure means, said in the creator's terms rather than accounting's. */
const figures = [
  ['gross', 'Paid by members', 'Everything members have paid you.'],
  ['platform', 'VELORA’s share', 'Taken by the platform from the above.'],
  ['reversed', 'Returned to members', 'Refunds you have already given.'],
  ['disputed', 'Being claimed back', 'Held while a member disputes a payment.'],
  ['tax', 'Withheld for tax', 'Held back where VELORA is required to.'],
] as const;

export function Earnings() {
  const api = useApi();
  const [currency, setCurrency] =
    useState<CreatorCurrencyEarnings['currency']>();

  const loadEarnings = useCallback(async () => api.earnings(), [api]);
  const earnings = useResource<CreatorEarnings>(loadEarnings);
  const currencies = earnings.value?.currencies ?? [];
  const readiness = earnings.value?.readiness;
  const selected = currency ?? currencies[0]?.currency ?? undefined;
  const block = currencies.find((row) => row.currency === selected);

  return (
    <>
      <PageHeader
        lede="What VELORA holds for you, exactly as its ledger holds it. Nothing here is estimated or projected."
        title="Money"
      />
      <MoneyNav />

      {readiness !== undefined && !readiness.enabled ? (
        <BlockedState
          label="Not available yet"
          testId="earnings-readiness"
          title="Nothing can be sold on VELORA yet"
        >
          <p>
            No payment provider is approved and no pricing terms are published,
            so nothing new can be earned. Anything already earned still appears
            below and is still yours.
          </p>
        </BlockedState>
      ) : null}

      {earnings.error !== undefined ? (
        <Card>
          <ErrorState
            body={earnings.error}
            onRetry={earnings.retryable ? earnings.reload : undefined}
            testId="earnings-failed"
          />
        </Card>
      ) : earnings.loading && earnings.value === undefined ? (
        <Card testId="earnings-loading">
          <CardSkeleton rows={4} />
        </Card>
      ) : currencies.length === 0 ? (
        <Card>
          <EmptyState
            body="Figures appear here once a purchase settles. Until VELORA can sell anything, none will."
            icon="ledger"
            testId="earnings-empty"
            title="Nothing has been paid to you"
          />
        </Card>
      ) : (
        <>
          {currencies.length > 1 ? (
            <Segmented
              label="Currency"
              onChange={setCurrency}
              options={currencies.map((row) => ({
                label: row.currency,
                value: row.currency,
              }))}
              value={selected ?? currencies[0]?.currency ?? 'USD'}
            />
          ) : null}

          {block === undefined ? null : (
            <div className="s-split">
              <CurrencyBlock earnings={block} />
              <HistoryCard currency={block.currency} />
            </div>
          )}

          {currencies.length > 1 ? (
            <p className="s-caption s-quiet" data-testid="earnings-no-total">
              Each currency is shown on its own. VELORA does not add them
              together, because the sum of two currencies is not an amount.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

function CurrencyBlock({
  earnings,
}: {
  readonly earnings: CreatorCurrencyEarnings;
}) {
  return (
    <Card testId={`earnings-currency-${earnings.currency}`}>
      <CardHead
        actions={<Badge tone="neutral">{earnings.currency}</Badge>}
        lede="Everything below is in this currency and in its own minor units."
        title="Owed to you"
      />
      <Metric
        caption={`${earnings.currency} VELORA currently owes you`}
        testId={`earnings-${earnings.currency}-payable`}
        value={formatAmount(earnings.payable, earnings.currency)}
      />
      <dl className="s-stack">
        {figures.map(([key, label]) => (
          <InfoRow
            key={key}
            term={label}
            testId={`earnings-${earnings.currency}-${key}`}
            value={
              <span className="s-numeric">
                {formatAmount(earnings[key], earnings.currency)}
              </span>
            }
          />
        ))}
      </dl>
      <p className="s-caption s-quiet">
        Owed to you is what is left after VELORA’s share, refunds, disputes and
        tax. It is not the same as what you can withdraw.
      </p>
    </Card>
  );
}

/**
 * One currency's commercial history.
 *
 * Each row describes an event without naming who was on the other side of it.
 * A creator is entitled to know that a refund happened and when; they are not
 * entitled to know which member asked for it, and the contract does not say.
 */
function HistoryCard({
  currency,
}: {
  readonly currency: CreatorCurrencyEarnings['currency'];
}) {
  const api = useApi();

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.earningsHistory({
        currency,
        cursor,
        pageSize: historyPageSize,
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.entries,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, currency],
  );
  const history = useCollection<CreatorEarningsEntry>(load);

  return (
    <Card flush testId="earnings-history">
      <CardHead title={`${currency} activity`} />
      {history.error !== undefined && history.items.length === 0 ? (
        <ErrorState
          body={history.error}
          onRetry={history.retryable ? history.reload : undefined}
          testId="earnings-history-failed"
        />
      ) : history.loading && history.items.length === 0 ? (
        <RowSkeleton rows={3} />
      ) : history.items.length === 0 ? (
        <EmptyState
          body="Purchases, refunds and disputes appear here as they happen."
          icon="ledger"
          testId="earnings-history-empty"
          title={`No ${currency} activity yet`}
        />
      ) : (
        <ul className="s-list">
          {history.items.map((entry) => (
            <li key={entry.id}>
              <ListRow
                aside={
                  <span className="s-numeric s-subheading">
                    {formatMoney(entry.amount)}
                  </span>
                }
                testId={`earnings-entry-${entry.id}`}
              >
                <span className="s-subheading">
                  {earningsKindLabels[entry.kind] ?? 'Activity'}
                </span>
                <span className="s-caption s-quiet">
                  {formatDateTime(entry.occurredAt)}
                </span>
              </ListRow>
            </li>
          ))}
        </ul>
      )}

      {history.hasMore ? (
        <div className="s-card__pad s-card__pad--block">
          <Button
            block
            busy={history.loadingMore}
            data-testid="earnings-history-more"
            onClick={history.loadMore}
          >
            Load older activity
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
