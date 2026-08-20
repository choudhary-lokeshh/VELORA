# Data ownership and lifecycle

## Purpose

Define source-of-truth, references, and lifecycle coordination. Detailed domain models belong in `docs/domains/`; privacy/retention authority is [privacy and retention](../security/03-privacy-retention.md).

## Rules

- One record class has one writing domain. Foreign references use stable IDs, never copied mutable authorization state as truth.
- AUTH owns authentication identity, its `auth_`-prefixed tables, and its own security events; USERS owns the consumer account, profile, self-declared adult status, and its `users_`-prefixed tables; IDENTITY ASSURANCE owns verified assurance subjects/attempts/evidence/provider receipts/reconciliation under `identity_`, linked to owner domains by opaque references only; CREATORS owns creator business identity and its `creators_`-prefixed tables, linked to AUTH by an opaque account identifier alone; PRIVATE CLUBS owns the creator content catalog, club membership, and entitlement under its `clubs_`-prefixed tables, referencing a creator by opaque identifier alone; BILLING owns customer money state; PAYOUTS owns disbursement state; Trust & Safety owns block/enforcement, depicted-person relationship, and consent state.
- A table prefix names its owning domain, and integration tests assert that a domain's migration creates only tables under its own prefix. A cross-domain reference is the other domain's identifier column with no database foreign key: a key would make one domain's deletion policy silently execute inside another domain's records, which the deletion flow below assigns to USERS to coordinate explicitly. Uniqueness and shape constraints on the reference still belong to the referencing domain and are enforced there.
- REALTIME owns call sessions and participation under `realtime_`, referencing consumer accounts and the introduction that authorized a call by opaque identifier alone. It owns no relationship, standing, block, or enforcement, and stores no answer derived from one: there is deliberately no `eligible` column, because a stored answer is a decision taken at an earlier time being applied at this one. It stores nothing about the call itself either — no media, recording, transcript, SDP, ICE candidate, TURN credential, reusable join credential, or participant address has a column, and a test enumerates every column and asserts it. What is durable is lifecycle: who invited whom, under which relationship, at which times, in which state, and why it ended.
- A transactional outbox is owned by the domain that produces the fact and lives under that domain's prefix, because the fact and the state it describes must commit in one transaction. `messaging_outbox` is MESSAGING's; NOTIFICATIONS never reads it, and the relay that drains it publishes to consumers rather than granting anybody access to the table. Notification intents and attempts are NOTIFICATIONS' own truth under `notifications_`, and a queue entry is never truth for either.
- Derived search, feeds, analytics, and notification projections are disposable/rebuildable. They minimize sensitive fields and honor revocations/deletion events.
- AI short-term context, consent-based memory, embeddings, and RAG indexes are non-authoritative derived data. They retain provenance/access scope, expire or delete with source/consent/account lifecycle, and never override source-domain facts.
- Identity evidence is append-only owner data, not a cached authorization projection. Owner domains may retain only opaque Identity references or a compatibility projection explicitly derived through the contract; they never copy raw provider facts or store a master eligibility boolean. Queue state and provider dashboards are not evidence truth.
- All sensitive records have classification, purpose, retention category, access policy, and audit requirement.

## Deletion and retention flow

USERS coordinates account deletion request, checks legal/financial/safety holds supplied by owners, removes consumer access, emits lifecycle event, and drives anonymization/deletion tasks. Other domains delete or irreversibly de-identify data they own unless defined retention exception applies. Financial, fraud, and audit records retain minimum lawful evidence with access restriction; they never keep a live profile available. See [account deletion](../flows/account-deletion.md).

## Concurrency and security

Use immutable IDs, record versioning where conflicting edits matter, and transactional outbox for lifecycle events. Do not replicate raw verification documents, exact birth dates, names/addresses collected for verification, selfies/video, biometric templates, tax/bank identifiers, secrets, or payment credentials; retain minimum normalized evidence and opaque provider references through the owning service only. AI PLATFORM has no direct private-store access; authorized context comes through owner contracts.

## Phase/open questions

V1 classification, ownership register, deletion signaling. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: final data residency, retention durations, legal-hold rules by launch jurisdiction. Cross-reference [domain boundaries](03-domain-boundaries.md), [AI context/memory/RAG](../ai/03-ai-context-memory-rag.md), [privacy/retention](../security/03-privacy-retention.md), [data residency](../compliance/05-data-residency-retention.md), [migrations](../engineering/02-data-migrations.md).

## Implemented growth and retention seams

The tables this phase adds all grow monotonically and none of them depends on deletion for correctness.

- `messaging_outbox` and `discovery_outbox` grow with published facts. Dispatched rows stay, so the claim index is partial on `state = 'pending'` and its size tracks the backlog rather than the history. A retention pass may delete `dispatched` rows older than an approved duration; nothing reads them.
- `notifications_intents` grows with owed notices and keeps every terminal one, including `dead_letter`, which is the durable evidence that something was owed and not delivered. Its due index is partial on the two non-terminal states, so delivered history stays out of the hot path.
- `notifications_attempts` is append-only evidence of what was tried, bounded per notice by the retry budget.
- `notifications_feed` grows with what a person has been shown. Its only read is one recipient's newest page, served by `(recipient_id, created_at, id)`.

The creator tables grow the same way and none of them depends on deletion for correctness either.

- `creators_accounts` grows with people who asked for the capability. Two indexes: the unique one per principal that makes onboarding idempotent, and `(created_at, id)` for the operator list. The second was added after measuring — on twenty thousand rows the planner otherwise scanned the table and sorted it, which is 2 ms and 267 buffers there and a table scan at any size.
- `creators_profiles` is one row per capability, addressed by a unique handle.
- `clubs_content` grows with what creators write. Its published index is partial, so a creator with a long history of drafts still answers the public catalog from an index the size of what is public, ordered exactly the way the catalog pages so no sort is needed.
- `clubs_memberships` keeps revoked rows as evidence and permits one live entitlement per person per club through a partial unique index, so revoking frees the slot without destroying the record.
- `clubs_invites` keeps redeemed and revoked invitations, which is what makes "was this ever used, and by whom" answerable months later.

The RTC tables grow the same way, and the one thing they bound is liveness rather than history.

- `realtime_sessions` grows with calls placed. A pair may have many over time — a call is an event, not a relationship — so the uniqueness that matters is scoped to the live ones: a partial unique index over the ordered pair where the state is not terminal, which is simultaneously what makes an invitation idempotent, what stops a second call opening beside a live one, and what makes two people calling each other at the same instant produce one call. The two per-person indexes and the invitation-deadline index are partial on the same predicate, so a person's finished call history never enters the plan for a question about their live call or for the sweep that expires invitations.
- `realtime_participants` is two rows per session, held to exactly that by a unique index per membership and a unique index per role. A call with one participant, three participants, or the same person twice cannot be recorded.

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: retention durations for all of the above. No duration is invented here, and because no rule depends on a row being physically gone, an approved one can be applied later as a deletion pass without changing behaviour.
