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
import { CameraView } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { Icon } from '../design/icons';
import {
  Avatar,
  BlockedState,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorMessage,
  IconButton,
  Inline,
  Notice,
  Segmented,
  Stack,
  Text,
} from '../design/primitives';
import { portraitReferences, useMediaAddresses } from './imagery';
import {
  color,
  layout,
  radius,
  space,
  text as textScale,
} from '../design/tokens';
import { useApi } from '../frame/providers';
import { mintUuid } from '../device/installation';
import { useLiveMedia, type LiveMediaState } from './live-media';
import {
  describeSelection,
  PremiumPreference,
  useWallet,
  type WalletView,
} from './live-premium';
import { VideoTrack } from './live-rtc';
import { useLiveTransport, type LiveTransport } from './live-transport';
import { useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Live discovery, on a phone.
 *
 * The screen a person opens the application for, and the one arranged most
 * carefully around a thumb. It is built as a camera product rather than as a
 * responsive layout: one full-bleed canvas, everything else floating over it,
 * and nothing that scrolls while a conversation is happening.
 *
 * Six rules shape it, and they are the same six the web surface follows because
 * it is one product.
 *
 * **The camera is the screen.** Once somebody has asked for it, their own view
 * fills the canvas while there is nobody to look at, and becomes a movable
 * picture-in-picture the moment there is. Nothing here is a card in a column.
 *
 * **Nothing opens a camera except a person asking for it.** Landing on the tab
 * shows a door. The permission is asked for when somebody presses a control
 * that says what pressing it will do, and the preview unmounts — releasing the
 * device — the moment the application leaves the foreground.
 *
 * **Two state machines, kept apart.** The server owns where a person is; this
 * owns where their camera is. Merging them would mean a client asserting a fact
 * about itself that the server would then be storing.
 *
 * **The screen says what is true.** No count of who is online, because no
 * presence projection exists behind this product. No remote video pane, because
 * no approved provider carries media — the canvas says so in words instead of
 * being a black rectangle that implies a connection. No microphone is asked
 * for, because nothing on this platform carries audio and asking for a
 * permission the product cannot use would be asking under false pretences.
 *
 * **Next and End are always under a thumb.** They sit in a fixed dock above the
 * tab bar, inside the safe area, and nothing that grows — a chat, a long name,
 * a permission notice — can push them off the screen. Next acknowledges before
 * the server answers, so nobody watches a frozen stranger while teardown
 * completes.
 *
 * **The system's own gestures keep working.** The hardware Back closes the chat
 * sheet before it leaves the screen, which is what a person expects from a
 * sheet, and nothing here captures a gesture the platform owns.
 */

/** How often the surface re-reads while it is waiting for somebody. */
const searchPollMilliseconds = 2000;
/** How often it re-reads while in an encounter. Also how presence is kept. */
const encounterPollMilliseconds = 3000;
/** How often the live chat re-reads. Faster: it is a conversation. */
const messagePollMilliseconds = 2000;
/** How long the reveal holds before an encounter is shown as live. */
const revealMilliseconds = 900;
/** How long a reaction stays on the canvas. */
const reactionMilliseconds = 2600;
/** How long a narrowed search waits before being offered a wider one. */
const broadenPromptMilliseconds = 20_000;

/** Where the person is, which is not where the server is. */
type Stage = 'closed' | 'open';

/** Which way of meeting somebody the door is offering. */
type Mode = 'instant' | 'choose';

/**
 * Whether the door has already explained itself in this app session.
 *
 * Module state rather than storage, deliberately. The honest alternative is a
 * new persistence dependency for one boolean about a nicety, and this build
 * pins its Expo tree carefully enough that adding one to shorten a screen would
 * be the wrong trade. A person who launches the application fresh is explained
 * to once; every return to the tab after that is the fast door.
 */
let explained = false;

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
  left: { body: 'You moved on.', title: 'You ended that conversation' },
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
 * The words change and the fact does not. None of them implies a queue, a
 * position, a number of people, or an estimate, because none of those exists
 * behind this screen.
 */
const searchingLines: readonly string[] = [
  'Looking for someone…',
  'Still looking…',
  'Nobody yet — holding your place…',
];

/**
 * The six reactions, and the glyph each is drawn as.
 *
 * Emoji rather than icons: they are drawn by the system, they are already
 * legible everywhere, and adding six glyphs to the shared icon set would bind
 * both surfaces to them through the design-parity gate for no benefit.
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

const scenarios: readonly {
  readonly label: string;
  readonly value: LiveSimulationScenario;
}[] = [
  { label: 'They say something', value: 'peer_message' },
  { label: 'They react', value: 'peer_reaction' },
  { label: 'They press Connect', value: 'peer_connect' },
  { label: 'They move on', value: 'peer_next' },
  { label: 'They disappear', value: 'peer_disconnect' },
  { label: 'They ask to meet', value: 'peer_invitation' },
  { label: 'They accept your ask', value: 'peer_accepts_invitation' },
  { label: 'Nobody is available', value: 'nobody_available' },
];

export function LiveScreen({
  onOpenConversation,
  onOpenPerson,
}: {
  /** Continuing in the Inbox after a mutual connection. The route owns the router. */
  readonly onOpenConversation: (conversationId: string) => void;
  readonly onOpenPerson: (personId: string) => void;
}) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('closed');
  const [mode, setMode] = useState<Mode>('instant');
  const [medium, setMedium] = useState<LiveMedium>('video');
  const [preferences, setPreferences] = useState<LivePreferences>({
    region: 'any',
  });
  const [state, setState] = useState<LiveState | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const action = useSingleFlight();

  const apply = useCallback((result: ApiResult<LiveState>) => {
    if (isOk(result)) {
      setState(result.value);
      setMessage(undefined);
      return;
    }
    setMessage(failureMessage(result));
  }, []);

  useEffect(() => {
    void api.liveState().then(apply);
  }, [api, apply]);

  const serverState = state?.state ?? 'idle';
  const encounter = state?.encounter;

  /*
   * Whether a provider has the devices for this encounter.
   *
   * Derived from the server's own answer rather than from the transport hook,
   * which is what breaks the circle: the preview needs to know it must yield,
   * the transport needs to know what the person has muted, and if each read the
   * other neither could be declared first. This is the same fact both of them
   * are asking about, so it is computed once, from the encounter, before
   * either.
   */
  const carried = encounter?.call?.mediaTransport === 'provider';
  const media = useLiveMedia({
    enabled: stage === 'open',
    yielded: carried,
  });
  /*
   * Coins, read once at this level and shared by every control that renders
   * them. Two controls holding independent balances is how a person is shown a
   * number they cannot spend.
   */
  const wallet = useWallet();
  const transport = useLiveTransport({
    api,
    callId: encounter?.call?.id,
    cameraOn: media.cameraOn,
    // The same facing the preview uses, so one control means one thing whether
    // the preview or the provider is holding the camera.
    facing: media.facing,
    mediaTransport: encounter?.call?.mediaTransport,
    microphoneGranted: media.microphoneAvailable,
    microphoneOn: media.microphoneOn,
  });

  // Somebody the server already has in an encounter — a resumed app, a second
  // device — is put back into the room rather than at the door.
  useEffect(() => {
    if (serverState === 'matched' && stage === 'closed') setStage('open');
  }, [serverState, stage]);

  /**
   * One poller, and what it asks depends on where the server says the person is.
   *
   * While searching it asks to *keep* searching, which is idempotent and is what
   * actually allocates somebody. Everywhere else it reads, which is also how
   * presence is expressed: there is no gateway, so a client that is reading is
   * present and one that has stopped is gone.
   */
  useEffect(() => {
    if (stage === 'closed' || serverState === 'idle') return undefined;
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
        if (isOk(result)) setState(result.value);
      });
    }, interval);
    return () => {
      clearInterval(timer);
    };
  }, [api, medium, preferences, serverState, stage]);

  const start = (chosen: LiveMedium) => {
    setMedium(chosen);
    setStage('open');
    explained = true;
    // The permission is asked for as part of starting, so the system prompt
    // arrives with the screen that explains why — and deliberately *beside*
    // the search rather than in front of it. A prompt somebody leaves
    // unanswered must not stop them being matched: the pool does not care
    // whether a camera is open, and everything but the preview works without
    // one.
    if (chosen === 'video') void media.request();
    action.run(async () => {
      apply(await api.startLiveSearch(chosen, preferences));
    });
  };

  const changePreferences = (wanted: LivePreferences) => {
    setPreferences(wanted);
    // Applied on the next attempt, which is this one when a search is already
    // running: somebody who just widened their net is watching for it to.
    if (serverState === 'searching') {
      action.run(async () => {
        apply(await api.startLiveSearch(medium, wanted));
      });
    }
  };

  const leave = () => {
    action.run(async () => {
      const result = await api.leaveLiveDiscovery();
      setStage('closed');
      apply(result);
    });
  };

  if (state?.admission === 'unavailable') {
    return (
      <BlockedState
        body="VELORA can put two people who are both here into a live session, but nothing in this build is approved to carry the audio and video — no RTC provider is eligible, and how long a live session may be kept, where it may be offered, and who is on call for it are all undecided."
        testID="live-unavailable"
        title="Live is not switched on"
      />
    );
  }

  if (state?.admission === 'not_eligible') {
    return (
      <EmptyState
        body="Live discovery needs a finished account in good standing. Once that is done this is the first thing here."
        icon="live"
        testID="live-not-eligible"
        title="Not quite yet"
      />
    );
  }

  if (stage === 'closed') {
    return (
      <LiveDoor
        busy={action.busy}
        insetTop={insets.top}
        invitations={state?.invitations ?? []}
        languageOptions={state?.languageOptions ?? []}
        message={message}
        mode={mode}
        onModeChange={setMode}
        onPreferences={changePreferences}
        onStart={start}
        onState={setState}
        preferences={preferences}
        simulated={state?.simulated === true}
        wallet={wallet}
      />
    );
  }

  return (
    <LiveStage
      busy={action.busy}
      encounter={encounter}
      insets={{ bottom: insets.bottom, top: insets.top }}
      languageOptions={state?.languageOptions ?? []}
      media={media}
      medium={medium}
      message={message}
      onLeave={leave}
      onNext={(encounterId) => {
        action.run(async () => {
          apply(await api.advanceLiveEncounter(encounterId));
        });
      }}
      onOpenConversation={onOpenConversation}
      onOpenPerson={onOpenPerson}
      onPreferences={changePreferences}
      onSearchAgain={() => {
        action.run(async () => {
          apply(await api.startLiveSearch(medium, preferences));
        });
      }}
      onState={setState}
      preferences={preferences}
      searchingSince={state?.searchingSince}
      serverState={serverState}
      simulated={state?.simulated === true}
      transport={transport}
      wallet={wallet}
    />
  );
}

