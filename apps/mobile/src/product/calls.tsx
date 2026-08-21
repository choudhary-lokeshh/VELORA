import type {
  ApiResult,
  Call,
  CallMedium,
  ConsumerApi,
  Introduction,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';
import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import {
  useResource,
  useRevalidateOnForeground,
  useSingleFlight,
} from './resource';
import { Action, ResourceState, Section, StatusMessage } from './ui';

/**
 * Calling, on a phone.
 *
 * **This surface carries no media, and says so.** It drives the call lifecycle
 * — invite, answer, decline, withdraw, hang up, authorize a join — against
 * REALTIME's existing authority over the ordinary bearer transport. It opens no
 * microphone, no camera, no audio route, and no peer connection, and it asks
 * for no permission it would not use. See
 * `docs/surfaces/02-consumer-mobile.md` for why native media is blocked rather
 * than partially built, and what would unblock it.
 *
 * Everything below follows from one rule: **the server is the only authority on
 * what a call is.** This app holds no participant list, no membership claim, no
 * eligibility answer, and no cached state that could contradict the server. It
 * asks, and it renders the answer.
 *
 * That rule is what makes the phone-specific cases fall out rather than needing
 * special handling. Coming back to the foreground re-reads, so a call that
 * ended while the screen was off is reported as ended. A cold start holds
 * nothing, so a notification tapped hours later cannot resurrect a call that is
 * over. A handover from Wi-Fi to cellular is a failed request followed by a
 * re-read, not a state machine of its own. And answering on another device
 * makes this one stale the moment it next asks — which it does after every
 * action — because the server records one acceptance and this device is simply
 * told what happened.
 *
 * No credential is retained. Joining asks for one and drops it: there is
 * nothing on this surface to hand it to, and a credential a third party would
 * honour without asking again is the one secret a phone should not be holding.
 * Asking again on every join and every reconnect is what lets a block landing
 * mid-call be enforced rather than outlived.
 */

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
 * `ended_by_platform` is deliberately coarse. It is what the server sends when
 * a safety decision ended the call, and telling a block from an enforcement
 * here would publish the other person's decision to the person it was taken
 * about.
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

const pageSize = 20;

export function CallsArea({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.introductions({ pageSize }, signal),
    [api],
  );
  const introductions = useResource(load);
  const [call, setCall] = useState<Call | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { busy: pending, run } = useSingleFlight();

  /**
   * Applies a re-read, and clears the screen only on an authoritative answer.
   *
   * The distinction matters most in exactly the case this surface meets most
   * often. A phone handing over from Wi-Fi to cellular produces `unavailable` —
   * the request never reached anybody — and treating that as "the call is gone"
   * would blank a live call every time somebody walked out of a building. Only
   * `not-found`, which is the server saying it has no such call for this
   * person, takes the card away.
   */
  const applyCurrent = useCallback((current: ApiResult<Call>) => {
    if (isOk(current)) setCall(current.value);
    else if (current.kind === 'not-found') setCall(undefined);
  }, []);

  /**
   * Coming back to the foreground re-reads the call, not just the list.
   *
   * The screen being off is the ordinary case on a phone, and the call can end
   * in any way while it is: the other person hangs up, the invitation expires,
   * a block lands, the reconnect grace runs out, or somebody answers on another
   * device. None of those reach this app while it is backgrounded, and none of
   * them need to — asking on the way back is what makes the surface correct
   * without holding anything.
   */
  useRevalidateOnForeground(
    useCallback(() => {
      introductions.reload();
      if (call === undefined) return;
      // A call the server no longer has is dropped, because a stale card
      // offering "Answer" is worse than nothing.
      void api.readCall(call.id).then(applyCurrent);
    }, [api, applyCurrent, call, introductions]),
  );

  const act = (work: () => Promise<ApiResult<Call>>) => {
    run(async () => {
      setNotice(undefined);
      const result = await work();
      setNotice(failureMessage(result));
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
      setNotice(undefined);
      setNotice(failureMessage(await api.joinAuthorization(callId)));
      applyCurrent(await api.readCall(callId));
    });
  };

  const mutual = (introductions.value?.introductions ?? []).filter(
    (row) => row.state === 'mutual',
  );

  return (
    <Section title="Calls">
      <ResourceState resource={introductions} testID="calls" />
      {notice === undefined ? null : (
        <StatusMessage testID="calls-notice">{notice}</StatusMessage>
      )}

      <StatusMessage testID="calls-media-unavailable">
        Calls cannot carry audio or video on this device yet. You can still
        place one, answer one, and hang up.
      </StatusMessage>

      {call === undefined ? null : (
        <CurrentCall
          call={call}
          onAccept={() => {
            act(async () => api.acceptCall(call.id));
          }}
          onCancel={() => {
            act(async () => api.cancelCall(call.id));
          }}
          onDismiss={() => {
            setCall(undefined);
          }}
          onEnd={() => {
            act(async () => api.endCall(call.id));
          }}
          onJoin={() => {
            authorize(call.id);
          }}
          onReject={() => {
            act(async () => api.rejectCall(call.id));
          }}
          pending={pending}
        />
      )}

      {!introductions.loading &&
      introductions.error === undefined &&
      mutual.length === 0 ? (
        <StatusMessage testID="calls-empty">
          You can call somebody once you both say you are interested.
        </StatusMessage>
      ) : null}

      <FlatList
        data={mutual}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <CallOffer
            introduction={item}
            onCall={(medium) => {
              act(async () => api.call({ introductionId: item.id, medium }));
            }}
            pending={pending || call !== undefined}
          />
        )}
        testID="calls-introductions"
      />
    </Section>
  );
}

