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

**The moderation seam is reachable only through Platform Admin.** Its operations are published under `/v1/admin/safety/` as explicit commands, and every one requires the Platform Admin audience *and* a fresh phishing-resistant assurance. Neither exists: the local identity contract refuses the Platform Admin audience outright and the configured privileged authenticator verifier refuses every assertion, so the surface fails closed rather than degrading to something weaker. Publishing it now is what lets the operator product be built against the contract it will actually call, and what makes "no consumer path reaches enforcement" a property regressions can hold: a consumer session, a Creator Studio session, and no session at all are each refused on every route; no consumer action produces an enforcement row; and every published path mentioning a case, evidence, a decision, or a note sits under the operator prefix.

### Evidence and decisions

`0031_safety_evidence_decisions` adds the two records that make a consequential decision explainable, and a trigger that stops any of it being rewritten.

Evidence is a **reference or a minimal snapshot**, never a copy of another domain's record. The shape is enforced by the columns rather than by convention: a reference kind carries an identifier and no text, a snapshot kind carries a state label that cannot hold a space, and exactly one kind — an operator note — carries prose and requires an author. A reference must name something the case is already about, checked inside this domain rather than by asking MESSAGING or CREATORS, because a contract that answered "does this message exist" would be a way to probe for other people's messages. Every report becomes evidence at intake, so a case's evidence is what was known, in the order it was known.

A decision names its case, actor, subject, action from a closed vocabulary, reason, policy version, instant, cited evidence, the enforcement it produced, and the standing before and after. That standing is **this domain's** — whether a live restriction stood — rather than another domain's column, because an account's status is USERS' truth and SAFETY may not read it.

Nothing is edited. A decision, its evidence, the citations between them, and the enforcement log are all append-only in the database: `velora_safety_reject_mutation` refuses every update and delete, which makes append-only a property PostgreSQL keeps rather than one the writing code remembers. `safety_enforcements` had been described as append-only since `0011_safety` and was until now only append-only by convention.

A correction is a second decision naming the first. Two partial unique indexes make "exactly one settlement per case, and one correction per correction" a fact the database keeps: at most one resolving decision may start a chain, and at most one record may supersede a given one. Escalation is outside that rule, because handing a case on is not settling it.

The decision, the case transition, the enforcement, the owning domain's state change, and the resolution of the case's open reports are one transaction, and every refusal rolls back rather than returns — an account restricted with no decision behind it would be exactly the unexplainable state the transaction exists to prevent. What the platform cannot carry out it does not record: creator scopes belong to Platform Admin's operations and are refused here.

A case that has been decided is distinguishable from one that was closed without a decision. Both are out of the queue and they are not the same fact: one was judged and one was dropped.

### Depicted-person evidence and consent

`0032_safety_depicted_person_consent` adds the records that answer two different questions about a piece of creator content, and they are not the same question. *Who is depicted, and did anybody check?* is identity and age evidence. *What did that person agree to?* is consent.

**Velora holds no identification document, no image, and no biometric template, and there is no column one could be put in.** What it holds is a reference to an approved verifier's outcome. [Surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md) records the reasoning from primary sources: 18 U.S.C. § 2257 requires identity and date of birth to be ascertained by *examining an identification document*, and a table of those documents would be the highest-value breach target the platform could build in exchange for evidence Velora is probably not the right party to hold. Whether Velora is that party at all is a legal question recorded as unresolved rather than answered in code.

**A creator's word is stored as a creator's word.** An `asserted` participant carries no evidence reference and a constraint refuses one; a `verified` participant carries all four references and a moment, and a constraint refuses any partial combination, so there is no half-verified record for a reader to interpret. Verification supersedes the assertion rather than editing it, so what the creator originally said stays exactly as they said it.

Two people on one item are distinguished only once a verifier has issued a subject handle for each, because that is the only identifier Velora legitimately holds for a depicted person. Before that they are two declarations, and the platform invents no name, handle, or hash to tell them apart.

**Consent is scoped and each scope is withdrawn on its own.** Publishing a depiction is not permission to monetise it, and somebody who withdraws one has not withdrawn the other. A withdrawal is a second record naming the grant it replaces — both facts survive, which is what a depicted person relying on having withdrawn permission needs — and a partial unique index stops two withdrawals forking one person's decision into two histories.