/* ================================ Door ================================ */

/**
 * The door.
 *
 * One thing to press, and it is the largest thing on the screen. The
 * explanation appears once per launch and then folds away, because somebody who
 * has already met people here does not need to be told again — and coming back
 * quickly is most of what makes random discovery worth opening.
 *
 * Two ways in rather than one, because agreeing to be heard is not agreeing to
 * be seen, and a single control carrying whichever was chosen last would make
 * the more exposing option the default for somebody who never chose it.
 */
function LiveDoor({
  busy,
  insetTop,
  invitations,
  languageOptions,
  message,
  mode,
  onModeChange,
  onPreferences,
  onStart,
  onState,
  preferences,
  simulated,
  wallet,
}: {
  readonly busy: boolean;
  readonly insetTop: number;
  readonly invitations: readonly LiveInvitation[];
  readonly languageOptions: readonly string[];
  readonly message: string | undefined;
  readonly mode: Mode;
  readonly onModeChange: (mode: Mode) => void;
  readonly onPreferences: (preferences: LivePreferences) => void;
  readonly onStart: (medium: LiveMedium) => void;
  readonly onState: (state: LiveState) => void;
  readonly preferences: LivePreferences;
  readonly simulated: boolean;
  readonly wallet: WalletView;
}) {
  const waiting = invitations.filter(
    (invitation) =>
      invitation.direction === 'incoming' && invitation.state === 'pending',
  );

  return (
    <ScrollView
      contentContainerStyle={[
        styles.door,
        mode === 'choose' ? styles.doorChoosing : null,
        { paddingTop: insetTop + space[4] },
      ]}
      testID="live-door"
      // Scrollable so the door survives 200 % text, where the explanation and
      // both controls are taller than a phone.
    >
      {/*
        The one decorative gesture on the screen, and it is light on purpose: an
        ember bloom off the top says something happens here without becoming the
        neon this product is explicitly not.
      */}
      <DoorGlow />

      <Segmented<Mode>
        onChange={onModeChange}
        options={[
          { label: 'Instant', value: 'instant' },
          {
            // The count rides in the label: this platform's segmented control
            // has no badge slot, and inventing one for a number that is
            // usually absent would be a component change for one screen.
            label:
              waiting.length === 0
                ? 'Choose'
                : `Choose (${String(waiting.length)})`,
            value: 'choose',
          },
        ]}
        testID="live-mode"
        value={mode}
      />

      {mode === 'instant' ? (
        <>
          <View style={styles.doorHero}>
            <View style={styles.doorMark}>
              <Icon color={color.ember} name="live" size="lg" />
            </View>
            <Text variant="display" weight="bold">
              Meet someone
            </Text>
            {explained ? null : (
              <Text style={styles.centred} tone="secondary" variant="body">
                One other person who is here right now. Talk for as long as it
                is good, and move on whenever you like.
              </Text>
            )}
          </View>

          {/*
            One dominant control and one quiet one, stacked rather than side by
            side. Two pills of the same size is a door with no answer to "what
            do I press" — and agreeing to be heard is still not agreeing to be
            seen, so the quieter way in stays a control of its own rather than a
            setting on this one.
          */}
          <Stack gap={2}>
            <Button
              busy={busy}
              icon="video"
              onPress={() => {
                onStart('video');
              }}
              size="large"
              testID="live-start-video"
              tone="primary"
              wide
            >
              Start
            </Button>
            <Button
              disabled={busy}
              icon="phone"
              onPress={() => {
                onStart('voice');
              }}
              size="small"
              testID="live-start-voice"
              tone="ghost"
              wide
            >
              Voice only
            </Button>
          </Stack>

          <PreferenceControls
            languageOptions={languageOptions}
            onChange={onPreferences}
            preferences={preferences}
            wallet={wallet}
          />

          {/*
            What happens here, said once and shortly. As three long sentences it
            read as documentation, which is the one thing a live-social door must
            not be. It appears on the first launch and never again.
          */}
          {explained ? null : (
            <Stack gap={3}>
              <Inline gap={3}>
                <Icon color={color.ember} name="camera" size="sm" />
                <Text style={styles.step} tone="secondary" variant="small">
                  Your camera opens when you press Start.
                </Text>
              </Inline>
              <Inline gap={3}>
                <Icon color={color.ember} name="live" size="sm" />
                <Text style={styles.step} tone="secondary" variant="small">
                  VELORA finds somebody. You never choose who.
                </Text>
              </Inline>
              <Inline gap={3}>
                <Icon color={color.ember} name="link" size="sm" />
                <Text style={styles.step} tone="secondary" variant="small">
                  Connect counts only if you both press it.
                </Text>
              </Inline>
            </Stack>
          )}

          <Text style={styles.centred} tone="tertiary" variant="caption">
            Nothing is recorded. VELORA stores no video, no audio, and no
            transcript of a live session, and no setting turns that on.
          </Text>
        </>
      ) : (
        <ChoosePanel invitations={invitations} onState={onState} />
      )}

      {message === undefined ? null : (
        <ErrorMessage testID="live-message">{message}</ErrorMessage>
      )}

      {simulated ? <SimulationPanel onApplied={onState} /> : null}
    </ScrollView>
  );
}

/**
 * How wide a net to cast.
 *
 * Two controls and no more, both drawn from what this person already told
 * VELORA about themselves. Nothing is inferred, and there is no percentage,
 * score, or compatibility claim anywhere near them — none of those exists and a
 * number here would be one this screen invented.
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
   * The paid narrowing sits under the free ones rather than beside them: the
   * two above cost nothing and are a preference somebody holds about
   * themselves, and the one below is a bounded purchase. A row of equal chips
   * would make the cheapest of them look like the odd one out.
   */
  readonly wallet: WalletView;
}) {
  const languages = ['', ...languageOptions];
  const current = preferences.language ?? '';
  return (
    <View style={styles.prefs} testID="live-preferences">
      <Pressable
        accessibilityLabel={
          preferences.region === 'same'
            ? 'Meeting people near you. Tap to look anywhere.'
            : 'Meeting people anywhere. Tap to prefer people near you.'
        }
        accessibilityRole="button"
        accessibilityState={{ selected: preferences.region === 'same' }}
        onPress={() => {
          onChange({
            ...preferences,
            region: preferences.region === 'same' ? 'any' : 'same',
          });
        }}
        style={[
          styles.pref,
          preferences.region === 'same' ? styles.prefOn : null,
        ]}
        testID="live-pref-region"
      >
        <Icon
          color={
            preferences.region === 'same' ? color.ember : color.textSecondary
          }
          name="globe"
          size="sm"
        />
        <Text
          tone={preferences.region === 'same' ? 'primary' : 'secondary'}
          variant="caption"
        >
          {preferences.region === 'same' ? 'Near me' : 'Anywhere'}
        </Text>
      </Pressable>

      {languageOptions.length === 0 ? null : (
        <Pressable
          accessibilityLabel="Preferred language"
          accessibilityRole="button"
          onPress={() => {
            // A phone has no select, and a modal for two or three values would
            // be a dialog for a chip. Tapping steps through the caller's own
            // languages and back to "any", which is the whole range.
            const next =
              languages[(languages.indexOf(current) + 1) % languages.length] ??
              '';
            onChange(
              next === ''
                ? { region: preferences.region }
                : { language: next, region: preferences.region },
            );
          }}
          style={[styles.pref, current === '' ? null : styles.prefOn]}
          testID="live-pref-language"
        >
          <Icon
            color={current === '' ? color.textSecondary : color.ember}
            name="languages"
            size="sm"
          />
          <Text
            tone={current === '' ? 'secondary' : 'primary'}
            variant="caption"
          >
            {current === '' ? 'Any language' : languageName(current)}
          </Text>
        </Pressable>
      )}

      <PremiumPreference languageOptions={languageOptions} wallet={wallet} />
    </View>
  );
}

/* =============================== Choose =============================== */

