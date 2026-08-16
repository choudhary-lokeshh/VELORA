# MODERATION domain

## Purpose and scope

MODERATION owns review queues, case workflow, evidence references, moderation signals, reviewer decisions, and appeals workflow. It does not own final enforcement policy state (Trust & Safety), source content/message records, or provider-specific moderation truth.

## Flow and state

Report, upload scan, or policy signal creates/links case `new -> triaged -> investigating -> decision_pending -> decided -> appealed -> closed`. Authorized reviewer sees minimum necessary evidence, records policy basis/confidence, and requests enforcement/content action from owning domain. Automated signals are input, not sole assumed truth where human review policy requires it.

Phase 2 AI assistance may triage, classify, summarize, retrieve policy, and recommend inside this workflow. AI output is labeled inference with provenance/confidence and never becomes evidence or decision by repetition. Authorized reviewer owns decision; TRUST & SAFETY owns enforcement. AI cannot close an appeal, ban/suspend, or change content status directly.

## Failure/security/concurrency

Case assignment uses lease/version to prevent conflicting review. Evidence snapshot/reference is immutable and permissioned; deletion/retention coordination preserves necessary lawful evidence without broad access. Duplicate signals dedupe/link; unavailable evidence is recorded, not fabricated. Reviewer cannot directly edit customer money, identities, or secrets.

## Permissions/data/events/phase

Moderators receive role/queue scope and audits for reads and writes. Only redacted/derived analytics leaves domain. Events: case status, review decision, appeal outcome, with sensitive payload excluded. V1 manual report workflow; Phase 2 provider signals; Conditional content moderation must precede any mature creator enablement.

## Implemented case management

A case is the unit of review and deliberately not the unit of intake. A report is evidence somebody filed; a case is the platform's decision to look at something. Keeping them apart is what lets several reports about one target be reviewed once without any of them being discarded.

`safety_cases` names what a case is about and never who reported it. There is no reporter column and no report count, so no query over the table can group people by who they complained about, and no reviewer can see a number that [report to enforcement](../flows/report-to-enforcement.md) says must decide nothing — a number that decides something the moment somebody sees it.

At most one case is open per target, enforced by a partial unique index rather than by a read: reports arriving together converge on one case and the database decides which. Joining an existing case is grouping, not escalation — nothing about the case changes because a second report arrived, not its priority, not its state, not its queue.

**Priority is a reviewer's judgement and nothing computes it.** Every case starts `untriaged`, which is a real answer rather than a missing one: nobody has looked yet. The severity taxonomy stays `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, so the values in code are provisional and versioned like every other safety vocabulary.

A queue is derived from what the case is about rather than from the category a reporter chose, so routing cannot be steered by a reporter's selection.

Assignment is a lease rather than an assignment. A reviewer claims a case against the version they read, the claim refuses a case somebody else currently holds, and a lapsed lease is claimable again — so a reviewer whose session ends mid-review releases the case instead of holding it out of the queue for ever. Re-claiming a case one already holds renews the lease.

The queue is keyset paged on when a case was opened and its identifier, so a reviewer re-prioritising a case cannot move a page boundary under somebody else's paging, and no page is an offset scan.

**None of this has an HTTP surface.** Platform Admin sign-in still has no approved implementation, so the case seam is exactly what ADMIN will call once privileged authentication exists, exercised directly by tests and reachable from no consumer request. A regression asserts no published route mentions a case at all.

## Implemented evidence and decisions

A case could be worked but not explained. `safety_evidence` and `safety_decisions` close that: what a reviewer looked at, what they decided, and what changed as a result are now records, and neither can be rewritten afterwards.

### Evidence is a reference or a minimal snapshot

Never a copy. The narrative stays on the report, message bodies stay in MESSAGING, a creator's page stays with CREATORS. Copying any of them into `safety_` would build a second, less protected store of exactly the material this domain exists to protect, and it would be wrong the moment the original changed.

