# Decisions required

## Rule

Items are intentionally unresolved. No implementation, design, or provider agent may choose silently. Each accepted decision records owner, rationale, date, options, trade-offs, affected authorities, security/privacy/compliance review, migration/rollback, and ADR where architecture changes. Popularity alone is not rationale.

## Technical stack ADR queue

| Decision needed | Requirements | Directions/options to compare | Trade-offs to evaluate | Affected components/domains | Must decide by |
|---|---|---|---|---|---|
| Monorepo tooling | multi-app/package boundaries, caching, affected-test/build support, reproducibility | workspace/orchestrator approaches; minimal workspace first | complexity, CI speed, dependency enforcement, migration | all apps/packages | Before repository bootstrap |
| Runtime and package manager | supported platforms, security updates, deterministic lock/install, tooling compatibility | current supported runtimes/package managers | ecosystem fit, supply-chain controls, performance, team operations | all code | Before repository bootstrap |
| Backend framework and topology | domain modularity, contracts, jobs, auth, observability, testability | modular monolith first; service-ready modules; split only with evidence | delivery speed, isolation, scaling, operational burden | API and all domains | Before first backend slice |
| Web framework/rendering | Consumer Web, Creator Studio, Admin separation, SSR/CSR needs, accessibility, deployment | supported web frameworks and rendering modes | security, performance, routing, ecosystem, hosting portability | Web/Studio/Admin | Before first Web bootstrap |
| Mobile framework | secure storage, native permissions, push, deep links, accessibility, release channels | native or cross-platform approaches | platform fidelity, team skill, performance, upgrade/release risk | Consumer Mobile | Before Mobile bootstrap |
| Database | transactions, uniqueness, locking/versioning, migrations, regional/backup needs | relational baseline and other justified stores | consistency, operations, scale, portability, residency | transactional domains | Before first persistence slice |
| ORM/query and migration tooling | domain schema ownership, explicit transactions/constraints, safe migrations, observability | ORM, query builder, generated/handwritten data access | abstraction leakage, type safety, performance, migration control | API/domain packages | Before first schema/migration |
| Cache and Redis-compatible capability | revocation safety, TTL, rate limits, presence, locks only where safe | no shared cache initially; managed/self-hosted compatible service; alternatives | stale authorization risk, availability, operations, cost | AUTH, DISCOVERY, REALTIME, platform controls | Before first feature needing shared ephemeral state |
| Queue, outbox, and workflow architecture | durability, claims/leases, retries, DLQ, ordering, idempotency, scheduled/approval waits | database outbox/jobs; broker; workflow engine combinations | consistency, throughput, complexity, portability, recovery | notifications, payments, deletion, AI, providers | Before first critical async workflow |
| API style and contract tooling | versioning, errors, generated clients, streaming/upload, compatibility tests | REST, GraphQL, RPC, combinations with bounded ownership | client fit, caching, tooling, evolution, security | all clients/domains | Before first public contract |
| WebSocket/realtime signaling | authenticated channels, revocation, scale, fallback, message/presence separation | WebSocket infrastructure, managed adapter, protocol alternatives | operations, ordering, connection scale, provider coupling | MESSAGING/REALTIME/NOTIFICATIONS | Before realtime implementation |
| Authentication/session strategy | Web/Mobile sessions, CSRF, secure storage, MFA/step-up, revocation/recovery | server sessions, bounded tokens, hybrid; provider/self-managed adapter | security, UX, revocation, operations, portability | AUTH and all surfaces | Before AUTH implementation |
| Configuration/secrets/feature flags | typed config, secret rotation, country/channel gates, audit, emergency disable | managed services or portable interfaces | safety, auditability, local testing, vendor lock-in | platform/ADMIN/all domains | Before non-local deployment |
| Observability and immutable audit stack | logs/metrics/traces, privacy, correlation, SLOs, append protection | interoperable standards and managed/self-hosted backends | cost, retention, query, privacy/residency, portability | all domains/operations | Before public environment |
| Deployment/hosting/network topology | isolated environments, egress, regions, scaling, backups, recovery | cloud/platform/container/serverless directions | operations, cost, portability, compliance, performance | all apps/providers/data | Before shared staging/production |
| CI/CD and release controls | tests, builds, migrations, artifacts, secrets, approvals, canary/rollback | hosted/self-managed pipelines and deployment strategies | speed, supply-chain security, reproducibility, operations | repository/all releases | Before first deployed environment |

## Provider ADR queue

| Decision needed | Requirements | Directions/options to compare | Trade-offs to evaluate | Affected components/domains | Must decide by |
|---|---|---|---|---|---|
| Payments | country/currency/methods, hosted collection, webhooks, refunds/disputes, PCI, reconciliation | local/mock then eligible adapters/providers | coverage, fees, compliance, failure semantics, lock-in | BILLING/PRIVATE CLUBS/finance | Before paid pilot |
| Creator payouts | recipient onboarding, countries/currencies, holds/reversals, webhooks, reconciliation | local ledger/mock then eligible payout adapters | KYC/tax, settlement, risk, operations, cost | PAYOUTS/CREATORS/finance | Before payout launch |
| RTC/video | scoped credentials, signaling/media, quality, safety removal, regional support | mock then managed/self-hosted adapter directions | quality, privacy, cost, operations, portability | REALTIME | Before Phase 2 RTC pilot |
| Object storage/media processing | private delivery, quarantine/scan/transcode, revocation, region/backup | local/test then eligible object/media adapters | security, delivery performance, egress, residency, cost | USERS/MESSAGING/PRIVATE CLUBS | Before media production use |
| Email, push, SMS/OTP | country/channel delivery, consent, templates, receipts, abuse, OTP assurance | local sinks/mock then channel adapters | coverage, deliverability, privacy, cost, failover | NOTIFICATIONS/AUTH | Before each live channel |
| Age/identity verification | adult/creator assurance, countries, evidence minimization, accessibility, appeals | manual/test then eligible verification adapters | accuracy/bias, privacy, coverage, cost, legal fit | AUTH/USERS/CREATORS | Before verification launch |
| Moderation providers | media/text capabilities, normalized signals, evidence, privacy, human route | local/manual baseline then eligible adapters | quality/bias, categories, latency, cost, data terms | MODERATION/PRIVATE CLUBS | Before automated/provider signals |
| Analytics/export | consent, schema governance, deletion, privacy thresholds, residency | local/event baseline then eligible platforms | flexibility, cost, privacy, lock-in, metric quality | ANALYTICS/all producers | Before production product analytics |
| AI provider/model/hosting/routing | capabilities, structured output, data terms, residency, pinning, eval, cost, fallback | managed/self-hosted adapters; model families per capability | quality, safety, privacy, latency, cost, portability | AI PLATFORM and affected domains | Before first AI technical ADR/live route |

