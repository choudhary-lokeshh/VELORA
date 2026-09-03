import { z } from 'zod';

import { clientMessageIdSchema, messageBodySchema } from './messaging.js';
import { profileLanguageSchema } from './profile.js';
import { regionSchema } from './users.js';
import { livePreferenceSelectionSchema } from './wallet.js';

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

/**
 * How wide a net the matcher casts for this person.
 *
 * A *preference*, not a promise, and the vocabulary is deliberately tiny. Two
 * dimensions, both drawn from what a person already published about themselves:
 * where they are, and what they speak. Nothing here is a protected or sensitive
 * characteristic, nothing here is inferred, and there is no shape below in
 * which a compatibility score, an age band, a body attribute, or anything
 * purchasable could be expressed.
 *
 * `region` is `any` or `same` rather than a country picker. "People near me" is
 * a preference a person holds about themselves; "people in a country I chose
 * from a list" is a filter over a population, and publishing a shape that could
 * hold one would make the second expressible whether or not a surface offered
 * it.
 *
 * That rule survives the arrival of the paid, targeted region narrowing, and
 * this shape is why. A specific region is *not* expressible here and never
 * becomes so: it is bought as a bounded window through
 * {@link activateLivePreferenceRequestSchema}, recorded against a ledger
 * reservation, and read by the matcher from that record. So a client can never
 * simply ask to filter a population — it can only hold a window that somebody
 * deliberately opened, that expires, and that this response reports as
 * {@link liveStateResponseSchema}'s `premium`.
 *
 * `language` is one of the caller's *own* profile languages, and it means the
 * other person must also speak it. Asking for a language you do not speak is
 * meaningless, so the contract cannot express it.
 *
 * Applying a preference narrows the pool, and a narrower pool takes longer.
 * That is the honest cost and the surface says so; it is never presented as a
 * guarantee that somebody matching exists.
 */
export const livePreferredRegionSchema = z.enum(['any', 'same']);

export const livePreferencesSchema = z
  .object({
    language: profileLanguageSchema.optional(),
    region: livePreferredRegionSchema,
  })
  .strict();

/**
 * The small, fixed set of things a person can send without typing.
 *
 * Six, chosen to be unambiguous across cultures and impossible to aim as an
 * insult. There is no open emoji field: an arbitrary glyph channel is a channel
 * for whatever somebody can express in glyphs, and moderating one is
 * unanswerable. Adding to this list is a product decision, which is why it is a
 * closed enumeration here rather than a string a client picks.
 *
 * A reaction is not a gift. Nothing here costs anything, nothing here credits
 * anybody, and attaching VELORA's gifting to a conversation between two
 * strangers is a separate product and safety decision that has not been taken.
 */
export const liveReactionSchema = z.enum([
  'wave',
  'smile',
  'laugh',
  'heart',
  'fire',
  'clap',
]);

/**
 * Whether a line in a live encounter is something somebody typed or something
 * they tapped.
 *
 * One channel rather than two, because both are "a thing one of these two
 * people sent the other during this encounter" and both have to be orderable,
 * idempotent, and answerable when somebody reports the conversation. A surface
 * renders them completely differently — a reaction is a moment, not a line of
 * transcript — and that is a rendering decision rather than a storage one.
 */
export const liveMessageKindSchema = z.enum(['text', 'reaction']);

/**
 * The other person, and nothing that explains why they were chosen.
 *
 * The same minimized public shape DISCOVERY publishes a candidate in, minus its
 * imagery. Photographs are deliberately absent: whether one consumer may see
 * another's pictures is DISCOVERY's `mayViewProfileMedia` question, and two
 * strangers put together by the matcher hold neither of the two reasons that
 * answers yes. Broadening that here to decorate a card would be a privacy
 * decision taken for a layout reason. The live video is the picture.
 *
 * What is here is what a person needs to decide whether to talk to somebody:
 * their name, roughly where they are, what languages the two of you share, and
 * whatever they chose to write about themselves. Every field is one the person
 * published about themselves, and `sharedLanguages` is the overlap rather than
 * everything they speak — the same narrowing DISCOVERY applies for the same
 * reason.
 */
