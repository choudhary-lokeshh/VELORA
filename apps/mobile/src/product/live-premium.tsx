import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  ApiResult,
  LivePreferenceSelection,
  WalletState,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../frame/providers';
import { Icon } from '../design/icons';
import { Button, Choice, Text, TextField } from '../design/primitives';
import { color, radius, space } from '../design/tokens';
import { languageName, regionName } from './locale';
import { useSingleFlight } from './resource';

/**
 * The paid matching preferences on a phone, and every rule that keeps them
 * honest.
 *
 * The same rules the web control follows, for the same reasons: they are a
 * utility rather than a game, they claim nothing about who is there, every
 * price and option comes from the server's catalogue, what happens to the coins
 * is said before they move, and a channel that cannot take money renders no
 * purchase.
 *
 * Two things differ and both are platform facts rather than preferences. There
 * is no country picker: a phone has no select, and a modal listing two hundred
 * and forty countries would be a dialog where the web has a two-character
 * field. And the language choice steps through the caller's own languages as
 * rows rather than as a dropdown, because four rows fit a small portrait phone
 * at 200% text and a horizontal strip does not.
 */

type PreferenceKind = 'gender' | 'language' | 'region';

/**
 * The declared categories somebody may narrow to, in the product's own words.
 *
 * The same four the web offers, in the same order, because they are one product
 * decision rather than two surfaces each choosing a vocabulary. `undisclosed`
 * is deliberately absent and the server refuses it too.
 */
const genderChoices = [
  { label: 'Women', value: 'woman' },
  { label: 'Men', value: 'man' },
  { label: 'Non-binary people', value: 'non_binary' },
] as const;

export interface WalletView {
  readonly state: WalletState | undefined;
  readonly busy: boolean;
  readonly message: string | undefined;
  readonly apply: (result: ApiResult<WalletState>) => void;
  /** Closes the window in force and returns whatever is owed. */
  readonly cancelPremium: () => void;
  /** Drops preferences from the window in force, at no charge. */
  readonly broadenPremium: (selection: LivePreferenceSelection) => void;
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

  const broadenPremium = useCallback(
    (selection: LivePreferenceSelection) => {
      void api.broadenLivePreference(selection).then(apply);
    },
    [api, apply],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    apply,
    broadenPremium,
    busy: action.busy,
    cancelPremium,
    message,
    refresh,
    state,
  };
}

