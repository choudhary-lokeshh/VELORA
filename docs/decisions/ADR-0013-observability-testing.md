# ADR-0013: Observability, audit, testing, and release evidence

- Decision date: 2026-08-12
- ADR status: Accepted

## Context

Velora must diagnose distributed request, event, job, provider, payment, entitlement, moderation, deletion, realtime, and AI behavior without putting private content into telemetry. It also needs a practical test stack proving domain boundaries, PostgreSQL correctness, client behavior, security, concurrency, provider adapters, and AI regressions.

Current official sources were checked on the decision date. OpenTelemetry JavaScript traces and metrics are stable while its logs SDK remains in development, supporting the decision to use structured application logs correlated with OpenTelemetry. Vitest 4 supports Node.js 20+, Playwright covers Chromium/Firefox/WebKit, Testcontainers provides real PostgreSQL test instances, and Maestro supports React Native/Expo through the accessibility layer. See [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/), [Vitest 4](https://v4.vitest.dev/guide/features), [Playwright browsers](https://playwright.dev/docs/browsers), [Testcontainers PostgreSQL](https://node.testcontainers.org/modules/postgresql/), and [Maestro React Native](https://docs.maestro.dev/platform-support/react-native).

## Requirements

- Correlate user request through API, domain command, transaction, outbox, job, provider, audit, and AI/RTC work.
- Keep operational logs/traces/metrics, immutable audit, product analytics, and financial journals distinct.
- Avoid raw messages, media, identity/payment material, secrets, AI context, and moderation evidence in generic telemetry.
- Test unit, domain, API, integration, real PostgreSQL, Web, Mobile, E2E, authorization, concurrency, payments, webhooks, security, and AI evaluations.
- Provide deterministic CI evidence and production canary/rollback signals.
- Keep telemetry backend vendor replaceable.

## Options evaluated

1. OpenTelemetry/OTLP plus structured Pino JSON logs and separate audit store.
2. One vendor SDK directly throughout business code.
3. Logs only.
4. One test runner for all platforms.
5. Layered Vitest/Jest/Playwright/Maestro/Testcontainers stack.
6. Mock database integration tests only.

## Decision

- Use OpenTelemetry APIs/SDK for server traces and metrics, W3C trace context, baggage only for approved non-sensitive correlation, and OTLP export through an OpenTelemetry Collector or compatible endpoint. Domain code depends on `packages/observability`, not backend-vendor SDKs.
- Use Pino structured JSON application logs with trace/span/correlation IDs. Correlate logs with OpenTelemetry; do not depend on the currently development-status OpenTelemetry JavaScript logs SDK as the only logging path.
- Define low-cardinality metrics and explicit redaction/classification rules. Never place user IDs, object IDs, URLs, provider payloads, prompts, message text, or other high-cardinality/private values in metric labels.
- Keep telemetry backend, error-monitoring backend, paging, and long-term archive vendor deferred until environment integration. OTLP and structured logs are replacement boundary.
- Store privileged/security audit events separately from operational telemetry in an append-only PostgreSQL audit schema initially, using insert-only application roles, immutable IDs, before/after references, actor/reason/approval/correlation, restricted reads, and a tamper-evident hash chain. Before public production privileged operations, export verified hash-chained batches to a separately administered append-protected/WORM archive; its vendor remains deferred.
- ANALYTICS owns product metrics; BILLING/PAYOUTS own financial journals; AI PLATFORM owns run/evaluation/cost metadata. None are reconstructed from sampled logs.
- Use Vitest 4 for TypeScript server/domain/package and browser-unit tests. Use Testing Library for React behavior/accessibility. Use `jest-expo` plus React Native Testing Library for Expo component/native-module-facing unit tests where Expo compatibility requires Jest.
- Use Testcontainers with PostgreSQL 18 and Valkey 9.1 for integration, migration, queue, concurrency, and adapter tests. SQLite/in-memory substitutes do not satisfy database correctness gates.
- Use Fastify/Nest integration tests for HTTP/webhook/auth contracts and generated OpenAPI/client compatibility. Use provider adapter conformance suites with deterministic mocks, recorded synthetic fixtures where licensing/security permits, and provider sandboxes only after integration approval.
- Use Playwright for Consumer Web, Creator Studio, and Admin E2E across Chromium, Firefox, and WebKit according to supported surface matrix. Use Maestro for critical iOS/Android user journeys on Expo development/release builds, supplemented by platform-native tests for modules where required.
- Use repository-owned AI evaluation runners and versioned datasets, integrated with normal test reports and AI release gates. Provider dashboards are supplementary only.
- Add performance/load tests for public APIs, WebSocket connections, queue throughput, and high-risk workflows before their launch. Exact load tool may be selected during bootstrap if it does not alter architecture.
- Security release gates include dependency and lockfile vulnerability review, secrets scan, static analysis, container/IaC scan, authorization/security regression, webhook/SSRF/upload tests, and targeted dynamic testing before public launch. Tool vendors remain replaceable.
- Test tiers:
  - every change: format/lint, dependency boundaries, typecheck, unit/domain, affected contract tests;
  - merge: real-service integration, migration, generated-client drift, security scans, changed-app build;
  - release candidate: E2E, concurrency/high-risk suites, provider conformance, accessibility/visual evidence, canary smoke;
  - scheduled/pre-launch: full cross-browser/device, load, restore, security dynamic tests, AI regressions, and operational tabletop evidence.

## Why

OpenTelemetry/OTLP provides portable correlation and Pino provides mature Node logging while OTel JavaScript logs are still developing. Separate audit preserves immutability and access policy. Layered test tools match their platforms instead of forcing one runner into poor Mobile/browser/system coverage. Real PostgreSQL testing is essential for the selected constraints, migrations, locks, and queues.

## Rejected alternatives

- Direct vendor SDKs in domain code: create telemetry lock-in and data-policy drift.
- Logs only: insufficient for SLOs, latency attribution, queue/provider tracing, and capacity.
- Generic logs as audit: mutable sampling/retention/access semantics do not satisfy privileged evidence.
- One universal test runner: weakens platform-native and browser coverage.
- SQLite/in-memory database as integration gate: cannot prove PostgreSQL constraints, locks, SQL, migrations, or pg-boss behavior.
- Synthetic-only high-risk AI evaluation: misses real distribution and human-calibration evidence.

## Consequences

The repository will operate two JavaScript test runners because Expo compatibility differs from server/Web. Integration tests require containers and are slower. Telemetry schemas/redaction need governance. Audit export needs provider selection and approved retention/legal-hold policy before public privileged production.

## Risks

- Telemetry can leak sensitive data or explode cardinality/cost.
- Instrumentation can affect latency or fail during provider outage.
- E2E/device tests can become flaky and slow.
- Test doubles can diverge from provider behavior.
- Audit stored in the same database has a shared failure domain.

## Mitigations

Schema/redaction review, sampling and budget controls, asynchronous exporters, fail-safe telemetry behavior, stable test IDs/accessibility semantics, quarantine policy with owner/deadline, provider conformance/sandbox tests, restore drills, separate audit roles/backups, hash-chain verification, and required WORM export.

## Scaling path

Begin with one collector/backend path and risk-focused test matrix. Add collectors, tail sampling, separate telemetry projects, long-term archive, performance test capacity, and device farms only when volume or release cadence requires. Audit archive and paging backend are selected before public launch. Testing remains contract-centered as services extract.

## Security implications

Telemetry endpoints use TLS/authentication and least privilege. Redact at source before export. Sampling never bypasses audit requirements. Sensitive debug modes are disabled in production. Test fixtures are synthetic/minimized and never use production credentials or uncontrolled live financial/safety actions.

## Testing implications

This ADR defines the test layers. Each domain/flow must add positive, negative, failure, race, idempotency, privacy/redaction, observability, and rollback evidence proportionate to risk. CI failure cannot be waived silently; exceptions need owner, reason, expiry, and compensating checks.

## Migration/reversibility

OTLP and structured logs allow telemetry backend replacement by dual export and dashboard/alert parity. Audit archive providers can change without changing the versioned event/batch contract. Test tools are repository concerns; generated contracts and behavior fixtures permit gradual replacement, but real PostgreSQL and cross-platform coverage remain invariants.

## Status

| Decision | Classification |
|---|---|
| OpenTelemetry traces/metrics with OTLP | LOCK NOW |
| Pino structured correlated logs | LOCK NOW |
| Separate append-only PostgreSQL audit store initially | LOCK NOW |
| Vitest, `jest-expo`, Playwright, Maestro, and Testcontainers stack | LOCK NOW |
| Telemetry/error-monitoring/paging backend | DEFER UNTIL PROVIDER INTEGRATION |
| Append-protected/WORM audit archive provider | DEFER UNTIL PROVIDER INTEGRATION |
| Additional device farm and load infrastructure | DEFER UNTIL SCALE REQUIRES |
| Generic logs as audit or mock-only database tests | REJECTED |
