'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { formatMinorUnits } from '@velora/validation/money';

import type { AdminPayout } from '../api/contract';
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  Reference,
  RowSkeleton,
  Scroller,
  Segmented,
  Table,
  Toolbar,
} from '../design/primitives';
import { useApi } from '../app/providers';
import { formatDateTime, humanState, plural, shortId } from './format';
import { useCollection } from './resource';

/**
 * Every payout instruction the platform holds.
 *
 * The money screen counts them by state; this is the record itself, which is
 * what an operator needs when a creator asks where their money is. The creator
 * is named by the same opaque identifier the creator directory publishes, so a
 * payout can be followed back to the account whose book it left — and a click
 * away, because an identifier an operator has to copy into a search box is an
 * identifier they will mistype.
 *
 * **Nothing about the destination appears.** No recipient reference, no bank
 * detail, no account name, no country of a bank.
 * `docs/operations/03-finance-payout-operations.md` forbids all three in an
 * operational view, and none of them helps answer why a payout is stuck. What
 * does help is the state, the failure the provider gave, and the reference that
 * provider quotes — and those are all here.
 *
 * **Nothing on this screen acts.** There is no release, no retry, and no
 * cancel, because the API publishes none: a payout moves when PAYOUTS decides
 * it moves and when the provider answers, and a control that appeared to
 * release one would be a fabricated capability on the screen where that matters
 * most. `requestedBy` is an opaque session reference — how the platform records
 * who asked, never a person's name.
 */

const payoutPageSize = 25;

type PayoutFilter =
  'all' | 'requested' | 'reserved' | 'submitted' | 'paid' | 'failed';

const payoutOptions: readonly { label: string; value: PayoutFilter }[] = [
  { label: 'Every payout', value: 'all' },
  { label: 'Requested', value: 'requested' },
  { label: 'Reserved', value: 'reserved' },
  { label: 'Awaiting the provider', value: 'submitted' },
  { label: 'Paid', value: 'paid' },
  { label: 'Failed', value: 'failed' },
];

export function Payouts() {
  const api = useApi();
  const [state, setState] = useState<PayoutFilter>('all');

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.payouts({
        cursor,
        pageSize: payoutPageSize,
        ...(state === 'all' ? {} : { state }),
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.payouts,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, state],
  );
  const payouts = useCollection<AdminPayout>(load);

  return (
    <>
      <Toolbar testId="payouts-filter">
        <Segmented
          label="Filter by payout state"
          onChange={setState}
          options={payoutOptions}
          value={state}
        />
      </Toolbar>

      <Panel testId="payout-list">
        <PanelHead
          actions={
            payouts.items.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {plural(
                  payouts.items.length,
                  'payout loaded',
                  'payouts loaded',
                )}
                {payouts.hasMore ? ', more to come' : ''}
              </span>
            )
          }
          lede="Newest first. Nothing about where the money is going appears here, and nothing on this screen moves one."
          title="Payout instructions"
        />

        {payouts.error !== undefined && payouts.items.length === 0 ? (
          <PanelBody>
            <ErrorState
              body={payouts.error}
              onRetry={payouts.retryable ? payouts.reload : undefined}
              testId="payout-list-failed"
            />
          </PanelBody>
        ) : payouts.loading && payouts.items.length === 0 ? (
          <PanelBody>
            <RowSkeleton rows={5} />
          </PanelBody>
        ) : payouts.items.length === 0 ? (
          <PanelBody>
            <EmptyState
              body={
                state === 'all'
                  ? 'No payout has been instructed. No payout provider is approved and no settlement terms are published, so no creator can ask for one yet.'
                  : 'No payout is in that state.'
              }
              testId="payout-list-empty"
              title="Nothing here"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Payout instructions">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Payout</th>
                    <th scope="col">Creator</th>
                    <th scope="col">State</th>
                    <th className="a-table__right" scope="col">
                      Amount
                    </th>
                    <th scope="col">Provider reference</th>
                    <th scope="col">Failure</th>
                    <th scope="col">Instructed</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.items.map((payout) => (
                    <PayoutRow key={payout.id} payout={payout} />
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}

        {payouts.hasMore ? (
          <PanelFoot>
            <Button
              block
              busy={payouts.loadingMore}
              data-testid="payout-list-more"
              onClick={payouts.loadMore}
            >
              Load more
            </Button>
          </PanelFoot>
        ) : null}
      </Panel>

      <Notice
        icon="lock"
        testId="payouts-no-actions"
        title="What cannot be done here"
      >
        There is no release, no retry, and no cancellation on this screen,
        because the platform publishes none. A payout moves when PAYOUTS decides
        it moves and when the provider answers; a control that appeared to
        release one would be a capability nobody has.
      </Notice>
    </>
  );
}

function PayoutRow({ payout }: { readonly payout: AdminPayout }) {
  return (
    <tr data-testid={`payout-${payout.id}`}>
      <td>
        <Reference short={shortId(payout.id)} value={payout.id} />
      </td>
      <td>
        <Link
          className="a-table__link a-mono"
          href={`/creators?selected=${payout.creatorId}`}
        >
          {shortId(payout.creatorId)}
        </Link>
      </td>
      <td>{humanState(payout.state)}</td>
      <td className="a-table__right a-numeric">
        {formatMinorUnits(payout.amountMinor, payout.currency)}{' '}
        {payout.currency}
      </td>
      <td>
        {payout.providerReference === undefined ? (
          <span className="a-quiet">Not given yet</span>
        ) : (
          <Reference
            short={shortId(payout.providerReference)}
            testId={`payout-${payout.id}-provider`}
            value={payout.providerReference}
          />
        )}
      </td>
      <td>
        {payout.failureReason === undefined ? (
          <span className="a-quiet">—</span>
        ) : (
          humanState(payout.failureReason)
        )}
      </td>
      <td className="a-numeric a-quiet">{formatDateTime(payout.createdAt)}</td>
    </tr>
  );
}
