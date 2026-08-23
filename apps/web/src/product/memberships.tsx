'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import type { ConsumerSubscriptionList } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';
import { formatMinorUnits } from '@velora/validation';

import { useApi, useToast } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Badge,
  BlockedState,
  Button,
  Card,
  ErrorMessage,
  Field,
  Notice,
  PageHeader,
  RowSkeleton,
  TextInput,
  type Tone,
} from '../design/primitives';
import { formatRelative } from './locale';
import { useResource, useSingleFlight } from './resource';

/**
 * Private clubs somebody has been let into, and anything they are paying for.
 *
 * There is deliberately no purchase control anywhere on this surface. No payment
 * provider is approved for Velora's business model and no commercial terms are
 * published, so a Subscribe button would describe a product that does not exist
 * — and a control that cannot succeed is worse than an explanation of why there
 * is none, because somebody presses it, waits, and concludes the platform is
 * broken rather than unfinished.
 *
 * What does exist is an invitation. A creator sends a bearer secret, it is
 * single-use, and redemption is settled by the database rather than by a read,
 * so presenting the same one twice admits its holder exactly once. It is typed
 * in once and never rendered again — a credential a surface echoes back is a
 * credential in a screenshot, a support ticket, and a browser history.
 *
 * `past_due` is shown and grants nothing. Whether a lapsed payment keeps access,
 * and for how long, is grace policy nobody has approved, and the fail-closed
 * reading of an unresolved policy is no access — said plainly rather than
 * implied by a period that quietly kept working.
 */

const stateLabels: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
  active: { label: 'Active', tone: 'positive' },
  cancel_at_period_end: {
    label: 'Ends at the end of the paid period',
    tone: 'caution',
  },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  past_due: {
    label: 'Payment lapsed — access is not active',
    tone: 'critical',
  },
  pending: { label: 'Starting', tone: 'info' },
  terminated: { label: 'Ended', tone: 'neutral' },
};

/** What created an entitlement, in words rather than in the wire vocabulary. */
const sourceLabels: Readonly<Record<string, string>> = {
  admin_grant: 'Granted by VELORA',
  billing: 'Paid membership',
  creator_invite: 'Invitation from the creator',
};

export function Memberships() {
  return (
    <>
      <PageHeader
        lede="Private clubs a creator has let you into, and anything you are paying for."
        title="Memberships"
      />
      <div className="v-stack v-stack--6">
        <ClubAccessCard />
        <SubscriptionsCard />
      </div>
    </>
  );
}

function ClubAccessCard() {
  const api = useApi();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.clubAccess(signal),
    [api],
  );
  const access = useResource(load);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();
  const rows = access.value?.access ?? [];

  const redeem = () => {
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
      // Cleared on success and never rendered again. The server settled it, so
      // holding on to it would only keep a spent credential on this screen.
      setSecret('');
      toast.show('You are in. The club is on this page now.', 'positive');
      access.reload();
    });
  };

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

        {access.loading && access.value === undefined ? (
          <RowSkeleton rows={2} />
        ) : null}

        {access.error === undefined ? null : (
          <div className="v-stack v-stack--3">
            <ErrorMessage testId="club-access-failed">
              {access.error}
            </ErrorMessage>
            {access.retryable ? (
              <div>
                <Button onClick={access.reload}>Try again</Button>
              </div>
            ) : null}
          </div>
        )}

        {!access.loading && access.error === undefined && rows.length === 0 ? (
          <p className="v-small v-muted" data-testid="club-access-empty">
            You are not in any private clubs. A creator lets somebody in by
            sending them an invitation; there is no way to ask for one and
            nothing to buy.
          </p>
        ) : null}

        {rows.length === 0 ? null : (
          <ul className="v-list v-list--divided" data-testid="club-access-list">
            {rows.map((row) => (
              <li data-testid={`club-access-${row.clubId}`} key={row.clubId}>
                <div className="v-row">
                  <span className="v-notification__mark">
                    <Icon name="lock" size="md" />
                  </span>
                  <span className="v-row__body">
                    <span className="v-subheading v-wrap">{row.clubName}</span>
                    <span className="v-caption v-quiet">
                      <Link href={`/c/${row.creatorHandle}`}>
                        @{row.creatorHandle}
                      </Link>{' '}
                      · joined {formatRelative(row.grantedAt)}
                    </span>
                  </span>
                  <Badge tone="neutral">
                    {sourceLabels[row.source] ?? 'Access granted'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          className="v-stack v-stack--4"
          onSubmit={(event) => {
            event.preventDefault();
            redeem();
          }}
        >
          <Field
            error={error}
            hint="A creator sends this to you directly. It works once, and you will not see it again after that."
            label="Have an invitation?"
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

        {rows.length === 0 ? null : (
          <Notice icon="lock" testId="club-content-blocked" tone="quiet">
            VELORA has no way yet to show you what is inside a club: nothing
            publishes a member&apos;s reading list, so there is nothing here to
            open. Your access is real and recorded, and the contents appear when
            a route for them exists.
          </Notice>
        )}
      </div>
    </section>
  );
}

function SubscriptionsCard() {
  const api = useApi();
  const load = useCallback(async () => api.subscriptions(), [api]);
  const subscriptions = useResource<ConsumerSubscriptionList>(load);
  const rows = subscriptions.value?.subscriptions ?? [];

  return (
    <div className="v-stack v-stack--6">
      <BlockedState
        testId="memberships-commerce"
        title="Nothing on VELORA can be bought yet"
      >
        <p>
          No payment provider is approved for what VELORA does, so there is no
          checkout anywhere on this site and no price to show you. Access to a
          private club comes from an invitation its creator sends, which is not
          something a page can offer you.
        </p>
      </BlockedState>

      {subscriptions.loading && subscriptions.value === undefined ? (
        <Card>
          <RowSkeleton rows={2} />
        </Card>
      ) : null}

      {subscriptions.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="memberships-failed">
            {subscriptions.error}
          </ErrorMessage>
          {subscriptions.retryable ? (
            <div>
              <Button onClick={subscriptions.reload}>Try again</Button>
            </div>
          ) : null}
        </div>
      )}

      {subscriptions.value === undefined ? null : rows.length === 0 ? (
        <Card>
          <p className="v-small v-muted" data-testid="memberships-empty">
            You are not paying for anything, because nothing on VELORA can be
            charged for yet.
          </p>
        </Card>
      ) : (
        <Card flush>
          <ul className="v-list v-list--divided">
            {rows.map((row) => {
              const state = stateLabels[row.state] ?? {
                label: row.state.replaceAll('_', ' '),
                tone: 'neutral' as Tone,
              };
              return (
                <li data-testid={`membership-${row.id}`} key={row.id}>
                  <div className="v-row">
                    <span className="v-row__body">
                      <span className="v-subheading">
                        {formatMinorUnits(
                          row.amount.amountMinor,
                          row.amount.currency,
                        )}{' '}
                        {row.amount.currency}
                      </span>
                      {row.currentPeriodEnd === undefined ? null : (
                        <span className="v-caption v-quiet">
                          Paid through{' '}
                          <time dateTime={row.currentPeriodEnd}>
                            {new Date(
                              row.currentPeriodEnd,
                            ).toLocaleDateString()}
                          </time>
                        </span>
                      )}
                    </span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
