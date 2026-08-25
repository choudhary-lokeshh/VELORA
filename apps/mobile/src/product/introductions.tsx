import type {
  ApiResult,
  Call,
  CallMedium,
  Introduction,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Inline,
  Notice,
  RowSkeleton,
  Stack,
  Text,
} from '../design/primitives';
import { color, space } from '../design/tokens';
import {
  useResource,
  useRevalidateOnForeground,
  useSingleFlight,
} from './resource';
import { portraitReferences, useMediaAddresses } from './imagery';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Introductions, and the calling that belongs to them.
 *
 * Calling is not a destination. A call is placed against a mutual introduction
 * and against nothing else — the server derives who the other party is from the
 * relationship — so a "Calls" tab would be a list of the same people under a
 * second name, with a field somewhere that took a person. It lives here, where
 * the relationship is.
 *
 * **No call on this surface carries media, and the screen says so.** It drives
 * the lifecycle — invite, answer, decline, withdraw, hang up, authorize a join
 * — against REALTIME's authority, and opens no microphone, no camera, no audio
 * route, and no peer connection. It asks for no device permission, because a
 * permission prompt for a capability that does not exist teaches somebody to
 * grant one for nothing. `docs/surfaces/02-consumer-mobile.md` records why
 * native media is blocked rather than partially built.
 *
 * One rule makes the phone-specific cases fall out rather than needing special
 * handling: **the server is the only authority on what a call is.** This screen
 * holds no participant list, no eligibility answer, and no state that could
 * contradict the server. Coming back to the foreground re-reads, so a call that
 * ended while the screen was off is reported as ended. A cold start holds
 * nothing, so a notice tapped hours later cannot resurrect a finished call. A
 * handover from Wi-Fi to cellular is a failed request followed by a re-read.
 * Answering on another device makes this one stale at its next question, which
 * it asks after every action.
 */

const pageSize = 20;

/** How a state reads to the person holding the phone. */
const callStateLabels: Readonly<Record<string, string>> = {
  accepted: 'Answered',
  active: 'Connected',
  cancelled: 'Withdrawn',
  connecting: 'Connecting',
  ended: 'Ended',
  ending: 'Ending',
  expired: 'No answer',
  failed: 'Could not connect',
  invited: 'Ringing',
  reconnecting: 'Reconnecting',
  rejected: 'Declined',
};

/**
 * Why a call ended, in the vocabulary the person is entitled to.
 *
 * `ended_by_platform` is deliberately coarse. It is what the server sends when a
 * safety decision ended the call, and telling a block from an enforcement here
 * would publish the other person's decision to the person it was taken about.
 */
const endReasonLabels: Readonly<Record<string, string>> = {
  declined: 'Declined',
  ended_by_platform: 'Ended by VELORA',
  hung_up: 'Hung up',
  invitation_expired: 'No answer',
  join_timeout: 'Could not connect',
  provider_unavailable: 'Calling is unavailable',
  reconnect_expired: 'Connection lost',
  withdrawn: 'Withdrawn',
};

/** States in which a call still exists and can still be acted on. */
const liveCallStates = new Set([
  'invited',
  'accepted',
  'connecting',
  'active',
  'reconnecting',
  'ending',
]);

/** States in which the server will consider admitting somebody. */
const joinableCallStates = new Set(['accepted', 'connecting', 'reconnecting']);

/** A live call is loud; everything else is quiet. */
function callTone(state: string): 'accent' | 'positive' | 'neutral' {
  if (state === 'invited') return 'accent';
  return liveCallStates.has(state) ? 'positive' : 'neutral';
}

