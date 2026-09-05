# ADR-0048: An operator control plane, and an activity stream with no table behind it

- Decision date: 2026-09-05
- ADR status: Accepted
- Owners: Founder (decision owner), OPERATIONS, ADMIN, AUTH, LIVE, GROWTH, Platform Admin

## Context

Platform Admin could read the product and could barely operate it. ADR-0036 built the console as six destinations of counted work, and every one of them was honest — but three things had no owner anywhere in the repository, and the absence of each was silent.

**Who an operator is was one boolean.** Every privileged route resolved a Platform Admin audience with a fresh phishing-resistant assurance and then admitted the caller to everything: a refund, a suspension, a media purge, a moderation decision, a support ticket, and an acquisition schedule. There was no way to give somebody the safety queue without also giving them the money, and no way to give somebody a read without also giving them every write. In practice that meant nobody could be given anything.

**Whether a feature is on was a deploy.** Every switch in this product is an environment variable read once at startup. Pausing live matchmaking during an abuse incident meant editing configuration, redeploying, and waiting — which is to say it was not possible during an incident, which is the only time anybody wants it.

**What an operator did was recorded only where the owning domain happened to keep its own record.** A moderation decision writes a decision. A suspension writes an enforcement. Those are excellent, and they cover the acts that existed. Nothing covered an act with no domain record behind it, and the acts this phase adds — flipping a control, granting a capability, signing an account out — are exactly that shape.

A fourth thing was missing and is the one operators ask for first: **a coherent answer to "what happened".** The console could show what is waiting, what one subsystem's health is, and what AUTH's event log holds. It could not show one person's history across the product, and it could not show what the platform had been doing in the last hour.

## Decision

### OPERATIONS is a domain, and it owns three small things

`docs/architecture/03-domain-boundaries.md` gains OPERATIONS. It owns operator capability grants, the operational control store, and the operator action log. It owns nothing else, and specifically it does not own product activity.

Three tables in `0080_operations-control-plane`, and none of them grows with the product. `operations_controls` is one row per switch, keyed on the switch. `operations_operator_grants` is one live grant per operator, enforced by a partial unique index. `operations_operator_actions` accumulates at the rate a human presses a button.

### The activity stream is composed from the domains that own each fact, and there is no event table

This is the load-bearing decision of the phase, and it was the obvious thing not to do.

The obvious design is a telemetry table, a governed event taxonomy, an emitter in every domain, an idempotency key on every emission, an index strategy, and a retention job. That design has four failure modes and every one of them is silent: an event that was never emitted because a code path forgot; an event emitted twice by a retry; an event that disagrees with the record it describes because one of them was written in a transaction that rolled back; and a table that grows without bound until somebody notices.

**Every fact an operator needs is already a row.** A sign-in is `auth_security_events`. An encounter is `live_encounters`. A capture is `wallet_transactions`. A report is `safety_reports`. A ticket change is `support_ticket_events`. `AdminActivityDirectory` reads those originals and merges them, newest first, over a bounded window.

What that buys is not a smaller diff. It is four properties that the parallel-table design has to work for and this one gets structurally:

- **Idempotency is free.** A retried domain action produces one row in the owning table or none, so it produces one activity entry or none. There is no dedupe key to get wrong.
- **Retention is free.** Nothing accumulates that was not already accumulating, and when a domain's retention decision is finally approved and applied, the activity stream shortens with it automatically and correctly.
- **Drift is impossible.** An operator reading the stream and an operator reading the record are reading the same row.
- **Nothing new can leak.** The stream cannot carry a message body because no source column it reads is a message body, and `detail` is one enumerated word bounded at 64 characters in the contract.

The cost is real and is stated rather than hidden: **a fact nobody persists cannot be shown.** This stream cannot show "camera disabled" or "message send failed", because neither is persisted anywhere today. The honest answer to that is to persist the fact in the domain that owns it — where it will also be correct, idempotent, and retained on that domain's own terms — not to build a parallel pipe that would have had the same gap in a different place.

The taxonomy in `apps/api/src/operations/policy.ts` is therefore a list of *sources*, and it is governed in the way that matters: an entry with no source produces nothing, and a source with no entry is invisible rather than mislabelled. There is no `hover`, `scroll`, `render`, or `view` in it, and there is nowhere for one to go.

