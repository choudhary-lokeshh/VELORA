'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';

import type {
  ApiResult,
  DiscoveryCandidate,
  LiveEncounter,
  LiveInvitation,
  LiveMedium,
  LiveMessage,
  LivePreferences,
  LiveReaction,
  LiveSimulationScenario,
  LiveState,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import { nestedHref } from '../app/navigation';
import { Icon } from '../design/icons';
import {
  Avatar,
  BlockedState,
  Button,
  ButtonLink,
  EmptyState,
  ErrorMessage,
  IconButton,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  StatusMessage,
  initialsOf,
  toneOf,
} from '../design/primitives';
import { portraitReferences, useMediaAddresses } from './imagery';
import { useLiveMedia, type LiveMediaState } from './live-media';
import {
  describeSelection,
  PremiumPreference,
  useWallet,
  type WalletView,
} from './live-premium';
import { useLiveTransport, type LiveTransport } from './live-transport';
import { useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Live discovery: meet somebody at random, right now.
 *
 * This is the primary reason to open VELORA, and the screen is arranged around
 * that rather than around the domain behind it. Six rules shape it.
 *
 * **The camera is the page.** Once somebody has asked for it, their own picture
 * is the ground everything else sits on, and the person they are talking to
 * owns the whole canvas. Nothing here is a panel beside another panel: the
 * controls, the chat, and the profile context float over the picture and go
 * away again. A live product whose video is one column of a document reads as a
 * settings screen with a webcam in it, which is exactly what the first version
 * of this screen was.
 *
 * **Nothing opens a camera except a person asking for it.** Landing here shows
 * a door, not a viewfinder. The devices open when somebody presses a control
 * that says what pressing it will do, and they close again the moment the
 * screen is left, the tab is hidden, or the page goes away.
 *
 * **Two state machines, kept apart.** The server owns where a person is — idle,
 * searching, matched, ended — and this owns where their *devices* are. They are
 * deliberately not merged: the server has no opinion about whether a camera is
 * open, and a client that told it so would be asserting a fact about itself
 * that the server would then be storing.
 *
 * **The screen says what is true.** There is no online count, because no
 * presence projection exists and a number here would be invented. There is no
 * remote video, because no approved provider carries media — and rather than an
 * empty black rectangle implying a connection that is not there, the remote
 * layer says so in words over the person's real name and real profile. When a
 * provider is configured, the same layer says that instead, from the server's
 * own answer rather than from a build flag.
 *
 * **Moving on is one press, and so is stopping.** Next is the largest control
 * on the screen because it is the one pressed most; it acknowledges instantly
 * and lets the teardown happen underneath, so nobody is left looking at a
 * frozen stranger while a request completes. End is quieter and always there.
 *
 * **Explaining is for the first time.** Somebody who has already met people
 * here does not need the three-step explanation again, so it is shown once and
 * then folded away. What stays is the picture and the one thing to press.
 */

/** How often the surface re-reads while it is waiting for somebody. */
const searchPollMilliseconds = 2000;
/** How often it re-reads while in an encounter. Also how presence is kept. */
const encounterPollMilliseconds = 3000;
/** How often the live chat re-reads. Faster: it is a conversation. */
const messagePollMilliseconds = 2000;
/**
 * How long the reveal holds before the encounter is shown as live.
 *
 * Short enough that it never delays a conversation and long enough that the
 * change of subject is legible. It is a *transition*, not a progress bar: it
 * counts down nothing, measures nothing, and claims nothing about the session
 * becoming ready — the session's own state is read and rendered separately.
 * Reduced motion skips it entirely.
 */
const revealMilliseconds = 900;
/**
 * How long a reaction stays on the stage.
 *
 * Matches the CSS animation, which is what actually moves it. Two durations for
 * one effect is a drift waiting to happen, so this is the only number and the
 * stylesheet reads it.
 */
const reactionMilliseconds = 2600;
/**
 * How long somebody waits under a narrowed search before being offered a wider
 * one.
 *
 * Not a claim that nobody matching exists — this surface has no way to know
 * that and must never imply it. It is the point at which offering the control
 * is more useful than leaving somebody to wonder whether their preference is
 * the reason.
 */
const broadenPromptMilliseconds = 20_000;

/** Where the person is on the stage, which is not where the server is. */
type Stage = 'closed' | 'opening' | 'ready';

/** Which way of meeting somebody the door is offering. */
type Mode = 'instant' | 'choose';

const endReasonCopy: Readonly<
  Record<string, { readonly body: string; readonly title: string }>
> = {
  ended_by_platform: {
    body: 'VELORA ended this one. You can meet somebody else whenever you are ready.',
    title: 'That conversation was ended',
  },
  failed: {
    body: 'The live session could not be carried. Nothing about it was your doing.',
    title: 'That could not be connected',
  },
  left: {
    body: 'You moved on.',
    title: 'You ended that conversation',
  },
  peer_left: {
    body: 'They moved on. That happens a lot here, and it is not about you.',
    title: 'They moved on',
  },
  timed_out: {
    body: 'Their connection stopped answering, so VELORA closed it.',
    title: 'You lost each other',
  },
};

const connectionCopy: Readonly<Record<string, string>> = {
  connected: 'Connected',
  none: 'Connect',
  received: 'They want to connect',
  requested: 'Waiting for them',
};

/**
 * What a search is doing, said several ways.
 *
 * The words change and the fact does not: VELORA is looking, and nobody has
 * been found yet. None of these implies a queue, a position, a number of people
 * or an estimate, because none of those exists behind this screen. They rotate
 * so that waiting reads as motion rather than as a hang — which is the whole of
 * what a spinner was doing badly.
 */
const searchingLines: readonly string[] = [
  'Looking for someone…',
  'Still looking…',
  'Nobody yet — holding your place…',
];

/**
 * The six reactions, and the glyph each is drawn as.
 *
 * Emoji rather than icons on purpose: these are drawn by the reader's own
 * system, they are already legible everywhere, and adding six glyphs to the
 * shared icon set would bind Consumer Mobile to them through the design-parity
 * gate for no benefit. The set is closed by the contract; this table only says
 * how each one looks.
 */
const reactionGlyphs: Readonly<Record<string, string>> = {
  clap: '👏',
  fire: '🔥',
  heart: '❤️',
  laugh: '😄',
  smile: '🙂',
  wave: '👋',
};

const reactionOrder: readonly LiveReaction[] = [
  'wave',
  'smile',
  'laugh',
  'heart',
  'fire',
  'clap',
];

/**
 * The deterministic local scenarios, and what each is for.
 *
 * Offered only when the server says a simulation adapter is configured, which
 * configuration refuses outside local and test — so this panel does not exist
 * in a deployed environment rather than being hidden there.
 */
const scenarios: readonly {
  readonly help: string;
  readonly label: string;
  readonly value: LiveSimulationScenario;
}[] = [
  {
    help: 'The other person writes into the live chat.',
    label: 'They say something',
    value: 'peer_message',
  },
  {
    help: 'The other person taps a reaction.',
    label: 'They react',
    value: 'peer_reaction',
  },
  {
    help: 'The other person presses Connect, which makes the connection mutual if you already have.',
    label: 'They press Connect',
    value: 'peer_connect',
  },
  {
    help: 'The other person presses Next. You should be told they moved on.',
    label: 'They move on',
    value: 'peer_next',
  },
  {
    help: 'Their client stops answering, as a closed tab would. Presence lapses and the encounter closes.',
    label: 'They disappear',
    value: 'peer_disconnect',
  },
  {
    help: 'Somebody asks to meet you live, so an incoming request can be walked.',
    label: 'They ask to meet',
    value: 'peer_invitation',
  },
  {
    help: 'Somebody you asked from Choose accepts. You are then each other’s first match once you both search.',
    label: 'They accept your ask',
    value: 'peer_accepts_invitation',
  },
  {
    help: 'No stand-in is offered until you ask for something else, so searching finds nobody.',
    label: 'Nobody is available',
    value: 'nobody_available',
  },
];

export function Live() {
  const api = useApi();
  const [stage, setStage] = useState<Stage>('closed');
  const [mode, setMode] = useState<Mode>('instant');
  const [medium, setMedium] = useState<LiveMedium>('video');
  const [preferences, setPreferences] = useState<LivePreferences>(
    () => rememberedPreferences() ?? { region: 'any' },
  );
  const [state, setState] = useState<LiveState | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const action = useSingleFlight();

  const media = useLiveMedia({
    enabled: stage !== 'closed',
    wantsAudio: true,
    wantsVideo: medium === 'video',
  });
  /*
   * Coins, read once at this level and shared by every control that renders
   * them.
   *
   * One read rather than one per control, because two controls holding
   * independent balances is how a person is shown a number they cannot spend.
   * Every wallet call answers with the whole state, so this is never a delta.
   */
  const wallet = useWallet();

  const apply = useCallback((result: ApiResult<LiveState>) => {
    if (isOk(result)) {
      setState(result.value);
      setMessage(undefined);
      return;
    }
    setMessage(failureMessage(result));
  }, []);

  // The first read happens as soon as the screen exists, and reads nothing
  // about devices: somebody arriving mid-encounter — a refresh, a second tab,
  // a phone that came back — is put back where the server says they are rather
  // than at the door.
  useEffect(() => {
    void api.liveState().then(apply);
  }, [api, apply]);

  const serverState = state?.state ?? 'idle';
  const encounter = state?.encounter;

  /*
   * The other person's media, when a provider is carrying it.
   *
   * Held here rather than inside the stage so it is keyed to the encounter the
   * *server* says this person is in. A hook that lived one level down would be
   * remounted by any re-render that changed the stage's shape, and remounting a
   * connection is how a Next produces two rooms.
   */
  const transport = useLiveTransport({
    api,
    callId: encounter?.call?.id,
    cameraOn: media.cameraOn,
    localStream: media.stream,
    mediaTransport: encounter?.call?.mediaTransport,
    microphoneOn: media.microphoneOn,
  });

  // A person the server already has in an encounter has a camera that should be
  // open, whether or not this tab is the one that opened it.
  useEffect(() => {
    if (serverState === 'matched' && stage === 'closed') setStage('ready');
  }, [serverState, stage]);

  /**
   * One poller, and what it asks depends on where the server says the person
   * is.
   *
   * While searching it asks to *keep* searching, which is idempotent and is
   * what actually allocates somebody — so the screen that says "Looking for
   * someone" is the screen doing the looking. Everywhere else it reads, which
   * also refreshes presence: reading is the only presence signal this platform
   * has, and a client that stopped reading is a client that is gone.
   */
  useEffect(() => {
    if (stage === 'closed') return undefined;
    if (serverState === 'idle') return undefined;
    const interval =
      serverState === 'searching'
        ? searchPollMilliseconds
        : encounterPollMilliseconds;
    const timer = setInterval(() => {
      void (
        serverState === 'searching'
          ? api.startLiveSearch(medium, preferences)
          : api.liveState()
      ).then((result) => {
        // A poll never overwrites an error somebody is reading with silence,
        // and never reports one either: a single dropped read is not something
        // to interrupt a conversation about.
        if (isOk(result)) setState(result.value);
      });
    }, interval);
    return () => {
      clearInterval(timer);
    };
  }, [api, medium, preferences, serverState, stage]);

  const start = (chosen: LiveMedium) => {
    setMedium(chosen);
    setStage('opening');
    rememberVisit();
    action.run(async () => {
      apply(await api.startLiveSearch(chosen, preferences));
    });
  };

  const next = (encounterId: string) => {
    action.run(async () => {
      apply(await api.advanceLiveEncounter(encounterId));
    });
  };

  const searchAgain = () => {
    action.run(async () => {
      apply(await api.startLiveSearch(medium, preferences));
    });
  };

  const changePreferences = (wanted: LivePreferences) => {
    setPreferences(wanted);
    rememberPreferences(wanted);
    // Applied on the next attempt, which is this one when a search is already
    // running. Broadening while waiting must take effect now rather than at the
    // next poll: somebody who just widened their net is watching for it to.
    if (serverState === 'searching') {
      action.run(async () => {
        apply(await api.startLiveSearch(medium, wanted));
      });
    }
  };

  const leave = () => {
    action.run(async () => {
      const result = await api.leaveLiveDiscovery();
      // The devices close before the answer is rendered. Somebody pressing End
      // is asking for the camera to stop, and making that wait on a request
      // would leave the light on for as long as the network takes.
      media.release();
      setStage('closed');
      apply(result);
    });
  };

  /*
   * Whatever happens, leaving this screen closes the devices. The hook does
   * this on teardown as well; this is the belt to its braces, and it also
   * covers a client-side navigation that keeps the tab alive.
   *
   * It depends on the *function*, not on the media state. `useLiveMedia`
   * returns a fresh object every render, so depending on that object made this
   * cleanup run on every render — releasing the camera a few milliseconds after
   * it was acquired, for ever. The screen then showed a granted permission and
   * no picture, which is the most confusing pair of states it can show, and it
   * was invisible to jsdom because jsdom has no camera to lose.
   */
  const releaseMedia = media.release;
  useEffect(
    () => () => {
      releaseMedia();
    },
    [releaseMedia],
  );

  if (state?.admission === 'unavailable') {
    return (
      <div className="v-live">
        <PageHeader
          lede="Meet one other person who is here right now."
          title="Live"
        />
        <BlockedState testId="live-unavailable" title="Live is not switched on">
          <p>
            VELORA can put two people who are both here into a live session, but
            nothing in this environment is approved to carry the audio and video
            — no RTC provider is eligible, and how long a live session may be
            kept, where it may be offered, and who is on call for it are all
            undecided. Nobody is admitted until those are answered.
          </p>
        </BlockedState>
      </div>
    );
  }

  if (state?.admission === 'not_eligible') {
    return (
      <div className="v-live">
        <PageHeader
          lede="Meet one other person who is here right now."
          title="Live"
        />
        <EmptyState
          actions={
            <ButtonLink
              data-testid="live-finish-setup"
              href="/welcome"
              tone="primary"
            >
              Finish setting up
            </ButtonLink>
          }
          body="Live discovery needs a finished account in good standing. Once that is done this is the first thing here."
          icon="live"
          testId="live-not-eligible"
          title="Not quite yet"
        />
      </div>
    );
  }

  return (
    <div className="v-live" data-testid="live">
      {/*
        Present and out of the way. The shell's bar hands the page name back and
        forth with this heading, so a screen without one is a screen the bar
        never stops naming — but a title printed above a full-bleed stage would
        be a document heading over a camera. It stays in the accessibility tree
        and off the picture.
      */}
      <div className="v-visually-hidden">
        <PageHeader
          lede="Meet one other person who is here right now."
          title="Live"
        />
      </div>

      {stage === 'closed' ? (
        <LiveDoor
          busy={action.busy}
          invitations={state?.invitations ?? []}
          languageOptions={state?.languageOptions ?? []}
          mode={mode}
          onModeChange={setMode}
          onPreferences={changePreferences}
          onStart={start}
          onState={setState}
          preferences={preferences}
          wallet={wallet}
        />
      ) : (
        <LiveStage
          busy={action.busy}
          encounter={encounter}
          languageOptions={state?.languageOptions ?? []}
          media={media}
          medium={medium}
          message={message}
          onLeave={leave}
          onNext={next}
          onPreferences={changePreferences}
          onSearchAgain={searchAgain}
          onState={setState}
          preferences={preferences}
          searchingSince={state?.searchingSince}
          premium={state?.premium}
          serverState={serverState}
          transport={transport}
          wallet={wallet}
        />
      )}

      {/*
        A failure at the door is said under the door. On the stage it is said on
        the stage, by the layer that already knows how to sit above the dock —
        an error card printed underneath a full-bleed picture is an error
        somebody scrolls to find.
      */}
      {message === undefined || stage !== 'closed' ? null : (
        <ErrorMessage testId="live-message">{message}</ErrorMessage>
      )}

      {state?.simulated === true ? (
        <SimulationPanel onState={setState} />
      ) : null}
    </div>
  );
}

/* ================================ Door ================================ */

/**
 * The door.
 *
 * Deliberately not a viewfinder, and deliberately not a form. There is one
 * thing to press, it is the largest thing on the screen, and everything else —
 * how wide a net to cast, whether to be seen at all, whether to choose somebody
 * instead — is quieter and beside it.
 *
 * Two ways in rather than one, because agreeing to be heard is not agreeing to
 * be seen, and a single control carrying whichever was chosen last would make
 * the more exposing option the default for somebody who never chose it.
 *
 * The explanation appears once. Somebody who has already met people here is
 * shown the door and nothing else, which is what makes coming back fast.
 */
function LiveDoor({
  busy,
  invitations,
  languageOptions,
  mode,
  onModeChange,
  onPreferences,
  onStart,
  onState,
  preferences,
  wallet,
}: {
  readonly busy: boolean;
  readonly invitations: readonly LiveInvitation[];
  readonly languageOptions: readonly string[];
  readonly mode: Mode;
  readonly onModeChange: (mode: Mode) => void;
  readonly onPreferences: (preferences: LivePreferences) => void;
  readonly onStart: (medium: LiveMedium) => void;
  readonly onState: (state: LiveState) => void;
  readonly preferences: LivePreferences;
  readonly wallet: WalletView;
}) {
  const [returning] = useState(() => hasVisited());
  const waiting = invitations.filter(
    (invitation) =>
      invitation.direction === 'incoming' && invitation.state === 'pending',
  );

  return (
    <section
      className={`v-live__surface v-live__door${
        mode === 'choose' ? ' v-live__door--choose' : ''
      }`}
      data-testid="live-door"
    >
      <div className="v-live__door-inner">
        <Segmented<Mode>
          label="How to meet somebody"
          onChange={onModeChange}
          options={[
            { label: 'Instant', value: 'instant' },
            waiting.length === 0
              ? { label: 'Choose', value: 'choose' }
              : { count: waiting.length, label: 'Choose', value: 'choose' },
          ]}
          value={mode}
        />

        {mode === 'instant' ? (
          <>
            <div className="v-live__door-hero">
              <span className="v-live__mark" data-live-idle>
                <Icon name="live" size="lg" />
              </span>
              <h2 className="v-display v-live__door-title">Meet someone</h2>
              {returning ? null : (
                <p className="v-live__lede">
                  One other person who is here right now. Talk for as long as it
                  is good, and move on whenever you like.
                </p>
              )}
            </div>

            {/*
              One dominant control and one quiet one, stacked rather than side
              by side. Two filled pills of the same size is a door with no
              answer to "what do I press", and agreeing to be heard is still not
              agreeing to be seen — so the quieter way in stays a separate
              control rather than a setting on this one.
            */}
            <div className="v-live__door-actions">
              <Button
                busy={busy}
                data-testid="live-start-video"
                icon="video"
                onClick={() => {
                  onStart('video');
                }}
                size="lg"
                tone="primary"
              >
                Start
              </Button>
              <Button
                data-testid="live-start-voice"
                disabled={busy}
                icon="phone"
                onClick={() => {
                  onStart('voice');
                }}
                size="sm"
                tone="ghost"
              >
                Voice only
              </Button>
            </div>

            <PreferenceControls
              languageOptions={languageOptions}
              onChange={onPreferences}
              preferences={preferences}
              wallet={wallet}
            />

            {/*
              What happens here, said once and laid out sideways. As a bulleted
              list down the page it read as documentation, which is the one
              thing a live-social door must not be. It is shown on somebody's
              first visit and never again.
            */}
            {returning ? null : (
              <ul className="v-live__steps">
                <li>
                  <Icon name="camera" size="sm" />
                  <span>Your camera opens when you press Start.</span>
                </li>
                <li>
                  <Icon name="live" size="sm" />
                  <span>VELORA finds somebody. You never choose who.</span>
                </li>
                <li>
                  <Icon name="link" size="sm" />
                  <span>Connect counts only if you both press it.</span>
                </li>
              </ul>
            )}
          </>
        ) : (
          <ChoosePanel invitations={invitations} onState={onState} />
        )}
      </div>

      {/*
        The one thing this product will not do, said on the frame's own bottom
        edge rather than as one more paragraph in the column. It is a footnote,
        and it was starting to read as documentation.
      */}
      {mode === 'instant' ? (
        <p className="v-micro v-live__door-note">
          Nothing is recorded. VELORA stores no video, no audio, and no
          transcript of a live session, and no setting turns that on.
        </p>
      ) : null}
    </section>
  );
}

/**
 * How wide a net to cast.
 *
 * Two controls and no more. Both are drawn from what this person already told
 * VELORA about themselves, neither infers anything, and there is no percentage,
 * score, or compatibility claim anywhere near them — because none of those
 * exists and a number here would be one this screen invented.
 *
 * The wording is deliberately about preference rather than promise. "Prefer
 * people near me" is true; "only show me people near me" would be a guarantee
 * this product cannot keep, because whether anybody matching is here is not
 * something either side knows in advance.
 */
function PreferenceControls({
  languageOptions,
  onChange,
  preferences,
  wallet,
}: {
  readonly languageOptions: readonly string[];
  readonly onChange: (preferences: LivePreferences) => void;
  readonly preferences: LivePreferences;
  /**
   * Coins, when this environment has them.
   *
   * The paid narrowing sits under the free ones rather than beside them,
   * because they are different things: the two above cost nothing and are a
   * preference somebody holds about themselves, and the one below is a bounded
   * purchase. Rendering them as one row of equal controls would make the
   * cheapest of them look like the odd one out.
   */
  readonly wallet: WalletView;
}) {
  const narrowed =
    preferences.region === 'same' || preferences.language !== undefined;

  return (
    <div className="v-live__prefs" data-testid="live-preferences">
      <button
        aria-pressed={preferences.region === 'same'}
        className="v-live__pref"
        data-testid="live-pref-region"
        onClick={() => {
          onChange({
            ...preferences,
            region: preferences.region === 'same' ? 'any' : 'same',
          });
        }}
        type="button"
      >
        <Icon name="globe" size="sm" />
        <span>
          {preferences.region === 'same' ? 'Prefer near me' : 'Anywhere'}
        </span>
      </button>

      {languageOptions.length === 0 ? null : (
        <div className="v-live__pref-group">
          <Icon name="languages" size="sm" />
          <label className="v-visually-hidden" htmlFor="live-pref-language">
            Preferred language
          </label>
          <select
            className="v-live__pref-select"
            data-testid="live-pref-language"
            id="live-pref-language"
            onChange={(event) => {
              const chosen = event.target.value;
              onChange(
                chosen === ''
                  ? { region: preferences.region }
                  : { language: chosen, region: preferences.region },
              );
            }}
            value={preferences.language ?? ''}
          >
            <option value="">Any language</option>
            {languageOptions.map((language) => (
              <option key={language} value={language}>
                {languageName(language)}
              </option>
            ))}
          </select>
        </div>
      )}

      {narrowed ? (
        <button
          className="v-live__pref v-live__pref--clear"
          data-testid="live-pref-clear"
          onClick={() => {
            onChange({ region: 'any' });
          }}
          type="button"
        >
          <Icon name="x" size="sm" />
          <span>Widen</span>
        </button>
      ) : null}

      <PremiumPreference languageOptions={languageOptions} wallet={wallet} />
    </div>
  );
}

/* =============================== Choose =============================== */

/**
 * Choosing somebody instead of being given somebody.
 *
 * Real VELORA profiles, from the discovery feed this product already has, in
 * the shape Discover already publishes them — and drawn the way Discover draws
 * them, because they are the same people and a second visual language for one
 * projection is a second thing to keep true. There is no second profile store
 * here and no second ranking: this is the same people, asked a different
 * question.
 *
 * The portrait is the one the person put first, obtained the way every other
 * consumer surface obtains one: a reference exchanged for a short-lived
 * address, which re-decides visibility each time. Somebody with nothing to show
 * gets their identity mark and no explanation, which is the rule everywhere
 * else and is deliberate — a blocked viewer, a processing image, and a removed
 * one must look the same.
 *
 * Nothing on a tile says "online". Availability is not published by the feed
 * and this screen has no way to prove it, so a badge claiming it would be a
 * badge this screen invented. There is no score, no percentage, and no
 * compatibility claim for the same reason. What is offered instead is honest:
 * ask, and be told truthfully whether they have answered.
 */
function ChoosePanel({
  invitations,
  onState,
}: {
  readonly invitations: readonly LiveInvitation[];
  readonly onState: (state: LiveState) => void;
}) {
  const api = useApi();
  const [candidates, setCandidates] = useState<
    readonly DiscoveryCandidate[] | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const ask = useSingleFlight();

  useEffect(() => {
    let cancelled = false;
    void api.candidates({ pageSize: 12 }).then((result) => {
      if (cancelled) return;
      if (isOk(result)) {
        setCandidates(result.value.candidates);
        return;
      }
      setError(failureMessage(result));
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const outstanding = new Set(
    invitations
      .filter((invitation) => invitation.direction === 'outgoing')
      .map((invitation) => invitation.person.id),
  );

  // One exchange for the whole page. Each tile draws its identity mark first
  // and takes the photograph when it arrives, so nothing on screen waits.
  const portraits = useMediaAddresses(
    portraitReferences(candidates ?? []),
    'display',
  );

  return (
    <div className="v-live__choose" data-testid="live-choose">
      <InvitationList invitations={invitations} onState={onState} />

      <p className="v-caption v-live__choose-note">
        Ask somebody to meet live. They are told you asked and nothing else; a
        live session happens only if they say yes and you are both here.
      </p>

      {error === undefined ? null : (
        <ErrorMessage testId="live-choose-error">{error}</ErrorMessage>
      )}

      {candidates === undefined ? (
        <>
          <p className="v-visually-hidden" role="status">
            Loading people
          </p>
          <ul className="v-live__people">
            {Array.from({ length: 4 }, (_, index) => (
              <li className="v-live__person" key={index}>
                <div style={{ aspectRatio: '4 / 5' }}>
                  <Skeleton height="100%" width="100%" />
                </div>
                <div className="v-live__person-body">
                  <Skeleton height={12} width="60%" />
                  <Skeleton height={36} width="100%" />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : candidates.length === 0 ? (
        <div className="v-live__choose-empty" data-testid="live-choose-empty">
          <Icon name="compass" size="lg" />
          <p className="v-small">
            Nobody to show right now. Instant still works — VELORA looks across
            everybody who is here rather than only the people it can show you.
          </p>
        </div>
      ) : (
        <ul className="v-live__people">
          {candidates.map((candidate) => {
            const pending =
              outstanding.has(candidate.id) || asked.has(candidate.id);
            const portrait = portraits.get(candidate.media[0]?.id ?? '');
            const context = contextLine(
              candidate.region,
              candidate.sharedLanguages,
            );
            return (
              <li className="v-live__person" key={candidate.id}>
                <div
                  className={`v-live__person-portrait v-avatar--tone-${String(
                    toneOf(candidate.id),
                  )}`}
                >
                  {portrait === undefined ? (
                    <span aria-hidden="true" className="v-live__person-mark">
                      {initialsOf(candidate.displayName)}
                    </span>
                  ) : (
                    /* A plain element rather than the framework's optimised
                       one: a per-request signed address is viewer-scoped and
                       short-lived, so nothing upstream can fetch or cache it. */
                    <img
                      alt=""
                      className="v-live__person-image"
                      data-testid={`live-portrait-${candidate.id}`}
                      src={portrait}
                    />
                  )}
                  <div className="v-live__person-identity">
                    <p className="v-subheading v-truncate">
                      {candidate.displayName}
                    </p>
                    {context === '' ? null : (
                      <p className="v-micro v-quiet v-truncate">{context}</p>
                    )}
                  </div>
                </div>
                <div className="v-live__person-body">
                  {candidate.bio === undefined ? null : (
                    <p className="v-caption v-live__person-bio">
                      {candidate.bio}
                    </p>
                  )}
                  <Button
                    block
                    data-testid={`live-ask-${candidate.id}`}
                    disabled={pending || ask.busy}
                    icon={pending ? 'check' : 'live'}
                    onClick={() => {
                      ask.run(async () => {
                        const result = await api.inviteToLive({
                          candidateId: candidate.id,
                          medium: 'video',
                        });
                        if (!isOk(result)) {
                          setError(failureMessage(result));
                          return;
                        }
                        setError(undefined);
                        setAsked(new Set([...asked, candidate.id]));
                        const current = await api.liveState();
                        if (isOk(current)) onState(current.value);
                      });
                    }}
                    size="sm"
                    /*
                     * Secondary, deliberately. There is one action per tile and
                     * twelve tiles on a laptop; a filled accent on each is a
                     * wall of accent, which is the casino this product is not.
                     * The tile itself is the affordance and the control is
                     * unmistakable within it.
                     */
                    tone="secondary"
                  >
                    {pending ? 'Asked' : 'Ask to meet'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Requests to meet, in both directions.
 *
 * The states are the server's own and the words are the truthful reading of
 * each. `accepted` in particular says what it means: two people have agreed and
 * are not both here yet, so the next time they both search they are each
 * other's first match. Saying "connecting" there would be a promise nothing can
 * keep.
 */
function InvitationList({
  invitations,
  onState,
}: {
  readonly invitations: readonly LiveInvitation[];
  readonly onState: (state: LiveState) => void;
}) {
  const api = useApi();
  const respond = useSingleFlight();
  if (invitations.length === 0) return null;

  const answer = (
    invitationId: string,
    response: 'accept' | 'decline' | 'cancel',
  ) => {
    respond.run(async () => {
      await api.respondToLiveInvitation({ invitationId, response });
      const current = await api.liveState();
      if (isOk(current)) onState(current.value);
    });
  };

  return (
    <ul className="v-live__requests" data-testid="live-invitations">
      {invitations.map((invitation) => (
        <li className="v-live__request" key={invitation.id}>
          <Avatar
            displayName={invitation.person.displayName}
            seed={invitation.person.id}
            size="sm"
          />
          <div className="v-live__request-body">
            <p className="v-small v-truncate">
              {invitation.person.displayName}
            </p>
            <p className="v-micro v-quiet">{invitationCopy(invitation)}</p>
          </div>
          {invitation.direction === 'incoming' &&
          invitation.state === 'pending' ? (
            <div className="v-inline v-inline--tight">
              <Button
                data-testid={`live-invitation-accept-${invitation.id}`}
                disabled={respond.busy}
                onClick={() => {
                  answer(invitation.id, 'accept');
                }}
                size="sm"
                tone="primary"
              >
                Yes
              </Button>
              <Button
                data-testid={`live-invitation-decline-${invitation.id}`}
                disabled={respond.busy}
                onClick={() => {
                  answer(invitation.id, 'decline');
                }}
                size="sm"
              >
                No
              </Button>
            </div>
          ) : invitation.direction === 'outgoing' ? (
            <Button
              data-testid={`live-invitation-cancel-${invitation.id}`}
              disabled={respond.busy}
              onClick={() => {
                answer(invitation.id, 'cancel');
              }}
              size="sm"
            >
              Withdraw
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* =============================== Stage ================================ */

/**
 * The stage: one canvas, everything else over it.
 *
 * One layout for every server state rather than four screens, because the
 * camera must not close and reopen between "searching" and "matched" — a
 * viewfinder that blinks every time somebody is found is a viewfinder that
 * looks broken, and reacquiring devices takes long enough to be seen.
 *
 * What changes between the states is what the canvas is *of*. While searching
 * it is this person's own picture, full bleed, because that is the only real
 * image there is. Once somebody is found the other person owns it and the
 * picture shrinks into the corner, which is the same movement every video
 * product makes and the reason a match reads as an arrival rather than as a
 * layout change.
 */
function LiveStage({
  busy,
  encounter,
  languageOptions,
  media,
  medium,
  message,
  onLeave,
  onNext,
  onPreferences,
  onSearchAgain,
  onState,
  preferences,
  premium,
  searchingSince,
  serverState,
  transport,
  wallet,
}: {
  readonly busy: boolean;
  readonly encounter: LiveEncounter | undefined;
  readonly languageOptions: readonly string[];
  readonly media: LiveMediaState;
  readonly medium: LiveMedium;
  /** A failure worth reading, said over the picture rather than under it. */
  readonly message: string | undefined;
  readonly onLeave: () => void;
  readonly onNext: (encounterId: string) => void;
  readonly onPreferences: (preferences: LivePreferences) => void;
  readonly onSearchAgain: () => void;
  readonly onState: (state: LiveState) => void;
  readonly preferences: LivePreferences;
  /** The paid narrowing in force, as the server reports it. Never inferred. */
  readonly premium: LiveState['premium'];
  readonly searchingSince: string | undefined;
  readonly serverState: LiveState['state'];
  /** What a provider is actually carrying, if anything. Never a guess. */
  readonly transport: LiveTransport;
  readonly wallet: WalletView;
}) {
  const live = serverState === 'matched' && encounter !== undefined;
  const encounterId = encounter?.id;
  const revealing = useReveal(live ? encounterId : undefined);
  const [chatOpen, setChatOpen] = useState(() => widescreen());
  const [unread, setUnread] = useState(0);
  const [bursts, setBursts] = useState<readonly Burst[]>([]);
  /*
   * Whether the mutual connection has been acknowledged on this encounter.
   *
   * Shown once and then dismissible, rather than a banner that sits over the
   * conversation for the rest of it. Nobody is moved out of the call for it
   * either: two people who just agreed to keep talking should be allowed to
   * keep talking.
   */
  const [celebrated, setCelebrated] = useState(false);
  const connection = encounter?.connection;
  const conversationId = connection?.conversationId;
  const mutual = connection?.state === 'connected';

  /*
   * Pressing Next acknowledges before the server has answered.
   *
   * The teardown underneath is unchanged and still authoritative — the request
   * names the encounter, the server ends that one and no other, and a late
   * answer about a previous encounter is still discarded by identifier. What
   * this removes is the second or so of frozen stranger between the press and
   * the answer, which is the single thing that made moving on feel slow.
   */
  const [moving, setMoving] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (moving !== undefined && encounterId !== moving) setMoving(undefined);
  }, [encounterId, moving]);
  const movingOn = moving !== undefined && moving === encounterId;

  // A new encounter is a new conversation and a clean stage.
  useEffect(() => {
    setUnread(0);
    setBursts([]);
    setCelebrated(false);
  }, [encounterId]);

  const showBurst = useCallback((reaction: string, self: boolean) => {
    const id = crypto.randomUUID();
    setBursts((current) => [...current, { id, reaction, self }]);
    setTimeout(() => {
      setBursts((current) => current.filter((burst) => burst.id !== id));
    }, reactionMilliseconds);
  }, []);

  const showing = live && !movingOn;
  // The camera is the ground of the screen only while there is nobody to look
  // at. The moment the canvas is about somebody — a person found, or an account
  // of what became of them — it moves to the corner, because a full-bleed
  // picture of yourself behind those words is a picture nobody can read them
  // over.
  const aboutSomebody =
    showing ||
    (serverState === 'ended' && encounter !== undefined && !movingOn);

  /*
   * How tall the dock and the chat sheet actually are, measured rather than
   * guessed.
   *
   * Everything anchored above them — the preview, the identity plate, the
   * notices, the reactions, the connection moment — has to clear them, and both
   * heights change with the text size, with the safe area, and with whether the
   * reaction row is open. A constant is a constant that is wrong at somebody's
   * text size, which is exactly what a browser showed: at twice the text the
   * dock grew a second row and the preview sat on top of it.
   */
  const [dock, dockHeight] = useMeasuredBlock();
  const [sheet, sheetHeight] = useMeasuredBlock();
  const [notice, noticeHeight] = useMeasuredBlock();

  return (
    <div
      className={`v-live__surface v-live__stage${
        aboutSomebody ? ' v-live__stage--live' : ''
      }${chatOpen && showing ? ' v-live__stage--chatting' : ''}`}
      data-testid="live-room"
      style={
        {
          '--live-dock-block': `${String(Math.round(dockHeight))}px`,
          '--live-notice-block': `${String(
            noticeHeight === 0 ? 0 : Math.round(noticeHeight) + 12,
          )}px`,
          '--live-sheet-block': `${String(Math.round(sheetHeight))}px`,
        } as CSSProperties
      }
    >
      <LocalPreview media={media} medium={medium} pip={aboutSomebody} />

      <div className="v-live__canvas" data-testid="live-remote">
        {showing ? (
          <RemotePane
            encounter={encounter}
            revealing={revealing}
            transport={transport}
          />
        ) : serverState === 'ended' && encounter !== undefined && !movingOn ? (
          <EndedPane encounter={encounter} />
        ) : (
          <SearchingPane
            languageOptions={languageOptions}
            onPreferences={onPreferences}
            preferences={preferences}
            premium={premium}
            searchingSince={searchingSince}
            wallet={wallet}
          />
        )}
      </div>

      <div
        aria-hidden="true"
        className="v-live__bursts"
        // One number for how long a reaction lives. The stylesheet animates it
        // and this schedules its removal; two durations for one effect is a
        // drift that ends with glyphs left on the stage.
        style={
          {
            '--live-burst-duration': `${String(reactionMilliseconds)}ms`,
          } as CSSProperties
        }
      >
        {bursts.map((burst) => (
          <span
            className={`v-live__burst${burst.self ? ' v-live__burst--self' : ''}`}
            key={burst.id}
          >
            {reactionGlyphs[burst.reaction] ?? '·'}
          </span>
        ))}
      </div>

      {showing ? <PeerStrip encounter={encounter} /> : null}

      {showing && mutual && !celebrated ? (
        <ConnectedMoment
          conversationId={conversationId}
          displayName={encounter.peer.displayName}
          onDismiss={() => {
            setCelebrated(true);
          }}
        />
      ) : null}

      <Dock
        busy={busy}
        chatOpen={chatOpen}
        encounter={showing ? encounter : undefined}
        measure={dock}
        media={media}
        onBurst={showBurst}
        onLeave={onLeave}
        onNext={(id) => {
          setMoving(id);
          setChatOpen(widescreen());
          onNext(id);
        }}
        onSearchAgain={onSearchAgain}
        onState={onState}
        onToggleChat={() => {
          setChatOpen(!chatOpen);
          setUnread(0);
        }}
        serverState={serverState}
        unread={unread}
      />

      <PermissionNotice measure={notice} media={media} message={message} />

      {showing ? (
        <LiveChat
          encounter={encounter}
          measure={sheet}
          onBurst={showBurst}
          onClose={() => {
            setChatOpen(false);
          }}
          onState={onState}
          onUnread={setUnread}
          open={chatOpen}
        />
      ) : null}
    </div>
  );
}

interface Burst {
  readonly id: string;
  readonly reaction: string;
  readonly self: boolean;
}

/**
 * Whoever is on the other side, and an honest account of what is carrying them.
 *
 * There is no black rectangle here. A pane that looked like a video feed which
 * had not started would be the single most misleading thing on this screen, so
 * when nothing is carrying media it says so in words, over the person's real
 * name and the real, public things they wrote about themselves.
 */
function RemotePane({
  encounter,
  revealing,
  transport,
}: {
  readonly encounter: LiveEncounter;
  readonly revealing: boolean;
  readonly transport: LiveTransport;
}) {
  const carried = (encounter.call?.mediaTransport ?? 'none') === 'provider';
  const context = contextLine(
    encounter.peer.region,
    encounter.peer.sharedLanguages,
  );
  /*
   * The remote video element, attached imperatively.
   *
   * `srcObject` is a property rather than an attribute, so React cannot set it
   * from a prop. Attaching it here rather than in a `key`-ed remount keeps the
   * element — and therefore the playback — alive across a track being replaced,
   * which is what a reconnect does.
   */
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  /**
   * Binds whatever element exists to whatever stream exists, whichever arrives
   * first.
   *
   * A ref plus an effect keyed on the stream is not enough, and the reason is
   * ordering: the element is rendered only once a video track has been
   * subscribed, so an effect that ran when the *stream* changed could run
   * before the element existed and never run again. A callback ref fires on
   * mount, so the two are bound whichever way round they happen.
   */
  const attach = useCallback((element: HTMLVideoElement | null) => {
    remoteVideo.current = element;
    if (element === null) return;
    element.srcObject = remoteStreamRef.current ?? null;
    void element.play().catch(() => undefined);
  }, []);
  /**
   * The voice, in its own element.
   *
   * The video element cannot be the audio sink, because it exists only while a
   * picture is arriving: a peer with the camera off — muted from the start, or
   * turned off mid-call — still speaks, and a sink that unmounted with the
   * picture took their voice with it. This element is always mounted while the
   * encounter is carried, draws nothing, and is the one place their audio
   * plays; the video element above it is muted so a camera coming on does not
   * add a second copy of the same voice.
   */
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const attachAudio = useCallback((element: HTMLAudioElement | null) => {
    remoteAudio.current = element;
    if (element === null) return;
    element.srcObject = remoteStreamRef.current ?? null;
    // Autoplay with sound is refused unless the element is muted or the page
    // has been interacted with. Reaching this screen requires pressing Start,
    // so it has been — and a rejection is recoverable by the person pressing
    // anything, so it is swallowed rather than shown.
    void element.play().catch(() => undefined);
  }, []);
  const remoteStreamRef = useRef<MediaStream | undefined>(undefined);
  remoteStreamRef.current = transport.remoteStream;
  useEffect(() => {
    for (const element of [remoteVideo.current, remoteAudio.current]) {
      if (element === null) continue;
      element.srcObject = transport.remoteStream ?? null;
      if (transport.remoteStream !== undefined) {
        void element.play().catch(() => undefined);
      }
    }
  }, [transport.remoteStream]);

  return (
    <div
      className={`v-live__peer${revealing ? ' v-live__peer--revealing' : ''}${
        transport.peerVideo ? ' v-live__peer--carried' : ''
      }`}
      data-testid="live-peer"
    >
      {/*
        The other person, when a provider is actually carrying them. It sits
        under the portrait and the plate rather than replacing them, so the
        moment a track arrives is a picture appearing behind a name rather than
        the whole composition being swapped.
      */}
      {transport.peerVideo ? (
        <video
          autoPlay
          className="v-live__peer-video"
          data-testid="live-peer-video"
          muted
          playsInline
          ref={attach}
        />
      ) : null}
      {carried ? (
        <audio autoPlay data-testid="live-peer-audio" ref={attachAudio} />
      ) : null}
      {/*
        The person, and what is carrying them. Nothing about the arrangement
        differs between the reveal and the connected state — the same hero, the
        same plate, the same dock — so a match arrives rather than swapping one
        layout for another under somebody's eyes.
      */}
      <span className="v-live__peer-halo">
        <Avatar
          displayName={encounter.peer.displayName}
          seed={encounter.peer.id}
          size="lg"
        />
      </span>

      {/*
        Who this is, in their own published words. Centred under the portrait on
        a narrow window; a compact plate in the lower corner of the picture on a
        wide one, which is where every video product puts a name and which
        leaves the middle of the canvas to the person rather than to a paragraph
        about them.
      */}
      <div className="v-live__peer-plate">
        <p className="v-live__peer-name" data-testid="live-peer-name">
          {encounter.peer.displayName}
        </p>
        {context === '' ? null : <p className="v-small v-quiet">{context}</p>}
        {encounter.peer.bio === undefined ? null : (
          <p className="v-caption v-live__peer-bio">{encounter.peer.bio}</p>
        )}
      </div>

      {/*
        What is carrying them, last and quietest. It is an account of an absence
        rather than a thing to act on, and it is exact rather than reassuring —
        a pane that looked like a video feed which had not started would be the
        most misleading thing on this screen.
      */}
      {revealing ? (
        <p className="v-live__transport" data-testid="live-connecting">
          <Icon name="live" size="sm" />
          <span>Connecting…</span>
        </p>
      ) : !carried ? (
        <p className="v-live__transport" data-testid="live-no-media">
          <Icon name="cameraOff" size="sm" />
          <span>
            You are with {encounter.peer.displayName}, and no approved provider
            exists yet to carry their camera or voice. The chat is live and
            everything else here is real.
          </span>
        </p>
      ) : transport.state === 'failed' ? (
        <p className="v-live__transport" data-testid="live-media-failed">
          <Icon name="cameraOff" size="sm" />
          <span>
            You are with {encounter.peer.displayName}, and their camera and
            voice could not be connected. The chat is live; Next will find
            somebody else.
          </span>
        </p>
      ) : transport.state === 'reconnecting' ? (
        <p className="v-live__transport" data-testid="live-media-reconnecting">
          <Icon name="live" size="sm" />
          <span>Reconnecting…</span>
        </p>
      ) : transport.peerVideo || transport.peerAudio ? (
        <p
          className="v-live__transport v-live__transport--connected"
          data-testid="live-media-carried"
        >
          <Icon name="check" size="sm" />
          {/*
            Says what is arriving rather than that a connection exists. Somebody
            whose peer has turned their camera off is not looking at a broken
            product, and a single word for both cases would leave them guessing
            which.
          */}
          <span>
            {transport.peerVideo
              ? 'Connected.'
              : `${encounter.peer.displayName}'s camera is off.`}
          </span>
        </p>
      ) : transport.peerJoined ? (
        <p className="v-live__transport" data-testid="live-media-quiet">
          <Icon name="cameraOff" size="sm" />
          {/*
            Here, sending nothing. A peer with the camera and the microphone
            both off publishes no tracks at all, and before the room's own
            presence was a fact this screen could read, that person was
            described as not having joined yet — which is the wrong thing to say
            about somebody already here and able to type.
          */}
          <span>
            {`${encounter.peer.displayName}'s camera and microphone are off. The chat still works.`}
          </span>
        </p>
      ) : (
        <p className="v-live__transport" data-testid="live-media-waiting">
          <Icon name="live" size="sm" />
          {/*
            Truthful about the one thing this state actually is: the room is
            joined and the other person has not started sending yet. It never
            says "connected" before a track has arrived.
          */}
          <span>Waiting for {encounter.peer.displayName} to join…</span>
        </p>
      )}
    </div>
  );
}

/**
 * The moment two people become connected.
 *
 * Restrained on purpose. It confirms what has happened, says where the
 * conversation now lives, and gets out of the way — and it does not end the
 * call, move anybody, or imply any urgency about acting on it. Two people who
 * have just agreed to keep talking should be allowed to keep talking.
 *
 * It appears only on a real mutual connection, which is two independent taps
 * decided inside DISCOVERY's own transaction. Nothing here can be reached by
 * one person pressing something twice.
 */
function ConnectedMoment({
  conversationId,
  displayName,
  onDismiss,
}: {
  readonly conversationId: string | undefined;
  readonly displayName: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      className="v-live__moment"
      data-testid="live-connected-moment"
      role="status"
    >
      <span className="v-live__moment-mark">
        <Icon name="link" size="sm" />
      </span>
      <div className="v-live__moment-body">
        <p className="v-small v-live__moment-title">
          You and {displayName} are connected
        </p>
        <p className="v-micro v-quiet">
          {conversationId === undefined ? (
            <>Keep talking here. The conversation is in your Inbox.</>
          ) : (
            <>
              Keep talking here, or{' '}
              <Link
                data-testid="live-moment-conversation"
                href={nestedHref(`/messages/${conversationId}`, '/live')}
              >
                open it in your Inbox
              </Link>
              .
            </>
          )}
        </p>
      </div>
      <IconButton
        data-testid="live-moment-dismiss"
        label="Dismiss"
        name="x"
        onClick={onDismiss}
        size="sm"
      />
    </div>
  );
}

/**
 * The person's name, where they are, and the two things to do about them.
 *
 * Along the top rather than over the middle, so it never covers the face it is
 * describing. Safety sits here, one press away and always in the same place —
 * the moment somebody wants it is the moment they should not have to look.
 */
function PeerStrip({ encounter }: { readonly encounter: LiveEncounter }) {
  return (
    <div className="v-live__strip">
      <span
        className={`v-live__connection v-live__connection--${encounter.connection.state}`}
        data-testid="live-connection"
      >
        <Icon name="link" size="sm" />
        {connectionCopy[encounter.connection.state] ?? 'Connect'}
      </span>
      <div className="v-live__strip-actions">
        <Link
          className="v-live__peer-link"
          data-testid="live-peer-profile"
          href={`/people/${encounter.peer.id}?from=/live`}
        >
          <Icon name="user" size="sm" />
          <span>Profile</span>
        </Link>
        <PersonSafetyMenu
          person={{
            displayName: encounter.peer.displayName,
            id: encounter.peer.id,
          }}
          size="sm"
        />
      </div>
    </div>
  );
}

/**
 * Searching, and saying only what is true about it.
 *
 * No count of who is waiting, no "247 people online", no ticking number, no
 * rotating faces of people who are not there. There is no presence projection
 * behind this product, so any number here would be one this screen invented —
 * and a person who found that out would be right to distrust everything else on
 * it.
 *
 * What conveys progress instead is motion that belongs to the search and words
 * that change without claiming anything: three phrasings of "still looking",
 * over the person's own live picture. When a preference is narrowing the search
 * and it has been a while, the way to widen it is offered — as a choice, never
 * as a claim that nobody matching exists, which this screen cannot know.
 */
function SearchingPane({
  languageOptions,
  onPreferences,
  preferences,
  premium,
  searchingSince,
  wallet,
}: {
  readonly languageOptions: readonly string[];
  readonly onPreferences: (preferences: LivePreferences) => void;
  readonly preferences: LivePreferences;
  readonly premium: LiveState['premium'];
  readonly searchingSince: string | undefined;
  readonly wallet: WalletView;
}) {
  const waited = useElapsed(searchingSince);
  const narrowed =
    preferences.region === 'same' ||
    preferences.language !== undefined ||
    premium !== undefined;
  const line =
    searchingLines[
      Math.min(searchingLines.length - 1, Math.floor(waited / 8000))
    ] ?? searchingLines[0];

  return (
    <div className="v-live__searching" data-testid="live-searching">
      {/*
        The search's own motion: three rings leaving a mark, over the person's
        own live picture. It measures nothing, counts nothing, and stands for
        nothing but the fact that VELORA is looking — which is the whole of what
        is true here.
      */}
      <span aria-hidden="true" className="v-live__pulse">
        <span className="v-live__pulse-ring" />
        <span className="v-live__pulse-ring" />
        <span className="v-live__pulse-ring" />
        <span className="v-live__pulse-core">
          <Icon name="live" size="md" />
        </span>
      </span>
      <StatusMessage testId="live-searching-status">
        <span className="v-live__searching-line">{line}</span>
      </StatusMessage>
      {/*
        Every phrasing of the state says that VELORA is looking, including this
        one — the rotating line above it does not always carry the word, and a
        screen that reads "Nobody yet" with nothing beside it is a screen that
        looks like it has stopped.
      */}
      <p className="v-caption v-live__searching-note">
        {/*
          Says what the search is actually doing, including when somebody paid
          to make it smaller. A paid narrowing that produced an identical
          sentence to a free one would be the clearest way to make somebody
          doubt they got what they bought — and it still promises nothing about
          who is there, because nothing knows.
        */}
        {premium === undefined
          ? 'VELORA is looking across everybody here, except anybody you have just met.'
          : `VELORA is looking for ${describeSelection(premium) ?? 'a narrowed search'} only, except anybody you have just met. Nobody can promise somebody is there.`}
      </p>

      {narrowed && waited >= broadenPromptMilliseconds ? (
        <div className="v-live__broaden" data-testid="live-broaden">
          <p className="v-caption v-quiet v-measure">
            {/*
              Truthful about what waiting means, and it never says nobody is
              there: this screen cannot know that, and a paid narrowing is
              exactly where a confident "nobody matches" would be worst. What is
              offered is the choice — keep waiting, or widen — with the money
              consequence stated where somebody decides.
            */}
            {premium === undefined
              ? 'Your search is narrowed. Widening it looks at everybody who is here.'
              : premium.charged
                ? `Your search is narrowed to ${describeSelection(premium) ?? 'your preferences'}. Nobody else matching has been here yet. You can keep waiting, or go back to everyone — this window has already been used, so nothing more is charged either way.`
                : `Your search is narrowed to ${describeSelection(premium) ?? 'your preferences'}. Nobody matching has been here yet. You can keep waiting, or go back to everyone — the coins you held come back in full either way.`}
          </p>
          <Button
            data-testid="live-broaden-action"
            onClick={() => {
              // Both narrowings are cleared, because "widen" means widen. A
              // control that dropped the free preference and left the paid one
              // running would be a button that appeared not to work.
              onPreferences({ region: 'any' });
              // "Widen" means widen. The paid window is closed too, and its
              // coins come back in full, which is exactly what the sentence
              // above this button says will happen.
              if (premium !== undefined) wallet.cancelPremium();
            }}
            size="sm"
          >
            Widen the search
          </Button>
          <PremiumPreference
            languageOptions={languageOptions}
            wallet={wallet}
          />
        </div>
      ) : (
        <PreferenceControls
          languageOptions={languageOptions}
          onChange={onPreferences}
          preferences={preferences}
          wallet={wallet}
        />
      )}
    </div>
  );
}

function EndedPane({ encounter }: { readonly encounter: LiveEncounter }) {
  const copy =
    endReasonCopy[encounter.endReason ?? ''] ?? endReasonCopy.peer_left;
  const connected =
    encounter.connection.state === 'connected' &&
    encounter.connection.conversationId !== undefined;
  return (
    <div className="v-live__ended" data-testid="live-ended">
      <span className="v-live__peer-halo">
        <Avatar
          displayName={encounter.peer.displayName}
          seed={encounter.peer.id}
          size="md"
        />
      </span>
      <p className="v-heading v-live__ended-title">
        {copy?.title ?? 'That conversation ended'}
      </p>
      <p className="v-small v-live__ended-body">{copy?.body ?? ''}</p>
      {connected ? (
        <Notice
          icon="message"
          testId="live-ended-connected"
          title={`You and ${encounter.peer.displayName} are connected`}
        >
          <p>
            The conversation is in your Inbox, and either of you can carry on
            there whenever you like.{' '}
            <Link
              data-testid="live-ended-conversation"
              href={nestedHref(
                `/messages/${encounter.connection.conversationId ?? ''}`,
                '/live',
              )}
            >
              Open it
            </Link>
            .
          </p>
        </Notice>
      ) : encounter.connection.state === 'requested' ? (
        <p
          className="v-caption v-quiet v-live__ended-body"
          data-testid="live-ended-requested"
        >
          You asked to connect. If they ask too, the conversation appears in
          both your inboxes.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The person's own camera.
 *
 * The ground of the whole screen while nobody has been found, and a corner of
 * it once somebody has. `muted` is not a preference: a preview that played its
 * own microphone back through the speakers would feed back the instant somebody
 * unmuted, so it is fixed rather than offered. `playsInline` keeps it in place
 * on mobile Safari, which otherwise takes any playing video full screen.
 */
function LocalPreview({
  media,
  medium,
  pip,
}: {
  readonly media: LiveMediaState;
  readonly medium: LiveMedium;
  readonly pip: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (element === null) return;
    // Assigned rather than passed as a prop, because `srcObject` takes an
    // object and React only sets string attributes.
    element.srcObject = media.stream ?? null;
  }, [media.stream]);

  const showing =
    medium === 'video' && media.cameraOn && media.stream !== undefined;

  return (
    <div
      className={`v-live__local${pip ? ' v-live__local--pip' : ''}`}
      data-testid="live-local"
    >
      {/*
        All three attributes are load-bearing and none is a preference.
        `autoPlay` is what makes a bound stream actually render — a `<video>`
        holding a live `srcObject` shows a black rectangle until something
        plays it, which is exactly what this did until a walk on a real browser
        caught it. `muted` stops the preview feeding this person's own
        microphone back through their speakers the instant they unmute.
        `playsInline` keeps it in place on mobile Safari, which otherwise takes
        any playing video full screen.
      */}
      <video
        aria-label="Your camera"
        autoPlay
        className="v-live__local-video"
        data-testid="live-local-video"
        hidden={!showing}
        muted
        playsInline
        ref={videoRef}
      />
      {showing ? null : (
        <div className="v-live__local-off" data-testid="live-local-off">
          <Icon name={medium === 'video' ? 'cameraOff' : 'phone'} size="md" />
          <span className="v-micro">
            {medium === 'voice'
              ? 'Voice only'
              : media.permission === 'granted'
                ? 'Camera off'
                : 'Camera not open'}
          </span>
        </div>
      )}
      <span className="v-live__local-badges">
        <span
          className={`v-live__badge${media.microphoneOn ? '' : ' v-live__badge--off'}`}
          data-testid="live-mic-state"
        >
          <Icon name={media.microphoneOn ? 'mic' : 'micOff'} size="sm" />
          <span className="v-visually-hidden">
            {media.microphoneOn ? 'Microphone on' : 'Microphone muted'}
          </span>
        </span>
      </span>
    </div>
  );
}

/* =============================== Dock ================================= */

/**
 * The controls, weighted by how often they are pressed and what they cost.
 *
 * Deliberately not a row of equals. Next is the largest thing on the screen
 * because it is the most frequent act in the product; Connect sits beside it
 * because it is the meaningful one; the devices are icons on the left where a
 * hand reaches for them in a hurry; chat and reactions are icons on the right;
 * and End is a quiet control at the edge — obvious, never dominant, and never
 * behind a menu, because the moment somebody wants to stop is not the moment to
 * make them look for the control that does it.
 *
 * There is deliberately no confirmation on Next. A dialog between a person and
 * the next conversation would be friction defended as care, and this product's
 * whole premise is that moving on is cheap.
 */
function Dock({
  busy,
  chatOpen,
  encounter,
  measure,
  media,
  onBurst,
  onLeave,
  onNext,
  onSearchAgain,
  onState,
  onToggleChat,
  serverState,
  unread,
}: {
  readonly busy: boolean;
  readonly chatOpen: boolean;
  readonly encounter: LiveEncounter | undefined;
  /** Reports the dock's own height, which everything above it has to clear. */
  readonly measure: (element: HTMLElement | null) => void;
  readonly media: LiveMediaState;
  readonly onBurst: (reaction: string, self: boolean) => void;
  readonly onLeave: () => void;
  readonly onNext: (encounterId: string) => void;
  readonly onSearchAgain: () => void;
  readonly onState: (state: LiveState) => void;
  readonly onToggleChat: () => void;
  readonly serverState: LiveState['state'];
  readonly unread: number;
}) {
  const api = useApi();
  const connect = useSingleFlight();
  const react = useSingleFlight();
  const [connectError, setConnectError] = useState<string | undefined>(
    undefined,
  );
  const [reacting, setReacting] = useState(false);

  return (
    <div className="v-live__dock" data-testid="live-controls" ref={measure}>
      {/* The devices, at the end a hand reaches for in a hurry. A device that
          is off says so in colour as well as in its glyph and its label. */}
      <div className="v-live__devices">
        <span
          className={`v-live__device${
            media.microphoneOn ? '' : ' v-live__device--off'
          }`}
        >
          <IconButton
            data-testid="live-toggle-mic"
            label={
              media.microphoneOn
                ? 'Mute your microphone'
                : 'Unmute your microphone'
            }
            name={media.microphoneOn ? 'mic' : 'micOff'}
            onClick={media.toggleMicrophone}
          />
        </span>
        <span
          className={`v-live__device${
            media.cameraOn ? '' : ' v-live__device--off'
          }`}
        >
          <IconButton
            data-testid="live-toggle-camera"
            label={
              media.cameraOn ? 'Turn your camera off' : 'Turn your camera on'
            }
            name={media.cameraOn ? 'camera' : 'cameraOff'}
            onClick={media.toggleCamera}
          />
        </span>
        {media.switchable ? (
          <span className="v-live__device">
            <IconButton
              data-testid="live-switch-camera"
              label="Switch camera"
              name="cameraSwitch"
              onClick={media.switchCamera}
            />
          </span>
        ) : null}
      </div>

      <div className="v-live__flow">
        {encounter === undefined ? null : (
          <Button
            busy={connect.busy}
            data-testid="live-connect"
            disabled={encounter.connection.state === 'connected'}
            icon="link"
            onClick={() => {
              connect.run(async () => {
                const result = await api.connectInLiveEncounter(encounter.id);
                setConnectError(
                  isOk(result) ? undefined : failureMessage(result),
                );
                // Re-read rather than patched from the response. Connect and
                // the other person's own Connect race constantly, and the
                // authoritative answer to "where does this now stand" is the
                // one read that carries the whole state — including the
                // conversation a mutual connection has just created.
                const current = await api.liveState();
                if (isOk(current)) onState(current.value);
              });
            }}
            /*
             * Quieter than Next, and louder only when it is the thing to
             * press. Next is the most frequent act in the product and should
             * be the heaviest control on the screen; Connect matters more and
             * happens far less, and two filled accent buttons side by side is
             * a screen with no hierarchy at all. It takes the accent in the
             * one state where the other person is waiting on it.
             */
            tone={
              encounter.connection.state === 'received'
                ? 'primary'
                : 'secondary'
            }
          >
            {connectionCopy[encounter.connection.state] ?? 'Connect'}
          </Button>
        )}

        {encounter === undefined ? (
          serverState === 'ended' || serverState === 'idle' ? (
            <Button
              busy={busy}
              data-testid="live-search-again"
              icon="live"
              onClick={onSearchAgain}
              size="lg"
              tone="primary"
            >
              Meet someone else
            </Button>
          ) : null
        ) : (
          <Button
            data-testid="live-next"
            icon="refresh"
            onClick={() => {
              onNext(encounter.id);
            }}
            size="lg"
            tone="primary"
          >
            Next
          </Button>
        )}
      </div>

      <div className="v-live__aside">
        {encounter === undefined ? null : (
          <>
            <div className="v-live__react">
              <IconButton
                aria-expanded={reacting}
                data-testid="live-react"
                label={reacting ? 'Hide reactions' : 'Send a reaction'}
                name="heart"
                onClick={() => {
                  setReacting(!reacting);
                }}
              />
              {reacting ? (
                <div className="v-live__reactions" data-testid="live-reactions">
                  {reactionOrder.map((reaction) => (
                    <button
                      className="v-live__reaction"
                      data-testid={`live-reaction-${reaction}`}
                      disabled={react.busy}
                      key={reaction}
                      onClick={() => {
                        // Shown at once, sent underneath. A reaction that
                        // waited for a round trip would arrive after the moment
                        // it was reacting to, and there is nothing to undo if
                        // the send fails — it is a wave, not a message.
                        onBurst(reaction, true);
                        setReacting(false);
                        react.run(async () => {
                          await api.sendLiveReaction({
                            clientMessageId: crypto.randomUUID(),
                            encounterId: encounter.id,
                            reaction,
                          });
                        });
                      }}
                      type="button"
                    >
                      <span aria-hidden="true">
                        {reactionGlyphs[reaction] ?? '·'}
                      </span>
                      <span className="v-visually-hidden">{reaction}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <span className="v-live__chat-toggle">
              <IconButton
                aria-expanded={chatOpen}
                data-testid="live-toggle-chat"
                label={chatOpen ? 'Hide the chat' : 'Show the chat'}
                name="message"
                onClick={onToggleChat}
              />
              {unread > 0 && !chatOpen ? (
                <span className="v-live__unread" data-testid="live-unread" />
              ) : null}
            </span>
          </>
        )}

        {/*
          Leaving is held apart from the things pressed every minute. It is
          obvious, it is never behind a menu, and it never sits flush against
          the control that sends a heart.
        */}
        <span className="v-live__exit">
          <Button
            data-testid="live-end"
            disabled={busy}
            icon="x"
            onClick={onLeave}
            size="sm"
            tone="ghost"
          >
            End
          </Button>
        </span>
      </div>

      {connectError === undefined ? null : (
        <ErrorMessage testId="live-connect-error">{connectError}</ErrorMessage>
      )}
    </div>
  );
}

/* ============================ Permissions ============================= */

/**
 * What to say when the browser has not given the devices over.
 *
 * Never a dead end. `denied` can be answered by asking again, and asking again
 * is what the control does; `unavailable` cannot be answered by anybody, so it
 * offers no control at all rather than one that would do nothing. Live
 * discovery keeps working either way — searching, chat, Connect, and Next do
 * not need a camera — and that is said rather than left to be discovered.
 */
function PermissionNotice({
  measure,
  media,
  message,
}: {
  /** Reports the layer's height, which the canvas above it has to clear. */
  readonly measure: (element: HTMLElement | null) => void;
  readonly media: LiveMediaState;
  readonly message: string | undefined;
}) {
  const permission =
    media.permission === 'granted' ||
    media.permission === 'requesting' ||
    media.permission === 'idle'
      ? undefined
      : media.permission;
  if (permission === undefined && message === undefined) return null;

  return (
    <div className="v-live__notice" ref={measure}>
      {message === undefined ? null : (
        <ErrorMessage testId="live-message">{message}</ErrorMessage>
      )}
      {permission === undefined ? null : permission === 'unavailable' ? (
        <Notice
          icon="cameraOff"
          testId="live-permission-unavailable"
          title="No camera on this device"
          tone="quiet"
        >
          <p>
            This browser has no camera or microphone available to it. You can
            still meet people and talk to them in the chat.
          </p>
        </Notice>
      ) : permission === 'failed' ? (
        <Notice
          icon="cameraOff"
          testId="live-permission-failed"
          title="Your camera could not be opened"
          tone="caution"
        >
          {/*
            Shorter than it was, and it says the same things. This sits over a
            live picture above the controls, and every line of it is a line of
            the conversation it is covering.
          */}
          <p>
            Another application is usually holding it. Closing that one and
            pressing Start again is the usual fix.
          </p>
          <p>
            Everything else works without it — you can still be matched, chat,
            and connect.
          </p>
        </Notice>
      ) : (
        <Notice
          icon="cameraOff"
          testId="live-permission-denied"
          title="VELORA does not have your camera"
          tone="caution"
        >
          <p>
            Allow it from the address bar, or from this site&rsquo;s settings if
            the browser has stopped asking.
          </p>
          <p>
            Everything else works without it — you can still be matched, chat,
            and connect.
          </p>
        </Notice>
      )}
    </div>
  );
}

/* =============================== Chat ================================= */

/**
 * The live chat, which is not the Inbox and says so.
 *
 * An overlay over the picture rather than a column beside it, because the
 * conversation is the video and this is something happening during it. What is
 * typed here belongs to this encounter: it is not a conversation, it does not
 * appear in Messages, and when the encounter ends it stops being reachable by
 * either person — which is the product rule the whole feature rests on. Saying
 * it on the panel is cheaper than somebody discovering it.
 *
 * Reactions arrive on the same channel and are deliberately not rendered here.
 * They are moments on the stage, and a transcript of who waved when is exactly
 * the kind of history this feature does not keep in front of people.
 */
function LiveChat({
  encounter,
  measure,
  onBurst,
  onClose,
  onState,
  onUnread,
  open,
}: {
  readonly encounter: LiveEncounter;
  /** Reports the sheet's height, so the preview above it can step over it. */
  readonly measure: (element: HTMLElement | null) => void;
  readonly onBurst: (reaction: string, self: boolean) => void;
  readonly onClose: () => void;
  readonly onState: (state: LiveState) => void;
  readonly onUnread: (count: number) => void;
  readonly open: boolean;
}) {
  const api = useApi();
  const [messages, setMessages] = useState<readonly LiveMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const send = useSingleFlight();
  const listRef = useRef<HTMLDivElement | null>(null);
  const encounterId = encounter.id;
  // What has already been shown, so a poll that returns the same reaction again
  // does not throw it back onto the stage every two seconds.
  const seen = useRef<Set<string>>(new Set());

  // A new encounter is a new conversation. Clearing on the identifier rather
  // than on a mount is what stops the last stranger's words appearing under the
  // next one's name — the component does not unmount between encounters,
  // because the camera must not blink.
  useEffect(() => {
    setMessages([]);
    setDraft('');
    setError(undefined);
    seen.current = new Set();
  }, [encounterId]);

  const absorb = useCallback(
    (incoming: readonly LiveMessage[]) => {
      const first = seen.current.size === 0;
      for (const entry of incoming) {
        if (seen.current.has(entry.id)) continue;
        seen.current.add(entry.id);
        // Nothing bursts on the first read of an encounter somebody has just
        // rejoined: those already happened, and replaying them would be the
        // surface inventing a moment.
        if (!first && entry.kind === 'reaction' && !entry.self) {
          onBurst(entry.body, false);
        }
      }
      setMessages(incoming.filter((entry) => entry.kind === 'text'));
    },
    [onBurst],
  );

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void api.liveMessages(encounterId).then((result) => {
        if (cancelled || !isOk(result)) return;
        // Guarded on the encounter the answer is *about*, not on the one that
        // was current when it was asked for. A reply that arrives after Next
        // has already moved somebody on describes a conversation they are no
        // longer in, and rendering it would put the previous stranger's
        // messages under the new one's name.
        if (result.value.encounterId !== encounterId) return;
        absorb(result.value.messages);
      });
    };
    read();
    const timer = setInterval(read, messagePollMilliseconds);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [absorb, api, encounterId]);

  const theirs = messages.filter((entry) => !entry.self).length;
  const read = useRef(0);
  useEffect(() => {
    if (open) {
      read.current = theirs;
      onUnread(0);
      return;
    }
    onUnread(Math.max(0, theirs - read.current));
  }, [onUnread, open, theirs]);

  useEffect(() => {
    const element = listRef.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, open]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (body.length === 0) return;
    send.run(async () => {
      const result = await api.sendLiveMessage({
        body,
        // Fresh per send and scoped to the encounter by the server, so a retry
        // after a dropped response writes one message rather than two.
        clientMessageId: crypto.randomUUID(),
        encounterId,
      });
      if (isOk(result)) {
        if (result.value.encounterId === encounterId) {
          absorb(result.value.messages);
        }
        setDraft('');
        setError(undefined);
        return;
      }
      // The draft is deliberately kept. Somebody who typed something and lost
      // it to a failed send has lost the thing they were trying to say.
      setError(failureMessage(result));
      const current = await api.liveState();
      if (isOk(current)) onState(current.value);
    });
  };

  return (
    <section
      className={`v-live__chat${open ? ' v-live__chat--open' : ''}`}
      data-testid="live-chat"
      hidden={!open}
      ref={measure}
    >
      <div className="v-live__chat-head">
        <p className="v-micro v-live__chat-title">
          <Icon name="message" size="sm" />
          {/* The panel is named, not the person: a rail is narrow and a long
              name here truncates the one word that says what this is. Who it is
              with is on the log itself, where a screen reader reads it. */}
          <span>Live chat</span>
        </p>
        <IconButton
          data-testid="live-chat-close"
          label="Hide the chat"
          name="x"
          onClick={onClose}
          size="sm"
        />
      </div>

      <div
        aria-label={`Live chat with ${encounter.peer.displayName}`}
        aria-live="polite"
        className="v-live__chat-list"
        data-testid="live-chat-list"
        ref={listRef}
        role="log"
      >
        {messages.length === 0 ? (
          <p className="v-caption v-live__chat-empty">Say something.</p>
        ) : (
          messages.map((entry) => (
            <p
              className={`v-live__bubble${entry.self ? ' v-live__bubble--self' : ''}`}
              data-testid={`live-message-${String(entry.sequence)}`}
              key={entry.id}
            >
              <span className="v-visually-hidden">
                {entry.self ? 'You said' : `${encounter.peer.displayName} said`}
              </span>
              {entry.body}
            </p>
          ))
        )}
      </div>

      <form className="v-live__composer" onSubmit={submit}>
        <label className="v-visually-hidden" htmlFor="live-chat-input">
          Message {encounter.peer.displayName}
        </label>
        <input
          autoComplete="off"
          className="v-control"
          data-testid="live-chat-input"
          id="live-chat-input"
          maxLength={4000}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder="Say something"
          value={draft}
        />
        {/*
          An icon rather than a word. The composer is the width of a rail on a
          laptop and of a phone on a phone, and a labelled pill there takes room
          the sentence being typed needs. The name is on the control either way.
        */}
        <IconButton
          data-testid="live-chat-send"
          disabled={send.busy}
          label="Send"
          name="send"
          type="submit"
        />
      </form>

      {error === undefined ? null : (
        <ErrorMessage testId="live-chat-error">{error}</ErrorMessage>
      )}

      {/*
        What this chat is, and is not — under the composer as one quiet line
        rather than a paragraph sitting over the conversation. It is the rule
        the whole feature rests on, and saying it here is cheaper than somebody
        discovering it.
      */}
      <p className="v-micro v-live__chat-note">
        <Icon name="clock" size="sm" />
        <span>
          Live chat only — it does not go to your Inbox unless you both connect.
        </span>
      </p>
    </section>
  );
}

/* ============================ Simulation ============================== */

/**
 * The local scenario panel.
 *
 * Rendered only where the server says a simulation adapter is configured, which
 * configuration refuses outside local and test — so this is absent in a
 * deployed environment rather than hidden in one. Each control drives a seeded
 * local account through the same published service methods a person's client
 * calls, which is why walking these proves the product rather than the panel.
 */
function SimulationPanel({
  onState,
}: {
  readonly onState: (state: LiveState) => void;
}) {
  const api = useApi();
  const run = useSingleFlight();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<string | undefined>(undefined);

  return (
    <section className="v-live__sim" data-testid="live-simulation">
      <button
        aria-expanded={open}
        className="v-live__sim-toggle v-label"
        data-testid="live-sim-toggle"
        onClick={() => {
          setOpen(!open);
        }}
        type="button"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size="sm" />
        Local scenarios
      </button>
      {open ? (
        <>
          <p className="v-caption v-quiet v-measure">
            This panel exists only in local development. Each of these acts as
            the other person, through the same endpoints their browser would
            call.
          </p>
          <div className="v-live__sim-actions">
            {scenarios.map((scenario) => (
              <Button
                data-testid={`live-sim-${scenario.value}`}
                disabled={run.busy}
                key={scenario.value}
                onClick={() => {
                  run.run(async () => {
                    const result = await api.applyLiveSimulation(
                      scenario.value,
                    );
                    setLast(
                      isOk(result)
                        ? result.value.applied
                          ? `${scenario.label}: applied`
                          : `${scenario.label}: nothing to apply`
                        : failureMessage(result),
                    );
                    const current = await api.liveState();
                    if (isOk(current)) onState(current.value);
                  });
                }}
                size="sm"
                title={scenario.help}
              >
                {scenario.label}
              </Button>
            ))}
          </div>
          {last === undefined ? null : (
            <StatusMessage testId="live-sim-status">{last}</StatusMessage>
          )}
        </>
      ) : null}
    </section>
  );
}

/* ============================== Helpers =============================== */

/**
 * Holds a brief reveal when a new encounter arrives.
 *
 * A transition, never a progress bar. It measures nothing about the session
 * becoming ready — that state is read from the server and rendered separately —
 * and it exists so that a match arrives rather than appears. Somebody who has
 * asked for reduced motion gets no hold at all, because the point of it is the
 * movement.
 */
function useReveal(encounterId: string | undefined): boolean {
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (encounterId === undefined) return undefined;
    if (prefersReducedMotion()) {
      setRevealed(encounterId);
      return undefined;
    }
    const timer = setTimeout(() => {
      setRevealed(encounterId);
    }, revealMilliseconds);
    return () => {
      clearTimeout(timer);
    };
  }, [encounterId]);
  return encounterId !== undefined && revealed !== encounterId;
}

/**
 * How tall something on the stage actually is.
 *
 * Everything anchored above the dock and above the phone chat sheet has to
 * clear them, and both change height with the text size, with the safe area,
 * and with what is inside them — the dock grows a second row at twice the text,
 * and the sheet grows as the conversation does. A constant here is a constant
 * that is wrong at somebody's text size, which is what a browser showed the
 * first time: the preview sat on top of the controls.
 *
 * Returns a callback ref rather than an object ref, so the measurement starts
 * the moment the element exists rather than after an effect that has to depend
 * on it. `ResizeObserver` is absent in a test renderer and in an old browser;
 * the first measurement is taken directly either way, so the layout is right
 * from the first paint and merely stops following later changes.
 */
function useMeasuredBlock(): [(element: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | undefined>(undefined);

  const attach = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = undefined;
    if (element === null) {
      setHeight(0);
      return;
    }
    // The border box, not the content box: the dock's own padding is part of
    // what anything above it has to clear.
    const read = () => {
      setHeight((current) => {
        const measured = Math.round(element.getBoundingClientRect().height);
        // Rounded, and only written when it actually moved. A state write per
        // sub-pixel reflow is how a resize observer ends up feeding itself.
        return measured === current ? current : measured;
      });
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(read);
    watcher.observe(element);
    observer.current = watcher;
  }, []);

  useEffect(
    () => () => {
      observer.current?.disconnect();
    },
    [],
  );

  return [attach, height];
}

/** How long, in milliseconds, since an instant the server reported. */
function useElapsed(since: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const started = useMemo(
    () => (since === undefined ? undefined : Date.parse(since)),
    [since],
  );
  if (started === undefined || Number.isNaN(started)) return 0;
  return Math.max(0, now - started);
}

/**
 * Where somebody is and what the two of you share, in one line.
 *
 * Only what the other person published about themselves, and only the language
 * overlap rather than everything they speak — the same narrowing the server
 * applies, said the same way. An empty answer renders nothing rather than an
 * apologetic sentence about missing data.
 */
function contextLine(
  region: string | undefined,
  sharedLanguages: readonly string[],
): string {
  const parts: string[] = [];
  if (region !== undefined) parts.push(regionName(region));
  // Read defensively rather than trusted, even though the contract makes it
  // required. This runs on every render of every encounter, and a helper that
  // throws takes the whole stage down mid-conversation — which is a far worse
  // failure than a line of context being briefly absent.
  const languages = sharedLanguages as readonly string[] | undefined;
  if (languages !== undefined && languages.length > 0) {
    parts.push(languages.map(languageName).join(', '));
  }
  return parts.join(' · ');
}

/**
 * A region code as a place name, where the browser can say one.
 *
 * `Intl.DisplayNames` is asked for and its absence is answered with the code,
 * which is what a runtime without it — Hermes, notably — actually has. A
 * two-letter code is a worse answer than a name and a much better one than a
 * crash.
 */
function regionName(code: string): string {
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'language' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

function invitationCopy(invitation: LiveInvitation): string {
  if (invitation.direction === 'incoming') {
    return invitation.state === 'pending'
      ? 'Would like to meet you live'
      : 'You said yes. You will be matched first once you are both here.';
  }
  return invitation.state === 'pending'
    ? 'Asked. They have not answered yet.'
    : 'They said yes. You will be matched first once you are both here.';
}

/**
 * Whether a media query holds, in a way that survives not being in a browser.
 *
 * Server rendering has no `window`, and a test renderer has a `window` with no
 * `matchMedia` at all — both answer "no" rather than throwing, because every
 * caller here is asking about a nicety and the honest default for a nicety is
 * off.
 */
function matches(query: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Whether the window is wide enough for the chat to sit beside the picture. */
function widescreen(): boolean {
  return matches('(min-width: 1024px)');
}

function prefersReducedMotion(): boolean {
  return matches('(prefers-reduced-motion: reduce)');
}

/*
 * Two per-viewer conveniences, and deliberately nothing more.
 *
 * Whether somebody has been here before decides whether the door explains
 * itself; the preferences they last chose decide what the controls start on.
 * Both are this browser's own business, neither is a fact about the account,
 * and neither is worth a round trip — so they live here rather than becoming
 * server state somebody would then have to be able to correct. Every access is
 * guarded: a private window, a browser with site data blocked, and a thumbnail
 * capture all throw on the accessor itself.
 */
const visitKey = 'velora.live.visited';
const preferencesKey = 'velora.live.preferences';

function hasVisited(): boolean {
  try {
    return window.localStorage.getItem(visitKey) === 'yes';
  } catch {
    return false;
  }
}

function rememberVisit(): void {
  try {
    window.localStorage.setItem(visitKey, 'yes');
  } catch {
    // A browser that will not remember is a browser that explains itself twice.
  }
}

function rememberedPreferences(): LivePreferences | undefined {
  try {
    const raw = window.localStorage.getItem(preferencesKey);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const region = record.region === 'same' ? 'same' : 'any';
    const language =
      typeof record.language === 'string' ? record.language : undefined;
    return language === undefined ? { region } : { language, region };
  } catch {
    return undefined;
  }
}

function rememberPreferences(preferences: LivePreferences): void {
  try {
    window.localStorage.setItem(preferencesKey, JSON.stringify(preferences));
  } catch {
    // Not remembering a preference is a smaller failure than refusing to set it.
  }
}
