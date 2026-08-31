import { z } from 'zod';

import { clientMessageIdSchema, messageBodySchema } from './messaging.js';

/**
 * Live discovery contract.
 *
 * Random live discovery is two eligible strangers, matched by the server, put
 * into one live session for as long as both want it. V1 is one-to-one, and
 * there is no room, no audience, no broadcast, no recording, no transcript, and
 * no screen share in this contract, because none of those is approved.
 *
 * **Nothing here is recorded.** No shape below carries, references, or implies
 * stored media, and no surface built on this contract may claim or imply that a
 * live session is recorded or could be.
 *
 * Four absences are deliberate and load-bearing:
 *
 * A request never names a person. Entering the pool names a medium and nothing
 * else; every other action names the encounter the server allocated. That is
 * what makes "a client cannot choose who it meets" a property of the contract
 * rather than of whichever handler happens to read it.
 *
 * A response never carries a count of who is waiting, who is online, or how
 * many people the platform has. There is no presence projection behind this
 * contract, so a number here would be invented — and an invented number about
 * how busy a product is, is the exact dishonesty this shape refuses to make
 * expressible.
 *
 * A response never carries transport detail. No SDP, no ICE candidate, no TURN
 * credential, no participant address, and no provider room identifier appears
 * below; joining media goes through the RTC join-authorization contract, which
 * already refuses all of those.
 *
 * A live message is not an Inbox message. It belongs to one encounter, it is
 * read through this contract only, and it never appears in a conversation.
 * Durable messaging begins when two people are mutually connected, and not
 * before.
 */

/** What a live session carries. The same two values RTC publishes. */
export const liveMediumSchema = z.enum(['voice', 'video']);

/**
 * Whether this account may take part at all, and why not when it may not.
 *
 * Three values rather than a boolean, because the three lead to three different
 * things a surface should do. `eligible` may search. `not_eligible` is about
 * this account and is answered by finishing onboarding or by waiting out a
 * restriction, and the surface deliberately never learns which — "blocked",
 * "restricted", and "not yet an adult" are three different disclosures and none
 * of them belongs on a peer-facing screen. `unavailable` is about the platform:
 * live discovery is not switched on in this environment, and no action by this
 * person changes that.
 */
export const liveAdmissionSchema = z.enum([
  'eligible',
  'not_eligible',
  'unavailable',
]);

/**
 * Where the person is in live discovery.
 *
 * Server-owned, and the whole of it. A client renders permission prompts and a
 * camera preview around these, and those are client states that never appear
 * here: the server has no opinion about whether a camera is open, and a state
 * that claimed to would be a client asserting a fact about itself.
 */
export const liveStateSchema = z.enum([
  /** Not in the pool. */
  'idle',
  /** In the pool, waiting for the server to allocate somebody. */
  'searching',
  /** Allocated to an encounter that is still live. */
  'matched',
  /** The last encounter is over and the person has not searched again. */
  'ended',
]);

/**
 * Why an encounter is over, in the vocabulary the person is entitled to.
 *
 * Coarse and disclosable, on the same rule the call end reasons follow. A
 * person may be told the other person moved on; they are never told an
 * encounter ended because somebody blocked them, because that would publish
 * another person's safety decision. Every safety outcome collapses to
 * `ended_by_platform` on the wire.
 */
export const liveEndReasonSchema = z.enum([
  /** This person pressed Next or End. */
  'left',
  /** The other person pressed Next or End. */
  'peer_left',
  /** Nobody was there any more; presence lapsed on one side. */
  'timed_out',
  /** The live session could not be carried. */
  'failed',
  /** A safety decision ended it. Deliberately says no more than that. */
  'ended_by_platform',
]);

/**
 * The relationship between the two people, as one of them may be told it.
 *
 * These are DISCOVERY's introduction states seen from one side. `requested` is
 * this person having pressed Connect; `received` is the other person having
 * pressed it first; `connected` is both, independently, which is the only thing
 * that opens a durable conversation. One tap never produces `connected`.
 */
export const liveConnectionStateSchema = z.enum([
  'none',
  'requested',
  'received',
  'connected',
]);

/**
 * Whether anything is actually carrying audio and video.
 *
 * Published because the honest answer is currently `none`, and a surface that
 * could not say so would have to either stay silent or imply otherwise. `none`
 * means the platform holds the session and no approved provider carries media
 * through it. `provider` means a configured provider is carrying it, which is
 * the only condition under which a surface may describe a live session as
 * connected audio or video.
 */
export const liveMediaTransportSchema = z.enum(['none', 'provider']);

/** The other person, and nothing that explains why they were chosen. */
export const livePeerSchema = z
  .object({
    displayName: z.string(),
    id: z.uuid(),
  })
  .strict();

/**
 * The live session behind an encounter, as much of it as a participant may see.
 *
 * `state` is the RTC session's own lifecycle, republished rather than
 * reinterpreted, so a surface renders one vocabulary for a call however it was
 * started. `mediaTransport` is the separate, honest fact above.
 */
export const liveCallSchema = z
  .object({
    id: z.uuid(),
    mediaTransport: liveMediaTransportSchema,
    medium: liveMediumSchema,
    state: z.string().min(1),
  })
  .strict();

export const liveConnectionSchema = z
  .object({
    /** Present once a durable conversation exists, which is only when mutual. */
    conversationId: z.uuid().optional(),
    /** Present once either side has signalled. Names the relationship, never a person. */
    introductionId: z.uuid().optional(),
    state: liveConnectionStateSchema,
  })
  .strict();

