# REALTIME domain

## Purpose and scope

REALTIME owns real-time communication sessions: the call invitation, the call's lifecycle, who its authorized participants are, which provider session it is bound to, what a provider has observed about it, what must still be revoked or torn down, and what an operator may see about its health.

It owns none of the facts a call depends on. AUTH owns the principal and the session that authenticates a request. USERS owns account standing. DISCOVERY owns whether two people are mutually introduced. TRUST & SAFETY owns blocks, enforcement, and every communication restriction. NOTIFICATIONS owns durable delivery. MESSAGING owns conversations and message history. REALTIME asks each of them through its published contract and re-derives nothing.

It does not own message or content records, presence projections, recordings, transcripts, media bytes, entitlement, or any vendor's state as source truth. MEDIA owns stored objects; RTC owns ephemeral transport that produces no object to store.

V1 is one-to-one consumer voice and video. Group calls, rooms, livestreaming, broadcast, creator paid sessions, presence, and recording are out of scope and unbuilt. [ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md) is the architecture authority.

## The four facts a call is made of

A call is not one state that gradually becomes true. It is four separate facts, and none of them implies the next.

**An invitation** records that one person asked to talk to another. It is created only after eligibility passes, it is durable before anybody is notified about it, and it expires on its own without either party acting.

**An acceptance** is a platform fact taken from an authenticated request by the person who was invited. It is never inferred from a provider event, a notification receipt, or a client's claim.

**A join authorization** is a specific, short-lived, single-participant credential issued to one authenticated principal after every eligibility predicate is re-evaluated at that instant. Holding an accepted invitation does not entitle anybody to one, and holding one is not permission to hold another.

**A connection** is something a provider observed. It updates what the platform knows about the call's technical state. It grants nothing, extends nothing, and restores nothing.

The reverse direction is closed the same way. A call ending on the platform does not mean the provider has torn anything down, so an end records a revocation obligation that a worker discharges and reconciliation verifies.

## Lifecycle

`invited` is the only entry state. From it, a call reaches `accepted` when the recipient answers, `rejected` when they decline, `cancelled` when the caller withdraws, or `expired` when the invitation's own deadline passes with no answer. From `accepted` it moves to `connecting` while authorization is issued and endpoints join, `active` once media is observed, `reconnecting` while a bounded grace period runs, `ending` while termination and revocation are discharged, and `ended` when they are. `failed` records a call that could not be established.

Every transition is constrained. There is no path from a terminal state to any other, no path that skips acceptance, and no path a client can assert. A session that reaches a terminal state stays there, and every later attempt to transition it answers idempotently rather than erroring, because a retried hang-up is the normal case and not an exception.

Exactly two participants exist, they are distinct, and their roles are fixed at creation. A session with one participant, three participants, or the same person twice is refused by the schema rather than by a check somebody could forget to write.

## Eligibility

RTC introduces no new social relationship, because inventing one would create a second, weaker answer to a question DISCOVERY and TRUST & SAFETY already own. A call is permitted exactly where the existing server-side communication relationship already permits contact:

- the caller is an authenticated Consumer principal on the Consumer audience;
- the caller's account is in a standing that permits interaction;
- DISCOVERY reports a current mutual introduction between the two;
- TRUST & SAFETY reports no pairwise block;
- TRUST & SAFETY reports no live enforcement denying consumer interaction to either party.

That composition is taken on invitation, on acceptance, on every join-authorization issuance, and on every reconnect. It is taken inside the transaction that writes, under the pair lock, on the caller's executor — the same discipline `docs/domains/messaging.md` and `docs/domains/notifications.md` already follow, and for the same reason: a check that commits separately from the write it authorizes is not a check.

An answer is never cached on the session. There is no `eligible` column, because a column would be a decision made at some earlier time being applied at this one.

Configuration decides whether the composed contract is available at all. `REALTIME_CALL_ELIGIBILITY` defaults to `unavailable`, which refuses every pair, and that is what a deployed environment gets. Calling is blocked on decisions nobody has made, not on a missing implementation, and the runtime enforces the block rather than documenting it.

## Provider boundary

`RtcProvider` is a capability-declaring port covering the whole of what a provider is ever asked to do: create a session, issue a participant grant, revoke a participant, end a session, read current state, and normalize an event. Provider SDK types never leave it, and no session identifier, route, contract, or event carries a vendor concept.

Two adapters exist. `unavailable` refuses every operation and is the only value staging and production accept. `local-test` is deterministic, in-process, and reaches no network; it exists so the orchestration around a provider is exercisable before one is approved, and it is named so no passing test can be read as evidence about a real one. Selection is one configuration value read at the composition root and rejected at startup outside local and test.

