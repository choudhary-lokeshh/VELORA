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

Two of those states have a deadline, and the session records when its current state began rather than only when the row was last written. A call may sit `connecting` for a bounded time before it is `failed` with a join timeout, and an interruption is treated as an interruption for a bounded grace before the call is `ended`. Both are discovered by a sweep reading a deadline that is already true, which is why a worker that never runs delays a record and changes no decision. An interruption itself changes nothing but the state: the participants, the provider room, the authorization generation, and the instant media first flowed all survive it, because advancing the generation would kill a credential the other side is still using.

Exactly two participants exist, they are distinct, and their roles are fixed at creation. A session with one participant, three participants, or the same person twice is refused by the schema rather than by a check somebody could forget to write.

## Eligibility

RTC introduces no new social relationship, because inventing one would create a second, weaker answer to a question DISCOVERY, LIVE, and TRUST & SAFETY already own. A session is permitted exactly where the existing server-side relationship already permits contact:

- the caller is an authenticated Consumer principal on the Consumer audience;
- the caller's account is in a standing that permits interaction;
- the relationship the session was created under is still current;
- TRUST & SAFETY reports no pairwise block;
- TRUST & SAFETY reports no live enforcement denying consumer interaction to either party.

The third predicate is the only one that depends on *why* the session exists, and since [ADR-0040](../decisions/ADR-0040-random-live-discovery.md) a session carries a `purpose` that says which question to ask. An `introduced` session — a call somebody placed — is judged against DISCOVERY's current mutual introduction. A `live_discovery` session — two strangers the server put together — is judged against LIVE's current encounter. The purpose is a stored column rather than something inferred from which reference is present, because inference would let a session silently change which predicate judges it, which is precisely how a few minutes of random discovery would become a standing permission. A session with neither reference, or with both, is refused by the schema.

That composition is taken on invitation, on acceptance, on every join-authorization issuance, and on every reconnect. It is taken inside the transaction that writes, under the pair lock, on the caller's executor — the same discipline `docs/domains/messaging.md` and `docs/domains/notifications.md` already follow, and for the same reason: a check that commits separately from the write it authorizes is not a check.

An answer is never cached on the session. There is no `eligible` column, because a column would be a decision made at some earlier time being applied at this one.

Configuration decides whether the composed contract is available at all. `REALTIME_CALL_ELIGIBILITY` defaults to `unavailable`, which refuses every pair, and that is what a deployed environment gets. Calling is blocked on decisions nobody has made, not on a missing implementation, and the runtime enforces the block rather than documenting it.

## Provider boundary

`RtcProvider` is a capability-declaring port covering the whole of what a provider is ever asked to do: create a session, issue a participant grant, revoke a participant, end a session, read current state, and normalize an event. Provider SDK types never leave it, and no session identifier, route, contract, or event carries a vendor concept.

Three adapters exist. `unavailable` refuses every operation and is the only value staging and production accept. `local-test` is deterministic, in-process, and reaches no network; it exists so the orchestration around a provider is exercisable before one is approved, and it is named so no passing test can be read as evidence about a real one. `livekit` is the first adapter that carries a real packet. Selection is one configuration value read at the composition root and rejected at startup outside local and test — for all three, and for two different reasons.

The port publishes one more thing than it used to: `clientEndpoint`, the address a client presents a credential at. It is adapter configuration rather than a per-grant value, it is absent for every adapter that carries no media, and it is not a second credential — it is a media project's public address and admits nobody on its own. It is what lets a surface tell "there is a session and nothing is carrying it" from "connect here".

The `livekit` adapter derives its room name as an HMAC of the platform's own committed idempotency key under the project's API secret: deterministic, so an ambiguous create is recovered by asking the provider what it did with that key, and unguessable without the secret. The name is deliberately not the session identifier, so a provider — and anything a provider logs or exports — never holds one. The platform's session reference travels in room metadata because the orchestrator refuses a snapshot naming a different session, and it is the only VELORA value the adapter sends anywhere: no display name, handle, region, language, or account identifier reaches the provider, and the participant identity is the existing per-session hash. Rooms are created with a maximum of two participants, so a stolen or replayed credential cannot add a third even if every check on this side were bypassed. Nothing is recorded: no egress is requested anywhere, `roomRecord` is never granted, and a unit test asserts the capability is false.

