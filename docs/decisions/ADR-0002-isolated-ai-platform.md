# ADR-0002: Isolated, provider-neutral AI platform

- Status: Accepted architectural boundary; runtime defined by ADR-0012
- Date: 2026-08-12

## Context

Velora may add AI assistance across consumer, creator, moderation, and Admin surfaces. Direct client-to-model integration, provider-specific product code, unrestricted tool use, or model-owned business state would bypass existing domain, security, privacy, safety, and approval invariants.

## Decision

Introduce AI PLATFORM as an isolated orchestration capability behind an AI Gateway. AI provider/models remain behind adapters. AI accesses authoritative domains only through registered published contracts/tools. Owning domains authenticate, authorize, validate, and persist every effect.

AI output is untrusted and non-authoritative. Prompt/tool registries, structured validation, context provenance, optional consent-based non-authoritative memory, RAG projections, budgets, tracing, evaluation, and human approval boundaries are mandatory parts of the AI architecture. High-impact operations require deterministic domain authorization and governed human workflow; AI cannot approve its own recommendation.

Product capability timing remains governed by `docs/product/01-product-phases.md`. This ADR does not select a vendor, model, hosting/runtime, vector store, orchestration framework, prompt/evaluation product, or provider. [ADR-0012](ADR-0012-ai-platform-runtime.md) later selects the provider-neutral Velora runtime shape without selecting a provider/model or enabling a product capability.

## Consequences

- All AI clients use one policy and observability boundary rather than provider SDKs.
- Provider/model replacement is possible only after adapter conformance and capability evaluation.
- Tool access is explicit, scoped, revocable, auditable, and independently authorized by domain owner.
- Memory and RAG add derived data that must follow source authorization, provenance, privacy, retention, and deletion.
- AI capability release requires evaluation, safety/privacy review, budgets, observability, and rollback evidence.
- Additional technical-stack ADRs are required before implementation.

## Cross-references

[AI platform](../ai/01-ai-platform-architecture.md), [AI capabilities/tools](../ai/02-ai-capabilities-tools.md), [AI context/memory/RAG](../ai/03-ai-context-memory-rag.md), [AI safety/security](../ai/04-ai-safety-security.md), [AI evaluation](../ai/05-ai-observability-budgets-evals.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [AI action flow](../flows/ai-assisted-action.md), [domain boundaries](../architecture/03-domain-boundaries.md), [open decisions](DECISIONS_REQUIRED.md).
