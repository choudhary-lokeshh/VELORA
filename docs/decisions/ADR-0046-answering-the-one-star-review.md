# ADR-0046: Answering the one-star review

- Decision date: 2026-09-03
- ADR status: Accepted
- Owners: Founder (decision owner), USERS, TRUST & SAFETY, SUPPORT, LIVE, NOTIFICATIONS, AUTH, Consumer Web, Consumer Mobile, Platform Admin

## Context

Every previous phase built VELORA against its own design. This one built it against the reviews of the products it competes with — the recurring one- and two-star complaints people actually write about random-video and social-discovery apps. Read as a specification rather than as noise, those complaints are a short list of concrete failures, and most of them this repository had already refused by construction.

There are no fabricated users, counts, or presence anywhere: `LIVE_DISCOVERY_SIMULATION` and every provider adapter refuse outside local and test, the seed script refuses a non-local target, and no surface publishes a number the platform does not measure. Session recovery, rotation, reuse detection and audience isolation are proved against real PostgreSQL. Availability is a bounded user-declared window rather than a decorative "online" badge, and live presence expires on a sweep. The live transport renders five honest states and distinguishes a muted camera from a dead one. Coins reconcile, prices are server-authoritative, and matching is free. Blocks are re-checked inside the pair lock at allocation. Enforcement carries a disclosable reason and a real appeal. Messaging sends are idempotent with recoverable failures on both surfaces.

Four complaints were not answered, and each was answered here.

**A stranger who behaved badly and left could not be reported.** A random encounter has no relationship behind it — that is the product working correctly — and it meant that the moment the other person pressed Next, they stopped being addressable anywhere. The ended screen named them and carried no safety control; searching again removed even that. The one flow in this product where a person is most likely to meet somebody abusive was the one flow with no way back to them.

**Reporting and blocking were two acts.** A person who wanted both made two requests, and either could be the one that was lost. The dangerous half of that is specific: somebody who believes they are separated and is not.

**There was no way to reach a person.** VELORA had no support path of any kind. That is the flattest complaint in the whole category — "there is no support", "they say email us and nobody replies" — and an address in a policy document is not an answer, because whoever uses it cannot tell whether anything happened.

**Nobody could leave.** The account lifecycle vocabulary, the `deletion_pending` status, the `deletion_requested_at` column and the CHECK that binds them had been in `0002_users` since Phase 1. No route or screen reached any of it, and the settings screen said the path was not finished — which is the polite version of the complaint people make loudest about everything else in this category.

## Decision

### Somebody who left can still be reported

LIVE publishes `GET /v1/live/recent-people`: the people this caller met and has already finished with, newest first, bounded to ten over twenty-four hours, ended encounters only. It carries the same minimized public shape a peer is shown during an encounter and nothing else — no message, no duration, no end reason, nothing about the call. It is an address for a safety action, not a history of the meeting.

Two rules make it safe. It excludes live encounters, because the current one is already published in live state and returning it twice would put the same person on the screen under two meanings. And it is deliberately not gated on the caller's own live eligibility: somebody whose standing has lapsed, or who has been restricted since, must still be able to report the person they met — the same rule TRUST & SAFETY already applies to blocking and reporting, for the same reason.

