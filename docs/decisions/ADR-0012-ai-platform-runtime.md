# ADR-0012: AI platform runtime and portability

- Decision date: 2026-08-12
- ADR status: Accepted in part; backend/queue implementation superseded by ADR-0016

> Supersession note (2026-08-13): [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md) replaces NestJS, pg-boss, and Valkey implementation detail with Elysia, BullMQ, and logically separated Redis. AI isolation, explicit orchestration, PostgreSQL run/registry/budget truth, deterministic tools/approvals, evaluation gates, and provider/model neutrality remain accepted. AI remains outside V1. Historical implementation analysis below is retained intentionally.

## Context

ADR-0002 makes AI a provider-neutral, isolated platform capability. A technical runtime is now needed for Gateway admission, orchestration, provider routing, tools, prompts, structured output, context, optional memory/RAG, budgets, evaluations, tracing, async work, and human approval. No AI product capability is V1, and no provider/model choice may become product architecture.

## Requirements

- Preserve every invariant in `docs/ai/` and product phase authority.
- Keep AI out of business-domain truth, private repositories, authorization, and approvals.
- Support multiple model/provider adapters, capability-specific routing, strict tools, structured outputs, durable pauses, budgets, and evaluation gates.
- Keep provider/model/prompt/tool changes observable and reversible.
- Support short synchronous tasks plus durable async generation, indexing, evaluation, and approval waits.
- Avoid adopting a general agent framework that silently controls tools, memory, network, or retries.

## Options evaluated

1. Explicit TypeScript AI Gateway/orchestrator state machine in Velora platform modules.
2. Vendor agent SDK or hosted orchestration as platform core.
3. General open-source agent framework.
4. Direct client-to-model calls.
5. Separate AI microservice from first capability.
6. PostgreSQL/pg-boss state with provider-neutral context, memory, retrieval, and vector ports.

## Decision

- Implement AI Gateway as a NestJS module reached only through `apps/api`. It performs deterministic authentication, capability/phase/country/surface admission, request validation, rate/quota/spend reservation, and run creation.
- Implement Orchestrator as an explicit, bounded TypeScript state machine owned by AI PLATFORM. Do not use provider-native agent loops or a generic agent framework as control plane. Every run pins capability, prompt, output schema, safety, route, tool schema, and evaluation release versions.
- Run short answer/draft work in the API only within strict latency/tool limits. Run generation with long latency, tools, RAG ingestion, embeddings, batch evaluation/classification, and approval pauses through dedicated AI worker queues using pg-boss and authoritative PostgreSQL run/checkpoint state.
- Store AI run metadata, immutable release manifests, prompt/output/tool registry metadata, budget reservations/settlement, approval references, evaluation results, and durable derived-data metadata in AI-owned PostgreSQL tables. Do not copy business-domain records into AI tables as truth.
- Keep prompt templates, system policy, examples, JSON Schemas, and capability manifests as immutable version-controlled release artifacts with content digests. PostgreSQL activation records select an approved digest and rollback target; production prompts are not mutable dashboard text.
- Use JSON Schema-compatible structured outputs. Strict parse, type/range/enum/size, semantic, safety, and tool-argument validation occurs outside model. Free text is escaped/labeled and never directly executed.
- Define one provider adapter contract for generation, structured output, streaming/cancel, embeddings/classification where approved, usage, safety metadata, and normalized error categories. Provider/model identifiers and native request types stay inside adapters. Direct provider SDK imports are limited to adapter infrastructure.
- Routing is policy code/data using capability, evaluated quality, modality, data class, country/residency, provider terms, context limit, health, latency, cost, and release status. Fallback uses only an already evaluated equal-or-stricter route. Provider, model, embedding, hosting, and failover choices remain deferred until integration.
- Register AI capabilities and tools through immutable manifests. A tool points to a published owning-domain application contract; AI owns metadata only. Tool execution carries delegated actor context and stable effect ID, then owner domain independently authorizes, validates, executes, persists, and audits.
- Persist approval-required proposals in AI run state, but keep authoritative approval in ADMIN or owning workflow. Resume only after exact binding and current authorization/state checks. AI never approves or supplies assurance.
- Build context through registered source adapters that return minimized, provenance-tagged, authorized projections. Keep short-term context in run memory or TTL Valkey/cache only for the approved retention window; provider logging cannot extend platform retention silently.
- Durable memory is disabled by default. If an approved feature enables it, store memory behind an AI-owned repository port with subject/capability scope, provenance, consent, expiry, inspect/correct/delete controls, and source lifecycle propagation. PostgreSQL is initial metadata/value store unless a feature ADR proves another store necessary.
- RAG is disabled by default. An approved feature uses a corpus registry, durable pg-boss ingestion, source/version/access/deletion metadata in PostgreSQL, and a retrieval/index port. Vector/index and embedding technologies remain a pre-feature decision; indexes are disposable projections and never authorization filters by themselves.
- Enforce authoritative budget reservations and settled cost in PostgreSQL, with Valkey only for fast rate/concurrency counters. Budget, retry, recursion, context, retrieval, tool, latency, queue, and spend ceilings are deterministic.
- Instrument Gateway, Orchestrator, adapter, context, retrieval, validation, tool, approval, budget, and worker steps with OpenTelemetry and redacted AI run metadata. Evaluation harness uses repository-owned versioned datasets/runners and provider adapters, not a provider dashboard as sole evidence.
- All model-requested web access uses the isolated outbound retrieval boundary from ADR-0014. Models receive no general HTTP, SQL, storage, code-execution, or credential tool.

