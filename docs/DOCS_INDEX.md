# Velora documentation index

## Reading and authority rule

Read this index and [AGENTS](../AGENTS.md) before implementation, design handoff, provider integration, or technical ADR work. Follow the relevant reading path below. If documents conflict, use this precedence and update the lower authority before work continues:

1. [Product phases](product/01-product-phases.md) for feature timing and gating classification.
2. [Domain boundaries](architecture/03-domain-boundaries.md) and owning domain document for source-of-truth, authorization, and state.
3. Named flow for cross-domain lifecycle and failure/concurrency behavior.
4. Surface document for client responsibility and platform UX.
5. Security, compliance, and operations authorities for stricter controls.
6. Accepted ADRs and the technical stack matrix for implementation mechanisms; they cannot override product/domain/flow/security/compliance authority.
7. Approved Figma for visual/interaction specification only; it cannot override product/domain/security/compliance authority.

If a choice is `DEFER UNTIL PROVIDER INTEGRATION`, `DEFER UNTIL SCALE REQUIRES`, `DECISION REQUIRED BEFORE FEATURE`, `LEGAL REVIEW REQUIRED`, or `DESIGN REQUIRED`, do not replace it with an assumption. Each row names one primary authority; cross-references add constraints, not competing ownership.

## System and product authority

| Document | Primary authority |
|---|---|
| [Repository README](../README.md) | Repository purpose, bootstrap state, and local entry point |
| [System overview](architecture/01-system-overview.md) | Ecosystem relationship and shared backend direction |
| [Repository shape](architecture/02-repository-shape.md) | Apps/packages layout and dependency direction |
| [Domain boundaries](architecture/03-domain-boundaries.md) | Durable domain ownership and forbidden coupling |
| [Contracts and events](architecture/04-contracts-events.md) | Cross-domain contract/version/delivery semantics |
| [Data ownership](architecture/05-data-ownership.md) | Record ownership, derived data, deletion coordination |
| [Provider adapters](architecture/06-provider-adapters.md) | Vendor-neutral ports, normalized adapters, mock/test rule |
| [Scale and resilience](architecture/07-scale-and-resilience.md) | Scaling, failure containment, recoverability direction |
| [AI integration boundary](architecture/08-ai-platform.md) | How isolated AI PLATFORM fits overall architecture; dedicated AI section owns AI details |
| [Technical stack](architecture/09-technical-stack.md) | Concise locked stack, dependency map, initial topology, classifications, and replacement boundaries |
| [Money flow](architecture/10-money-flow.md) | End-to-end map of commercial, entitlement, earnings, payout, and reversal paths and the boundaries between them |
| [Monetization freeze report](architecture/11-monetization-freeze-report.md) | What the money architecture froze with, what still blocks live money movement, and what unfreezes it |
| [Trust and safety freeze report](architecture/12-trust-safety-freeze-report.md) | What the safety and mature-content architecture froze with, what still blocks production enforcement and mature content, and what unfreezes it |
| [Media freeze report](architecture/13-media-freeze-report.md) | What the media platform froze with, what still blocks live production media, and what unfreezes it |
| [Product phases](product/01-product-phases.md) | Only authority for feature phase classification |
| [Consumer product](product/02-consumer-product.md) | Consumer product scope and shared Web/Mobile behavior |
| [Creator Private Clubs](product/03-creator-private-clubs.md) | Creator/club product boundary and conditional content |
| [Platform Admin product](product/04-platform-admin.md) | Admin product scope, roles, and privilege constraints |
| [Monetisation](product/05-monetisation.md) | Commercial product catalogue and user-protection boundary |

## Product surface authority

| Surface | Primary authority | Scope |
|---|---|---|
| Consumer Web | [Consumer Web](surfaces/01-consumer-web.md) | Browser navigation/screens, responsive Web, deep links, entry states |
| Consumer Mobile | [Consumer Mobile](surfaces/02-consumer-mobile.md) | Native/mobile navigation, device permissions, push/deep links, offline states |
| Creator Studio | [Creator Studio](surfaces/03-creator-studio.md) | Web-first creator workspace, club/content/finance status UX |
| Platform Admin | [Platform Admin](surfaces/04-platform-admin.md) | Privileged console, dense workflows, approval and health UX |

These are one ecosystem, not four independent products. Surface documents never own backend authorization or business truth.

## Domain authority

