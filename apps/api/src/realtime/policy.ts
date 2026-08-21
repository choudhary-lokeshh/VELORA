/**
 * Approved V1 RTC policy.
 *
 * Every value an RTC decision depends on is defined once, here, for the same
 * reason the messaging and discovery policy modules exist: a limit restated in
 * two places is a limit that can be changed in one of them.
 *
 * [ADR-0025](../../../../docs/decisions/ADR-0025-rtc-live-communications-architecture.md)
 * is the architecture authority and `docs/domains/realtime.md` describes what
 * this domain owns.
 */

/**
 * What a call carries.
 *
 * Two values rather than a boolean, because "video" is not "voice plus a
 * camera flag": the two differ in what a provider is asked to create, what a
 * participant grants permission for, and what a client renders when a track is
 * absent. A closed vocabulary also means a third medium arrives as a migration
 * and a decision rather than as a new boolean nobody validated.
 */
export const rtcCallMediums = ['voice', 'video'] as const;
export type RtcCallMedium = (typeof rtcCallMediums)[number];

/**
 * Where a call is in its life.
 *
 * `invited` is the only entry state, and every path out of it is explicit. The
 * separation that matters is between `accepted` and `active`: acceptance is a
 * platform fact taken from an authenticated request, and activity is an
 * observation of media that grants nothing. A design with one state covering
 * both would let a provider event move a call somebody never answered.
 */
export const rtcSessionStates = [
  /** Somebody asked to talk. Expires on its own if nobody acts. */
  'invited',
  /** The recipient answered. No credential has been issued yet. */
  'accepted',
  /** Authorization issued; endpoints are joining. */
  'connecting',
  /** A provider has observed media. */
  'active',
  /** Transport interrupted, inside a bounded grace period. */
  'reconnecting',
  /** Terminating: revocation and teardown obligations are being discharged. */
  'ending',
  /** Terminal. The call happened, or was established and then finished. */
  'ended',
  /** Terminal. The invitation's own deadline passed with no answer. */
  'expired',
  /** Terminal. The recipient declined. */
  'rejected',
  /** Terminal. The caller withdrew before it was answered. */
  'cancelled',
  /** Terminal. It could not be established at all. */
  'failed',
] as const;
export type RtcSessionState = (typeof rtcSessionStates)[number];

/**
 * States from which nothing further happens.
 *
 * A terminal session stays terminal. Every later attempt to transition one
 * answers idempotently rather than erroring, because a retried hang-up is the
 * ordinary case and not an exception.
 */
export const terminalRtcSessionStates: readonly RtcSessionState[] = [
  'ended',
  'expired',
  'rejected',
  'cancelled',
  'failed',
];

/** States in which a call still exists and occupies its pair. */
export const liveRtcSessionStates: readonly RtcSessionState[] = [
  'invited',
  'accepted',
  'connecting',
  'active',
  'reconnecting',
  'ending',
];

export function isTerminalRtcSessionState(state: RtcSessionState): boolean {
  return terminalRtcSessionStates.includes(state);
}

/**
 * Which states may follow which.
 *
 * A map rather than a chain of conditionals at each call site, so a transition
 * nobody intended cannot be reached by a path nobody reviewed, and so adding a
 * state is one edit here rather than an edit everywhere. Every terminal state
 * maps to nothing, which is what makes "terminal" a property of this table
 * rather than a convention.
 */
const allowedRtcTransitions: Readonly<
  Record<RtcSessionState, readonly RtcSessionState[]>
> = {
  accepted: ['connecting', 'ending', 'ended', 'failed'],
  active: ['reconnecting', 'ending', 'ended'],
  cancelled: [],
  connecting: ['active', 'ending', 'ended', 'failed'],
  ended: [],
  ending: ['ended'],
  expired: [],
  failed: [],
  // `ended` is reachable from `invited` for one reason: safety. A block or an
  // enforcement landing on a ringing call has to end it there and then, and
  // routing that through `rejected` or `cancelled` would record it as one of
  // the two people deciding when neither did. Only the safety path takes it —
  // a participant hanging up a call nobody has answered cancels or declines —
  // and the service, not this map, is what holds them to that.
  invited: ['accepted', 'rejected', 'cancelled', 'expired', 'ended'],
  reconnecting: ['active', 'ending', 'ended'],
  rejected: [],
};