export function IntroductionsScreen() {
  const api = useApi();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.introductions({ pageSize }, signal),
    [api],
  );
  const introductions = useResource(load);
  const [call, setCall] = useState<Call | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  /**
   * Applies a re-read, and clears the screen only on an authoritative answer.
   *
   * The distinction matters most in the case this surface meets most often. A
   * phone handing over from Wi-Fi to cellular produces `unavailable` — the
   * request never reached anybody — and treating that as "the call is gone"
   * would blank a live call every time somebody walked out of a building. Only
   * `not-found`, which is the server saying it has no such call for this
   * person, takes the card away.
   */
  const applyCurrent = useCallback((current: ApiResult<Call>) => {
    if (isOk(current)) setCall(current.value);
    else if (current.kind === 'not-found') setCall(undefined);
  }, []);

  useRevalidateOnForeground(
    useCallback(() => {
      introductions.reload();
      if (call === undefined) return;
      void api.readCall(call.id).then(applyCurrent);
    }, [api, applyCurrent, call, introductions]),
  );

  const act = (work: () => Promise<ApiResult<unknown>>, success?: string) => {
    run(async () => {
      const result = await work();
      const failure = failureMessage(result);
      if (failure !== undefined) toast.show(failure, 'critical');
      else if (success !== undefined) toast.show(success, 'positive');
      introductions.reload();
    });
  };

  const actOnCall = (work: () => Promise<ApiResult<Call>>) => {
    run(async () => {
      const result = await work();
      const failure = failureMessage(result);
      if (failure !== undefined) toast.show(failure, 'critical');
      // Read back rather than assumed. The action may have been refused because
      // the other device answered first, because the invitation expired, or
      // because safety ended it — and the server's answer is the one that
      // counts in every one of those.
      if (isOk(result)) setCall(result.value);
      else if (call !== undefined) applyCurrent(await api.readCall(call.id));
    });
  };

  /**
   * Asks for a credential, and keeps none.
   *
   * Called on joining and again on every reconnect, never cached across either.
   * What the request proves is that the server would admit this person right
   * now; the secret it carries has no consumer on this surface, because this
   * surface opens no media.
   */
  const authorize = (callId: string) => {
    run(async () => {
      const failure = failureMessage(await api.joinAuthorization(callId));
      if (failure !== undefined) toast.show(failure, 'critical');
      applyCurrent(await api.readCall(callId));
    });
  };

  const rows = introductions.value?.introductions ?? [];
  const portraits = useMediaAddresses(
    portraitReferences(rows.map((row) => row.counterpart)),
    'avatar_large',
  );
  const answered = !introductions.loading || introductions.value !== undefined;

  return (
    <Screen
      onRefresh={introductions.reload}
      refreshing={introductions.loading && rows.length > 0}
      scroll={false}
      subtitle="Everybody who said yes, and everybody waiting on one."
      testID="introductions-screen"
      title="Introductions"
    >
      {call === undefined ? null : (
        <View style={styles.callHolder}>
          <CurrentCall
            call={call}
            onAccept={() => {
              actOnCall(async () => api.acceptCall(call.id));
            }}
            onCancel={() => {
              actOnCall(async () => api.cancelCall(call.id));
            }}
            onDismiss={() => {
              setCall(undefined);
            }}
            onEnd={() => {
              actOnCall(async () => api.endCall(call.id));
            }}
            onJoin={() => {
              authorize(call.id);
            }}
            onReject={() => {
              actOnCall(async () => api.rejectCall(call.id));
            }}
            pending={busy}
          />
        </View>
      )}

      {/*
        Said before a call is placed rather than only once one is ringing.
        Somebody who presses Voice expecting to be heard has already been
        misled, and a notice that only appears on the call card arrives too
        late to be honest.
      */}
      {call === undefined && rows.some((row) => row.state === 'mutual') ? (
        <View style={styles.mediaNotice}>
          <Notice
            testID="calls-media-unavailable"
            title="Calls carry no sound yet"
          >
            You can place a call, answer one, and hang up. This device cannot
            open a microphone or a camera for it.
          </Notice>
        </View>
      ) : null}

      {!answered ? (
        <Card>
          <RowSkeleton rows={3} />
        </Card>
      ) : introductions.error !== undefined && rows.length === 0 ? (
        <ErrorState
          body={introductions.error}
          testID="introductions-failed"
          {...(introductions.retryable
            ? { onRetry: introductions.reload }
            : {})}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          body="When you and somebody else both say you are interested, you appear here and can open a conversation."
          icon="link"
          testID="introductions-empty"
          title="No introductions yet"
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={[...rows]}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <IntroductionCard
              busy={busy}
              introduction={item}
              portrait={portraits.get(item.counterpart.media[0]?.id ?? '')}
              onAccept={() => {
                act(
                  async () => api.signalIntroduction(item.counterpart.id),
                  'Said yes. You can open a conversation now.',
                );
              }}
              onBlocked={introductions.reload}
              onCall={(medium) => {
                actOnCall(async () =>
                  api.call({ introductionId: item.id, medium }),
                );
              }}
              onOpen={() => {
                act(
                  async () => api.openConversation(item.id),
                  'Conversation opened. It is under Messages.',
                );
              }}
              onWithdraw={() => {
                act(
                  async () => api.withdrawIntroduction(item.id),
                  'Withdrawn. They are not told.',
                );
              }}
              placing={call !== undefined}
            />
          )}
          showsVerticalScrollIndicator={false}
          testID="introductions-list"
        />
      )}
    </Screen>
  );
}

