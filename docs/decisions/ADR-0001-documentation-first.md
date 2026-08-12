# ADR-0001: Documentation-first domain specification

- Status: Accepted for current pre-code phase
- Date: 2026-08-12

## Context

Velora has multiple future clients, high-risk safety/financial paths, creator commerce, and uncertain provider/legal choices. Premature framework/vendor code would hide unresolved product decisions and encourage boundary leaks.

## Decision

Before application code, maintain Markdown specifications as implementation authority: system/product phase, domain ownership, core flows, security, engineering discipline, accepted technical ADRs, and explicit open decisions. Future code changes must follow `AGENTS.md`, read `DOCS_INDEX.md`, and update relevant authority when behavior changes. Domains interact through documented contracts/services/events. Runtime topology is now selected by ADR-0003 through ADR-0014 without changing this documentation-first rule.

## Consequences

Implementation is slower only until required choices become explicit, then vertical slices can be built/tested without guessing. Documentation needs ongoing review and may reveal decisions requiring an ADR. This ADR itself did not select a framework, database, cloud, provider, legal policy, or service topology; later accepted ADRs select technical architecture while providers and policy remain gated.

## Cross-references

[DOCS_INDEX](../DOCS_INDEX.md), [domain boundaries](../architecture/03-domain-boundaries.md), [open decisions](DECISIONS_REQUIRED.md).