export function coinsOf(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How long a window has left, in whole minutes, never counting down.
 *
 * Rendered once per read rather than ticking. A live clock over a thing
 * somebody paid for is pressure, and an unused window loses nobody anything
 * when it ends — the coins come back — so a countdown would be manufacturing
 * urgency that does not exist.
 */
function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

/** One selection in words, in the order the catalogue publishes. */
export function describeSelection(
  selection: LivePreferenceSelection,
): string | undefined {
  const parts: string[] = [];
  const gender = genderChoices.find(
    (choice) => choice.value === selection.gender,
  );
  if (gender !== undefined) parts.push(gender.label);
  if (selection.region !== undefined) {
    parts.push(regionName(selection.region) ?? selection.region);
  }
  if (selection.language !== undefined) {
    parts.push(languageName(selection.language));
  }
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** What one catalogue kind costs, read from the server's own answer. */
function coinsFor(
  catalogue: WalletState['livePreferenceCatalogue'],
  kind: PreferenceKind,
): number {
  return coinsOf(
    catalogue.preferences.find((entry) => entry.kind === kind)?.coins,
  );
}

/**
 * The same selection without one preference, built rather than deleted.
 *
 * What is sent to the server is what should *remain*, so this is a positive
 * statement of the narrower request rather than a diff the server has to trust
 * — and each field is only present when it has a value, which is what the
 * contract's strict shape requires.
 */
function without(
  selection: LivePreferenceSelection,
  dropped: PreferenceKind,
): LivePreferenceSelection {
  return {
    ...(selection.gender === undefined || dropped === 'gender'
      ? {}
      : { gender: selection.gender }),
    ...(selection.language === undefined || dropped === 'language'
      ? {}
      : { language: selection.language }),
    ...(selection.region === undefined || dropped === 'region'
      ? {}
      : { region: selection.region }),
  };
}

function priceOf(
  state: WalletState,
  selection: LivePreferenceSelection,
): number {
  return state.livePreferenceCatalogue.preferences.reduce((total, entry) => {
    return selection[entry.kind] === undefined
      ? total
      : total + coinsOf(entry.coins);
  }, 0);
}

export function PremiumPreference({
  languageOptions,
  wallet,
}: {
  /** The caller's own languages. A preference cannot name one they lack. */
  readonly languageOptions: readonly string[];
  readonly wallet: WalletView;
}) {
  const api = useApi();
  const action = useSingleFlight();
  const [draft, setDraft] = useState<LivePreferenceSelection>({});
  const [region, setRegion] = useState('');
  const [confirming, setConfirming] = useState(false);
  const state = wallet.state;

  const normalizedRegion = region.trim().toUpperCase();
  const regionValid = /^[A-Z]{2}$/u.test(normalizedRegion);
  const selection = useMemo<LivePreferenceSelection>(
    () => ({
      ...draft,
      ...(regionValid ? { region: normalizedRegion } : {}),
    }),
    [draft, normalizedRegion, regionValid],
  );

  // Nothing at all where this environment has no coin ledger. A disabled
  // control explaining a feature that does not exist here is a control somebody
  // will try to enable.
  if (state?.enabled !== true) return null;

  const held = state.livePreference;
  const catalogue = state.livePreferenceCatalogue;
  const available = coinsOf(state.balance?.available);
  const minutes = Math.round(catalogue.durationSeconds / 60);
  const developerGrant =
    state.acquisition.android === 'unavailable' &&
    state.acquisition.web === 'unavailable';

  if (held !== undefined) {
    const description = describeSelection(held) ?? 'a narrowed search';
    const droppable = (['gender', 'region', 'language'] as const).filter(
      (kind) => held[kind] !== undefined,
    );
    return (
      <View style={styles.panel} testID="live-premium-active">
        <View style={styles.heading}>
          <Icon color={color.ember} name="globe" size="sm" />
          <Text
            style={styles.grow}
            testID="live-premium-active-selection"
            variant="small"
          >
            {description} — {minutesLeft(held.expiresAt, Date.now())} min left
          </Text>
        </View>
        {/*
          Two different true sentences, because a charged window and an
          uncharged one make opposite promises. One sentence for both would
          have to promise a refund that is not coming, or threaten a charge
          that already happened.
        */}
        <Text tone="secondary" variant="caption">
          {held.charged
            ? `${held.coins} coins were used when this found somebody. It keeps looking with these preferences until it ends, and nothing more is charged.`
            : `${held.coins} coins are held, not spent. They are charged once when this finds somebody, and returned in full if it does not.`}
        </Text>
        {droppable.length > 1
          ? droppable.map((kind) => (
              <Button
                busy={action.busy}
                key={kind}
                onPress={() => {
                  wallet.broadenPremium(without(held, kind));
                }}
                size="small"
                testID={`live-premium-drop-${kind}`}
                tone="ghost"
              >
                {`Drop ${kindLabel(kind, held)}`}
              </Button>
            ))
          : null}
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
        {held.charged ? null : (
          <Text tone="tertiary" variant="caption">
            {`Going back to everyone returns the ${held.coins} coins in full.`}
          </Text>
        )}
      </View>
    );
  }

  const price = priceOf(state, selection);
  const chosen =
    selection.gender !== undefined ||
    selection.language !== undefined ||
    selection.region !== undefined;
  const summary = describeSelection(selection);

  return (
    <View style={styles.panel} testID="live-premium">
      <View style={styles.heading}>
        <Icon color={color.textSecondary} name="globe" size="sm" />
        <Text style={styles.grow} variant="small">
          Narrow who you meet
        </Text>
      </View>
      {/*
        Exactly what is bought, at the published price, with the published
        duration. Never "unlock", never "boost", never a claim about who is
        there — narrowing a search makes it smaller, and saying so is the honest
        version of selling it.
      */}
      <Text tone="secondary" variant="caption">
        Everyone is free and is what you get without this. A narrowed search
        runs for {minutes} minutes: the coins are held, charged once if it finds
        somebody, and returned in full if it does not. A narrower search takes
        longer, and nobody can promise anyone is there.
      </Text>
      <Text testID="live-premium-balance" tone="secondary" variant="caption">
        You have {available} coins.
      </Text>

      <View accessibilityRole="radiogroup" style={styles.choices}>
        <Choice
          onPress={() => {
            setDraft((current) => {
              const next = { ...current };
              delete next.gender;
              return next;
            });
          }}
          selected={draft.gender === undefined}
          testID="live-premium-gender-any"
        >
          <Text variant="body">Anyone — Free</Text>
        </Choice>
        {genderChoices.map((choice) => (
          <Choice
            key={choice.value}
            onPress={() => {
              setDraft((current) => ({ ...current, gender: choice.value }));
            }}
            selected={draft.gender === choice.value}
            testID={`live-premium-gender-${choice.value}`}
          >
            <Text variant="body">
              {`${choice.label} — ${String(coinsFor(catalogue, 'gender'))} coins`}
            </Text>
          </Choice>
        ))}
      </View>

      <TextField
        accessibilityLabel="Country, as two letters"
        autoCapitalize="characters"
        autoComplete="country"
        invalid={region.length > 0 && !regionValid}
        maxLength={2}
        onChangeText={setRegion}
        placeholder="ES"
        testID="live-premium-region"
        value={region}
      />
      <Text tone="tertiary" variant="caption">
        {regionValid
          ? (regionName(normalizedRegion) ??
            `${String(coinsFor(catalogue, 'region'))} coins`)
          : `Optional country. Two letters, such as ES — ${String(coinsFor(catalogue, 'region'))} coins.`}
      </Text>

      {languageOptions.length === 0 ? null : (
        <View accessibilityRole="radiogroup" style={styles.choices}>
          <Choice
            onPress={() => {
              setDraft((current) => {
                const next = { ...current };
                delete next.language;
                return next;
              });
            }}
            selected={draft.language === undefined}
            testID="live-premium-language-any"
          >
            <Text variant="body">Any language — Free</Text>
          </Choice>
          {languageOptions.map((code) => (
            <Choice
              key={code}
              onPress={() => {
                setDraft((current) => ({ ...current, language: code }));
              }}
              selected={draft.language === code}
              testID={`live-premium-language-${code}`}
            >
              <Text variant="body">
                {`${languageName(code)} — ${String(coinsFor(catalogue, 'language'))} coins`}
              </Text>
            </Choice>
          ))}
        </View>
      )}

      {!chosen ? (
        <Text testID="live-premium-none" tone="tertiary" variant="caption">
          Everyone is free. Choose something above to narrow the search.
        </Text>
      ) : available >= price ? (
        confirming ? (
          /*
            The confirmation, before anything moves. What is being activated,
            what it costs, how long it lasts, and what happens to the coins —
            said once, next to the button that does it, rather than discovered
            afterwards in a balance that changed.
          */
          <View style={styles.confirm} testID="live-premium-confirm">
            <Text variant="small">
              {`${summary ?? ''} for ${String(minutes)} minutes — ${String(price)} coins held.`}
            </Text>
            <Text tone="secondary" variant="caption">
              They are charged once if this finds somebody, and returned in full
              if it does not.
            </Text>
            <Button
              busy={action.busy}
              onPress={() => {
                action.run(async () => {
                  wallet.apply(await api.activateLivePreference(selection));
                  setConfirming(false);
                });
              }}
              testID="live-premium-activate"
              tone="primary"
            >
              {`Hold ${String(price)} coins`}
            </Button>
            <Button
              onPress={() => {
                setConfirming(false);
              }}
              size="small"
              testID="live-premium-back"
              tone="ghost"
            >
              Not now
            </Button>
          </View>
        ) : (
          <Button
            onPress={() => {
              setConfirming(true);
            }}
            testID="live-premium-review"
            tone="primary"
          >
            {`${summary ?? ''} — ${String(price)} coins`}
          </Button>
        )
      ) : (
        <Text testID="live-premium-short" tone="secondary" variant="caption">
          {/*
            The refusal a person can act on, and nothing more. It never says how
            much is missing beyond the arithmetic they can already do, and it
            never offers a purchase this environment cannot complete. Everyone
            stays available and free, so nobody is stuck.
          */}
          {`${summary ?? ''} costs ${String(price)} coins. You have ${String(available)}.`}
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

/** The word for one preference on the drop control, in the person's terms. */
function kindLabel(
  kind: PreferenceKind,
  selection: LivePreferenceSelection,
): string {
  if (kind === 'gender') {
    return (
      genderChoices
        .find((choice) => choice.value === selection.gender)
        ?.label.toLowerCase() ?? 'who'
    );
  }
  if (kind === 'region') return regionName(selection.region) ?? 'country';
  return selection.language === undefined
    ? 'language'
    : languageName(selection.language);
}

const styles = StyleSheet.create({
  /*
   * A column, never a row. Four labels do not fit across a 320 dp phone at
   * 200% text, and a horizontal strip that has to scroll hides the option
   * nobody knows is there.
   */
  choices: { gap: 8, width: '100%' },
  confirm: { gap: space[2], width: '100%' },
  grow: { flexShrink: 1 },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[2],
  },
  /*
   * A panel rather than another chip, because it is not another preference: it
   * costs something, it explains what happens to the money, and it takes a
   * selection. Deliberately quiet — one surface, one hairline, no accent fill,
   * no badge, no glow. A coin control that looked like a slot machine would
   * undo every honest sentence inside it.
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
