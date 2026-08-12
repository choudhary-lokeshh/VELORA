# AI observability, budgets, and evaluations

## Purpose and authority

This document is the primary authority for AI tracing, usage/cost/latency/failure observability, quotas, evaluation, regression, drift response, and release gates. General observability and testing requirements still apply. Passing evaluation never grants product phase, domain access, or authorization.

## Run telemetry

Every run has one correlation/run ID linking Gateway request, capability/prompt/output versions, provider adapter/model route, routing reason, context source identifiers and trust classes, retrieval/index versions, validation and safety decisions, tool proposals/outcomes, human approval references, retry/fallback, budget use, async job/checkpoint, and final domain-confirmed status.

Measure input/output units, retrieval/embedding usage, tool/provider calls, queue delay, time to first output where relevant, total latency, retries, validation/refusal/denial rate, failure class, cache use, estimated and settled provider cost, and budget denial. Metrics are segmented by capability, route, data/safety class, country/channel, and release state where privacy permits.

Telemetry defaults to metadata and redacted/pseudonymized references. Raw prompts, completions, tool payloads, private RAG chunks, memory, messages, media, moderation evidence, credentials, and secrets do not enter generic logs, traces, or ANALYTICS. ANALYTICS owns product metric definitions; AI cost records are operational data, not BILLING customer-money truth.

## Budgets, quotas, and rate controls

Admission and runtime enforce limits by capability, actor/account, device/client, country/channel, provider route, risk tier, and time window where relevant:

- requests, input/output units, context bytes, retrievals, and embeddings;
- tool calls, orchestration steps, recursion depth, retries, and fallbacks;
- wall-clock time, concurrent runs, queue depth/age, and batch size;
- per-run, daily, monthly, tenant/creator, and platform spend;
- provider-specific rate, capacity, and circuit-breaker limits.

Hard ceilings prevent unbounded loops. Budget exhaustion stops new work safely, records explicit status, and cannot leave an untracked domain effect. Reservation/reconciliation handles delayed provider usage reports. Cost or availability pressure cannot select a route that weakens privacy, safety, evaluation, or residency.

## Evaluation framework

Each capability version declares owner, risk tier, representative datasets, metrics, thresholds, approval roles, failure/rollback criteria, and human-operations readiness. Evaluation covers:

- task correctness, instruction adherence, uncertainty, citation quality, multilingual and accessibility behavior;
- structured-output validity, prompt variables, tool schemas, adapter normalization, and portability;
- tool selection, argument validity, authorization denial, stale approval, idempotency, and confirmed effects;
- prompt injection, indirect injection/RAG poisoning, data extraction, tool misuse, harmful output, arbitrary fetch, excessive agency, and budget exhaustion;
- privacy minimization, route eligibility, redaction, memory consent/deletion, source revocation, retention, and telemetry leakage;
- malformed/truncated output, timeout, provider outage, fallback, duplicate jobs, cancellation, drift, and queue/DLQ recovery;
- latency, throughput, cost, quotas, degradation, and provider capacity;
- human calibration, false positive/negative patterns, disagreement, and automation bias for moderation or other judgment assistance;
- hallucination-sensitive workflows, requiring source-grounded answers, explicit uncertainty, safe refusal, or human review as capability demands.

Evaluation data is versioned, access-controlled, policy-labeled, and separated into development, regression, and holdout sets. Synthetic data cannot be sole evidence for high-risk capabilities. Production content is not sampled by default.

## Regression and release gates

Re-run affected suites after any provider/model/alias, adapter, prompt/template, schema, tool contract, capability policy, context builder, memory behavior, RAG corpus/chunking/embedding/index, safety filter, quota/budget, approval workflow, or provider-data-term change.

Release requires valid phase and feature gate, data-flow/threat/privacy review, passing thresholds, authorization/approval tests, cost/latency capacity, dashboards/alerts, operational staffing where needed, adapter conformance, canary/limited rollout, rollback target, and owner sign-off. High-risk capability requires independent security/safety/domain review defined by governance.

Versions progress through `disabled -> evaluation -> limited/canary -> active -> suspended -> retired`. Rollback disables capability, route, tool, or restores a prior approved immutable version. Production feedback never updates prompts, memory, RAG, or models automatically.

## Runtime monitoring and response

Monitor route mix, quality proxies, validation/refusal rates, injection/tool-denial signals, authorization failures, approval queue age, human override/disagreement, retrieval freshness/access failures, memory writes/deletes, spend, latency percentiles, provider errors, fallback rate, async queue/DLQ, and confirmed tool outcomes.

Deterministic policy may suspend a route/capability after unsafe output, privacy event, quality drift, anomalous tool proposals, provider change, cost spike, or SLO breach. Suspension stops new work/effects, preserves redacted evidence, and never changes authoritative domain state.

## Provider portability

Portability is proven by adapter contract tests, normalized errors/usage, feature matrix, structured-output compatibility, privacy/residency review, safety comparisons, and replay of approved evaluation sets. Every fallback provider/model passes the same capability gates before activation.

## Phase and open decisions

Evaluation and observability foundations are prerequisites for first AI capability, not V1 product capabilities. See [general observability](../engineering/04-observability.md), [testing/release](../engineering/05-testing-release.md), [jobs](../engineering/03-jobs-idempotency-concurrency.md), and [platform health](../operations/05-platform-health.md).

`DECISION REQUIRED`: evaluation owner and thresholds, approved datasets and label process, content sampling, provider-cost accounting source, quota/spend ceilings, SLOs, alerts, model pinning/drift policy, canary size, rollback triggers, and portability baseline.