/**
 * One person it is currently possible to call.
 *
 * Voice and video are separate controls rather than a medium switch, because
 * they are separate consents: agreeing to be heard is not agreeing to be seen,
 * and a switch that remembered the last choice would make the more exposing
 * option the default for somebody who never chose it. There is no field here
 * that takes a person — calling is placed against a relationship, and the
 * server derives who the other party is.
 */
function CallOffer({
  introduction,
  onCall,
  pending,
}: {
  readonly introduction: Introduction;
  readonly onCall: (medium: CallMedium) => void;
  readonly pending: boolean;
}) {
  return (
    <View testID={`call-offer-${introduction.id}`}>
      <Text accessibilityRole="header">
        {introduction.counterpart.displayName}
      </Text>
      <Action
        disabled={pending}
        label="Voice call"
        onPress={() => {
          onCall('voice');
        }}
        testID={`call-voice-${introduction.id}`}
      />
      <Action
        disabled={pending}
        label="Video call"
        onPress={() => {
          onCall('video');
        }}
        testID={`call-video-${introduction.id}`}
      />
    </View>
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
function CurrentCall({
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
    <View testID="call-current">
      <Text accessibilityRole="header" testID="call-counterpart">
        {call.counterpart.displayName}
      </Text>
      <Text testID="call-state">
        {callStateLabels[call.state] ?? call.state}
      </Text>
      <Text testID="call-medium">
        {call.medium === 'video' ? 'Video' : 'Voice'}
      </Text>
      {call.endReason === undefined ? null : (
        <Text testID="call-end-reason">
          {endReasonLabels[call.endReason] ?? 'Ended'}
        </Text>
      )}

      {ringing && call.role === 'recipient' ? (
        <>
          <Action
            disabled={pending}
            label="Answer"
            onPress={onAccept}
            testID="call-accept"
          />
          <Action
            disabled={pending}
            label="Decline"
            onPress={onReject}
            testID="call-reject"
          />
        </>
      ) : null}

      {ringing && call.role === 'caller' ? (
        <Action
          disabled={pending}
          label="Cancel"
          onPress={onCancel}
          testID="call-cancel"
        />
      ) : null}

      {joinableCallStates.has(call.state) ? (
        <Action
          disabled={pending}
          label={call.state === 'reconnecting' ? 'Reconnect' : 'Join'}
          onPress={onJoin}
          testID="call-join"
        />
      ) : null}

      {live && !ringing ? (
        <Action
          disabled={pending}
          label="Hang up"
          onPress={onEnd}
          testID="call-end"
        />
      ) : null}

      {live ? null : (
        <Action
          disabled={pending}
          label="Dismiss"
          onPress={onDismiss}
          testID="call-dismiss"
        />
      )}
    </View>
  );
}
