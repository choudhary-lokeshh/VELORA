import { isUuid } from '../events/payload.js';

/**
 * The facts DISCOVERY publishes.
 *
 * One fact in V1: two people who each independently signalled interest now have
 * a mutual introduction. It is a past-tense statement, not an instruction —
 * NOTIFICATIONS decides whether anybody is told, and this domain does not know
 * or care.
 *
 * Only the person who signalled first is named as the recipient. The one who
 * reciprocated performed the action synchronously and received the introduction
 * in the response to their own request; telling them again would be a
 * notification about something they just did. The initiator is the only side
 * for whom this is news.
 *
 * The payload carries identifiers and nothing else. No display name, no
 * profile field, no reason the two were surfaced to each other: a notice about
 * an introduction has to be renderable from an authorized read, not from
 * whatever a delivery payload happened to carry.
 */

export const introductionMutualEventName = 'discovery.introduction.mutual.v1';
export const introductionMutualEventVersion = 1;
export const introductionSubjectType = 'discovery.introduction';

export interface IntroductionMutualEvent {
  /** The person who signalled first, and the one being told. */
  readonly initiatorId: string;
  readonly introductionId: string;
  /** The person whose reciprocal signal completed it. */
  readonly respondingActorId: string;
}

export function parseIntroductionMutualEvent(
  payload: unknown,
): IntroductionMutualEvent | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const candidate = payload as Record<string, unknown>;
  if (
    !isUuid(candidate.initiatorId) ||
    !isUuid(candidate.introductionId) ||
    !isUuid(candidate.respondingActorId) ||
    // A fact that says somebody introduced themselves to themselves is
    // malformed, and a notice built from it would name the recipient as its own
    // subject.
    candidate.initiatorId === candidate.respondingActorId
  ) {
    return undefined;
  }
  return {
    initiatorId: candidate.initiatorId,
    introductionId: candidate.introductionId,
    respondingActorId: candidate.respondingActorId,
  };
}
