# Privacy, retention, and deletion

## Purpose

Set data minimization, purpose limitation, retention, access, export, and deletion principles. Final legal requirements and durations are `DECISION REQUIRED / LEGAL REVIEW REQUIRED` by launch jurisdiction.

## Data rules

Classify data as public-profile, private account, sensitive safety/verification, financial, operational audit, or secret. Each owner defines purpose, permitted roles, storage region, retention trigger/duration, deletion/de-identification method, export eligibility, and audit requirement. Collect only necessary data; pseudonymize/minimize analytics and projections. Never put raw passwords, cards, encryption keys, or unneeded identity documents in general stores/events.

AI contexts, prompts/completions, durable memory, embeddings, RAG indexes, evaluation datasets, human-review samples, and provider-retained data inherit source classification and purpose restrictions. Derived form does not remove sensitivity. AI memory/indexes must retain provenance and support consent/source/account deletion propagation.

## User rights and lifecycle

Provide accessible policy/consent records and user controls appropriate to jurisdiction. USERS coordinates deletion; domain owners erase/de-identify their records and keep only narrow lawful safety, financial, fraud, or audit exceptions. Exports are authenticated, scoped, rate-limited, redacted for others' privacy, generated asynchronously, encrypted/expiry-controlled, and audited.

## Security/failure/concurrency

Authorize every private-data read and log privileged/sensitive reads. Retention jobs are durable/idempotent; hold/status races use effective dates and owner versions. Failed deletion/export job retries and alerts; no silent data loss or unbounded retention. Do not reveal reporter, counterpart, moderation, or verification material in user export without policy/legal review.

## Phase/cross-references

V1 classification and deletion baseline. See [account deletion](../flows/account-deletion.md), [data ownership](../architecture/05-data-ownership.md), [data residency/retention](../compliance/05-data-residency-retention.md), [AI context/memory/RAG](../ai/03-ai-context-memory-rag.md), [analytics](../domains/analytics.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).