export const livePeerSchema = z
  .object({
    bio: z.string().optional(),
    displayName: z.string(),
    id: z.uuid(),
    region: regionSchema.optional(),
    sharedLanguages: z.array(profileLanguageSchema).max(8),
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
 * Somebody this person met, after the meeting is over.
 *
 * This exists for one complaint and answers it exactly: the other person
 * behaved badly, left, and the control that would have reported them left with
 * them. A random encounter has no durable relationship behind it, so once the
 * ended screen is dismissed there is nothing on any surface that names who that
 * was — and asking somebody to remember a stranger's display name in order to
 * report them is asking them not to bother.
 *
 * It carries the same minimized public shape they were already shown while the
 * encounter was live, and nothing more. No message, no duration, no transport
 * detail, no end reason: this is an address for a safety action, not a history
 * of the meeting. It is bounded in both count and age by
 * {@link liveRecentCounterpartWindowHours}, so it is a way back to somebody you
 * just met rather than a list of everyone you ever have.
 */
export const liveRecentCounterpartSchema = z
  .object({
    /** When the encounter finished. Newest first in the list below. */
    endedAt: z.iso.datetime(),
    /** The encounter itself, so a report can name what it was about. */
    encounterId: z.uuid(),
    person: livePeerSchema,
  })
  .strict();

/**
 * How far back this list reaches, published so a surface can say so.
 *
 * A product bound rather than a retention one: nothing is deleted when it
 * passes, the list simply stops offering it. Long enough that somebody who
 * closed the tab in shock and came back can still act, short enough that it
 * never becomes a standing directory of strangers.
 */
export const liveRecentCounterpartWindowHours = 24;

/** How many of them are offered. Small, because it is a way back, not a log. */
export const maximumLiveRecentCounterparts = 10;

export const liveRecentCounterpartListResponseSchema = z
  .object({
    people: z
      .array(liveRecentCounterpartSchema)
      .max(maximumLiveRecentCounterparts),
    /** The bound above, so no surface has to restate it and get it wrong. */
    windowHours: z.number().int().positive(),
  })
  .strict();

/**
 * Choosing somebody, and what the platform will and will not promise about it.
 *
 * Instant live discovery is the server choosing; this is a person choosing, and
 * the two are deliberately different shapes with different lifecycles rather
 * than one endpoint with a flag. Picking somebody is a *request to meet*, and
 * the states below are the honest lifecycle of one:
 *
 * `pending` — sent, and the other person has not answered.
 * `accepted` — they said yes, and the two of you are not both here yet. This is
 *   the state that keeps the product honest: accepting cannot conjure a live
 *   session out of somebody who has closed the tab, so it says so and waits.
 * `met` — an encounter was allocated for the pair and the request is spent.
 * `declined` / `cancelled` / `expired` — the three ways it ends without a
 *   meeting. A decline is reported to the person who sent it, because a request
 *   left hanging for ever is worse than a no.
 *
 * Nothing here bypasses anything. An accepted invitation is a *reason to pair
 * these two first*, and every eligibility, standing, safety, block, and RTC
 * predicate the random matcher asks is asked again, in the same order, at the
 * moment the encounter is allocated.
 */
export const liveInvitationStateSchema = z.enum([
  'pending',
  'accepted',
  'met',
  'declined',
  'cancelled',
  'expired',
]);

/** Which end of the request the caller is on. */
export const liveInvitationDirectionSchema = z.enum(['outgoing', 'incoming']);

export const liveInvitationSchema = z
  .object({
    createdAt: z.iso.datetime(),
    direction: liveInvitationDirectionSchema,
    /** When this request stops being one. Requests to meet go stale quickly. */
    expiresAt: z.iso.datetime(),
    id: z.uuid(),
    medium: liveMediumSchema,
    /** The other person, in the same shape a peer is published in. */
    person: livePeerSchema,
    state: liveInvitationStateSchema,
  })
  .strict();

export const liveInvitationListResponseSchema = z
  .object({ invitations: z.array(liveInvitationSchema).max(40) })
  .strict();

/**
 * Asking one person to meet.
 *
 * The candidate is named because a person named them, which is the entire
 * difference between this and searching. It is refused unless that person is
 * somebody this caller could legitimately be introduced to right now — the same
 * predicate DISCOVERY applies to a signal — so a harvested identifier buys
 * nothing.
 */
export const createLiveInvitationRequestSchema = z
  .object({
    candidateId: z.uuid(),
    medium: liveMediumSchema,
  })
  .strict();

/**
 * Answering, withdrawing, or refusing one.
 *
 * `accept` is only the recipient's to send and `cancel` only the sender's;
 * naming which is not the client's business, and a request sending the wrong
 * one is refused rather than reinterpreted.
 */
export const respondToLiveInvitationRequestSchema = z
  .object({
    invitationId: z.uuid(),
    response: z.enum(['accept', 'decline', 'cancel']),
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
    /**
     * Requests to meet, in both directions, that are still worth showing.
     *
     * Carried in the same authoritative read as everything else for the reason
     * the read exists: a surface that fetched these separately could render an
     * invitation to somebody it has just been matched with.
     */
    invitations: z.array(liveInvitationSchema).max(40),
    /**
     * The languages this person may narrow to, which are their own.
     *
     * Published so a surface can offer the choice without asking a second
     * service what somebody speaks — and bounded to their own profile, so the
     * control cannot offer a language the contract would then refuse.
     */
    languageOptions: z.array(profileLanguageSchema).max(8),
    medium: liveMediumSchema.optional(),
    /** The preferences the matcher is currently applying for this person. */
    preferences: livePreferencesSchema,
    /**
     * The paid narrowing currently in force, when there is one.
     *
     * Reported here as well as by the wallet read, because a surface must be
     * able to say what the search is actually doing without a second request —
     * a stage that showed a plain spinner while a bought, expiring window ran
     * would be hiding the thing somebody paid for.
     *
     * It is a *statement about this caller's own search*. It carries no count
     * of matching people, no estimated wait, and no probability, because none
     * of those is a number this platform has. And it is never rendered to the
     * other person: nobody is told why they were selected.
     */
    premium: livePreferenceSelectionSchema
      .extend({
        /**
         * Whether this window has already been charged.
         *
         * Reported so the stage can say what is actually true about the coins.
         * A charged window keeps narrowing for the rest of its time and every
         * further match inside it is free; an uncharged one still returns
         * everything if nobody is found. Those are opposite promises and a
         * surface that guessed would make one of them a lie.
         */
        charged: z.boolean(),
        /** When the window closes. */
        expiresAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    /** When the current search began. Absent unless searching. */
    searchingSince: z.iso.datetime().optional(),
    /** Whether a deterministic stand-in may be matched in this environment. */
    simulated: z.boolean(),
    state: liveStateSchema,
  })
  .strict();

/**
 * Entering the pool. Names a medium and how wide a net to cast, and nothing
 * else.
 *
 * Still no person. Preferences describe the kind of person the matcher should
 * look for, drawn from what people published about themselves; they cannot
 * name anybody, and they cannot be narrowed to one. Choosing a specific person
 * is a different act with a different shape and a different lifecycle — see
 * {@link createLiveInvitationRequestSchema} — precisely so that "I would like
 * to meet Ana" can never be smuggled through the shape that means "find me
 * somebody".
 */
export const liveSearchRequestSchema = z
  .object({
    medium: liveMediumSchema,
    preferences: livePreferencesSchema.optional(),
  })
  .strict();

/**
 * Sending a reaction.
 *
 * Separate from a message rather than a variant of one, so a body can never be
 * smuggled through a reaction or the other way round. `clientMessageId` makes a
 * retry idempotent on exactly the same terms.
 */
export const sendLiveReactionRequestSchema = z
  .object({
    clientMessageId: clientMessageIdSchema,
    encounterId: z.uuid(),
    reaction: liveReactionSchema,
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
    /**
     * What was sent. For a `text` line this is what the person typed; for a
     * `reaction` it is one of {@link liveReactionSchema}'s names, so a client
     * that does not know a name renders nothing rather than the raw word.
     */
    body: z.string().min(1),
    id: z.uuid(),
    kind: liveMessageKindSchema,
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
  /** The stand-in taps a reaction. */
  'peer_reaction',
  /** The stand-in asks to meet, so an incoming request can be walked. */
  'peer_invitation',
  /** The stand-in accepts a request this person sent from Pick. */
  'peer_accepts_invitation',
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
export type LiveInvitation = z.infer<typeof liveInvitationSchema>;
export type LiveInvitationDirection = z.infer<
  typeof liveInvitationDirectionSchema
>;
export type LiveInvitationState = z.infer<typeof liveInvitationStateSchema>;
export type LiveMessageKind = z.infer<typeof liveMessageKindSchema>;
export type LivePreferences = z.infer<typeof livePreferencesSchema>;
export type LivePreferredRegion = z.infer<typeof livePreferredRegionSchema>;
export type LiveReaction = z.infer<typeof liveReactionSchema>;
export type LiveCall = z.infer<typeof liveCallSchema>;
export type LiveConnection = z.infer<typeof liveConnectionSchema>;
export type LiveConnectionState = z.infer<typeof liveConnectionStateSchema>;
export type LiveEncounter = z.infer<typeof liveEncounterSchema>;
export type LiveEndReason = z.infer<typeof liveEndReasonSchema>;
export type LiveMediaTransport = z.infer<typeof liveMediaTransportSchema>;
export type LiveMedium = z.infer<typeof liveMediumSchema>;
export type LiveMessage = z.infer<typeof liveMessageSchema>;
export type LivePeer = z.infer<typeof livePeerSchema>;
export type LiveRecentCounterpart = z.infer<typeof liveRecentCounterpartSchema>;
export type LiveRecentCounterpartListResponse = z.infer<
  typeof liveRecentCounterpartListResponseSchema
>;
export type LiveSimulationScenario = z.infer<
  typeof liveSimulationScenarioSchema
>;
export type LiveMessageListResponse = z.infer<
  typeof liveMessageListResponseSchema
>;
export type LiveState = z.infer<typeof liveStateSchema>;
export type LiveStateResponse = z.infer<typeof liveStateResponseSchema>;
