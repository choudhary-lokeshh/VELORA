'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import type {
  ClubAccess,
  ConsumerPaymentList,
  ConsumerSubscription,
  ConsumerSubscriptionList,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi, useToast } from '../app/providers';
import { ConfirmDialog } from '../design/dialog';
import { Icon } from '../design/icons';
import {
  Badge,
  Button,
  ErrorMessage,
  Field,
  Notice,
  PageHeader,
  RowSkeleton,
  TextInput,
} from '../design/primitives';
import {
  cadenceLabels,
  formatPrice,
  membershipSourceLabels,
  paymentFailureLabels,
  paymentStateLook,
  subscriptionStateLook,
  subscriptionStateMeaning,
} from './commerce';
import { formatDay, formatRelative } from './locale';
import { useResource, useSingleFlight } from './resource';

/**
 * Everything somebody holds, and everything they are paying for.
 *
 * Three provenances live on this page and they are deliberately kept apart,
 * because they end in different ways and confusing them would let somebody give
 * away something they paid for. An invitation is a gift a creator gave, and
 * handing it back ends it. A paid membership is a commercial relationship with
 * a period and a renewal, and it ends through cancellation — which stops the
 * renewal and leaves the paid period alone. VELORA's own grants are neither.
 *
 * Nothing here softens a state. `past_due` says access has stopped, because it
 * has: whether a lapsed payment keeps access is grace policy nobody approved,
 * and the fail-closed reading of an unresolved policy is no access.
 *
 * The invitation field takes a bearer secret, sends it once, and never renders
 * it again. A credential a surface echoes back is a credential in a screenshot,
 * a support ticket, and a browser history.
 */

export function Memberships() {
  const api = useApi();
  const loadAccess = useCallback(
    async (signal: AbortSignal) => api.clubAccess(signal),
    [api],
  );
  const access = useResource(loadAccess);
  const loadSubscriptions = useCallback(async () => api.subscriptions(), [api]);
  const subscriptions =
    useResource<ConsumerSubscriptionList>(loadSubscriptions);

  const reload = () => {
    access.reload();
    subscriptions.reload();
  };

  const rows = access.value?.access ?? [];
  const held = subscriptions.value?.subscriptions ?? [];
  // A club by the identifier BILLING publishes against it. This is the join
  // between two owners, made where both answers arrive.
  const clubByResource = useMemo(() => {
    const found = new Map<string, ClubAccess>();
    for (const entry of rows) {
      if (!found.has(entry.clubId)) found.set(entry.clubId, entry);
    }
    return found;
  }, [rows]);

  const paid = held.filter(
    (row) => row.state !== 'cancelled' && row.state !== 'terminated',
  );
  const past = held.filter(
    (row) => row.state === 'cancelled' || row.state === 'terminated',
  );
  const invitations = rows.filter(
    (row) => row.state === 'active' && row.source !== 'billing',
  );
  const ended = rows.filter((row) => row.state === 'revoked');

  return (
    <>
      <PageHeader
        lede="Private clubs you have been let into, and anything you are paying for."
        title="Memberships"
      />
      <div className="v-stack v-stack--6">
        <PaidMemberships
          clubs={clubByResource}
          error={subscriptions.error}
          loading={subscriptions.loading && subscriptions.value === undefined}
          onChanged={reload}
          retry={subscriptions.retryable ? subscriptions.reload : undefined}
          rows={paid}
        />
        <Invitations
          error={access.error}
          loading={access.loading && access.value === undefined}
          onChanged={reload}
          retry={access.retryable ? access.reload : undefined}
          rows={invitations}
        />
        <PastMemberships clubs={clubByResource} ended={ended} rows={past} />
        <RedeemInvitation onRedeemed={reload} />
        <PaymentHistory clubs={clubByResource} />
      </div>
    </>
  );
}

/* ============================ Paid memberships ======================= */