Creating a provider session is two transactions with a network call between them: reserve the durable session and its provider-operation identity and commit, call the provider, then bind the reference in a second transaction. A crash at any boundary leaves a recoverable record. No provider call runs inside a database transaction, because a pooled connection held across somebody else's network is a connection [ADR-0019](../decisions/ADR-0019-database-connection-admission.md)'s admission bound cannot account for.

No provider is approved. [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), researched from official sources on 2026-08-20, approves nobody: one candidate prohibits VELORA's business on its published terms, one offers no media isolation between unrelated calls, two could not be read at all, and the rest carry unresolved written-confirmation gaps.

The `livekit` adapter existing does not change that, and is not meant to. It is built so the integration can be *proved* against a real provider before the answer arrives, and configuration refuses it in staging and production for the recorded reason: the vendor's acceptable-use policy reserves unbounded discretion over "otherwise objectionable" content, which is exactly what VELORA is, and silence is not permission. There is no fallback between the three values either — a `livekit` selection missing its URL, key, or secret fails to compose rather than degrading to simulation.

## Join authorization

A credential names one session and one participant, carries the least capability that lets that participant take part, and expires in minutes. VELORA never returns a room-wide secret and never returns a credential belonging to somebody else. Nothing reusable is persisted: what is stored is that an issuance happened, to whom, under which authorization generation, and when it expires.

Every session carries an authorization generation. Ending, rejecting, cancelling, revoking, and enforcing all advance it, which is what makes a previously issued credential dead at the platform boundary immediately, during the window before a provider has finished acting on a revocation. That window exists, is bounded by the credential's own lifetime, and is described in [the threat model](../security/12-rtc-threat-model.md) rather than implied away.

Where TURN credentials are issued, they are ephemeral, scoped, and time-limited. A static username and password in application configuration is not an option this domain has.

Against a real provider the grant is narrower still, and stated positively so a future SDK default cannot widen it: join on exactly one room, publish and subscribe, and nothing else — no room creation, no room administration, no room listing, no recording, no data channel, and no metadata write. What may be published follows the medium, so a voice encounter may publish a microphone and cannot publish a camera; a screen share is absent from both, because a live encounter is two strangers looking at each other and no moderation position covers arbitrary content being put in front of one of them. Removing a participant carries a revocation instant, so the provider stops honouring every credential minted before it rather than continuing to accept a bearer token this platform has already handed out.

## Provider events

A provider callback enters a durable inbox only after its exact raw bytes authenticate, before anything parses them. What is stored is a digest and a normalized allow-list, never a body. Event identity is unique per provider, account, and environment.

Duplication, reordering, replay, and permanent absence are all expected. None is an error, and none changes a decision. A verified event may update the platform's technical observation of a call; it may never create a participant, grant permission, extend a credential, reverse a platform end, override a block or enforcement, or resurrect a superseded generation. A provider saying a room is alive after the platform ended the call is a divergence to reconcile, not an instruction to obey.

## Signalling transport

Call control is HTTP mutation against published routes, and the resulting lifecycle is PostgreSQL truth. Delivery of call events to connected clients is a fanout over ephemeral infrastructure; clients recover by reading authoritative state, as [ADR-0008](../decisions/ADR-0008-realtime-rtc.md) requires of every realtime event. A lost fanout message costs a UI refresh and never a call's existence, and Redis pub/sub is never a lock, a queue of record, or a reason a call is in a state.

VELORA relays no SDP and no ICE candidates. Offer and answer negotiation belongs to the provider's own signalling path in every architecture assessed, and a platform that relayed them would be a place they could be logged.

## Safety

Safety dominates RTC, in one direction only. A block or a live enforcement refuses a new invitation, invalidates a pending one, refuses join authorization, refuses reconnect, and ends an active call. Nothing about a call — not an accepted invitation, not an active media session, not a provider insisting the room is alive — weakens a safety decision or delays one.

