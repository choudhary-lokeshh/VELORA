# TRUST & SAFETY domain

## Creator-scoped enforcement

The enforcement log carries creator decisions as well as consumer ones: a capability suspended or reinstated, an object taken out of public view, and an entitlement withdrawn by the platform. Each names its subject — the creator — and, where it acted on something, the object it acted on, using a closed vocabulary rather than a free polymorphic reference: the type is one of a fixed set and the identifier is validated by the domain that owns it before the record is written, so nothing here points at something nobody checked.

The table stays append-only. A reinstatement is a second record rather than an edit of the suspension, because the question an audit asks is what was done, by whom, when, and under which policy — not only what is in force now. Current state remains with the domain that owns it: a creator's status is CREATORS' truth and a club's lifecycle is PRIVATE CLUBS'.

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

### What a report may name

A report used to be about a consumer account and nothing else. It now names a target from a closed vocabulary — an account, a creator, a published item, a club, or a conversation — and the type is what decides which domain validates the identifier and which queue the case lands in. A free string would be a report pointing at something nobody checked and nobody owns.

**A reporter names what they were looking at; SAFETY stores Velora's own identifier.** Public surfaces expose a handle, a slug, or an item identifier and never an internal one, so the request carries what a visitor could see and the server resolves it through the owning domain's published contract: USERS answers whether an account exists, CREATORS resolves a published handle, PRIVATE CLUBS answers whether an item or club is published, MESSAGING answers whether the reporter is in the conversation. SAFETY reads none of their tables.

The gap between the two is the point. A caller cannot invent a target, cannot report something that was never published, and cannot learn an internal identifier for something they could not already see. Every resolution answers with one value or nothing, and *nothing* covers the unknown, the unpublished, the not-yours, and the reporter themselves identically — so no shape of refusal can be used to enumerate. The reporter's own view carries the target *type* and no identifier at all, because echoing a resolved identifier back would hand them one they never had.

A conversation is reportable only by somebody in it. A report naming an arbitrary conversation would otherwise be a way to assert that two other people are talking, and that disclosure would stand however the report was later handled.

The same predicate now covers a conversation attached to a report as *evidence* rather than named as its target. It used to be stored on the reporter's word alone, which was not harmless: a moderation decision can close a conversation, so an unchecked reference was a way to point an operator at two people the reporter had nothing to do with.

The surface a report was filed from is taken from the credential's audience and never from the request body. A client-declared surface would be a client-authoritative fact about policy, and surface is the axis [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md) makes load-bearing. It is recorded as absent for reports filed before Velora kept one, which is true rather than a guess.