function IntroductionCard({
  busy,
  introduction,
  onAccept,
  onBlocked,
  onCall,
  onOpen,
  onWithdraw,
  placing,
  portrait,
}: {
  readonly busy: boolean;
  readonly introduction: Introduction;
  readonly onAccept: () => void;
  readonly onBlocked: () => void;
  readonly onCall: (medium: CallMedium) => void;
  readonly onOpen: () => void;
  readonly onWithdraw: () => void;
  readonly placing: boolean;
  /** A short-lived address, or nothing to show. */
  readonly portrait: string | undefined;
}) {
  const mutual = introduction.state === 'mutual';
  const person = {
    displayName: introduction.counterpart.displayName,
    id: introduction.counterpart.id,
  };

  return (
    <Card testID={`introduction-${introduction.id}`}>
      <Stack gap={4}>
        <View style={styles.identity}>
          <Avatar
            displayName={person.displayName}
            seed={person.id}
            source={portrait}
          />
          <View style={styles.identityText}>
            <Text
              accessibilityRole="header"
              variant="subheading"
              weight="semibold"
            >
              {person.displayName}
            </Text>
            {mutual ? (
              <Badge icon="check" tone="positive">
                You both said yes
              </Badge>
            ) : introduction.role === 'initiator' ? (
              <Badge icon="clock" tone="caution">
                Waiting for them
              </Badge>
            ) : (
              <Badge icon="heart" tone="accent">
                They are interested
              </Badge>
            )}
          </View>
          <PersonSafetyMenu onBlocked={onBlocked} person={person} />
        </View>

        {mutual ? (
          <Stack gap={3}>
            <Button
              disabled={busy}
              icon="message"
              onPress={onOpen}
              testID={`open-${introduction.id}`}
              tone="primary"
              wide
            >
              Open conversation
            </Button>
            {/*
              Voice and video are separate controls rather than a medium switch,
              because they are separate consents: agreeing to be heard is not
              agreeing to be seen, and a switch that remembered the last choice
              would make the more exposing option the default for somebody who
              never chose it.
            */}
            <Inline gap={2}>
              <View style={styles.half}>
                <Button
                  disabled={busy || placing}
                  icon="phone"
                  onPress={() => {
                    onCall('voice');
                  }}
                  testID={`call-voice-${introduction.id}`}
                  wide
                >
                  Voice
                </Button>
              </View>
              <View style={styles.half}>
                <Button
                  disabled={busy || placing}
                  icon="video"
                  onPress={() => {
                    onCall('video');
                  }}
                  testID={`call-video-${introduction.id}`}
                  wide
                >
                  Video
                </Button>
              </View>
            </Inline>
          </Stack>
        ) : introduction.role === 'recipient' ? (
          <Button
            disabled={busy}
            icon="heart"
            onPress={onAccept}
            testID={`accept-${introduction.id}`}
            tone="primary"
            wide
          >
            Say you are interested too
          </Button>
        ) : (
          <Button
            disabled={busy}
            onPress={onWithdraw}
            testID={`withdraw-${introduction.id}`}
            tone="secondary"
            wide
          >
            Withdraw
          </Button>
        )}
      </Stack>
    </Card>
  );
}