export function mayTransitionRtcSession(
  from: RtcSessionState,
  to: RtcSessionState,
): boolean {
  return allowedRtcTransitions[from].includes(to);
}

/**
 * Why a call is in the terminal state it is in.
 *
 * Coarse and disclosable. A participant may be told that a call ended because
 * the other person hung up; they may never be told that it ended because
 * somebody blocked them, because that would publish another person's safety
 * decision. `safety_block` and `safety_enforcement` are separate values because
 * they are separate decisions with separate owners, and both stay inside the
 * platform rather than reaching a peer.
 */
export const rtcEndReasons = [
  /** A participant hung up. */
  'hung_up',
  /** The recipient declined the invitation. */
  'declined',
  /** The caller withdrew before it was answered. */
  'withdrawn',
  /** Nobody answered before the invitation's deadline. */
  'invitation_expired',
  /** A block landed on the pair. */
  'safety_block',
  /** A live TRUST & SAFETY enforcement denied it. */
  'safety_enforcement',
  /** The reconnect grace period ran out. */
  'reconnect_expired',
  /** No provider was available to create or carry the session. */
  'provider_unavailable',
  /** A provider accepted the session and then failed it. */
  'provider_failed',
  /** Endpoints never joined within the join deadline. */
  'join_timeout',
  /** An operator terminated it under audited authority. */
  'operator_terminated',
] as const;
export type RtcEndReason = (typeof rtcEndReasons)[number];

/**
 * Which reason may accompany which terminal state.
 *
 * A terminal state and its reason are written together and have to agree: a
 * session `rejected` for `provider_failed` would be a record of something that
 * did not happen. Deriving the legal pairs here means the database can enforce
 * the pairing and a caller cannot invent one.
 */
const reasonsByTerminalState: Readonly<
  Record<string, readonly RtcEndReason[]>
> = {
  cancelled: ['withdrawn'],
  ended: [
    'hung_up',
    'safety_block',
    'safety_enforcement',
    'reconnect_expired',
    'provider_failed',
    'operator_terminated',
  ],
  expired: ['invitation_expired'],
  failed: ['provider_unavailable', 'provider_failed', 'join_timeout'],
  rejected: ['declined'],
};

export function endReasonsFor(state: RtcSessionState): readonly RtcEndReason[] {
  return reasonsByTerminalState[state] ?? [];
}

export function isEndReasonValidFor(
  state: RtcSessionState,
  reason: RtcEndReason,
): boolean {
  return endReasonsFor(state).includes(reason);
}

/**
 * The two sides of a one-to-one call.
 *
 * Fixed at creation and never exchanged. Which side somebody is on decides
 * which transitions they may take — only a caller cancels, only a recipient
 * rejects — so it is a stored fact rather than something derived from who
 * happens to be asking.
 */
export const rtcParticipantRoles = ['caller', 'recipient'] as const;
export type RtcParticipantRole = (typeof rtcParticipantRoles)[number];

/**
 * How long an unanswered invitation stands.
 *
 * A product constant rather than a technical one, and deliberately short: a
 * call invitation that outlives the moment somebody was free to take it is an
 * interruption rather than an offer, and a long one would leave a pair unable
 * to start a fresh call because the stale one still occupies them.
 *
 * The exact value is provisional and named in `DECISIONS_REQUIRED` as pending
 * product review. Nothing derives correctness from its size: expiry is decided
 * by comparing against the deadline stored on the row, so changing it changes
 * new invitations and rewrites none.
 */
export const rtcInvitationTimeoutMilliseconds = 45_000;

/**
 * How long a call may sit in `connecting` before it is a failure.
 *
 * Endpoints that have not established media by now are not going to, and a
 * session left in `connecting` forever would hold its pair against a call that
 * never happened.
 */
export const rtcJoinTimeoutMilliseconds = 30_000;

/**
 * How long a transport interruption is treated as an interruption.
 *
 * A network drop is not a hang-up. Past this bound it is treated as one,
 * because a call nobody is connected to cannot be distinguished from a call
 * everybody has left.
 */
export const rtcReconnectGraceMilliseconds = 30_000;

/**
 * The classes of owed work an operator watches, and when each becomes late.
 *
 * Every class is reported on every read, including the empty ones. A screen or
 * an alert rule reading a list that omits what is healthy cannot tell "nothing
 * is waiting" from "the signal stopped arriving", and those are opposite
 * situations that would page opposite people.
 *
 * The thresholds are deliberately generous relative to the deadlines
 * themselves. A call one second past its join timeout is a call the sweep has
 * not reached yet; a call five minutes past it means the sweep is not running,
 * which is the condition worth waking somebody for.
 */