**Absence is not permission.** A content item with no declaration means nobody has been asked or nobody has replied, which is a different fact from "nobody is depicted here"; the gate reports `undeclared` rather than treating silence as compliance. An item declared to depict nobody is the one satisfied answer that needs no verifier at all.

**Two independent gates, and neither is enough alone.** `SAFETY_DEPICTED_PERSON_VERIFIER` selects who produces evidence and `SAFETY_CONSENT_POLICY` publishes the wording a person would be agreeing to. Both default to the value that refuses and configuration rejects anything else in staging and production, so no depicted person can be recorded as verified and no grant can be recorded at all. They are separate because they fail for different reasons and are lifted by different people: one is a vendor assessment, the other is legal copy. A verifier with no approved wording records identity and age and grants nothing, which is exactly the behaviour a half-satisfied gate should have.

The declaration is the one mutable record here and the evidence is not. A creator who adds a person to a shoot has changed the answer rather than falsified the old one; who is depicted and what they agreed to is append-only under the same trigger the evidence and decision records use.

### The content gate, and the surfaces it decides for

`0033_safety_content_classification` and the content gate answer one question in one place: may this item be published, stay public, be delivered to this surface, or be monetised.

**Surface is a first-class vocabulary and a separate predicate.** `web`, `mobile_ios`, `mobile_android`, `creator_studio`, and `platform_admin` are closed values, and a content decision that names no surface is incomplete. It is deliberately *not* the vocabulary a report's source surface uses: that one is derived from a credential's audience and the AUTH audience cannot tell iOS from Android, which is exactly the distinction that decides mature eligibility. A content decision may therefore never be derived from where a report was filed, and a unit assertion keeps the two from converging.

`mobile_ios` and `mobile_android` may never carry mature content, and that is a property of the surface rather than a configuration value. Both stores prohibit the class outright with no published approval path — a materially different finding from the payment providers, several of which publish a written-approval route — so no environment variable, country row, creator setting, or client field can change it.

