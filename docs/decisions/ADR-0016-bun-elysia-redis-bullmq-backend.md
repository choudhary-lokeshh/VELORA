# ADR-0016: Bun, Elysia, Redis, and BullMQ backend foundation

Status: Accepted
Decision date: 2026-08-13
Owners: Platform engineering, security, and domain owners

## Context

The initial repository bootstrap selected Node.js, NestJS/Fastify, Valkey, and pg-boss before any product endpoint, domain table, or business job existed. A read-only audit then found security, lifecycle, dependency-policy, and verification gaps. The team also has proven internal experience with the Bun/Elysia/Redis/BullMQ pattern. Changing now avoids preserving framework ceremony and operational choices solely because bootstrap files exist; product migration cost is zero.

Current primary sources were checked on the decision date. Bun 1.3.14 is the current stable release; Elysia 1.4.29 targets Bun and accepts Standard Schema validators; Drizzle 0.45.2 exposes the Bun SQL driver and migrator; BullMQ supports Redis 6.2 or newer; Redis 8.10 is the current stable line. BullMQ 6.1 is a newly released major, so bootstrap pins the mature latest v5 release, 5.81.3, until v6 migration and Bun integration evidence justify a reviewed upgrade. OpenTelemetry JavaScript officially targets Node.js and browsers, so only the provider-neutral API seam is enabled under Bun until a Bun exporter/SDK integration passes compatibility and shutdown tests. Bun's test runner supports the API foundation tests, while established Node-only Next.js, Expo, Playwright, and Testcontainers orchestration stay on the pinned Node toolchain. See [Bun releases](https://github.com/oven-sh/bun/releases), [Elysia](https://elysiajs.com/), [Elysia validation](https://elysiajs.com/essential/validation), [Drizzle Bun SQL](https://orm.drizzle.team/docs/get-started/bun-sql-new), [BullMQ connections](https://docs.bullmq.io/guide/connections), [Redis releases](https://github.com/redis/redis/releases), [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/), and [Bun test runner](https://bun.com/docs/test).

## Decision

- Keep pnpm 11 as monorepo package-manager/workspace authority, one frozen lockfile, and Turborepo as task runner. Bun is not a second package manager.
- Pin Bun 1.3.14 for the API, worker, migrations, and compatible backend tests. Keep Node.js 24.19.0 only for repository, Next.js, Expo, Playwright, code-generation, and Testcontainers tooling that requires Node.
- Use strict ESM TypeScript 5.9.3 and one Elysia 1.4 API composition root. Infrastructure endpoints only are `/v1/health/live` and `/v1/health/ready`; product routes remain absent.
- Keep PostgreSQL 18 as business source of truth. Use Drizzle through Bun SQL plus explicit SQL where justified. Migrations are reviewed, committed SQL invoked only by an explicit Bun command; framework startup never migrates.
- Use Redis 8 through separate logical endpoints and credentials for two responsibilities:
  - ephemeral Redis: cache, presence, temporary realtime state, and acceptable rate-limit acceleration; loss may degrade service but cannot corrupt business truth;
  - durable queue Redis: BullMQ jobs, retries, delayed jobs, and worker coordination; it requires persistence, backup, restore, monitoring, and recovery policy appropriate to the job risk.
- Use BullMQ 5.81.3 for bounded, explicitly registered and versioned job names. Delivery is treated as at-least-once. PostgreSQL owner state, idempotency keys, transactional outbox facts, reconciliation, and compensation remain mandatory where effects or cross-system atomicity matter.
- Keep owner workflow tables authoritative for human approvals and long-running high-impact state. BullMQ supplies execution/wakeup, not authorization or business completion.
- Preserve PostgreSQL transactional-outbox/inbox direction without creating speculative product event tables.
- Register a deny-all outbound HTTP port at composition root. Direct backend network primitives and unapproved HTTP dependencies are rejected by lint and repository boundary checks across every workspace the backend runtime can import, derived from the workspace graph rather than a file list. No arbitrary URL retrieval exists.

  Amended 2026-08-13: the enforced scope is stated explicitly because the original checks covered two named files rather than whole packages, and modelled only `fetch`, `Bun.connect`, and `Bun.udpSocket`. `WebSocket`, `EventSource`, `XMLHttpRequest`, `navigator.sendBeacon`, and object-property aliasing of the runtime globals are now rejected as well. See [ADR-0018](ADR-0018-toolchain-provisioning-verification-ci.md) for the pipeline that executes these checks.
- Keep provider-neutral OpenTelemetry API seams and structured Pino logs. Enabling a concrete Bun telemetry SDK/export path requires compatibility, flush, and shutdown evidence.

Redis is never authoritative for billing, entitlements, payouts, moderation or enforcement decisions, account identity, authorization, approvals, audit, or other durable business state.

## Supersedes

This ADR supersedes only these active implementation portions; unaffected architecture remains accepted:

