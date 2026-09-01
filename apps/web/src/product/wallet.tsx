'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CoinPack,
  WalletActivity,
  WalletState,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Section,
  Skeleton,
} from '../design/primitives';
import { describeSelection, useWallet } from './live-premium';
import { formatPrice } from './commerce';
import { formatDateTime } from './locale';
import { useSingleFlight } from './resource';

/**
 * Coins, and what has happened to them.
 *
 * This screen answers six questions and deliberately nothing else: how many
 * coins do I have, is any of it held against something, is a paid matching
 * window running, when does it end, what did I spend coins on, and how do I get
 * more. Everything on it is the server's answer — there is no arithmetic in
 * this file that produces a balance, a price, or a total.
 *
 * **It is not a casino.** No chips, no stacks, no glow, no confetti, no "top
 * up now", no bonus, no streak, no expiry countdown, and no crossed-out price.
 * Coins buy one bounded, explicitly described thing, and this screen is a
 * statement of account rather than a shop window.
 *
 * **It never offers a purchase that cannot complete.** Where no payment
 * provider and no store project exist — which is every deployed environment —
 * the screen says so plainly rather than rendering a button that fails. In a
 * local environment a clearly-labelled developer grant stands in its place.
 */

/**
 * What one history line says, in words rather than in ledger terms.
 *
 * Two halves on purpose: what happened, and what became of the coins. A single
 * signed number would be wrong twice over — a reservation and the spend that
 * follows it both move the same coins, and rendering both as "−25" would read
 * as fifty.
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

/** How long a window has left, in whole minutes. Never a ticking countdown. */
function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