**The first page carries no upper time bound, and that is a correctness fix rather than an optimisation.** These sources do not share a clock: AUTH stamps its events with the database's `now()` and most other domains stamp theirs with the application's. An upper bound of "the application's now" silently drops an AUTH event the database wrote a millisecond earlier, every time the two clocks differ — which is always. Later pages are bounded by the previous page's last row, an instant that came out of a row rather than off a clock.

### Every operator route names a capability, and the server checks it

`AdminContextResolver.resolve` takes the capability as a required parameter. There is no default, so a new operator route cannot be written without deciding what authorises it — which is the mistake the parameter exists to make impossible. Twenty-two capabilities, seven roles, and roles are a convenience over capabilities rather than a thing routes check: adding a role can never widen what a route admits.

All three refusals — wrong audience, stale assurance, missing capability — answer `403 ACTION_NOT_PERMITTED`. Which condition failed is not a caller's business; an operator learns what they may do from `GET /v1/admin/operator`, which is the one route that needs no capability because it reports only the caller's own standing.

`operators.manage` is its own capability held by one role. An operator who can grant capabilities can grant themselves every other one, so it is kept visible rather than folded into a general administrative idea.

**Where the first grant comes from in a deployed environment is an open decision, not an invented one.** `ADMIN_OPERATOR_BOOTSTRAP` is `grants` everywhere except local and test, and configuration refuses the other value in staging and production. In a deployed environment an operator with no grant may do nothing at all.

### A control the console shows is a control the server obeys

Three controls ship: `live.search`, `growth.invitations`, `growth.scheduled_windows`. Each is read by server code on the path it governs — LIVE's `search` before anything is read on the caller's behalf, GROWTH's mint before anything is minted, GROWTH's publish at read time. There is no control in the store that only a client consults, and adding one would be a lie with a toggle on it.

**Every control defaults to on.** These are pause switches over features that already shipped, so a platform nobody has touched behaves exactly as it did before this migration ran.

**A write is a compare-and-set.** The version the operator read travels with the write and is matched on the update, so the second of two people looking at the same screen is refused and told what actually stands. A control nobody has ever set has version zero, so a first write and a subsequent one are the same operation rather than two paths with two race conditions — and two simultaneous first writes resolve on the primary key.

**A control is cached for five seconds and the bound is published.** These are consulted on the paths people press several times a minute; a query per press would put the busiest read in the product behind a table that changes a handful of times a year. The API publishes the propagation bound and the console prints it beside the switch, because an operator pausing something during an incident has to know whether to wait or press again. A read failure keeps the last known value rather than reverting to the default: an operator who paused live search must not have the pause undone by the database failure they were reacting to.

**Pausing admits nobody new and ends nothing already running.** Two strangers mid-conversation are not cut off by an operator reacting to something neither of them did, and a paused `growth.invitations` still lets every link already shared work — breaking those would punish the person who shared one rather than the abuse.

### Every operator command writes an audit row, including the ones that were refused

`operations_operator_actions` records the operator, the capability that authorised the route, what the action was about, what it was changing from and to, the reason, the correlation identifier, and the outcome. `refused` is a first-class outcome: an operator who tried to pause live search and was told no is a thing an incident review needs to see, and an audit of successes only would show the incident with a hole in the middle of it. A malformed command is recorded too.

Append-only is a property of the code rather than a trigger: there is no update, no delete, and no method taking an action identifier anywhere in the domain, and no route that could reach one if there were. The row is written after the command settles and outside its transaction — an audit row that rolled back with a failed command would leave no trace of the attempt, which is the one thing an audit exists to prevent.

### Ending one person's live encounter from the console was considered and not built

§21 of the phase brief asks for it. This repository had already decided otherwise, in ADR-0036 and in LIVE's and REALTIME's enforcement contracts: ending somebody's call is a safety decision and goes through TRUST & SAFETY, where it acquires a record, a reason, and an appeal path. An operator who needs to stop live matchmaking has a global control that touches nobody in particular; an operator who needs to stop one person has a safety decision to make. `encounter` stays in the operator-subject vocabulary so a later, audited encounter action does not have to migrate a CHECK constraint.

### Nothing on the operator surface is a rate, a score, or a percentage

Every figure the console gained is a count of rows an operator can open, and every reconciliation finding publishes the definition that produced it beside its number — a number nobody can define is a number nobody should act on. Three refusals are worth naming because each was easy and wrong:

**There is no "users online".** A closed browser, a sleeping phone, and a dropped tunnel are identical from the server. A made-up figure at the top of the live screen would have made every honest number below it worth less.

