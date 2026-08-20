# RTC threat model

## Scope and trust boundaries

This model covers VELORA's provider-neutral RTC core: call invitation and lifecycle, eligibility composition, join-credential issuance, provider orchestration, provider-event intake, realtime signalling fanout, reconnect and recovery, consumer call surfaces, safety integration, abuse limits, workers, reconciliation, and read-only Admin operations.

Untrusted: both clients, every client-reported connection state, provider SDKs, provider dashboards, provider callbacks, provider state reads, networks, browser tabs, mobile applications, notification delivery, and queues. PostgreSQL is durable truth. Redis and BullMQ are execution and fanout infrastructure and are never business truth.

The domain intentionally stores no call media, no recordings, no SDP, no ICE candidates, no TURN credentials, no reusable join credentials, and no participant IP addresses.

Two adversaries deserve naming because they are not the usual ones. The **counterpart** is a person the platform has already decided may contact the target, so every control that assumes an attacker is a stranger is inapplicable to them. The **provider** is not malicious but is authoritative about media and unaware of safety, so anything it reports must be read as an observation and never as a decision.

## Threats and required controls

| Threat | Required control | Verification evidence |
|---|---|---|
| Forged invitation naming a participant the caller may not contact | Target resolved server-side from the caller's principal and DISCOVERY's published connection contract; no request field names a participant, session, provider, room, scope, or state | Contract and hostile-input tests; participant-injection tests |
| Forged acceptance, cancellation, or end by a non-participant | Every transition re-resolves the acting principal against the session's participant rows; a non-participant is answered identically to a session that does not exist | Cross-user transition tests on every route |
| Cross-account session IDOR and session enumeration | Opaque server-generated identifiers; absent, ended, and not-yours answer identically; no route lists or searches sessions across users | Enumeration and negative-audience tests |
| Join credential issued for another participant | Credential issuance derives the participant from the authenticated principal and the session's own rows, never from the request | Substitution tests: A requests, B's identity asserted |
| Join credential replayed after end, rejection, revocation, or block | Credentials carry the session's authorization generation; ending, rejecting, cancelling, revoking, and enforcing all advance it; a credential from a superseded generation is refused at the platform boundary | Stale-generation, post-end, post-block issuance and reuse tests |
| Join credential outlives the decision that authorized it | Minutes-scale TTL fixed by policy and asserted by test; re-issuance is a fresh full eligibility composition, never an extension | TTL bound assertions; reconnect re-authorization tests |
| Room-wide secret hands one participant the other's access | No room secret is ever returned; every credential is single-participant and single-session | Response-shape tests asserting no shared credential field exists |
| Credential, TURN secret, or provider key reaches a log, trace, error, metric, or analytics event | Allow-listed structured logging; adapter outputs sanitized before logging; canary strings asserted absent from every sink | Canary-string log, trace, and outbox tests |
| SDP or ICE candidate persisted or logged | No column holds either; the platform relays neither in V1; a column enumeration test asserts it | Schema enumeration and log tests |
| Participant IP address becomes a metric label or a durable row | Metrics carry no participant identity and no address; no address column exists | Metric-cardinality and schema tests |
| Client asserts it is connected, or asserts a call is still active after the platform ended it | Connection state is an operational observation from verified provider events; product authorization is never derived from it; a platform end is terminal regardless of what a client reports | Client-asserted-state tests; post-end client transition tests |
| Block lands while ringing, while connecting, or mid-call | Eligibility re-composed under the pair lock inside the writing transaction on invite, accept, issuance, and reconnect; a live block invalidates pending invitations, refuses issuance and reconnect, and ends an active session with a revocation obligation | Block-race tests at each transition; concurrent block-and-accept tests |
| Enforcement applied while a call is in flight | Same composition and same precedence as the block path, taken from the published TRUST & SAFETY capability contract rather than re-derived | Enforcement-race tests at each transition |
| Eligibility answered from cache, from an earlier step, or from the client's page | Every predicate takes the caller's executor and is asked at the moment of the write; no eligibility result is stored on the session | Instrumented-executor tests; stale-eligibility tests |
| Forged provider callback | Exact raw bytes authenticated before parsing; provider, account, and environment binding; constant-time comparison; unverifiable input creates no row | Bad-signature, mutated-body, wrong-account, wrong-environment tests |
| Duplicated, replayed, reordered, or absent provider events | Unique event identity per provider, account, and environment; idempotent application; lifecycle precedence rather than arrival order; absence recovered by reconciliation rather than assumed benign | 50-way duplicate, reorder, replay, and missing-callback tests |
| Provider event grants permission, creates a participant, or reverses a platform decision | Verified events may update technical observation only; a closed allow-list of applicable transitions; no event path writes participants, credentials, or eligibility | Adversarial event tests attempting each forbidden effect |
| Provider reports a session active after the platform ended it | Platform end wins; reconciliation records the divergence and discharges termination and revocation obligations; no path resurrects an ended session | Drift tests; ended-with-live-room tests |
| Oversized, malformed, or decompression-abusing callback body | Byte limit enforced before parse; bounded shape and depth; fast refusal; no remote fetch of anything a payload names | Oversize and malformed-payload tests |
| SSRF through provider-supplied URLs or references | Adapters call fixed configured origins through the approved outbound boundary; no callback, redirect, room, or event field is fetched | Boundary tests; hostile-URL tests |
| Test provider active in a deployed environment | Startup refusal for `local-test` outside local and test; `unavailable` is the default and refuses every operation; no route, header, query, or client field selects an adapter | Configuration-startup tests; adapter-selection tests |
| Provider I/O inside a database transaction exhausts admission | Session creation is reserve-commit, call, bind-commit; adapter instrumentation asserts no open transaction during any provider call | Instrumented-adapter and pool tests |
| Call spam, target harassment, and provider resource exhaustion | Server-side limits on invitations per caller, invitations per target pair, concurrent outstanding calls, credential issuances, provider session creations, and reconnect churn; deterministic windows with an injected clock; refusals disclose no target state | Rate-limit boundary, reset, multi-replica, and disclosure tests |
| Ringing storm across a user's devices becomes multiple accepted calls | Acceptance is a single durable transition guarded by the session's own state; later devices observe the accepted session rather than accepting again | Multi-device accept-race tests |
| Notification path becomes the source of call truth | Invitation is durable before any notification; delivery failure loses a ring, never a call; missed-call facts derive from lifecycle, not from delivery outcome | Notification-loss and duplicate-delivery tests |
| Realtime fanout treated as durable | Redis fanout carries hints; clients recover authoritative state by reading it; a fanout outage degrades UI only | Fanout-loss, multi-replica, and resync tests |
| Signalling connection outlives its session or its authorization | Connection authenticated from current AUTH session; membership re-authorized on join and on sensitive transition; revocation disconnects | Connection-authorization, revocation, and stale-tab tests |
| Worker crash, lease loss, or multi-instance race on revocation and cleanup | PostgreSQL leases, bounded attempts and backoff, lease-owner settlement, dead-lettering, reconciliation as the backstop | Multi-worker, crash, and lease-expiry tests |
| Reconciliation resurrects an ended call or overrides safety | Reconciliation records a finding before it repairs; repairs are idempotent, bounded, and may only move toward termination; safety and platform state always win | Concurrent-reconciler, drift, and safety-precedence tests |
| Report about a call discloses transport detail or reaches an unrelated session | Reports reference session, participants, and timestamps only; reporter must be a participant of the named session; unrelated and non-existent answer identically | Report-authorization and payload-shape tests |
| Admin surveillance, enumeration, or unaudited termination | Read-only aggregate and exact-reference reads; no media, no transport detail, no addresses; termination requires the Platform Admin audience, permission, ADR-0017 step-up, and audit, and is absent if that authority is absent | Route-inventory, negative-audience, and payload tests |
| Recording enabled accidentally or by a provider default | No recording code path exists; adapters declare and assert recording off; a capability that would record is refused rather than ignored | Adapter capability tests asserting refusal |

