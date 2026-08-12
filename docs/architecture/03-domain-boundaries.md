# Domain boundaries

## Authority

This document assigns durable domain ownership. Owning module validates state, writes its records, emits its events, and exposes services/contracts. Another domain may reference opaque IDs, subscribe to published events, or call approved service contracts; it may not access internals directly.

| Domain | Owns | Must not own |
|---|---|---|
| AUTH | credentials, sessions, authentication factors | profile, roles, payment state |
| USERS | account basics, consumer profile, preferences | login/session, discovery ranking |
| DISCOVERY | candidates, eligibility, introduction logic | messages, payments, creator entitlements |
| MESSAGING | conversations, messages, delivery state | presence, moderation decisions |
| REALTIME | presence, room/call orchestration, RTC lifecycle | long-term message/content records |
| CREATORS | creator identity/business profile | club membership, payments/payout ledger |
| PRIVATE CLUBS | club membership, content catalog, entitlement | provider charge truth, creator identity proof |
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

AI PLATFORM is never source of truth for AUTH, USERS, DISCOVERY, MESSAGING, REALTIME, CREATORS, PRIVATE CLUBS, BILLING, PAYOUTS, TRUST & SAFETY, MODERATION, NOTIFICATIONS, ADMIN, or ANALYTICS. It accesses domain capabilities only through published, registered contracts/tools and never directly mutates private domain persistence. Model output is a proposal or derived artifact; owning domain re-authorizes and validates every effect. High-impact operations retain deterministic authorization and human approval/workflow rules.

## Security, concurrency, phase

Owner performs object authorization. Cross-domain cached projections are non-authoritative and revocable. Each state transition uses expected version/transactional guard as needed. V1 establishes all boundaries; later phases add modules only with ownership table update and ADR when architecture changes.

## Open questions and cross-references

Event transport uses the PostgreSQL transactional outbox/inbox and pg-boss baseline from [ADR-0007](../decisions/ADR-0007-cache-jobs-events.md); an external broker is deferred until measured scale requires it. See [contracts/events](04-contracts-events.md), [data ownership](05-data-ownership.md), [AI platform](../ai/01-ai-platform-architecture.md), [jobs/idempotency](../engineering/03-jobs-idempotency-concurrency.md), and each `docs/domains/` specification.