The reason codes are a **reporter-facing selection and not the approved risk taxonomy**, which remains `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. They are deliberately a different set from the vocabulary an enforcement decision records: a report is an allegation, and only a review makes it anything more. A unit assertion keeps the two sets from converging.

### The enforcement authority

`0029_safety_policy_authority` makes what is in force derivable from the enforcement log itself, which it previously was not.

The problem it fixes was a vocabulary that carried direction inconsistently. `account_restriction` was written both by a decision that restricted an account and by the review that restored one, so two rows with the same scope meant opposite things; creators got a second scope, `creator_reinstatement`, to say the same thing a different way. The only reader that could tell a restriction from its reversal was the domain that had applied the change, which meant SAFETY could not answer a question about its own records.

Three columns settle it. **Disposition** says whether a record imposes or lifts, orthogonally to scope, so `creator_reinstatement` is gone and a reversal shares the scope of the thing it reverses. **Expiry** lets a restriction stop on its own; absent is indefinite, which is not the same as permanent, because a lift is still a record. **Supersession** links a reversal to exactly the record it replaces, with a foreign key so the chain cannot have a missing link and a partial unique index so it cannot fork — two reviewers cannot each lift the same restriction into two equally valid histories.

A restriction is in force when four things hold at once: it restricts rather than lifts, it has taken effect, it has not expired, and nothing supersedes it. That predicate is written in one place, because a reader that dropped any one of the four would authorize against history rather than against the present. The table stays append-only throughout: a lift is a new row, the record it names is byte-for-byte what was written, and nothing is ever edited or swept.

The migration backfills deterministically rather than guessing. Only two code paths ever wrote `account_restriction` — a moderation decision, which always named the report it came from, and an account restoration, which never did — so the old rows can be paired exactly. Anything the backfill cannot pair aborts the migration, because a mislabelled safety record is worse than a migration that stops.

**One writer.** `EnforcementAuthority` is the only thing that appends to the table. Before it, MODERATION and ADMIN each appended their own rows with their own idea of what a scope meant, which is how the direction problem arose in the first place and how ADMIN came to stamp its records with the *reporting* policy version. Imposition is idempotent by identity — scope plus the object it names — because an enforcement decision repeated is the same decision, and how many times an operator clicked is not part of the history of what was done to somebody. A lift with nothing in force to lift is refused rather than recorded.

The authority records; it does not apply. The caller still changes the owning domain's state through that domain's published contract, in the same transaction as the record.

### The capability answer

SAFETY publishes a second contract alongside the pair answer. `SafetyEligibilityPort` takes a capability from a closed vocabulary — consumer interaction, creator operation, creator publication, commercial participation — and answers whether a live enforcement denies it, with a **disclosable** coarse reason, the scope that decided it, and the version of the rule that composed it.

The reason is deliberately not the enforcement's finding. A subject is entitled to the category and the scope of what was done to them; the review's conclusion, the report behind it, and anything that could identify a reporter stay inside this domain. The disclosable vocabulary is asserted to be disjoint from both the reporter vocabulary and the enforcement one, so the three cannot converge by accident.

Which scopes deny which capability is a map here rather than knowledge spread across callers, so adding a scope does not require every caller to learn about it. Publication and commercial participation are separate values from creator operation even though a suspension denies all three today, because the moment a scope exists that stops publication without stopping the capability — which is what the mature-content gates need — that must be one row of the map rather than a change at every call site.

Where several live restrictions could apply, the strongest decides, in a fixed precedence: global account restriction, then capability, then anything scoped to a single object. Two replicas answering the same question at the same moment therefore give the subject the same reason, which an ordering that depended on insertion order would not.

### How an enforcement wins a race

Whether a subject is under enforcement is decided by the *absence* of a live restricting record, and an absent row has nothing to lock — the same check-then-act gap the pair lock closes, on a single subject rather than on a pair. A transaction-scoped advisory lock keyed on the subject closes it, and every transaction that decides something about a subject's enforcement state takes it: imposing, lifting, and any protected mutation authorized by their absence.

The ordering rules are two. Take the subject lock before any row lock, so the lock graph has no cycle — which is why a decision is recorded before the owning domain is asked to apply it, rather than after. And never take a pair lock and a subject lock in the same transaction: the two orderings would form a cycle, and no decision needs both, because a pair decision is about interaction and a subject decision is about standing.

A regression holds the lock from outside the application and observes that an imposition does not proceed until it is released, which is what proves the lock is genuinely taken rather than merely intended.

### Enforcement, and the moderation seam

Enforcement decides; the domain that owns the thing being changed applies it. An account's standing is USERS' truth and a conversation's state is MESSAGING's, so SAFETY calls two narrow published contracts — restrict/restore an account, close a conversation — and writes to neither schema. Each contract is the whole of what an enforcement decision may do: it cannot delete, rename, read a profile, or read a message.

An operation and its audit row now genuinely commit together. Platform Admin's creator operations previously ran the state change and the enforcement record as two independent statements, so a failure between them left exactly the state the code claimed was unreachable — and a refusal discovered *after* the record was written left an audit row for an operation that never happened. Both are closed: every operator operation is one transaction, and a refusal rolls it back rather than returning from inside it.

The report transition and the enforcement are one transaction. A report marked actioned with no enforcement behind it, or an enforcement applied against a report a concurrent reviewer already dismissed, are both states an audit could not explain, so neither is reachable: the compare-and-set on the report version decides the winner, and an enforcement that cannot take effect rolls the whole decision back.

**The moderation seam has no HTTP surface, and that is the design.** Platform Admin sign-in has no approved implementation — the local identity contract refuses the Platform Admin audience outright, and the configured privileged authenticator verifier refuses every assertion — so publishing a moderation route would mean publishing an endpoint that either nobody can reach or that somebody eventually reaches with a consumer credential. What exists is the contract MODERATION and ADMIN will call once privileged authentication does, wired to real enforcement, with no path from a consumer request to any of it. Regressions assert that no route matching admin, moderation, or enforcement is published; that no consumer action produces an enforcement row; and that a non-consumer browser session is refused on every consumer safety route.

### Evidence and decisions

`0031_safety_evidence_decisions` adds the two records that make a consequential decision explainable, and a trigger that stops any of it being rewritten.

Evidence is a **reference or a minimal snapshot**, never a copy of another domain's record. The shape is enforced by the columns rather than by convention: a reference kind carries an identifier and no text, a snapshot kind carries a state label that cannot hold a space, and exactly one kind — an operator note — carries prose and requires an author. A reference must name something the case is already about, checked inside this domain rather than by asking MESSAGING or CREATORS, because a contract that answered "does this message exist" would be a way to probe for other people's messages. Every report becomes evidence at intake, so a case's evidence is what was known, in the order it was known.

A decision names its case, actor, subject, action from a closed vocabulary, reason, policy version, instant, cited evidence, the enforcement it produced, and the standing before and after. That standing is **this domain's** — whether a live restriction stood — rather than another domain's column, because an account's status is USERS' truth and SAFETY may not read it.

Nothing is edited. A decision, its evidence, the citations between them, and the enforcement log are all append-only in the database: `velora_safety_reject_mutation` refuses every update and delete, which makes append-only a property PostgreSQL keeps rather than one the writing code remembers. `safety_enforcements` had been described as append-only since `0011_safety` and was until now only append-only by convention.

A correction is a second decision naming the first. Two partial unique indexes make "exactly one settlement per case, and one correction per correction" a fact the database keeps: at most one resolving decision may start a chain, and at most one record may supersede a given one. Escalation is outside that rule, because handing a case on is not settling it.

The decision, the case transition, the enforcement, the owning domain's state change, and the resolution of the case's open reports are one transaction, and every refusal rolls back rather than returns — an account restricted with no decision behind it would be exactly the unexplainable state the transaction exists to prevent. What the platform cannot carry out it does not record: creator scopes belong to Platform Admin's operations and are refused here.

A case that has been decided is distinguishable from one that was closed without a decision. Both are out of the queue and they are not the same fact: one was judged and one was dropped.

### What blocks production

Blocks and reports themselves are blocked on nothing: a person must be able to stop being contacted, and must be able to report, from the first day the product exists. What is blocked is the review and enforcement process around them — the risk taxonomy, emergency action policy, appeals and SLA, and evidence retention are all undecided, and Admin sign-in has no approved implementation. Each is recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## Where this domain is going

[ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) records the architecture this milestone builds against. The policy authority, the scoped append-only enforcement model with supersession, the published capability answer, and reports, cases, evidence, and decisions as separate append-oriented records are built and described above. Still to come: appeals, surface as a first-class closed vocabulary, depicted-person consent held as scoped references to an approved verifier rather than as documents, deadlines read from a versioned published policy, and mature-content enablement as configuration that refuses in every deployed environment. None of it enables mature content, and the ADR is explicit that its presence must not be capable of doing so.

## Phase/open questions

V1 blocks, reports, basic enforcement predicates. Phase 2 AI assistance remains advisory. Separately reviewed deterministic automation may perform only explicitly specified non-high-impact policy steps with audit, monitoring, human override, and no model judgment. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: policy taxonomy, permitted deterministic automation, appeal/SLA, evidence retention, regional requirements, enforcement propagation timing. See [report to enforcement](../flows/report-to-enforcement.md), [MODERATION](moderation.md), [moderation operations](../operations/02-moderation-operations.md), [AI action flow](../flows/ai-assisted-action.md), [RBAC](../security/02-access-control-rbac.md).
