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

## Cross-references

[Trust & Safety](trust-safety.md), [report/enforcement](../flows/report-to-enforcement.md), [moderation operations](../operations/02-moderation-operations.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [AI safety](../ai/04-ai-safety-security.md), [creator clubs](../product/03-creator-private-clubs.md), [provider adapters](../architecture/06-provider-adapters.md).
