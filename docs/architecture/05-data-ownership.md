# Data ownership and lifecycle

## Purpose

Define source-of-truth, references, and lifecycle coordination. Detailed domain models belong in `docs/domains/`; privacy/retention authority is [privacy and retention](../security/03-privacy-retention.md).

## Rules

- One record class has one writing domain. Foreign references use stable IDs, never copied mutable authorization state as truth.
- AUTH owns authentication identity; USERS owns profile; CREATORS owns creator business identity; PRIVATE CLUBS owns entitlement; BILLING owns customer money state; PAYOUTS owns disbursement state; Trust & Safety owns block/enforcement state.
- Derived search, feeds, analytics, and notification projections are disposable/rebuildable. They minimize sensitive fields and honor revocations/deletion events.
- AI short-term context, consent-based memory, embeddings, and RAG indexes are non-authoritative derived data. They retain provenance/access scope, expire or delete with source/consent/account lifecycle, and never override source-domain facts.
- All sensitive records have classification, purpose, retention category, access policy, and audit requirement.

## Deletion and retention flow

USERS coordinates account deletion request, checks legal/financial/safety holds supplied by owners, removes consumer access, emits lifecycle event, and drives anonymization/deletion tasks. Other domains delete or irreversibly de-identify data they own unless defined retention exception applies. Financial, fraud, and audit records retain minimum lawful evidence with access restriction; they never keep a live profile available. See [account deletion](../flows/account-deletion.md).

## Concurrency and security

Use immutable IDs, record versioning where conflicting edits matter, and transactional outbox for lifecycle events. Do not replicate raw verification documents, secrets, or payment credentials; retain token/reference and access through owning service only. AI PLATFORM has no direct private-store access; authorized context comes through owner contracts.

## Phase/open questions

V1 classification, ownership register, deletion signaling. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: final data residency, retention durations, legal-hold rules by launch jurisdiction. Cross-reference [domain boundaries](03-domain-boundaries.md), [AI context/memory/RAG](../ai/03-ai-context-memory-rag.md), [privacy/retention](../security/03-privacy-retention.md), [data residency](../compliance/05-data-residency-retention.md), [migrations](../engineering/02-data-migrations.md).