| Domain | Primary authority | Required companion reading |
|---|---|---|
| AUTH | [AUTH](domains/auth.md) | onboarding, RBAC, adult verification |
| IDENTITY ASSURANCE | [Identity Assurance](domains/identity-assurance.md) | identity verification flow/threat model/provider eligibility/operations, ADR-0024, each evidence-consuming owner |
| USERS | [USERS](domains/users.md) | account/profile flow, privacy, deletion |
| DISCOVERY | [DISCOVERY](domains/discovery.md) | discovery/introduction flow, Trust & Safety, consumer product |
| MESSAGING | [MESSAGING](domains/messaging.md) | messaging/blocks flow, media security, notifications |
| REALTIME | [REALTIME](domains/realtime.md) | RTC flow, provider adapters, Trust & Safety |
| CREATORS | [CREATORS](domains/creators.md) | creator lifecycle, Creator Studio, creator compliance |
| PRIVATE CLUBS | [PRIVATE CLUBS](domains/private-clubs.md) | creator product, entitlement, media, content gates |
| MEDIA | [MEDIA](domains/media.md) | media upload/delivery security, media threat model, media provider eligibility, ADR-0010, ADR-0023 |
| BILLING | [BILLING](domains/billing.md) | monetisation, payment flow/security, finance operations |
| PAYOUTS | [PAYOUTS](domains/payouts.md) | payout compliance, finance operations, BILLING/CREATORS |
| TRUST & SAFETY | [TRUST & SAFETY](domains/trust-safety.md) | report/enforcement, MODERATION, safety operations |
| MODERATION | [MODERATION](domains/moderation.md) | moderation operations, report flow, evidence/privacy |
| NOTIFICATIONS | [NOTIFICATIONS](domains/notifications.md) | notification flow, privacy, provider adapters |
| ADMIN | [ADMIN](domains/admin.md) | Admin surface/product, RBAC, Admin operation flow |
| ANALYTICS | [ANALYTICS](domains/analytics.md) | privacy, observability, metric governance |
| AI PLATFORM | [AI platform architecture](ai/01-ai-platform-architecture.md) | all documents in AI authority path plus each affected domain |

For any Identity Assurance or verification work, read the Identity Assurance domain, identity verification flow, identity threat model, identity provider eligibility, identity operations, ADR-0024, product phases, AUTH, and every domain whose predicate consumes the evidence. Provider integration additionally requires provider adapters, privacy/retention, outbound networking, jobs/idempotency, observability, and open decisions. No client or consuming domain owns verification evidence.

## AI authority

Read all six documents for any AI-related work:

| Document | Primary authority |
|---|---|
| [AI platform architecture](ai/01-ai-platform-architecture.md) | Gateway, Orchestrator, provider/model routing, prompt/output versions, async AI |
| [AI capabilities and tools](ai/02-ai-capabilities-tools.md) | Capability/tool registry, strict authorization, effects, human approval |
| [AI context, memory, and RAG](ai/03-ai-context-memory-rag.md) | Context isolation, short-term context, durable memory, platform knowledge/RAG |
| [AI safety and security](ai/04-ai-safety-security.md) | Injection, malicious content, tool abuse, SSRF retrieval, PII, output safety |
| [AI observability, budgets, and evaluations](ai/05-ai-observability-budgets-evals.md) | Tracing, cost/latency/failure, quotas, evaluations, regression, portability |
| [AI product surfaces](ai/06-ai-product-surfaces.md) | Consumer, creator, moderation/safety, and Admin AI roles and prohibitions |

Also read [AI-assisted action](flows/ai-assisted-action.md), [AI security integration](security/07-ai-safety-privacy.md), [AI engineering integration](engineering/06-ai-evaluation-observability.md), [ADR-0002](decisions/ADR-0002-isolated-ai-platform.md), product phase, provider, outbound-networking, jobs, RBAC, and every tool-owning domain authority.

## Flow, security, and lifecycle authority

