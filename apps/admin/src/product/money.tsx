'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';

import {
  currencyCodes,
  formatMinorUnits,
  type CurrencyCode,
} from '@velora/validation/money';

import type {
  CurrencyTotal,
  Dispute,
  DisputeList,
  FinancialState,
  RefundReasonCode,
} from '../api/contract';
import { failureMessage } from '../api/messages';
import { Dialog } from '../design/dialog';
import {
  Acknowledgement,
  AreaNav,
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Fact,
  Facts,
  Field,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Select,
  Table,
  TextInput,
} from '../design/primitives';
import { moneyAreas } from '../app/navigation';
import { useApi, useToast } from '../app/providers';
import { Adapters, StateCounts } from './readouts';
import {
  disputeReasonLabels,
  disputeStateLook,
  formatDate,
  refundReasonLabels,
  shortId,
} from './format';
import { useResource, useSingleFlight } from './resource';

/**
 * The platform's money, as an operator sees it.
 *
 * Almost entirely a read. There is one financial operation in the whole product
 * — issuing a refund — and it goes through BILLING's own service with an
 * operator's authority, a reason, and a record. There is no editable amount
 * anywhere on this screen, because a screen with an editable financial figure
 * on it is a screen somebody eventually edits.
 *
 * Nothing here identifies anybody. No consumer, no creator, no provider object,
 * no payout recipient, no bank detail, no identity document, and no secret —
 * counts and per-currency totals, which is what an operator actually needs and
 * the most a screen should ever hold.
 *
 * There is no cross-currency total. Adding a euro to a yen produces a number
 * with no meaning, and an operator would act on it.
 */

/**
 * The four money areas, as four addresses.
 *
 * Rendered by each of them rather than by a shared layout, because a Next.js
 * layout would keep this mounted across an area change and the current-page
 * mark would be the one thing on the screen that had not moved.
 */
export function MoneyNav() {
  const pathname = usePathname();
  return (
    <AreaNav
      areas={moneyAreas}
      current={pathname}
      label="Money"
      testId="money-nav"
    />
  );
}

