import { z } from 'zod';

/**
 * RTC call-control contract.
 *
 * V1 is one-to-one consumer voice and video. There is no group call, no room,
 * no livestream, no recording, no transcript, and no screen share in this
 * contract, because none of those is approved and a schema is the easiest place
 * for an unapproved capability to appear by accident.
 *
 * **No call is recorded.** Nothing here carries, references, or implies stored
 * media, and no surface built on this contract may claim or imply that a call
 * is recorded or could be.
 *
 * Three absences are deliberate and load-bearing:
 *
 * A request never names a participant. An invitation names the *introduction*
 * that already authorizes contact, and the server derives who the other person
 * is. That is what makes "a client cannot choose who it calls" a property of
 * the contract rather than of whichever handler happens to read it.
 *
 * A request never names a provider, a room, a credential scope, or a lifetime.
 * All four are server decisions taken from configuration, so no field exists
 * here for a caller to supply one.
 *
 * A response never carries transport detail. No SDP, no ICE candidate, no TURN
 * credential, no participant address, and no provider room identifier appears
 * in any shape below.
 */

/** What a call carries. Two values, and a third arrives as a decision. */
export const callMediumSchema = z.enum(['voice', 'video']);

/**
 * Where a call is in its life.
 *
 * The full lifecycle is published because a client has to render each of these
 * distinctly — ringing is not connecting, and a call that failed is not a call
 * somebody declined.
 */
export const callStateSchema = z.enum([
  'invited',
  'accepted',
  'connecting',
  'active',
  'reconnecting',
  'ending',
  'ended',
  'expired',
  'rejected',
  'cancelled',
  'failed',
]);

/**
 * Why a call is over.
 *
 * Coarse and disclosable. A participant may be told the other person hung up;
 * they are never told a call ended because somebody blocked them, because that
 * would publish another person's safety decision. Both safety reasons collapse
 * to `ended_by_platform` on the wire for exactly that reason — the distinction
 * is kept internally, where it belongs, and never reaches a peer.
 */
export const callEndReasonSchema = z.enum([
  'hung_up',
  'declined',
  'withdrawn',
  'invitation_expired',
  'reconnect_expired',
  'provider_unavailable',
  'join_timeout',
  'ended_by_platform',
]);

/** Which side of the call the caller of this API is on. Derived, never sent. */
export const callRoleSchema = z.enum(['caller', 'recipient']);

export const callSchema = z
  .object({
    /** When the recipient answered, absent while it is still ringing. */
    acceptedAt: z.iso.datetime().optional(),
    /** When media was first observed, absent until a provider says so. */
    connectedAt: z.iso.datetime().optional(),
    /** The other person. A name and a picture, and nothing that explains why. */
    counterpart: z
      .object({
        displayName: z.string(),
        id: z.uuid(),
      })
      .strict(),
    createdAt: z.iso.datetime(),
    endReason: callEndReasonSchema.optional(),
    endedAt: z.iso.datetime().optional(),
    id: z.uuid(),
    /** The instant an unanswered invitation stops being answerable. */
    invitationExpiresAt: z.iso.datetime(),
    medium: callMediumSchema,
    role: callRoleSchema,
    state: callStateSchema,
  })
  .strict();

/**
 * Placing a call.
 *
 * The introduction, not the person. A caller supplies a relationship it is
 * already part of and the server resolves the counterpart from it; there is no
 * field here that could name somebody the caller has no relationship with.
 */
export const createCallRequestSchema = z
  .object({
    introductionId: z.uuid(),
    medium: callMediumSchema,
  })
  .strict();

/** Every other call-control action names only the call. */
export const callActionRequestSchema = z
  .object({
    callId: z.uuid(),
  })
  .strict();

/**
 * A participant's means of joining, returned to exactly one already-authorized
 * principal and never stored.
 *
 * `credential` is a secret with a deadline. It is not persisted by the server,
 * must not be persisted by a client beyond the call it belongs to, and must
 * never be logged. `expiresAt` is minutes away by policy, and re-issuance is a
 * fresh authorization rather than an extension.
 *
 * There is deliberately no room identifier, no participant identifier, no relay
 * address, and no scope field: everything a client needs to join is inside the
 * credential the provider issued, and everything else is the server's business.
 */
export const joinAuthorizationSchema = z
  .object({
    callId: z.uuid(),
    credential: z.string().min(1),
    expiresAt: z.iso.datetime(),
    medium: callMediumSchema,
  })
  .strict();

export const callListResponseSchema = z
  .object({
    calls: z.array(callSchema).max(50),
  })
  .strict();

export type Call = z.infer<typeof callSchema>;
export type CallEndReason = z.infer<typeof callEndReasonSchema>;
export type CallMedium = z.infer<typeof callMediumSchema>;
export type CallRole = z.infer<typeof callRoleSchema>;
export type CallState = z.infer<typeof callStateSchema>;
export type CreateCallRequest = z.infer<typeof createCallRequestSchema>;
export type JoinAuthorizationBody = z.infer<typeof joinAuthorizationSchema>;