| Document | Primary authority |
|---|---|
| [Onboarding](flows/onboarding.md) | Adult signup/sign-in/session-to-profile admission |
| [Identity assurance verification](flows/identity-assurance-verification.md) | Provider-neutral start, callback, evidence, expiry/revocation, reconciliation, and owner consumption |
| [Consumer account/profile](flows/consumer-account-profile.md) | Profile, verification, availability, restriction, account lifecycle |
| [Discovery and introductions](flows/discovery-introductions.md) | Candidate, signal, decline/withdraw, mutual introduction |
| [Messaging and blocks](flows/messaging-and-blocks.md) | Conversation/message authorization and block precedence |
| [Notification delivery](flows/notification-delivery.md) | Template/preference/channel, delivery, deep-link and failure lifecycle |
| [RTC lifecycle](flows/rtc-lifecycle.md) | Invitation, accept/decline/timeout, call/reconnect/termination/safety |
| [Creator lifecycle/content](flows/creator-lifecycle-content.md) | Application, verification, activation, club/content, suspension/appeal |
| [Creator entitlement](flows/creator-entitlement.md) | Subscription/PPV access and private media delivery authorization |
| [Payment lifecycle](flows/payment-lifecycle.md) | Intent, pending, webhook, entitlement, finalization, refund/dispute/reconciliation |
| [Report to enforcement](flows/report-to-enforcement.md) | Report, evidence, review, enforcement, emergency/appeal |
| [Account deletion](flows/account-deletion.md) | Deactivation, erasure, holds, domain deletion propagation |
| [Admin operations](flows/admin-operations.md) | Privileged request, approval, execution, emergency and audit |
| [AI-assisted action](flows/ai-assisted-action.md) | Model proposal, tool policy, human approval, owner execution |
| [Security baseline](security/01-security-baseline.md) | Cross-cutting minimum application security |
| [RBAC and access control](security/02-access-control-rbac.md) | Actor/role/object/scope authorization and privileged assurance |
| [Privacy and retention](security/03-privacy-retention.md) | Classification, minimization, retention, rights, deletion/export |
| [Media upload and delivery](security/04-media-upload-delivery.md) | Quarantine, scanning, publication and signed/private delivery |
| [Payments and webhooks](security/05-payments-webhooks.md) | Signature, replay, idempotency and payment-data protection |
| [Abuse and outbound networking](security/06-abuse-outbound-networking.md) | Abuse limits and SSRF-safe network boundary |
| [AI security integration](security/07-ai-safety-privacy.md) | Integration pointer binding dedicated AI controls to security baseline |
| [Dependency risk acceptance](security/08-dependency-risk-acceptance.md) | Temporarily accepted supply-chain advisories, their bounds, and the CI gate contract |
| [Dependency age blockers](security/09-dependency-age-blockers.md) | Upgrades a gate requires that the minimum release age forbids, when each becomes installable, and any owner-authorized exact-version override that cleared one early |
| [Media threat model](security/10-media-threat-model.md) | The adversary the media platform is built against: upload, storage, inspection, processing, delivery, takedown, and reconciliation threats and their controls |
| [Identity verification threat model](security/11-identity-verification-threat-model.md) | Provider callbacks, hosted-session, replay, subject binding, privacy, stale evidence, and operator threats and controls |

## Design and Figma authority

| Document | Primary authority |
|---|---|
| [Design principles](design/01-design-principles.md) | Brand/product character and design criteria |
| [Design-system contract](design/02-design-system-contract.md) | Token/component/handoff contract |
| [Figma source of truth](design/03-figma-source-of-truth.md) | Approved visual/interaction authority and precedence |
| [Responsive/platform rules](design/04-responsive-platform-rules.md) | Mobile/tablet/desktop/wide and surface differences |
| [Accessibility and motion](design/05-accessibility-motion.md) | Inclusive interaction and motion requirements |
| [Screen-state requirements](design/06-screen-state-requirements.md) | Required component/screen/data lifecycle states |

## Compliance authority

These are architecture/product gates, not legal advice:

| Document | Primary authority |
|---|---|
| [Market entry gates](compliance/01-market-entry-gates.md) | Country/channel capability enablement and revocation |
| [Adult age verification](compliance/02-adult-age-verification.md) | Adult/age assurance separation and verification lifecycle |
| [Creator/content gates](compliance/03-creator-content-gates.md) | Creator eligibility, content publication, mature-content gates |
| [Payments/tax/payout gates](compliance/04-payments-tax-payout-gates.md) | Commercial and creator-finance country/provider prerequisites |
| [Data residency/retention](compliance/05-data-residency-retention.md) | Data mapping, region/provider routing, retention/deletion gates |
| [Provider eligibility](compliance/06-payment-provider-eligibility.md) | Dated primary-source findings on payment/payout provider and card-network eligibility for Velora's business model |
| [Surface and distribution eligibility](compliance/07-surface-and-distribution-eligibility.md) | Dated primary-source findings on app-store, age-assurance, depicted-person, and notice/appeal requirements deciding which surfaces may carry which content |
| [Media provider eligibility](compliance/08-media-provider-eligibility.md) | Dated primary-source findings on object-storage, CDN, image-processing, and scanning provider eligibility, and the delivery-capability facts that bound what revocation may claim |
| [Identity verification provider eligibility](compliance/09-identity-verification-provider-eligibility.md) | Dated official-source findings and production-eligibility gaps for identity/age/KYC providers; silence is unapproved |

