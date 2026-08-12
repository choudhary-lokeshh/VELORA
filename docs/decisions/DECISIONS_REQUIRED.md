# Decisions required

## Rule

Items are intentionally unresolved. No implementation, design, or provider agent may choose silently. Each accepted decision records owner, rationale, date, options, trade-offs, affected authorities, security/privacy/compliance review, migration/rollback, and ADR where architecture changes. Popularity alone is not rationale.

## Locked technical ADRs

Repository bootstrap decisions are complete. Implementers must follow the [technical stack matrix](../architecture/09-technical-stack.md) and these accepted ADRs; changing a locked family or boundary requires an amendment or superseding ADR.

| ADR | Locked scope |
|---|---|
| [ADR-0003](ADR-0003-monorepo-runtime-language.md) | pnpm/Turborepo, Node.js, TypeScript, dependency strategy |
| [ADR-0004](ADR-0004-client-frameworks.md) | Next.js Web surfaces and React Native/Expo Mobile |
| [ADR-0005](ADR-0005-backend-api-architecture.md) | NestJS/Fastify modular monolith, REST/OpenAPI/Zod contracts |
| [ADR-0006](ADR-0006-database-data-access-migrations.md) | PostgreSQL, Drizzle, constraints, migrations |
| [ADR-0007](ADR-0007-cache-jobs-events.md) | Valkey, pg-boss, outbox/inbox, workflow state |
| [ADR-0008](ADR-0008-realtime-rtc.md) | Socket.IO realtime and provider-neutral WebRTC boundary |
| [ADR-0009](ADR-0009-auth-authorization.md) | Shared AUTH/session architecture, owner authorization, approvals |
| [ADR-0010](ADR-0010-media-storage-delivery.md) | Private object storage/media processing/signed delivery |
| [ADR-0011](ADR-0011-payments-payouts.md) | BILLING/PAYOUTS separation, journals, idempotency/reconciliation |
| [ADR-0012](ADR-0012-ai-platform-runtime.md) | AI Gateway/orchestrator runtime, durable runs, provider/tool ports |
| [ADR-0013](ADR-0013-observability-testing.md) | OpenTelemetry/Pino/audit and testing stack |
| [ADR-0014](ADR-0014-deployment-environments-cicd.md) | OCI/OpenTofu topology, environments, config/flags, egress, CI/CD |

## Remaining technical decisions

| Decision needed | Requirements | Directions/options to compare | Trade-offs to evaluate | Affected components/domains | Must decide by |
|---|---|---|---|---|---|
| AUTH risk policy | exact session idle/absolute lifetimes, Mobile token TTL, device limits, recovery/linking, consumer factors | risk-tier values within ADR-0009 architecture | security, usability, revocation, support | AUTH/all surfaces | Before AUTH feature implementation |
| Privileged authentication policy | Admin assurance age, phishing-resistant MFA enrollment/recovery, break-glass | WebAuthn/passkey-first methods and governed recovery | lockout, phishing resistance, staffing, audit | AUTH/ADMIN | Before any privileged production access |
| Shared Web visual/component package | approved Figma system, surface variance, privilege/bundle isolation, ownership | keep components surface-local or add narrowly scoped shared visual package | consistency, coupling, release independence, security | Consumer Web/Creator Studio/Admin | Before sharing visual components across browser apps; `DESIGN REQUIRED` |
| Private-data search/vector platform | access filters, deletion, provenance, export/rebuild, residency, evaluation | PostgreSQL extension or dedicated index behind AI/search port | operations, scale, recall, privacy, portability | AI PLATFORM and source owners | Before first private RAG/vector feature |
| Durable AI memory store/use | consent, inspect/correct/delete, expiry, source precedence | PostgreSQL baseline or specialized store behind memory port | privacy, user control, latency, portability | AI PLATFORM/USERS | Before first durable-memory feature |
| RTC recording/transcription | default remains off; consent, indication, storage, evidence, deletion, accessibility | remain off or separately gated provider capability | privacy, safety, legal, operations, cost | REALTIME/MODERATION | Before any recording/transcription feature; `LEGAL REVIEW REQUIRED` |
| Remote media/Web import | SSRF egress, ownership, rights, malware/parser, provenance, moderation | keep disabled or narrow approved import connectors | security, rights, utility, cost | media owners/AI | Before any user/admin URL import feature |
| Production recovery objectives | journey/risk-tier SLO, RPO/RTO, restore, recovery region, failover ownership | single-region restore then warm/cold secondary options | cost, complexity, downtime/data loss | platform/all domains | Before production launch |
| Broker or workflow-engine extraction | measured throughput, fan-out, retention, independent services, workflow complexity | keep PostgreSQL/pg-boss; broker or durable workflow engine | reliability, operations, ordering, migration | jobs/events/platform | Only before measured extraction threshold is approved |
| Extra native Mobile module | unsupported Expo capability, security, maintenance, platform parity | Expo module/config plugin or direct Swift/Kotlin module | control, upgrade burden, store risk | Consumer Mobile | Before feature requiring custom native code |

