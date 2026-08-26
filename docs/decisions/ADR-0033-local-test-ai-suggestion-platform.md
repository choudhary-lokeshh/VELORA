# ADR-0033: Local/test AI suggestion platform and review-only product surfaces

- Decision date: 2026-08-26
- ADR status: Accepted
- Owners: Founder (decision owner), AI PLATFORM, Consumer, CREATORS, ADMIN, security, privacy, operations

## Context

[ADR-0002](ADR-0002-isolated-ai-platform.md) and [ADR-0012](ADR-0012-ai-platform-runtime.md) lock an isolated, provider-neutral AI platform, but intentionally leave provider/model selection and production capability activation unresolved. Product phase authority classifies approved consumer, creator, and Admin draft assistance as Phase 3 while excluding it from V1.

The completion workstream needs executable platform and product proof without selecting a live provider, transmitting private data, granting AI a domain tool, or making generated text an action. A frontend-only demo would not prove admission, durable budgets, cancellation, failure handling, schema validation, privacy, or provider portability.

## Decision

Implement a synchronous, bounded AI suggestion slice behind `apps/api` with these rules:

- `POST /v1/ai/suggestions` is the sole generation entry point and `POST /v1/ai/runs/cancellation` cancels only a caller-owned active run.
- Every request carries a client-created UUID run identity. Reuse returns a conflict and rolls back the attempted usage reservation. It never creates or charges a second run.
- Capability manifests form the prompt/task registry and pin prompt, output-schema, and safety-policy versions. The model registry contains only the evaluated local/test text-suggestion route; composition rejects an unregistered configured provider/model pair. Each durable run additionally pins the selected provider and model identifiers.
- The provider port is an async stream with `AbortSignal`; the gateway applies an eight-second timeout, a single retry only before any output, a 2,000-character output ceiling, strict response parsing, and explicit failure.
- The only working adapter is deterministic, network-free, and named `local-test`. `unavailable` is the default. Staging and production configuration reject `local-test` and reject a disabled AI kill switch, so no deployed live route is approved by this ADR.
- PostgreSQL owns capability activation, run state, append-only run events, and daily actor usage/cost totals. Local/test activation rows are exact version pins. Runs/events are protected from deletion and completed runs from semantic mutation.
- AI tables retain digests, counts, versions, state, cost, timestamps, actor/audience, and correlation identity. They have no columns for raw context, drafts, prompts, messages, evidence, or output.
- Admission checks the authenticated surface audience and current owner truth through published USERS or CREATORS services. Admin requires current phishing-resistant assurance. AI reads no other domain persistence.
- This slice registers no tools, memory, RAG, retrieval, arbitrary network, or autonomous loop. Adding any requires its own approved capability and the existing authorities.
- Consumer Web and Mobile offer editable profile and conversation suggestions. Creator Studio offers editable bio, title, caption, description, content-idea, and club-announcement scratchpad suggestions. Save, Send, and Publish remain separate existing controls.
- Platform Admin can request only a review note built from bounded case metadata and counts. Report prose, evidence references, target identity, and raw safety evidence do not cross the AI boundary. The panel has no claim, triage, decision, enforcement, or other effect channel.

## Why

This creates real evidence for the platform contract while keeping the production decision honest. A future provider must fit the same streaming/cancellation and normalized usage port, pass repository-owned evaluation, and satisfy privacy/residency/terms review before configuration can admit it. Product code demonstrates user control without giving model output authority.

## Rejected alternatives

**Direct client-to-provider calls.** They bypass secrets, capability admission, budgets, schema enforcement, audit, cancellation ownership, and production refusal.

**Persisting prompts/completions for debugging.** Raw product and safety content would create an unnecessary secondary sensitive store. Digests and bounded metadata are enough for current deterministic regression evidence.

**Using report prose or raw evidence for Admin summaries.** That would broaden provider exposure and copy the highest-risk content into a non-authoritative system. This release uses a bounded metadata projection only.

**Letting an AI control save/send/publish or Admin actions.** A generated draft is untrusted text. Existing product and owner-domain controls remain the only effect path.

**Calling the deterministic adapter a production fallback.** It is synthetic test behavior, not a model, and configuration rejects it in deployed environments.

## Consequences

- Local/test can exercise provider streaming, cancellation, retry, timeout, rate budget, durable audit, redaction, and all product draft flows end to end.
- The daily limit is 50 admitted runs per actor and the current synchronous timeout is eight seconds. Changing either is a policy/version change requiring regression and documentation review.
- No provider cost is fabricated: the deterministic adapter settles zero microunits.
- No live AI capability, provider, model, country, retention schedule, sampling policy, SLO, evaluation threshold, or production design approval is granted.
- Phase 3 product classification is unchanged. This ADR records implementation evidence, not V1 enablement.

## Verification and rollback

Real PostgreSQL tests cover registered model/task routing, version-pinned activation, terminal/audit immutability, raw-content absence, audience ownership, injection/secret refusal, oversized input, cross-caller isolation, run-identity collision, bounded retry, persistent provider failure, timeout, oversized/malformed output, inert action-shaped output, cancellation ownership, and durable daily rate enforcement. Product suites prove suggestions remain editable and cause no implicit Save, Send, Publish, or Admin action. Browser journeys run the real API and local/test adapter for bio edit/save, chat edit/explicit Send, and Creator caption edit/normal Publish.

Rollback is configuration-first: enable the kill switch or leave `AI_PROVIDER=unavailable`. Capability activation rows can disable one capability/version without changing another domain. Code and migration rollback must preserve retained run/event evidence; no domain truth requires migration through AI.

## Cross-references

[AI platform](../ai/01-ai-platform-architecture.md), [capabilities/tools](../ai/02-ai-capabilities-tools.md), [AI safety](../ai/04-ai-safety-security.md), [AI observability/evaluation](../ai/05-ai-observability-budgets-evals.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [AI action flow](../flows/ai-assisted-action.md), [AI security integration](../security/07-ai-safety-privacy.md), [product phases](../product/01-product-phases.md), [ADR-0002](ADR-0002-isolated-ai-platform.md), [ADR-0012](ADR-0012-ai-platform-runtime.md), and [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md).

## Status

| Decision | Classification |
|---|---|
| Gateway, provider-neutral streaming/cancellation port, version pins, PostgreSQL run/budget evidence | LOCK NOW |
| Draft-only Consumer, Creator, and bounded Admin metadata capabilities | Local/test implementation evidence; Phase 3 product classification |
| Tool use, memory, RAG, retrieval, autonomous effects | Disabled / absent; separate approval required |
| Deterministic provider | Local/test only |
| Production provider/model/routes, evaluation thresholds, data terms, countries, SLOs and activation | DEFER UNTIL PROVIDER INTEGRATION / LEGAL-PRIVACY-SECURITY REVIEW REQUIRED |
