'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { formatMinorUnits } from '@velora/validation/money';

import type {
  AdminPayment,
  AdminPaymentDetail,
  AdminRefund,
  Dispute,
} from '../api/contract';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  Fact,
  Facts,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  PanelSkeleton,
  Reference,
  RowSkeleton,
  Scroller,
  Segmented,
  Table,
  Toolbar,
} from '../design/primitives';
import { useApi } from '../app/providers';
import {
  disputeReasonLabels,
  disputeStateLook,
  formatDateTime,
  humanState,
  plural,
  refundReasonLabels,
  resourceTypeLabels,
  shortId,
} from './format';
import { useCollection, useResource } from './resource';

/**
 * The commercial records behind the totals.
 *
 * The money screen answers "what state is the platform's money in". This
 * answers the other question an operations team actually has, which is "what
 * happened to this one payment" — and until now the console could report that
 * nine payments had succeeded and could not show an operator any of them.
 *
 * **No payer appears anywhere.** A payment list keyed by who paid would be a
 * purchase history for every person on the platform, whatever the screen was
 * called. What an operator answering for a payment turns on is the payment's
 * own identifier and the reference the provider quotes, and both are here in a
 * face where an `l` and a `1` are different shapes, with the whole value on the
 * clipboard in one control.
 *
 * **Nothing on this screen acts.** The one financial operation in the product
 * is issuing a refund, and it stays on the money screen where it already lives
 * with its reason, its acknowledgement, and its idempotency key. A refund
 * control beside a row is how a finance queue becomes a place where money moves
 * by accident.
 *
 * There is no state a row is toned by. A payment's `state` is BILLING's own
 * vocabulary and one domain's `failed` is terminal where another's is retried
 * in ninety seconds; the only judgement coloured here is a dispute's, which the
 * contract publishes as one.
 */

const paymentPageSize = 25;

type PaymentFilter =
  | 'all'
  | 'succeeded'
  | 'provider_pending'
  | 'failed'
  | 'reconciliation_pending';

const paymentOptions: readonly { label: string; value: PaymentFilter }[] = [
  { label: 'Every payment', value: 'all' },
  { label: 'Succeeded', value: 'succeeded' },
  { label: 'Provider pending', value: 'provider_pending' },
  { label: 'Needs a person', value: 'reconciliation_pending' },
  { label: 'Failed', value: 'failed' },
];