/**
 * Choosing somebody instead of being given somebody.
 *
 * Real VELORA profiles, from the discovery feed this product already has, in
 * the shape Discover already publishes them. There is no second profile store
 * and no second ranking: the same people, asked a different question.
 *
 * Nothing on a row says "online". Availability is not published by the feed and
 * this screen has no way to prove it, so a badge claiming it would be invented.
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
  const [asked, setAsked] = useState<readonly string[]>([]);
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

  const outstanding = invitations
    .filter((invitation) => invitation.direction === 'outgoing')
    .map((invitation) => invitation.person.id);

  // One exchange for the whole list. Each card draws its identity mark first
  // and takes the photograph when it arrives, so nothing on screen waits.
  const portraits = useMediaAddresses(
    portraitReferences(candidates ?? []),
    'display',
  );

  return (
    <Stack gap={4}>
      <InvitationList invitations={invitations} onState={onState} />

      <Text tone="tertiary" variant="caption">
        Ask somebody to meet live. They are told you asked and nothing else; a
        live session happens only if they say yes and you are both here.
      </Text>

      {error === undefined ? null : (
        <ErrorMessage testID="live-choose-error">{error}</ErrorMessage>
      )}

      {candidates === undefined ? (
        <Text tone="tertiary" variant="caption">
          Loading people…
        </Text>
      ) : candidates.length === 0 ? (
        <Card testID="live-choose-empty">
          <Stack gap={3}>
            <Icon color={color.textTertiary} name="compass" size="lg" />
            <Text tone="secondary" variant="small">
              Nobody to show right now. Instant still works — VELORA looks
              across everybody who is here rather than only the people it can
              show you.
            </Text>
          </Stack>
        </Card>
      ) : (
        /*
          The same people Discover publishes, drawn the way Discover draws them:
          the photograph somebody chose, their name, where they are and what the
          two of you share, and what they wrote about themselves. A row with a
          monogram in it was a contact list; this is a surface somebody browses.

          Nothing says "online". Availability is not published by the feed and
          this screen cannot prove it, so a badge claiming it would be one this
          screen invented — and there is no score or compatibility claim near it
          for the same reason.
        */
        candidates.map((candidate) => {
          const pending =
            outstanding.includes(candidate.id) || asked.includes(candidate.id);
          const region = regionName(candidate.region ?? '');
          return (
            <Card key={candidate.id} testID={`live-candidate-${candidate.id}`}>
              <Stack gap={4}>
                <View style={styles.person}>
                  <Avatar
                    displayName={candidate.displayName}
                    seed={candidate.id}
                    size="large"
                    source={portraits.get(candidate.media[0]?.id ?? '')}
                    testID={`live-portrait-${candidate.id}`}
                  />
                  <View style={styles.personBody}>
                    <Text numberOfLines={2} variant="heading" weight="semibold">
                      {candidate.displayName}
                    </Text>
                    <Inline gap={2} wrap>
                      {candidate.region === undefined ? null : (
                        <Chip>{region}</Chip>
                      )}
                      {candidate.sharedLanguages.length === 0 ? null : (
                        <Chip>
                          {candidate.sharedLanguages
                            .map(languageName)
                            .join(', ')}
                        </Chip>
                      )}
                    </Inline>
                  </View>
                </View>

                {candidate.bio === undefined ? null : (
                  <Text numberOfLines={3} tone="secondary" variant="small">
                    {candidate.bio}
                  </Text>
                )}

                <Button
                  disabled={pending || ask.busy}
                  icon={pending ? 'check' : 'live'}
                  onPress={() => {
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
                      setAsked([...asked, candidate.id]);
                      const current = await api.liveState();
                      if (isOk(current)) onState(current.value);
                    });
                  }}
                  testID={`live-ask-${candidate.id}`}
                  wide
                >
                  {pending ? 'Asked' : 'Ask to meet'}
                </Button>
              </Stack>
            </Card>
          );
        })
      )}
    </Stack>
  );
}

/**
 * Requests to meet, in both directions.
 *
 * The states are the server's own and the words are the truthful reading of
 * each. `accepted` says what it means: two people have agreed and are not both
 * here yet, so the next time they both search they are each other's first
 * match. Saying "connecting" there would be a promise nothing can keep.
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
    <Stack gap={2}>
      {invitations.map((invitation) => (
        <View key={invitation.id} style={styles.person}>
          <Avatar
            displayName={invitation.person.displayName}
            seed={invitation.person.id}
            size="small"
          />
          <View style={styles.personBody}>
            <Text numberOfLines={1} variant="small">
              {invitation.person.displayName}
            </Text>
            <Text tone="tertiary" variant="caption">
              {invitationCopy(invitation)}
            </Text>
          </View>
          {invitation.direction === 'incoming' &&
          invitation.state === 'pending' ? (
            <Inline gap={2}>
              <Button
                disabled={respond.busy}
                onPress={() => {
                  answer(invitation.id, 'accept');
                }}
                size="small"
                testID={`live-invitation-accept-${invitation.id}`}
                tone="primary"
              >
                Yes
              </Button>
              <Button
                disabled={respond.busy}
                onPress={() => {
                  answer(invitation.id, 'decline');
                }}
                size="small"
                testID={`live-invitation-decline-${invitation.id}`}
              >
                No
              </Button>
            </Inline>
          ) : invitation.direction === 'outgoing' ? (
            <Button
              disabled={respond.busy}
              onPress={() => {
                answer(invitation.id, 'cancel');
              }}
              size="small"
              testID={`live-invitation-cancel-${invitation.id}`}
            >
              Withdraw
            </Button>
          ) : null}
        </View>
      ))}
    </Stack>
  );
}

/* =============================== Stage ================================ */

interface Burst {
  readonly id: string;
  readonly reaction: string;
  readonly self: boolean;
}

/**
 * The stage: one canvas, everything else over it.
 *
 * Absolute layers rather than a scrolling column, because a conversation that
 * scrolls is a document. What changes between the server's states is what the
 * canvas is *of*: this person's own picture while nobody has been found, the
 * other person the moment somebody has.
 */
