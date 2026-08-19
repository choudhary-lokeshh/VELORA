# Trust and safety freeze report

## What this records

The trust and safety core and the mature-content compliance architecture are frozen: the internal architecture, its invariants, and the code that carries them are complete and green, and no further work on them is planned until something below unfreezes them.

Freezing the architecture is not the same as being ready to enforce, and it is very much not the same as being able to publish mature content. This document exists mostly to keep those three apart, in the same way the [monetization freeze report](11-monetization-freeze-report.md) separates a frozen money architecture from an ability to charge anybody. [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) requires that every safety surface be truthful about what is blocked rather than render a workflow that cannot succeed, and a freeze report claiming readiness would break that rule in the one place it matters most. Velora can accept a block and a report today. It cannot run production enforcement, and it cannot publish mature creator content — in both cases because decisions nobody has made are missing, not because components nobody has built are missing.

## What is frozen

Blocks and reports; cases with a lease-based claim and a keyset queue; evidence as references and bounded snapshots; decisions that name what they cited and what changed; the enforcement authority that is the single writer of every restriction; depicted-person depictions, participants, and scoped consent records; content classification and the composed gate that answers publish, stay public, deliver, and monetise; takedown claims and the deadlines a published policy would give them; appeals and the statement of reasons a subject may read; the Platform Admin moderation surface; the consumer standing and complaint surface and the creator readiness surface; the background deadline sweep; and the indexes that keep all of it cheap as the tables grow.

The initial TRUST & SAFETY build spans `0011_safety` and `0029_safety_policy_authority` through `0037_safety_scale_indexes`. Identity-owned migration `0050_identity-safety-cutover` then removes local depicted-person provider/identity/adult fields while preserving SAFETY's participant and consent records through an opaque Identity subject reference. Thirteen tables remain owned by TRUST & SAFETY. Six of them are append-only in the database rather than by convention — evidence, decisions, the decision-to-evidence links, enforcement records, depicted participants, and consent records each carry a trigger that refuses every update and delete, exactly as the financial tables do. The rest carry explicit state and a version, and are moved only through the transitions their service allows.

The domain reaches another domain only through that domain's published contract, and never writes another domain's tables itself. What a report may name is resolved through the owning domain's contract, an account restriction is applied by USERS and a conversation closure by MESSAGING — each inside the deciding transaction, by that domain's own code — and a creator's state is changed only by Platform Admin's own explicit command. `SafetyEligibilityPort` is the published capability answer every other domain consumes.

## What is not frozen, and why

**MATURE CONTENT PRODUCTION ENABLEMENT IS BLOCKED.** Not by an incomplete implementation but by a configured capability with no enabling value, and behind that by four separate authorities who have each decided nothing:

- **The capability itself.** `SAFETY_MATURE_CONTENT` is a single-value enum. No string, header, route, or environment turns it on, because no value that would enable it exists to be set.
- **No approved Identity provider or jurisdiction policy.** `IDENTITY_VERIFICATION_PROVIDER` defaults to `unavailable` and production policy is unpublished. SAFETY has no verifier adapter or provider fields; it can only consume current Identity evidence for an exact participant reference. No deployed environment can establish that evidence, so no depiction can be cleared.
- **No approved consent wording.** `SAFETY_CONSENT_POLICY` defaults to `unpublished`. No legal copy is invented anywhere in the repository, and a consent record without an approved copy version is not consent.
- **A provisional taxonomy.** The classification vocabulary in code is `v1-provisional` and no policy owner has approved it.

Two more constraints sit outside configuration entirely. **No mature capability may run on `self_declared` adulthood**, because Ofcom's finding that self-declaration is not a highly effective age check is recorded with its source and no approved verifier exists that produces anything stronger. And **`MOBILE_IOS` and `MOBILE_ANDROID` are structurally ineligible surfaces in code rather than configurable ones**, because both stores prohibit the class outright with no published approval path.

