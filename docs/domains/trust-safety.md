# TRUST & SAFETY domain

## Purpose and scope

TRUST & SAFETY owns reports, user-to-user blocks, enforcement policy execution, safety eligibility decisions, and enforcement lifecycle. It does not own moderator queues/evidence tooling, consumer profile source truth, messages/content source data, or direct payment records.

## Main flow and transitions

User blocks another user: validate self/target, persist directional block, publish immediate eligibility change. Report creates protected case reference. Policy action transitions subject `active -> limited/suspended/banned` or restores status after review/appeal. Enforcement scopes can restrict discovery, messaging, realtime, clubs, creator tools, and notification without leaking reason to affected peers.

## Alternates/failure/concurrency

Block request is idempotent per blocker-target. Both-direction blocks remain independent records. Block/report vs send/intro races resolve at owning action's recheck; later send/intro must fail safely. Reports permit duplicates but link/merge under moderation policy. Expiry/appeal transitions must have effective time, policy version, actor/reason, and audit.

## Security/data/permissions

Reporter identity, evidence, and internal rationale are tightly access controlled; consumer never sees retaliatory detail. User can manage own blocks/reports within policy. Moderator acts through MODERATION workflow; Admin invokes approved operation. Publish minimal eligibility facts, not sensitive report content. Abuse-rate limit reports and preserve evidence integrity/chain of custody.

AI signals or recommendations are non-authoritative inputs only. TRUST & SAFETY never accepts model confidence, generated rationale, or AI approval as enforcement authorization; enforcement follows deterministic policy, authorized human workflow where required, version/concurrency controls, and audit.

## Implemented V1 safety

`0011_safety` adds the three SAFETY-owned tables. None carries a foreign key to a consumer account, a conversation, or a message: cross-domain references are stable identifiers rather than shared schema.

### The eligibility answer, and who may ask

SAFETY publishes one contract and it answers a boolean. DISCOVERY, MESSAGING, and later NOTIFICATIONS ask "may these two people interact"; none of them learns who blocked whom, when, or why, because a peer who could infer another person's safety decision has been told it.

Every method takes the **caller's executor**, so a safety answer is taken inside the transaction that is about to write. A check that commits separately from the write it authorizes is not a check.

The batch form exists for the same reason discovery's suppression lookup does: "everybody this account has ever blocked or been blocked by" grows for the life of the account, and making that an input to a feed query would turn a person's number of safety relationships into a correctness question.

### How safety wins a race

The hard part is not the check; it is that the thing being checked for is the *absence* of a row, and an absent row has nothing to lock. Two transactions can each read "no block exists" and both commit. That is a check-then-act gap, and a safety decision must not have one.

A transaction-scoped advisory lock keyed on the ordered pair closes it. Every transaction that decides something about a pair takes it first:

- **Blocking and unblocking** take the pair lock, then write the block.
- **Sending a message** takes the pair lock, then the conversation row lock, then re-reads membership, conversation state, safety, and the connection, then writes.
- **Signalling an introduction** takes the pair lock, then reads safety, then inserts or completes the introduction.

Because the lock is always taken **before** any row lock, the lock graph has no cycle and no two transactions can wait on each other. A regression asserts this directly: `pg_stat_database.deadlocks` does not move across a batch of concurrent block-against-send and block-against-signal races.

Because the lock is exclusive, a block and a message are never interleaved: one commits entirely before the other begins its check. A regression proves the lock is genuinely taken, by holding it from outside the application and observing that a send does not proceed until it is released. The outcome of any race is therefore a serial order — the message precedes the block or the block precedes the message — and never a message accepted by a transaction that had already been overtaken.

Discovery reads are not transactional and do not need to be. A block removes a candidate from every subsequent page at once, which is the documented consistency model: safety always outranks snapshot stability, and a feed is never allowed to be consistent with a state that is no longer permitted.

### Blocks

Directional record, symmetric effect. Who blocked whom is a fact worth keeping, and both people may hold independent records; but a live block in either direction ends interaction for the pair, in discovery, in introductions, and in messaging.

