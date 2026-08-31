import { lockPair } from '../database/pair-lock.js';
import type { RtcCallEligibilityPort } from './eligibility.js';
import {
  maximumRtcJoinIssuancesPerSession,
  maximumRtcJoinIssuancesPerUser,
  rtcAbuseWindowMilliseconds,
  rtcJoinCredentialTtlMilliseconds,
  type RtcCallMedium,
} from './policy.js';
import type { RtcProviderPort } from './provider.js';
import { participantRoleOf, type RtcRepository } from './repository.js';

/**
 * What a caller is handed, and the whole of it.
 *
 * The credential is a secret with a deadline. It is returned to exactly one
 * already-authorized principal and is written nowhere: not to a column, not to
 * a log, not to a trace, not to an outbox, not to a metric. What is durable is
 * that an issuance happened, to whom, under which authorization generation.
 */
export interface JoinAuthorization {
  readonly credential: string;
  readonly expiresAt: Date;
  readonly medium: RtcCallMedium;
  readonly providerReference: string;
  readonly sessionId: string;
}

export type JoinAuthorizationOutcome =
  | { readonly kind: 'authorization'; readonly value: JoinAuthorization }
  /** Answered identically to a call that does not exist. */
  | { readonly kind: 'not_found' }
  /** The call is not in a state that admits anybody, or the pair may not talk. */
  | { readonly kind: 'not_permitted' }
  /**
   * A minting bound was reached. Says only that: reporting which bound, or how
   * much of it remains, would publish a measure of somebody's calling.
   */
  | { readonly kind: 'rate_limited' }
  /** No provider is approved, so there is nothing to join. */
  | { readonly kind: 'unavailable' };

/**
 * The gate every join credential passes through.
 *
 * A credential is the one thing this platform hands out that a third party will
 * honour without asking again. Everything here follows from that.
 *
 * It is issued per participant, per session, per issuance. There is no room
 * secret and no shared credential, because a shared one cannot be revoked for
 * one person and hands each participant the other's access.
 *
 * Eligibility is composed again at the moment of issuance rather than inherited
 * from the acceptance that preceded it. Acceptance proves somebody answered; it
 * proves nothing about whether they may still talk now. A block landing between
 * the two therefore refuses the credential.
 *
 * The session's authorization generation is carried into the credential. Every
 * terminal transition advances it, so a credential minted under an earlier
 * generation is dead at this boundary immediately — before, and independently
 * of, whatever the provider still believes. That is the only part of revocation
 * this platform fully controls, and it is why the lifetime below is minutes.
 */
export class RtcJoinAuthorizationService {
  constructor(
    private readonly dependencies: {
      readonly eligibility: RtcCallEligibilityPort;
      readonly now: () => Date;
      readonly provider: RtcProviderPort;
      readonly repository: RtcRepository;
    },
  ) {}