export function Payments() {
  const api = useApi();
  const [state, setState] = useState<PaymentFilter>('all');

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.payments({
        cursor,
        pageSize: paymentPageSize,
        ...(state === 'all' ? {} : { state }),
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.payments,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, state],
  );
  const payments = useCollection<AdminPayment>(load);

  return (
    <>
      <Toolbar testId="payments-filter">
        <Segmented
          label="Filter by payment state"
          onChange={setState}
          options={paymentOptions}
          value={state}
        />
      </Toolbar>

      <Panel testId="payment-list">
        <PanelHead
          actions={
            payments.items.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {plural(
                  payments.items.length,
                  'payment loaded',
                  'payments loaded',
                )}
                {payments.hasMore ? ', more to come' : ''}
              </span>
            )
          }
          lede="Newest first. Every amount is against its own currency's minor unit; nothing is summed across currencies."
          title="Payments"
        />

        {payments.error !== undefined && payments.items.length === 0 ? (
          <PanelBody>
            <ErrorState
              body={payments.error}
              onRetry={payments.retryable ? payments.reload : undefined}
              testId="payment-list-failed"
            />
          </PanelBody>
        ) : payments.loading && payments.items.length === 0 ? (
          <PanelBody>
            <RowSkeleton rows={5} />
          </PanelBody>
        ) : payments.items.length === 0 ? (
          <PanelBody>
            <EmptyState
              body={
                state === 'all'
                  ? 'No payment has been taken in this environment.'
                  : 'No payment is in that state. Another state may still hold work.'
              }
              testId="payment-list-empty"
              title="Nothing here"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Payments">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Payment</th>
                    <th scope="col">State</th>
                    <th className="a-table__right" scope="col">
                      Amount
                    </th>
                    <th scope="col">Sold</th>
                    <th scope="col">Provider reference</th>
                    <th scope="col">Taken</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.items.map((payment) => (
                    <PaymentRow key={payment.id} payment={payment} />
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}

        {payments.hasMore ? (
          <PanelFoot>
            <Button
              block
              busy={payments.loadingMore}
              data-testid="payment-list-more"
              onClick={payments.loadMore}
            >
              Load more
            </Button>
          </PanelFoot>
        ) : null}
      </Panel>
    </>
  );
}

function PaymentRow({ payment }: { readonly payment: AdminPayment }) {
  return (
    <tr data-testid={`payment-${payment.id}`}>
      <td>
        <Link
          className="a-table__link a-mono"
          href={`/money/payments/${payment.id}`}
        >
          {shortId(payment.id)}
        </Link>
      </td>
      <td>{humanState(payment.state)}</td>
      <td className="a-table__right a-numeric">
        {formatMinorUnits(payment.amountMinor, payment.currency)}{' '}
        {payment.currency}
      </td>
      <td>
        {payment.resourceType === undefined ? (
          <span className="a-quiet">—</span>
        ) : (
          (resourceTypeLabels[payment.resourceType] ??
          humanState(payment.resourceType))
        )}
      </td>
      <td>
        {payment.providerReference === undefined ? (
          // Absent rather than blank: the provider has not given one yet, and
          // an empty cell would read as "there is no record".
          <span className="a-quiet">Not given yet</span>
        ) : (
          <Reference
            short={shortId(payment.providerReference)}
            testId={`payment-${payment.id}-provider`}
            value={payment.providerReference}
          />
        )}
      </td>
      <td className="a-numeric a-quiet">{formatDateTime(payment.createdAt)}</td>
    </tr>
  );
}

/**
 * One payment and everything the platform recorded against it.
 *
 * The reversals and the claims are on the same screen because the question in
 * front of a payment is never only about the payment: it is whether money has
 * already gone back, and whether somebody else's bank is taking it.
 */
export function PaymentScreen({ paymentId }: { readonly paymentId: string }) {
  const api = useApi();
  const load = useCallback(
    async () => api.payment(paymentId),
    [api, paymentId],
  );
  const state = useResource<AdminPaymentDetail>(load);
  const value = state.value;

  if (state.error !== undefined && value === undefined) {
    return (
      <>
        <PageHeader eyebrow="Payments" title="Payment" />
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="payment-failed"
            />
          </PanelBody>
        </Panel>
      </>
    );
  }

  if (value === undefined && state.missing) {
    return (
      <>
        <PageHeader eyebrow="Payments" title="Payment" />
        <Panel>
          <PanelBody>
            <EmptyState
              actions={
                <ButtonLink href="/money/payments" tone="primary">
                  Back to payments
                </ButtonLink>
              }
              body="There is no payment with that identifier, or it is not one this console may read. Nothing was changed."
              icon="ledger"
              testId="payment-not-found"
              title="That payment is not here"
            />
          </PanelBody>
        </Panel>
      </>
    );
  }

  if (value === undefined) {
    return (
      <>
        <PageHeader eyebrow="Payments" title="Payment" />
        <Panel testId="payment-loading">
          <PanelBody>
            <PanelSkeleton rows={4} />
          </PanelBody>
        </Panel>
      </>
    );
  }

  const payment = value.payment;
  return (
    <>
      <PageHeader
        eyebrow="Payments"
        lede={`${formatMinorUnits(payment.amountMinor, payment.currency)} ${
          payment.currency
        } · ${humanState(payment.state)} · taken ${formatDateTime(
          payment.createdAt,
        )}`}
        title={`Payment ${shortId(payment.id)}`}
      />

      <Panel testId="payment-record">
        <PanelHead
          lede="What the platform holds about this payment. Nothing about who made it appears anywhere in this contract."
          title="The record"
        />
        <PanelBody>
          <Facts>
            <Fact
              term="Payment"
              testId="payment-id"
              value={<Reference value={payment.id} />}
            />
            <Fact term="State" value={humanState(payment.state)} />
            <Fact
              term="Amount"
              testId="payment-amount"
              value={
                <span className="a-numeric">
                  {formatMinorUnits(payment.amountMinor, payment.currency)}{' '}
                  {payment.currency}
                </span>
              }
            />
            <Fact
              term="Tax"
              testId="payment-tax"
              value={
                payment.taxMinor === undefined ? (
                  // Not zero. No tax authority is approved, so the platform
                  // assessed nothing rather than assessing nothing owed.
                  <span className="a-quiet">Not assessed</span>
                ) : (
                  <span className="a-numeric">
                    {formatMinorUnits(payment.taxMinor, payment.currency)}{' '}
                    {payment.currency}
                  </span>
                )
              }
            />
            <Fact
              term="Sold"
              value={
                payment.resourceType === undefined
                  ? 'Not recorded'
                  : (resourceTypeLabels[payment.resourceType] ??
                    humanState(payment.resourceType))
              }
            />
            <Fact term="Provider" value={payment.provider} />
            <Fact
              term="Provider reference"
              testId="payment-provider-reference"
              value={
                payment.providerReference === undefined ? (
                  <span className="a-quiet">Not given yet</span>
                ) : (
                  <Reference value={payment.providerReference} />
                )
              }
            />
            <Fact
              term="Failure"
              value={
                payment.failureReason === undefined ? (
                  <span className="a-quiet">None recorded</span>
                ) : (
                  humanState(payment.failureReason)
                )
              }
            />
            <Fact
              term="Last read from the provider"
              value={
                payment.lastProviderSyncAt === undefined ? (
                  <span className="a-quiet">Never</span>
                ) : (
                  <span className="a-numeric">
                    {formatDateTime(payment.lastProviderSyncAt)}
                  </span>
                )
              }
            />
            <Fact
              term="Last changed"
              value={
                <span className="a-numeric">
                  {formatDateTime(payment.updatedAt)}
                </span>
              }
            />
          </Facts>
        </PanelBody>
      </Panel>

      <Panel testId="payment-refunds">
        <PanelHead
          lede="Money the platform sent back against this payment, and what state each reversal reached."
          title="Reversals"
        />
        {value.refunds.length === 0 ? (
          <PanelBody>
            <EmptyState
              body="Nothing has been sent back against this payment."
              testId="payment-refunds-empty"
              title="No reversal"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Reversals">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Reversal</th>
                    <th scope="col">State</th>
                    <th className="a-table__right" scope="col">
                      Amount
                    </th>
                    <th scope="col">Reason</th>
                    <th scope="col">Provider reference</th>
                    <th scope="col">Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {value.refunds.map((refund) => (
                    <RefundRow key={refund.id} refund={refund} />
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}
      </Panel>

      <Panel testId="payment-disputes">
        <PanelHead
          lede="Claims somebody's bank has made against this payment. Nothing in this product originates one."
          title="Claims"
        />
        {value.disputes.length === 0 ? (
          <PanelBody>
            <EmptyState
              body="No cardholder claim has arrived against this payment."
              testId="payment-disputes-empty"
              title="No claim"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Claims">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Claim</th>
                    <th scope="col">State</th>
                    <th className="a-table__right" scope="col">
                      Amount
                    </th>
                    <th scope="col">Reason</th>
                    <th scope="col">Provider reference</th>
                    <th scope="col">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {value.disputes.map((dispute) => (
                    <ClaimRow dispute={dispute} key={dispute.id} />
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}
      </Panel>

      <Notice
        icon="lock"
        testId="payment-no-actions"
        title="What cannot be done here"
      >
        Nothing on this screen changes a financial row. Issuing a reversal is
        the one financial operation an operator has and it is taken on the money
        screen, where it collects a reason and an acknowledgement and carries an
        idempotency key — because a retried refund that produced a second refund
        would be money the platform cannot get back.
      </Notice>
    </>
  );
}

function RefundRow({ refund }: { readonly refund: AdminRefund }) {
  return (
    <tr data-testid={`refund-${refund.id}`}>
      <td>
        <Reference short={shortId(refund.id)} value={refund.id} />
      </td>
      <td>{humanState(refund.state)}</td>
      <td className="a-table__right a-numeric">
        {formatMinorUnits(refund.amountMinor, refund.currency)}{' '}
        {refund.currency}
      </td>
      <td>
        {refundReasonLabels[refund.reasonCode] ?? humanState(refund.reasonCode)}
      </td>
      <td>
        {refund.providerReference === undefined ? (
          <span className="a-quiet">Not given yet</span>
        ) : (
          <Reference
            short={shortId(refund.providerReference)}
            value={refund.providerReference}
          />
        )}
      </td>
      <td className="a-numeric a-quiet">{formatDateTime(refund.createdAt)}</td>
    </tr>
  );
}

function ClaimRow({ dispute }: { readonly dispute: Dispute }) {
  const look = disputeStateLook(dispute.state);
  return (
    <tr data-testid={`claim-${dispute.id}`}>
      <td>
        <Reference short={shortId(dispute.id)} value={dispute.id} />
      </td>
      <td>
        <Badge icon={look.icon} tone={look.tone}>
          {look.label}
        </Badge>
      </td>
      <td className="a-table__right a-numeric">
        {formatMinorUnits(dispute.amount.amountMinor, dispute.amount.currency)}{' '}
        {dispute.amount.currency}
      </td>
      <td>
        {disputeReasonLabels[dispute.reasonCode] ??
          humanState(dispute.reasonCode)}
      </td>
      <td>
        {'providerReference' in dispute &&
        typeof dispute.providerReference === 'string' ? (
          <Reference
            short={shortId(dispute.providerReference)}
            value={dispute.providerReference}
          />
        ) : (
          <span className="a-quiet">Not published</span>
        )}
      </td>
      <td className="a-numeric a-quiet">{formatDateTime(dispute.openedAt)}</td>
    </tr>
  );
}
