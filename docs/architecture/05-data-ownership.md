# Data ownership and lifecycle

## Purpose

Define source-of-truth, references, and lifecycle coordination. Detailed domain models belong in `docs/domains/`; privacy/retention authority is [privacy and retention](../security/03-privacy-retention.md).

## Rules

- One record class has one writing domain. Foreign references use stable IDs, never copied mutable authorization state as truth.
- AUTH owns authentication identity, its `auth_`-prefixed tables, and its own security events; USERS owns the consumer account, profile, and its `users_`-prefixed tables; CREATORS owns creator business identity; PRIVATE CLUBS owns entitlement; BILLING owns customer money state; PAYOUTS owns disbursement state; Trust & Safety owns block/enforcement state.
- A table prefix names its owning domain, and integration tests assert that a domain's migration creates only tables under its own prefix. A cross-domain reference is the other domain's identifier column with no database foreign key: a key would make one domain's deletion policy silently execute inside another domain's records, which the deletion flow below assigns to USERS to coordinate explicitly. Uniqueness and shape constraints on the reference still belong to the referencing domain and are enforced there.
- A transactional outbox is owned by the domain that produces the fact and lives under that domain's prefix, because the fact and the state it describes must commit in one transaction. `messaging_outbox` is MESSAGING's; NOTIFICATIONS never reads it, and the relay that drains it publishes to consumers rather than granting anybody access to the table. Notification intents and attempts are NOTIFICATIONS' own truth under `notifications_`, and a queue entry is never truth for either.
- Derived search, feeds, analytics, and notification projections are disposable/rebuildable. They minimize sensitive fields and honor revocations/deletion events.
- AI short-term context, consent-based memory, embeddings, and RAG indexes are non-authoritative derived data. They retain provenance/access scope, expire or delete with source/consent/account lifecycle, and never override source-domain facts.
- All sensitive records have classification, purpose, retention category, access policy, and audit requirement.

## Deletion and retention flow

USERS coordinates account deletion request, checks legal/financial/safety holds supplied by owners, removes consumer access, emits lifecycle event, and drives anonymization/deletion tasks. Other domains delete or irreversibly de-identify data they own unless defined retention exception applies. Financial, fraud, and audit records retain minimum lawful evidence with access restriction; they never keep a live profile available. See [account deletion](../flows/account-deletion.md).

## Concurrency and security

Use immutable IDs, record versioning where conflicting edits matter, and transactional outbox for lifecycle events. Do not replicate raw verification documents, secrets, or payment credentials; retain token/reference and access through owning service only. AI PLATFORM has no direct private-store access; authorized context comes through owner contracts.

## Phase/open questions

V1 classification, ownership register, deletion signaling. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: final data residency, retention durations, legal-hold rules by launch jurisdiction. Cross-reference [domain boundaries](03-domain-boundaries.md), [AI context/memory/RAG](../ai/03-ai-context-memory-rag.md), [privacy/retention](../security/03-privacy-retention.md), [data residency](../compliance/05-data-residency-retention.md), [migrations](../engineering/02-data-migrations.md).

## Implemented growth and retention seams

The tables this phase adds all grow monotonically and none of them depends on deletion for correctness.

- `messaging_outbox` and `discovery_outbox` grow with published facts. Dispatched rows stay, so the claim index is partial on `state = 'pending'` and its size tracks the backlog rather than the history. A retention pass may delete `dispatched` rows older than an approved duration; nothing reads them.
- `notifications_intents` grows with owed notices and keeps every terminal one, including `dead_letter`, which is the durable evidence that something was owed and not delivered. Its due index is partial on the two non-terminal states, so delivered history stays out of the hot path.
- `notifications_attempts` is append-only evidence of what was tried, bounded per notice by the retry budget.
- `notifications_feed` grows with what a person has been shown. Its only read is one recipient's newest page, served by `(recipient_id, created_at, id)`.

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: retention durations for all four. No duration is invented here, and because no rule depends on a row being physically gone, an approved one can be applied later as a deletion pass without changing behaviour.
