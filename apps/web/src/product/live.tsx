'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';

import type {
  ApiResult,
  LiveEncounter,
  LiveMedium,
  LiveMessage,
  LiveSimulationScenario,
  LiveState,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Avatar,
  Badge,
  BlockedState,
  Button,
  ButtonLink,
  EmptyState,
  ErrorMessage,
  IconButton,
  Notice,
  PageHeader,
  StatusMessage,
} from '../design/primitives';
import { useLiveMedia, type LiveMediaState } from './live-media';
import { useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Live discovery: meet somebody at random, right now.
 *
 * This is the primary reason to open VELORA, and the screen is arranged around
 * that rather than around the domain behind it. Four rules shape it.
 *
 * **Nothing opens a camera except a person asking for it.** Landing here shows
 * a door, not a viewfinder. The devices open when somebody presses a control
 * that says what pressing it will do, and they close again the moment the
 * screen is left, the tab is hidden, or the page goes away.
 *
 * **Two state machines, kept apart.** The server owns where a person is —
 * idle, searching, matched, ended — and this owns where their *devices* are.
 * They are deliberately not merged: the server has no opinion about whether a
 * camera is open, and a client that told it so would be asserting a fact about
 * itself that the server would then be storing.
 *
 * **The screen says what is true.** There is no online count, because no
 * presence projection exists and a number here would be invented. There is no
 * remote video, because no approved provider carries media — and rather than an
 * empty black rectangle implying a connection that is not there, the remote
 * pane says so in words. When a provider is configured, the same pane says that
 * instead, from the server's own answer rather than from a build flag.
 *
 * **Moving on is one press, and so is stopping.** Next and End are always
 * reachable and never behind a menu, because the moment somebody wants either
 * is the moment they should not have to look for it.
 */

/** How often the surface re-reads while it is waiting for somebody. */
const searchPollMilliseconds = 2000;
/** How often it re-reads while in an encounter. Also how presence is kept. */
const encounterPollMilliseconds = 3000;
/** How often the live chat re-reads. Faster: it is a conversation. */
const messagePollMilliseconds = 2000;

/**
 * Where the *person* is, which is not where the server is.
 *
 * `closed` is the door. `opening` is the browser's permission prompt.
 * `ready` is a preview with nobody on the other side yet, and everything after
 * that is the server's state rendered around a preview that is already open.
 */
type Stage = 'closed' | 'opening' | 'ready';

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
  connected: 'You are connected',
  none: 'Connect',
  received: 'They want to connect',
  requested: 'Waiting for them',
};

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
    help: 'No stand-in is offered until you ask for something else, so searching finds nobody.',
    label: 'Nobody is available',
    value: 'nobody_available',
  },
];

export function Live() {
  const api = useApi();
  const [stage, setStage] = useState<Stage>('closed');
  const [medium, setMedium] = useState<LiveMedium>('video');
  const [state, setState] = useState<LiveState | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const action = useSingleFlight();

  const media = useLiveMedia({
    enabled: stage !== 'closed',
    wantsAudio: true,
    wantsVideo: medium === 'video',
  });

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
   * what actually allocates somebody — so the screen that says "Finding
   * someone" is the screen doing the finding. Everywhere else it reads, which
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
          ? api.startLiveSearch(medium)
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
  }, [api, medium, serverState, stage]);

  const start = (chosen: LiveMedium) => {
    setMedium(chosen);
    setStage('opening');
    action.run(async () => {
      apply(await api.startLiveSearch(chosen));
    });
  };

  const next = (encounterId: string) => {
    action.run(async () => {
      apply(await api.advanceLiveEncounter(encounterId));
    });
  };

  const searchAgain = () => {
    action.run(async () => {
      apply(await api.startLiveSearch(medium));
    });
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
        Named for the person rather than for the state. The shell's own bar
        hands the page name back and forth with this heading, so a screen
        without one is a screen the bar never stops naming — and a heading that
        changed as the state changed would rename the page under somebody
        mid-encounter.
      */}
      <PageHeader
        lede="Meet one other person who is here right now."
        title="Live"
      />

      {stage === 'closed' ? (
        <LiveDoor busy={action.busy} onStart={start} />
      ) : (
        <LiveRoom
          busy={action.busy}
          encounter={encounter}
          media={media}
          medium={medium}
          onLeave={leave}
          onNext={next}
          onSearchAgain={searchAgain}
          onState={setState}
          serverState={serverState}
        />
      )}

      {message === undefined ? null : (
        <ErrorMessage testId="live-message">{message}</ErrorMessage>
      )}

      {state?.simulated === true && stage !== 'closed' ? (
        <SimulationPanel onState={setState} />
      ) : null}
    </div>
  );
}