**Three content classes rather than one `mature` boolean.** `general`, `mature_simulated`, and `mature_actual`. The split is not cosmetic: 18 U.S.C. § 2257 attaches to depictions of *actual* sexually explicit conduct and not to simulated conduct, so a taxonomy that could not tell them apart would either over-collect evidence for one or under-collect it for the other. The classes are provisional and versioned; the approved taxonomy remains `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

A missing classification is not `general`. It is an item nobody has classified, and a mature capability on one is refused rather than inferred from silence. A caller cannot decide at the call site what an item is either: an item declared `mature_actual` cannot be published as `general` by asking a different question.

**The gate evaluates every applicable predicate and reports all of them.** It does not stop at the first refusal. A caller told only the first would reasonably conclude that fixing it is enough, and for a mature class that is never true — so the answer carries the full set of closed gates, strongest first, alongside the headline reason. Enforcement is the pair that applies to *any* class, because a suspension is not about maturity: a restricted creator publishes nothing and a removed item stays removed. Consent, viewer assurance, and surface eligibility apply to the mature classes.

Each capability asks the consent scope it actually needs, so publication consent does not authorise delivery and neither authorises monetisation. Delivery of a mature class requires `verified_adult` and accepts nothing weaker — Ofcom names self-declaration, and payment without an age check, as not highly effective, and both are refused by name in test.

**Mature content cannot be turned on.** `SAFETY_MATURE_CONTENT` has exactly one value the schema admits, in every environment including local and test. That is not a feature flag: there is no state to flip, which is what [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) requires and what Apple Guideline 2.3.1(a) makes necessary, since a dormant remotely-enabled feature is a violation in its own right. The surrounding gates are each exercisable on their own, and a regression asserts that an item satisfying every one of them — classified, consented, on an eligible surface, by an unrestricted creator, to a verified adult — is still refused, with the capability being the only gate left closed.

### Takedown claims, and deadlines that come from a policy

`0034_safety_takedown_claims` records a claim that one specific item should come down. A claim is **not a report**: a report is filed by a Velora account about a target, and a claim can come from somebody with no account at all — a depicted person asking for a depiction of themselves to be removed is exactly the route the card-network requirements in [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md) describe.

**A claim decides nothing by existing.** It opens or joins a case about the item and is reviewed there like any other allegation; the removal itself is a moderation decision with its own record and its own enforcement. Several claims about one item converge on one review, under the same subject lock a report takes, and every claim survives as its own record.

Urgency is derived from what is alleged rather than chosen by the claimant, so nobody can mark their own complaint urgent, and it affects **only the deadline** — never the decision, and never a reviewer's priority, which stays their judgement. Volume is bounded per account per window for the same reason report volume is.

**No deadline is invented.** Every instant a claim carries — acknowledgement due, triage due, action due — comes from a published policy and is stored beside the version that produced it, and a database constraint refuses a deadline with no version behind it. `SAFETY_TAKEDOWN_POLICY` publishes none by default and is rejected outright in staging and production, so a deployed platform records claims with all three columns null and computes nothing. That is the accurate state of a platform whose obligations nobody has approved, and it is better than a hard-coded number that would look like compliance, carry no authority, and be the figure an operator later defended in writing. The seven-business-day card-network figure is recorded as evidence about what a policy will need to say and is deliberately not compiled in.

`decided` and `completed` are separate instants, because a decision to remove something and the removal taking effect are different facts and an obligation measured against the wrong one is measured against a promise.

**A deadline is a row, not a timer.** Overdue claims are handed to a worker under a lease, in one statement, so two workers asking at the same moment cannot both take the same claim; a lapsed lease is takeable again, so a worker that dies holds nothing; and moving a claim releases the lease with it, because the work the lease was held for is the work that just happened. A claim with no deadline is never overdue, so the queue is empty in the deployment that publishes no policy.

Nothing here holds a name, an address, or a means of contact. Only an account holder has an identifier, because that is the only claimant this domain already knows, and a regression asserts no column exists that could hold the rest.

### Appeals, and what a person may be told

`0035_safety_appeals` builds the other half of the obligation shape recorded in [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md): notice and reasons, and a route to contest them. Whether Regulation (EU) 2022/2065 binds Velora is a legal question left open there; the machinery is built because notice, reasons, a human decision, and a bounded window are structure rather than copy, and structure added late is far more expensive.

**A statement of reasons discloses the category and the scope, and nothing else.** Not the review's finding, not the evidence, not the reviewer, not the report. It is derived from decisions that *imposed* something and that nothing has replaced — telling somebody they are restricted when a later decision lifted it would be worse than telling them nothing — and the reason it carries is the disclosable one derived from the scope, from a vocabulary asserted to be disjoint from both the reporter categories and the enforcement findings.

**Two kinds of person can be affected by one decision, and both may complain.** A subject who was restricted, and a notifier whose report was dismissed. Article 20 covers complaints about decisions taken *and* about decisions not to act on a notice, so a model with only the first would have missed half of it. Who may complain about what is a map rather than a check at the call site, and a notifier is verified against the reports in the case, so nobody contests a dismissal of somebody else's report. Every refusal — somebody else's decision, somebody else's report, the wrong kind of decision — is the same shape, so probing the path enumerates nothing.

**An appeal never erases anything.** Upholding one produces a *superseding* decision that names the original, and the original stays byte-for-byte as written, because it is the only evidence that the appeal was necessary. The outcome is checked to genuinely supersede the decision appealed: one pointing at an unrelated record would claim something was put right when nothing was.

**A complaint is not decided by anything automated.** The outcome carries the reviewer who reached it, a database constraint refuses an answered complaint with no reviewer on it, and nothing in this domain is automated. That is what makes Article 20's requirement structural rather than a promise.

At most one live complaint per person per decision, settled by a partial unique index. Withdrawing leaves the record and frees the person to complain again; what is refused is contesting one decision twice at once.

The window comes from a published policy and is stored beside its version. `SAFETY_APPEAL_POLICY` publishes none and is rejected in staging and production, so a deployed platform accepts complaints with no closing date at all — which is the safer half of the question to leave open. The six-month figure Article 20 states is recorded as evidence about what a policy will need to say rather than compiled in.

The case gains no `appealed` state, and that is deliberate: an appeal has its own record, its own lifecycle, and its own queue, so a case state kept in step with it would be two sources of truth for one fact.

### What a person and a creator are told

A consumer surface exists for the two things somebody is entitled to: knowing what was done to them, and contesting it. `GET /v1/safety/standing` returns the statements of reasons from the appeal model — the scope, the disclosable category, when, whether a complaint is available, and by when — and `POST /v1/safety/appeals` opens one. Nothing on that surface reveals anything about anybody else, and a regression pins the complete list of paths a consumer credential can reach.

**Who the caller is to a decision is derived, never claimed.** The submission body has no field for an appellant kind: the server decides whether this account is the subject the decision was about or the notifier whose report it dismissed, because a client-declared role is a client-authoritative fact about entitlement. A decision that does not exist, one about somebody else, and a dismissal of somebody else's report answer identically, so probing the path enumerates nothing.

The appellant's statement is sent once and never read back. They already know what they wrote, and echoing stored text over the API turns a record into a readable store — the same rule the reporter narrative has followed since `0011_safety`.

Creator Studio gets one route and one answer: `GET /v1/creator/safety/readiness` reports that mature content is unavailable, and *why*. Every blocker is listed — the capability itself, the absent verifier, the unpublished wording, the provisional taxonomy — each owned by somebody who is not the creator reading it. There is no upload control and no toggle anywhere in the Studio, because a control that could not succeed is a promise in a button. The configured sources are reported by name rather than as booleans, since "off" and "off because nobody has approved one" are different facts and a creator deserves the second. Store ineligibility is reported *beside* the blockers rather than among them: both app stores prohibit the class outright with no published approval path, so it is a permanent property of those surfaces rather than something anybody is working through.

### What the worker does, and what it refuses to do

A passed takedown deadline is noticed by a background sweep and written down as `system_fact` evidence on the case: a bounded code, `takedown_action_deadline_passed`, and the instant it was due. Never a sentence, never anything about anybody.

**Recording a passed deadline decides nothing.** It is a fact about the platform's own timeliness. The decision the claim was owed is still a reviewer's, and a sweep that quietly actioned a claim would be automation deciding a safety matter — which [TRUST & SAFETY](#purpose-and-scope) does not do and [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) forbids.

The sweep is idempotent by construction rather than by luck. The evidence and the stamp that records it commit together, the stamp is written only while the sweep still holds the claim's lease, and a claim whose breach is recorded stops being offered. So a worker that dies before committing has the work repeated, one that dies after it does not, and two workers sweeping at once record one breach between them. On a platform that publishes no deadline policy the sweep finds nothing, every cycle, which is the accurate answer rather than a loop pretending otherwise.

**This domain publishes no outbox and consumes no queue.** Every other producer here has one because something downstream needs the fact; nothing needs a safety fact today, and the relay dead-letters an event with no consumer — loudly and correctly. An outbox added now would guarantee a dead-letter for every row it ever held. What ADR-0022 requires is that safety truth survives a worker crash and a queue loss, and it does: every safety record is a PostgreSQL row written by the transaction that made it true, and the one background loop this domain has recovers by lease rather than by memory.

**Nothing sensitive reaches a log line.** Not a reporter's narrative, not an operator's note, not an appellant's statement, and not a message body. The sweep logs a count and is silent when there is nothing to count, because an identifier there would put one person's complaint in a log line. A regression files a report with a distinctive narrative, records a note, decides the case, and appeals it, then asserts none of those strings appears anywhere in what the logger was given.

### What blocks production

Blocks and reports themselves are blocked on nothing: a person must be able to stop being contacted, and must be able to report, from the first day the product exists. What is blocked is the review and enforcement process around them — the risk taxonomy, emergency action policy, appeals and SLA, and evidence retention are all undecided, and Admin sign-in has no approved implementation. Each is recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## Where this domain is going

[ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) records the architecture this milestone builds against. The policy authority, the scoped append-only enforcement model with supersession, the published capability answer, reports and cases and evidence and decisions as separate append-oriented records, and depicted-person consent held as scoped references to an approved verifier rather than as documents are built and described above. Still to come: appeals, surface as a first-class closed vocabulary, deadlines read from a versioned published policy, and mature-content enablement as configuration that refuses in every deployed environment. None of it enables mature content, and the ADR is explicit that its presence must not be capable of doing so.

## Phase/open questions

V1 blocks, reports, basic enforcement predicates. Phase 2 AI assistance remains advisory. Separately reviewed deterministic automation may perform only explicitly specified non-high-impact policy steps with audit, monitoring, human override, and no model judgment. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: policy taxonomy, permitted deterministic automation, appeal/SLA, evidence retention, regional requirements, enforcement propagation timing. See [report to enforcement](../flows/report-to-enforcement.md), [MODERATION](moderation.md), [moderation operations](../operations/02-moderation-operations.md), [AI action flow](../flows/ai-assisted-action.md), [RBAC](../security/02-access-control-rbac.md).
