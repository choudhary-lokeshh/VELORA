/**
 * Approved V1 live-discovery policy.
 *
 * Every value a live-discovery decision depends on is defined once, here, for
 * the same reason the realtime, messaging, and discovery policy modules exist:
 * a limit restated in two places is a limit that can be changed in one of them.
 *
 * [ADR-0040](../../../../docs/decisions/ADR-0040-random-live-discovery.md) is
 * the architecture authority and `docs/domains/live.md` describes what this
 * domain owns.
 */

/**
 * What a live session carries.
 *
 * The same closed vocabulary REALTIME publishes, restated here rather than
 * imported, because LIVE hands it *to* REALTIME as a request and a domain that
 * takes another's type as an input parameter has coupled its contract to that
 * domain's internals. The two are checked against each other where they meet.
 */
export const liveMediums = ['voice', 'video'] as const;
export type LiveMedium = (typeof liveMediums)[number];

/**
 * Where a person is in the pool.
 *
 * `searching`, `matched`, and `ended` are all *live*: the person occupies the
 * pool and may not occupy it twice. `left` is terminal for that participation,
 * and a later search creates a new row rather than resurrecting this one — so
 * the record of who was waiting, when, and for how long survives, and the
 * partial unique index that guarantees one live participation per person stays
 * a single index rather than a rule somebody has to remember.
 *
 * `ended` is the state that makes "they moved on" sayable. It exists because
 * the alternative — putting somebody straight back to `searching` the instant
 * the other person pressed Next — is a surface that silently replaces the
 * person somebody was talking to with a spinner, and leaves them to work out
 * what happened. Holding the finished encounter until they act is what lets the
 * screen say what it was. It is not matchable: a person is handed to somebody
 * else only after they have asked again.
 */
export const liveParticipationStates = [
  'searching',
  'matched',
  'ended',
  'left',
] as const;
export type LiveParticipationState = (typeof liveParticipationStates)[number];

export const liveParticipationLiveStates: readonly LiveParticipationState[] = [
  'searching',
  'matched',
  'ended',
];

/** The states that still name the encounter they came from. */
export const liveParticipationEncounterStates: readonly LiveParticipationState[] =
  ['matched', 'ended'];

/**
 * Where an encounter is.
 *
 * Two states and no third. An encounter is allocated live and ends once; there
 * is no accepted, no ringing, and no answer, because neither person was invited
 * — both had already said yes by being in the pool. That is the whole reason a
 * random encounter is not modelled as an invitation.
 */
export const liveEncounterStates = ['live', 'ended'] as const;
export type LiveEncounterState = (typeof liveEncounterStates)[number];

/**
 * Why an encounter ended, in the platform's own vocabulary.
 *
 * Finer than what a participant is told. `safety_block` and `safety_enforcement`
 * are separate decisions with separate owners and both collapse to one
 * disclosable reason at the boundary, exactly as the RTC end reasons do: a
 * person may learn their encounter ended, never that somebody blocked them.
 */
export const liveEndReasons = [
  /** Somebody pressed Next or End. Which side is recorded separately. */
  'departed',
  /** Presence lapsed on one side without anybody saying so. */
  'presence_lapsed',
  /** No live session could be carried for it. */
  'session_failed',
  /** A block landed on the pair. */
  'safety_block',
  /** A live TRUST & SAFETY enforcement denied it. */
  'safety_enforcement',
] as const;
export type LiveEndReason = (typeof liveEndReasons)[number];

/**
 * How long a matched encounter survives without either side being heard from.
 *
 * A live encounter has no invitation and no ring, so the only evidence that
 * somebody is still there is that their client is still reading. Past this
 * bound the encounter is closed, because an encounter nobody is attending
 * cannot be distinguished from one everybody has left — the same reasoning the
 * RTC reconnect grace uses, and deliberately a little longer, because a phone
 * changing networks should not cost somebody the person they were talking to.
 */
export const livePresenceGraceMilliseconds = 45_000;

/**
 * How long somebody may sit in the pool without being heard from.
 *
 * Shorter than the encounter grace: nobody is waiting on the other end of a
 * search, and a stale searcher is worse than an absent one because it is what
 * a real person gets matched with.
 */
export const liveSearchGraceMilliseconds = 30_000;

/**
 * How often the worker looks for people who stopped reading.
 *
 * Shorter than the search grace, so a stale searcher is normally gone before
 * anybody could be matched with them, and short enough that the person left on
 * an unattended encounter is told within a few seconds of the grace expiring.
 * Presence in this domain is reading, and this cycle is what makes that true
 * rather than aspirational.
 */
export const livePresenceSweepIntervalMilliseconds = 10_000;

/**
 * How long before the same two people may be matched again by chance.
 *
 * Not a block and not a judgement — the pair may still find each other through
 * Discover, may still connect, and are free to meet again after this — but
 * being handed the person you just moved on from is the single fastest way to
 * make random discovery feel broken. A block is the stronger, indefinite
 * suppression and belongs to TRUST & SAFETY.
 */
export const liveRematchSuppressionMilliseconds = 3_600_000;

/** The window the bounds below are counted over. One value, one scan. */
export const liveAbuseWindowMilliseconds = 3_600_000;

/**
 * How many encounters one person may be allocated in the window.
 *
 * Random discovery is a product where moving on quickly is the intended
 * behaviour, so this is deliberately generous compared to the calling bounds —
 * what it stops is a client cycling Next in a loop, which costs every other
 * waiting person a match against somebody who is not looking at them.
 */
export const maximumLiveEncountersPerUser = 120;

