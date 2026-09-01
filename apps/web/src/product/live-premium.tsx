'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ApiResult,
  LivePreferenceSelection,
  WalletState,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Button,
  ButtonLink,
  Choice,
  Field,
  Select,
  TextInput,
} from '../design/primitives';
import { languageName, regionName } from './locale';
import { useSingleFlight } from './resource';

/**
 * The paid matching preferences, and every rule that keeps them honest.
 *
 * **They are a utility, not a game.** There is no wheel, no jackpot, no streak,
 * no multiplier, no countdown, no discount, and no random reward anywhere in
 * this file. What is offered is a bounded window at a published price,
 * described in the sentence next to the button that buys it.
 *
 * **Nothing here claims anybody is there.** No count of matching people, no
 * "12 women in Spain right now", no estimated wait, no compatibility figure.
 * This product has no presence projection, so every one of those would be a
 * number this screen invented — and a person who found that out would be right
 * to distrust the rest of it.
 *
 * **Every price and every option comes from the server.** The kinds, their
 * prices, the total, and the duration are read from the wallet catalogue, so a
 * control can never render a price that is not the price that will be charged,
 * and a preference can be withdrawn without shipping this file.
 *
 * **What happens to the coins is said before they move.** They are held, not
 * spent; they are charged once if the window finds somebody, and returned in
 * full if it does not. That is the rule the server implements, written where
 * somebody decides.
 *
 * **A channel that cannot take money renders no buy control.** In every
 * environment with no approved payment provider and no store project, the
 * purchase control is absent rather than present-and-broken; where the
 * environment is local, a clearly-labelled developer grant stands in its place.
 */

/** The catalogue kinds, in the order the server publishes them. */
type PreferenceKind = 'gender' | 'language' | 'region';

/**
 * The declared categories somebody may narrow to, in the product's own words.
 *
 * `undisclosed` is deliberately not here, and the server refuses it too: a
 * filter for people who declined to say would turn declining into an answer
 * with consequences.
 */
const genderChoices = [
  { label: 'Women', value: 'woman' },
  { label: 'Men', value: 'man' },
  { label: 'Non-binary people', value: 'non_binary' },
] as const;

