# Moderation operations

## Purpose and authority

Define human moderation operations from intake through review, decision, enforcement request, appeal, and quality review. MODERATION owns case workflow and evidence references; TRUST & SAFETY owns enforcement state and policy execution.

## Work types and roles

Inputs include user reports, upload/media scans, provider signals, deterministic policy signals, appeals, trusted escalations, and Phase 2 AI assistance. Reviewers have queue/content/country/language scope. Senior reviewer, safety lead, legal/privacy, law-enforcement response, and Owner/Super Admin escalation require documented roles; none receive unrestricted evidence by default.

## Case lifecycle

1. Intake validates subject/evidence references, deduplicates/links, risk-triages, and assigns queue.
2. Reviewer claims case through lease/version and views minimum necessary evidence with policy version.
3. Reviewer records observed facts separately from automated/AI inference, applies policy, and records decision, reason, confidence/uncertainty, and required action.
4. High-impact or sensitive decision obtains required second review/approval.
5. TRUST & SAFETY or content owner re-authorizes and applies enforcement/content transition.
6. Communication, appeal window, evidence retention, and follow-up use country/policy rules.
7. Appeal uses a new or independent review where required and never silently overwrites history.

Urgent safety risk may trigger temporary scoped restriction under approved emergency policy, followed by timely review. Emergency action is not a permanent ban decision by default.

## Evidence and privacy

Evidence uses immutable references/snapshots, access logs, chain-of-custody, source/time, integrity metadata, and retention class. Store reporter identity separately and reveal only where justified. Raw message/media/identity evidence stays out of generic analytics, notifications, AI traces, and broad Admin search.

Review tools provide safe media controls, content warnings, wellness practices, and restricted download/export. Missing or inaccessible evidence is recorded; it is never reconstructed or fabricated.

## Automation and AI boundary

Deterministic automation may perform only policy-approved, bounded, non-high-impact steps with audit and human override. AI may prioritize, classify, summarize, retrieve policy, and recommend. Output is labeled inference with provenance/version/limitations. AI cannot create evidence, close appeal, approve decision, ban/suspend, or change content status directly.

## Quality, failure, and open decisions

Monitor queue age, severe-risk SLA, disagreement, appeal reversal, false positive/negative samples, repeat abuse, reviewer workload/wellness, evidence access, and enforcement propagation. Queue/provider/AI failure preserves case and routes safely; enforcement result is verified before communication.

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: policy taxonomy, severity/SLA, emergency restrictions, mandatory reporting/escalation, reviewer qualifications, dual review, appeal independence, evidence retention, transparency notices, wellness support, and automation/AI thresholds.

## Cross-references

See [MODERATION](../domains/moderation.md), [TRUST & SAFETY](../domains/trust-safety.md), [report flow](../flows/report-to-enforcement.md), [creator gates](../compliance/03-creator-content-gates.md), and [AI product surfaces](../ai/06-ai-product-surfaces.md).
