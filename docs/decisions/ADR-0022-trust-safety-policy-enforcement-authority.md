# ADR-0022: Trust and Safety policy authority, enforcement model, and the mature-content gate

- Decision date: 2026-08-16
- ADR status: Accepted
- Owners: Founder (decision owner), TRUST & SAFETY, MODERATION, ADMIN, CREATORS, USERS, security, compliance

## Context

Velora has a V1 safety implementation and no safety *system*. `0011_safety` gives the platform blocks, reports, and an append-only enforcement log, and [TRUST & SAFETY](../domains/trust-safety.md) records honestly that what is missing is the review and enforcement process around them: the risk taxonomy, emergency action policy, appeals and SLA, and evidence retention are all undecided, and Platform Admin sign-in has no approved implementation.

Three things have changed since that was written.

**Platform Admin creator operations exist.** `AdminCreatorService` suspends and reinstates creators, takes objects out of public view, and revokes club entitlements, appending an enforcement record for each. The enforcement vocabulary grew from two scopes to six, and the object vocabulary appeared. That growth happened one operation at a time, which is exactly how a `banned` boolean is born.

**The monetization core is frozen**, and its freeze report states that commercial eligibility is a conjunction re-read inside the transaction that acts on it. Safety is now one of the predicates money asks about, so a safety answer that is expensive, cached, or approximate becomes a commercial correctness problem.

**Mature creator content remains a stated product direction.** [Creator and content gates](../compliance/03-creator-content-gates.md) keeps it `Conditional / Compliance-Gated`, and [provider eligibility](../compliance/06-payment-provider-eligibility.md) records that every assessed payment provider prohibits Velora outright if it is enabled. Newly recorded in [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md): both app stores prohibit the content class with no published approval path, the strongest published age-assurance standard names self-declaration as insufficient, and the depicted-person, notice, reasons, and appeal obligations that would apply are structural rather than cosmetic.

The risk this ADR exists to close is not that mature content gets built too early. It is that the *safety architecture* gets built as a series of per-feature conditionals, and that a later product decision then has nowhere to land except a hundred scattered `if` statements — at which point "is this allowed" has no single answer and no test can prove one.

## Requirements

- One authority decides safety eligibility. Consumer, Creator, Clubs, Billing, Admin, and Notifications ask it; none of them re-derives it and none reads `safety_` tables.
- Every enforcement names an explicit scope from a closed vocabulary. No sanction is expressed as an ambiguous account-level boolean, and a creator-scoped sanction never becomes a global consumer ban.
- Enforcement, decision, and appeal history is append-oriented. A correction is a superseding record; nothing rewrites what was decided, by whom, when, or under which policy version.
- A report is evidence and never an automatic sanction. Report volume alone can move nothing.
- Reporter identity, reporter narrative, and internal operator notes are absent from every consumer-facing and creator-facing shape, from every log, and from every metric label.
- Surface is a first-class input. `WEB`, `MOBILE_IOS`, `MOBILE_ANDROID`, `CREATOR_STUDIO`, and `ADMIN` are a closed vocabulary and a content decision that names no surface is incomplete.
- Self-declared adulthood is never widened into verified adulthood by any code path, configuration value, client field, or purchase.
- Depicted-person evidence is a reference to an approved verifier's outcome, never a stored identity document, and consent is scoped rather than universal.
- Time-bounded safety obligations take their deadline values from a versioned, published policy record. No deadline is written from memory, and no legal deadline is invented.
- Safety truth survives a worker crash and a queue loss. PostgreSQL is authoritative; BullMQ wakes work and owns nothing.
- Nothing in this architecture enables mature content. Its presence must not be capable of enabling it.

## Decision

### One policy authority, asked through a published contract

TRUST & SAFETY publishes a policy and eligibility contract that answers structured questions — may this be published, may it remain public, may this viewer see it, may these two interact, may this be monetised, does this require moderation, does it require stronger adult assurance, does it require participant consent evidence, is it blocked by jurisdiction, by surface, or by enforcement.

Every method takes the caller's executor, on the same rule the existing `SafetyDirectoryPort` already follows: a safety check that commits separately from the write it authorizes is not a check. Answers are deterministic, explainable internally, machine-readable, and versioned where the answer is durable. The internal reasoning is not returned to hostile clients; a caller learns the outcome and the disclosable reason, never the rule chain.

### Enforcement is scoped, append-only, and superseded rather than edited

