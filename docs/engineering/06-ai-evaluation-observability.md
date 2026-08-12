# AI engineering integration boundary

## Purpose

Bind AI work to Velora's general jobs, observability, testing, and release discipline. Dedicated [AI observability, budgets, and evaluations](../ai/05-ai-observability-budgets-evals.md) is primary authority for AI-specific evidence and telemetry.

## Invariants

- Every run correlates capability/prompt/output/model route, context source references, validation, tools, approval, budget, cost, latency, failure, and confirmed outcome without copying sensitive content into generic telemetry.
- Every capability version has representative correctness, structured-output, authorization, safety, privacy, reliability, human-calibration where relevant, latency, cost, and portability evaluation.
- Model/provider aliases, prompts, schemas, tools, context/memory/RAG, safety, budgets, and approval changes trigger affected regression suites.
- AI async work is durable, bounded, idempotent, checkpointed, cancellable where feasible, and dead-lettered; it re-authorizes sensitive access/effects on resume.
- Release requires valid phase, evaluation thresholds, threat/privacy review, dashboards/alerts, operations readiness, canary, rollback, and owner approvals.
- Passing evaluation never grants product phase, data access, tool permission, approval, or domain authorization.

## Required reading

Read [AI evaluation authority](../ai/05-ai-observability-budgets-evals.md), [jobs/idempotency](03-jobs-idempotency-concurrency.md), [general observability](04-observability.md), [testing/release](05-testing-release.md), and [AI platform](../ai/01-ai-platform-architecture.md).

Evaluation runtime uses the repository-owned harness and provider adapters selected by [ADR-0012](../decisions/ADR-0012-ai-platform-runtime.md) and [ADR-0013](../decisions/ADR-0013-observability-testing.md). Datasets, thresholds, human labeling, SLOs, provider-cost source, sampling, and release governance remain `DECISION REQUIRED` before each AI release.