- ADR-0003: Node.js as backend/worker runtime and rejection of Bun. pnpm, Turborepo, TypeScript, and Node for client/tooling remain.
- ADR-0005: NestJS/Fastify backend framework. Modular-monolith boundaries and REST/OpenAPI/Zod contracts remain.
- ADR-0006: `node-postgres` Drizzle driver. PostgreSQL, Drizzle, reviewed SQL, constraints, and migration discipline remain.
- ADR-0007: Valkey, pg-boss, and the rejection of BullMQ. Outbox/inbox, idempotency, explicit workflow state, and no premature broker remain.
- ADR-0008: NestJS integration and Valkey fan-out implementation detail. Socket.IO/REST-resync and provider-neutral RTC decisions remain.
- ADR-0012: NestJS AI gateway, Valkey cache naming, and pg-boss AI worker implementation detail. AI isolation, explicit orchestration, PostgreSQL run truth, tools, approvals, and provider neutrality remain; AI is still not V1.
- ADR-0013: Fastify/Nest HTTP tests and Valkey/pg-boss test targets. Observability, audit separation, and risk-based release evidence remain.
- ADR-0014: Node-only backend runtime and Valkey environment/topology details. Environment, OCI, configuration, egress, and provider-neutral CI/CD requirements remain.

Historical text in superseded ADRs remains evidence of the original decision and must not be read as active stack authority.

## Why

The selected pattern matches existing team familiarity, keeps TypeScript end to end, reduces framework ceremony, and provides a fast runtime with a small HTTP core. No product implementation exists, so replacement is materially cheaper and safer now than after domain code or production data. A modular monolith plus explicit ports preserves future extraction without premature microservices.

## Risks

- Bun and Elysia have smaller/newer ecosystems than Node and NestJS, including runtime edge cases in SDKs and operational tooling.
- Mixed Bun/Node execution can become confusing if command ownership is implicit.
- BullMQ makes queue Redis correctness-relevant; it cannot be treated as disposable cache.
- PostgreSQL business transitions and Redis queue publication cannot share one atomic transaction.
- Redis loss, eviction, or misconfigured persistence can lose or duplicate work.

## Mitigations

- Pin exact runtimes and packages; enforce preflight, frozen install, strict TypeScript, package boundaries, real integration tests, and no mixed backend framework residue.
- Keep command ownership explicit: pnpm/Turbo orchestrate; Bun runs API/worker/migrations/backend tests; Node runs the client/tooling exceptions.
- Separate ephemeral and queue Redis URLs, logical databases/credentials, health signals, capacity policy, and production recovery requirements. Local Compose uses persistent AOF/RDB storage to test restart behavior but is not a production design.
- Write business state and an outbox fact atomically in PostgreSQL; publish idempotently; make handlers idempotent; reconcile high-impact effects against PostgreSQL/provider truth.
- Bound queue count, retry attempts, backoff, payloads, concurrency, and shutdown time; test outage, retry, failed state, worker restart, and persistence.
- Enable concrete OpenTelemetry SDK/export only after Bun compatibility and graceful flush are proven.

## Rejected alternatives

- Retain NestJS/Fastify because bootstrap already exists: no product investment justifies the ceremony or mixed residue.
- Retain pg-boss solely because an older ADR selected it: current team operational direction prefers BullMQ; PostgreSQL correctness is preserved through owner state and outbox patterns.
- Make Bun the monorepo package manager: unnecessary disruption to Next.js/Expo tooling and the existing reproducible pnpm workspace.
- Add Kafka, another broker, a workflow engine, or microservices now: no measured load, ownership, or isolation evidence warrants them.

## Security and operations

Queue Redis requires private networking, TLS, authentication/ACLs, dedicated least-privilege credentials, persistence, no unsafe eviction policy, encrypted backups where applicable, restore drills, memory/disk/replication/queue alerts, and documented incident ownership. Job payloads carry minimal references, never credentials or unnecessary sensitive data. Ephemeral Redis uses separate credentials and may be rebuilt.

Outbound network access stays deny-all until an approved adapter is introduced under SSRF authority. Logs recursively redact secret-bearing keys, headers, URLs, query values, connection strings, and unsafe error messages. Client and server config/observability exports are structurally separate.

## Verification and migration

Because no product code or tables exist, migration is removal/replacement rather than data cutover. Required evidence includes exact toolchain preflight; frozen workspace install; lint/boundary/type checks; generated OpenAPI/client drift checks; Elysia error/header/size/correlation tests; actual explicit PostgreSQL migration command tests on empty/repeated databases with zero product tables; real Redis/BullMQ enqueue, claim, retry, delayed, failure, outage, worker restart, graceful shutdown, and persistence tests; client builds; dependency audit; secret scan; and repository hygiene checks.

## Portability

Domain/application code depends on published ports, Zod/OpenAPI contracts, repository interfaces, and versioned job/event names—not Elysia, BullMQ, or Redis APIs. A future runtime, HTTP framework, queue, or Redis service may be shadowed and cut over behind those boundaries after a superseding ADR and parity evidence.