function LiveStage({
  busy,
  encounter,
  insets,
  languageOptions,
  media,
  medium,
  message,
  onLeave,
  onNext,
  onOpenConversation,
  onOpenPerson,
  onPreferences,
  onSearchAgain,
  onState,
  preferences,
  searchingSince,
  serverState,
  simulated,
  transport,
  wallet,
}: {
  readonly busy: boolean;
  readonly encounter: LiveEncounter | undefined;
  readonly insets: { readonly bottom: number; readonly top: number };
  readonly languageOptions: readonly string[];
  readonly media: LiveMediaState;
  readonly medium: LiveMedium;
  readonly message: string | undefined;
  readonly onLeave: () => void;
  readonly onNext: (encounterId: string) => void;
  readonly onOpenConversation: (conversationId: string) => void;
  readonly onOpenPerson: (personId: string) => void;
  readonly onPreferences: (preferences: LivePreferences) => void;
  readonly onSearchAgain: () => void;
  readonly onState: (state: LiveState) => void;
  readonly preferences: LivePreferences;
  readonly searchingSince: string | undefined;
  readonly serverState: LiveState['state'];
  readonly simulated: boolean;
  /** What a provider is actually carrying, if anything. Never a guess. */
  readonly transport: LiveTransport;
  readonly wallet: WalletView;
}) {
  const live = serverState === 'matched' && encounter !== undefined;
  const encounterId = encounter?.id;
  const revealing = useReveal(live ? encounterId : undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [bursts, setBursts] = useState<readonly Burst[]>([]);
  const [celebrated, setCelebrated] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  /*
   * How tall the dock actually is, measured rather than guessed.
   *
   * Everything anchored above it — the preview, the chat sheet, a notice, the
   * connection moment — has to clear it, and the dock's height changes with the
   * text size, the safe area, and whether a reaction row is open. A constant
   * here is a constant that is wrong on somebody's phone, which is exactly what
   * a device showed: the preview sat on top of the controls.
   */
  const [dockHeight, setDockHeight] = useState(0);
  /*
   * And how tall the chat sheet is, for the same reason.
   *
   * The sheet takes the bottom of the screen, which is where the preview also
   * lives. A device showed the two on top of each other; measuring the sheet is
   * what lets the preview step over it rather than a guess that is wrong at
   * every text size but one.
   */
  const [chatHeight, setChatHeight] = useState(0);
  const aboveDock = dockHeight + space[3];
  /*
   * How much of this screen the keyboard is standing on, measured rather than
   * assumed.
   *
   * The manifest asks for `adjustResize` and Android 15 stopped honouring it:
   * an edge-to-edge window is not resized for the keyboard, it is handed an
   * inset it has to deal with itself. On a device that meant the composer —
   * the one control the keyboard exists to serve — was underneath it, with
   * nothing on screen to say what was being typed.
   *
   * Measuring the stage in the window rather than trusting the keyboard's own
   * height is what makes this correct either way: where a window *is* resized
   * the stage already ends above the keyboard and the overlap is zero, and
   * where it is not the overlap is exactly the part that is covered.
   */
  const stage = useRef<View>(null);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const top = event.endCoordinates.screenY;
      stage.current?.measureInWindow((_x, y, _width, height) => {
        setKeyboardOverlap(Math.max(0, y + height - top));
      });
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardOverlap(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  /*
   * Where the sheet's own bottom edge is. With the keyboard up it sits on the
   * keyboard rather than on the dock: the dock is behind the keyboard at that
   * point, and leaving a dock-sized gap between the two would be reserving room
   * for something nobody can see.
   */
  const sheetFloor =
    keyboardOverlap > 0 ? keyboardOverlap + space[2] : aboveDock;
  /*
   * How far up the picture-in-picture has been pushed by an open chat sheet.
   *
   * The canvas reserves this as well as the preview's own height, because the
   * preview moving up without the words moving up is the same overlap in a new
   * place — which is what a device showed the first time the sheet opened.
   */
  const previewLift =
    chatOpen && live ? sheetFloor - aboveDock + chatHeight + space[2] : 0;

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
  const showing = live && !movingOn;
  const ending =
    serverState === 'ended' && encounter !== undefined && !movingOn;
  const aboutSomebody = showing || ending;

  const canvasCeiling = insets.top + space[12];
  const canvasFloor =
    (aboutSomebody ? previewHeight + space[4] + previewLift : 0) + aboveDock;
  /*
   * Whether there is room on this screen for everything the canvas can say.
   *
   * Measured rather than decided by a device name or a breakpoint: what is left
   * between the strip and the dock depends on the safe area, on the text size,
   * on whether a sheet is open, and on how tall the phone is. On a 360 × 640
   * device the bio and the account of the transport did not fit, and a canvas
   * that centres content taller than itself pushes half of it off both ends —
   * which is what a compact phone showed, with the top of somebody's portrait
   * cut off by the status bar.
   *
   * What is dropped when there is not room is the bio and the transport
   * sentence, in that order of usefulness: who this is stays, and both are back
   * the moment there is room for them.
   */
  const [canvasHeight, setCanvasHeight] = useState(0);
  const canvasRoom = canvasHeight - canvasCeiling - canvasFloor;
  const cramped = canvasHeight > 0 && canvasRoom < 340;

  useEffect(() => {
    setUnread(0);
    setBursts([]);
    setCelebrated(false);
    setChatOpen(false);
  }, [encounterId]);

  /*
   * The hardware Back closes the sheet before it leaves the screen.
   *
   * A sheet that ignored Back would be a sheet a person had to find a control
   * to close, on the one platform where Back is the control for exactly that.
   * Returning `false` when nothing is open leaves the navigator's own behaviour
   * untouched.
   */
  useEffect(() => {
    if (!chatOpen) return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setChatOpen(false);
        return true;
      },
    );
    return () => {
      subscription.remove();
    };
  }, [chatOpen]);

  const showBurst = useCallback((reaction: string, self: boolean) => {
    const id = mintUuid();
    setBursts((current) => [...current, { id, reaction, self }]);
    setTimeout(() => {
      setBursts((current) => current.filter((burst) => burst.id !== id));
    }, reactionMilliseconds);
  }, []);

  const connection = encounter?.connection;
  const conversationId = connection?.conversationId;
  const mutual = connection?.state === 'connected';

  return (
    <View ref={stage} style={styles.stage} testID="live-room">
      {/*
        The other person, under everything.

        On the stage rather than inside the pane that names them, because an
        absolute layer on a phone fills its own parent and nothing further —
        and that parent is a column sized to a name, a country, and a sentence.
        Put there, a real camera arrived as a letterboxed strip across the
        middle of the screen with the text drawn over it; it is only visible
        with a provider actually carrying somebody, which is why it survived
        every run against the simulated adapter.
      */}
      {transport.peerVideo === undefined ? null : (
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          testID="live-peer-video"
        >
          <VideoTrack
            objectFit="cover"
            style={StyleSheet.absoluteFill}
            trackRef={transport.peerVideo}
          />
        </View>
      )}
      <LocalCamera
        bottom={aboveDock + previewLift}
        media={media}
        medium={medium}
        pip={aboutSomebody}
        transport={transport}
      />

      {/*
        Android 16 draws this application under the status bar, so the clock and
        the battery sit on whatever the camera is pointed at. This is what keeps
        them — and the strip beneath them — legible against a bright frame,
        without a bar of solid colour across the top of a camera product.
      */}
      <Scrim
        direction="down"
        id="live-top-scrim"
        opacity={0.72}
        style={[styles.topScrim, { height: insets.top + space[16] }]}
      />

      <View
        onLayout={(event) => {
          setCanvasHeight(event.nativeEvent.layout.height);
        }}
        pointerEvents="box-none"
        style={[
          styles.canvas,
          {
            paddingBottom: canvasFloor,
            paddingTop: canvasCeiling,
          },
        ]}
        testID="live-remote"
      >
        {showing ? (
          <RemotePane
            /*
             * With the sheet open there is less canvas, and the useful context
             * is who this is rather than what they wrote and what is carrying
             * them. Both are a sentence, both are back the moment the sheet
             * closes, and leaving them in was the picture running under a
             * corner of somebody's own face on a device.
             */
            compact={chatOpen || cramped}
            encounter={encounter}
            revealing={revealing}
            transport={transport}
          />
        ) : aboutSomebody ? (
          <EndedPane
            encounter={encounter}
            onOpenConversation={onOpenConversation}
          />
        ) : (
          <SearchingPane
            languageOptions={languageOptions}
            onPreferences={onPreferences}
            preferences={preferences}
            searchingSince={searchingSince}
            wallet={wallet}
          />
        )}
      </View>

      <View
        pointerEvents="none"
        style={[styles.bursts, { bottom: aboveDock + space[8] }]}
      >
        {bursts.map((burst) => (
          <ReactionBurst
            glyph={reactionGlyphs[burst.reaction] ?? '·'}
            key={burst.id}
            self={burst.self}
          />
        ))}
      </View>

      {showing ? (
        <PeerStrip
          encounter={encounter}
          insetTop={insets.top}
          onOpenPerson={onOpenPerson}
        />
      ) : null}

      {showing && mutual && !celebrated ? (
        <ConnectedMoment
          bottom={aboveDock}
          conversationId={conversationId}
          displayName={encounter.peer.displayName}
          onDismiss={() => {
            setCelebrated(true);
          }}
          onOpenConversation={onOpenConversation}
        />
      ) : null}

      <NoticeLayer aboveDock={aboveDock} media={media} message={message} />

      {/*
        The dock's own ground is a wash rather than a panel with a rule across
        the top. A hard edge under a camera reads as a second screen stuck to
        the bottom of the first; a gradient reads as controls floating over the
        picture, which is what they are.

        No bottom inset here, deliberately. The tab bar below this scene already
        pads itself by the gesture area, and adding it again left a band of dead
        black between Next and the bar on every gesture-navigation phone.
      */}
      <View
        onLayout={(event) => {
          setDockHeight(event.nativeEvent.layout.height);
        }}
        style={styles.dock}
      >
        <Scrim
          direction="up"
          id="live-dock-scrim"
          opacity={0.94}
          style={styles.dockScrim}
        />
        <Dock
          busy={busy}
          chatOpen={chatOpen}
          encounter={showing ? encounter : undefined}
          media={media}
          onBurst={showBurst}
          onLeave={onLeave}
          onNext={(id) => {
            setMoving(id);
            setChatOpen(false);
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
      </View>

      {showing ? (
        <LiveChat
          bottom={sheetFloor}
          encounter={encounter}
          onBurst={showBurst}
          onClose={() => {
            setChatOpen(false);
          }}
          onMeasure={setChatHeight}
          onUnread={setUnread}
          open={chatOpen}
        />
      ) : null}

      {simulated && !chatOpen ? (
        <View style={[styles.scenarios, { bottom: aboveDock }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setScenariosOpen(!scenariosOpen);
            }}
            style={styles.scenarioToggle}
            testID="live-sim-toggle"
          >
            <Text tone="tertiary" variant="caption">
              {scenariosOpen ? 'Hide scenarios' : 'Local scenarios'}
            </Text>
          </Pressable>
          {scenariosOpen ? <SimulationPanel onApplied={onState} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Whoever is on the other side, and an honest account of what is carrying them.
 *
 * There is no black rectangle here, for the same reason there is none on the
 * web: a pane that looked like a video feed which had not started would be the
 * most misleading thing on the screen.
 */
function RemotePane({
  compact,
  encounter,
  revealing,
  transport,
}: {
  /** Whether the sheet is taking the bottom of the screen. */
  readonly compact: boolean;
  readonly encounter: LiveEncounter;
  readonly revealing: boolean;
  readonly transport: LiveTransport;
}) {
  const carried = (encounter.call?.mediaTransport ?? 'none') === 'provider';
  const peerVideo = transport.peerVideo;
  const context = contextLine(
    encounter.peer.region,
    encounter.peer.sharedLanguages,
  );
  return (
    <View
      style={[
        styles.peer,
        /*
          Over a photograph the words need their own ground. Text drawn straight
          onto a video is legible against one frame and illegible against the
          next, and this is the same answer the web surface already gives.
        */
        peerVideo === undefined ? null : styles.peerCarried,
        revealing ? styles.peerRevealing : null,
      ]}
      testID="live-peer"
    >
      {/*
        The monogram gives way to the real thing. A stand-in kept on top of a
        live face would be a placeholder covering the thing it stands in for, so
        it is removed rather than layered — the picture itself is full-bleed on
        the stage, behind this and everything else.
      */}
      {peerVideo !== undefined ? null : (
        <View style={styles.peerHalo}>
          <Avatar
            displayName={encounter.peer.displayName}
            seed={encounter.peer.id}
            size={compact ? 'medium' : 'large'}
          />
        </View>
      )}
      <Text
        numberOfLines={2}
        style={styles.centred}
        testID="live-peer-name"
        variant={compact ? 'title' : 'display'}
        weight="bold"
      >
        {encounter.peer.displayName}
      </Text>
      {context === '' ? null : (
        <Text style={styles.centred} tone="secondary" variant="small">
          {context}
        </Text>
      )}
      {/*
        What the other person published about themselves. It was on the web
        surface and missing here, which left a phone showing a name and a
        country where a laptop showed a person.
      */}
      {compact || encounter.peer.bio === undefined ? null : (
        <Text
          numberOfLines={2}
          style={styles.centred}
          tone="secondary"
          variant="caption"
        >
          {encounter.peer.bio}
        </Text>
      )}
      {/*
        What is carrying them, last and quietest. It is an account of an absence
        rather than a thing to act on, and it is exact rather than reassuring.
      */}
      {revealing ? (
        <Text testID="live-connecting" tone="tertiary" variant="caption">
          Connecting…
        </Text>
      ) : compact ? null : !carried ? (
        <Text
          style={styles.centred}
          testID="live-no-media"
          tone="tertiary"
          variant="caption"
        >
          You are with {encounter.peer.displayName}, and no approved provider
          exists yet to carry their camera or voice. The chat is live and
          everything else here is real.
        </Text>
      ) : transport.state === 'failed' ? (
        <Text
          style={styles.centred}
          testID="live-media-failed"
          tone="tertiary"
          variant="caption"
        >
          You are with {encounter.peer.displayName}, and their camera and voice
          could not be connected. The chat is live; Next will find somebody
          else.
        </Text>
      ) : transport.state === 'reconnecting' ? (
        <Text
          testID="live-media-reconnecting"
          tone="tertiary"
          variant="caption"
        >
          Reconnecting…
        </Text>
      ) : peerVideo !== undefined || transport.peerAudio ? (
        <Text testID="live-media-carried" tone="tertiary" variant="caption">
          {/*
            Says what is arriving rather than that a connection exists. Somebody
            whose peer turned their camera off is not looking at a broken
            product, and one word for both would leave them guessing which.
          */}
          {peerVideo === undefined
            ? `${encounter.peer.displayName}'s camera is off.`
            : 'Connected.'}
        </Text>
      ) : (
        <Text testID="live-media-waiting" tone="tertiary" variant="caption">
          Waiting for {encounter.peer.displayName} to join…
        </Text>
      )}
    </View>
  );
}

/**
 * The person's name, where they are, and the two things to do about them.
 *
 * Along the top rather than over the middle, so it never covers the face it is
 * describing. Safety sits here, one press away and always in the same place —
 * the moment somebody wants it is the moment they should not have to look.
 */
function PeerStrip({
  encounter,
  insetTop,
  onOpenPerson,
}: {
  readonly encounter: LiveEncounter;
  readonly insetTop: number;
  readonly onOpenPerson: (personId: string) => void;
}) {
  return (
    <View style={[styles.strip, { paddingTop: insetTop + space[2] }]}>
      <View
        style={[
          styles.connection,
          encounter.connection.state === 'connected'
            ? styles.connectionMutual
            : encounter.connection.state === 'received'
              ? styles.connectionWanted
              : null,
        ]}
        testID="live-connection"
      >
        <Icon
          color={
            encounter.connection.state === 'connected'
              ? color.statusPositive
              : encounter.connection.state === 'received'
                ? color.ember
                : color.textSecondary
          }
          name="link"
          size="sm"
        />
        <Text tone="secondary" variant="caption">
          {connectionCopy[encounter.connection.state] ?? 'Connect'}
        </Text>
      </View>
      <Inline gap={2}>
        <IconButton
          label={`Open ${encounter.peer.displayName}’s profile`}
          name="user"
          onPress={() => {
            onOpenPerson(encounter.peer.id);
          }}
          testID="live-peer-profile"
        />
        <PersonSafetyMenu
          person={{
            displayName: encounter.peer.displayName,
            id: encounter.peer.id,
          }}
        />
      </Inline>
    </View>
  );
}

/**
 * Searching, saying only what is true about it.
 *
 * No count of anybody, no queue position, and no faces of people who are not
 * there. There is no presence projection behind this product, so any of those
 * would be invented here. What conveys progress instead is the person's own
 * live picture and three phrasings of "still looking".
 */
function SearchingPane({
  languageOptions,
  onPreferences,
  preferences,
  searchingSince,
  wallet,
}: {
  readonly languageOptions: readonly string[];
  readonly onPreferences: (preferences: LivePreferences) => void;
  readonly preferences: LivePreferences;
  readonly searchingSince: string | undefined;
  readonly wallet: WalletView;
}) {
  const waited = useElapsed(searchingSince);
  const premium = wallet.state?.livePreference;
  const narrowed =
    preferences.region === 'same' ||
    preferences.language !== undefined ||
    premium !== undefined;
  const line =
    searchingLines[
      Math.min(searchingLines.length - 1, Math.floor(waited / 8000))
    ] ?? searchingLines[0];

  return (
    <View style={styles.searching} testID="live-searching">
      {/*
        The search's own motion: three rings leaving a mark, over the person's
        own live picture. It measures nothing, counts nothing, and stands for
        nothing but the fact that VELORA is looking — which is the whole of what
        is true here. There is no queue position, no number of people, and no
        rotating faces of people who are not there, because no presence
        projection exists behind this product and every one of those would be
        invented on this screen.
      */}
      <Pulse />
      {/*
        The status *is* the line, rather than a quiet echo underneath one. Two
        elements saying the same words is two things a screen reader reads.
      */}
      <Text
        accessibilityLiveRegion="polite"
        align="center"
        testID="live-searching-status"
        variant="heading"
        weight="semibold"
      >
        {line ?? 'Looking for someone…'}
      </Text>
      {/*
        Every phrasing of the state says that VELORA is looking, including this
        one — the rotating line above it does not always carry the word, and a
        screen that reads "Nobody yet" with nothing beside it is a screen that
        looks like it has stopped.
      */}
      <Text style={styles.centred} tone="secondary" variant="caption">
        {premium === undefined
          ? 'VELORA is looking across everybody here, except anybody you have just met.'
          : `VELORA is looking for ${describeSelection(premium) ?? 'a narrowed search'} only, except anybody you have just met. Nobody can promise anyone is there.`}
      </Text>
      {narrowed && waited >= broadenPromptMilliseconds ? (
        <View style={styles.broaden} testID="live-broaden">
          <Text style={styles.centred} tone="tertiary" variant="caption">
            {premium === undefined
              ? 'Your search is narrowed. Widening it looks at everybody who is here.'
              : premium.charged
                ? 'Your search is narrowed. Nobody else matching has been here yet. This window has already been used, so widening costs nothing and returns nothing.'
                : 'Your search is narrowed. Nobody matching has been here yet. Widening returns the coins you held, in full.'}
          </Text>
          <Button
            onPress={() => {
              // "Widen" means widen. The paid window is closed too, and its
              // coins come back in full.
              onPreferences({ region: 'any' });
              if (premium !== undefined) wallet.cancelPremium();
            }}
            size="small"
            testID="live-broaden-action"
          >
            Widen the search
          </Button>
          <PremiumPreference
            languageOptions={languageOptions}
            wallet={wallet}
          />
        </View>
      ) : (
        <PreferenceControls
          languageOptions={languageOptions}
          onChange={onPreferences}
          preferences={preferences}
          wallet={wallet}
        />
      )}
    </View>
  );
}

function EndedPane({
  encounter,
  onOpenConversation,
}: {
  readonly encounter: LiveEncounter;
  readonly onOpenConversation: (conversationId: string) => void;
}) {
  const copy =
    endReasonCopy[encounter.endReason ?? ''] ?? endReasonCopy.peer_left;
  const conversationId = encounter.connection.conversationId;
  return (
    <View style={styles.peer} testID="live-ended">
      <Avatar
        displayName={encounter.peer.displayName}
        seed={encounter.peer.id}
        size="medium"
      />
      <Text variant="heading" weight="semibold">
        {copy?.title ?? 'That conversation ended'}
      </Text>
      <Text style={styles.centred} tone="secondary" variant="small">
        {copy?.body ?? ''}
      </Text>
      {encounter.connection.state === 'connected' &&
      conversationId !== undefined ? (
        <Button
          icon="message"
          onPress={() => {
            onOpenConversation(conversationId);
          }}
          testID="live-ended-conversation"
          tone="primary"
        >
          Open your conversation
        </Button>
      ) : encounter.connection.state === 'requested' ? (
        <Text
          style={styles.centred}
          testID="live-ended-requested"
          tone="tertiary"
          variant="caption"
        >
          You asked to connect. If they ask too, the conversation appears in
          both your inboxes.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The moment two people become connected.
 *
 * Restrained on purpose. It confirms what has happened, offers the Inbox, and
 * gets out of the way — and it does not end the call, move anybody, or imply
 * any urgency. Two people who have just agreed to keep talking should be
 * allowed to keep talking.
 */
function ConnectedMoment({
  bottom,
  conversationId,
  displayName,
  onDismiss,
  onOpenConversation,
}: {
  readonly bottom: number;
  readonly conversationId: string | undefined;
  readonly displayName: string;
  readonly onDismiss: () => void;
  readonly onOpenConversation: (conversationId: string) => void;
}) {
  return (
    <View style={[styles.moment, { bottom }]} testID="live-connected-moment">
      <View style={styles.momentMark}>
        <Icon color={color.statusPositive} name="link" size="sm" />
      </View>
      <View style={styles.momentBody}>
        <Text variant="small">You and {displayName} are connected</Text>
        <Text tone="tertiary" variant="caption">
          Keep talking here. The conversation is in your Inbox whenever you want
          it.
        </Text>
      </View>
      {conversationId === undefined ? null : (
        <IconButton
          label="Open your conversation"
          name="message"
          onPress={() => {
            onOpenConversation(conversationId);
          }}
          testID="live-moment-conversation"
        />
      )}
      <IconButton
        label="Dismiss"
        name="x"
        onPress={onDismiss}
        testID="live-moment-dismiss"
      />
    </View>
  );
}

/**
 * The person's own camera: the ground of the screen, then a corner of it.
 *
 * `CameraView` is mounted only while `media.active` is true, which is false the
 * moment the application leaves the foreground — unmounting is what releases
 * the device on Android, and a bound camera behind another app's window is a
 * camera nobody remembers is open.
 *
 * As a picture-in-picture it can be dragged and snaps to whichever corner it is
 * nearest. The gesture is contained to the view itself, which is why it cannot
 * fight the tab bar, the back gesture, or the chat sheet: nothing outside this
 * component ever sees the touch.
 */
function LocalCamera({
  bottom,
  media,
  medium,
  pip,
  transport,
}: {
  /** How far above the bottom the picture-in-picture sits. Measured, not guessed. */
  readonly bottom: number;
  readonly media: LiveMediaState;
  readonly medium: LiveMedium;
  readonly pip: boolean;
  readonly transport: LiveTransport;
}) {
  /*
   * Two sources for one self-view, and never both at once.
   *
   * Before an encounter is carried, the preview is `expo-camera`'s. Once the
   * provider has the camera, it is the provider's own local track — because
   * Android gives one client the device and `media.active` has already gone
   * false to release it. Rendering the second only when the first is gone is
   * what makes the handover a picture that keeps going rather than a black
   * rectangle.
   */
  const local = transport.localVideo;
  const showing = medium === 'video' && (media.active || local !== undefined);
  const [corner, setCorner] = useState<'left' | 'right'>('right');
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const offset = useRef({ x: 0, y: 0 });

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed only once a finger has actually travelled, so a tap on the
        // preview is still a tap and the pan never steals one.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
        onPanResponderMove: (_event, gesture) => {
          drag.setValue({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: (_event, gesture) => {
          // Snapped rather than left where it was dropped. A preview halfway
          // off the screen is a preview nobody can see, and a corner is the
          // only position that stays right when the keyboard opens.
          const moved = offset.current.x + gesture.dx;
          setCorner(moved < -40 ? 'left' : moved > 40 ? 'right' : corner);
          offset.current = { x: 0, y: 0 };
          Animated.spring(drag, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        },
      }),
    [corner, drag],
  );

  if (!pip) {
    return (
      <View style={StyleSheet.absoluteFill} testID="live-local">
        {!showing ? null : local === undefined ? (
          <CameraView
            facing={media.facing}
            style={StyleSheet.absoluteFill}
            testID="live-local-camera"
          />
        ) : (
          <VideoTrack
            mirror
            objectFit="cover"
            style={StyleSheet.absoluteFill}
            trackRef={local}
          />
        )}
        {showing ? null : (
          <View style={styles.localOff} testID="live-local-off">
            <Icon
              color={color.textTertiary}
              name={medium === 'video' ? 'cameraOff' : 'phone'}
              size="md"
            />
            <Text style={styles.centred} tone="tertiary" variant="caption">
              {medium === 'voice'
                ? 'Voice only'
                : media.permission === 'granted'
                  ? 'Camera off'
                  : 'Camera not open'}
            </Text>
          </View>
        )}
        {/* Two washes rather than one, and both drawn as gradients: text over a
            live camera has to stay readable whatever is in frame, and a flat
            overlay dulls the picture everywhere to protect the few places where
            words sit. A camera pointed at a white wall is the common case that
            decides these values. */}
        <CameraScrim />
        <MicBadge media={media} />
      </View>
    );
  }

  return (
    <Animated.View
      accessibilityHint="Drag to move it to another corner"
      accessibilityLabel="Your camera"
      style={[
        styles.pip,
        corner === 'left' ? styles.pipLeft : styles.pipRight,
        { bottom, transform: drag.getTranslateTransform() },
      ]}
      testID="live-local"
      {...responder.panHandlers}
    >
      {!showing ? null : local === undefined ? (
        <CameraView
          facing={media.facing}
          style={StyleSheet.absoluteFill}
          testID="live-local-camera"
        />
      ) : (
        <VideoTrack
          mirror
          objectFit="cover"
          style={StyleSheet.absoluteFill}
          trackRef={local}
        />
      )}
      {showing ? null : (
        <View style={styles.localOff} testID="live-local-off">
          <Icon
            color={color.textTertiary}
            name={medium === 'video' ? 'cameraOff' : 'phone'}
            size="md"
          />
          <Text style={styles.centred} tone="tertiary" variant="caption">
            {medium === 'voice'
              ? 'Voice only'
              : media.permission === 'granted'
                ? 'Camera off'
                : 'Camera not open'}
          </Text>
        </View>
      )}
      <MicBadge media={media} />
    </Animated.View>
  );
}

/**
 * What keeps words readable over whatever the camera is pointed at.
 *
 * A radial dim through the middle, where the words are, and a vertical wash
 * that darkens the top and the bottom where the strip and the dock sit. The
 * flat pair of overlays this replaces darkened the whole picture by two thirds
 * to protect the third of it that carries text.
 */
function CameraScrim() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg height="100%" width="100%">
        <Defs>
          <RadialGradient cx="50%" cy="46%" id="live-dim" r="68%">
            <Stop offset="0" stopColor="#070508" stopOpacity={0.78} />
            <Stop offset="1" stopColor="#070508" stopOpacity={0.24} />
          </RadialGradient>
          <LinearGradient id="live-edges" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#070508" stopOpacity={0.66} />
            <Stop offset="0.42" stopColor="#070508" stopOpacity={0.32} />
            <Stop offset="1" stopColor="#070508" stopOpacity={0.84} />
          </LinearGradient>
        </Defs>
        <Rect fill="url(#live-dim)" height="100%" width="100%" />
        <Rect fill="url(#live-edges)" height="100%" width="100%" />
      </Svg>
    </View>
  );
}

function MicBadge({ media }: { readonly media: LiveMediaState }) {
  return (
    <View style={styles.localBadge} testID="live-mic-state">
      <Icon
        // Muted reads as muted whatever the transport says. What the badge
        // never does is claim the microphone is *carrying* anything: nothing
        // is, and the canvas says so in words.
        color={
          media.microphoneOn && media.microphoneAvailable
            ? color.textSecondary
            : color.statusCritical
        }
        name={media.microphoneOn ? 'mic' : 'micOff'}
        size="sm"
      />
    </View>
  );
}

/** A reaction, rising once and gone. Nothing accumulates and nothing counts. */
function ReactionBurst({
  glyph,
  self,
}: {
  readonly glyph: string;
  readonly self: boolean;
}) {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, {
      duration: reactionMilliseconds,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [rise]);

  return (
    <Animated.Text
      style={[
        styles.burst,
        self ? styles.burstSelf : null,
        {
          opacity: rise.interpolate({
            inputRange: [0, 0.15, 0.8, 1],
            outputRange: [0, 1, 1, 0],
          }),
          transform: [
            {
              translateY: rise.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -180],
              }),
            },
          ],
        },
      ]}
    >
      {glyph}
    </Animated.Text>
  );
}

/**
 * The search's own motion: three rings leaving a mark.
 *
 * Nothing about it measures anything, and nothing about it can be mistaken for
 * progress — it has no end state and no bar. A thin line that grew and shrank
 * was what this was, and on a device over a live camera it was invisible.
 */
function Pulse() {
  return (
    <View style={styles.pulse}>
      <PulseRing delay={0} />
      <PulseRing delay={900} />
      <PulseRing delay={1800} />
      <View style={styles.pulseCore}>
        <Icon color={color.ember} name="live" size="md" />
      </View>
    </View>
  );
}

function PulseRing({ delay }: { readonly delay: number }) {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rise, {
        delay,
        duration: 2800,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [delay, rise]);

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        {
          opacity: rise.interpolate({
            inputRange: [0, 0.25, 1],
            outputRange: [0, 0.85, 0],
          }),
          transform: [
            {
              scale: rise.interpolate({
                inputRange: [0, 1],
                outputRange: [0.45, 1],
              }),
            },
          ],
        },
      ]}
    />
  );
}

/**
 * A gradient wash, drawn rather than approximated with a flat colour.
 *
 * React Native has no gradient of its own, and a flat overlay over a live
 * camera has a hard edge wherever it stops — which is what a device showed
 * along the top of the dock. `react-native-svg` is already in this build for
 * the shell's own ground, so this costs nothing new.
 */
function Scrim({
  direction,
  id,
  opacity,
  style,
}: {
  readonly direction: 'up' | 'down';
  /** Unique per instance: two gradients sharing a name is one gradient. */
  readonly id: string;
  readonly opacity: number;
  readonly style: StyleProp<ViewStyle>;
}) {
  return (
    <View pointerEvents="none" style={style}>
      <Svg height="100%" width="100%">
        <Defs>
          <LinearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <Stop
              offset="0"
              stopColor="#070508"
              stopOpacity={direction === 'down' ? opacity : 0}
            />
            <Stop
              offset="1"
              stopColor="#070508"
              stopOpacity={direction === 'down' ? 0 : opacity}
            />
          </LinearGradient>
        </Defs>
        <Rect fill={`url(#${id})`} height="100%" width="100%" />
      </Svg>
    </View>
  );
}

/**
 * The one decorative gesture on the door.
 *
 * A soft ember bloom off the top: enough atmosphere that the screen feels like
 * somewhere, and nowhere near the neon this product is explicitly not.
 */
function DoorGlow() {
  return (
    <View pointerEvents="none" style={styles.doorGlow}>
      <Svg height="100%" width="100%">
        <Defs>
          <RadialGradient cx="50%" cy="0%" id="live-bloom" r="80%">
            <Stop offset="0" stopColor={color.ember} stopOpacity={0.16} />
            <Stop offset="1" stopColor={color.ember} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#live-bloom)" height="100%" width="100%" />
      </Svg>
    </View>
  );
}

/* =============================== Dock ================================= */

/**
 * The controls, weighted by how often they are pressed and what they cost.
 *
 * Deliberately not a row of equals. Next is the widest thing here because it is
 * the most frequent act in the product; Connect sits beside it and takes the
 * accent only when the other person is waiting on it; the devices are icons at
 * one end where a thumb reaches in a hurry, and chat, reactions, and End at the
 * other. Nothing is behind a menu, and there is no confirmation on Next — a
 * dialog between a person and the next conversation would be friction defended
 * as care.
 */
function Dock({
  busy,
  chatOpen,
  encounter,
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
  const [error, setError] = useState<string | undefined>(undefined);
  const [reacting, setReacting] = useState(false);

  return (
    <Stack gap={2}>
      {reacting && encounter !== undefined ? (
        <View style={styles.reactions} testID="live-reactions">
          {reactionOrder.map((reaction) => (
            <Pressable
              accessibilityLabel={reaction}
              accessibilityRole="button"
              disabled={react.busy}
              key={reaction}
              onPress={() => {
                // Shown at once, sent underneath. A reaction that waited for a
                // round trip would arrive after the moment it was reacting to,
                // and there is nothing to undo if the send fails — it is a
                // wave, not a message.
                onBurst(reaction, true);
                setReacting(false);
                react.run(async () => {
                  await api.sendLiveReaction({
                    clientMessageId: mintUuid(),
                    encounterId: encounter.id,
                    reaction,
                  });
                });
              }}
              style={styles.reaction}
              testID={`live-reaction-${reaction}`}
            >
              <Text variant="heading">{reactionGlyphs[reaction] ?? '·'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/*
        Two rows, grouped by what each control is for rather than laid out as a
        row of equals: the devices at one end where a thumb reaches in a hurry,
        the social controls at the other, and leaving held apart from both by a
        divider — so ending a conversation never sits flush against sending a
        heart. Moving on has the row nearest the thumb to itself.
      */}
      <View style={styles.dockRow}>
        <Inline gap={2}>
          <View
            style={[
              styles.control,
              media.microphoneOn ? null : styles.controlOff,
            ]}
          >
            <IconButton
              label={
                media.microphoneOn
                  ? 'Mute your microphone'
                  : 'Unmute your microphone'
              }
              name={media.microphoneOn ? 'mic' : 'micOff'}
              onPress={media.toggleMicrophone}
              testID="live-toggle-mic"
              tone={media.microphoneOn ? 'primary' : 'critical'}
            />
          </View>
          <View
            style={[styles.control, media.cameraOn ? null : styles.controlOff]}
          >
            <IconButton
              label={
                media.cameraOn ? 'Turn your camera off' : 'Turn your camera on'
              }
              name={media.cameraOn ? 'camera' : 'cameraOff'}
              onPress={media.toggleCamera}
              testID="live-toggle-camera"
              tone={media.cameraOn ? 'primary' : 'critical'}
            />
          </View>
          <View style={styles.control}>
            <IconButton
              label="Switch camera"
              name="cameraSwitch"
              onPress={media.switchCamera}
              testID="live-switch-camera"
              tone="primary"
            />
          </View>
        </Inline>

        <View style={styles.dockAside}>
          {encounter === undefined ? null : (
            <>
              <View style={styles.control}>
                <IconButton
                  label={reacting ? 'Hide reactions' : 'Send a reaction'}
                  name="heart"
                  onPress={() => {
                    setReacting(!reacting);
                  }}
                  testID="live-react"
                  tone="primary"
                />
              </View>
              <View style={styles.control}>
                <IconButton
                  label={chatOpen ? 'Hide the chat' : 'Show the chat'}
                  name="message"
                  onPress={onToggleChat}
                  testID="live-toggle-chat"
                  tone="primary"
                />
                {unread > 0 && !chatOpen ? (
                  <View style={styles.unread} testID="live-unread" />
                ) : null}
              </View>
            </>
          )}
          <View style={styles.dockDivider} />
          <Button
            icon="x"
            onPress={onLeave}
            size="small"
            testID="live-end"
            tone="ghost"
          >
            End
          </Button>
        </View>
      </View>

      {/*
        Moving on is the most frequent act in the product, so Next is the widest
        control on the screen and takes the row nearest the thumb. Connect is
        quieter beside it and takes the accent only in the one state where the
        other person is waiting on it — two filled accent controls side by side
        is a screen with no hierarchy at all.

        The row is declared rather than wrapped. Connect's label is a sentence
        that grows — "Connect" becomes "Waiting for them" becomes "They want to
        connect" — and on a device it overflowed at the second of those and cut
        the control beside it in half.
      */}
      <View style={styles.flowRow}>
        {encounter === undefined ? null : (
          <View style={styles.flowQuiet}>
            <Button
              busy={connect.busy}
              disabled={encounter.connection.state === 'connected'}
              icon="link"
              onPress={() => {
                connect.run(async () => {
                  const result = await api.connectInLiveEncounter(encounter.id);
                  setError(isOk(result) ? undefined : failureMessage(result));
                  // Re-read rather than patched from the response. Connect and
                  // the other person's own Connect race constantly, and the
                  // authoritative answer to "where does this now stand" is the
                  // one read that carries the whole state — including the
                  // conversation a mutual connection has just created.
                  const current = await api.liveState();
                  if (isOk(current)) onState(current.value);
                });
              }}
              size="large"
              testID="live-connect"
              tone={
                encounter.connection.state === 'received'
                  ? 'primary'
                  : 'secondary'
              }
              wide
            >
              {connectionCopy[encounter.connection.state] ?? 'Connect'}
            </Button>
          </View>
        )}

        {encounter === undefined ? (
          serverState === 'ended' || serverState === 'idle' ? (
            <View style={styles.flowLoud}>
              <Button
                busy={busy}
                icon="live"
                onPress={onSearchAgain}
                size="large"
                testID="live-search-again"
                tone="primary"
                wide
              >
                Meet someone else
              </Button>
            </View>
          ) : null
        ) : (
          <View style={styles.flowLoud}>
            <Button
              icon="refresh"
              onPress={() => {
                onNext(encounter.id);
              }}
              size="large"
              testID="live-next"
              tone="primary"
              wide
            >
              Next
            </Button>
          </View>
        )}
      </View>

      {error === undefined ? null : (
        <ErrorMessage testID="live-connect-error">{error}</ErrorMessage>
      )}
    </Stack>
  );
}

/* ============================ Notices ================================= */

/**
 * What has to be said over the picture, and nothing that does not.
 *
 * A permission refusal and a failed request are both things a person has to be
 * able to read while the camera is the background, so they sit above the dock
 * rather than in a column that would have to scroll.
 */
function NoticeLayer({
  aboveDock,
  media,
  message,
}: {
  readonly aboveDock: number;
  readonly media: LiveMediaState;
  readonly message: string | undefined;
}) {
  const permission =
    media.permission === 'granted' ? undefined : media.permission;
  if (permission === undefined && message === undefined) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.notices, { bottom: aboveDock }]}
    >
      {message === undefined ? null : (
        <ErrorMessage testID="live-message">{message}</ErrorMessage>
      )}
      {permission === undefined ? null : permission === 'unavailable' ? (
        <Notice
          testID="live-permission-unavailable"
          title="No camera on this device"
          tone="neutral"
        >
          This build cannot use a camera. You can still meet people and talk to
          them in the chat.
        </Notice>
      ) : (
        <Notice
          testID="live-permission-denied"
          title="VELORA does not have your camera"
          tone="caution"
        >
          {permission === 'blocked'
            ? 'Android will not ask again, so it has to be turned on in Settings. Everything else works without it — you can still be matched, chat, and connect.'
            : 'VELORA needs access to the camera so the person you meet can see you. Everything else works without it.'}
        </Notice>
      )}
    </View>
  );
}

/* =============================== Chat ================================= */

/**
 * The live chat, which is not the Inbox and says so.
 *
 * A sheet from the bottom rather than a panel in a column, because the
 * conversation is the video and this is something happening during it. The
 * transcript scrolls inside itself and the sheet is bounded to part of the
 * screen, so filling it can never push the dock away and the person can always
 * see who they are talking to.
 *
 * Reactions arrive on the same channel and are deliberately not rendered here.
 * They are moments on the canvas, and a transcript of who waved when is exactly
 * the kind of history this feature does not keep in front of people.
 */
function LiveChat({
  bottom,
  encounter,
  onBurst,
  onClose,
  onMeasure,
  onUnread,
  open,
}: {
  readonly bottom: number;
  readonly encounter: LiveEncounter;
  readonly onBurst: (reaction: string, self: boolean) => void;
  readonly onClose: () => void;
  /** Reports the sheet's measured height, so the preview can clear it. */
  readonly onMeasure: (height: number) => void;
  readonly onUnread: (count: number) => void;
  readonly open: boolean;
}) {
  const api = useApi();
  const [messages, setMessages] = useState<readonly LiveMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const send = useSingleFlight();
  const listRef = useRef<ScrollView | null>(null);
  const encounterId = encounter.id;
  const seen = useRef<Set<string>>(new Set());
  const read = useRef(0);

  // A new encounter is a new conversation. Cleared on the identifier rather
  // than on a mount, because this component does not unmount between
  // encounters — the camera must not blink.
  useEffect(() => {
    setMessages([]);
    setDraft('');
    setError(undefined);
    seen.current = new Set();
    read.current = 0;
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
    const poll = () => {
      void api.liveMessages(encounterId).then((result) => {
        if (cancelled || !isOk(result)) return;
        // Guarded on the encounter the answer is *about*. A reply that arrives
        // after Next has already moved somebody on describes a conversation
        // they are no longer in.
        if (result.value.encounterId !== encounterId) return;
        absorb(result.value.messages);
      });
    };
    poll();
    const timer = setInterval(poll, messagePollMilliseconds);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [absorb, api, encounterId]);

  const theirs = messages.filter((entry) => !entry.self).length;
  useEffect(() => {
    if (open) {
      read.current = theirs;
      onUnread(0);
      return;
    }
    onUnread(Math.max(0, theirs - read.current));
  }, [onUnread, open, theirs]);

  const submit = () => {
    const body = draft.trim();
    if (body.length === 0) return;
    send.run(async () => {
      const result = await api.sendLiveMessage({
        body,
        // Hermes has no `globalThis.crypto`, so this is the platform's own
        // identifier rather than `crypto.randomUUID()`.
        clientMessageId: mintUuid(),
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
      // The draft is kept. Somebody who typed something and lost it to a failed
      // send has lost the thing they were trying to say.
      setError(failureMessage(result));
    });
  };

  if (!open) return null;

  return (
    <View
      onLayout={(event) => {
        onMeasure(event.nativeEvent.layout.height);
      }}
      style={[styles.chat, { bottom }]}
      testID="live-chat"
    >
      {/*
        A sheet, not a card floating over the picture: it is flush to the bottom
        of the stage, its top corners are the only rounded ones, and it names
        itself in a line rather than opening with a paragraph of policy. What
        this chat is and is not is said under the composer, where it belongs —
        a disclaimer at the top of a conversation is the first thing somebody
        reads and the least useful.
      */}
      <View style={styles.chatHead}>
        <Inline gap={2}>
          <Icon color={color.textTertiary} name="message" size="sm" />
          <Text tone="tertiary" variant="caption">
            Live chat
          </Text>
        </Inline>
        <IconButton
          label="Hide the chat"
          name="x"
          onPress={onClose}
          testID="live-chat-close"
        />
      </View>

      <ScrollView
        accessibilityLabel={`Live chat with ${encounter.peer.displayName}`}
        onContentSizeChange={() => {
          listRef.current?.scrollToEnd({ animated: false });
        }}
        ref={listRef}
        style={styles.chatList}
        testID="live-chat-list"
      >
        {messages.length === 0 ? (
          <Text tone="tertiary" variant="caption">
            Say something.
          </Text>
        ) : (
          messages.map((entry) => (
            <View
              key={entry.id}
              style={[styles.bubble, entry.self ? styles.bubbleSelf : null]}
              testID={`live-message-${String(entry.sequence)}`}
            >
              <Text variant="small">{entry.body}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <Inline gap={2}>
        <TextInput
          accessibilityLabel={`Message ${encounter.peer.displayName}`}
          maxLength={4000}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder="Say something"
          placeholderTextColor={color.textTertiary}
          returnKeyType="send"
          style={styles.composer}
          testID="live-chat-input"
          value={draft}
        />
        {/*
          An icon rather than a word. The composer is the width of a phone, and
          a labelled pill there takes room the sentence being typed needs. The
          name is on the control either way.
        */}
        <View style={styles.send}>
          <IconButton
            disabled={send.busy}
            label="Send"
            name="send"
            onPress={submit}
            testID="live-chat-send"
            tone="onAccent"
          />
        </View>
      </Inline>

      {error === undefined ? null : (
        <ErrorMessage testID="live-chat-error">{error}</ErrorMessage>
      )}

      <Inline gap={2}>
        <Icon color={color.textTertiary} name="clock" size="sm" />
        <Text style={styles.step} tone="tertiary" variant="caption">
          Live chat only — it does not go to your Inbox unless you both connect.
        </Text>
      </Inline>
    </View>
  );
}

/* ============================ Simulation ============================== */

/**
 * The local scenario panel.
 *
 * Rendered only where the server says a simulation adapter is configured, which
 * configuration refuses outside local and test — so this is absent in a
 * deployed build rather than hidden in one.
 */
function SimulationPanel({
  onApplied,
}: {
  readonly onApplied: (state: LiveState) => void;
}) {
  const api = useApi();
  const run = useSingleFlight();

  return (
    <View style={styles.simulation} testID="live-simulation">
      <Text tone="tertiary" variant="caption">
        Local scenarios. Each acts as the other person, through the same
        endpoints their phone would call.
      </Text>
      <View style={styles.simulationActions}>
        {scenarios.map((scenario) => (
          <Pressable
            accessibilityRole="button"
            disabled={run.busy}
            key={scenario.value}
            onPress={() => {
              run.run(async () => {
                await api.applyLiveSimulation(scenario.value);
                const current = await api.liveState();
                if (isOk(current)) onApplied(current.value);
              });
            }}
            style={styles.simulationChip}
            testID={`live-sim-${scenario.value}`}
          >
            <Text tone="secondary" variant="caption">
              {scenario.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ============================== Helpers =============================== */

/**
 * Holds a brief reveal when a new encounter arrives.
 *
 * A transition, never a progress bar. It measures nothing about the session
 * becoming ready — that state is read from the server and rendered separately —
 * and it exists so that a match arrives rather than appears.
 */
function useReveal(encounterId: string | undefined): boolean {
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (encounterId === undefined) return undefined;
    const timer = setTimeout(() => {
      setRevealed(encounterId);
    }, revealMilliseconds);
    return () => {
      clearTimeout(timer);
    };
  }, [encounterId]);
  return encounterId !== undefined && revealed !== encounterId;
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
 * overlap rather than everything they speak. An empty answer renders nothing
 * rather than an apologetic sentence about missing data.
 */
function contextLine(
  region: string | undefined,
  sharedLanguages: readonly string[] | undefined,
): string {
  const parts: string[] = [];
  if (region !== undefined) parts.push(regionName(region));
  if (sharedLanguages !== undefined && sharedLanguages.length > 0) {
    parts.push(sharedLanguages.map(languageName).join(', '));
  }
  return parts.join(' · ');
}

/**
 * A code as a name, where the runtime can say one.
 *
 * Hermes ships without `Intl.DisplayNames`, so the absence is answered with the
 * code itself. A two-letter code is a worse answer than a name and a much
 * better one than a crash — which is exactly what an unguarded call is on a
 * device and is not in a test runner with a richer runtime.
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

/** The preview's height, named once so the canvas can reserve exactly it. */
const previewHeight = 148;

const styles = StyleSheet.create({
  broaden: {
    alignItems: 'center',
    backgroundColor: color.surfaceOverlay,
    borderColor: color.borderHairline,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  bubble: {
    alignSelf: 'flex-start',
    backgroundColor: color.surface3,
    borderRadius: radius.md,
    marginBottom: space[2],
    maxWidth: '86%',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  bubbleSelf: {
    alignSelf: 'flex-end',
    backgroundColor: color.emberWashStrong,
  },
  burst: { fontSize: 34, left: '46%', position: 'absolute' },
  burstSelf: { left: '58%' },
  bursts: { left: 0, position: 'absolute', right: 0, top: 0 },
  canvas: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space[5],
  },
  centred: { textAlign: 'center' },
  /*
   * A sheet, flush to the bottom of the stage and to both its sides, with only
   * its top corners rounded. Bounded to part of the screen so filling it can
   * never push the dock away and the person can always see who they are
   * talking to.
   */
  chat: {
    backgroundColor: color.surfaceOverlay,
    borderTopColor: color.borderHairline,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    gap: space[3],
    left: 0,
    maxHeight: '52%',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    position: 'absolute',
    right: 0,
  },
  chatHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chatList: { maxHeight: 240 },
  composer: {
    backgroundColor: color.surfaceInset,
    borderColor: color.borderSoft,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: color.textPrimary,
    flex: 1,
    fontSize: textScale.body.size,
    minHeight: layout.controlHeight,
    paddingHorizontal: space[3],
  },
  connection: {
    alignItems: 'center',
    backgroundColor: color.surfaceOverlay,
    borderColor: color.borderHairline,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space[2],
    minHeight: 32,
    paddingHorizontal: space[3],
  },
  connectionMutual: {
    backgroundColor: color.statusPositiveWash,
    borderColor: color.statusPositive,
  },
  connectionWanted: {
    backgroundColor: color.emberWash,
    borderColor: color.emberLine,
  },
  dock: {
    bottom: 0,
    gap: space[3],
    left: 0,
    paddingBottom: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    position: 'absolute',
    right: 0,
  },
  dockDivider: {
    backgroundColor: color.borderHairline,
    height: space[6],
    marginHorizontal: space[1],
    width: 1,
  },
  /*
   * Wraps rather than overflowing. The controls are icon-sized targets that
   * must not shrink, and on a 360 dp phone the two groups together are wider
   * than the row — which is not a hypothetical: on a compact device End lost
   * its last letter off the side of the screen.
   */
  /*
   * The social and safety group keeps the end of whatever line it lands on: a
   * wrapped row aligned by `space-between` puts the lone second line at the
   * start, which reads as a third group nobody designed.
   */
  dockAside: {
    alignItems: 'center',
    columnGap: space[2],
    flexDirection: 'row',
    marginLeft: 'auto',
  },
  dockRow: {
    alignItems: 'center',
    columnGap: space[2],
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space[2],
  },
  dockScrim: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: -space[10],
  },
  /* A control on the picture, rather than a glyph floating on it. */
  control: {
    backgroundColor: color.surfaceOverlay,
    borderColor: color.borderHairline,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  controlOff: {
    backgroundColor: color.statusCriticalWash,
    borderColor: color.statusCritical,
  },
  door: {
    /*
     * Stretch, not `flex-start`.
     *
     * The step rows are a mark beside a `Text` with `flex: 1`, and a row inside
     * a container that sizes to its content gives a `flex: 1` child zero width
     * — so on a device the marks rendered and every sentence beside them
     * vanished, while still taking up its line height.
     */
    alignItems: 'stretch',
    gap: space[4],
    padding: space[5],
  },
  doorChoosing: { justifyContent: 'flex-start' },
  doorGlow: {
    height: 360,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  doorHero: { alignItems: 'center', gap: space[4] },
  doorMark: {
    alignItems: 'center',
    backgroundColor: color.emberWashStrong,
    borderColor: color.emberLine,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: space[20],
    justifyContent: 'center',
    width: space[20],
  },
  flowLoud: { flex: 1.4 },
  flowQuiet: { flex: 1 },
  flowRow: { flexDirection: 'row', gap: space[2] },
  localBadge: {
    backgroundColor: color.surfaceOverlay,
    borderRadius: radius.pill,
    left: space[2],
    padding: space[1],
    position: 'absolute',
    top: space[2],
  },
  localOff: {
    alignItems: 'center',
    flex: 1,
    gap: space[2],
    justifyContent: 'center',
    padding: space[2],
  },
  moment: {
    alignItems: 'center',
    backgroundColor: color.surfaceOverlay,
    borderColor: color.statusPositive,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space[3],
    left: space[3],
    padding: space[3],
    position: 'absolute',
    right: space[3],
  },
  momentBody: { flex: 1 },
  momentMark: {
    alignItems: 'center',
    backgroundColor: color.statusPositiveWash,
    borderRadius: radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  notices: { left: space[3], position: 'absolute', right: space[3] },
  peer: { alignItems: 'center', gap: space[3] },
  /* The ground the words get once there is a face behind them. */
  peerCarried: {
    backgroundColor: color.surfaceOverlay,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  /* A soft ring behind the person, so the hero is a portrait rather than a
     monogram floating in a void. */
  peerHalo: {
    alignItems: 'center',
    borderColor: color.borderHairline,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    padding: space[3],
  },
  /*
   * The reveal changes opacity and nothing about the arrangement, so a match
   * arrives rather than swapping one layout for another under somebody's eyes.
   */
  peerRevealing: { opacity: 0.55 },
  person: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[4],
  },
  personBody: { flex: 1, gap: space[2] },
  pip: {
    backgroundColor: color.canvasDeep,
    borderColor: color.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    elevation: 12,
    height: previewHeight,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    width: 112,
  },
  pulse: {
    alignItems: 'center',
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  pulseCore: {
    alignItems: 'center',
    backgroundColor: color.emberWashStrong,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pulseRing: {
    borderColor: color.ember,
    borderRadius: radius.pill,
    borderWidth: 2,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  pipLeft: { left: space[3] },
  pipRight: { right: space[3] },
  pref: {
    alignItems: 'center',
    backgroundColor: color.surface2,
    borderColor: color.borderHairline,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space[2],
    minHeight: layout.minimumTouchTarget,
    paddingHorizontal: space[3],
  },
  prefOn: { backgroundColor: color.emberWash, borderColor: color.emberLine },
  prefs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    justifyContent: 'center',
  },
  reaction: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: layout.minimumTouchTarget,
    justifyContent: 'center',
    width: layout.minimumTouchTarget,
  },
  reactions: {
    alignSelf: 'flex-end',
    backgroundColor: color.surface2,
    borderColor: color.borderSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space[1],
    padding: space[2],
  },
  scenarioToggle: {
    alignSelf: 'flex-start',
    backgroundColor: color.surfaceOverlay,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  scenarios: {
    left: space[3],
    position: 'absolute',
    right: space[3],
    zIndex: 3,
  },
  searching: { alignItems: 'center', gap: space[4] },
  /* The send affordance keeps the accent a labelled pill had, and gives the
     room back to what is being typed. */
  send: {
    backgroundColor: color.ember,
    borderRadius: radius.pill,
  },
  simulation: {
    // A ground of its own, so the developer's panel does not print itself over
    // the product it is there to drive. It is absent in any deployed build.
    backgroundColor: color.canvasDeep,
    borderColor: color.borderSoft,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: space[2],
    marginTop: space[2],
    padding: space[3],
  },
  simulationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  simulationChip: {
    backgroundColor: color.surface2,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: layout.minimumTouchTarget,
    paddingHorizontal: space[3],
  },
  stage: { backgroundColor: color.canvasDeep, flex: 1 },
  step: { flex: 1 },
  strip: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: space[3],
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1,
  },
  topScrim: { left: 0, position: 'absolute', right: 0, top: 0 },
  unread: {
    backgroundColor: color.ember,
    borderRadius: radius.pill,
    height: 8,
    position: 'absolute',
    right: 2,
    top: 2,
    width: 8,
  },
});
