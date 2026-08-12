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

## Phase/open questions

V1 manual reports, blocks, basic action. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: risk taxonomy, emergency action policy, appeals/SLA, reporter updates, legal retention. See [TRUST & SAFETY](../domains/trust-safety.md), [MODERATION](../domains/moderation.md), [moderation operations](../operations/02-moderation-operations.md), [Platform Admin](../product/04-platform-admin.md).
