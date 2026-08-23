'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiResult, Call, CallMedium } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import { Dialog } from '../design/dialog';
import { Icon } from '../design/icons';
import {
  Avatar,
  Badge,
  BlockedState,
  Button,
  ErrorMessage,
  StatusMessage,
} from '../design/primitives';
import { useSingleFlight } from './resource';

/**
 * A call, from the invitation to the ending.
 *
 * A call is placed against a mutual introduction and against nothing else. There
 * is no field anywhere here for naming somebody — no identifier input, no handle
 * lookup, no dialler — because the server derives the other party from the
 * relationship and refuses a request that names one.
 *
 * Voice and video are separate entry points rather than one control with a
 * medium toggle: agreeing to be heard is not agreeing to be seen, and a toggle
 * carrying the last choice forward would make the more exposing option the
 * default for somebody who never chose it.
 *
 * What the server says is what is displayed. Every action re-reads, because a
 * call can be overtaken between the click and the answer — the other person
 * hangs up, the invitation expires, a block lands. Reaching for a pair that
 * already has a live call returns that call, on the correct side of it, which is
 * how somebody meets a call they did not place.
 *
 * **No credential is retained.** Joining asks the server for one and drops it:
 * there is nothing to hand it to, because no media stack is opened, no track is
 * captured, and no provider is contacted. Asking again on every join and every
 * reconnect is what lets a block landing mid-call take effect rather than being
 * outlived by a credential minted before it.
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

/** How often an open call re-reads itself. Not a ring; a read. */
const pollIntervalMilliseconds = 3000;

