# AI capabilities, tools, and approvals

## Purpose and authority

This document is the primary authority for AI capability registration, tool contracts, strict tool authorization, effect classes, human-in-the-loop handling, and approval binding. Owning domains remain authoritative for every read, mutation, business rule, and audit outcome.

## Capability registry

Every AI capability has a stable ID and immutable version containing:

- product surface, product phase, purpose, owner, and risk tier;
- permitted actor classes, countries, channels, and rollout state;
- input and output schemas, prompt/output versions, and allowed provider routes;
- approved context sources, memory policy, retrieval policy, and data classes;
- exact tool allowlist and maximum tool steps;
- safety policy, effect class, confirmation and approval rules;
- request, latency, concurrency, usage, and cost limits;
- retention, audit, observability, evaluation suite, and rollback target.

Unknown or inactive capability IDs fail closed. Registration does not grant domain access.

## Tool registry contract

Every tool entry declares:

- stable tool ID, version, owning domain, and published contract;
- explicit input and output schema;
- actor, object, creator/tenant, country, and purpose scope;
- read, draft, low-impact, high-impact, or prohibited effect class;
- deterministic authorization and current-state preconditions;
- data classification, minimization, and result-redaction policy;
- confirmation, step-up, single/dual approval, and separation-of-duty rules;
- idempotency scope, concurrency/version guard, retry policy, timeout, and cost limit;
- audit event, correlation requirements, and compensating owner workflow;
- capability allowlist and supported lifecycle state.

Models receive only minimal descriptions for currently allowed tools. They never receive service credentials, generic database access, arbitrary query execution, unrestricted code execution, provider secrets, or a general HTTP client.

## Effect classes

| Class | Permitted AI role | Required control |
|---|---|---|
| Read-only | Request an actor-authorized, minimized projection | Domain object authorization, purpose check, rate limit, audit where sensitive |
| Draft/recommend | Create labeled draft, summary, classification, or operation proposal | No mutation; provenance and limitations retained |
| Low-impact effect | Propose a registered reversible user action such as saving a draft or approved preference | Explicit user confirmation, domain re-authorization, idempotency, audit as required |
| High-impact effect | Prepare a request or recommendation only | Governed human approval, step-up or dual control where required, then domain authorization and audit |
| Prohibited | No execution or proposal channel that creates access | Deny and record security signal |

High-impact includes payment, refund, payout, enforcement, ban, account/security changes, entitlement changes, deletion, privileged role/configuration, sensitive publication, and comparable irreversible or regulated actions. AI recommendation, confidence, generated rationale, or generated approval text never constitutes authorization.

## Tool authorization sequence

1. Model may propose a typed tool request only from current capability allowlist.
2. Orchestrator validates tool/version, schema, argument bounds, target, effect class, budget, and actor delegation.
3. Policy layer checks capability state, current phase/country/channel, confirmation, and approval requirement.
4. Owning domain authenticates the delegated actor and independently authorizes action/object against current state.
5. Effecting calls apply owner-defined idempotency, transaction/version, audit, and provider rules.
6. Tool result is minimized, classified, trust-labeled, and returned as data, never instructions.

An earlier Gateway check, cached projection, model decision, or human approval cannot replace owning-domain authorization at execution.

## Human-in-the-loop and approval binding

Approval-required proposals pause in durable state. Reviewer must see the exact target, arguments, expected effect, data sources, model limitations, policy reason, conflict/current-state information, and whether the action can be reversed. Reviewer acts through existing RBAC, scope, assurance, and separation-of-duty rules.

Approval binds approver identity, requester identity, capability/prompt/tool versions, exact arguments, target, effect, source-version references, expiry, and required approval count. Changed arguments, target, material source, policy version, role, consent, feature gate, or owner state invalidates approval. AI cannot approve, simulate approval, choose a weaker approval route, or execute after approval expiry.

ADMIN or another documented owning workflow stores authoritative approval. AI stores only a reference and non-authoritative run projection. Owning domain stores authoritative execution and outcome.

## Failures and concurrency

Unknown tools, scope expansion, malformed arguments, revoked authorization, stale approval, budget exhaustion, or domain denial stop the step. Provider/domain ambiguity remains pending and follows owner reconciliation. Bounded model retry cannot repeat an effect; tool-effect idempotency returns the original result or current safe state.

Tool availability is revocable independently of model/prompt versions. Emergency disable can suspend a capability, route, or tool without changing domain truth.

## Phase and open decisions

## Implemented local/test registry

The [ADR-0033](../decisions/ADR-0033-local-test-ai-suggestion-platform.md) registry contains nine draft/recommend capabilities: consumer profile bio and chat reply; creator profile bio, caption, title, description, content idea, and club announcement; and Admin case summary. Each pins prompt `2026-08-26.1`, output schema `suggestion.v1`, and safety policy `draft-safety.1`; activation is exact on environment, capability, and those versions.

All nine have zero tools and zero effect steps. Their only output is bounded editable text. The ordinary Save, Send, Publish, or Admin workflow remains outside AI and is neither proposed nor invoked by the gateway. Unknown, cross-audience, inactive, unavailable-provider, killed, over-budget, malformed, injected, and reused-run requests fail explicitly.

Tool registration follows [product phases](../product/01-product-phases.md) and [AI product surfaces](06-ai-product-surfaces.md). See [AI-assisted action flow](../flows/ai-assisted-action.md), [RBAC](../security/02-access-control-rbac.md), [jobs/idempotency](../engineering/03-jobs-idempotency-concurrency.md), and every tool-owning domain document.

`DECISION REQUIRED`: capability launch set, risk taxonomy, tool review ownership, effect classifications, confirmation/approval matrix, dual-control thresholds, approval expiry, human-review staffing, SLA, and emergency suspension authority.