**PRODUCTION ENFORCEMENT IS BLOCKED**, separately and for its own reasons, each recorded with its owner in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md):

- **The risk taxonomy is undecided.** Both vocabularies in code are `v1-provisional`, are deliberately different sets so a reporter's category can never read as a review's conclusion, and are pinned by an assertion so neither drifts into the other.
- **No emergency action policy exists**, and no emergency path exists in code: every enforcement is a recorded decision against a report.
- **The appeal process and its SLA are undecided.** The machinery is built to the obligation shape Regulation (EU) 2022/2065 states — notice, a disclosable reason, a human reviewer, a bounded window — and no deadline or window is compiled in from it. Production publishes no appeal policy and therefore computes no window.
- **Safety evidence retention is undecided.** Nothing expires, nothing is deleted, and no correctness rule depends on deletion, so an approved duration applies later as a deletion pass.
- **Operational deadlines are undecided.** `SAFETY_TAKEDOWN_POLICY` defaults to `unpublished`, so production computes no deadline and the sweep finds nothing to record, every cycle. The seven-business-day card-network figure is evidence about what a policy must say, never a value to hard-code.
- **Admin sign-in has no approved implementation.** The Platform Admin audience requires fresh phishing-resistant assurance and no approved verifier exists, so the entire operator surface is unreachable in every environment.

Two transparency gaps are recorded rather than closed, because closing either would mean inventing something: the review seam still refuses creator-scoped decisions, and a suspended creator gets no statement of reasons and no complaint route. Both are described in [TRUST & SAFETY](../domains/trust-safety.md).

## The invariants, and where each is enforced

The record of what was decided is append-only and enforced by trigger rather than by the writer: evidence, decisions, the links between them, enforcement records, depicted participants, and consent records are all refused update and delete by PostgreSQL. A correction is a second record that supersedes the first and leaves it byte-for-byte as written. A case, a report, and a complaint do move — they have a lifecycle — and each moves only through a versioned transition, so a stale read loses rather than overwrites.

The enforcement authority is the single writer of every restriction, and every enforcement record carries an explicit disposition, an expiry, and what it supersedes — so "restricted" is a state the record states rather than one a reader infers from absence. A decision that enforces must cite evidence and must carry a finding rather than one of the reasons a review has when it found nothing, and the schema refuses the incoherent combinations rather than trusting the caller.

Every consequential decision is one transaction: the case transition, the enforcement, the effect on the owning domain, the decision record, and the resolution of the reports it settles commit together or not at all. A refusal discovered halfway through rolls all of it back, because a restricted account with no decision recorded is exactly the unexplainable state the transaction exists to prevent. Partial unique indexes are the arbiter of a race, not a read-then-write check.

Concurrency ordering is one rule everywhere: the subject advisory lock before any row lock, and never both a pair lock and a subject lock in one transaction. Contention across the whole vertical at once — intake, a claim, two opposed decisions, a closure, an operator note — moves `pg_stat_database.deadlocks` not at all.

Nothing sensitive leaves the domain. A reporter's narrative, an operator's note, and an appellant's statement are stored and never read back over any API or written to any log line. A statement of reasons carries a coarse disclosable category, the scope, when, and whether a complaint is available — and has no field for the finding, the evidence, the reviewer, or the report, so no response built from its shape can carry one. No raw identity document, image, or biometric template has a column anywhere in this domain.

Automation decides nothing. The one background loop records a passed deadline as a bounded system fact about the platform's own timeliness; the decision the claim was owed is still a reviewer's.

## What the hardening phases found

Recorded because the value of an audit is in what it caught:

