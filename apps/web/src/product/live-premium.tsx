'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ApiResult, WalletState } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import { Icon } from '../design/icons';
import { Button, Field, TextInput } from '../design/primitives';
import { regionName } from './locale';
import { useSingleFlight } from './resource';

/**
 * The paid matching preference, and every rule that keeps it honest.
 *
 * **It is a utility, not a game.** There is no wheel, no jackpot, no streak, no
 * multiplier, no countdown, no discount, and no random reward anywhere in this
 * file. What is offered is one bounded thing at one published price, described
 * in the sentence next to the button that buys it.
 *
 * **Nothing here claims anybody is there.** No count of matching people, no
 * "12 in Spain right now", no estimated wait, no compatibility figure. This
 * product has no presence projection, so every one of those would be a number
 * this screen invented — and a person who found that out would be right to
 * distrust the rest of it.
 *
 * **The price and the duration come from the server.** Both are read from the
 * wallet, so a control can never render a price that is not the price that will
 * be charged.
 *
 * **What happens to the coins is said before they move.** They are held, not
 * spent; they are charged if the window finds somebody, and returned in full if
 * it does not. That is the actual rule the server implements, written where
 * somebody decides.
 *
 * **A channel that cannot take money renders no buy control.** In every
 * environment with no approved payment provider and no store project, the
 * purchase control is absent rather than present-and-broken; where the
 * environment is local, a clearly-labelled developer grant stands in its place.
 */

export interface WalletView {
  /** The last authoritative answer, or nothing before the first read. */
  readonly state: WalletState | undefined;
  readonly busy: boolean;
  readonly message: string | undefined;
  /** Applies an answer from any wallet call. Never computes a balance. */
  readonly apply: (result: ApiResult<WalletState>) => void;
  /**
   * Closes the open paid window and returns the coins it held, in full.
   *
   * Published on the view rather than only on the control that opened one,
   * because "widen the search" has to mean widen: a control that dropped the
   * free preference and left a paid narrowing running would be a button that
   * appeared not to work.
   *
   * Safe when there is no window. Cancelling nothing is not an error.
   */
  readonly cancelPremium: () => void;
  readonly refresh: () => void;
}

/**
 * One authoritative wallet read, shared by every control that renders coins.
 *
 * Every wallet call answers with the whole state, so this never applies a delta
 * — which is what stops two controls disagreeing about a balance after one of
 * them spent from it.
 */