/**
 * The call in front of the person right now.
 *
 * Which controls exist is decided by the role and the state the server
 * reported. Only a recipient answers or declines, only a caller withdraws, and
 * either may hang up once there is something to hang up. A control the server
 * would refuse is not rendered disabled — it is not rendered, so a stale screen
 * cannot offer an action that would fail.
 */
export function CurrentCall({
  call,
  onAccept,
  onCancel,
  onDismiss,
  onEnd,
  onJoin,
  onReject,
  pending,
}: {
  readonly call: Call;
  readonly onAccept: () => void;
  readonly onCancel: () => void;
  readonly onDismiss: () => void;
  readonly onEnd: () => void;
  readonly onJoin: () => void;
  readonly onReject: () => void;
  readonly pending: boolean;
}) {
  const live = liveCallStates.has(call.state);
  const ringing = call.state === 'invited';

  return (
    <Card testID="call-current" tone="surface2">
      <Stack gap={4}>
        <View style={styles.identity}>
          <Avatar
            displayName={call.counterpart.displayName}
            seed={call.counterpart.id}
          />
          <View style={styles.identityText}>
            <Text
              accessibilityRole="header"
              testID="call-counterpart"
              variant="subheading"
              weight="semibold"
            >
              {call.counterpart.displayName}
            </Text>
            <Inline gap={2} wrap>
              <Badge
                icon={call.medium === 'video' ? 'video' : 'phone'}
                testID="call-state"
                tone={callTone(call.state)}
              >
                {callStateLabels[call.state] ?? call.state}
              </Badge>
              {call.endReason === undefined ? null : (
                <Badge testID="call-end-reason">
                  {endReasonLabels[call.endReason] ?? 'Ended'}
                </Badge>
              )}
            </Inline>
          </View>
        </View>

        <Notice testID="call-no-media" title="This call carries no sound">
          Calls cannot open a microphone or a camera on this device yet. You can
          place one, answer one, and hang up.
        </Notice>

        <Stack gap={2}>
          {ringing && call.role === 'recipient' ? (
            <Inline gap={2}>
              <View style={styles.half}>
                <Button
                  disabled={pending}
                  onPress={onReject}
                  testID="call-reject"
                  tone="danger"
                  wide
                >
                  Decline
                </Button>
              </View>
              <View style={styles.half}>
                <Button
                  disabled={pending}
                  icon="phone"
                  onPress={onAccept}
                  testID="call-accept"
                  tone="primary"
                  wide
                >
                  Answer
                </Button>
              </View>
            </Inline>
          ) : null}

          {ringing && call.role === 'caller' ? (
            <Button
              disabled={pending}
              onPress={onCancel}
              testID="call-cancel"
              tone="secondary"
              wide
            >
              Cancel
            </Button>
          ) : null}

          {joinableCallStates.has(call.state) ? (
            <Button
              disabled={pending}
              icon="refresh"
              onPress={onJoin}
              testID="call-join"
              tone="primary"
              wide
            >
              {call.state === 'reconnecting' ? 'Reconnect' : 'Join'}
            </Button>
          ) : null}

          {live && !ringing ? (
            <Button
              disabled={pending}
              icon="phoneOff"
              onPress={onEnd}
              testID="call-end"
              tone="danger"
              wide
            >
              Hang up
            </Button>
          ) : null}

          {live ? null : (
            <Button
              disabled={pending}
              onPress={onDismiss}
              testID="call-dismiss"
              tone="ghost"
              wide
            >
              Dismiss
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}

const styles = StyleSheet.create({
  callHolder: {
    borderBottomColor: color.borderHairline,
    borderBottomWidth: 1,
    paddingBottom: space[4],
  },
  half: { flex: 1 },
  mediaNotice: { paddingTop: space[4] },
  identity: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space[3],
  },
  identityText: { alignItems: 'flex-start', flex: 1, gap: space[2] },
  list: { gap: space[4], paddingBottom: space[6], paddingTop: space[4] },
});
