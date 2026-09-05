# OPERATIONS domain

## Purpose and scope

OPERATIONS owns three things that had no owner: which capabilities an operator holds, what the platform has been told to do, and what an operator did about it. It owns nothing else.

Specifically it does **not** own product activity. There is no event table in this domain and no recorder anywhere in the codebase writing one. Every fact an operator needs is already persisted by the domain that owns it — a sign-in by AUTH, an encounter by LIVE, a capture by WALLET — and a parallel copy could only ever be a second answer waiting to disagree with the first. The activity stream is a composed read over those originals, which is why a retried domain action produces one entry or none, why retention follows each domain's own, and why the stream and the record can never drift apart. [ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md) argues that at length.

The cost of that choice is stated rather than hidden: a fact nobody persists cannot be shown. "Camera disabled" and "message send failed" are not in the stream because neither is persisted today, and the answer is to persist them in the domain that owns them rather than to build a pipe with the same gap in it.

## Flow and data rules

**Capabilities, not roles, are what routes check.** Twenty-two capabilities; seven roles that are convenience sets over them. `AdminContextResolver.resolve` takes the required capability as a parameter with no default, so a new operator route cannot be written without deciding what authorises it. Adding a role can never widen what a route admits.

One live grant per operator, enforced by a partial unique index rather than by a prior read — two grants would be two answers to "what may they do", and the union of them is always the more permissive one. A revoked grant keeps its row: it is the evidence somebody held a capability during the window an incident happened in. A grant names a role and the role's capabilities live in code, so widening a role is a reviewed commit rather than an `UPDATE` somebody ran.

`operators.manage` is its own capability held by one role, because whoever holds it can grant themselves every other one.

**Where the first grant comes from in a deployed environment is `DECISION REQUIRED`.** `ADMIN_OPERATOR_BOOTSTRAP` is `grants` everywhere but local and test, and configuration refuses the other value in staging and production. There, an operator with no grant may do nothing at all.

**Every control is read by server code on the path it governs.** `live.search` is consulted by LIVE before anything is read on a caller's behalf; `growth.invitations` before a link is minted; `growth.scheduled_windows` at publish time. There is no control in the store that only a client consults, and adding one would be a lie with a toggle on it.

Every control defaults to on, because these are pause switches over features that already shipped. A control nobody has set has no row and takes the declared default, so running the migration changed no behaviour.

**Semantics of a pause are fixed and published.** Pausing `live.search` admits nobody new and leaves every encounter already running alone. Pausing `growth.invitations` mints nothing new and leaves every link already shared working. Pausing `growth.scheduled_windows` publishes nothing and cancels nothing.

## Security/failure/concurrency

**Two operators cannot silently overwrite each other.** A control write states the version it read and the update matches on it; the loser is refused with a conflict and answered with the value that actually stands. Version zero is the token a first write presents, so a first write and a subsequent one are one operation — and two simultaneous first writes resolve on the primary key.

**A control is cached for five seconds per process and the bound is published** by the API and printed by the console beside the switch. A read failure keeps the last known value rather than reverting to the default: an operator who paused live search must not have the pause undone by the failure they were reacting to. Where nothing has ever been read the declared default applies.

**Every operator command writes an audit row, whatever its outcome.** `refused` and `failed` are first-class, because an operator who tried something and was told no is what an incident review most needs. The row is written after the command settles and outside its transaction — an audit row that rolled back with the command would leave no trace of the attempt.

Append-only is a property of the code: there is no update, no delete, and no method taking an action identifier anywhere in this domain, and no route that could reach one. A failure to write an audit row is logged and swallowed rather than propagated, which is deliberate and uncomfortable — a committed command cannot be un-done by a later insert failing, and turning it into a `500` would tell an operator the change did not happen when it did.

**Refusals are indistinguishable.** Wrong audience, stale assurance, and missing capability all answer `403 ACTION_NOT_PERMITTED`. An operator learns what they hold from `GET /v1/admin/operator`, which is the one route needing no capability because it reports only the caller's own standing.

**An operator read is bounded, not parallel.** ADR-0019 sizes the pool at ten connections and admits eight requests at a time on the assumption that a request wants roughly one connection at a time, and the admission bound counts requests rather than queries. A screen issuing nineteen selects at once is therefore invisible to it and takes capacity from the product — which is exactly what the first browser run of this console produced. Every operator directory fans out at most three queries at a time through `apps/api/src/database/fan-out.ts`.

Reads compose across domains in ADMIN's directories and write none of them; every operator write goes through the domain that owns the state — session revocation calls AUTH's own service, so AUTH's security event commits with the revocation and is recorded as `administrative` rather than as the person logging themselves out.

## Phase/open questions

V1: capability grants, three operational controls, the operator action log, and the composed activity stream. Ending one person's live encounter from the console was deliberately not built — that is a safety decision and goes through TRUST & SAFETY, where it acquires a record, a reason, and an appeal path.

`DECISION REQUIRED`: who holds the first operator grant in a deployed environment. `LEGAL REVIEW REQUIRED`: how long the operator action log is kept. No retention job exists because no unbounded table was created.

See [ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md), [ADR-0036](../decisions/ADR-0036-platform-admin-operations-console.md), [operator runbooks](../engineering/09-operator-runbooks.md), [domain boundaries](../architecture/03-domain-boundaries.md), [data ownership](../architecture/05-data-ownership.md).