export const liveEncounterSchema = z
  .object({
    call: liveCallSchema.optional(),
    connection: liveConnectionSchema,
    endReason: liveEndReasonSchema.optional(),
    endedAt: z.iso.datetime().optional(),
    id: z.uuid(),
    /** Highest message sequence in this encounter, so a client can poll from it. */
    messageSequence: z.number().int().min(0),
    peer: livePeerSchema,
    startedAt: z.iso.datetime(),
  })
  .strict();

/**
 * Everything a live surface renders, in one read.
 *
 * One shape rather than several, because the states are mutually exclusive and
 * a client assembling them from three endpoints would be able to hold a
 * combination the server never had — searching *and* matched, or matched to an
 * encounter that has ended. There is exactly one authoritative answer and this
 * is it.
 */
export const liveStateResponseSchema = z
  .object({
    admission: liveAdmissionSchema,
    encounter: liveEncounterSchema.optional(),
    medium: liveMediumSchema.optional(),
    /** When the current search began. Absent unless searching. */
    searchingSince: z.iso.datetime().optional(),
    /** Whether a deterministic stand-in may be matched in this environment. */
    simulated: z.boolean(),
    state: liveStateSchema,
  })
  .strict();

/** Entering the pool. Names a medium and nothing else. */
export const liveSearchRequestSchema = z
  .object({
    medium: liveMediumSchema,
  })
  .strict();

/**
 * Moving on, or leaving.
 *
 * The encounter is named so a Next arriving after the encounter already ended
 * cannot end the *next* one. A request naming an encounter that is no longer
 * current is answered with current state rather than refused, because pressing
 * Next twice is the ordinary case and not an error.
 */
export const liveEncounterActionRequestSchema = z
  .object({
    encounterId: z.uuid(),
  })
  .strict();

export const liveMessageSchema = z
  .object({
    body: z.string().min(1),
    id: z.uuid(),
    sentAt: z.iso.datetime(),
    /** Whether this person wrote it. Derived, never claimed. */
    self: z.boolean(),
    sequence: z.number().int().min(1),
  })
  .strict();

export const liveMessageListResponseSchema = z
  .object({
    encounterId: z.uuid(),
    messages: z.array(liveMessageSchema).max(200),
  })
  .strict();

/**
 * A message inside a live encounter.
 *
 * `clientMessageId` makes a retry idempotent, exactly as it does in messaging:
 * a network failure after the server committed must not produce a second
 * message when the client tries again.
 */
export const sendLiveMessageRequestSchema = z
  .object({
    /**
     * The same bounded, control-character-free body MESSAGING accepts. Reused
     * rather than redefined: two definitions of what a person may type would
     * eventually disagree, and the weaker one would be the one somebody found.
     */
    body: messageBodySchema,
    clientMessageId: clientMessageIdSchema,
    encounterId: z.uuid(),
  })
  .strict();

/**
 * Pressing Connect.
 *
 * It signals this person's own interest and nothing more. The response reports
 * the relationship as it now stands, which is `requested` unless the other
 * person had already signalled — in which case it is `connected` and a durable
 * conversation exists. There is no field for accepting on somebody's behalf.
 */
export const liveConnectRequestSchema = liveEncounterActionRequestSchema;

export const liveConnectionResponseSchema = z
  .object({
    connection: liveConnectionSchema,
    encounterId: z.uuid(),
  })
  .strict();

/**
 * The deterministic local scenarios.
 *
 * This exists only where `LIVE_DISCOVERY_SIMULATION` is the `local-test`
 * adapter, which configuration refuses outside local and test. Each scenario
 * drives a seeded local account through the same published service methods a
 * person's client calls, so what a developer sees is the product behaving
 * rather than a fixture pretending to.
 */
export const liveSimulationScenarioSchema = z.enum([
  /** The stand-in writes a message into the current encounter. */
  'peer_message',
  /** The stand-in presses Connect. */
  'peer_connect',
  /** The stand-in presses Next, ending this encounter from the other side. */
  'peer_next',
  /** The stand-in stops answering; presence lapses and the encounter times out. */
  'peer_disconnect',
  /** Nobody is available: the pool is drained and no stand-in is offered. */
  'nobody_available',
]);

export const liveSimulationRequestSchema = z
  .object({
    scenario: liveSimulationScenarioSchema,
  })
  .strict();

export const liveSimulationResponseSchema = z
  .object({
    applied: z.boolean(),
    scenario: liveSimulationScenarioSchema,
  })
  .strict();

export type LiveAdmission = z.infer<typeof liveAdmissionSchema>;
export type LiveCall = z.infer<typeof liveCallSchema>;
export type LiveConnection = z.infer<typeof liveConnectionSchema>;
export type LiveConnectionState = z.infer<typeof liveConnectionStateSchema>;
export type LiveEncounter = z.infer<typeof liveEncounterSchema>;
export type LiveEndReason = z.infer<typeof liveEndReasonSchema>;
export type LiveMediaTransport = z.infer<typeof liveMediaTransportSchema>;
export type LiveMedium = z.infer<typeof liveMediumSchema>;
export type LiveMessage = z.infer<typeof liveMessageSchema>;
export type LivePeer = z.infer<typeof livePeerSchema>;
export type LiveSimulationScenario = z.infer<
  typeof liveSimulationScenarioSchema
>;
export type LiveMessageListResponse = z.infer<
  typeof liveMessageListResponseSchema
>;
export type LiveState = z.infer<typeof liveStateSchema>;
export type LiveStateResponse = z.infer<typeof liveStateResponseSchema>;
