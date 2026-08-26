# AI platform integration boundary

## Purpose

Integrate AI PLATFORM into Velora's system and domain architecture. Dedicated [AI documentation](../ai/01-ai-platform-architecture.md) is primary authority for AI-specific design.

## Architectural invariant

AI PLATFORM is a first-class, isolated platform capability, never a business source-of-truth domain. It must never own or replace AUTH, USERS, DISCOVERY, MESSAGING, REALTIME, CREATORS, PRIVATE CLUBS, BILLING, PAYOUTS, TRUST & SAFETY, MODERATION, NOTIFICATIONS, ADMIN, or ANALYTICS truth.

AI accesses another domain only through a published, versioned contract registered as a tool. It has no direct access to private domain persistence. Model output is untrusted and non-authoritative; owning domain authenticates, authorizes, validates, persists, and audits every effect.

## System integration

All product clients enter through AI Gateway. Gateway and Orchestrator enforce capability/phase admission, approved context, provider/model adapter routing, strict tool registration, structured validation, budgets, tracing, evaluations, and human approval pauses. Provider/model choices remain behind adapters.

Payment/refund/payout, enforcement/ban, account/security, entitlement, deletion, privileged role/configuration, sensitive publication, and comparable high-impact actions require deterministic domain authorization and governed human approval/workflow. AI recommendation never constitutes authorization.

## Data, events, and phase

AI run/context/memory/RAG data is derived and follows source authorization, classification, retention, deletion, and residency. AI emits minimized operational facts; ADMIN/owning workflow retains approval truth, owning domains retain operation/audit truth, and ANALYTICS owns metric definitions.

No AI product capability is V1. Phase authority remains [product phases](../product/01-product-phases.md). [ADR-0012](../decisions/ADR-0012-ai-platform-runtime.md), as superseded only for backend mechanics by [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md), selects the explicit TypeScript Gateway/orchestrator, PostgreSQL run state, BullMQ workers, JSON Schema outputs, and OpenTelemetry API boundary. Provider, model, embedding, hosting, durable-memory, and vector/index choices remain deferred until their integration/feature gates.

[ADR-0033](../decisions/ADR-0033-local-test-ai-suggestion-platform.md) implements a synchronous, tool-free local/test slice inside the existing API. It uses published USERS and CREATORS predicates rather than private persistence, gives Admin only a caller-built minimized case projection, retains redacted AI-owned operational evidence, and keeps every business effect outside AI. Configuration makes the provider unavailable and kill switch enabled by default and refuses any live-like activation in staging/production.

## Required reading

Read all documents in [dedicated AI section](../DOCS_INDEX.md#ai-authority), [domain boundaries](03-domain-boundaries.md), [provider adapters](06-provider-adapters.md), [AI-assisted action](../flows/ai-assisted-action.md), and every affected domain authority.