function PaidMemberships({
  clubs,
  error,
  loading,
  onChanged,
  retry,
  rows,
}: {
  readonly clubs: ReadonlyMap<string, ClubAccess>;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly onChanged: () => void;
  readonly retry: (() => void) | undefined;
  readonly rows: readonly ConsumerSubscription[];
}) {
  return (
    <section
      aria-labelledby="paid-heading"
      className="v-card"
      data-testid="paid-memberships"
    >
      <div className="v-stack v-stack--5">
        <h2 className="v-subheading" id="paid-heading">
          Paid memberships
        </h2>

        {loading ? <RowSkeleton rows={2} /> : null}

        {error === undefined ? null : (
          <div className="v-stack v-stack--3">
            <ErrorMessage testId="memberships-failed">{error}</ErrorMessage>
            {retry === undefined ? null : (
              <div>
                <Button onClick={retry}>Try again</Button>
              </div>
            )}
          </div>
        )}

        {!loading && error === undefined && rows.length === 0 ? (
          <p className="v-small v-muted" data-testid="memberships-empty">
            You are not paying for anything. A creator&apos;s page shows what
            they sell, if they sell anything.
          </p>
        ) : null}

        {rows.length === 0 ? null : (
          <ul className="v-list v-list--divided" data-testid="memberships-list">
            {rows.map((row) => (
              <li data-testid={`membership-${row.id}`} key={row.id}>
                <PaidMembership
                  club={
                    row.resource === undefined
                      ? undefined
                      : clubs.get(row.resource.id)
                  }
                  onChanged={onChanged}
                  row={row}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PaidMembership({
  club,
  onChanged,
  row,
}: {
  readonly club: ClubAccess | undefined;
  readonly onChanged: () => void;
  readonly row: ConsumerSubscription;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const look = subscriptionStateLook(row.state);
  const cancellable = row.state === 'active' || row.state === 'past_due';

  return (
    <div className="v-stack v-stack--3">
      <div className="v-row">
        <span className="v-row__body">
          <span className="v-subheading v-wrap">
            {club?.clubName ?? 'Membership'}
          </span>
          <span className="v-caption v-quiet">
            {club === undefined ? null : (
              <>
                <Link href={`/c/${club.creatorHandle}`}>
                  @{club.creatorHandle}
                </Link>
                {' · '}
              </>
            )}
            <span className="v-numeric">{formatPrice(row.amount)}</span>
            {row.interval === undefined
              ? null
              : ` ${cadenceLabels[row.interval] ?? ''}`}
          </span>
        </span>
        <Badge tone={look.tone}>{look.label}</Badge>
      </div>

      <p className="v-caption v-quiet">{subscriptionStateMeaning[row.state]}</p>

      {row.currentPeriodEnd === undefined ? null : (
        <p className="v-caption v-quiet">
          {row.state === 'cancel_at_period_end' ? 'Access ends ' : 'Renews '}
          <time dateTime={row.currentPeriodEnd}>
            {formatDay(row.currentPeriodEnd)}
          </time>
        </p>
      )}

      {error === undefined ? null : (
        <ErrorMessage testId={`membership-error-${row.id}`}>
          {error}
        </ErrorMessage>
      )}

      <div className="v-inline v-inline--tight">
        {club === undefined ? null : (
          <Link
            className="v-btn v-btn--secondary"
            href={`/c/${club.creatorHandle}/club/${club.clubSlug}`}
          >
            Open the club
          </Link>
        )}
        {cancellable ? (
          <Button
            data-testid={`membership-cancel-${row.id}`}
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Stop renewing
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Stop renewing"
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            run(async () => {
              setError(undefined);
              const result = await api.cancelSubscription({
                subscriptionId: row.id,
              });
              if (!isOk(result)) {
                setError(failureMessage(result));
                return;
              }
              toast.show('It will not renew.', 'positive');
              onChanged();
            });
          }}
          testId={`membership-cancel-confirm-${row.id}`}
          title="Stop this membership renewing?"
        >
          {row.state === 'past_due' ? (
            <p>
              This membership has already lapsed and is not giving you access,
              so nothing is being taken away. It will end now.
            </p>
          ) : (
            <>
              <p>
                You keep everything this gives you until{' '}
                {row.currentPeriodEnd === undefined
                  ? 'the end of the period you have paid for'
                  : formatDay(row.currentPeriodEnd)}
                . After that it ends and nothing more is charged.
              </p>
              <p>
                This is not a refund. VELORA has published no refund terms, so
                stopping a membership does not return what has already been
                paid.
              </p>
            </>
          )}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ============================== Invitations ========================== */

function Invitations({
  error,
  loading,
  onChanged,
  retry,
  rows,
}: {
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly onChanged: () => void;
  readonly retry: (() => void) | undefined;
  readonly rows: readonly ClubAccess[];
}) {
  return (
    <section
      aria-labelledby="clubs-heading"
      className="v-card"
      data-testid="club-access-card"
    >
      <div className="v-stack v-stack--5">
        <h2 className="v-subheading" id="clubs-heading">
          Private clubs
        </h2>

        {loading ? <RowSkeleton rows={2} /> : null}

        {error === undefined ? null : (
          <div className="v-stack v-stack--3">
            <ErrorMessage testId="club-access-failed">{error}</ErrorMessage>
            {retry === undefined ? null : (
              <div>
                <Button onClick={retry}>Try again</Button>
              </div>
            )}
          </div>
        )}

        {!loading && error === undefined && rows.length === 0 ? (
          <p className="v-small v-muted" data-testid="club-access-empty">
            You are not in any private club by invitation. A creator lets
            somebody in by sending them one directly; there is no way to ask.
          </p>
        ) : null}

        {rows.length === 0 ? null : (
          <ul className="v-list v-list--divided" data-testid="club-access-list">
            {rows.map((row) => (
              <li data-testid={`club-access-${row.clubId}`} key={row.clubId}>
                <Invitation onChanged={onChanged} row={row} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Invitation({
  onChanged,
  row,
}: {
  readonly onChanged: () => void;
  readonly row: ClubAccess;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <div className="v-stack v-stack--3">
      <div className="v-row">
        <span className="v-notification__mark">
          <Icon name="lock" size="md" />
        </span>
        <span className="v-row__body">
          <span className="v-subheading v-wrap">{row.clubName}</span>
          <span className="v-caption v-quiet">
            <Link href={`/c/${row.creatorHandle}`}>@{row.creatorHandle}</Link> ·
            joined {formatRelative(row.grantedAt)}
          </span>
        </span>
        <Badge tone="neutral">
          {membershipSourceLabels[row.source] ?? 'Access granted'}
        </Badge>
      </div>

      {error === undefined ? null : (
        <ErrorMessage testId={`club-leave-error-${row.clubId}`}>
          {error}
        </ErrorMessage>
      )}

      <div className="v-inline v-inline--tight">
        <Link
          className="v-btn v-btn--secondary"
          data-testid={`club-open-${row.clubId}`}
          href={`/c/${row.creatorHandle}/club/${row.clubSlug}`}
        >
          Open the club
        </Link>
        {row.source === 'creator_invite' ? (
          <Button
            data-testid={`club-leave-${row.clubId}`}
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Leave
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Leave the club"
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            run(async () => {
              setError(undefined);
              const result = await api.leaveClub({ clubId: row.clubId });
              if (!isOk(result)) {
                setError(failureMessage(result));
                return;
              }
              toast.show('You have left the club.', 'positive');
              onChanged();
            });
          }}
          testId={`club-leave-confirm-${row.clubId}`}
          title={`Leave ${row.clubName}?`}
        >
          <p>
            You will not be able to read anything in it. Getting back in needs a
            fresh invitation from the creator, and there is no way to ask for
            one.
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ================================= Past ============================== */

function PastMemberships({
  clubs,
  ended,
  rows,
}: {
  readonly clubs: ReadonlyMap<string, ClubAccess>;
  readonly ended: readonly ClubAccess[];
  readonly rows: readonly ConsumerSubscription[];
}) {
  // A club whose subscription ended appears once, under the subscription, so
  // the same membership is not listed twice in two vocabularies.
  const accounted = new Set(
    rows.flatMap((row) =>
      row.resource === undefined ? [] : [row.resource.id],
    ),
  );
  const invitations = ended.filter((row) => !accounted.has(row.clubId));
  if (rows.length === 0 && invitations.length === 0) return null;

  return (
    <section
      aria-labelledby="past-heading"
      className="v-card"
      data-testid="past-memberships"
    >
      <div className="v-stack v-stack--5">
        <h2 className="v-subheading" id="past-heading">
          Ended
        </h2>
        <ul className="v-list v-list--divided">
          {rows.map((row) => {
            const club =
              row.resource === undefined
                ? undefined
                : clubs.get(row.resource.id);
            return (
              <li data-testid={`past-membership-${row.id}`} key={row.id}>
                <div className="v-row">
                  <span className="v-row__body">
                    <span className="v-subheading v-wrap">
                      {club?.clubName ?? 'Membership'}
                    </span>
                    <span className="v-caption v-quiet">
                      <span className="v-numeric">
                        {formatPrice(row.amount)}
                      </span>
                      {row.cancelledAt === undefined
                        ? null
                        : ` · ended ${formatDay(row.cancelledAt)}`}
                    </span>
                  </span>
                  <Badge tone="neutral">Ended</Badge>
                </div>
              </li>
            );
          })}
          {invitations.map((row) => (
            <li data-testid={`past-club-${row.clubId}`} key={row.clubId}>
              <div className="v-row">
                <span className="v-row__body">
                  <span className="v-subheading v-wrap">{row.clubName}</span>
                  <span className="v-caption v-quiet">
                    @{row.creatorHandle}
                    {row.endedAt === undefined
                      ? null
                      : ` · ended ${formatDay(row.endedAt)}`}
                  </span>
                </span>
                <Badge tone="neutral">Ended</Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* =============================== Redeeming =========================== */

function RedeemInvitation({ onRedeemed }: { readonly onRedeemed: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  return (
    <section
      aria-labelledby="redeem-heading"
      className="v-card"
      data-testid="club-redeem-card"
    >
      <form
        className="v-stack v-stack--4"
        onSubmit={(event) => {
          event.preventDefault();
          const presented = secret.trim();
          if (presented.length === 0) {
            setError('Paste the invitation you were sent.');
            return;
          }
          run(async () => {
            setError(undefined);
            const result = await api.redeemClubInvite({ secret: presented });
            if (!isOk(result)) {
              setError(failureMessage(result));
              return;
            }
            // Cleared on success and never rendered again. The server settled
            // it, so holding a spent credential on screen serves nobody.
            setSecret('');
            toast.show('You are in. The club is on this page now.', 'positive');
            onRedeemed();
          });
        }}
      >
        <h2 className="v-subheading" id="redeem-heading">
          Have an invitation?
        </h2>
        <Field
          error={error}
          hint="A creator sends this to you directly. It works once, and you will not see it again after that."
          label="Invitation"
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              data-testid="club-invite-secret"
              name="secret"
              onChange={(event) => {
                setSecret(event.target.value);
                setError(undefined);
              }}
              placeholder="Paste it here"
              spellCheck={false}
              value={secret}
            />
          )}
        </Field>
        <div>
          <Button
            busy={busy}
            data-testid="club-invite-redeem"
            tone="primary"
            type="submit"
          >
            Join the club
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ============================ Payment history ======================== */

/**
 * Every charge and near-charge, newest first.
 *
 * A record of attempts rather than a set of receipts, and it says so. What a
 * receipt has to carry — a merchant of record, a tax breakdown, a sequence
 * number — is unresolved commercial and tax policy, and a page that called this
 * a receipt would be making a claim nobody has approved.
 */
function PaymentHistory({
  clubs,
}: {
  readonly clubs: ReadonlyMap<string, ClubAccess>;
}) {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.payments({ pageSize: 25 }, signal),
    [api],
  );
  const payments = useResource<ConsumerPaymentList>(load);
  const rows = payments.value?.payments ?? [];

  if (payments.value !== undefined && rows.length === 0) return null;

  return (
    <section
      aria-labelledby="payments-heading"
      className="v-card"
      data-testid="payment-history"
    >
      <div className="v-stack v-stack--5">
        <h2 className="v-subheading" id="payments-heading">
          Payments
        </h2>
        {payments.value === undefined ? (
          payments.error === undefined ? (
            <RowSkeleton rows={2} />
          ) : (
            <ErrorMessage testId="payments-failed">
              {payments.error}
            </ErrorMessage>
          )
        ) : (
          <ul className="v-list v-list--divided">
            {rows.map((row) => {
              const look = paymentStateLook(row.state);
              const club =
                row.resource === undefined
                  ? undefined
                  : clubs.get(row.resource.id);
              return (
                <li data-testid={`payment-${row.id}`} key={row.id}>
                  <div className="v-row">
                    <span className="v-row__body">
                      <span className="v-subheading v-numeric">
                        {formatPrice(row.amount)}
                      </span>
                      <span className="v-caption v-quiet">
                        {club?.clubName ?? 'VELORA'} ·{' '}
                        <time dateTime={row.createdAt}>
                          {formatDay(row.createdAt)}
                        </time>
                        {row.failureReason === undefined
                          ? null
                          : ` · ${paymentFailureLabels[row.failureReason] ?? ''}`}
                      </span>
                    </span>
                    <Badge tone={look.tone}>{look.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Notice icon="info" testId="payments-not-receipts" tone="quiet">
          This is a record of what was attempted, not a receipt. What a receipt
          has to say is a commercial and tax question VELORA has not answered,
          and it will not pretend otherwise.
        </Notice>
      </div>
    </section>
  );
}