Ending is what makes that true of a call already in progress, rather than only of the next thing the pair does. REALTIME publishes one contract for it — end the live call between two people, or end every live call one account is in — and that is the whole of what a safety decision may do here. It cannot start a call, answer one, read who is in one, extend a credential, or move a terminal call back to life, because none of those is a decision the enforcement scope covers and a contract allowing them would be a second, unreviewed way into calling.

**The decision and the ending commit together.** A block ends the call inside the transaction that records the block, under the pair lock the blocker already holds, so there is no instant in which the block stands and the call it should have stopped is still running. A restriction ends the subject's calls inside the transaction that imposes it, for the same reason: leaving them running would let the restriction be outlived by exactly the conversation it was imposed over.

The call is locked before it is ended, not merely read. The pair lock keeps other decisions about these two people out, but a call also moves on its own — binding a provider, media being observed, a stall sweep closing it — and none of those take the pair lock. An unlocked read would take a state that stops being true before the guarded write lands, and the write would then match nothing.

Ending advances the authorization generation, so every credential outstanding for that call dies at the platform boundary immediately, whatever the provider still believes. A ringing call ends rather than being recorded as declined or withdrawn: `invited -> ended` exists in the transition table for this path alone, because routing a safety decision through either of the participants' own outcomes would record one of them as having decided when neither did. A call that has already finished is left exactly as it was — rewriting why it ended would destroy the record of what happened.

A participant may report the other participant of a session they were in. The report references the session, the participants, and the timestamps. It carries no media, no SDP, no ICE data, and no addresses, because none of those exist to carry. Reporter privacy follows the TRUST & SAFETY architecture unchanged.

## Abuse

Calling is expensive to the person receiving it and to whatever provider is behind it, so the limits are server-side and deterministic: invitations per caller, invitations against one target pair, concurrent outstanding calls, join-authorization issuances, provider session creations, and reconnect churn. Windows use an injected clock so a limit is asserted where it actually falls rather than where a fast loop happens to land. A refusal discloses nothing about the target's state.

**Every one of them is counted from rows this domain already keeps**, not from a counter in an ephemeral store. That is a correctness property rather than a saving: a limit held only in Redis is reset by a flush or a restart, so getting past one would be a matter of waiting for an operational event. Invitations, concurrent calls, and provider rooms are counted from `realtime_sessions`; issuances per person and per call are counted from `realtime_join_issuances`, written by the same path that mints, so no route can spend a credential without it appearing in the count.

The per-pair bound is deliberately far below the per-caller one. Repeated calling of one person is the shape harassment actually takes, and somebody who is not being answered already has their answer. Counting reconnect churn as issuances against a session needs no separate ledger, because a reconnect obtains a fresh credential by design.

The counts are taken inside the transaction that writes and under the pair lock the caller already holds, on the same rule as every other check here: a count taken outside is a number that was true a moment ago, and two invitations racing would both read it and both write.

A refusal says only that a bound was reached. It does not say which bound, how much of it remains, or when it lifts, and it answers identically however often it is asked — a refusal carrying its own counter would be a way to measure somebody else's calling. It is a `409` with `RATE_LIMITED`, the product convention; `429` belongs to AUTH's answer about authentication attempts, and reusing it would put a product limit in the bucket a client treats as "retry the sign-in".

## Scale

Almost every question this domain asks is about a *live* call, and a live call is a vanishing fraction of the rows: a call is an event, its history is kept forever, and no retention duration is approved. So the indexes are partial on the live states, and what the scale suite checks is that the planner uses them rather than walking a history that grows without bound. It asserts plans taken from `EXPLAIN` on seeded volume rather than timings, because a sequential scan that is fast on a hundred calls is an outage on a million.

The access paths held to a plan are the pair's live call, every live call one account is in from either side of the ordered pair, both deadline sweeps, the per-person and per-call credential counts, the obligation drain, and the operator screen's join.

One measured detail decides how those assertions are written. Dropping the state-deadline index does **not** produce a sequential scan — the planner falls back to another live-partial index and applies the deadline as a filter, which reads every live call on every cycle. A "no sequential scan" assertion would pass straight through that regression, so the sweep tests pin the index by name. The pair lookup deliberately does not: three indexes are partial on the live states and any of them answers it in a couple of pages, so naming one would assert a planner choice rather than a property.