## Why

An explicit state machine keeps control, retries, tool authorization, approval, and cost visible in Velora code and data. Reusing PostgreSQL, pg-boss, JSON Schema, and OpenTelemetry avoids a new control plane while preserving durable asynchronous behavior. Provider adapters and repository-owned evaluations make portability testable rather than aspirational.

## Rejected alternatives

- Direct client/provider SDK calls: bypass Gateway policy, secrets, budgets, evaluation, and domain contracts.
- Vendor agent runtime as core: couples tools, state, traces, and retry semantics to one vendor.
- General agent framework initially: adds implicit loops/memory/tool behavior and a large security/upgrade surface before proven need.
- AI microservice immediately: adds network and deployment complexity before any AI product capability exists.
- Model-selected arbitrary tools/network: conflicts with deterministic authorization and SSRF boundaries.
- AI-owned copies of business state: violate source-of-truth architecture.

## Consequences

Initial AI capability work includes platform/evaluation groundwork before visible features. Provider convenience APIs may be wrapped or rejected. PostgreSQL and workers hold orchestration state. Memory/RAG do not exist until separately approved even though ports are defined.

## Risks

- Custom orchestration can grow into an unmaintainable framework.
- Provider capabilities and structured-output semantics vary.
- Prompt/tool version changes can produce hidden regressions.
- Long-lived approval runs can resume with stale permission/context.
- AI metadata, traces, memory, or RAG can leak private data.

## Mitigations

Keep states/steps small and capability-specific; use adapter conformance and portability evals; immutable version pins; re-authorization on every resume/read/effect; strict schemas; context minimization; no raw generic telemetry; deletion propagation; hard budgets; emergency route/tool/corpus disable; security/privacy review.

## Scaling path

Phase 2 starts moderation assistance with dedicated queues and one or more evaluated routes. Phase 3 scales API admission and AI workers independently, separates ingestion/evaluation queues, and may add vector infrastructure after ADR. Extract AI Gateway/workers into a service only when isolation, team ownership, provider egress, or load metrics require it; domain tools remain contracts.

## Security implications

All AI inputs/outputs are untrusted. Provider credentials stay in adapter runtime secrets. Capability/tool allowlists, owner authorization, SSRF-safe egress, PII minimization, country/residency routing, prompt-injection defenses, output validation, bounded loops, approval binding, and audit are mandatory. AI has no privileged principal role.

## Testing implications

Require state-machine, adapter conformance, structured-output, retry/idempotency, budget, cancellation, provider outage/fallback, prompt injection, exfiltration, tool authorization/approval, stale resume, context isolation, memory deletion, RAG access/revocation, telemetry redaction, evaluation regression, cost/latency, and portability tests.

## Migration/reversibility

Immutable manifests and provider-neutral run/tool contracts permit provider or model replacement after evaluation. Prompt/schema versions roll back by activation pointer. A future orchestration engine must import/export run state and shadow execute before cutover. Derived memory/index stores are rebuildable or deletable through ports; domain truth is never migrated through AI.

## Status

| Decision | Classification |
|---|---|
| NestJS AI Gateway and explicit TypeScript orchestrator | LOCK NOW |
| PostgreSQL run/registry/budget state and pg-boss AI workers | LOCK NOW |
| Version-controlled immutable prompts and JSON Schemas | LOCK NOW |
| Provider/model adapter and evaluated routing boundary | LOCK NOW |
| AI provider, model, embedding, and hosting routes | DEFER UNTIL PROVIDER INTEGRATION |
| Durable memory capability and store | DECISION REQUIRED BEFORE FEATURE |
| RAG/vector/index/embedding implementation | DECISION REQUIRED BEFORE FEATURE |
| Separate AI service extraction | DEFER UNTIL SCALE REQUIRES |
| Direct provider use or generic autonomous agent framework | REJECTED |
