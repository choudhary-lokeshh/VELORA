# ADR-0014: Deployment, environments, configuration, outbound networking, and CI/CD

- Decision date: 2026-08-12
- ADR status: Accepted in part; backend runtime/Redis topology detail superseded by ADR-0016

> Supersession note (2026-08-13): [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md) replaces the Node-only backend and Valkey topology with Bun/Elysia and logically separated ephemeral/durable-queue Redis responsibilities. Environment isolation, OCI/OpenTofu direction, typed configuration, controlled egress, provider-neutral CI/CD, immutable promotion, and rollback rules remain accepted. Replaced runtime/topology references below are historical, not active stack authority.

## Context

Velora needs reproducible local/test/staging/production environments, separate surface deployments, typed config/secrets, feature/country/provider gates, safe outbound HTTP, migration gates, and a low-operations initial production topology. Cloud, CI, secrets, telemetry, and provider vendors remain unselected. Kubernetes is not justified for the initial team.

Current official sources were checked on the decision date. OCI-compatible multi-stage images support portable minimal artifacts; OpenTofu 1.12 provides provider-neutral infrastructure-as-code plan/apply workflow; OpenFeature defines a provider-neutral server feature-flag API. See [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/), [OpenTofu](https://opentofu.org/docs/intro/), [OpenTofu plan](https://opentofu.org/docs/cli/commands/plan/), and [OpenFeature Node.js SDK](https://openfeature.dev/docs/reference/sdks/server/javascript/).

## Requirements

- Keep Web, Mobile, Creator Studio, Admin, API, and workers independently releasable.
- Start single-region with low operational load and horizontal scaling path.
- Isolate environments, credentials, data, networks, and provider projects.
- Validate typed config at startup and keep secrets out of code/images/client bundles.
- Support rollout, experiment, country/channel, provider, compliance, and emergency-disable gates with audit.
- Enforce SSRF-safe server outbound networking beyond string URL filters.
- Gate merges/deployments on tests, migrations, security, artifacts, approvals, health, and rollback.
- Avoid production credentials or uncontrolled external providers in local/test.

## Options evaluated

1. Managed container platform with OCI images, managed data services, and OpenTofu.
2. Kubernetes from first deployment.
3. Function/serverless-only topology.
4. Virtual machines configured manually.
5. Vendor-native build/deploy definitions with no portable artifact.
6. Direct `fetch`/HTTP use throughout applications versus a controlled egress boundary.
7. Vendor-specific feature flags versus OpenFeature with Velora-owned critical gates.

## Decision

### Initial topology

- Build immutable, non-root, minimal OCI images with Docker BuildKit multi-stage builds. Pin base image digest, generate an SBOM, scan/sign artifacts, and promote the same digest across environments.
- Deploy Consumer Web, Creator Studio, and Platform Admin as three separate Next.js services. Deploy `apps/api` as one stateless API service and the same backend artifact with a separate worker command/role. Socket.IO runs in API during Phase A. Mobile is released through signed iOS/Android artifacts and store channels.
- Use one approved managed container platform with load balancing, TLS termination, private networking, autoscaling, health checks, rolling/canary support, and log/metric export. Exact cloud/container/registry/CDN/DNS provider is deferred until environment integration.
- Use managed PostgreSQL 18 with connection pooling, multi-zone durability where available, encrypted backups, PITR, and tested restore; managed Valkey 9.1 for ephemeral state; private object storage/CDN only when media launches; OpenTelemetry Collector/compatible OTLP endpoint.
- Start in one approved region. Use CDN for public static assets and authorized media delivery. Multi-region active-active writes and mandatory microservices are rejected initially.
- Provision shared infrastructure with OpenTofu 1.12.x. Store encrypted remote state with locking and separate environment access; plans are reviewed and the final saved plan is applied by CI/CD, not from developer laptops for production.

### Environments

- `local`: Node/pnpm apps plus containerized PostgreSQL/Valkey and local/mock provider sinks; synthetic data only.
- `test`: ephemeral isolated services per suite/CI job through Testcontainers; no shared mutable environment.
- `staging`: separate account/project, network, database, Valkey, storage, domains, secrets, and provider sandbox credentials; production-like topology and migrations; synthetic or explicitly approved test data only.
- `production`: separate account/project and credentials, least privilege, controlled operator access, approved live providers, backups, audit, and incident controls.
- No environment shares production credentials, signing keys, webhook secrets, databases, queues, buckets, or mobile signing material with a lower environment.

### Configuration, secrets, and feature gates

- `packages/config` defines typed, Zod-validated configuration schemas with explicit defaults only for safe local values. Applications fail startup on missing/invalid required config. Client-safe config is separately allowlisted and built; server config is never implicitly serialized.
- Store secrets only in the selected runtime secret manager/KMS or protected CI secret store. Images, OpenTofu source/state outputs, logs, telemetry, Mobile/Web bundles, and repository files contain references, not secret values. Rotate by versioned secret reference and overlapping key windows where protocols permit.
- Use OpenFeature server/client APIs as the feature-evaluation abstraction. ADMIN-owned PostgreSQL configuration remains authoritative for product phase, country/channel, compliance, provider route, high-risk capability, and emergency disable, with version/approval/audit. External flag providers may distribute/cache rollout or experiment data but cannot override critical gates.
- Evaluate critical gates server-side at action time. Clients receive minimized evaluated availability for UX only. Unknown/expired critical configuration fails closed. Valkey caches by version/TTL and never becomes gate truth.
- ANALYTICS owns experiment definitions/measurement; ADMIN owns approved configuration workflow; each domain still enforces its current policy.

### Outbound networking

- Ban direct arbitrary `fetch`, `http`, `https`, or provider SDK network calls outside registered infrastructure adapters through lint/dependency rules and code review. All server egress uses a controlled `OutboundHttp` boundary with destination class, purpose, credential policy, limits, and telemetry.
- Fixed provider adapters use trusted configuration allowlists, isolated credentials, explicit methods/paths, TLS validation, timeout/size/retry policy, and no request-supplied host.
- User/admin/model/attachment-derived retrieval runs only in an isolated egress worker/service with no route to application/data private networks. For initial AI/web retrieval, deploy this role separately before enabling capability.
- Canonicalize scheme/host/port; normally allow only HTTPS; reject embedded credentials; resolve with controlled DNS; validate every IPv4/IPv6 and IPv4-mapped IPv6 result; block loopback, private, link-local, multicast, unspecified, reserved, carrier-grade NAT, documentation, and metadata ranges; connect to a validated address while preserving hostname/TLS verification; revalidate every redirect and new resolution; cap redirect count.
- Apply method/port allowlists, connect/read/total timeout, response byte and decompression ratio limits, content-type/parser allowlists, nested-fetch depth, archive limits, and concurrency/budget. Strip caller cookies, auth/internal headers, client certificates, and query secrets. Treat response as quarantined untrusted data. Network firewall/route policy independently blocks private and metadata destinations so URL code is not sole defense.
- DNS ambiguity, rebinding signal, blocked address, invalid TLS, redirect violation, oversized response, or parser uncertainty fails closed and records redacted telemetry.

### CI/CD and deployment gates

- CI provider is deferred, but pipeline behavior is locked. Pull requests run frozen install, formatting/lint, dependency-boundary checks, typecheck, unit/domain/contract tests, generated artifact drift, real-service integration/migration tests where affected, security/secrets/dependency/IaC scans, and changed-app builds.
- Protected main builds once, generates provenance/SBOM, signs immutable artifacts, applies staging migrations, deploys staging, then runs smoke/E2E/high-risk checks. Production promotion requires current approvals, change/risk evidence, migration plan, health/SLO readiness, provider/feature gates, and rollback/compensation.
- Apply expand-compatible migrations before application activation. Never auto-migrate from application startup. Destructive contract step occurs only after old app/jobs/clients drain.
- Deploy apps independently using affected graph. Use canary/rolling release with readiness, connection drain, automatic halt on defined health signals, and manual or automatic rollback to prior artifact. Database/state compensation follows owner plan; code rollback never pretends to undo committed domain/provider effects.
- Production infrastructure apply, secret change, country/provider gate, financial/safety configuration, and privileged access are audited and approval-controlled.

## Why

Portable OCI artifacts and a managed container platform provide predictable long-running API, workers, and WebSocket behavior without Kubernetes operations. OpenTofu makes infrastructure reviewable while keeping cloud selection open. OpenFeature preserves flag-provider portability, and Velora-owned critical configuration prevents a flag vendor from becoming compliance truth. A dedicated egress boundary and network isolation make SSRF defenses enforceable.

## Rejected alternatives

- Kubernetes initially: excessive cluster, security, networking, upgrade, and on-call burden for current scale/team.
- Function-only deployment: poor fit for long-lived WebSockets, durable workers, connection pools, and coordinated module behavior.
- Manual virtual machines: configuration drift, weak reproducibility, and slow rollback.
- Vendor-native source deployment only: weak artifact promotion and portability.
- External feature flag as compliance truth: availability or stale vendor data cannot authorize high-risk capabilities.
- Direct HTTP throughout code or string-only SSRF filters: cannot enforce DNS/IP/redirect/network isolation consistently.
- Active-active multi-region database initially: high correctness and operational cost without launch evidence.

## Consequences

The first production environment still needs provider ADRs for cloud, identity, storage, channels, telemetry, and live integrations. Containers and OpenTofu add bootstrap work but create repeatability. Staging costs more because it is isolated. Some outbound features require a separate egress role before launch.

## Risks

- Managed platform constraints may affect WebSockets, regions, or connection draining.
- Single region is an availability and latency limitation.
- OpenTofu state can contain sensitive data.
- Feature-cache/config errors can over-enable capability.
- SSRF implementation can contain parser, DNS, redirect, or address-classification gaps.
- CI compromise can publish trusted artifacts.

## Mitigations

Provider evaluation against topology requirements; backups/PITR/restore and regional recovery plan; encrypted restricted state; deny-default critical gates with version/audit; centralized egress plus network blocks and regression tests; short-lived workload identity, protected runners, signed provenance, least privilege, environment approvals, and artifact verification.

## Scaling path

Phase A is single-region with separate Web services, API, worker, managed PostgreSQL/Valkey, and optional media/egress roles. Phase B horizontally scales API/workers, extracts realtime gateway, adds CDN and queue/media/AI worker pools, tunes managed data services, and introduces warm recovery region if SLO requires. Phase C extracts only measured services and adopts regional read/processing/data topology after residency and consistency ADRs. Kubernetes remains optional, not destination by default.

## Security implications

Use private networks, deny-default ingress/egress, TLS, workload identities, non-root/read-only containers where practical, patching, secret rotation, encrypted backups/state, WAF/rate limits where approved, image/IaC scanning, signed artifacts, production access review, and audit. No production credential appears in development or client code.

## Testing implications

Test image reproducibility/non-root operation, config failure, secret rotation, feature-gate fail-closed/cache invalidation, environment isolation, migrations, canary/rollback, backup restore, connection drain, provider outage, and complete SSRF matrix including DNS rebinding, redirects, IPv4/IPv6/mapped IPv6, metadata, time/size/decompression/parser limits, and header isolation.

## Migration/reversibility

OCI artifacts and OpenTofu permit moving to another managed container/cloud provider after data, secrets, DNS, and network migration. Keep provider-specific resources behind modules and publish only minimal outputs. Dual-run environments, restore/copy data, compare health, shift traffic gradually, and retain rollback. CI provider can change while pipeline contract and signed artifacts remain.

## Status

| Decision | Classification |
|---|---|
| OCI images on managed container platform | LOCK NOW |
| OpenTofu 1.12.x infrastructure as code | LOCK NOW |
| Separate local/test/staging/production environments | LOCK NOW |
| Typed config, secret-manager boundary, OpenFeature abstraction | LOCK NOW |
| Velora-owned critical feature/country/provider gates | LOCK NOW |
| Controlled isolated outbound HTTP/SSRF boundary | LOCK NOW |
| CI/CD gate and immutable artifact promotion model | LOCK NOW |
| Cloud, container, registry, CI, secret, CDN, and DNS vendors | DEFER UNTIL PROVIDER INTEGRATION |
| Multi-region active-active and Kubernetes | DEFER UNTIL SCALE REQUIRES |
| Production RPO/RTO and recovery-region target | DECISION REQUIRED BEFORE FEATURE |
| Manual production servers and unrestricted direct egress | REJECTED |