The column layout enforces that rather than a convention. A reference kind carries an identifier and no text at all. A snapshot kind carries a state *label* — lowercase, no spaces, sixty-four characters, checked by pattern — so a field meant for `published` cannot quietly become where a private message ends up. Exactly one kind, an operator note, carries prose; it is bounded, and it is the one kind that requires an author, because a note nobody wrote is a claim nobody made.

**A reference must be something the case is already about.** A report must be a report in this case; a message must be one a report in this case named; an item, a club, or a creator page must be the case's own target. SAFETY checks all of that against its own records rather than asking another domain, because a contract that answered "does this message exist" would be a way to probe for other people's messages — and because what makes a message citable is that somebody reported it, which is a fact this domain already holds.

Every report becomes evidence at intake, in the same transaction that records it. A case's evidence is therefore a complete record of what was known, in the order it was known, rather than only what a reviewer thought to cite.

Depicted-person consent and external verification are declared and **refused**. Both are references to an approved verifier's outcome and Velora has no approved verifier, so recording one would be an assertion dressed as evidence. The vocabulary exists so the model is whole; the capability fails closed, which is correct rather than a gap.

### A decision is explicit, closed, and append-only

The actions are `no_action`, `temporary_hold`, `unpublish`, `restrict_capability`, `revoke_restriction`, and `escalate`. Which scopes each may name is a map in the policy module, so a scope added to the enforcement vocabulary has to be given an action deliberately rather than inheriting one.

`temporary_hold` is its own action rather than a restriction with an expiry attached, because [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) requires a hold to be distinguishable in the schema from a final violation finding: an accusation recorded as guilt is a defamation the platform authored.

The reason vocabulary is a superset of the enforcement findings, because a review that found nothing still has a reason and none of the findings is it. An enforcing action may carry only a finding — a restriction imposed for `no_violation_found` would be a record that contradicts itself — and a CHECK constraint enforces that rather than the caller.

Every decision records its case, its actor reference, its subject and target type, its action, its reason, the policy version, the instant, the evidence it cited, the enforcement it produced, and what SAFETY saw before and after. Prior and resulting state describe **the standing this domain owns** — whether a live restriction stood — rather than another domain's column, because an account's status is USERS' truth and SAFETY may not read it.

Nothing is edited. A trigger refuses every update and delete on evidence, decisions, citations, and the enforcement log, so append-only is a property of the database rather than of the code that writes. A correction is a second decision naming the first.

### One settlement, however many reviewers

Two partial unique indexes carry the rule. At most one *resolving* decision may start a case's chain, and at most one record may supersede a given one — so a case is settled once and a correction cannot fork into two equally valid histories. Escalation sits outside that rule on purpose: handing a case on is not settling it, and a case may be handed on more than once.

A decision is taken against the case version the reviewer read. A stale read is refused rather than applied to a case that has moved underneath it, which is the difference between two reviewers disagreeing and two reviewers both believing they settled the same case.

The decision, the case transition, the enforcement record, the state change in the owning domain, and the resolution of the case's open reports are one transaction. Every refusal a decision can reach is discovered after something has been written, so refusals roll back rather than return — an account restricted with no decision recorded is exactly the state the transaction exists to prevent. Regressions cover two reviewers, sixteen reviewers, a stale read, a closure racing a decision, a report arriving while a decision commits, and a batch of contended decisions taking no deadlock.

Creator-scoped decisions are refused as not applicable. This seam holds no contract that changes a creator's state — those are Platform Admin's operations — and a record claiming an effect that never happened is worse than a refusal.

### Who may read any of it

Operator-only, and the only thing that makes that true today is that no Admin authority can be minted at all: the configured privileged authenticator verifier refuses every assertion. There is no published route matching evidence, a decision, or a note, and a regression asserts it. Nothing in this domain logs a report narrative, an operator note, a message body, or identity evidence.

## Cross-references

[Trust & Safety](trust-safety.md), [report/enforcement](../flows/report-to-enforcement.md), [moderation operations](../operations/02-moderation-operations.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [AI safety](../ai/04-ai-safety-security.md), [creator clubs](../product/03-creator-private-clubs.md), [provider adapters](../architecture/06-provider-adapters.md).