Blocking is available to **every** authenticated consumer, including one whose own account is restricted or whose adult assurance has lapsed. Gating it on admission standing would deny protection to exactly the accounts most likely to need it.

A block is never disclosed. Nobody is told they were blocked; their experience is that a candidate is not there and a message cannot be sent, which is what they would see if the other person had simply stopped being available.

Withdrawing sets a revocation instant rather than deleting the row, and a partial unique index over the live pair lets the same person be blocked again afterwards without the earlier record being rewritten.

### Reports

A report is evidence, not a message to the person reported and not a record a consumer may browse.

The reporter learns that their report exists and what state it is in. Their identity, the narrative they wrote, and every internal rationale are **absent from the published contract entirely** — there is no field for them, so no response the API can produce carries one. The person reported sees nothing at all: no notification, no state change, and no change to whether the two remain ordinary candidates to each other. A report is not a block; conflating them would make reporting a covert blocking mechanism and would disclose that a report had been made.

Submission is retry-safe on the reporter's own client identifier, so a lost response does not become a second report, while a genuinely second report under a new identifier is a second report. Volume is bounded per account per window. Reaching the bound refuses further submissions and never removes or alters a report already made, because a discarded report is destroyed evidence.

The reason codes are a **reporter-facing selection and not the approved risk taxonomy**, which remains `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. They are deliberately a different set from the vocabulary an enforcement decision records: a report is an allegation, and only a review makes it anything more. A unit assertion keeps the two sets from converging.

### Enforcement, and the moderation seam

Enforcement decides; the domain that owns the thing being changed applies it. An account's standing is USERS' truth and a conversation's state is MESSAGING's, so SAFETY calls two narrow published contracts — restrict/restore an account, close a conversation — and writes to neither schema. Each contract is the whole of what an enforcement decision may do: it cannot delete, rename, read a profile, or read a message.

`safety_enforcements` is append-only. An enforcement that is lifted is a second record rather than an edit of the first, because what an audit asks is what was done, by whom, when, and under which policy — not only what is currently in force.

The report transition and the enforcement are one transaction. A report marked actioned with no enforcement behind it, or an enforcement applied against a report a concurrent reviewer already dismissed, are both states an audit could not explain, so neither is reachable: the compare-and-set on the report version decides the winner, and an enforcement that cannot take effect rolls the whole decision back.

**The moderation seam has no HTTP surface, and that is the design.** Platform Admin sign-in has no approved implementation — the local identity contract refuses the Platform Admin audience outright, and the configured privileged authenticator verifier refuses every assertion — so publishing a moderation route would mean publishing an endpoint that either nobody can reach or that somebody eventually reaches with a consumer credential. What exists is the contract MODERATION and ADMIN will call once privileged authentication does, wired to real enforcement, with no path from a consumer request to any of it. Regressions assert that no route matching admin, moderation, or enforcement is published; that no consumer action produces an enforcement row; and that a non-consumer browser session is refused on every consumer safety route.

### What blocks production

Blocks and reports themselves are blocked on nothing: a person must be able to stop being contacted, and must be able to report, from the first day the product exists. What is blocked is the review and enforcement process around them — the risk taxonomy, emergency action policy, appeals and SLA, and evidence retention are all undecided, and Admin sign-in has no approved implementation. Each is recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## Phase/open questions

V1 blocks, reports, basic enforcement predicates. Phase 2 AI assistance remains advisory. Separately reviewed deterministic automation may perform only explicitly specified non-high-impact policy steps with audit, monitoring, human override, and no model judgment. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: policy taxonomy, permitted deterministic automation, appeal/SLA, evidence retention, regional requirements, enforcement propagation timing. See [report to enforcement](../flows/report-to-enforcement.md), [MODERATION](moderation.md), [moderation operations](../operations/02-moderation-operations.md), [AI action flow](../flows/ai-assisted-action.md), [RBAC](../security/02-access-control-rbac.md).
