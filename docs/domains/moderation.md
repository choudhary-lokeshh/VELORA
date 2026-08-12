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

## Cross-references

[Trust & Safety](trust-safety.md), [report/enforcement](../flows/report-to-enforcement.md), [moderation operations](../operations/02-moderation-operations.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [AI safety](../ai/04-ai-safety-security.md), [creator clubs](../product/03-creator-private-clubs.md), [provider adapters](../architecture/06-provider-adapters.md).
