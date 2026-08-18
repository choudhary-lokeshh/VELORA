# System overview

## Purpose and scope

Define Velora system boundaries for an adults-only social platform with future creator clubs. Consumer Web and Mobile use one account ecosystem; Creator Studio and Platform Admin are separate clients. This document is authoritative for surface separation, not domain behavior.

```mermaid
flowchart TB
  CW[Consumer Web] --> API[Shared API / domain boundary]
  CM[Consumer Mobile] --> API
  CS[Creator Studio] --> API
  PA[Platform Admin] --> API
  API --> D[Owned domain modules]
  D --> ID[Identity Assurance evidence domain]
  API --> AI[Isolated AI Gateway / Orchestrator]
  AI --> C[Registered domain contract tools]
  C --> D
  D --> P[Provider adapter ports]
  AI --> P
  P --> X[Mock or real providers]
```

## Product surfaces and permissions

- Consumer: own profile, discovery, introductions, chat, availability, safety controls, eligible premium features.
- Creator Studio: creator business profile, club/content tools, club analytics, earnings views. It never grants platform-wide operational authority.
- Platform Admin: audited operations across modules. It requests actions from domain services; it does not directly mutate arbitrary storage.
- Shared API/domain: canonical identity, authorization, lifecycle rules, contracts, audits, and provider abstractions.
- Identity Assurance: provider-neutral verification attempts and append-only assurance evidence. It links to AUTH principals and owner objects but is neither a second authentication system nor authority for creator, safety, entitlement, payment, payout, or enforcement decisions.
- AI Gateway/Orchestrator: optional isolated capability using approved provider adapters and registered domain tools. It never owns or bypasses domain truth.

Surface navigation and UI responsibility are authoritative in `docs/surfaces/`. Approved Figma owns visual/interaction specification only; it cannot change phase, permissions, domain state, or compliance gates.

## Architectural direction

The repository begins with a Bun/Elysia modular-monolith composition root, separate BullMQ worker role, PostgreSQL plus logically separated ephemeral/queue Redis foundations, neutral client shells, and explicit domain-contract seams under [technical stack authority](09-technical-stack.md) and [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). Split services only when load, team boundaries, or isolation evidence demands it. Never make client-to-database or client-to-provider shortcuts.

## Non-goals

No production vendor selection, global content policy approval, real payout connection, product-feature implementation, or production screen set. The approved Master Visual Language is a visual foundation, not feature enablement. Club content and mature/explicit capability are not V1 defaults.

## Data and security

Each record has one owning domain; other domains retain IDs or read through contracts. All externally initiated mutation carries actor, authorization context, correlation ID, idempotency key where retryable, and audit trail where sensitive. Private media requires entitlement authorization before signed delivery.

## Dependencies and phase

Depends on domain boundaries, contracts, data ownership, and security baseline. V1 establishes shared API/domain seam, consumer core, Trust & Safety, Admin foundation, and the provider-neutral Identity Assurance core. Consumer stronger-assurance and Creator verification workflows remain Phase 2; commercial KYC/payout exposure remains Phase 3; AI product capabilities follow [product phases](../product/01-product-phases.md); explicit mature capability remains Conditional / Compliance-Gated.

## Open questions

See [open decisions](../decisions/DECISIONS_REQUIRED.md): jurisdiction launch list, identity/age provider, production infrastructure/providers, product policies, and legal/design gates.

## Cross-references

[Repository shape](02-repository-shape.md), [domain boundaries](03-domain-boundaries.md), [AI platform](../ai/01-ai-platform-architecture.md), [surface authority](../DOCS_INDEX.md#product-surface-authority), [Figma authority](../design/03-figma-source-of-truth.md), [phases](../product/01-product-phases.md), [security baseline](../security/01-security-baseline.md).