An enforcement names its subject, its scope from a closed vocabulary, the object it acted on where it acted on one, the reason code, the policy version, the actor reference, the effective instant, an expiry where the scope permits one, the case or report it came from, and the decision it supersedes where it supersedes one.

The existing six scopes stay. What this ADR adds is the rule that governs the next one: **a new scope is a vocabulary change with a migration and a constraint, never a new boolean and never a free string.** The same rule governs object types.

Precedence is composed, not hard-coded ad hoc: a global account restriction outranks a capability restriction, which outranks an object restriction, which is then further narrowed by surface eligibility and by jurisdiction policy. Composition is evaluated in one place and asserted by test, so the order is a property of the system rather than of whichever call site was written last.

### Reports, cases, evidence, decisions, and appeals are separate records

A report is intake. A case is the unit of review, and grouping reports into a case preserves each original report as evidence. Evidence is an immutable reference or minimal snapshot, never a copy of a foreign domain's record and never a whole private conversation. A decision is an explicit record with a closed action vocabulary; a final decision is never edited, and a correction is a superseding decision. An appeal, where policy makes a decision appealable, produces a superseding decision on success and never erases the original.

Severity and priority are recorded by a reviewer against policy. **Report count is not an input to severity and cannot become one**, because the alternative is a platform where twenty coordinated accounts can escalate anybody.

### Surface eligibility is separate from content eligibility

Surface is a closed vocabulary and mature eligibility is decided per surface. `MOBILE_IOS` and `MOBILE_ANDROID` are structurally ineligible for mature content under both stores' published prohibitions, recorded with sources in [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md). That ineligibility is a property of the surface rather than a configuration value, so no environment variable, country row, creator setting, or client field can turn it on.

### Adult assurance keeps its existing classes and gains no shortcut

`none`, `self_declared`, and `verified_adult` stay distinct, as [adult age and verification gates](../compliance/02-adult-age-verification.md) requires. Mature-content capability requires `verified_adult`. No approved verifier can produce it, so the capability fails closed — which is the correct behaviour, not a gap. A completed purchase, a club membership, a creator's assertion, and a viewer's checkbox are none of them age assurance, and each is refused by name in test.

### Depicted-person consent is evidence about a scope, not a flag

A content item may have zero, one, or many depicted participants. For each, the platform records references to identity, adult-assurance, and consent evidence held by an approved verifier, the scope that consent covers, its status, when it was recorded, when it expires or requires revalidation, whether it has been revoked, and any takedown claim attached to it.

Velora stores no raw identity document, no biometric template, and builds no identity matching. A creator's assertion is stored as an assertion and is never presented as verified. Consent is scoped — to a publication, a distribution, a use, a duration — because "this person once consented to something" is not permission for anything else. Approved consent wording is legal copy and stays a human gate.

The verification and consent provider is a port. Production and staging fail closed with no approved provider, on the same configuration pattern as `USERS_ADULT_ASSURANCE_VERIFIER`; a development and test adapter exists so the path is exercisable and is named so that no test using it reads as evidence about a real provider.

### Deadlines come from versioned policy and live in PostgreSQL

Takedown and case obligations carry received, acknowledged, triage-due, action-due, decided, and completed instants. Every deadline value comes from a versioned, published policy record, and the version is stored on the record it produced. Production publishes no such policy today, so production computes no deadline; development and test use a deterministic policy so the arithmetic is exercisable.

A temporary hold is distinguishable in the schema from a final violation decision, because an accusation represented as guilt is a defamation the platform authored. Deadline ownership is claimed with the platform's existing lease and reclaim pattern; a worker that dies releases its claim and the deadline survives, because the deadline is a row and not a timer.

### Mature-content enablement is configuration that refuses

One configuration value gates the entire mature-content capability. Its default and its only deployable value publishes nothing; staging and production reject any other value; and it is independent of every other gate, so satisfying age assurance, consent, moderation, or provider eligibility individually enables nothing on its own.

**The presence of this architecture is not enablement, and no default, migration, seed, test adapter, client flag, or request field may make it so.** A test asserts it.

## Why

**One authority, because the alternative has already started.** The enforcement vocabulary grew from two scopes to six across two milestones, each addition locally reasonable. A seventh added the same way would be the point at which nobody can say what a given sanction actually does. Centralising the decision is cheaper now than after mature content makes the question load-bearing.