## Operations authority

| Document | Primary authority |
|---|---|
| [Support operations](operations/01-support-operations.md) | Support intake, scope, escalation, and customer communication |
| [Moderation operations](operations/02-moderation-operations.md) | Human review, evidence, decisions, appeal, quality/wellness |
| [Finance/payout operations](operations/03-finance-payout-operations.md) | Refund, dispute, reconciliation, hold and payout operations |
| [Incident response](operations/04-incident-response.md) | Incident lifecycle, emergency authority, evidence and recovery |
| [Platform health](operations/05-platform-health.md) | Health signals, degraded behavior, SLO/capacity direction |
| [Media operations](operations/06-media-operations.md) | What each media backlog class means, what an operator may do about it, and what is deliberately not offered |
| [Identity verification operations](operations/07-identity-verification-operations.md) | Privacy-minimized monitoring, callback backlog, reconciliation, expiry, incidents, and prohibited manual overrides |

## Engineering and decision authority

| Document | Primary authority |
|---|---|
| [API contracts](engineering/01-api-contracts.md) | Endpoint/command semantics, errors, compatibility, contract tests |
| [Data and migrations](engineering/02-data-migrations.md) | Domain-owned schemas, constraints, rollout/backfill discipline |
| [Jobs/idempotency/concurrency](engineering/03-jobs-idempotency-concurrency.md) | Durable work, claims, retry, deduplication and races |
| [Observability](engineering/04-observability.md) | Logs/metrics/traces and audit separation |
| [Testing and release](engineering/05-testing-release.md) | Test layers, design/security/flow release evidence, rollout/rollback |
| [AI engineering integration](engineering/06-ai-evaluation-observability.md) | Integration pointer to dedicated AI evaluation authority |
| [Open decisions](decisions/DECISIONS_REQUIRED.md) | Unresolved technical/product/provider/design/legal decisions and deadlines |
| [ADR-0001](decisions/ADR-0001-documentation-first.md) | Documentation-first, domain-boundary decision |
| [ADR-0002](decisions/ADR-0002-isolated-ai-platform.md) | Accepted isolated/provider-neutral AI boundary |
| [ADR-0003](decisions/ADR-0003-monorepo-runtime-language.md) | pnpm/Turborepo, Node client/tooling runtime, TypeScript, dependency strategy; backend-runtime portion superseded by ADR-0016 |
| [ADR-0004](decisions/ADR-0004-client-frameworks.md) | Next.js Web surfaces and React Native/Expo Mobile |
| [ADR-0005](decisions/ADR-0005-backend-api-architecture.md) | Historical NestJS/Fastify choice superseded by ADR-0016; modular monolith and REST/OpenAPI contracts remain |
| [ADR-0006](decisions/ADR-0006-database-data-access-migrations.md) | PostgreSQL, Drizzle, constraints, and migrations |
| [ADR-0007](decisions/ADR-0007-cache-jobs-events.md) | Historical Valkey/pg-boss choice superseded by ADR-0016; outbox/inbox and durable workflow state remain |
| [ADR-0008](decisions/ADR-0008-realtime-rtc.md) | Socket.IO realtime and provider-neutral WebRTC boundary |
| [ADR-0009](decisions/ADR-0009-auth-authorization.md) | Shared authentication/session architecture, owner authorization, approvals; exact policy values locked by ADR-0017 |
| [ADR-0010](decisions/ADR-0010-media-storage-delivery.md) | Private object storage, media processing, and signed delivery |
| [ADR-0011](decisions/ADR-0011-payments-payouts.md) | BILLING/PAYOUTS separation, journals, idempotency, reconciliation |
| [ADR-0012](decisions/ADR-0012-ai-platform-runtime.md) | AI Gateway/orchestrator runtime, durable runs, provider/tool portability |
| [ADR-0013](decisions/ADR-0013-observability-testing.md) | OpenTelemetry/Pino/audit and test frameworks |
| [ADR-0014](decisions/ADR-0014-deployment-environments-cicd.md) | OCI/OpenTofu deployment, config/flags, egress, environments, CI/CD |
| [ADR-0015](decisions/ADR-0015-shared-design-token-boundary.md) | Shared client-safe design-token package and visual-authority boundary |
| [ADR-0016](decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md) | Active Bun/Elysia/PostgreSQL/Drizzle/Redis/BullMQ backend foundation and prior-decision supersession |
| [ADR-0017](decisions/ADR-0017-auth-session-recovery-security-policy.md) | Exact session, recovery, privileged-access, and break-glass policy values inside ADR-0009 architecture |
| [ADR-0018](decisions/ADR-0018-toolchain-provisioning-verification-ci.md) | mise toolchain provisioning, four-source pin agreement, and the GitHub Actions verification pipeline |
| [ADR-0019](decisions/ADR-0019-database-connection-admission.md) | Bounded database admission, pool warm-up, and the capacity refusal contract; resolves the pair-lock contention decision |
| [ADR-0020](decisions/ADR-0020-creator-capability-activation.md) | Creator capability lifecycle, its activation gates, and identity verification as a separate predicate |
| [ADR-0021](decisions/ADR-0021-monetization-money-architecture.md) | How ADR-0011's locked money decisions become code: money value type, two owner journals, orchestration ordering, webhook inbox, entitlement bridge, fail-closed capability configuration |
| [ADR-0022](decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) | One safety policy and eligibility authority, scoped append-only enforcement with supersession, report/case/evidence/decision/appeal separation, surface as a first-class closed vocabulary, depicted-person consent by reference, versioned deadline policy, and fail-closed mature-content enablement |
| [ADR-0023](decisions/ADR-0023-media-platform-architecture.md) | MEDIA as a domain owning bytes only, a technical lifecycle disjoint from publication, opaque server-generated keys, capability-bound direct upload, byte-derived inspection ahead of the decoder, in-process image processing, the bounded private-delivery revocation window, four distinct removal concepts, and fail-closed media configuration |
| [ADR-0024](decisions/ADR-0024-identity-assurance-architecture.md) | Separate Identity Assurance domain, append-only evidence, provider-neutral hosted verification, verified callback inbox, reconciliation, fail-closed jurisdiction policy, and owner re-authorization |