Two partial indexes keyed on when an encounter *ended*, rather than when it started, keep it an index range rather than a scan of everybody this person has ever met. Retention does not change: nothing expires when an encounter leaves the window, the list simply stops offering it, and every retention duration in LIVE remains `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

Both consumer surfaces carry the safety control on the ended encounter itself and a "People you recently met" list under Safety, so the action survives both halves of the failure: the peer leaving, and the screen forgetting.

### Reporting and blocking, as one act

`POST /v1/safety/reports/with-block` does both, in that order, and the order is the design. Separation is applied first and unconditionally, so the response always carries the block that now stands. The report follows and may be refused by the submission bound, in which case the response carries the block and no report — deliberately not an error. The caller is still separated, and a surface renders what actually happened rather than claiming a report was filed when none was.

They are not one transaction. A block takes the pair lock and ends whatever is running between these two; a report takes the subject lock and joins a moderation case. Holding both would introduce a lock order this domain does not otherwise have, for no gain: each half is already idempotent, so a retry after a crash between them re-applies the block it already made and files the report it did not.

The reporter vocabulary gains `hate_or_abuse` and `threats_or_violence`. Both were previously filed as `harassment`, which describes the wrong thing about the two allegations where describing it correctly matters most: one is a pattern between two people, one is a statement about a group, and one is the single allegation on the list where the right operator response may be immediate and the wrong one irreversible. It remains a reporter-facing selection and remains deliberately not the vocabulary an enforcement decision records.

### SUPPORT is a domain, and it depends on nothing

A ticket is a row in VELORA's own database, answered by VELORA's own operators through Platform Admin. There is no provider, no adapter registry, no configuration value, and no environment in which the domain is unavailable.

That was chosen over any hosted help desk for the same reason the domain is necessary at all: the one path a person uses when everything else about the product has failed them must not itself depend on something that can fail, cost money, or be switched off. A support flow that refuses because a vendor is unreachable is precisely the failure being answered. It also costs nothing to run.

The domain is small and the list of things it does not own is the load-bearing part: no enforcement, no report, no case, no evidence, no decision, no account status. A support ticket that could reach any of those would be an enforcement path with none of the audit, dual control, or appeal rights the real one carries.

It is not the safety surface and must never become one. A report is evidence about another person whose reporter is deliberately told nothing; a ticket is somebody asking about their own account, and the whole point is that they are told. Opposite disclosure rules, so both consumer surfaces point anybody being harassed at reporting instead.

**No response-time promise appears anywhere in the contract.** There is no `respondBy`, no `slaHours`, and no queue position, because VELORA has nobody on a rota and a deadline it cannot keep is worse than no deadline. `received` says plainly that nobody has looked yet, because anything warmer while nobody is looking is the lie that makes every later status untrustworthy.

Submission is idempotent on the sender's own key, which matters more here than almost anywhere: the connection that lost the response is very often the thing being reported. The reference a person quotes is generated rather than derived from a counter — a sequential one would publish how many tickets the platform has ever had — and drops `I`, `L`, `O`, and `U` so it can be read out loud. The ticket is frozen but for its status and the history is append-only, both by trigger: that record is what an operator relies on when somebody says they were already told it was fixed.

### Closure is real, and erasure is not claimed

`POST /v1/users/me/closure` closes an account from inside the product. It is immediate and total: every session and refresh family revoked, every push registration retired, any live encounter ended and the RTC session with it, the matching pool left, any availability window closed, and the account moved to `deletion_pending`. Every product predicate in the repository already reads `pending_profile` or `active` for good standing, so one transition removes discovery, messaging, calling, live, and delivery — rather than a list of cooperating changes somebody could forget to extend.

It is idempotent, and the read is served to a closed account as well as an open one. Somebody who signs in again lands on an account that says what happened to it rather than on a product that refuses everything without explaining.

**Erasure is deliberately not claimed.** Physically destroying what remains depends on retention schedules that are `DECISION REQUIRED / LEGAL REVIEW REQUIRED` across messaging, safety evidence, financial records, identity evidence, and media. Inventing a destruction period would be the one retention error nobody could undo. So `erasureScheduled` is published, currently false, and both surfaces read it and say what is true: the account is closed, nobody can reach this person, records VELORA is legally obliged to keep are retained, and no schedule for erasing the rest has been published. `DECISIONS_REQUIRED` records the consumer path as built and the erasure schedule as still open, which is the honest split.

There is no undo in the product. A reversal window is a retention and consent decision nobody has taken, and offering one would mean holding an account open for a period this code invented. The confirmation carries an explicit acknowledgement value rather than being an empty POST, because a request an empty body could make is a request a mistyped script can make.

Closure is composed after every domain it reaches, so no dependency direction changes and no late setter is introduced. The account transition stays USERS' own; AUTH revokes the authority it issued, NOTIFICATIONS retires the registrations it holds, LIVE ends the encounter it allocated, and REALTIME ends the session it opened. No domain writes another's table.

Two vocabularies gain `account_closed` — AUTH's revocation reasons and NOTIFICATIONS' device disable reasons — because the nearest existing values were both wrong. `administrative` would record an operator acting on somebody who acted on themselves; `logout_all` is a person signing other devices out of an account they still hold; `retired` is somebody else acting on a registration.

## Consequences

Somebody who is abused in a random encounter can report the person after they leave, on either surface, with or without blocking them in the same act. Somebody who cannot sign in can reach a person and hold a reference for it. Somebody who wants to leave can, from the app, without emailing anybody.

An operator gains one queue and three routes, all under the existing Platform Admin audience and step-up. There is no new authority: an operator cannot delete a ticket, edit what somebody wrote, or reach an account, an enforcement, or a balance from it.

Retention remains the open question it was. Nothing added here expires anything, and every new record class inherits the same posture: nothing depends on a row being physically gone, so an approved schedule later applies as a deletion pass.

`docs/decisions/DECISIONS_REQUIRED.md` keeps every retention entry and updates the account-closure entry to record the consumer path as built and the erasure schedule as still owed.

## Cross-references

[SUPPORT](../domains/support.md), [USERS](../domains/users.md), [TRUST & SAFETY](../domains/trust-safety.md), [LIVE](../domains/live.md), [account deletion](../flows/account-deletion.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md), [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md), [ADR-0036](ADR-0036-platform-admin-operations-console.md), [ADR-0040](ADR-0040-random-live-discovery.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