export function Wallet() {
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
    <>
      <PageHeader title="Coins" />
      {state === undefined ? (
        <Card testId="wallet-loading">
          <Skeleton height={28} width="40%" />
          <Skeleton height={12} width="70%" />
        </Card>
      ) : !state.enabled ? (
        /*
          Not zero. An environment with no coin ledger is not somebody with no
          coins, and a screen that could not tell them apart would offer a
          purchase that could never complete.
        */
        <EmptyState
          body="Coins are not available here. Live matching is free and works exactly as it does everywhere else."
          icon="sparkle"
          testId="wallet-unavailable"
          title="No coins in this environment"
        />
      ) : (
        <div className="v-stack v-stack--6">
          <Balance state={state} />
          <ActiveWindow onCancel={wallet.cancelPremium} state={state} />
          <Acquisition
            busy={action.busy}
            onGrant={() => {
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
            state={state}
          />

          <Section raised testId="wallet-history" title="What happened">
            {activity === undefined ? (
              <Skeleton height={12} width="60%" />
            ) : activity.length === 0 ? (
              <p className="v-small v-quiet" data-testid="wallet-history-empty">
                Nothing yet. Anything that moves your coins will appear here.
              </p>
            ) : (
              <ul className="v-list v-list--divided">
                {activity.map((entry) => (
                  <ActivityRow entry={entry} key={entry.id} />
                ))}
              </ul>
            )}
            {cursor === undefined ? null : (
              <Button
                data-testid="wallet-history-more"
                onClick={() => {
                  load(cursor);
                }}
                size="sm"
              >
                Show more
              </Button>
            )}
          </Section>

          {message === undefined ? null : (
            <p className="v-caption v-quiet" data-testid="wallet-message">
              {message}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function Balance({ state }: { readonly state: WalletState }) {
  const available = coinsOf(state.balance?.available);
  const reserved = coinsOf(state.balance?.reserved);
  return (
    <Card testId="wallet-balance">
      <p className="v-display" data-testid="wallet-available">
        {available} coins
      </p>
      {/*
        Said whenever anything is held, because "you have 40 coins" while 25 of
        them are committed is a true sentence that makes somebody think they can
        spend 40.
      */}
      {reserved === 0 ? (
        <p className="v-caption v-quiet">Yours to spend.</p>
      ) : (
        <p className="v-caption v-quiet" data-testid="wallet-reserved">
          {reserved} more are held against a matching window that has not
          finished. They come back if it finds nobody.
        </p>
      )}
    </Card>
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
    <Section raised testId="wallet-window" title="Live preference">
      <p className="v-small">
        <Icon name="globe" size="sm" />{' '}
        <span data-testid="wallet-window-selection">
          {description} — {minutesLeft(held.expiresAt, Date.now())} min left
        </span>
      </p>
      <p className="v-caption v-quiet v-measure">
        {held.charged
          ? `${held.coins} coins were used when this found somebody. It keeps looking with these preferences until it ends, and nothing more is charged.`
          : `${held.coins} coins are held, not spent. They are charged once when this finds somebody, and returned in full if it does not.`}
      </p>
      <Button data-testid="wallet-window-cancel" onClick={onCancel} size="sm">
        Back to everyone
      </Button>
    </Section>
  );
}

function Acquisition({
  busy,
  onGrant,
  state,
}: {
  readonly busy: boolean;
  readonly onGrant: () => void;
  readonly state: WalletState;
}) {
  const api = useApi();
  const action = useSingleFlight();
  const [packs, setPacks] = useState<CoinPack[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // One key per pack, held for as long as this screen is open. A second press
  // on the same pack is the same purchase; pressing a different one is a
  // different purchase and gets its own key.
  const intent = useRef(new Map<string, string>());
  const sellable = state.acquisition.web === 'local-test';

  useEffect(() => {
    if (!sellable) return;
    void api.coinPacks().then((result) => {
      if (isOk(result)) setPacks([...result.value.packs]);
    });
  }, [api, sellable]);

  if (!sellable) {
    return (
      <Section raised testId="wallet-acquisition" title="Getting more coins">
        <p className="v-caption v-quiet v-measure">
          {/*
            The truth, plainly, rather than a disabled button. No payment
            provider is configured and no coin pack is on sale, so there is
            nothing here that could take money — and saying so is better than a
            control that fails.
          */}
          There is no way to buy coins in this environment yet. Everyone
          matching is free and always will be.
        </p>
        {state.acquisition.android === 'unavailable' ? (
          <Button
            busy={busy}
            data-testid="wallet-grant"
            onClick={onGrant}
            size="sm"
          >
            Developer: grant 100 coins
          </Button>
        ) : null}
      </Section>
    );
  }

  return (
    <Section raised testId="wallet-acquisition" title="Getting more coins">
      <p className="v-caption v-quiet v-measure">
        {/*
          What a pack is, said once. No badge, no saving, no "most popular", and
          no crossed-out price: every one of those is a claim about a comparison
          nobody has approved, and there is nowhere in the server's answer to
          put one.
        */}
        Coins buy narrowed Live matching. Everyone stays free.
      </p>
      {packs === undefined ? (
        <Skeleton height={12} width="60%" />
      ) : packs.length === 0 ? (
        <p className="v-caption v-quiet" data-testid="wallet-packs-empty">
          Nothing is on sale right now.
        </p>
      ) : (
        <ul className="v-list v-list--divided" data-testid="wallet-packs">
          {packs.map((pack) => (
            <li className="v-row" key={pack.offerId}>
              <span className="v-row__body">
                <span className="v-subheading">{pack.coins} coins</span>
                <span className="v-caption v-quiet">
                  {formatPrice(pack.price)}
                </span>
              </span>
              <Button
                busy={action.busy}
                data-testid={`wallet-buy-${pack.coins}`}
                onClick={() => {
                  action.run(async () => {
                    setError(undefined);
                    const key =
                      intent.current.get(pack.offerId) ?? crypto.randomUUID();
                    intent.current.set(pack.offerId, key);
                    const result = await api.startCheckout({
                      body: {
                        currency: pack.price.currency,
                        offerId: pack.offerId,
                      },
                      idempotencyKey: key,
                    });
                    if (result.kind !== 'ok') {
                      setError(
                        failureMessage(result) ?? 'This could not be started.',
                      );
                      return;
                    }
                    // The provider's own page. VELORA renders no card field
                    // anywhere, because there is none to render.
                    globalThis.location.assign(
                      result.value.redirectUrl ??
                        `/checkout/return?payment=${encodeURIComponent(
                          result.value.payment.id,
                        )}`,
                    );
                  });
                }}
                size="sm"
                tone="primary"
              >
                Buy
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error === undefined ? null : (
        <p className="v-caption v-quiet" data-testid="wallet-packs-error">
          {error}
        </p>
      )}
    </Section>
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
    <li className="v-row" data-testid={`wallet-activity-${entry.kind}`}>
      <span className="v-row__body">
        <span className="v-subheading">
          {copy.title}
          {selection === undefined ? '' : ` — ${selection}`}
        </span>
        <span className="v-caption v-quiet">
          {formatDateTime(entry.occurredAt)}
        </span>
      </span>
      <span className="v-small">
        {entry.coins} coins {copy.effect}
      </span>
    </li>
  );
}