export const rtcBacklogKinds = [
  /** Invitations whose own deadline passed and which are still `invited`. */
  'invitation_expiry',
  /** Calls still `connecting` past the join timeout. */
  'join_timeout',
  /** Calls still `reconnecting` past the reconnect grace. */
  'reconnect_grace',
  /** Provider teardown and revocation that is due and undischarged. */
  'provider_obligation',
  /** Verified provider events recorded and not yet applied. */
  'provider_event',
] as const;
export type RtcBacklogKind = (typeof rtcBacklogKinds)[number];

export const rtcBacklogThresholdMilliseconds: Readonly<
  Record<RtcBacklogKind, number>
> = {
  invitation_expiry: 300_000,
  join_timeout: 300_000,
  provider_event: 600_000,
  provider_obligation: 600_000,
  reconnect_grace: 300_000,
};

/**
 * The window every RTC abuse limit below is counted over.
 *
 * One value rather than one per limit, because the limits are answered by a
 * single query over rows that already exist and a second window would mean a
 * second scan. An hour is long enough that a burst cannot be walked around by
 * waiting, and short enough that somebody who was rate-limited during an
 * argument can call again the same evening.
 */
export const rtcAbuseWindowMilliseconds = 3_600_000;

/**
 * How many calls one person may place in the window.
 *
 * Calling is expensive to the person receiving it in a way messaging is not: a
 * ring interrupts, and a caller who can place them without bound can make
 * somebody's phone unusable without ever saying anything reportable. The bound
 * is on placing, not on connecting, because the interruption happens whether or
 * not anybody answers.
 */
export const maximumRtcInvitationsPerCaller = 30;

/**
 * How many calls one person may place to one other person in the window.
 *
 * Deliberately much smaller than the per-caller bound, because repeated calling
 * of one person is the shape harassment actually takes. Somebody who is not
 * being answered has their answer; the limit says so rather than letting the
 * ringing continue.
 */
export const maximumRtcInvitationsPerPair = 6;

/**
 * How many live calls one person may be in at once.
 *
 * One live call per pair is already enforced by a unique index, so this bounds
 * calling several different people simultaneously. A person genuinely holds one
 * conversation at a time; a handful of concurrent sessions is the slack for a
 * call that has not finished tearing down, and anything past that is a caller
 * spraying invitations rather than talking to somebody.
 */
export const maximumConcurrentRtcCalls = 3;

/**
 * How many join credentials one person may be issued in the window.
 *
 * A credential is the one thing this platform hands out that a third party will
 * honour without asking again, so minting them is bounded per person regardless
 * of how many calls they are in. This is the last line rather than the first:
 * every issuance already re-composes eligibility.
 */
export const maximumRtcJoinIssuancesPerUser = 60;

/**
 * How many join credentials one person may be issued for one call.
 *
 * This is the reconnect-churn bound. A reconnect obtains a fresh credential, so
 * counting issuances against a session counts reconnect attempts without a
 * separate ledger — and an endpoint reconnecting in a tight loop is either
 * broken or being driven, and either way is spending credential mints on a call
 * that is not working.
 */
export const maximumRtcJoinIssuancesPerSession = 12;

/**
 * How many provider rooms one person may cause to be created in the window.
 *
 * Reaching a provider costs money and leaves a room that has to be torn down,
 * so the bound exists even though a room is only created for a call somebody
 * answered. It is above the per-caller invitation bound being reachable, so it
 * binds only when something is creating rooms without calls to put in them.
 */
export const maximumRtcProviderSessionsPerCaller = 20;

/**
 * What has to be decided or built before calling may be enabled in a deployed
 * environment. Each entry is a real blocker, not a caution.
 *
 * The runtime enforces this rather than merely documenting it: the eligibility
 * adapter that permits a call is refused outside development and test, and no
 * RTC provider adapter is approved, so a deployed environment denies every
 * invitation instead of running RTC with no provider and no Trust & Safety
 * authority behind it.
 */
export const productionBlockers = [
  'no-approved-rtc-provider',
  'call-retention-duration-undecided',
  'regional-availability-undecided',
  'recording-posture-undecided',
  'rtc-operations-ownership-unassigned',
  'native-mobile-rtc-feasibility-undecided',
] as const;