- **A restriction could be hidden from the person it was against.** The statement of reasons read the newest fifty decisions about a subject and filtered afterwards for the ones that imposed something and that nothing had replaced, so fifty newer no-op decisions pushed a live restriction out of the window and the surface told that person nothing was in force. The same bug ran the other way, leaving a lifted restriction displayed. A limit applied to the wrong set is a wrong answer rather than a bound.
- **An older complaint could not be withdrawn.** Withdrawal resolved the complaint by scanning a page of the caller's own, so an appellant with more complaints than one page was told theirs did not exist — in the same words used for somebody else's.
- **Complaints were unbounded.** The live-complaint index is partial on the non-withdrawn rows, which correctly lets a withdrawal free somebody to complain again, and without a bound let one account cycle submit and withdraw indefinitely.
- **A partial case looked complete.** The operator case view bounded reports, evidence, and decisions at two hundred each and said nothing when it reached one, so a reviewer could be deciding on less than they thought they had.
- **Six reads would have become an outage as the tables grew**, each found by measuring the plan the planner actually chose rather than by reading the code: the unfiltered operator queue, the open report queue, a person's own blocks, and three lists paged on a tiebreaker the index did not carry — one of them on the path of a request a restricted person makes.
- **The overdue takedown queue rediscovered every breach it had ever recorded, on every cycle, for ever.**

Every one is now enforced in the database where the database can hold it, in code where it cannot, and asserted by a test that fails for the right reason.

## The evidence this rests on

Twenty consecutive runs of the API integration suite, on the frozen tree, with no retries and no reruns: 787 tests across 40 files, 787 passing and none failing in every one of the twenty. The sequence was the whole proof — a suite that passes on a second attempt has been shown to be flaky rather than stable, so any failure would have voided it and restarted it from the first run after a root-cause fix.

Beneath that, the canonical `pnpm ci:verify` graph: toolchain and frozen-install verification, workspace policy, formatting, lint, domain boundaries, typecheck, contract generation checked against the committed OpenAPI document and generated client, the authorization policy check, unit tests, the integration suite against real PostgreSQL and Redis, an uncached build of every app, browser end-to-end tests across three engines, the mobile doctor, compose validation, secret scanning, whitespace and hygiene, and the dependency security gate. Green end to end, and green on the hosted pipeline for every commit in this milestone. One push run was cancelled rather than completed — the workflow's concurrency group cancels an in-progress run when another starts on the same ref, and the nightly scheduled run did exactly that — and the scheduled run on the identical commit reported success, which is the signal that was accepted. No run was retried to obtain a different answer.

One suite walks the whole chain rather than its parts: a report becomes a case, the case carries evidence, a decision on that evidence reaches USERS and changes an account, the person it happened to reads why and contests it, upholding the complaint produces a superseding decision, and the surface then stops saying they are restricted — with the record of everything that happened, including the decision that was overturned, still there afterwards.

No test was weakened, skipped, or retried to reach any of this, and no safety, privacy, or policy control was relaxed to make one pass.

## What unfreezes this

Any of: the risk taxonomy is approved; an emergency action policy is published; an appeal process and SLA are decided; an evidence retention schedule is set; a deadline policy is published; an admin sign-in implementation is approved. Each of those turns a refusing adapter or an unpublished policy into a real one, and none of them is a code change first — the policy ports are where approved terms land.

Mature content needs all of the above *and* its own four: an approved Identity provider/policy for depicted-person identity and adult evidence, approved consent wording and revocation terms, an approved classification taxonomy, and a resolved record-keeping duty under 18 U.S.C. § 2257. Even then the surface question stands separately, because both app stores prohibit the class outright.

The review triggers on [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md) apply: its findings are dated, and an entry whose retrieval date has aged past its trigger is stale evidence that must be re-verified before it supports any decision.

## Cross-references

[trust and safety ADR](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md), [TRUST & SAFETY](../domains/trust-safety.md), [MODERATION](../domains/moderation.md), [report to enforcement](../flows/report-to-enforcement.md), [moderation operations](../operations/02-moderation-operations.md), [adult and age verification](../compliance/02-adult-age-verification.md), [creator content gates](../compliance/03-creator-content-gates.md), [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md), [access control](../security/02-access-control-rbac.md), [jobs, idempotency, concurrency](../engineering/03-jobs-idempotency-concurrency.md), [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