export function useWallet(): WalletView {
  const api = useApi();
  const [state, setState] = useState<WalletState | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const action = useSingleFlight();

  const apply = useCallback((result: ApiResult<WalletState>) => {
    if (isOk(result)) {
      setState(result.value);
      setMessage(undefined);
      return;
    }
    setMessage(failureMessage(result));
  }, []);

  const refresh = useCallback(() => {
    void api.wallet().then(apply);
  }, [api, apply]);

  const cancelPremium = useCallback(() => {
    void api.cancelLivePreference().then(apply);
  }, [api, apply]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { apply, busy: action.busy, cancelPremium, message, refresh, state };
}

function coinsOf(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How long a window has left, in whole minutes, never counting down.
 *
 * Rounded up and rendered once per read rather than ticking. A live countdown
 * over a thing somebody paid for is pressure, and this window loses nobody
 * anything when it ends — the coins come back — so a clock would be
 * manufacturing urgency that does not exist.
 */
function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

export function PremiumPreference({ wallet }: { readonly wallet: WalletView }) {
  const api = useApi();
  const action = useSingleFlight();
  const [region, setRegion] = useState('');
  const [touched, setTouched] = useState(false);
  const state = wallet.state;

  // Nothing at all where this environment has no coin ledger. A disabled
  // control explaining a feature that does not exist here is a control somebody
  // will try to enable.
  if (state?.enabled !== true) return null;

  const held = state.livePreference;
  const offer = state.livePreferenceOffer;
  const available = coinsOf(state.balance?.available);
  const price = coinsOf(offer.coins);
  const affordable = available >= price;
  const normalized = region.trim().toUpperCase();
  const valid = /^[A-Z]{2}$/u.test(normalized);
  const resolved = valid ? regionName(normalized) : undefined;
  const minutes = Math.round(offer.durationSeconds / 60);
  const developerGrant =
    state.acquisition.android === 'unavailable' &&
    state.acquisition.web === 'unavailable';

  if (held !== undefined) {
    return (
      <div className="v-live__premium" data-testid="live-premium-active">
        <p className="v-small">
          <Icon name="globe" size="sm" />{' '}
          <span>
            Your search is narrowed to {regionName(held.region) ?? held.region}{' '}
            for another {minutesLeft(held.expiresAt, Date.now())} minutes.
          </span>
        </p>
        {/*
          The whole of what happens to the coins, said where the person can see
          it. It is the rule the server actually implements, not a reassurance.
        */}
        <p className="v-caption v-quiet v-measure">
          {held.coins} coins are held, not spent. They are charged when this
          finds somebody, and returned in full if it does not.
        </p>
        <Button
          busy={action.busy}
          data-testid="live-premium-cancel"
          onClick={() => {
            wallet.cancelPremium();
          }}
          size="sm"
        >
          Back to everyone
        </Button>
      </div>
    );
  }

  return (
    <div className="v-live__premium" data-testid="live-premium">
      <p className="v-small">
        <Icon name="globe" size="sm" /> <span>Meet people in one country</span>
      </p>
      {/*
        Exactly what is bought, at the published price, with the published
        duration. Never "unlock", never "boost", never a claim about who is
        there — narrowing a search makes it smaller, and saying so is the
        honest version of selling it.
      */}
      <p className="v-caption v-quiet v-measure">
        {price} coins narrows the search to one country for {minutes} minutes.
        The coins are held, charged only if it finds somebody, and returned in
        full if it does not. A narrower search takes longer, and nobody can
        promise anyone is there.
      </p>
      <p className="v-caption v-quiet" data-testid="live-premium-balance">
        You have {available} coins.
      </p>

      <Field
        error={
          touched && region.length > 0 && !valid
            ? 'Enter a two-letter country code, such as ES.'
            : undefined
        }
        hint={resolved ?? 'Two letters, such as ES.'}
        label="Country"
      >
        {(control) => (
          <TextInput
            {...control}
            autoCapitalize="characters"
            autoComplete="country"
            data-testid="live-premium-region"
            maxLength={2}
            name="premiumRegion"
            onBlur={() => {
              setTouched(true);
            }}
            onChange={(event) => {
              setRegion(event.target.value.toUpperCase());
            }}
            placeholder="ES"
            value={region}
          />
        )}
      </Field>

      {affordable ? (
        <Button
          busy={action.busy}
          data-testid="live-premium-activate"
          disabled={!valid}
          onClick={() => {
            setTouched(true);
            if (!valid) return;
            action.run(async () => {
              wallet.apply(await api.activateLivePreference(normalized));
            });
          }}
          size="sm"
          tone="primary"
        >
          Hold {price} coins
        </Button>
      ) : (
        <p className="v-caption v-quiet" data-testid="live-premium-short">
          {/*
            The refusal a person can act on, and nothing more. It never says how
            many are missing beyond the arithmetic they can already do, and it
            never offers a purchase that this environment cannot complete.
          */}
          You need {price} coins for this.
          {developerGrant
            ? ' No purchase channel is available in this environment.'
            : ''}
        </p>
      )}

      {developerGrant ? (
        <Button
          busy={action.busy}
          data-testid="live-premium-grant"
          onClick={() => {
            action.run(async () => {
              wallet.apply(
                await api.grantCoins({
                  coins: '100',
                  // Stable per person and per intent, so pressing twice credits
                  // once. The server scopes it to the caller as well.
                  reference: 'local-development-grant',
                }),
              );
            });
          }}
          size="sm"
        >
          {/*
            Labelled for what it is. It is refused by the server outside local
            and test, so a build that somehow rendered it in a deployed
            environment would produce a refusal rather than currency.
          */}
          Developer: grant 100 coins
        </Button>
      ) : null}

      {wallet.message === undefined ? null : (
        <p className="v-caption v-quiet" data-testid="live-premium-message">
          {wallet.message}
        </p>
      )}
    </div>
  );
}