**Append-only, because an audit asks what was done rather than what is in force.** The existing enforcement table already works this way and the reasoning generalises: an appeal that erased the original decision would destroy the only evidence that the appeal was necessary.

**Scoped enforcement, because scope is the whole content of a sanction.** A creator suspended for a catalogue violation has not been accused of anything as a consumer. Collapsing the two would ban somebody from a product they were never accused of anything in, and the platform would have no record that it had done so.

**Report count excluded from severity, because a report is an allegation.** [Report to enforcement](../flows/report-to-enforcement.md) already forbids automatic punishment. Making volume an input to priority is the same mistake wearing a different word.

**Surface separated from content, because the two stores prohibit the class outright.** Building mature eligibility as a single global answer and then filtering it in a mobile client would put the enforcement in the least trustworthy place in the system. The server decides per surface, and a client that lies about its surface gets the stricter answer, never the looser one.

**Evidence by reference, because holding the documents is the larger risk.** Record-keeping obligations are recorded in [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md) and whether they bind Velora is a legal question nobody here may answer. What is answerable is that a table of government identity documents is the highest-value breach target the platform could build, in exchange for evidence Velora is probably not the right party to hold.

**Deadlines from published policy, because inventing one is worse than having none.** A hard-coded seven days would look like compliance, would carry no authority, and would be the number an operator later defended in writing. The seven-business-day figure recorded from Mastercard is a card-network programme requirement; it is evidence about what a policy will need to say, not a value to compile in.

**Fail-closed configuration, because it is the pattern that has held.** `USERS_ADULT_ASSURANCE_VERIFIER`, `BILLING_COMMERCE_POLICY`, `BILLING_PAYMENT_PROVIDER`, `PAYOUTS_PROVIDER`, `USERS_PROFILE_MEDIA_STORAGE`, and `MESSAGING_SAFETY_ELIGIBILITY` all refuse in deployed environments and all refuse for a reason written down next to them. Mature content joins that list rather than inventing a weaker mechanism.

## Consequences

- MODERATION gains real persistence and a real Admin surface. Its routes are Platform Admin audience only, step-up protected, audited, and expressed as explicit commands; there is no generic patch endpoint for a safety record.
- Consumer and Creator Studio gain truthful safety surfaces. Creator Studio reports mature-content readiness as blocked, with the real blockers, rather than rendering a workflow that cannot succeed.
- New migrations are additive and land after `0028_payouts_overdraw_enforcement`.
- The `DatabaseService` admission architecture in [ADR-0019](ADR-0019-database-connection-admission.md) is unchanged. Safety scale is solved with indexes, keyset pagination, and bounded queries, never by widening the pool.
- Several legal and product questions remain open and are recorded in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md). None of them is resolved by this ADR, and none may be resolved silently in code.

## Alternatives considered

**Extend the existing enforcement table per feature, as before.** Rejected: it is the trajectory that produced six scopes with no composition rule, and it has no answer for surface, jurisdiction, or consent.

**Model mature content as a content flag checked at read time.** Rejected: it makes the answer a property of one column instead of a conjunction of independent gates, and every one of those gates is owned by a different authority that can revoke independently.

**Wait for the legal decisions before building any of it.** Rejected: the obligations recorded from primary sources — notice, reasons, human appeal, bounded windows, scoped consent, evidence references — describe machinery, not copy. Building the machinery now under fail-closed configuration is what makes the eventual legal answer a policy publication rather than a rewrite.

**Ship a mature-content workflow behind a feature flag.** Rejected outright. A flag that could be flipped is enablement waiting for an accident, and Apple Guideline 2.3.1(a) treats a dormant remotely-enabled feature as a violation in its own right.

## Cross-references

[TRUST & SAFETY](../domains/trust-safety.md), [MODERATION](../domains/moderation.md), [report to enforcement](../flows/report-to-enforcement.md), [moderation operations](../operations/02-moderation-operations.md), [market entry gates](../compliance/01-market-entry-gates.md), [adult age and verification gates](../compliance/02-adult-age-verification.md), [creator and content gates](../compliance/03-creator-content-gates.md), [payment provider eligibility](../compliance/06-payment-provider-eligibility.md), [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md), [ADR-0019](ADR-0019-database-connection-admission.md), [ADR-0020](ADR-0020-creator-capability-activation.md), [ADR-0021](ADR-0021-monetization-money-architecture.md).
