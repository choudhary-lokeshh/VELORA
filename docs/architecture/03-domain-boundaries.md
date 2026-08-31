# Domain boundaries

## Authority

This document assigns durable domain ownership. Owning module validates state, writes its records, emits its events, and exposes services/contracts. Another domain may reference opaque IDs, subscribe to published events, or call approved service contracts; it may not access internals directly.

| Domain | Owns | Must not own |
|---|---|---|
| AUTH | credentials, sessions, authentication factors | profile, roles, payment state |
| USERS | account basics, consumer profile, preferences | login/session, discovery ranking |
| IDENTITY ASSURANCE | verification subjects, attempts, normalized assurance evidence, provider-event inbox, reconciliation, minimized evidence lifecycle facts | authentication/session, self-declaration, consent, product eligibility, enforcement, payment/payout authorization, raw documents/biometrics |
| DISCOVERY | candidates, eligibility, introduction logic | messages, payments, creator entitlements |
| LIVE | random matching pool membership and presence, live encounters and their lifecycle, in-encounter ephemeral chat | authentication, account standing, the communication relationship, blocks/enforcement, call sessions, durable conversations, presence projections, stored media, recordings |
| MESSAGING | conversations, messages, delivery state | presence, moderation decisions |
| REALTIME | RTC session records, participants and their invitation/acceptance state, call lifecycle and authorization generation, provider session references, verified provider-event receipts, revocation and teardown obligations, reconciliation findings | authentication, account standing, the communication relationship, blocks/enforcement, durable notification delivery, message/content records, stored media, recordings, presence projections |
| CREATORS | creator identity/business profile | club membership, payments/payout ledger |
| PRIVATE CLUBS | club membership, content catalog, entitlement | provider charge truth, creator identity proof |
| MEDIA | binary/object lifecycle, upload sessions, byte-derived technical facts, derivatives and processing versions, provider deletion and cache-purge state | which image a product surface uses, publication intent, entitlement, safety decisions, evidence retention |
| BILLING | payment intents, charges, refunds, platform subscription state | payout disbursement, content access decision rules |
| PAYOUTS | payable balance, payout lifecycle, disbursement records | charging customers |
| TRUST & SAFETY | reports, blocks, enforcement policy execution | moderator work queues/tooling implementation |
| MODERATION | review cases, evidence handling, decisions workflow | enforcement policy truth |
| NOTIFICATIONS | delivery orchestration, preferences, delivery attempts | source-domain state |
| ADMIN | privileged workflows, approvals, operation UI/API | core domain source-of-truth data |
| ANALYTICS | event definitions, derived metrics | transactional product state |
| AI PLATFORM | AI capability/prompt/tool registry metadata, provider/model routing, orchestration runs, ephemeral context, non-authoritative memory/RAG projections, AI budgets/evaluations | any other domain's truth, authorization, approval, private persistence, or analytics metric definitions |

## Cross-domain protocol

Command only through service contract when caller needs validated synchronous result. Event only for durable fact after owner commits transaction. Consumers must dedupe events and tolerate delayed/out-of-order delivery. Contract has version, actor context where needed, correlation ID, and clear data classification.

## Important separation

Blocks/enforcement from Trust & Safety constrain Discovery, Messaging, Realtime, Clubs, and Notifications through published eligibility/authorization contracts. Private Clubs decides content entitlement; Billing reports financial status; neither makes Discovery candidates. Admin invokes domain operations with a privileged actor and audit reason; no direct table mutation.

MEDIA owns bytes and nothing a binary means. Users, Creators, and Private Clubs hold opaque media asset references and keep their own association, ordering, and publication intent; Trust & Safety keeps every safety and takedown decision. MEDIA answers what an object is, whether it is technically processable, which derivatives exist, and whether the provider still holds it — and that answer is never publication. A takedown reaches bytes because Safety records a decision and MEDIA carries a durable purge obligation, not because either domain writes the other's rows. See [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md).

AI PLATFORM is never source of truth for AUTH, USERS, DISCOVERY, MESSAGING, REALTIME, CREATORS, PRIVATE CLUBS, BILLING, PAYOUTS, TRUST & SAFETY, MODERATION, NOTIFICATIONS, ADMIN, or ANALYTICS. It accesses domain capabilities only through published, registered contracts/tools and never directly mutates private domain persistence. Model output is a proposal or derived artifact; owning domain re-authorizes and validates every effect. High-impact operations retain deterministic authorization and human approval/workflow rules.

LIVE owns who is waiting to meet somebody at random, which two people were put together, and what they typed while they were together. It owns none of the facts an encounter depends on: USERS owns admission and standing, DISCOVERY owns whether two people are introduced, TRUST & SAFETY owns blocks and enforcement, REALTIME owns the call session carrying the encounter, and MESSAGING owns the durable conversation a mutual connection authorizes. It publishes exactly two facts back — that a pair is in a live encounter, and that a pair met live recently — and both are booleans. Connect is DISCOVERY's introduction rather than a second relationship model, so a person met live and a person met in Discover are the same kind of connection in the same Inbox. In-encounter chat is LIVE's and never becomes a conversation. No count of who is waiting or who is online is published anywhere, because no presence projection exists. See [ADR-0040](../decisions/ADR-0040-random-live-discovery.md).

REALTIME owns a call's lifecycle and none of the facts a call depends on. Whether two people may talk is composed at the moment of every action from AUTH's principal, USERS' account standing, DISCOVERY's mutual-introduction contract, and TRUST & SAFETY's block and enforcement contracts; REALTIME re-derives none of them and caches no answer. A provider is authoritative about media and unaware of safety, so a verified provider event may update what the platform observes about a call and may never create a participant, grant permission, extend a credential, reverse a platform end, or override a safety decision. RTC stores no media, which is why MEDIA is uninvolved: MEDIA owns bytes, and a call produces none. Since ADR-0040 a session also carries a purpose, and eligibility is composed against the relationship it was created under: an `introduced` session against DISCOVERY's mutual introduction, a `live_discovery` session against LIVE's current encounter, with safety, standing, and enforcement asked identically for both. See [ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md) and [ADR-0040](../decisions/ADR-0040-random-live-discovery.md).

IDENTITY ASSURANCE is not a second authentication system and is never product authorization. AUTH owns principals/sessions; USERS owns self-declared adult status; CREATORS owns creator lifecycle; TRUST & SAFETY owns depicted-person relationship/consent and enforcement; BILLING/PAYOUTS own money and payout decisions. IDENTITY supplies current append-only evidence through published contracts, and every owner re-authorizes and recomputes its own predicate. It never reads or mutates another domain's private persistence. See [ADR-0024](../decisions/ADR-0024-identity-assurance-architecture.md).

## Security, concurrency, phase

Owner performs object authorization. Cross-domain cached projections are non-authoritative and revocable. Each state transition uses expected version/transactional guard as needed. V1 establishes all boundaries; later phases add modules only with ownership table update and ADR when architecture changes.

## Open questions and cross-references

Event transport uses PostgreSQL transactional outbox/inbox plus BullMQ execution under [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). Owner state and outbox facts remain PostgreSQL truth; Redis queue delivery cannot define business completion. An external broker is deferred until measured scale requires it. See [contracts/events](04-contracts-events.md), [data ownership](05-data-ownership.md), [IDENTITY ASSURANCE](../domains/identity-assurance.md), [AI platform](../ai/01-ai-platform-architecture.md), [jobs/idempotency](../engineering/03-jobs-idempotency-concurrency.md), and each `docs/domains/` specification.