## The window that is not closed

A join credential issued a moment before a block commits remains valid at the provider until it expires or until the provider finishes acting on a revocation. No arrangement of this code removes that: the platform cannot make a third party's decision atomic with its own. It is bounded by the credential's TTL, narrowed by advancing the session's authorization generation so no further platform action accepts it, and made visible by recording a revocation obligation whose discharge is measurable. It is stated here rather than implied, on the same principle as the notification send window in `docs/domains/notifications.md`.

## Privacy

No call media, recording, transcription, SDP, ICE candidate, TURN credential, or reusable join credential is stored anywhere. Durable RTC state is limited to lifecycle facts: who was invited, by whom, under which relationship, at which times, in which state, against which provider reference, and why it ended.

Call retention duration is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. No duration is invented in code, nothing expires on a timer, and no correctness rule depends on a row being physically gone, so an approved schedule later applies as a deletion pass rather than as a redesign.

Deletion and data-subject requests are coordinated by USERS for account lifecycle and executed by REALTIME for its own records. Any provider-held metadata is governed by an approved per-provider retention and residency decision that does not exist.

## Release blockers

Live calling remains blocked without: an approved provider and provider-specific ADR; written use-case eligibility where published terms are silent or discretionary; an approved recording posture; approved regional availability; approved retention and residency; a native mobile RTC decision; an operations owner, alert routing, and on-call rotation; and an approved product phase and design handoff.

See [ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md), [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), [security baseline](01-security-baseline.md), [RBAC](02-access-control-rbac.md), [privacy and retention](03-privacy-retention.md), [abuse and outbound networking](06-abuse-outbound-networking.md), and [RTC lifecycle](../flows/rtc-lifecycle.md).
