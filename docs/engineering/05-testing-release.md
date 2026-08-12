# Testing and release discipline

## Purpose

Define quality gate for future vertical slices. Tests prove documented behavior, especially boundaries and failure modes; they are not substitute for specification updates.

## Required test layers

- Domain unit tests: state transitions, validation, authorization predicates, policy edges.
- Contract tests: API/event schemas, compatibility, client error handling.
- Integration tests: persistence constraints, outbox, idempotency, concurrency races, provider adapters using mocks.
- Security regression tests: object authorization, privilege escalation, session/CSRF as relevant, webhook/replay, redaction, upload/SSRF, rate-limit paths.
- End-to-end slice tests: user-visible happy/alternate/failure flow from authoritative flow document.
- Manual/operational checks: migration/backfill, alert/audit, rollback/feature-flag behavior for high-risk changes.
- AI capability tests: prompt/model/tool/RAG/memory regression, structured-output validation, prompt-injection and data-exfiltration defenses, deterministic authorization/approval boundaries, privacy/deletion, cost/latency, provider portability, drift and safe fallback.
- Surface/design tests: approved Figma traceability, component/screen states, responsive behavior, content/localization extremes, keyboard/touch/screen-reader, contrast, text scaling, reduced motion, deep links, notification entry, and visual regression.
- Compliance/operations tests: country/channel gates, gate revocation, retention/deletion, role/approval separation, incident disable/recovery, provider reconciliation, and runbook/tabletop evidence for high-risk launch paths.

## Release flow

Map change to owning docs/phase/surface and exact approved Figma version where UI applies; write tests; run targeted suite/typecheck/build; review privacy/security/compliance/accessibility/observability/migration/operations impacts; deploy behind controlled configuration where appropriate; verify metrics/audit; retain rollback/compensation. Payment, entitlement, enforcement, deletion, role, provider, or schema changes require explicit concurrency/failure test evidence. AI changes also require evidence from [AI observability, budgets, and evaluations](../ai/05-ai-observability-budgets-evals.md).

Selected stack: Vitest for TypeScript server/domain/Web units, Testing Library for React, `jest-expo` plus React Native Testing Library for Mobile components, Testcontainers with PostgreSQL/Valkey for integration, Playwright for Web E2E, and Maestro for iOS/Android journeys. CI/CD behavior, immutable OCI artifact promotion, staging, canary, migrations, and rollback follow [ADR-0013](../decisions/ADR-0013-observability-testing.md) and [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md).

## Non-goals and open questions

CI vendor, device farm, load/security service vendors, exact SLOs, and public-launch approval roles remain unresolved. CI gates, environments, OpenFeature boundary, and release flow are locked. V1 engineering standard. See [AGENTS](../../AGENTS.md), [API contracts](01-api-contracts.md), [jobs](03-jobs-idempotency-concurrency.md), [Figma authority](../design/03-figma-source-of-truth.md), [platform health](../operations/05-platform-health.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).