## Operations

An operator sees calling as counts, ages, and adapter names. The state screen carries **no identifier of any kind** — not a call, not an account, not a provider room — because a screen somebody watches all day must not become a window onto who is talking to whom. Two people having a call is not an operational fact.

There is no list of calls and no search anywhere in the operator contract. The comparison with media is the one that settles it: an asset has one owner, while a call is a relationship between two people that neither of them published, so a browsing surface over calls exposes something no product surface would.

Every backlog class is reported on every read, including the empty ones, with the age of the oldest thing in it and the threshold at which it becomes an alert. A count alone cannot separate a busy platform from a stuck one — forty calls past their join timeout in the last minute and one past it since Tuesday are the same number and opposite situations — and a list that omitted the healthy classes could not be told apart from a signal that stopped arriving. The age is absent rather than zero when nothing is waiting, because a zero reads as "waited no time at all" and an alert rule written against it would be written against a lie.

One disagreement gets a number of its own: calls that ended while their teardown did not discharge, which is the case where the platform believes a call is over and a provider may still be holding the room open. It is counted rather than listed, for the same reason as everything else here.

One call can be read by an operator who already holds its identifier from a report or a reconciliation finding. It carries the lifecycle — state, medium, timings, why it ended, the authorization generation, how many credentials have been minted against it, and the teardown owed — and it carries no participant, no credential, no provider room reference, and no address. A call that does not exist is answered exactly as one that does, so guessing identifiers is not productive here either.

**There is no operator action at all.** No ending a call, no revoking a credential, no forcing a teardown. Ending somebody's call is a safety decision, and safety decisions go through TRUST & SAFETY where they acquire an enforcement record, a reason, and an appeal path; a console button would be that same power with none of them. Teardown that will not discharge belongs to reconciliation and is surfaced as a number to alert on rather than a button to press.

## Adversarial review

A hostile read of the finished domain is kept as a suite of its own, and it attacks the published contracts rather than repeating what the behaviour suites cover: keeping a credential alive past its terms, learning something about somebody who is not answering, recording a call that did not happen, and making the platform disagree with itself about who is in a call.

It found one gap and closed it. The vocabulary check accepted any known end reason on any terminal state, so a `failed` call could carry `declined` — a row claiming a person decided something they did not. The service already refused it, but the database did not, and this domain's rule is that the database refuses what the domain forbids. The constraint now maps each terminal state to exactly the reasons that belong to it, where a migration or a repair script cannot get around it.

One property is worth naming because nothing else would catch it breaking. The name a provider knows a participant by is derived rather than stored, and a revocation obligation recorded in the API process is discharged by the worker — so a per-process or upgrade-changed hash seed would leave every revocation naming somebody the provider has never heard of, and nothing would fail until a real revocation had to work. The derivation is asserted directly against its inputs.

## Privacy

No call media, recording, transcript, SDP, ICE candidate, TURN credential, reusable join credential, or participant IP address is stored, logged, traced, or published as a metric label. Recording is not implemented and no configuration value enables it; it remains `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

Call retention duration is undecided. Nothing expires on a timer and no correctness rule depends on a row being gone, so an approved schedule later applies as a deletion pass rather than as a redesign.

## Permissions, phase, and open questions

Participants act only on sessions they are in, and only on their own participation. Operators receive read-only aggregate and exact-reference views with no media and no transport detail; a manual termination requires the Platform Admin audience, an explicit permission, [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md) step-up, and audit, and is absent where that authority is absent.

The provider-neutral core is V1 by [product phases](../product/01-product-phases.md). `DECISION REQUIRED`: RTC provider and hosting mode, regional availability, retention, native mobile RTC feasibility, in-call safety intervention authority, emergency-calling posture, and operations ownership. `LEGAL REVIEW REQUIRED`: recording, transcription, and retention.

See [RTC lifecycle](../flows/rtc-lifecycle.md), [ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md), [RTC threat model](../security/12-rtc-threat-model.md), [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), and [provider adapters](../architecture/06-provider-adapters.md).