Every real provider requires owner-domain contract, mock/test adapter, security/privacy/compliance review, verified failure/reconciliation behavior, observability, operations owner, feature gate, and rollback before live traffic.

## Product, design, compliance, and operations decisions

| Decision needed | Requirements | Directions/options to compare | Trade-offs to evaluate | Affected components/domains | Must decide by |
|---|---|---|---|---|---|
| Launch countries and market gates | age, content, providers, privacy, operations, localization/accessibility | staged country/channel capability matrix | reach, risk, operations, provider coverage | all surfaces/domains | Before public launch; `LEGAL REVIEW REQUIRED` |
| Adult/age assurance | country/capability tiers, methods, recheck, evidence, appeal | declaration plus approved assurance methods per risk | friction, access, privacy, accuracy, legal fit | AUTH/USERS/CREATORS | Before adult protected access; `LEGAL REVIEW REQUIRED` |
| Consumer profile/discovery policy | required fields, visibility, availability, ranking/eligibility, decline behavior | product/research-tested policies | safety, privacy, utility, bias, abuse | USERS/DISCOVERY | Before V1 product design/build |
| Messaging retention/encryption | safety/evidence, user privacy, device/platform support, deletion | at-rest and possible end-to-end directions | safety access, privacy, complexity, recovery | MESSAGING/TRUST & SAFETY | Before production messaging data |
| Creator/club launch rules | criteria, taxonomy, pricing/subscription/grace/refund, channels, operations | staged web-first pilot parameters | creator utility, safety, compliance, support cost | CREATORS/PRIVATE CLUBS/BILLING | Before Phase 2 pilot |
| Mature/explicit creator content | all country/category/provider/channel/consent/moderation gates | remain disabled; limited approved pilots only after full evidence | safety, legal, provider, brand, operations | creator ecosystem | Before any enablement; `LEGAL REVIEW REQUIRED` |
| Payout/tax/risk policy | KYC/tax, commission, reserve, dispute, negative balance | country/provider/product-specific policies | creator UX, risk, compliance, cash flow | PAYOUTS/CREATORS/BILLING | Before payout accrual/launch; `LEGAL REVIEW REQUIRED` |
| Admin permission/approval matrix | roles/scopes, step-up, dual control, break-glass, audit | least-privilege operation catalogue | safety, speed, staffing, incident response | ADMIN/all domains | Before privileged production access |
| Data residency/retention/rights | data map, regions, lawful basis, deletion/export/holds/providers | country/data-class schedules | privacy, compliance, cost, operations | all data owners | Before production personal data; `LEGAL REVIEW REQUIRED` |
| Design identity/system | brand, tokens, components, responsive, accessibility, approval/handoff | Figma exploration and user/accessibility validation | distinction, usability, maintainability, global fit | all surfaces | Before production UI implementation; `DESIGN REQUIRED` |
| SLO/incident/operations model | SLOs, RPO/RTO, on-call, support/moderation/finance staffing | risk-tier service and operating models | reliability, staffing, cost, launch scope | all domains/operations | Before public launch |
| AI capability/tool/approval governance | launch capabilities, effects, tools, human review, protected-trait policy | capability-by-capability approval | utility, risk, staffing, user control | AI/ADMIN/MODERATION/domain owners | Before each AI capability |
| AI context/memory/RAG/prompt governance | consent, corpus, retention/deletion, prompt review, citations | no durable memory/private RAG initially; staged approved sources | personalization, privacy, freshness, operations | AI/USERS/knowledge owners | Before durable AI data/private indexing |
| AI evaluation/budget/release policy | datasets, thresholds, content sampling, cost/SLO, canary/rollback | risk-tier gates and provider comparisons | quality, privacy, cost, time, portability | AI/security/operations | Before first AI release |

## Decision record template

```markdown
## DEC-YYYY-NNN: Title
Status: proposed | accepted | superseded
Owner: role/team
Decision date: YYYY-MM-DD
Decision needed and deadline: ...
Requirements: ...
Options considered: ...
Trade-offs: ...
Decision and rationale: ...
Affected domains/components/docs: ...
Security/privacy/compliance/design review: ...
Migration/rollback: ...
```

## Cross-references

[ADR-0001](ADR-0001-documentation-first.md), [ADR-0002](ADR-0002-isolated-ai-platform.md), [provider adapters](../architecture/06-provider-adapters.md), [product phases](../product/01-product-phases.md), [Figma authority](../design/03-figma-source-of-truth.md), [market entry](../compliance/01-market-entry-gates.md), and [incident response](../operations/04-incident-response.md).