/**
 * The door.
 *
 * Deliberately not a viewfinder. It says what is about to happen, in the order
 * it will happen, and then offers two ways in — because agreeing to be heard is
 * not agreeing to be seen, and a single control carrying whichever was chosen
 * last would make the more exposing option the default for somebody who never
 * chose it.
 */
function LiveDoor({
  busy,
  onStart,
}: {
  readonly busy: boolean;
  readonly onStart: (medium: LiveMedium) => void;
}) {
  return (
    <section className="v-live__door" data-testid="live-door">
      <span className="v-live__mark">
        <Icon name="live" size="lg" />
      </span>
      <h2 className="v-display">Meet someone</h2>
      <p className="v-live__lede v-measure">
        VELORA will find one other person who is here right now and put the two
        of you together. Talk for as long as it is good, connect if you both
        want to, and move on whenever you like.
      </p>
      <ul className="v-live__steps">
        <li>
          <Icon name="camera" size="sm" />
          <span>Your camera and microphone open when you press start.</span>
        </li>
        <li>
          <Icon name="live" size="sm" />
          <span>VELORA finds somebody eligible. You never choose who.</span>
        </li>
        <li>
          <Icon name="link" size="sm" />
          <span>Connect only becomes a connection if you both press it.</span>
        </li>
      </ul>
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
          Start with video
        </Button>
        <Button
          data-testid="live-start-voice"
          disabled={busy}
          icon="phone"
          onClick={() => {
            onStart('voice');
          }}
          size="lg"
        >
          Voice only
        </Button>
      </div>
      <p className="v-caption v-quiet v-measure">
        Nothing is recorded. VELORA stores no video, no audio, and no transcript
        of a live session, and no setting turns that on.
      </p>
    </section>
  );
}

/**
 * The room: a preview, whoever is on the other side, and the controls.
 *
 * One layout for every server state rather than four screens, because the
 * camera must not close and reopen between "searching" and "matched" — a
 * viewfinder that blinks every time somebody is found is a viewfinder that
 * looks broken, and reacquiring devices takes long enough to be seen.
 */
function LiveRoom({
  busy,
  encounter,
  media,
  medium,
  onLeave,
  onNext,
  onSearchAgain,
  onState,
  serverState,
}: {
  readonly busy: boolean;
  readonly encounter: LiveEncounter | undefined;
  readonly media: LiveMediaState;
  readonly medium: LiveMedium;
  readonly onLeave: () => void;
  readonly onNext: (encounterId: string) => void;
  readonly onSearchAgain: () => void;
  readonly onState: (state: LiveState) => void;
  readonly serverState: LiveState['state'];
}) {
  const live = serverState === 'matched' && encounter !== undefined;

  return (
    <div className="v-live__room" data-testid="live-room">
      <div className="v-live__stage">
        <div className="v-live__remote" data-testid="live-remote">
          {live ? (
            <RemotePane encounter={encounter} />
          ) : serverState === 'ended' && encounter !== undefined ? (
            <EndedPane encounter={encounter} />
          ) : (
            <SearchingPane />
          )}
        </div>

        <LocalPreview media={media} medium={medium} />
      </div>

      <MediaControls
        busy={busy}
        encounter={live ? encounter : undefined}
        media={media}
        onLeave={onLeave}
        onNext={onNext}
        onSearchAgain={onSearchAgain}
        onState={onState}
        serverState={serverState}
      />

      <PermissionNotice media={media} />

      {live ? <LiveChat encounter={encounter} onState={onState} /> : null}
    </div>
  );
}

/**
 * Whoever is on the other side, and an honest account of what is carrying them.
 *
 * There is no black rectangle here. A pane that looked like a video feed which
 * had not started would be the single most misleading thing on this screen, so
 * when nothing is carrying media it says so in words, next to the person's real
 * name and picture, which *are* real.
 */
