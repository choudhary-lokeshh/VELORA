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

Selected stack: `bun:test` for API/backend units and runtime integration; Vitest for packages/Web units; Testing Library for React; `jest-expo` plus React Native Testing Library for Mobile; Node Testcontainers orchestration with real PostgreSQL and Redis/BullMQ; Playwright for Web E2E; and Maestro for future iOS/Android journeys. CI is `.github/workflows/verify.yml`, locked by [ADR-0018](../decisions/ADR-0018-toolchain-provisioning-verification-ci.md). It provisions the pinned toolchain from `mise.toml` and invokes the canonical `pnpm ci:verify` graph rather than restating it: exact runtime/package-manager preflight, frozen install/workspace policy, formatting, lint, dependency boundaries, strict typecheck, contract drift, AUTH policy assertions, real migration/queue/worker tests, Web/Mobile builds, browser security-header assertions, secret scan, the dependency security gate, and tracked/untracked hygiene. It also runs daily so dependency acceptance expiry fires without a commit. It must fail truthfully while an unapproved advisory breaches threshold.

The dependency security gate runs the real audit, prints raw advisory evidence, and permits only exact, unexpired, owner-signed records in the [dependency risk acceptance register](../security/08-dependency-risk-acceptance.md). Integration tests run against real containers, so their failure output is a contract, not a convenience. The runner emits a JUnit report alongside console output and reprints a self-contained `INTEGRATION FAILURE DIAGNOSTICS` block at the very end of a failing run: the exact failing test names with file and line, the assertion and stack, container status and published-port mappings compared against the endpoints handed to the tests, and the tail of each container's log. Everything printed is redacted, so a connection URI never appears with its userinfo. A summary such as `10 pass / 1 fail` alone is treated as a defect in the harness.

Container endpoints are resolved when they are used, never cached across a restart. Testcontainers publishes an ephemeral host port and Docker allocates a new one on every container start, so a URL captured before a restart points at a port that no longer exists. Lifecycle waits are bounded polls on a real condition with a described timeout; fixed sleeps are not an acceptable synchronisation mechanism.

It reports `PASS`, `PASS WITH EXPLICIT TEMPORARY ACCEPTED RISK`, or `FAIL`, never a plain `PASS` that hides an accepted high finding, and it self-tests its own decision logic with negative probes on every run — including probes that spawn a real process emitting malformed audit output, because an audit that cannot run must fail rather than report zero advisories. CI/CD behavior, immutable OCI artifact promotion, staging, canary, migrations, and rollback follow [ADR-0013](../decisions/ADR-0013-observability-testing.md), [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md), and [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md).

## Non-goals and open questions

Deployment CI vendor, device farm, load/security service vendors, exact SLOs, and public-launch approval roles remain unresolved; the verification CI platform is locked by [ADR-0018](../decisions/ADR-0018-toolchain-provisioning-verification-ci.md). CI gates, environments, OpenFeature boundary, and release flow are locked. V1 engineering standard. See [AGENTS](../../AGENTS.md), [API contracts](01-api-contracts.md), [jobs](03-jobs-idempotency-concurrency.md), [Figma authority](../design/03-figma-source-of-truth.md), [platform health](../operations/05-platform-health.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).