/**
 * Recording posture, stated so it cannot be quietly misdescribed.
 *
 * **No call is recorded, stored, transcoded, or transcribed**, no code path
 * does any of those things, and no configuration value turns one on. No surface
 * may claim or imply that a call is recorded, and none may imply that it could
 * be. Enabling recording is a separate architecture with its own consent,
 * indication, retention, moderation, and jurisdiction decisions, none of which
 * exists.
 */
export const callRecordingImplemented = false;

/**
 * Call retention.
 *
 * **No retention duration is approved.** It is
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, and nothing in this codebase may
 * invent one. Nothing expires, there is no sweep, and no correctness rule
 * depends on a row being physically gone — lifecycle, authorization, and
 * ordering are all decided from state that is present — so applying an approved
 * duration later removes data without changing how any of this behaves.
 */
export const callRetentionDuration = undefined;

/**
 * Bounds on everything a provider hands back.
 *
 * A provider is an untrusted input, and an unbounded string from one is a
 * denial-of-service surface and a storage surface at the same time. These are
 * the widths the database enforces and the runtime guards in `./provider.ts`
 * check before anything is persisted.
 */
export const maximumRtcProviderReferenceLength = 200;
export const maximumRtcProviderEventIdLength = 200;
export const maximumRtcProviderEventTypeLength = 100;
export const maximumRtcIdempotencyKeyLength = 200;

/**
 * How long a participant's join credential is good for.
 *
 * Minutes, not hours. The credential is the one thing the platform hands out
 * that a provider will honour without asking again, so its lifetime is the
 * width of the window between a safety decision and that decision reaching the
 * media path. Shortening it is the only lever the platform fully controls:
 * revocation depends on a third party performing it, and this does not.
 *
 * Long enough to survive a slow client establishing a connection, short enough
 * that a stolen one is worth little. Re-issuance is a fresh eligibility
 * composition rather than an extension, so a longer call does not need a
 * longer credential.
 */
export const rtcJoinCredentialTtlMilliseconds = 120_000;

/**
 * The ceiling a credential lifetime may never exceed, asserted by test.
 *
 * A separate constant from the value above because the value is a tuning
 * decision and this is a safety property. Raising the lifetime past this is a
 * decision that has to be taken deliberately, against this line, rather than by
 * editing a number that looked adjustable.
 */
export const maximumRtcJoinCredentialTtlMilliseconds = 300_000;

/**
 * What a provider operation is trying to achieve.
 *
 * Recorded so an obligation the platform owes a provider — tear this room
 * down, remove this participant — survives the process that discovered it.
 * A crash between deciding and doing must leave the obligation, not lose it.
 */
export const rtcProviderObligations = [
  'create_session',
  'revoke_participant',
  'terminate_session',
] as const;
export type RtcProviderObligation = (typeof rtcProviderObligations)[number];

export const rtcProviderObligationStates = [
  'pending',
  'discharged',
  'abandoned',
] as const;
export type RtcProviderObligationState =
  (typeof rtcProviderObligationStates)[number];

/**
 * How many times an obligation is attempted before it is abandoned loudly.
 *
 * An abandoned obligation is not a discarded one: the row stays, carrying what
 * the platform owed and did not manage to do, because a provider still holding
 * a room the platform ended is exactly the divergence reconciliation exists to
 * find and an operator needs to see.
 */
export const maximumRtcObligationAttempts = 8;

/**
 * What has happened to a verified provider event.
 *
 * `ignored` is a first-class outcome rather than a failure. A provider is
 * entitled to tell the platform about a room it no longer recognises, an event
 * type nobody acts on, or a call that ended before the message arrived, and
 * recording that it was seen and deliberately not acted on is what stops the
 * same event being retried forever.
 */
export const rtcProviderEventStates = [
  'received',
  'retry_wait',
  'processed',
  'ignored',
  'dead_letter',
] as const;
export type RtcProviderEventState = (typeof rtcProviderEventStates)[number];

/** How many times a verified event is applied before it is retired loudly. */
export const maximumRtcProviderEventAttempts = 8;

/**
 * The largest callback body this platform will read.
 *
 * Enforced before anything parses, because a parser is the wrong place to
 * discover that a body is hostile. A provider with something legitimate to say
 * says it in far less than this.
 */
export const maximumRtcProviderEventBytes = 64 * 1024;
