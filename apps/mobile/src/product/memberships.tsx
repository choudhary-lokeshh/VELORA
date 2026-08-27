import type {
  ClubAccess,
  ConsumerPaymentList,
  ConsumerSubscription,
  ConsumerSubscriptionList,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import { clubPath } from '../frame/links';
import {
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  ErrorMessage,
  Field,
  Notice,
  RowSkeleton,
  Stack,
  Text,
  TextField,
} from '../design/primitives';
import { Sheet } from '../design/sheet';
import { space } from '../design/tokens';
import {
  cadenceLabels,
  formatPrice,
  membershipSourceLabels,
  paymentStateLook,
  subscriptionStateLook,
  subscriptionStateMeaning,
} from './commerce';
import { formatDate } from './locale';
import { useResource, useSingleFlight } from './resource';

/**
 * What somebody holds, and what they are paying for, on a phone.
 *
 * Parity with Consumer Web in what it says, not in what it does. Two things are
 * deliberately different here and both are boundaries rather than omissions:
 *
 * **There is no purchase.** Starting one from a mobile application is a
 * different commercial arrangement with different obligations, and the API
 * refuses it for this audience rather than the screen merely omitting a button.
 * A club that is for sale says so and says where; it never offers a control
 * that would be refused.
 *
 * **There is cancellation.** Stopping a subscription is not a commercial
 * arrangement, and a product that showed somebody their own subscription while
 * refusing to end it from the device in their hand would be making it harder to
 * leave than to enter.
 */

export function MembershipsScreen({
  onBack,
  onOpenClub,
}: {
  readonly onBack: () => void;
  readonly onOpenClub: (path: string) => void;
}) {
  const api = useApi();
  const loadAccess = useCallback(
    async (signal: AbortSignal) => api.clubAccess(signal),
    [api],
  );
  const access = useResource(loadAccess);
  const loadSubscriptions = useCallback(async () => api.subscriptions(), [api]);
  const subscriptions =
    useResource<ConsumerSubscriptionList>(loadSubscriptions);
  const loadPayments = useCallback(
    async (signal: AbortSignal) => api.payments({ pageSize: 25 }, signal),
    [api],
  );
  const payments = useResource<ConsumerPaymentList>(loadPayments);

  const reload = () => {
    access.reload();
    subscriptions.reload();
    payments.reload();
  };

  const rows = access.value?.access ?? [];
  const held = subscriptions.value?.subscriptions ?? [];
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
  const loading =
    access.value === undefined && subscriptions.value === undefined;

  return (
    <Screen
      onBack={onBack}
      onRefresh={reload}
      refreshing={access.loading || subscriptions.loading}
      subtitle="Clubs you have been let into, and anything you are paying for."
      testID="memberships"
      title="Memberships"
    >
      <Stack gap={6}>
        {loading ? <RowSkeleton rows={3} /> : null}

        {subscriptions.error === undefined ? null : (
          <ErrorMessage testID="memberships-failed">
            {subscriptions.error}
          </ErrorMessage>
        )}

        <Card testID="paid-memberships">
          <Stack gap={4}>
            <Text variant="subheading">Paid memberships</Text>
            {paid.length === 0 ? (
              <Text testID="memberships-empty" tone="secondary" variant="small">
                You are not paying for anything. A creator&apos;s page shows
                what they sell, if they sell anything.
              </Text>
            ) : (
              paid.map((row, index) => (
                <View key={row.id}>
                  {index === 0 ? null : <Divider />}
                  <PaidMembership
                    club={
                      row.resource === undefined
                        ? undefined
                        : clubByResource.get(row.resource.id)
                    }
                    onChanged={reload}
                    onOpenClub={onOpenClub}
                    row={row}
                  />
                </View>
              ))
            )}
          </Stack>
        </Card>

        <Card testID="club-access-card">
          <Stack gap={4}>
            <Text variant="subheading">Private clubs</Text>
            {access.error === undefined ? null : (
              <ErrorMessage testID="club-access-failed">
                {access.error}
              </ErrorMessage>
            )}
            {invitations.length === 0 ? (
              <Text testID="club-access-empty" tone="secondary" variant="small">
                You are not in any private club by invitation. A creator lets
                somebody in by sending them one directly; there is no way to
                ask.
              </Text>
            ) : (
              invitations.map((row, index) => (
                <View key={row.clubId}>
                  {index === 0 ? null : <Divider />}
                  <Invitation
                    onChanged={reload}
                    onOpenClub={onOpenClub}
                    row={row}
                  />
                </View>
              ))
            )}
            <RedeemInvitation onRedeemed={reload} />
          </Stack>
        </Card>

        {past.length === 0 ? null : (
          <Card testID="past-memberships">
            <Stack gap={4}>
              <Text variant="subheading">Ended</Text>
              {past.map((row) => (
                <View key={row.id} style={styles.row}>
                  <Text variant="body">
                    {(row.resource === undefined
                      ? undefined
                      : clubByResource.get(row.resource.id)?.clubName) ??
                      'Membership'}
                  </Text>
                  <Badge tone="neutral">Ended</Badge>
                </View>
              ))}
            </Stack>
          </Card>
        )}

        {(payments.value?.payments ?? []).length === 0 ? null : (
          <Card testID="payment-history">
            <Stack gap={4}>
              <Text variant="subheading">Payments</Text>
              {(payments.value?.payments ?? []).map((row) => {
                const look = paymentStateLook(row.state);
                return (
                  <View
                    key={row.id}
                    style={styles.row}
                    testID={`payment-${row.id}`}
                  >
                    <Stack gap={1}>
                      <Text variant="body">{formatPrice(row.amount)}</Text>
                      <Text tone="tertiary" variant="caption">
                        {formatDate(row.createdAt)}
                      </Text>
                    </Stack>
                    <Badge tone={look.tone}>{look.label}</Badge>
                  </View>
                );
              })}
              <Text tone="tertiary" variant="caption">
                A record of what was attempted, not a receipt. What a receipt
                has to say is a question VELORA has not answered.
              </Text>
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
  );
}

function PaidMembership({
  club,
  onChanged,
  onOpenClub,
  row,
}: {
  readonly club: ClubAccess | undefined;
  readonly onChanged: () => void;
  readonly onOpenClub: (path: string) => void;
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
    <View testID={`membership-${row.id}`}>
      <Stack gap={3}>
        <View style={styles.row}>
          <Stack gap={1}>
            <Text variant="body">{club?.clubName ?? 'Membership'}</Text>
            <Text tone="tertiary" variant="caption">
              {formatPrice(row.amount)}
              {row.interval === undefined
                ? ''
                : ` ${cadenceLabels[row.interval] ?? ''}`}
            </Text>
          </Stack>
          <Badge tone={look.tone}>{look.label}</Badge>
        </View>

        <Text tone="secondary" variant="caption">
          {subscriptionStateMeaning[row.state] ?? ''}
        </Text>

        {row.currentPeriodEnd === undefined ? null : (
          <Text tone="tertiary" variant="caption">
            {row.state === 'cancel_at_period_end' ? 'Access ends ' : 'Renews '}
            {formatDate(row.currentPeriodEnd)}
          </Text>
        )}

        {error === undefined ? null : (
          <ErrorMessage testID={`membership-error-${row.id}`}>
            {error}
          </ErrorMessage>
        )}

        <View style={styles.actions}>
          {club === undefined ? null : (
            <Button
              onPress={() => {
                onOpenClub(clubPath(club.creatorHandle, club.clubSlug));
              }}
              testID={`membership-open-${row.id}`}
            >
              Open the club
            </Button>
          )}
          {cancellable ? (
            <Button
              onPress={() => {
                setConfirming(true);
              }}
              testID={`membership-cancel-${row.id}`}
            >
              Stop renewing
            </Button>
          ) : null}
        </View>

        {confirming ? (
          <Sheet
            onClose={() => {
              setConfirming(false);
            }}
            testID={`membership-cancel-sheet-${row.id}`}
            title="Stop this membership renewing?"
          >
            <Stack gap={4}>
              <Text tone="secondary" variant="small">
                {row.state === 'past_due'
                  ? 'This membership has already lapsed and is not giving you access, so nothing is being taken away.'
                  : `You keep everything this gives you until ${
                      row.currentPeriodEnd === undefined
                        ? 'the end of the period you have paid for'
                        : formatDate(row.currentPeriodEnd)
                    }. After that it ends and nothing more is charged.`}
              </Text>
              <Text tone="secondary" variant="small">
                This is not a refund. VELORA has published no refund terms, so
                stopping a membership does not return what has already been
                paid.
              </Text>
              <Button
                busy={busy}
                onPress={() => {
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
                testID={`membership-cancel-confirm-${row.id}`}
                tone="primary"
              >
                Stop renewing
              </Button>
            </Stack>
          </Sheet>
        ) : null}
      </Stack>
    </View>
  );
}

function Invitation({
  onChanged,
  onOpenClub,
  row,
}: {
  readonly onChanged: () => void;
  readonly onOpenClub: (path: string) => void;
  readonly row: ClubAccess;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <View testID={`club-access-${row.clubId}`}>
      <Stack gap={3}>
        <View style={styles.row}>
          <Stack gap={1}>
            <Text variant="body">{row.clubName}</Text>
            <Text tone="tertiary" variant="caption">
              @{row.creatorHandle} · joined {formatDate(row.grantedAt)}
            </Text>
          </Stack>
          <Chip>{membershipSourceLabels[row.source] ?? 'Access granted'}</Chip>
        </View>

        {error === undefined ? null : (
          <ErrorMessage testID={`club-leave-error-${row.clubId}`}>
            {error}
          </ErrorMessage>
        )}

        <View style={styles.actions}>
          <Button
            onPress={() => {
              onOpenClub(clubPath(row.creatorHandle, row.clubSlug));
            }}
            testID={`club-open-${row.clubId}`}
          >
            Open the club
          </Button>
          {row.source === 'creator_invite' ? (
            <Button
              onPress={() => {
                setConfirming(true);
              }}
              testID={`club-leave-${row.clubId}`}
            >
              Leave
            </Button>
          ) : null}
        </View>

        {confirming ? (
          <Sheet
            onClose={() => {
              setConfirming(false);
            }}
            testID={`club-leave-sheet-${row.clubId}`}
            title={`Leave ${row.clubName}?`}
          >
            <Stack gap={4}>
              <Text tone="secondary" variant="small">
                You will not be able to read anything in it. Getting back in
                needs a fresh invitation from the creator, and there is no way
                to ask for one.
              </Text>
              <Button
                busy={busy}
                onPress={() => {
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
                testID={`club-leave-confirm-${row.clubId}`}
                tone="primary"
              >
                Leave the club
              </Button>
            </Stack>
          </Sheet>
        ) : null}
      </Stack>
    </View>
  );
}

function RedeemInvitation({ onRedeemed }: { readonly onRedeemed: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Stack gap={3}>
      <Field
        error={error}
        hint="A creator sends this to you directly. It works once, and you will not see it again after that."
        label="Have an invitation?"
      >
        {(control) => (
          <TextField
            {...control}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => {
              setSecret(value);
              setError(undefined);
            }}
            placeholder="Paste it here"
            testID="club-invite-secret"
            value={secret}
          />
        )}
      </Field>
      <Button
        busy={busy}
        onPress={() => {
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
            // Cleared on success and never rendered again. A credential a
            // surface echoes back is a credential in a screenshot.
            setSecret('');
            toast.show('You are in.', 'positive');
            onRedeemed();
          });
        }}
        testID="club-invite-redeem"
        tone="primary"
      >
        Join the club
      </Button>
      <Notice
        testID="memberships-no-purchase"
        title="Memberships are bought on the web"
      >
        Memberships are bought on velora.com. Nothing here charges you, and
        nothing here can.
      </Notice>
    </Stack>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[3],
    justifyContent: 'space-between',
  },
});