## Technical implementation reading paths

Every implementation path starts with [AGENTS](../AGENTS.md), [technical stack](architecture/09-technical-stack.md), [product phases](product/01-product-phases.md), the owning surface/domain/flow, and relevant security/compliance authority.

- Backend foundation: repository shape, domain boundaries, contracts/events, data ownership, ADR-0016, then unaffected portions of ADR-0003, ADR-0005, ADR-0006, ADR-0007, ADR-0009, ADR-0013, and ADR-0014.
- Consumer Web bootstrap: Consumer Web surface, Design/Figma authority, ADR-0016, unaffected portions of ADR-0003, ADR-0004, ADR-0005, ADR-0009, ADR-0013, ADR-0014, ADR-0015.
- Consumer Mobile bootstrap: Consumer Mobile surface, notification/deep-link authority, Design/Figma authority, ADR-0016, unaffected portions of ADR-0003, ADR-0004, ADR-0005, ADR-0009, ADR-0013, ADR-0014, ADR-0015.
- Creator Studio bootstrap: Creator Studio surface, creator/club domains and flows, Design/Figma authority, ADR-0016, ADR-0020, unaffected portions of ADR-0003, ADR-0004, ADR-0005, ADR-0009, ADR-0010, ADR-0013, ADR-0014, ADR-0015.
- Platform Admin bootstrap: Platform Admin surface/domain/flow, RBAC, operations authority, Design/Figma authority, ADR-0016, unaffected portions of ADR-0003, ADR-0004, ADR-0005, ADR-0009, ADR-0013, ADR-0014, ADR-0015.
- Database and migrations: data ownership, data/migrations, jobs/concurrency, ADR-0016, ADR-0019, unaffected portions of ADR-0006 and ADR-0007, affected domain/flow.
- Jobs and events: contracts/events, jobs/idempotency, scale/resilience, ADR-0016, ADR-0019, unaffected portions of ADR-0007, observability/testing, affected domain/flow.
- Realtime and RTC: REALTIME, RTC flow, provider adapters, Trust & Safety, ADR-0007, ADR-0008, ADR-0009, ADR-0013, ADR-0014.
- Media/storage: MEDIA, media upload/delivery security, media threat model, media provider eligibility, content owner/flow, outbound networking, jobs/idempotency, data ownership, provider adapters, ADR-0007, ADR-0010, ADR-0014, ADR-0019, ADR-0022, ADR-0023.
- Billing and payouts: monetisation, BILLING/PAYOUTS, money flow, payment flow/security/compliance/operations, provider eligibility, ADR-0006, ADR-0007, ADR-0009, ADR-0011, ADR-0013, ADR-0019, ADR-0021.
- AI: complete AI authority path, owning tool domains, AI action flow, ADR-0002, ADR-0007, ADR-0009, ADR-0012, ADR-0013, ADR-0014.
- Infrastructure and CI/CD: scale/resilience, observability/testing, incident/platform health, dependency risk acceptance, ADR-0016, ADR-0019, unaffected portions of ADR-0003, ADR-0006, ADR-0007, ADR-0013, ADR-0014, open provider decisions.
- AUTH and privileged access: AUTH domain, onboarding, RBAC, security baseline, admin operations, incident response, ADR-0009, ADR-0017, then the affected surface and owning domain.
- Identity assurance: Identity Assurance domain/flow/threat model/provider eligibility/operations, AUTH and every evidence-consuming domain, privacy/outbound/jobs/migrations/API/observability/testing, ADR-0006, ADR-0007, ADR-0009, ADR-0014, ADR-0016, ADR-0017, ADR-0019, ADR-0020, ADR-0022, and ADR-0024.