  /**
   * Issues one participant's means of joining, or refuses.
   *
   * The participant is derived from the authenticated principal and the
   * session's own rows. Nothing a caller supplies contributes a participant, a
   * scope, a lifetime, or a provider — which is what makes "user A can never
   * receive a credential for user B" a property of the code rather than of the
   * request handler that happens to call it.
   */
  async issue(input: {
    readonly actorId: string;
    readonly sessionId: string;
  }): Promise<JoinAuthorizationOutcome> {
    if (this.dependencies.provider.provider === 'unavailable') {
      return { kind: 'unavailable' };
    }

    const now = this.dependencies.now();
    const decision = await this.dependencies.repository.transaction(
      async (executor) => {
        const found = await this.dependencies.repository.findById(
          executor,
          input.sessionId,
        );
        if (found === undefined) return 'unknown' as const;

        // Membership decides, and it is read rather than claimed. A caller who
        // is not a participant is answered exactly as one asking about a call
        // that does not exist, so an identifier discloses nothing.
        const role = participantRoleOf(found.participants, input.actorId);
        if (role === undefined) return 'unknown' as const;

        // The pair lock before the row lock, so a safety decision about these
        // two people either precedes this issuance or waits for it.
        await lockPair(
          executor,
          found.session.pairLowId,
          found.session.pairHighId,
        );
        const held = await this.dependencies.repository.lockById(
          executor,
          input.sessionId,
        );
        if (held === undefined) return 'unknown' as const;

        // Only a call that has been answered and is still live admits anybody.
        // An invitation nobody accepted, and anything terminal, refuse.
        if (
          held.state !== 'accepted' &&
          held.state !== 'connecting' &&
          held.state !== 'active' &&
          held.state !== 'reconnecting'
        ) {
          return 'refused' as const;
        }
        if (held.providerReference === null) return 'refused' as const;

        // Composed again, here, inside this transaction. Not inherited from the
        // acceptance, and never read from a cache.
        if (
          !(await this.dependencies.eligibility.mayCall({
            executor,
            first: held.pairLowId,
            now,
            // The session's own purpose, read from the row rather than assumed.
            // A random live session is re-authorized against the encounter that
            // created it, and a call against the introduction, on every single
            // issuance — which is what makes an encounter that has just ended
            // refuse the reconnect somebody's client is already attempting.
            purpose: held.purpose,
            second: held.pairHighId,
          }))
        ) {
          return 'refused' as const;
        }

        // The last line, not the first: eligibility above has already decided
        // whether this person may be admitted at all. These bound how often
        // minting itself may happen — per person, and per call, which is what
        // bounds an endpoint reconnecting in a loop.
        const since = new Date(now.getTime() - rtcAbuseWindowMilliseconds);
        if (
          (await this.dependencies.repository.countIssuancesSince(executor, {
            since,
            userId: input.actorId,
          })) >= maximumRtcJoinIssuancesPerUser ||
          (await this.dependencies.repository.countIssuancesForSessionSince(
            executor,
            { sessionId: input.sessionId, since, userId: input.actorId },
          )) >= maximumRtcJoinIssuancesPerSession
        ) {
          return 'limited' as const;
        }

        return {
          authorizationGeneration: held.authorizationGeneration,
          medium: held.medium,
          providerReference: held.providerReference,
        };
      },
    );

    if (decision === 'unknown') return { kind: 'not_found' };
    if (decision === 'refused') return { kind: 'not_permitted' };
    if (decision === 'limited') return { kind: 'rate_limited' };

    // Outside the transaction, deliberately: minting reaches a provider, and a
    // pooled connection held across somebody else's network is a connection the
    // admission bound cannot account for.
    const grant = await this.dependencies.provider.issueParticipantGrant({
      authorizationGeneration: decision.authorizationGeneration,
      medium: decision.medium,
      // The participant reference is the platform's own identifier for this
      // person in this call. It is never the account identifier, so a provider
      // never learns one.
      participantReference: participantReferenceFor({
        actorId: input.actorId,
        sessionId: input.sessionId,
      }),
      providerReference: decision.providerReference,
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });

    // Recorded after the fact and without the secret: that an issuance
    // happened, for whom, under which generation, and when it stops working.
    await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.recordIssuance(executor, {
        authorizationGeneration: decision.authorizationGeneration,
        expiresAt: grant.expiresAt,
        now,
        sessionId: input.sessionId,
        userId: input.actorId,
      }),
    );

    return {
      kind: 'authorization',
      value: {
        credential: grant.credential,
        expiresAt: grant.expiresAt,
        medium: decision.medium,
        providerReference: decision.providerReference,
        sessionId: input.sessionId,
      },
    };
  }
}

/**
 * The name a provider knows a participant by.
 *
 * Derived from the session and the account rather than being the account
 * identifier, so a provider — and anything a provider logs, exports, or leaks —
 * never holds a durable identifier for a person. It is stable within one call,
 * which is what a provider needs, and meaningless outside it.
 */
export function participantReferenceFor(input: {
  readonly actorId: string;
  readonly sessionId: string;
}): string {
  return Bun.hash(`${input.sessionId}:${input.actorId}`).toString(16);
}
