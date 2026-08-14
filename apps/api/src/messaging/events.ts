import { isUuid } from '../events/payload.js';

/**
 * The facts MESSAGING publishes, and the only shape another domain may read.
 *
 * A published event is a contract in the sense
 * `docs/architecture/04-contracts-events.md` means it: a past-tense fact with
 * an immutable identity and a versioned name, carrying the minimum a reader
 * needs and nothing more. It is not an instruction. NOTIFICATIONS decides what,
 * if anything, to do about a message having been sent; this domain only states
 * that one was.
 *
 * The payload deliberately does not contain the message body, the sender's
 * name, or anything else that would end up on a lock screen. `docs/flows/
 * notification-delivery.md` requires notification copy to minimize message text
 * and identity, and the cheapest way to keep a body out of a push notification
 * is for the body never to leave this domain in the first place.
 */

export const messageSentEventName = 'messaging.message.sent.v1';
export const messageSentEventVersion = 1;
export const conversationSubjectType = 'messaging.conversation';

export interface MessageSentEvent {
  readonly conversationId: string;
  readonly messageId: string;
  /** The participant who did not send it. */
  readonly recipientId: string;
  readonly senderId: string;
  /** The message's position in the conversation's server-assigned order. */
  readonly sequence: number;
}

/**
 * Reads a stored payload back into the contract.
 *
 * A consumer parses rather than casts. The row was written by an earlier
 * version of this code and read by a later one, and a payload that no longer
 * matches has to fail as a routing error the relay can retry and retire — not
 * as an undefined field surfacing three calls away.
 */
export function parseMessageSentEvent(
  payload: unknown,
): MessageSentEvent | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const candidate = payload as Record<string, unknown>;
  if (
    !isUuid(candidate.conversationId) ||
    !isUuid(candidate.messageId) ||
    !isUuid(candidate.recipientId) ||
    !isUuid(candidate.senderId) ||
    typeof candidate.sequence !== 'number' ||
    !Number.isInteger(candidate.sequence) ||
    candidate.sequence < 1 ||
    candidate.recipientId === candidate.senderId
  ) {
    return undefined;
  }
  return {
    conversationId: candidate.conversationId,
    messageId: candidate.messageId,
    recipientId: candidate.recipientId,
    senderId: candidate.senderId,
    sequence: candidate.sequence,
  };
}