## Provider ADR queue

| Decision needed | Requirements | Directions/options to compare | Trade-offs to evaluate | Affected components/domains | Must decide by |
|---|---|---|---|---|---|
| Cloud/container/registry/DNS/CDN | ADR-0014 topology, regions, WebSockets, private networking, backups, egress, cost, exit | eligible managed container/data/network platforms | operations, portability, region/provider coverage, cost, support | all deployed services | Before shared staging environment |
| CI/CD and artifact signing | locked pipeline gates, protected runners, OIDC/workload identity, provenance/SBOM, environments | eligible hosted or self-managed CI/CD providers | supply-chain security, speed, cost, runner support, portability | repository/releases | Before first shared deployment |
| Secret manager/KMS | runtime injection, rotation/versioning, workload identity, audit, regions | approved cloud or independent secret/KMS service | availability, access control, portability, cost | all server/provider integrations | Before shared staging secrets |
| Telemetry/error/paging backend | OTLP/log ingestion, traces/metrics/errors, retention, privacy/residency, alerts/on-call | eligible managed or self-hosted backends | query, cost, operations, portability, sensitive-data controls | all services/operations | Before public environment |
| Audit archive | WORM/append protection, retention, legal hold, independent administration, region, batch verification | eligible archive/object/audit providers behind locked export contract | immutability, privacy, query, cost, operations | ADMIN/security/all audited domains | Before public production privileged operations |
| Authentication identity/social/factor platform | adapter fit, Web/Mobile, MFA/recovery, account linking, countries, privacy | local/mock first then eligible identity and factor adapters | security, UX, lock-in, support, cost | AUTH/all surfaces | Before each live auth method |
| Payments | country/currency/methods, hosted collection, webhooks, refunds/disputes, PCI, reconciliation | local/mock then eligible adapters/providers | coverage, fees, compliance, failure semantics, lock-in | BILLING/PRIVATE CLUBS/finance | Before paid pilot |
| Creator payouts | recipient onboarding, countries/currencies, holds/reversals, webhooks, reconciliation | local ledger/mock then eligible payout adapters | KYC/tax, settlement, risk, operations, cost | PAYOUTS/CREATORS/finance | Before payout launch |
| RTC/video | scoped credentials, signaling/media, quality, safety removal, regional support | mock then managed/self-hosted adapter directions | quality, privacy, cost, operations, portability | REALTIME | Before Phase 2 RTC pilot |
| Object storage/media processing | private delivery, quarantine/scan/transcode, revocation, region/backup | local/test then eligible object/media adapters | security, delivery performance, egress, residency, cost | USERS/MESSAGING/PRIVATE CLUBS | Before media production use |
| Email, push, SMS/OTP | country/channel delivery, consent, templates, receipts, abuse, OTP assurance | local sinks/mock then channel adapters | coverage, deliverability, privacy, cost, failover | NOTIFICATIONS/AUTH | Before each live channel |
| Age/identity verification | adult/creator assurance, countries, evidence minimization, accessibility, appeals | manual/test then eligible verification adapters | accuracy/bias, privacy, coverage, cost, legal fit | AUTH/USERS/CREATORS | Before verification launch |
| Moderation providers | media/text capabilities, normalized signals, evidence, privacy, human route | local/manual baseline then eligible adapters | quality/bias, categories, latency, cost, data terms | MODERATION/PRIVATE CLUBS | Before automated/provider signals |
| Analytics/export | consent, schema governance, deletion, privacy thresholds, residency | local/event baseline then eligible platforms | flexibility, cost, privacy, lock-in, metric quality | ANALYTICS/all producers | Before production product analytics |
| AI provider/model/hosting/routing | capabilities, structured output, data terms, residency, pinning, eval, cost, fallback | managed/self-hosted adapters; model families per capability | quality, safety, privacy, latency, cost, portability | AI PLATFORM and affected domains | Before first external AI evaluation or live route |

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

[technical stack](../architecture/09-technical-stack.md), [ADR-0001](ADR-0001-documentation-first.md), [ADR-0002](ADR-0002-isolated-ai-platform.md), [provider adapters](../architecture/06-provider-adapters.md), [product phases](../product/01-product-phases.md), [Figma authority](../design/03-figma-source-of-truth.md), [market entry](../compliance/01-market-entry-gates.md), and [incident response](../operations/04-incident-response.md).
