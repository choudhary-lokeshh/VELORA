import type {
  ApiResult,
  LiveEncounter,
  LiveMedium,
  LiveMessage,
  LiveSimulationScenario,
  LiveState,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';
import { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../design/icons';
import {
  Actions,
  Avatar,
  Badge,
  BlockedState,
  Button,
  EmptyState,
  ErrorMessage,
  IconButton,
  Inline,
  Notice,
  Stack,
  StatusMessage,
  Text,
} from '../design/primitives';
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
import { useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Live discovery, on a phone.
 *
 * The screen a person opens the application for, and the one arranged most
 * carefully around a thumb. Four rules shape it, and they are the same four the
 * web surface follows because it is one product.
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
 * no approved provider carries media — the pane says so in words instead of
 * being a black rectangle that implies a connection.
 *
 * **Next and End are always under a thumb.** They sit in a fixed control row
 * above the tab bar, inside the safe area, and the chat scrolls inside itself
 * so that filling it can never push them off the screen.
 */

/** How often the surface re-reads while it is waiting for somebody. */
const searchPollMilliseconds = 2000;
/** How often it re-reads while in an encounter. Also how presence is kept. */
const encounterPollMilliseconds = 3000;
/** How often the live chat re-reads. Faster: it is a conversation. */
const messagePollMilliseconds = 2000;

/** Where the person is, which is not where the server is. */
type Stage = 'closed' | 'open';

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
  connected: 'You are connected',
  none: 'Connect',
  received: 'They want to connect',
  requested: 'Waiting for them',
};

const scenarios: readonly {
  readonly label: string;
  readonly value: LiveSimulationScenario;
}[] = [
  { label: 'They say something', value: 'peer_message' },
  { label: 'They press Connect', value: 'peer_connect' },
  { label: 'They move on', value: 'peer_next' },
  { label: 'They disappear', value: 'peer_disconnect' },
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
  const [medium, setMedium] = useState<LiveMedium>('video');
  const [state, setState] = useState<LiveState | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const action = useSingleFlight();
  const media = useLiveMedia({ enabled: stage === 'open' });

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
          ? api.startLiveSearch(medium)
          : api.liveState()
      ).then((result) => {
        if (isOk(result)) setState(result.value);
      });
    }, interval);
    return () => {
      clearInterval(timer);
    };
  }, [api, medium, serverState, stage]);

  const start = (chosen: LiveMedium) => {
    setMedium(chosen);
    setStage('open');
    // The permission is asked for as part of starting, so the system prompt
    // arrives with the screen that explains why — and deliberately *beside*
    // the search rather than in front of it. A prompt somebody leaves
    // unanswered must not stop them being matched: the pool does not care
    // whether a camera is open, and everything but the preview works without
    // one.
    if (chosen === 'video') void media.request();
    action.run(async () => {
      apply(await api.startLiveSearch(chosen));
    });
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
    return <LiveDoor busy={action.busy} onStart={start} testID="live-door" />;
  }

  return (
    <KeyboardAvoidingView
      // On Android the window is resized for the keyboard, so nothing has to be
      // pushed; on iOS it overlays, and padding is what keeps the composer
      // above it. Getting this wrong is what puts a text field under a keyboard
      // somebody cannot dismiss.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.room}
      testID="live-room"
    >
      <View style={styles.stage}>
        {serverState === 'matched' && encounter !== undefined ? (
          <RemotePane encounter={encounter} onOpenPerson={onOpenPerson} />
        ) : serverState === 'ended' && encounter !== undefined ? (
          <EndedPane
            encounter={encounter}
            onOpenConversation={onOpenConversation}
          />
        ) : (
          <SearchingPane />
        )}
        <LocalPreview media={media} medium={medium} />
      </View>

      {serverState === 'matched' && encounter !== undefined ? (
        <LiveChat encounter={encounter} />
      ) : null}

      <PermissionNotice media={media} />

      {message === undefined ? null : (
        <ErrorMessage testID="live-message">{message}</ErrorMessage>
      )}

      {state?.simulated === true ? (
        <SimulationPanel
          onApplied={(next) => {
            setState(next);
          }}
        />
      ) : null}

      <View
        style={[
          styles.controls,
          // The controls sit above the tab bar and clear the gesture inset, so
          // Next and End are never under the system's own handle.
          { paddingBottom: Math.max(insets.bottom, space[2]) },
        ]}
      >
        <MediaControls
          busy={action.busy}
          encounter={serverState === 'matched' ? encounter : undefined}
          media={media}
          onLeave={leave}
          onState={setState}
          onNext={(encounterId) => {
            action.run(async () => {
              apply(await api.advanceLiveEncounter(encounterId));
            });
          }}
          onSearchAgain={() => {
            action.run(async () => {
              apply(await api.startLiveSearch(medium));
            });
          }}
          serverState={serverState}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function LiveDoor({
  busy,
  onStart,
  testID,
}: {
  readonly busy: boolean;
  readonly onStart: (medium: LiveMedium) => void;
  readonly testID: string;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.door}
      testID={testID}
      // Scrollable so the door survives 200 % text, where the explanation and
      // both controls are taller than a phone.
    >
      <View style={styles.doorMark}>
        <Icon color={color.ember} name="live" size="lg" />
      </View>
      <Text variant="title" weight="bold">
        Meet someone
      </Text>
      <Text tone="secondary" variant="body">
        VELORA will find one other person who is here right now and put the two
        of you together. Talk for as long as it is good, connect if you both
        want to, and move on whenever you like.
      </Text>
      <Stack gap={3}>
        <Inline gap={3}>
          <Icon color={color.ember} name="camera" size="sm" />
          <Text style={styles.step} tone="secondary" variant="small">
            Your camera opens when you press start.
          </Text>
        </Inline>
        <Inline gap={3}>
          <Icon color={color.ember} name="live" size="sm" />
          <Text style={styles.step} tone="secondary" variant="small">
            VELORA finds somebody eligible. You never choose who.
          </Text>
        </Inline>
        <Inline gap={3}>
          <Icon color={color.ember} name="link" size="sm" />
          <Text style={styles.step} tone="secondary" variant="small">
            Connect only becomes a connection if you both press it.
          </Text>
        </Inline>
      </Stack>
      <Actions>
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
          Start with video
        </Button>
        <Button
          disabled={busy}
          icon="phone"
          onPress={() => {
            onStart('voice');
          }}
          size="large"
          testID="live-start-voice"
          wide
        >
          Voice only
        </Button>
      </Actions>
      <Text tone="tertiary" variant="caption">
        Nothing is recorded. VELORA stores no video, no audio, and no transcript
        of a live session, and no setting turns that on.
      </Text>
    </ScrollView>
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
  encounter,
  onOpenPerson,
}: {
  readonly encounter: LiveEncounter;
  readonly onOpenPerson: (personId: string) => void;
}) {
  const transport = encounter.call?.mediaTransport ?? 'none';
  return (
    <View style={styles.peer} testID="live-peer">
      <Avatar
        displayName={encounter.peer.displayName}
        seed={encounter.peer.id}
        size="large"
      />
      <Text testID="live-peer-name" variant="heading" weight="semibold">
        {encounter.peer.displayName}
      </Text>
      <Badge testID="live-connection" tone="neutral">
        {connectionCopy[encounter.connection.state] ?? 'Connect'}
      </Badge>
      {transport === 'none' ? (
        <Text
          style={styles.centred}
          testID="live-no-media"
          tone="tertiary"
          variant="caption"
        >
          You are in a live session with {encounter.peer.displayName}, and no
          approved provider exists yet to carry their camera or their voice. The
          chat below is live and everything else on this screen is real.
        </Text>
      ) : (
        <Text testID="live-media-carried" tone="tertiary" variant="caption">
          Connected.
        </Text>
      )}
      <Inline gap={2}>
        <Button
          icon="user"
          onPress={() => {
            onOpenPerson(encounter.peer.id);
          }}
          size="small"
          testID="live-peer-profile"
        >
          View profile
        </Button>
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
 * No count of anybody. There is no presence projection behind this product, so
 * a number here would be one this screen invented.
 */
function SearchingPane() {
  return (
    <View style={styles.searching} testID="live-searching">
      <View style={styles.pulse} />
      <StatusMessage testID="live-searching-status">
        Finding someone…
      </StatusMessage>
      <Text style={styles.centred} tone="tertiary" variant="caption">
        VELORA is looking for one other person who is here right now and who you
        have not just met.
      </Text>
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
 * The person's own camera.
 *
 * `CameraView` is mounted only while `media.active` is true, which is false the
 * moment the application leaves the foreground — unmounting is what releases
 * the device on Android, and a bound camera behind another app's window is a
 * camera nobody remembers is open.
 */
function LocalPreview({
  media,
  medium,
}: {
  readonly media: LiveMediaState;
  readonly medium: LiveMedium;
}) {
  const showing = medium === 'video' && media.active;
  return (
    <View style={styles.local} testID="live-local">
      {showing ? (
        <CameraView
          facing={media.facing}
          style={StyleSheet.absoluteFill}
          testID="live-local-camera"
        />
      ) : (
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
      <View style={styles.localBadge} testID="live-mic-state">
        <Icon
          // Muted reads as muted whatever the transport says. What the badge
          // never does is claim the microphone is *carrying* anything: nothing
          // is, and the pane above says so in words.
          color={
            media.microphoneOn && media.microphoneAvailable
              ? color.textSecondary
              : color.statusCritical
          }
          name={media.microphoneOn ? 'mic' : 'micOff'}
          size="sm"
        />
      </View>
    </View>
  );
}

function MediaControls({
  busy,
  encounter,
  media,
  onLeave,
  onNext,
  onSearchAgain,
  onState,
  serverState,
}: {
  readonly busy: boolean;
  readonly encounter: LiveEncounter | undefined;
  readonly media: LiveMediaState;
  readonly onLeave: () => void;
  readonly onNext: (encounterId: string) => void;
  readonly onSearchAgain: () => void;
  readonly onState: (state: LiveState) => void;
  readonly serverState: LiveState['state'];
}) {
  const api = useApi();
  const connect = useSingleFlight();
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Stack gap={2}>
      <Inline gap={2}>
        <IconButton
          label={
            media.microphoneOn
              ? 'Mute your microphone'
              : 'Unmute your microphone'
          }
          name={media.microphoneOn ? 'mic' : 'micOff'}
          onPress={media.toggleMicrophone}
          testID="live-toggle-mic"
        />
        <IconButton
          label={
            media.cameraOn ? 'Turn your camera off' : 'Turn your camera on'
          }
          name={media.cameraOn ? 'camera' : 'cameraOff'}
          onPress={media.toggleCamera}
          testID="live-toggle-camera"
        />
        <IconButton
          label="Switch camera"
          name="cameraSwitch"
          onPress={media.switchCamera}
          testID="live-switch-camera"
        />
      </Inline>

      <Inline gap={2}>
        {encounter === undefined ? null : (
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
            testID="live-connect"
            tone={
              encounter.connection.state === 'connected'
                ? 'secondary'
                : 'primary'
            }
          >
            {connectionCopy[encounter.connection.state] ?? 'Connect'}
          </Button>
        )}

        {encounter === undefined ? (
          serverState === 'ended' || serverState === 'idle' ? (
            <Button
              busy={busy}
              icon="live"
              onPress={onSearchAgain}
              testID="live-search-again"
              tone="primary"
            >
              Meet someone else
            </Button>
          ) : null
        ) : (
          <Button
            busy={busy}
            icon="refresh"
            onPress={() => {
              onNext(encounter.id);
            }}
            testID="live-next"
          >
            Next
          </Button>
        )}

        <Button
          disabled={busy}
          icon="x"
          onPress={onLeave}
          testID="live-end"
          tone="danger"
        >
          End
        </Button>
      </Inline>

      {error === undefined ? null : (
        <ErrorMessage testID="live-connect-error">{error}</ErrorMessage>
      )}
    </Stack>
  );
}

/**
 * What to say when Android has not given the camera over.
 *
 * Never a dead end, and never the same sentence for two different situations.
 * `denied` is answered by asking again, `blocked` only by the settings screen —
 * calling `request` there returns `denied` instantly with nothing on screen,
 * which is a button that does nothing.
 */
function PermissionNotice({ media }: { readonly media: LiveMediaState }) {
  if (media.permission === 'granted') return null;

  if (media.permission === 'unavailable') {
    return (
      <Notice
        testID="live-permission-unavailable"
        title="No camera on this device"
        tone="neutral"
      >
        This build cannot use a camera. You can still meet people and talk to
        them in the chat.
      </Notice>
    );
  }

  return (
    <Notice
      testID="live-permission-denied"
      title="VELORA does not have your camera"
      tone="caution"
    >
      {media.permission === 'blocked'
        ? 'Android will not ask again, so it has to be turned on in Settings. Everything else works without it — you can still be matched, chat, and connect.'
        : 'VELORA needs access to the camera so the person you meet can see you. Everything else works without it.'}
    </Notice>
  );
}

/**
 * The live chat, which is not the Inbox and says so.
 *
 * The transcript scrolls inside itself rather than growing the screen: a chat
 * that pushed the controls down as it filled would eventually put Next and End
 * under the keyboard, which are the two controls that must never be hard to
 * reach.
 */
function LiveChat({ encounter }: { readonly encounter: LiveEncounter }) {
  const api = useApi();
  const [messages, setMessages] = useState<readonly LiveMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const send = useSingleFlight();
  const listRef = useRef<ScrollView | null>(null);
  const encounterId = encounter.id;

  // A new encounter is a new conversation. Cleared on the identifier rather
  // than on a mount, because this component does not unmount between
  // encounters — the camera must not blink.
  useEffect(() => {
    setMessages([]);
    setDraft('');
    setError(undefined);
  }, [encounterId]);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void api.liveMessages(encounterId).then((result) => {
        if (cancelled || !isOk(result)) return;
        // Guarded on the encounter the answer is *about*. A reply that arrives
        // after Next has already moved somebody on describes a conversation
        // they are no longer in.
        if (result.value.encounterId !== encounterId) return;
        setMessages(result.value.messages);
      });
    };
    read();
    const timer = setInterval(read, messagePollMilliseconds);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, encounterId]);

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
          setMessages(result.value.messages);
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

  return (
    <View style={styles.chat} testID="live-chat">
      <Inline gap={2}>
        <Icon color={color.textTertiary} name="clock" size="sm" />
        <Text style={styles.step} tone="tertiary" variant="caption">
          This chat lives in this conversation only. It does not go to your
          Inbox unless you both connect.
        </Text>
      </Inline>

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
        <Button
          busy={send.busy}
          icon="send"
          onPress={submit}
          testID="live-chat-send"
          tone="primary"
        >
          Send
        </Button>
      </Inline>

      {error === undefined ? null : (
        <ErrorMessage testID="live-chat-error">{error}</ErrorMessage>
      )}
    </View>
  );
}

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

const styles = StyleSheet.create({
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
  centred: { textAlign: 'center' },
  chat: {
    backgroundColor: color.surface1,
    borderColor: color.borderHairline,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[2],
    marginTop: space[3],
    padding: space[3],
  },
  chatList: { maxHeight: 180 },
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
  controls: {
    borderTopColor: color.borderHairline,
    borderTopWidth: 1,
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[3],
  },
  door: {
    alignItems: 'flex-start',
    gap: space[4],
    padding: space[5],
  },
  doorMark: {
    alignItems: 'center',
    backgroundColor: color.emberWashStrong,
    borderColor: color.emberLine,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: space[14],
    justifyContent: 'center',
    width: space[14],
  },
  local: {
    backgroundColor: color.canvasDeep,
    borderColor: color.borderSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    bottom: space[4],
    height: 148,
    overflow: 'hidden',
    position: 'absolute',
    right: space[4],
    width: 108,
  },
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
  peer: { alignItems: 'center', gap: space[3] },
  pulse: {
    backgroundColor: color.emberWashStrong,
    borderColor: color.emberLine,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: space[16],
    width: space[16],
  },
  room: { flex: 1 },
  searching: { alignItems: 'center', gap: space[3] },
  simulation: {
    borderColor: color.borderSoft,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: space[2],
    marginHorizontal: space[4],
    marginTop: space[3],
    padding: space[3],
  },
  simulationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  simulationChip: {
    backgroundColor: color.surface2,
    borderRadius: radius.pill,
    minHeight: layout.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: space[3],
  },
  stage: {
    alignItems: 'center',
    backgroundColor: color.surfaceInset,
    flex: 1,
    justifyContent: 'center',
    padding: space[5],
  },
  step: { flex: 1 },
});
