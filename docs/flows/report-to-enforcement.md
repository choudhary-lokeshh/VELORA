# Report to enforcement flow

## Purpose

Define safe path from user report or moderation signal to enforcement. TRUST & SAFETY owns report/enforcement truth; MODERATION owns review workflow.

## Preconditions

Reporter can access report entry point under policy; report target/evidence references are validated and rate-abuse controls apply. Immediate self-protection is handled by block independently from report outcome.

## Main flow

1. TRUST & SAFETY records report with protected reporter/evidence references, acknowledgement, policy version, and idempotency/duplicate linkage.
2. MODERATION creates/links case, triages risk, gathers minimum necessary controlled evidence, and records reviewer decision. Deterministic or AI-assisted prioritization may influence queue only; it does not decide enforcement.
3. If policy action needed, MODERATION requests Trust & Safety enforcement with scope, effective time, reason code, evidence/decision reference, and approval when required.
4. Trust & Safety applies versioned enforcement and publishes minimized eligibility changes to affected domains.
5. Subject/reporting communications follow safety/legal policy; do not expose reporter identity or internal details.

## Alternate/failure flow

Urgent risk may apply temporary restriction under documented emergency policy before full review. Duplicate/malicious reports are linked/rate limited but not silently erase potential evidence. Invalid/unavailable evidence is recorded. Concurrent appeal/review/enforcement uses state version and decision precedence; appeal can modify future scope only through audited transition. Event delivery failure is retried/reconciled; source safety state remains authoritative.

## Permissions/security/data

Reporter sees own submission status where safe. Moderator sees assigned minimum evidence. Admin/Super Admin access is scoped/audited, no unrestricted exports. Maintain chain-of-custody, retention, policy references, and access logs. Do not place raw evidence in generic event/analytics pipeline.

For depicted-person verification, TRUST & SAFETY owns relationship and scoped consent while IDENTITY ASSURANCE owns identity/adult evidence. Neither provider evidence nor a creator assertion decides enforcement or content eligibility by itself.

## Implemented V1 behaviour

A report is recorded with its reporter, its subject, the reporting policy version in force, and a client identifier that makes submission retry-safe. The reporter, their narrative, and every internal rationale are absent from the published contract entirely, so no response the API can produce carries one; the person reported is told nothing and their state is unchanged, because a report is an allegation and not an action.

MODERATION does not exist as a surface. What exists is the seam it will call: a service with no HTTP route, wired to real enforcement. Platform Admin sign-in has no approved implementation — the local identity contract refuses the Platform Admin audience and the privileged authenticator verifier refuses every assertion — so a published moderation endpoint would be one that either nobody can reach or that a consumer credential eventually does. Regressions assert no admin, moderation, or enforcement route is published and that no consumer action produces an enforcement record.

Enforcement decides and the owning domain applies: USERS restricts or restores an account, MESSAGING closes a conversation, and SAFETY writes to neither schema. The report transition and the enforcement commit together, so a report marked actioned with no enforcement behind it is not reachable, and an enforcement that cannot take effect rolls the decision back.

Enforcement records are append-only and a reversal is a second record rather than an edit, but a second record is no longer indistinguishable from a second decision: a record now says whether it imposes or lifts, may carry an expiry, and names the record it supersedes. That is what makes "what is in force right now" answerable from the log rather than only from the domain that applied the change, and it is what a restoration writes instead of a second restriction under the same scope. A restoration with nothing in force to lift is refused rather than recorded. See [TRUST & SAFETY](../domains/trust-safety.md) for the model and [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) for why it is one authority rather than one per caller.

Blocks resolve every race with a send or an introduction through a transaction-scoped advisory lock on the ordered pair, taken before any row lock. See [TRUST & SAFETY](../domains/trust-safety.md) for why an absent row cannot be serialized any other way.

## Phase/open questions

V1 manual reports, blocks, basic action. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: risk taxonomy, emergency action policy, appeals/SLA, reporter updates, legal retention. See [TRUST & SAFETY](../domains/trust-safety.md), [MODERATION](../domains/moderation.md), [moderation operations](../operations/02-moderation-operations.md), [Platform Admin](../product/04-platform-admin.md).
