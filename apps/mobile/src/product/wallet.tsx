import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { WalletActivity, WalletState } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { mintUuid } from '../device/installation';
import { useApi } from '../frame/providers';
import { Screen } from '../frame/shell';
import { Icon } from '../design/icons';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  RowSkeleton,
  Stack,
  Text,
} from '../design/primitives';
import { color, space } from '../design/tokens';

/**
 * The one product the local store stand-in sells.
 *
 * Restated here rather than imported from the server, because a client must not
 * hold a coin count and this is only a product identifier — the coins come from
 * the platform's own catalogue keyed by what the store confirmed. A real Play
 * build reads this from the store's own product list.
 */
const localTestCoinProduct = 'velora.coins.local_test';
import { describeSelection, useWallet } from './live-premium';
import { formatWhen } from './locale';
import { useSingleFlight } from './resource';

/**
 * Coins on a phone, and what has happened to them.
 *
 * The same six questions the web screen answers and the same rules: everything
 * is the server's answer, nothing here computes a balance or a price, it is a
 * statement of account rather than a shop window, and where no channel can take
 * money it says so plainly instead of rendering a control that fails.
 *
 * One thing differs and it is a platform fact. Android may not send somebody to
 * a web checkout for a digital good consumed inside the application, so there is
 * no link out of this screen to one — the only purchase path Android may ever
 * have is Play Billing, and until a Play project exists this screen says
 * exactly that.
 */

const activityCopy: Readonly<
  Record<string, { readonly effect: string; readonly title: string }>
> = {
  correction: { effect: 'corrected', title: 'Correction' },
  grant: { effect: 'added', title: 'Development grant' },
  purchase: { effect: 'added', title: 'Coins acquired' },
  purchase_reversed: { effect: 'removed', title: 'Purchase reversed' },
  release: { effect: 'returned', title: 'Reservation released' },
  reservation: { effect: 'held', title: 'Held for a narrowed search' },
  spend: { effect: 'used', title: 'Premium Live preference' },
};