export function CallDialog({
  counterpart,
  introductionId,
  medium,
  onClose,
}: {
  readonly counterpart: { readonly displayName: string; readonly id: string };
  readonly introductionId: string;
  readonly medium: CallMedium;
  readonly onClose: () => void;
}) {
  const api = useApi();
  const [call, setCall] = useState<Call | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState(false);
  const [starting, setStarting] = useState(true);
  const action = useSingleFlight();
  const started = useRef(false);

  const apply = useCallback((result: ApiResult<Call>) => {
    if (isOk(result)) {
      setCall(result.value);
      setMessage(undefined);
      return;
    }
    if (result.kind === 'refused' && result.code === 'DEPENDENCY_UNAVAILABLE') {
      setBlocked(true);
      return;
    }
    setMessage(failureMessage(result));
  }, []);

  useEffect(() => {
    // Placed once. React runs an effect twice in development, and a second
    // request here would be a second call rather than a second read.
    if (started.current) return;
    started.current = true;
    void api.call({ introductionId, medium }).then((result) => {
      setStarting(false);
      apply(result);
    });
  }, [api, apply, introductionId, medium]);

  const live = call !== undefined && liveCallStates.has(call.state);

  // While a call is live this reads it again on a short interval. It is not a
  // ring and it is not a realtime transport: it is the same authoritative read
  // every action performs, repeated so an ending on the other side arrives
  // without somebody having to press something to find out.
  useEffect(() => {
    if (call === undefined || !live) return undefined;
    const callId = call.id;
    const timer = setInterval(() => {
      void api.readCall(callId).then((result) => {
        if (isOk(result)) setCall(result.value);
      });
    }, pollIntervalMilliseconds);
    return () => {
      clearInterval(timer);
    };
  }, [api, call, live]);

  const act = (work: () => Promise<ApiResult<Call>>) => {
    action.run(async () => {
      apply(await work());
    });
  };

  /**
   * Asks for a credential, and keeps none.
   *
   * What the request proves is that the server would admit this person right
   * now; the secret it carries has no consumer on this surface, so it is
   * deliberately not bound to anything and not stored.
   */
  const join = (callId: string) => {
    action.run(async () => {
      const authorization = await api.joinAuthorization(callId);
      if (
        authorization.kind === 'refused' &&
        authorization.code === 'DEPENDENCY_UNAVAILABLE'
      ) {
        setBlocked(true);
        return;
      }
      setMessage(failureMessage(authorization));
      // The call is re-read rather than inferred from the issuance: obtaining a
      // credential says nothing about whether the other side is still there.
      const current = await api.readCall(callId);
      if (isOk(current)) setCall(current.value);
    });
  };

  return (
    <Dialog
      onClose={onClose}
      testId="call-dialog"
      title={medium === 'video' ? 'Video call' : 'Voice call'}
    >
      {blocked ? (
        <BlockedState
          testId="call-blocked"
          title="Calling is not switched on yet"
        >
          <p>
            VELORA can set a call up between two people who have been
            introduced, but no approved provider exists to carry the audio or
            video, so no call can actually connect. Nothing was sent to{' '}
            {counterpart.displayName}.
          </p>
        </BlockedState>
      ) : (
        <div className="v-call" data-testid="call-panel">
          <div
            className={`v-call__halo${
              call?.state === 'invited' ? ' v-call__halo--ringing' : ''
            }`}
          >
            <Avatar
              displayName={counterpart.displayName}
              seed={counterpart.id}
              size="lg"
            />
          </div>

          <div className="v-stack v-stack--2" style={{ alignItems: 'center' }}>
            <p className="v-heading">{counterpart.displayName}</p>
            <p className="v-inline v-inline--tight" data-testid="call-state">
              <Icon name={medium === 'video' ? 'video' : 'phone'} size="sm" />
              <span className="v-muted">
                {starting
                  ? 'Setting up…'
                  : call === undefined
                    ? message === undefined
                      ? 'Not started'
                      : 'Could not start'
                    : (callStateLabels[call.state] ?? call.state)}
              </span>
            </p>
            {call?.endReason === undefined ? null : (
              <Badge testId="call-end-reason" tone="neutral">
                {endReasonLabels[call.endReason] ?? 'Ended'}
              </Badge>
            )}
          </div>

          {live ? (
            <p className="v-caption v-quiet v-measure">
              VELORA is holding this call open, but there is no audio or video
              yet: no approved provider exists to carry it.
            </p>
          ) : null}

          {message === undefined ? null : (
            <ErrorMessage testId="call-message">{message}</ErrorMessage>
          )}
          {starting ? (
            <StatusMessage testId="call-starting">Setting up…</StatusMessage>
          ) : null}

          {/*
            A dialog always offers a way out. When the server refused to place
            the call at all there is no call to act on, and a panel whose only
            exit was Escape would strand somebody who reaches for a control.
          */}
          {call === undefined ? (
            starting ? null : (
              <div className="v-call__actions">
                <Button data-testid="call-dismiss" onClick={onClose}>
                  Close
                </Button>
              </div>
            )
          ) : (
            <div className="v-call__actions">
              {call.state === 'invited' && call.role === 'recipient' ? (
                <>
                  <Button
                    busy={action.busy}
                    data-testid="call-accept"
                    icon="phone"
                    onClick={() => {
                      act(async () => api.acceptCall(call.id));
                    }}
                    tone="primary"
                  >
                    Answer
                  </Button>
                  <Button
                    data-testid="call-reject"
                    disabled={action.busy}
                    icon="phoneOff"
                    onClick={() => {
                      act(async () => api.rejectCall(call.id));
                    }}
                    tone="danger"
                  >
                    Decline
                  </Button>
                </>
              ) : null}

              {call.state === 'invited' && call.role === 'caller' ? (
                <Button
                  data-testid="call-cancel"
                  disabled={action.busy}
                  icon="phoneOff"
                  onClick={() => {
                    act(async () => api.cancelCall(call.id));
                  }}
                  tone="danger"
                >
                  Cancel
                </Button>
              ) : null}

              {call.state === 'accepted' ||
              call.state === 'connecting' ||
              call.state === 'reconnecting' ? (
                <Button
                  busy={action.busy}
                  data-testid="call-join"
                  onClick={() => {
                    join(call.id);
                  }}
                  tone="primary"
                >
                  {call.state === 'reconnecting' ? 'Reconnect' : 'Join'}
                </Button>
              ) : null}

              {live && call.state !== 'invited' ? (
                <Button
                  data-testid="call-end"
                  disabled={action.busy}
                  icon="phoneOff"
                  onClick={() => {
                    act(async () => api.endCall(call.id));
                  }}
                  tone="danger"
                >
                  Hang up
                </Button>
              ) : null}

              {live ? null : (
                <Button data-testid="call-dismiss" onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {blocked ? (
        <div className="v-dialog__actions">
          <Button data-testid="call-blocked-close" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * The two ways to start a call, offered where the relationship is.
 *
 * Separate controls rather than a medium toggle, for the reason above.
 */
export function CallControls({
  counterpart,
  disabled = false,
  introductionId,
  size = 'md',
}: {
  readonly counterpart: { readonly displayName: string; readonly id: string };
  readonly disabled?: boolean;
  readonly introductionId: string;
  readonly size?: 'sm' | 'md';
}) {
  const [medium, setMedium] = useState<CallMedium | undefined>(undefined);
  return (
    <>
      <Button
        data-testid={`call-voice-${introductionId}`}
        disabled={disabled}
        icon="phone"
        onClick={() => {
          setMedium('voice');
        }}
        size={size === 'sm' ? 'sm' : 'md'}
      >
        Voice
      </Button>
      <Button
        data-testid={`call-video-${introductionId}`}
        disabled={disabled}
        icon="video"
        onClick={() => {
          setMedium('video');
        }}
        size={size === 'sm' ? 'sm' : 'md'}
      >
        Video
      </Button>
      {medium === undefined ? null : (
        <CallDialog
          counterpart={counterpart}
          introductionId={introductionId}
          medium={medium}
          onClose={() => {
            setMedium(undefined);
          }}
        />
      )}
    </>
  );
}
