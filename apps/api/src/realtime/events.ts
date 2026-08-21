import { isUuid } from '../events/payload.js';

/**
 * The facts REALTIME publishes, and the only shape another domain may read.
 *
 * A published event is a past-tense fact with an immutable identity and a
 * versioned name. It is not an instruction: NOTIFICATIONS decides what, if
 * anything, to tell somebody about a call having been placed, and this domain
 * only states that one was.
 *
 * The payloads carry identifiers and nothing else. No display name, no medium,
 * no provider reference, no credential, and no reason — because the cheapest
 * way to keep any of those off a lock screen is for them never to leave this
 * domain. A call notice needs to say that somebody is calling and open the
 * call; it does not need to say who, in the payload, or on what.
 *
 * Both facts are written by the same transaction as the lifecycle transition
 * they describe, so a process killed immediately afterwards cannot leave a call
 * nobody was told about, or a missed call nobody recorded.
 */

export const callInvitedEventName = 'realtime.call.invited.v1';
export const callInvitedEventVersion = 1;
export const callMissedEventName = 'realtime.call.missed.v1';
export const callMissedEventVersion = 1;
export const callSubjectType = 'realtime.call';

/** Somebody is being called, right now. */
export interface CallInvitedEvent {
  readonly callId: string;
  /** Who placed it. Never the recipient. */
  readonly callerId: string;
  /** Who is being called. */
  readonly recipientId: string;
}

/**
 * A call went unanswered.
 *
 * Derived from the lifecycle rather than from a delivery outcome: an invitation
 * whose own deadline passed is missed whether or not anybody's device ever rang.
 * That is what keeps "missed" honest when a push is lost.
 */
export interface CallMissedEvent {
  readonly callId: string;
  readonly callerId: string;
  readonly recipientId: string;
}

function parseCallEvent(
  payload: unknown,
): { callId: string; callerId: string; recipientId: string } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const candidate = payload as Record<string, unknown>;
  if (
    !isUuid(candidate.callId) ||
    !isUuid(candidate.callerId) ||
    !isUuid(candidate.recipientId) ||
    candidate.callerId === candidate.recipientId
  ) {
    return undefined;
  }
  return {
    callId: candidate.callId,
    callerId: candidate.callerId,
    recipientId: candidate.recipientId,
  };
}

/**
 * Reads a stored payload back into the contract.
 *
 * A consumer parses rather than casts. The row was written by an earlier
 * version of this code and read by a later one, and a payload that no longer
 * matches has to fail as a routing error the relay can retry and retire — not
 * as an undefined field surfacing three calls away.
 */
export function parseCallInvitedEvent(
  payload: unknown,
): CallInvitedEvent | undefined {
  return parseCallEvent(payload);
}

export function parseCallMissedEvent(
  payload: unknown,
): CallMissedEvent | undefined {
  return parseCallEvent(payload);
}