function RemotePane({ encounter }: { readonly encounter: LiveEncounter }) {
  const transport = encounter.call?.mediaTransport ?? 'none';
  return (
    <div className="v-live__peer" data-testid="live-peer">
      <Avatar
        displayName={encounter.peer.displayName}
        seed={encounter.peer.id}
        size="lg"
      />
      <p className="v-title" data-testid="live-peer-name">
        {encounter.peer.displayName}
      </p>
      <Badge testId="live-connection" tone="neutral">
        {connectionCopy[encounter.connection.state] ?? 'Connect'}
      </Badge>
      {transport === 'none' ? (
        <p className="v-caption v-quiet v-measure" data-testid="live-no-media">
          You are in a live session with {encounter.peer.displayName}, and no
          approved provider exists yet to carry their camera or their voice. The
          chat below is live and everything else on this screen is real.
        </p>
      ) : (
        <p className="v-caption v-quiet" data-testid="live-media-carried">
          Connected.
        </p>
      )}
      <div className="v-live__peer-actions">
        <Link
          className="v-live__peer-link"
          data-testid="live-peer-profile"
          href={`/people/${encounter.peer.id}?from=/live`}
        >
          <Icon name="user" size="sm" />
          View profile
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
 * No count of who is waiting, no "247 people online", no ticking number. There
 * is no presence projection behind this product, so any number here would be
 * one this screen invented — and a person who found that out would be right to
 * distrust everything else on it.
 */
function SearchingPane() {
  return (
    <div className="v-live__searching" data-testid="live-searching">
      <span className="v-live__pulse" />
      <StatusMessage testId="live-searching-status">
        Finding someone…
      </StatusMessage>
      <p className="v-caption v-quiet v-measure">
        VELORA is looking for one other person who is here right now and who you
        have not just met.
      </p>
    </div>
  );
}

function EndedPane({ encounter }: { readonly encounter: LiveEncounter }) {
  const copy =
    endReasonCopy[encounter.endReason ?? ''] ?? endReasonCopy.peer_left;
  return (
    <div className="v-live__ended" data-testid="live-ended">
      <Avatar
        displayName={encounter.peer.displayName}
        seed={encounter.peer.id}
        size="md"
      />
      <p className="v-heading">{copy?.title ?? 'That conversation ended'}</p>
      <p className="v-small v-muted v-measure">{copy?.body ?? ''}</p>
      {encounter.connection.state === 'connected' &&
      encounter.connection.conversationId !== undefined ? (
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
              href={`/messages/${encounter.connection.conversationId}?from=/live`}
            >
              Open it
            </Link>
            .
          </p>
        </Notice>
      ) : encounter.connection.state === 'requested' ? (
        <p
          className="v-caption v-quiet v-measure"
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
 * `muted` is not a preference here: a preview that played its own microphone
 * back through the speakers would feed back the instant somebody unmuted, so it
 * is fixed rather than offered. `playsInline` keeps it in place on mobile
 * Safari, which otherwise takes any playing video full screen.
 */
function LocalPreview({
  media,
  medium,
}: {
  readonly media: LiveMediaState;
  readonly medium: LiveMedium;
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
    <div className="v-live__local" data-testid="live-local">
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

/**
 * The controls, in the order somebody reaches for them.
 *
 * Mute and camera first because they are the ones pressed in a hurry, Next and
 * End last and always present. Nothing here is behind a menu: the moment
 * somebody wants to stop being seen is not the moment to make them look for the
 * control that does it.
 */
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
  const [connectError, setConnectError] = useState<string | undefined>(
    undefined,
  );

  return (
    <div className="v-live__controls" data-testid="live-controls">
      <div className="v-live__device-controls">
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
        <IconButton
          data-testid="live-toggle-camera"
          label={
            media.cameraOn ? 'Turn your camera off' : 'Turn your camera on'
          }
          name={media.cameraOn ? 'camera' : 'cameraOff'}
          onClick={media.toggleCamera}
        />
        {media.switchable ? (
          <IconButton
            data-testid="live-switch-camera"
            label="Switch camera"
            name="cameraSwitch"
            onClick={media.switchCamera}
          />
        ) : null}
      </div>

      <div className="v-live__flow-controls">
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
              data-testid="live-search-again"
              icon="live"
              onClick={onSearchAgain}
              tone="primary"
            >
              Meet someone else
            </Button>
          ) : null
        ) : (
          <Button
            busy={busy}
            data-testid="live-next"
            icon="refresh"
            onClick={() => {
              onNext(encounter.id);
            }}
          >
            Next
          </Button>
        )}

        <Button
          data-testid="live-end"
          disabled={busy}
          icon="x"
          onClick={onLeave}
          tone="danger"
        >
          End
        </Button>
      </div>

      {connectError === undefined ? null : (
        <ErrorMessage testId="live-connect-error">{connectError}</ErrorMessage>
      )}
    </div>
  );
}

/**
 * What to say when the browser has not given the devices over.
 *
 * Never a dead end. `denied` can be answered by asking again, and asking again
 * is what the control does; `unavailable` cannot be answered by anybody, so it
 * offers no control at all rather than one that would do nothing. Live
 * discovery keeps working either way — searching, chat, Connect, and Next do
 * not need a camera — and that is said rather than left to be discovered.
 */
function PermissionNotice({ media }: { readonly media: LiveMediaState }) {
  if (media.permission === 'granted' || media.permission === 'requesting') {
    return null;
  }
  if (media.permission === 'idle') return null;

  if (media.permission === 'unavailable') {
    return (
      <Notice
        icon="cameraOff"
        testId="live-permission-unavailable"
        title="No camera on this device"
        tone="quiet"
      >
        <p>
          This browser has no camera or microphone available to it. You can
          still meet people and talk to them in the chat below.
        </p>
      </Notice>
    );
  }

  if (media.permission === 'failed') {
    return (
      <Notice
        icon="cameraOff"
        testId="live-permission-failed"
        title="Your camera could not be opened"
        tone="caution"
      >
        <p>
          The device is there and would not start. Another application holding
          it is the usual reason, and closing that one and pressing start again
          is the usual fix.
        </p>
        <p>
          Everything else works without it — you can still be matched, chat, and
          connect.
        </p>
      </Notice>
    );
  }

  return (
    <Notice
      icon="cameraOff"
      testId="live-permission-denied"
      title="VELORA does not have your camera"
      tone="caution"
    >
      <p>
        Your browser has not granted access. Allow it from the address bar and
        it will open here. If the browser has stopped asking, the permission has
        to be changed in this site&rsquo;s settings.
      </p>
      <p>
        Everything else works without it — you can still be matched, chat, and
        connect.
      </p>
    </Notice>
  );
}

/**
 * The live chat, which is not the Inbox and says so.
 *
 * What is typed here belongs to this encounter. It is not a conversation, it
 * does not appear in Messages, and when the encounter ends it stops being
 * reachable by either person — which is the product rule the whole feature
 * rests on. Saying it on the panel is cheaper than somebody discovering it.
 */
function LiveChat({
  encounter,
  onState,
}: {
  readonly encounter: LiveEncounter;
  readonly onState: (state: LiveState) => void;
}) {
  const api = useApi();
  const [messages, setMessages] = useState<readonly LiveMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const send = useSingleFlight();
  const listRef = useRef<HTMLDivElement | null>(null);
  const encounterId = encounter.id;

  // A new encounter is a new conversation. Clearing on the identifier rather
  // than on a mount is what stops the last stranger's words appearing under the
  // next one's name — the component does not unmount between encounters,
  // because the camera must not blink.
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
        // Guarded on the encounter the answer is *about*, not on the one that
        // was current when it was asked for. A reply that arrives after Next
        // has already moved somebody on describes a conversation they are no
        // longer in, and rendering it would put the previous stranger's
        // messages under the new one's name.
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

  useEffect(() => {
    const element = listRef.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (body.length === 0) return;
    send.run(async () => {
      const result = await api.sendLiveMessage({
        body,
        // Fresh per send and scoped to the encounter by the server, so a retry
        // after a dropped response writes one message rather than two.
        clientMessageId: newClientMessageId(),
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
      // The draft is deliberately kept. Somebody who typed something and lost
      // it to a failed send has lost the thing they were trying to say.
      setError(failureMessage(result));
      const current = await api.liveState();
      if (isOk(current)) onState(current.value);
    });
  };

  return (
    <section className="v-live__chat" data-testid="live-chat">
      <p className="v-live__chat-note v-micro v-quiet">
        <Icon name="clock" size="sm" />
        <span>
          This chat lives in this conversation only. It does not go to your
          Inbox unless you both connect.
        </span>
      </p>

      <div
        aria-label={`Live chat with ${encounter.peer.displayName}`}
        aria-live="polite"
        className="v-live__chat-list"
        data-testid="live-chat-list"
        ref={listRef}
        role="log"
      >
        {messages.length === 0 ? (
          <p className="v-caption v-quiet">Say something.</p>
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
        <Button
          busy={send.busy}
          data-testid="live-chat-send"
          icon="send"
          tone="primary"
          type="submit"
        >
          Send
        </Button>
      </form>

      {error === undefined ? null : (
        <ErrorMessage testId="live-chat-error">{error}</ErrorMessage>
      )}
    </section>
  );
}

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
  const [last, setLast] = useState<string | undefined>(undefined);

  return (
    <section className="v-live__sim" data-testid="live-simulation">
      <p className="v-label">Local scenarios</p>
      <p className="v-caption v-quiet v-measure">
        This panel exists only in local development. Each of these acts as the
        other person, through the same endpoints their browser would call.
      </p>
      <div className="v-live__sim-actions">
        {scenarios.map((scenario) => (
          <Button
            data-testid={`live-sim-${scenario.value}`}
            disabled={run.busy}
            key={scenario.value}
            onClick={() => {
              run.run(async () => {
                const result = await api.applyLiveSimulation(scenario.value);
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
    </section>
  );
}

/**
 * A fresh idempotency key per send.
 *
 * The same `crypto.randomUUID()` every other write on this surface uses, so a
 * retry after a dropped response writes one message rather than two. It is
 * generated per send rather than held, because holding one would make two
 * different messages the same message to the server.
 */
function newClientMessageId(): string {
  return crypto.randomUUID();
}