export interface WalletView {
  /** The last authoritative answer, or nothing before the first read. */
  readonly state: WalletState | undefined;
  readonly busy: boolean;
  readonly message: string | undefined;
  /** Applies an answer from any wallet call. Never computes a balance. */
  readonly apply: (result: ApiResult<WalletState>) => void;
  /**
   * Closes the window in force and returns whatever is owed.
   *
   * Published on the view rather than only on the control that opened one,
   * because "widen the search" has to mean widen: a control that dropped the
   * free preference and left a paid narrowing running would be a button that
   * appeared not to work.
   *
   * Safe when there is no window. Cancelling nothing is not an error.
   */
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

function coinsOf(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How long a window has left, in whole minutes, never counting down.
 *
 * Rounded up and rendered once per read rather than ticking. A live countdown
 * over a thing somebody paid for is pressure, and an unused window loses nobody
 * anything when it ends — the coins come back — so a clock would be
 * manufacturing urgency that does not exist.
 */
function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

/**
 * One selection in words, in the order the catalogue publishes.
 *
 * Exported because the stage says what the search is doing and must say the
 * same thing this control does — two independent phrasings of one purchase is
 * how a surface ends up describing something nobody bought.
 */
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

/** What a selection costs, from the catalogue and never from this file. */
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

function isEmpty(selection: LivePreferenceSelection): boolean {
  return (
    selection.gender === undefined &&
    selection.language === undefined &&
    selection.region === undefined
  );
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
    const remaining = minutesLeft(held.expiresAt, Date.now());
    const droppable = (['gender', 'region', 'language'] as const).filter(
      (kind) => held[kind] !== undefined,
    );
    return (
      <div className="v-live__premium" data-testid="live-premium-active">
        <p className="v-small">
          <Icon name="globe" size="sm" />{' '}
          <span data-testid="live-premium-active-selection">
            {description} — {remaining} min left
          </span>
        </p>
        {/*
          The whole of what happens to the coins, said where the person can see
          it, and it says two different true things depending on whether the
          window has been charged. One sentence for both would have to promise a
          refund that is not coming, or threaten a charge that already happened.
        */}
        <p className="v-caption v-quiet v-measure">
          {held.charged
            ? `${held.coins} coins were used when this found somebody. It keeps looking with these preferences until it ends, and nothing more is charged.`
            : `${held.coins} coins are held, not spent. They are charged once when this finds somebody, and returned in full if it does not.`}
        </p>
        {droppable.length > 1 ? (
          <div className="v-inline v-inline--tight">
            {droppable.map((kind) => (
              <Button
                busy={action.busy}
                data-testid={`live-premium-drop-${kind}`}
                key={kind}
                onClick={() => {
                  // Widening only, and free. What is sent is what should
                  // remain, so the server compares two selections rather than
                  // applying a diff it has to trust.
                  wallet.broadenPremium(without(held, kind));
                }}
                size="sm"
              >
                Drop {kindLabel(kind, held)}
              </Button>
            ))}
          </div>
        ) : null}
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
        {held.charged ? null : (
          <p className="v-caption v-quiet">
            Going back to everyone returns the {held.coins} coins in full.
          </p>
        )}
      </div>
    );
  }

  const price = priceOf(state, selection);
  const chosen = !isEmpty(selection);
  const affordable = available >= price;
  const summary = describeSelection(selection);

  return (
    <div className="v-live__premium" data-testid="live-premium">
      <p className="v-small">
        <Icon name="globe" size="sm" /> <span>Narrow who you meet</span>
      </p>
      {/*
        Exactly what is bought, at the published price, with the published
        duration. Never "unlock", never "boost", never a claim about who is
        there — narrowing a search makes it smaller, and saying so is the
        honest version of selling it.
      */}
      <p className="v-caption v-quiet v-measure">
        Everyone is free and is what you get without this. A narrowed search
        runs for {minutes} minutes: the coins are held, charged once if it finds
        somebody, and returned in full if it does not. A narrower search takes
        longer, and nobody can promise anyone is there.
      </p>
      <p className="v-caption v-quiet" data-testid="live-premium-balance">
        You have {available} coins.
      </p>

      <fieldset className="v-fieldset" disabled={action.busy}>
        <legend className="v-visually-hidden">
          Who you would like to meet
        </legend>
        <Choice
          checked={draft.gender === undefined}
          label={<>Anyone — Free</>}
          name="premiumGender"
          onSelect={() => {
            setDraft((current) => {
              const next = { ...current };
              delete next.gender;
              return next;
            });
          }}
          value="any"
        />
        {genderChoices.map((choice) => (
          <Choice
            checked={draft.gender === choice.value}
            key={choice.value}
            label={
              <>
                {choice.label} — {coinsFor(catalogue, 'gender')} coins
              </>
            }
            name="premiumGender"
            onSelect={() => {
              setDraft((current) => ({ ...current, gender: choice.value }));
            }}
            value={choice.value}
          />
        ))}
      </fieldset>

      <Field
        error={
          region.length > 0 && !regionValid
            ? 'Enter a two-letter country code, such as ES.'
            : undefined
        }
        hint={
          regionValid
            ? (regionName(normalizedRegion) ??
              `${String(coinsFor(catalogue, 'region'))} coins`)
            : `Optional. Two letters, such as ES — ${String(coinsFor(catalogue, 'region'))} coins.`
        }
        label="Country"
        optional
      >
        {(control) => (
          <TextInput
            {...control}
            autoCapitalize="characters"
            autoComplete="country"
            data-testid="live-premium-region"
            maxLength={2}
            name="premiumRegion"
            onChange={(event) => {
              setRegion(event.target.value.toUpperCase());
            }}
            placeholder="ES"
            value={region}
          />
        )}
      </Field>

      {languageOptions.length === 0 ? null : (
        <Field
          hint={`Optional. One of the languages you speak — ${String(coinsFor(catalogue, 'language'))} coins.`}
          label="Language"
          optional
        >
          {(control) => (
            <Select
              {...control}
              data-testid="live-premium-language"
              name="premiumLanguage"
              onChange={(event) => {
                const next = event.target.value;
                setDraft((current) => {
                  const updated = { ...current };
                  if (next === '') delete updated.language;
                  else updated.language = next;
                  return updated;
                });
              }}
              value={draft.language ?? ''}
            >
              <option value="">Any language</option>
              {languageOptions.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {!chosen ? (
        <p className="v-caption v-quiet" data-testid="live-premium-none">
          Everyone is free. Choose something above to narrow the search.
        </p>
      ) : affordable ? (
        confirming ? (
          /*
            The confirmation, before anything moves. What is being activated,
            what it costs, how long it lasts, and what happens to the coins —
            said once, next to the button that does it, rather than discovered
            afterwards in a balance that changed.
          */
          <div
            className="v-live__premium-confirm"
            data-testid="live-premium-confirm"
          >
            <p className="v-small v-measure">
              {summary} for {minutes} minutes — {price} coins held.
            </p>
            <p className="v-caption v-quiet v-measure">
              They are charged once if this finds somebody, and returned in full
              if it does not.
            </p>
            <div className="v-inline v-inline--tight">
              <Button
                busy={action.busy}
                data-testid="live-premium-activate"
                onClick={() => {
                  action.run(async () => {
                    wallet.apply(await api.activateLivePreference(selection));
                    setConfirming(false);
                  });
                }}
                size="sm"
                tone="primary"
              >
                Hold {price} coins
              </Button>
              <Button
                data-testid="live-premium-back"
                onClick={() => {
                  setConfirming(false);
                }}
                size="sm"
              >
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <Button
            data-testid="live-premium-review"
            onClick={() => {
              setConfirming(true);
            }}
            size="sm"
            tone="primary"
          >
            {summary} — {price} coins
          </Button>
        )
      ) : (
        <p className="v-caption v-quiet" data-testid="live-premium-short">
          {/*
            The refusal a person can act on, and nothing more. It never says how
            many are missing beyond the arithmetic they can already do, and it
            never offers a purchase that this environment cannot complete.
            Everyone stays available and free, so nobody is stuck.
          */}
          {summary} costs {price} coins. You have {available}.
          {developerGrant
            ? ' No purchase channel is available in this environment.'
            : ''}
        </p>
      )}

      {chosen && !affordable && !developerGrant ? (
        /*
          Offered only because a channel actually exists. It is a link to where
          coins are sold rather than a purchase control here: the Live door is
          not a shop, and a buy flow on the screen somebody is trying to search
          from is the thing that turns a utility into a funnel.
        */
        <ButtonLink data-testid="live-premium-get" href="/you/wallet" size="sm">
          Get coins
        </ButtonLink>
      ) : null}

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

/** What one catalogue kind costs, or nothing if the server withdrew it. */
function coinsFor(
  catalogue: WalletState['livePreferenceCatalogue'],
  kind: PreferenceKind,
): number {
  return coinsOf(
    catalogue.preferences.find((entry) => entry.kind === kind)?.coins,
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
  if (kind === 'region') {
    return regionName(selection.region) ?? 'country';
  }
  return selection.language === undefined
    ? 'language'
    : languageName(selection.language);
}
