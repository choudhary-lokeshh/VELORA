'use client';

import { useCallback, useState } from 'react';

import type {
  ApiResult,
  Call,
  CallMedium,
  ConsumerApi,
  Introduction,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';
import { useResource, useRevalidateOnFocus, useSingleFlight } from './resource';
import { EmptyState, ResourceState, Section, StatusMessage } from './ui';

/**
 * Calling.
 *
 * A call is placed against a mutual introduction and against nothing else. This
 * surface therefore offers a call from an introduction the person already has,
 * and there is no field anywhere in it for naming somebody: no identifier
 * input, no handle lookup, no "call by number". That is not a convenience this
 * screen declined to build — the server derives the other party from the
 * relationship, so a request that named one would be refused.
 *
 * What the server says is what is displayed. A call's state is read back rather
 * than assumed from the action that was just taken, because an accepted call
 * can be overtaken between the click and the answer — the other person hangs
 * up, the invitation expires, a block lands. Every action here re-reads.
 *
 * No credential is retained at all. Joining asks the server for one and drops
 * it: there is nothing to hand it to, because no media stack is opened, no
 * track is captured, and no provider is contacted — no RTC provider is
 * approved, so in a deployed environment the server refuses to mint one in the
 * first place. When there is a media stack, the credential goes straight to it
 * and is still never stored, never put in the address, and never rendered.
 *
 * That is not only tidiness. A credential a third party honours without asking
 * again is the one secret this surface could leak, and the way to not leak it
 * is to not hold it. Asking again on every join and every reconnect costs a
 * round trip and buys the thing that matters: the server re-composes
 * eligibility at each issuance, so a block landing mid-call is enforced rather
 * than outlived by a credential minted before it.
 */

/** How a state reads to the person in the call. */
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
 * `ended_by_platform` is deliberately vague and deliberately not explained
 * further. It is what the server sends when a safety decision ended the call,
 * and distinguishing a block from an enforcement here would publish the other
 * person's decision to the one it was taken about.
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

export function CallsPanel({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.introductions({}, signal),
    [api],
  );
  const introductions = useResource(load);
  const [call, setCall] = useState<Call | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const action = useSingleFlight();

  useRevalidateOnFocus(introductions.reload);

  const act = (work: () => Promise<ApiResult<Call>>) => {
    action.run(async () => {
      setNotice(undefined);
      const result = await work();
      setNotice(failureMessage(result));
      if (isOk(result)) setCall(result.value);
    });
  };

  /**
   * Asks for a credential, and keeps none.
   *
   * Called on joining and again on every reconnect, never cached across either.
   * What the request proves is that the server would admit this person right
   * now; the secret it carries has no consumer on this surface yet, so it is
   * deliberately not bound to anything.
   */
  const authorize = (callId: string) => {
    action.run(async () => {
      setNotice(undefined);
      setNotice(failureMessage(await api.joinAuthorization(callId)));
      // The call is re-read rather than inferred from the issuance: obtaining a
      // credential says nothing about whether the other side is still there.
      const current = await api.readCall(callId);
      if (isOk(current)) setCall(current.value);
    });
  };

  const mutual = (introductions.value?.introductions ?? []).filter(
    (row) => row.state === 'mutual',
  );

  return (
    <Section headingId="calls-heading" title="Calls">
      <ResourceState resource={introductions} testId="calls" />
      {notice === undefined ? null : (
        <StatusMessage testId="calls-notice">{notice}</StatusMessage>
      )}

      {call === undefined ? null : (
        <CurrentCall
          busy={action.busy}
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
        />
      )}

      {!introductions.loading &&
      introductions.error === undefined &&
      mutual.length === 0 ? (
        <EmptyState testId="calls-empty">
          You can call somebody once you both say you are interested.
        </EmptyState>
      ) : null}

      <ul data-testid="calls-introductions">
        {mutual.map((row) => (
          <li key={row.id}>
            <CallOffer
              busy={action.busy || call !== undefined}
              introduction={row}
              onCall={(medium) => {
                act(async () => api.call({ introductionId: row.id, medium }));
              }}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * One person it is currently possible to call.
 *
 * Voice and video are separate buttons rather than a medium toggle, because
 * they are separate consents: agreeing to be heard is not agreeing to be seen,
 * and a control that carried the last choice forward would make the more
 * exposing option the default for somebody who never chose it.
 */
function CallOffer({
  busy,
  introduction,
  onCall,
}: {
  readonly busy: boolean;
  readonly introduction: Introduction;
  readonly onCall: (medium: CallMedium) => void;
}) {
  return (
    <div className="row">
      <span data-testid={`call-offer-${introduction.id}`}>
        {introduction.counterpart.displayName}
      </span>
      <button
        data-testid={`call-voice-${introduction.id}`}
        disabled={busy}
        onClick={() => {
          onCall('voice');
        }}
        type="button"
      >
        Voice call
      </button>
      <button
        data-testid={`call-video-${introduction.id}`}
        disabled={busy}
        onClick={() => {
          onCall('video');
        }}
        type="button"
      >
        Video call
      </button>
    </div>
  );
}

/**
 * The call in front of the person right now.
 *
 * Which controls exist is decided by the role and the state the server
 * reported, not by what this component would like to offer: only a recipient
 * answers or declines, only a caller withdraws, and either may hang up once
 * there is something to hang up. A control the server would refuse is not
 * rendered disabled — it is not rendered.
 */
function CurrentCall({
  busy,
  call,
  onAccept,
  onCancel,
  onDismiss,
  onEnd,
  onJoin,
  onReject,
}: {
  readonly busy: boolean;
  readonly call: Call;
  readonly onAccept: () => void;
  readonly onCancel: () => void;
  readonly onDismiss: () => void;
  readonly onEnd: () => void;
  readonly onJoin: () => void;
  readonly onReject: () => void;
}) {
  const live = liveCallStates.has(call.state);
  const ringing = call.state === 'invited';
  return (
    <div data-testid="call-current">
      <p data-testid="call-counterpart">{call.counterpart.displayName}</p>
      <p data-testid="call-state">
        {callStateLabels[call.state] ?? call.state}
      </p>
      <p data-testid="call-medium">
        {call.medium === 'video' ? 'Video' : 'Voice'}
      </p>
      {call.endReason === undefined ? null : (
        <p data-testid="call-end-reason">
          {endReasonLabels[call.endReason] ?? 'Ended'}
        </p>
      )}

      {ringing && call.role === 'recipient' ? (
        <div className="row">
          <button
            data-testid="call-accept"
            disabled={busy}
            onClick={onAccept}
            type="button"
          >
            Answer
          </button>
          <button
            data-testid="call-reject"
            disabled={busy}
            onClick={onReject}
            type="button"
          >
            Decline
          </button>
        </div>
      ) : null}

      {ringing && call.role === 'caller' ? (
        <button
          data-testid="call-cancel"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      ) : null}

      {call.state === 'accepted' ||
      call.state === 'connecting' ||
      call.state === 'reconnecting' ? (
        <button
          data-testid="call-join"
          disabled={busy}
          onClick={onJoin}
          type="button"
        >
          {call.state === 'reconnecting' ? 'Reconnect' : 'Join'}
        </button>
      ) : null}

      {live && !ringing ? (
        <button
          data-testid="call-end"
          disabled={busy}
          onClick={onEnd}
          type="button"
        >
          Hang up
        </button>
      ) : null}

      {live ? null : (
        <button
          data-testid="call-dismiss"
          disabled={busy}
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