**A queue nothing could reach reports unreachable with absent counts, not zeroes**, and a provider seam nobody approved reports `unconfigured` rather than `unavailable`. Most of VELORA's provider seams are deliberately off; a console that showed those as failures would be unreadable on the day one genuinely fails.

**There is no search ranking, impression, or traffic figure.** This platform has no search console and no analytics provider. A number invented to fill that space would be the only thing on the screen nobody could check.

### An operator read may hold a few connections, never all of them

`AdminAccountDirectory` asks nineteen questions, `AdminActivityDirectory` asks up to seventeen, and the first version of both issued every one at once. That is the obvious way to write them and it is wrong here: [ADR-0019](ADR-0019-database-connection-admission.md) sizes the pool at ten and admits eight requests at a time, on the assumption that a request wants roughly one connection at a time — and the admission bound counts **requests, not queries**, so a screen taking twenty connections is invisible to it.

It was not hypothetical. The first browser run of this console produced `database admission saturated` at eight in-flight requests while one screen read twenty-two tables, and an unrelated console assertion failed as a result.

Every operator directory now fans out through `bounded`, which runs at most three of a read's queries at a time. The cost is a few milliseconds on screens a handful of people look at; the alternative was one operator's console taking capacity away from the product. `AdminOperationsHealthDirectory` also went from three queries per outbox to one — the same `group by` answers how many are waiting, how many were never published, and how old the oldest of each is.

### Reads compose; writes go through the owning domain

`AdminActivityDirectory`, `AdminAccountDirectory`, `AdminSearchDirectory`, `AdminLiveDirectory`, `AdminOperationsHealthDirectory`, `AdminReconciliationDirectory` and `AdminPublicEntryDirectory` select across domain tables and write none of them, which is the read-model exception `docs/architecture/03-domain-boundaries.md` already grants ADMIN and `AdminOperationsDirectory` already uses. No route handler reaches a table.

Every operator write goes through the domain that owns the state. Session revocation calls AUTH's own `revokeAllAuthority`, so AUTH's security event commits in the same transaction as the revocation and is recorded as `administrative` rather than as the person logging themselves out.

### The account record is a privacy decision shaped like a screen

`GET /v1/admin/accounts/detail` publishes lifecycle, sessions, devices, live state, safety counts, connection counts, coin position, commerce counts, support counts, acquisition origin, and creator capability. It publishes no display name, biography, photograph, language, availability, matching declaration, message, report narrative, ticket text, push token, or payment instrument — and the contract has no key for any of them, so a screen showing one could not be written against it.

The counts are the point. "Four reports name this account" is an operational fact an operator acts on; what a reporter wrote is evidence that belongs with the case it produced, behind a different capability with its own audit.

## Consequences

The API gains seventeen operations and the frozen runtime inventory moves from 190 to 207. All seventeen are under `/v1/admin/`, so all seventeen are `ADMIN_BLOCKED` in the runtime inventory and unreachable in a deployed environment for the same reason every other operator route is: no phishing-resistant verifier is approved.

Platform Admin gains a seventh destination (Activity), an account record under Accounts, a reconciliation area under Money, and five areas under Platform (Operations, Live, Public entry, Controls, Operators). The console now renders from server truth about what the operator may do, and fails closed while that answer is unknown.

The environment is stated on every screen. An operator with three tabs open is one wrong tab away from pausing production, and no confirmation dialog fixes that — a dialog says what will happen, not where.

**No new paid dependency, no new provider, and no new persistent volume.** Everything here runs on the PostgreSQL and Redis this product already has.

Retention: grants and controls are current state; operator actions are audit and are kept. No retention job was written, because no unbounded table was created — which is a better answer to the question than a sweep would have been.

`DECISION REQUIRED` remains for who holds the first operator grant in a deployed environment, and `LEGAL REVIEW REQUIRED` remains for how long an operator action log is kept.

## Cross-references

- [Domain boundaries](../architecture/03-domain-boundaries.md) — OPERATIONS' row
- [Data ownership](../architecture/05-data-ownership.md) — the three OPERATIONS tables
- [OPERATIONS domain](../domains/operations.md)
- [Operator runbooks](../engineering/09-operator-runbooks.md)
- [Platform Admin](../product/04-platform-admin.md), [Platform Admin surface](../surfaces/04-platform-admin.md)
- [ADR-0036](ADR-0036-platform-admin-operations-console.md) — the console this extends, and the rule that an operator action on a person carries a safety record
- [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md) — the assurance every operator route still requires first