/**
 * How many messages one person may write inside one encounter.
 *
 * An encounter is a few minutes long by design. This is not a conversation
 * limit and must not be read as one: durable messaging has its own, and this
 * exists so a script cannot fill an encounter faster than a person can read it.
 */
export const maximumLiveMessagesPerEncounter = 200;

/**
 * Bounds the database enforces on a live message.
 *
 * These restate the published contract's bounds rather than importing them.
 * `drizzle-kit` reads schema modules through a CommonJS resolver that cannot
 * follow the validation package's import-only exports, so a schema module may
 * not depend on it — the same constraint `src/messaging/policy.ts` records.
 * Restating a bound is only safe if drift is impossible, so
 * `test/unit/live-policy.test.ts` asserts each of these equals the contract
 * value it mirrors, and fails the build the moment one moves.
 */
export const maximumLiveMessageBodyCharacters = 4_000;
export const minimumLiveClientMessageIdCharacters = 8;
export const maximumLiveClientMessageIdCharacters = 128;

/**
 * How many candidates the matcher considers before giving up for this attempt.
 *
 * Bounded so one search is one bounded query rather than a scan of everybody
 * waiting. A search that finds nobody within the bound answers "still
 * searching", which is true, and the next poll tries again.
 */
export const liveCandidateScanLimit = 20;


/**
 * How wide a net the matcher casts, as the pool stores it.
 *
 * The same two values the contract publishes, restated here on the rule the
 * message bounds above follow: a schema module may not import the validation
 * package, and `test/unit/live-policy.test.ts` asserts these equal the
 * published vocabulary so drift fails the build.
 */
export const livePreferredRegions = ['any', 'same'] as const;
export type LivePreferredRegion = (typeof livePreferredRegions)[number];

/**
 * What a line in an encounter is.
 *
 * A typed message and a tapped reaction share one table because both are
 * ordered, idempotent, and answerable when somebody reports the conversation.
 * They are never rendered alike, and a reaction body is one of
 * {@link liveReactions} rather than free text.
 */
export const liveMessageKinds = ['text', 'reaction'] as const;
export type LiveMessageKind = (typeof liveMessageKinds)[number];

/** The closed set of things a person can send without typing. */
export const liveReactions = [
  'wave',
  'smile',
  'laugh',
  'heart',
  'fire',
  'clap',
] as const;
export type LiveReaction = (typeof liveReactions)[number];

/**
 * The lifecycle of one person asking one other person to meet live.
 *
 * `accepted` is the honest state that makes selected matching possible without
 * lying: two people agreeing to meet does not put them in a live session, it
 * makes them the matcher's first choice the next time they are both here.
 * `met` is terminal and spent — an accepted request produces at most one
 * encounter, which is what stops one acceptance being redeemed repeatedly.
 */
export const liveInvitationStates = [
  'pending',
  'accepted',
  'met',
  'declined',
  'cancelled',
  'expired',
] as const;
export type LiveInvitationState = (typeof liveInvitationStates)[number];

/** The states in which a request to meet is still worth acting on. */
export const liveInvitationOpenStates: readonly LiveInvitationState[] = [
  'pending',
  'accepted',
];

/**
 * How long a request to meet live stays answerable.
 *
 * Deliberately short. "Would you like to talk right now" stops being a true
 * question within a few hours, and a request that outlived its meaning would
 * put somebody in a live session with a stranger who asked yesterday. Expiry is
 * evaluated on read rather than swept, so a request is never answerable past
 * this bound even if nothing has run.
 */
export const liveInvitationExpiryMilliseconds = 7_200_000;

/**
 * How many requests to meet one person may have outstanding at once.
 *
 * Small, because the product intent is choosing somebody rather than
 * broadcasting to everybody. What it stops is a client turning Pick into a
 * mailshot, which is the exact behaviour that would make receiving one
 * worthless.
 */
export const maximumOpenLiveInvitations = 10;

/**
 * How many requests to meet one person may send in the abuse window.
 *
 * Counted over {@link liveAbuseWindowMilliseconds} like every other bound here.
 */
export const maximumLiveInvitationsPerWindow = 30;

/**
 * What has to be decided or built before live discovery may be enabled in a
 * deployed environment. Each entry is a real blocker, not a caution.
 *
 * The runtime enforces this rather than merely documenting it: configuration
 * refuses the mode outside local and test, so a deployed environment admits
 * nobody to the pool instead of putting two strangers into a call nothing can
 * carry, under a safety posture nobody has signed off.
 */
export const productionBlockers = [
  'no-approved-rtc-provider',
  'live-encounter-retention-duration-undecided',
  'live-message-retention-duration-undecided',
  'regional-availability-undecided',
  'recording-posture-undecided',
  'rtc-operations-ownership-unassigned',
  'live-moderation-coverage-unassigned',
] as const;

/**
 * Recording posture, stated so it cannot be quietly misdescribed.
 *
 * **No live encounter is recorded, stored, transcoded, or transcribed**, no
 * code path does any of those things, and no configuration value turns one on.
 * No surface may claim or imply that a live encounter is recorded, and none may
 * imply that it could be. This is the same posture ADR-0025 fixed for calls and
 * it is restated here because random discovery is exactly the feature where
 * somebody would expect otherwise.
 */
export const liveRecordingImplemented = false;

/**
 * Live-encounter and live-message retention.
 *
 * **No retention duration is approved.** Both are
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. Nothing expires, there is no
 * sweep, and no correctness rule depends on a row being physically gone, so
 * whatever duration is eventually approved can be applied without changing how
 * any of this behaves.
 */
export const liveRetentionDuration = undefined;
