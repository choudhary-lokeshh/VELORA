import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ApiResult, WalletState } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../frame/providers';
import { Icon } from '../design/icons';
import { Button, Text, TextField } from '../design/primitives';
import { color, radius, space } from '../design/tokens';
import { regionName } from './locale';
import { useSingleFlight } from './resource';

/**
 * The paid matching preference on a phone, and every rule that keeps it honest.
 *
 * The same rules the web control follows, for the same reasons: it is a
 * utility rather than a game, it claims nothing about who is there, the price
 * and the duration come from the server, what happens to the coins is said
 * before they move, and a channel that cannot take money renders no purchase.
 *
 * One thing differs and it is a platform fact rather than a preference. There
 * is no country picker: a phone has no select, and a modal listing two hundred
 * and forty countries would be a dialog where the web has a two-character
 * field. It takes the same two letters, validated the same way, and resolves
 * the name underneath as somebody types — which is exactly what the adult
 * declaration on this surface already does.
 */

export interface WalletView {
  readonly state: WalletState | undefined;
  readonly busy: boolean;
  readonly message: string | undefined;
  readonly apply: (result: ApiResult<WalletState>) => void;
  /** Closes the open paid window and returns the coins it held, in full. */
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
 * Rendered once per read rather than ticking. A live clock over a thing
 * somebody paid for is pressure, and this window loses nobody anything when it
 * ends — the coins come back — so a countdown would be manufacturing urgency
 * that does not exist.
 */
function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

export function PremiumPreference({ wallet }: { readonly wallet: WalletView }) {
  const api = useApi();
  const action = useSingleFlight();
  const [region, setRegion] = useState('');
  const state = wallet.state;

  // Nothing at all where this environment has no coin ledger. A disabled
  // control explaining a feature that does not exist here is a control somebody
  // will try to enable.
  if (state?.enabled !== true) return null;

  const held = state.livePreference;
  const offer = state.livePreferenceOffer;
  const available = coinsOf(state.balance?.available);
  const price = coinsOf(offer.coins);
  const normalized = region.trim().toUpperCase();
  const valid = /^[A-Z]{2}$/u.test(normalized);
  const resolved = regionName(normalized);
  const minutes = Math.round(offer.durationSeconds / 60);
  const developerGrant =
    state.acquisition.android === 'unavailable' &&
    state.acquisition.web === 'unavailable';

  if (held !== undefined) {
    return (
      <View style={styles.panel} testID="live-premium-active">
        <View style={styles.heading}>
          <Icon color={color.ember} name="globe" size="sm" />
          <Text style={styles.grow} variant="small">
            Narrowed to {regionName(held.region) ?? held.region} for another{' '}
            {minutesLeft(held.expiresAt, Date.now())} minutes.
          </Text>
        </View>
        {/*
          The whole of what happens to the coins, said where the person can see
          it. It is the rule the server implements, not a reassurance.
        */}
        <Text tone="secondary" variant="caption">
          {held.coins} coins are held, not spent. They are charged when this
          finds somebody, and returned in full if it does not.
        </Text>
        <Button
          busy={action.busy}
          onPress={() => {
            wallet.cancelPremium();
          }}
          testID="live-premium-cancel"
          tone="ghost"
        >
          Back to everyone
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.panel} testID="live-premium">
      <View style={styles.heading}>
        <Icon color={color.textSecondary} name="globe" size="sm" />
        <Text style={styles.grow} variant="small">
          Meet people in one country
        </Text>
      </View>
      {/*
        Exactly what is bought, at the published price, with the published
        duration. Never "unlock", never "boost", never a claim about who is
        there — narrowing a search makes it smaller, and saying so is the honest
        version of selling it.
      */}
      <Text tone="secondary" variant="caption">
        {price} coins narrows the search to one country for {minutes} minutes.
        The coins are held, charged only if it finds somebody, and returned in
        full if it does not. A narrower search takes longer, and nobody can
        promise anyone is there.
      </Text>
      <Text testID="live-premium-balance" tone="secondary" variant="caption">
        You have {available} coins.
      </Text>

      <TextField
        accessibilityLabel="Country, as two letters"
        autoCapitalize="characters"
        autoComplete="country"
        invalid={region.length > 0 && !valid}
        maxLength={2}
        onChangeText={(next) => {
          setRegion(next.toUpperCase());
        }}
        placeholder="ES"
        testID="live-premium-region"
        value={region}
      />
      <Text tone="tertiary" variant="caption">
        {resolved ?? 'Two letters, such as ES.'}
      </Text>

      {available >= price ? (
        <Button
          busy={action.busy}
          disabled={!valid}
          onPress={() => {
            if (!valid) return;
            action.run(async () => {
              wallet.apply(await api.activateLivePreference(normalized));
            });
          }}
          testID="live-premium-activate"
          tone="primary"
        >
          {`Hold ${String(price)} coins`}
        </Button>
      ) : (
        <Text testID="live-premium-short" tone="secondary" variant="caption">
          {/*
            The refusal a person can act on, and nothing more. It never says how
            much is missing beyond the arithmetic they can already do, and it
            never offers a purchase this environment cannot complete.
          */}
          You need {price} coins for this.
          {developerGrant
            ? ' No purchase channel is available in this environment.'
            : ''}
        </Text>
      )}

      {developerGrant ? (
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
            });
          }}
          testID="live-premium-grant"
          tone="ghost"
        >
          {/*
            Labelled for what it is. The server refuses it outside local and
            test, so a build that somehow rendered it in a deployed environment
            would produce a refusal rather than currency.
          */}
          Developer: grant 100 coins
        </Button>
      ) : null}

      {wallet.message === undefined ? null : (
        <Text testID="live-premium-message" tone="secondary" variant="caption">
          {wallet.message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexShrink: 1 },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[2],
  },
  /*
   * A panel rather than another chip, because it is not another preference: it
   * costs something, it explains what happens to the money, and it takes a
   * country. Deliberately quiet — one surface, one hairline, no accent fill, no
   * badge, no glow. A coin control that looked like a slot machine would undo
   * every honest sentence inside it.
   */
  panel: {
    backgroundColor: color.surface2,
    borderColor: color.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[2],
    padding: space[4],
    width: '100%',
  },
});
