'use client';

import { useCallback, useState } from 'react';

import type {
  CreatorApi,
  CreatorCurrencyEarnings,
  CreatorEarnings,
  CreatorEarningsEntry,
  CreatorEarningsHistory,
} from '@velora/creator-client';
import { formatAmount, formatMoney } from '@velora/creator-client';

import { useResource } from './resource';
import { EmptyState, ResourceState, Section, StatusMessage } from './ui';

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

const amount = formatAmount;

/** What each figure means, said in the creator's terms rather than accounting's. */
const figureLabels = [
  ['payable', 'Owed to you'],
  ['gross', 'Paid by members'],
  ['platform', 'Platform share'],
  ['reversed', 'Returned to members'],
  ['disputed', 'Being claimed back'],
  ['tax', 'Withheld for tax'],
] as const;

function CurrencyBlock({
  earnings,
  onSelect,
  selected,
}: {
  readonly earnings: CreatorCurrencyEarnings;
  readonly onSelect: (currency: CreatorCurrencyEarnings['currency']) => void;
  readonly selected: boolean;
}) {
  return (
    <div data-testid={`earnings-currency-${earnings.currency}`}>
      <h3>{earnings.currency}</h3>
      <dl>
        {figureLabels.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd data-testid={`earnings-${earnings.currency}-${key}`}>
              {amount(earnings[key], earnings.currency)}
            </dd>
          </div>
        ))}
      </dl>
      <button
        aria-pressed={selected}
        data-testid={`earnings-history-select-${earnings.currency}`}
        onClick={() => {
          onSelect(earnings.currency);
        }}
        type="button"
      >
        Show {earnings.currency} history
      </button>
    </div>
  );
}

/** One commercial event, described without naming who was on the other side. */
function HistoryRow({ entry }: { readonly entry: CreatorEarningsEntry }) {
  const description =
    entry.kind === 'capture'
      ? 'Purchase'
      : entry.kind === 'refund'
        ? 'Refund'
        : 'Claim';
  return (
    <li data-testid={`earnings-entry-${entry.id}`}>
      {description} · {formatMoney(entry.amount)} · {entry.state} ·{' '}
      <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
    </li>
  );
}

export function Earnings({
  api,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  readonly onSessionEnded: () => void;
}) {
  const [currency, setCurrency] =
    useState<CreatorCurrencyEarnings['currency']>();
  const loadEarnings = useCallback(async () => api.earnings(), [api]);
  const earnings = useResource<CreatorEarnings>(loadEarnings, {
    onUnauthenticated: onSessionEnded,
  });
  const loadHistory = useCallback(
    async () =>
      currency === undefined
        ? { kind: 'ok' as const, value: undefined }
        : api.earningsHistory({ currency }),
    [api, currency],
  );
  const history = useResource<CreatorEarningsHistory | undefined>(loadHistory, {
    onUnauthenticated: onSessionEnded,
  });

  const currencies = earnings.value?.currencies ?? [];
  const readiness = earnings.value?.readiness;

  return (
    <Section headingId="earnings-heading" title="Earnings">
      <ResourceState resource={earnings} testId="earnings" />

      {readiness === undefined ? null : (
        <StatusMessage testId="earnings-readiness">
          {readiness.enabled
            ? `Selling is enabled in ${readiness.currencies.join(', ')}.`
            : 'Selling is not enabled yet, so nothing can be earned. Anything already earned still appears below.'}
        </StatusMessage>
      )}

      {earnings.value === undefined ? null : currencies.length === 0 ? (
        <EmptyState testId="earnings-empty">
          Nothing has been paid to you yet. Figures appear here once a purchase
          settles.
        </EmptyState>
      ) : (
        currencies.map((row) => (
          <CurrencyBlock
            earnings={row}
            key={row.currency}
            onSelect={setCurrency}
            selected={row.currency === currency}
          />
        ))
      )}

      {currency === undefined ? null : (
        <div data-testid="earnings-history">
          <h3>{currency} history</h3>
          <ResourceState resource={history} testId="earnings-history-state" />
          {history.value === undefined ? null : history.value.entries.length ===
            0 ? (
            <EmptyState testId="earnings-history-empty">
              No {currency} activity yet.
            </EmptyState>
          ) : (
            <ul>
              {history.value.entries.map((entry) => (
                <HistoryRow entry={entry} key={entry.id} />
              ))}
            </ul>
          )}
          {history.value?.nextCursor === undefined ? null : (
            <StatusMessage testId="earnings-history-partial">
              Showing the most recent activity. Older entries are not on this
              page.
            </StatusMessage>
          )}
        </div>
      )}
    </Section>
  );
}