export function Money() {
  const api = useApi();
  const load = useCallback(async () => api.financialState(), [api]);
  const state = useResource<FinancialState>(load);
  const value = state.value;
  const [refunding, setRefunding] = useState(false);

  return (
    <>
      <PageHeader
        actions={
          value === undefined ? undefined : (
            <Button
              data-testid="money-refund"
              onClick={() => {
                setRefunding(true);
              }}
            >
              Issue a refund
            </Button>
          )
        }
        lede="What the platform holds, counted by state. Every figure is BILLING's own; none is derived here."
        title="Money"
      />

      <MoneyNav />

      {state.error !== undefined && value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="money-failed"
            />
          </PanelBody>
        </Panel>
      ) : value === undefined ? (
        <Panel testId="money-loading">
          <PanelBody>
            <PanelSkeleton rows={4} />
          </PanelBody>
        </Panel>
      ) : (
        <>
          <Adapters
            rows={value.capabilities}
            testId="money-capabilities"
            title="Commercial seams"
          />

          <StateCounts
            emptyBody="No commercial record needs a person to look at it."
            emptyTitle="Nothing needs attention"
            rows={value.reconciliation}
            testId="money-reconciliation"
            title="Needs a person"
            what={['record', 'records']}
          />

          <div className="a-grid">
            <Totals
              body="What members are currently claiming back. It is held while the claim is live."
              rows={value.openDisputeTotals}
              testId="money-disputed"
              title="Being claimed back"
            />
            <Totals
              body="What creators are owed, per currency, after the platform's share and everything held."
              rows={value.payableTotals}
              testId="money-payable"
              title="Owed to creators"
            />
          </div>

          <div className="a-grid">
            <StateCounts
              rows={value.payments}
              testId="money-payments"
              title="Payments"
              what={['payment', 'payments']}
            />
            <StateCounts
              rows={value.refunds}
              testId="money-refunds"
              title="Refunds"
              what={['refund', 'refunds']}
            />
            <StateCounts
              rows={value.disputes}
              testId="money-disputes"
              title="Disputes"
              what={['dispute', 'disputes']}
            />
            <StateCounts
              rows={value.subscriptions}
              testId="money-subscriptions"
              title="Subscriptions"
              what={['subscription', 'subscriptions']}
            />
            <StateCounts
              rows={value.payouts}
              testId="money-payouts"
              title="Payout instructions"
              what={['instruction', 'instructions']}
            />
          </div>
        </>
      )}

      {refunding ? (
        <RefundDialog
          onClose={() => {
            setRefunding(false);
          }}
          onDone={() => {
            setRefunding(false);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The claims an operator has to answer.
 *
 * The queue rather than the count. A number of open disputes tells somebody
 * that work exists; this tells them which work, how much is at stake, when it
 * is due, and the provider reference they have to quote to answer it — which is
 * the whole of what a person can act on from a console.
 *
 * There is no evidence submission and no field that could become one. Whether
 * VELORA may submit evidence, in what form, and through which provider is
 * unresolved, and a control that accepted a file and did nothing with it would
 * be worse than its absence. What an operator can do about a live claim today
 * is know it exists and decide, separately and with an audit record, whether to
 * refund the payment behind it.
 *
 * Nothing here identifies the cardholder. A dispute is about a payment, and who
 * made that payment is not something a finance queue should be able to group by.
 */
export function Disputes() {
  const api = useApi();
  const [openOnly, setOpenOnly] = useState(true);
  const load = useCallback(
    async () => api.disputes({ open: openOnly, pageSize: 25 }),
    [api, openOnly],
  );
  const disputes = useResource<DisputeList>(load);
  const rows = disputes.value?.disputes ?? [];

  return (
    <Panel testId="money-dispute-queue">
      <PanelHead
        actions={
          <Button
            data-testid="dispute-queue-scope"
            onClick={() => {
              setOpenOnly((current) => !current);
            }}
          >
            {openOnly ? 'Show every claim' : 'Show only live claims'}
          </Button>
        }
        lede={
          openOnly
            ? 'Claims still awaiting an answer, newest first.'
            : 'Every claim on record, newest first.'
        }
        title="Cardholder claims"
      />
      <PanelBody>
        {disputes.error !== undefined && disputes.value === undefined ? (
          <ErrorState
            body={disputes.error}
            onRetry={disputes.retryable ? disputes.reload : undefined}
            testId="dispute-queue-failed"
          />
        ) : disputes.value === undefined ? (
          <PanelSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            body={
              openOnly
                ? 'No cardholder is currently claiming money back.'
                : 'No cardholder has ever claimed money back here.'
            }
            testId="dispute-queue-empty"
            title="Nothing to answer"
          />
        ) : (
          <Table testId="dispute-queue">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Amount</th>
                <th scope="col">Reason</th>
                <th scope="col">Opened</th>
                <th scope="col">Evidence due</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((dispute) => (
                <DisputeRow dispute={dispute} key={dispute.id} />
              ))}
            </tbody>
          </Table>
        )}
        <Notice testId="dispute-evidence-blocked" tone="quiet">
          VELORA cannot submit evidence for any of these. No provider is
          approved, nothing has decided what evidence may be sent or who may
          send it, and a control here that accepted a file and did nothing with
          it would be worse than its absence.
        </Notice>
      </PanelBody>
    </Panel>
  );
}

function DisputeRow({ dispute }: { readonly dispute: Dispute }) {
  const look = disputeStateLook(dispute.state);
  return (
    <tr data-testid={`dispute-${dispute.id}`}>
      <td>
        {/* The provider's own reference: an operator who cannot name the case
            cannot answer it. */}
        <span className="a-numeric">{dispute.providerReference}</span>
      </td>
      <td className="a-numeric">
        {formatMinorUnits(dispute.amount.amountMinor, dispute.amount.currency)}{' '}
        {dispute.amount.currency}
      </td>
      <td>{disputeReasonLabels[dispute.reasonCode] ?? dispute.reasonCode}</td>
      <td>{formatDate(dispute.openedAt)}</td>
      <td>
        {dispute.evidenceDueAt === undefined ? (
          // A provider that publishes no deadline gets none recorded. A date
          // VELORA invented is a date an operator would plan around.
          <span className="a-quiet">Not published</span>
        ) : (
          formatDate(dispute.evidenceDueAt)
        )}
      </td>
      <td>
        <Badge icon={look.icon} tone={look.tone}>
          {look.label}
        </Badge>
        <span className="a-quiet"> · payment {shortId(dispute.paymentId)}</span>
      </td>
    </tr>
  );
}

/**
 * Money the platform holds, one currency at a time and never summed.
 *
 * Each amount is rendered against the published minor-unit exponent for its own
 * currency, so a yen shows no decimal places and a dinar shows three. No
 * currency symbol and no grouping: those are locale decisions nobody has
 * approved, and the code travels beside the digits so an amount is never
 * ambiguous about which currency it is in.
 */
function Totals({
  body,
  rows,
  testId,
  title,
}: {
  readonly body: string;
  readonly rows: readonly CurrencyTotal[];
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <Panel testId={testId}>
      <PanelHead lede={body} title={title} />
      <PanelBody>
        {rows.length === 0 ? (
          <EmptyState
            body="No currency carries an amount here."
            icon="ledger"
            testId={`${testId}-empty`}
            title="Nothing"
          />
        ) : (
          <>
            <Facts>
              {rows.map((row) => (
                <Fact
                  key={row.currency}
                  term={row.currency}
                  testId={`${testId}-${row.currency}`}
                  value={
                    <span className="a-numeric">
                      {formatMinorUnits(row.amountMinor, row.currency)}{' '}
                      {row.currency}
                    </span>
                  }
                />
              ))}
            </Facts>
            {rows.length > 1 ? (
              <p
                className="a-caption a-quiet"
                data-testid={`${testId}-no-total`}
              >
                Shown per currency and never added together, because the sum of
                two currencies is not an amount.
              </p>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * Issuing a refund: the one operation on this screen.
 *
 * It names a payment the operator already holds an identifier for. There is
 * deliberately no payment search: a console that could page through everybody's
 * purchases is a browsing surface over what people bought, and the refund path
 * is reached from a dispute, a support conversation, or a reconciliation
 * finding rather than by looking.
 *
 * The idempotency key is made once, when the dialog opens, and reused for every
 * attempt at this refund. A key regenerated per press would make the header
 * decoration rather than protection, and a retried refund that produced a
 * second refund is money the platform does not get back.
 */
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function RefundDialog({
  onClose,
  onDone,
}: {
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [paymentId, setPaymentId] = useState('');
  const [amountMinor, setAmountMinor] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('EUR');
  const [reasonCode, setReasonCode] = useState<RefundReasonCode>(
    'operator_correction',
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const amountPattern = /^\d{1,18}$/u;
  const amountValid = amountPattern.test(amountMinor.trim());
  const blocked =
    !acknowledged || paymentId.trim().length === 0 || !amountValid;

  return (
    <Dialog onClose={onClose} testId="refund-dialog" title="Issue a refund">
      <p className="a-small a-muted">
        This asks BILLING to return money to a member. It is applied by the
        payment provider, it is recorded against your session with the reason
        you choose, and it cannot be undone from here.
      </p>

      {message === undefined ? null : (
        <ErrorMessage testId="refund-error">{message}</ErrorMessage>
      )}

      <div className="a-stack a-stack--4">
        <Field
          hint="The payment being refunded. Paste the identifier you already hold; this console has no payment search."
          label="Payment"
        >
          {(control) => (
            <TextInput
              {...control}
              data-testid="refund-payment"
              onChange={(event) => {
                setPaymentId(event.target.value);
              }}
              spellCheck={false}
              value={paymentId}
            />
          )}
        </Field>

        <Field
          error={
            amountMinor.length > 0 && !amountValid
              ? 'Whole minor units only — 1050 is ten euros and fifty cents.'
              : undefined
          }
          hint="In the currency's own minor units, as an integer. The platform never represents money as a decimal number."
          label="Amount"
        >
          {(control) => (
            <TextInput
              {...control}
              data-testid="refund-amount"
              inputMode="numeric"
              onChange={(event) => {
                setAmountMinor(event.target.value);
              }}
              value={amountMinor}
            />
          )}
        </Field>

        <Field
          hint="Only the currencies the platform can represent. A code it cannot represent is a code it cannot do arithmetic in."
          label="Currency"
        >
          {(control) => (
            <Select
              {...control}
              data-testid="refund-currency"
              onChange={(event) => {
                setCurrency(event.target.value as CurrencyCode);
              }}
              value={currency}
            >
              {currencyCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          hint="A category the platform publishes. It is recorded and it is not free text."
          label="Reason"
        >
          {(control) => (
            <Select
              {...control}
              data-testid="refund-reason"
              onChange={(event) => {
                setReasonCode(event.target.value as RefundReasonCode);
              }}
              value={reasonCode}
            >
              {Object.entries(refundReasonLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Notice testId="refund-idempotency" tone="quiet">
          Pressing twice does not refund twice. This request carries a key the
          platform recognises, and it stays the same for every attempt at this
          refund.
        </Notice>

        <Acknowledgement
          checked={acknowledged}
          onChange={setAcknowledged}
          testId="refund-acknowledge"
        >
          I am returning {amountValid ? amountMinor.trim() : 'an amount'} minor
          units of {currency} against this payment, with my own session.
        </Acknowledgement>
      </div>

      <div className="a-dialog__actions">
        <Button disabled={busy} onClick={onClose} tone="ghost">
          Cancel
        </Button>
        <Button
          busy={busy}
          data-testid="refund-submit"
          disabled={blocked}
          tone="danger"
          onClick={() => {
            run(async () => {
              const result = await api.issueRefund({
                body: {
                  amountMinor: amountMinor.trim(),
                  currency,
                  paymentId: paymentId.trim(),
                  reasonCode,
                },
                idempotencyKey,
              });
              const failure = failureMessage(result);
              setMessage(failure);
              if (failure === undefined) {
                toast.show('BILLING accepted the refund.', 'positive');
                onDone();
              }
            });
          }}
        >
          Issue the refund
        </Button>
      </div>
    </Dialog>
  );
}
