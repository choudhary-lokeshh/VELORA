# Operator runbooks

What to do when something is wrong, written against controls and screens that exist today. Nothing here names an external vendor, a pager service, or a person: VELORA has no operations contract with anybody, and a runbook that told an operator to "page the on-call SRE" would be fiction with a heading on it.

Every runbook follows the same order, because it is the order the console is built in: **see it, understand it, decide, act, record.** The recording is not a step somebody remembers — every operator command writes an audit row with the reason the operator typed, including the commands that were refused.

## Before anything else

**Check which environment you are in.** The console prints it on every screen. Production carries a colour; local and test are deliberately quiet, because a banner that shouts on the environment you work in all day is a banner you stop seeing on the one that matters.

**Check what you may do.** Platform · Operators shows what each role holds. A command you cannot see is one the server would refuse anyway; a command you can see is still authorized on the server at the moment you press it.

## Live abuse spike

**See it.** Platform · Live shows participations by state, encounters running, and how encounters ended in the window. Safety's queues show what people are reporting. Activity, filtered to `safety`, shows reports and blocks as they land.

**Decide.** Pausing live matchmaking stops the product for everybody who was about to use it. It is the right call when the abuse is arriving faster than the safety queue can absorb it, and the wrong call when a handful of accounts are responsible — those are enforcement decisions, one at a time, with a record each.

**Act.** Platform · Controls → `live.search` → Pause, with a reason. The change reaches every API process within the propagation bound the screen prints. **Nobody already talking is cut off**; nobody new is admitted.

**Recover.** Resume the same control. There is no other state to restore: nothing was cancelled and nothing was deleted.

## Invitation abuse

**See it.** Platform · Growth shows invitations created, invitations opened, and signups by channel. A large gap between openings and attributed signups, or a channel nobody recognises, is what this looks like.

**Act.** Platform · Controls → `growth.invitations` → Pause. New links stop being minted. **Every link already shared keeps working**, deliberately: breaking those punishes the people who shared them rather than the abuse.

**Then.** Individual accounts abusing invitations are a safety decision, taken on the account record with a reason, not a control.

## An account is compromised

**See it.** The account record (Accounts → open one) shows sessions and their audiences, devices, and a timeline. Platform · Security shows AUTH's own failure events; a burst of `authentication_failed` or `refresh_reuse_detected` against one account is the signal.

**Act.** Account record → Revoke all sessions, with a reason. Every browser session and every signed-in device ends immediately. The person can sign in again; nothing about their account changes.

**Recover.** Nothing to undo. The revocation is recorded as `administrative` on each session and as one `sessions_revoked_all` security event, so a later support conversation about it can be answered accurately.

## RTC provider outage

**See it.** Platform · Operations lists every dependency. `rtc provider` reporting `unavailable` means the platform asked and got nothing; `unconfigured` means no provider is approved in this environment, which is the normal state and not an incident. Platform · Calling shows the provider's own obligations and failures.

**Act.** If calls are failing but searches are still being admitted, people are being matched into encounters that cannot carry media. Pause `live.search` while the provider is down, and resume it when Platform · Operations shows the dependency answering again.

**Do not** attempt to end encounters. There is no operator action for that, on purpose: ending somebody's call is a safety decision and goes through TRUST & SAFETY.

## Payments or coin purchases are failing

**See it.** Platform · Operations groups recorded failures by domain and class; `billing` failures carry BILLING's own failure reason. Money · Reconciliation checks the invariants: a ledger transaction that does not balance, a stored balance that disagrees with its entries, a payment stuck in a non-terminal state, an expired coin hold still reserved, a provider event nothing processed.

**Decide.** `ledger_unbalanced` is the only finding that is always a defect. Everything else can be a slow provider; the definitions printed beside each count say exactly what the platform means.

**Act.** There is no operator command that edits a financial row, by design. A refund goes through BILLING's own service from Money · Payments. A stuck provider event is a worker problem — see below.

## Worker backlog or undelivered events

**See it.** Platform · Operations shows each domain's outbox: how many facts are pending, how many were dead-lettered, and how long the oldest pending one has been waiting. A queue nothing could reach reports **unreachable with no counts**, which is different from a queue reporting zero.

**Decide.** Pending and moving is a busy platform. Pending and not moving, with an old oldest-pending instant, is a stopped relay. Dead-lettered is a fact that was never published and will not be without somebody.

**Act.** Restart the worker process. There is deliberately no operator command that retries a job from the console: the jobs this platform runs are not all idempotent, and a retry button over a queue nobody has classified is a way to send somebody the same notification eleven times.

## Push notifications are failing

**See it.** Platform · Notifications shows delivery attempts, failure classes, and device state. Platform · Operations groups the same failures beside every other domain's.

**Decide.** `unconfigured` for the notification channel is the normal state in every deployed environment — no provider is approved. A failure class arriving in volume with a channel that *is* configured is the incident.

**Act.** There is no operator retry. A stale or invalid device is disabled by NOTIFICATIONS' own processing of provider events, not by a console command.

## Safety or support backlog

**See it.** Overview counts unclaimed cases, open cases, appeals awaiting an answer, and open tickets — every figure computed over the whole table rather than over a page. The oldest open case's age is beside it.

**Act.** Work the queues. There is no control that helps here and none was built: a backlog is people, not a switch.

## An operator's access is wrong

**See it.** Platform · Operators lists every grant, including revoked ones, and publishes what each role can do.

**Act.** Grant or revoke on the same screen, with a reason. A grant replaces whatever the operator held in one transaction, so there is no instant in which they hold two roles or none.

**If nobody can grant anything**, the platform has no operator holding `operators.manage`. In local and test an ungranted operator is treated as a super administrator; in staging and production that is refused at startup, and the first grant is an open decision recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## Nothing appears to be indexed

**See it.** Platform · Public entry reports the environment, whether a canonical public origin is configured, and how many creator pages, clubs, and scheduled windows are actually reachable.

**Decide.** Indexing needs both conditions: production, and a configured origin. The screen says which one is missing, which is the difference between "we are not indexed" and "we are indexed and nobody is coming".

**Act.** Configuring the origin is a deploy, not a console command — the canonical address of the product is not something an operator should be able to change from a browser.

## Cross-references

- [OPERATIONS domain](../domains/operations.md)
- [ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md)
- [Platform Admin surface](../surfaces/04-platform-admin.md)
- [Public entry and SEO](08-public-entry-and-seo.md)