function coinsOf(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

export function WalletScreen({ onBack }: { readonly onBack: () => void }) {
  const api = useApi();
  const wallet = useWallet();
  const action = useSingleFlight();
  const [activity, setActivity] = useState<WalletActivity[] | undefined>(
    undefined,
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const load = useCallback(
    (from?: string) => {
      void api
        .walletActivity(from === undefined ? {} : { cursor: from })
        .then((result) => {
          if (!isOk(result)) {
            setMessage(failureMessage(result));
            return;
          }
          setActivity((held) =>
            from === undefined
              ? [...result.value.activity]
              : [...(held ?? []), ...result.value.activity],
          );
          setCursor(result.value.nextCursor);
          setMessage(undefined);
        });
    },
    [api],
  );

  useEffect(() => {
    load();
  }, [load]);

  const state = wallet.state;

  return (
    <Screen
      onBack={onBack}
      subtitle="What you hold, and what you have spent it on."
      testID="wallet-screen"
      title="Coins"
    >
      {state === undefined ? (
        <Card testID="wallet-loading">
          <RowSkeleton rows={2} />
        </Card>
      ) : !state.enabled ? (
        <EmptyState
          body="Coins are not available here. Live matching is free and works exactly as it does everywhere else."
          icon="sparkle"
          testID="wallet-unavailable"
          title="No coins in this environment"
        />
      ) : (
        <Stack gap={5}>
          <Card testID="wallet-balance">
            <Stack gap={2}>
              <Text
                testID="wallet-available"
                variant="heading"
                weight="semibold"
              >
                {`${String(coinsOf(state.balance?.available))} coins`}
              </Text>
              {coinsOf(state.balance?.reserved) === 0 ? (
                <Text tone="secondary" variant="caption">
                  Yours to spend.
                </Text>
              ) : (
                <Text
                  testID="wallet-reserved"
                  tone="secondary"
                  variant="caption"
                >
                  {`${String(coinsOf(state.balance?.reserved))} more are held against a matching window that has not finished. They come back if it finds nobody.`}
                </Text>
              )}
            </Stack>
          </Card>

          <ActiveWindow onCancel={wallet.cancelPremium} state={state} />

          <Card testID="wallet-acquisition">
            <Stack gap={3}>
              <Text variant="subheading" weight="semibold">
                Getting more coins
              </Text>
              {state.acquisition.android === 'unavailable' ? (
                <Text tone="secondary" variant="caption">
                  {/*
                    The truth, plainly. No Play Console project, product
                    identifier, or service-account credential exists to verify a
                    purchase against, so there is nothing here that could take
                    money — and there is deliberately no web checkout link
                    standing in for one.
                  */}
                  There is no way to buy coins in this application yet. Everyone
                  matching is free and always will be.
                </Text>
              ) : (
                <>
                  <Text tone="secondary" variant="caption">
                    {/*
                      What the real path is, said where somebody is looking at
                      the stand-in for it. The store returns a purchase token to
                      this application, the server verifies it with the store,
                      and the coins follow from what the *store* confirmed — a
                      client saying a purchase succeeded never mints anything,
                      here or on a real Play build.
                    */}
                    This is the local store stand-in. A purchase is verified by
                    the server before any coins exist, exactly as a real one
                    would be.
                  </Text>
                  <Button
                    busy={action.busy}
                    onPress={() => {
                      action.run(async () => {
                        // The token a store would hand back. It is evidence and
                        // never authority: the server checks it, derives the
                        // coin amount from its own catalogue keyed by the
                        // product the store confirmed, and credits idempotently
                        // against the store's own purchase identity.
                        wallet.apply(
                          await api.redeemAndroidCoinPurchase({
                            productReference: localTestCoinProduct,
                            purchaseToken: `local-test-purchase-${mintUuid()}`,
                          }),
                        );
                        load();
                      });
                    }}
                    testID="wallet-store-buy"
                    tone="primary"
                  >
                    Buy 100 coins
                  </Button>
                </>
              )}
              {state.acquisition.android === 'unavailable' &&
              state.acquisition.web === 'unavailable' ? (
                <Button
                  busy={action.busy}
                  onPress={() => {
                    action.run(async () => {
                      wallet.apply(
                        await api.grantCoins({
                          coins: '100',
                          reference: 'local-development-grant',
                        }),
                      );
                      load();
                    });
                  }}
                  testID="wallet-grant"
                  tone="ghost"
                >
                  Developer: grant 100 coins
                </Button>
              ) : null}
            </Stack>
          </Card>

          <Card testID="wallet-history">
            <Stack gap={3}>
              <Text variant="subheading" weight="semibold">
                What happened
              </Text>
              {activity === undefined ? (
                <RowSkeleton rows={2} />
              ) : activity.length === 0 ? (
                <Text
                  testID="wallet-history-empty"
                  tone="secondary"
                  variant="caption"
                >
                  Nothing yet. Anything that moves your coins will appear here.
                </Text>
              ) : (
                activity.map((entry, index) => (
                  <View key={entry.id}>
                    {index === 0 ? null : <Divider />}
                    <ActivityRow entry={entry} />
                  </View>
                ))
              )}
              {cursor === undefined ? null : (
                <Button
                  onPress={() => {
                    load(cursor);
                  }}
                  size="small"
                  testID="wallet-history-more"
                  tone="ghost"
                >
                  Show more
                </Button>
              )}
            </Stack>
          </Card>

          {message === undefined ? null : (
            <Text testID="wallet-message" tone="secondary" variant="caption">
              {message}
            </Text>
          )}
        </Stack>
      )}
    </Screen>
  );
}

function ActiveWindow({
  onCancel,
  state,
}: {
  readonly onCancel: () => void;
  readonly state: WalletState;
}) {
  const held = state.livePreference;
  if (held === undefined) return null;
  const description = describeSelection(held) ?? 'a narrowed search';
  return (
    <Card testID="wallet-window">
      <Stack gap={3}>
        <View style={styles.heading}>
          <Icon color={color.ember} name="globe" size="sm" />
          <Text
            style={styles.grow}
            testID="wallet-window-selection"
            variant="small"
          >
            {`${description} — ${String(minutesLeft(held.expiresAt, Date.now()))} min left`}
          </Text>
        </View>
        <Text tone="secondary" variant="caption">
          {held.charged
            ? `${held.coins} coins were used when this found somebody. It keeps looking with these preferences until it ends, and nothing more is charged.`
            : `${held.coins} coins are held, not spent. They are charged once when this finds somebody, and returned in full if it does not.`}
        </Text>
        <Button onPress={onCancel} testID="wallet-window-cancel" tone="ghost">
          Back to everyone
        </Button>
      </Stack>
    </Card>
  );
}

function ActivityRow({ entry }: { readonly entry: WalletActivity }) {
  const copy = activityCopy[entry.kind] ?? {
    effect: 'moved',
    title: 'Coins moved',
  };
  const selection =
    entry.preference === undefined
      ? undefined
      : describeSelection(entry.preference);
  return (
    <View style={styles.row} testID={`wallet-activity-${entry.kind}`}>
      <View style={styles.grow}>
        <Text variant="body">
          {selection === undefined
            ? copy.title
            : `${copy.title} — ${selection}`}
        </Text>
        <Text tone="tertiary" variant="caption">
          {formatWhen(entry.occurredAt)}
        </Text>
      </View>
      <Text tone="secondary" variant="caption">
        {`${entry.coins} coins ${copy.effect}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexShrink: 1, gap: 2 },
  heading: { alignItems: 'center', flexDirection: 'row', gap: space[2] },
  /*
   * A row that wraps rather than one that truncates. At 200% text the amount
   * and the reason do not fit side by side on a 320 dp phone, and a history
   * line with the amount cut off is a history line nobody can use.
   */
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    justifyContent: 'space-between',
    paddingVertical: space[2],
  },
});