Creating a provider session is two transactions with a network call between them: reserve the durable session and its provider-operation identity and commit, call the provider, then bind the reference in a second transaction. A crash at any boundary leaves a recoverable record. No provider call runs inside a database transaction, because a pooled connection held across somebody else's network is a connection [ADR-0019](../decisions/ADR-0019-database-connection-admission.md)'s admission bound cannot account for.

No provider is approved. [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), researched from official sources on 2026-08-20, approves nobody: one candidate prohibits VELORA's business on its published terms, one offers no media isolation between unrelated calls, two could not be read at all, and the rest carry unresolved written-confirmation gaps.

## Join authorization

A credential names one session and one participant, carries the least capability that lets that participant take part, and expires in minutes. VELORA never returns a room-wide secret and never returns a credential belonging to somebody else. Nothing reusable is persisted: what is stored is that an issuance happened, to whom, under which authorization generation, and when it expires.

Every session carries an authorization generation. Ending, rejecting, cancelling, revoking, and enforcing all advance it, which is what makes a previously issued credential dead at the platform boundary immediately, during the window before a provider has finished acting on a revocation. That window exists, is bounded by the credential's own lifetime, and is described in [the threat model](../security/12-rtc-threat-model.md) rather than implied away.

Where TURN credentials are issued, they are ephemeral, scoped, and time-limited. A static username and password in application configuration is not an option this domain has.

## Provider events

A provider callback enters a durable inbox only after its exact raw bytes authenticate, before anything parses them. What is stored is a digest and a normalized allow-list, never a body. Event identity is unique per provider, account, and environment.

Duplication, reordering, replay, and permanent absence are all expected. None is an error, and none changes a decision. A verified event may update the platform's technical observation of a call; it may never create a participant, grant permission, extend a credential, reverse a platform end, override a block or enforcement, or resurrect a superseded generation. A provider saying a room is alive after the platform ended the call is a divergence to reconcile, not an instruction to obey.

## Signalling transport

Call control is HTTP mutation against published routes, and the resulting lifecycle is PostgreSQL truth. Delivery of call events to connected clients is a fanout over ephemeral infrastructure; clients recover by reading authoritative state, as [ADR-0008](../decisions/ADR-0008-realtime-rtc.md) requires of every realtime event. A lost fanout message costs a UI refresh and never a call's existence, and Redis pub/sub is never a lock, a queue of record, or a reason a call is in a state.

VELORA relays no SDP and no ICE candidates. Offer and answer negotiation belongs to the provider's own signalling path in every architecture assessed, and a platform that relayed them would be a place they could be logged.

## Safety

Safety dominates RTC, in one direction only. A block or a live enforcement refuses a new invitation, invalidates a pending one, refuses join authorization, refuses reconnect, and ends an active call. Nothing about a call — not an accepted invitation, not an active media session, not a provider insisting the room is alive — weakens a safety decision or delays one.

A participant may report the other participant of a session they were in. The report references the session, the participants, and the timestamps. It carries no media, no SDP, no ICE data, and no addresses, because none of those exist to carry. Reporter privacy follows the TRUST & SAFETY architecture unchanged.

## Abuse

Calling is expensive to the person receiving it and to whatever provider is behind it, so the limits are server-side and deterministic: invitations per caller, invitations against one target pair, concurrent outstanding calls, join-authorization issuances, provider session creations, and reconnect churn. Windows use an injected clock so a limit is asserted where it actually falls rather than where a fast loop happens to land. A refusal discloses nothing about the target's state.

## Privacy

No call media, recording, transcript, SDP, ICE candidate, TURN credential, reusable join credential, or participant IP address is stored, logged, traced, or published as a metric label. Recording is not implemented and no configuration value enables it; it remains `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

Call retention duration is undecided. Nothing expires on a timer and no correctness rule depends on a row being gone, so an approved schedule later applies as a deletion pass rather than as a redesign.

## Permissions, phase, and open questions

Participants act only on sessions they are in, and only on their own participation. Operators receive read-only aggregate and exact-reference views with no media and no transport detail; a manual termination requires the Platform Admin audience, an explicit permission, [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md) step-up, and audit, and is absent where that authority is absent.

The provider-neutral core is V1 by [product phases](../product/01-product-phases.md). `DECISION REQUIRED`: RTC provider and hosting mode, regional availability, retention, native mobile RTC feasibility, in-call safety intervention authority, emergency-calling posture, and operations ownership. `LEGAL REVIEW REQUIRED`: recording, transcription, and retention.

See [RTC lifecycle](../flows/rtc-lifecycle.md), [ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md), [RTC threat model](../security/12-rtc-threat-model.md), [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), and [provider adapters](../architecture/06-provider-adapters.md).