## Implementer reading paths

- Consumer Web: phases, consumer product, Consumer Web surface, relevant domain/flow, Design/Figma set, security baseline, RBAC, privacy, API contracts, testing/release.
- Consumer Mobile: phases, consumer product, Consumer Mobile surface, notification flow, relevant domain/flow, Design/Figma set, security baseline/RBAC/privacy, API contracts, testing/release.
- Creator Studio/Private Clubs: phases, creator product, Creator Studio surface, CREATORS, PRIVATE CLUBS, creator lifecycle/entitlement, ADR-0020, media, billing/payout as applicable, creator compliance, Design/Figma.
- Platform Admin: phases, Admin product/surface/domain, RBAC, Admin flow, relevant operations document, target domain, audit/observability, Design/Figma.
- Discovery: phases, consumer product/surface, DISCOVERY, discovery flow, TRUST & SAFETY, privacy, API/testing.
- Messaging: phases, consumer surface, MESSAGING, messaging/blocks, TRUST & SAFETY, NOTIFICATIONS/notification flow, media/privacy.
- RTC: phases, REALTIME, RTC flow, surfaces, provider adapters, Trust & Safety, media/privacy, Design/Figma.
- Billing: phases, monetisation, BILLING, payment lifecycle/security, jobs/concurrency, compliance, finance operations, Admin approval.
- Payouts: phases, PAYOUTS, CREATORS/BILLING, payout compliance, finance operations, provider adapters, jobs/audit.
- Media: phases, MEDIA, media threat model, media upload/delivery security, media provider eligibility, the owning domain for the association being served, TRUST & SAFETY, jobs/idempotency, data ownership, observability, media operations, media freeze report, ADR-0010, ADR-0022, ADR-0023.
- Moderation/Trust & Safety: phase, both domains, report flow, moderation operations, evidence/privacy, Admin/RBAC, ADR-0022, creator gates and surface/distribution eligibility where applicable.
- Identity assurance: phases, Identity Assurance domain/flow, verification threat model/provider eligibility/operations, owner domain and surface, privacy/outbound/jobs/API/migrations/observability/testing, ADR-0024, and every owner ADR whose predicate consumes evidence.
- Security/privacy: security baseline and every relevant specialized security/compliance/incident authority plus owning domain/flow.
- Design/Figma: relevant product/surface/flow/security/phase, then all six Design/Figma documents and exact approved Figma handoff.
- Provider integration: provider adapters, owner domain/flow/security, compliance gates, jobs/idempotency, observability/operations, open decisions, then provider-specific ADR. Start with local/mock/test adapter.
- Compliance/market entry: all nine compliance docs, product phase/surface, every affected domain/provider, security/privacy, operations, Admin country gate, legal review.
- Operations: relevant operations document, Admin surface/domain/RBAC/flow, affected domain/flow, observability, security/privacy/compliance.
- AI: every document in AI authority, AI action flow/integration docs, product phases/surface, provider/outbound/jobs/RBAC/privacy/testing/operations, and every domain/tool contract involved.
