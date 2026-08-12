# Intended repository shape

## Purpose

Define future code placement and allowed dependency direction. This is conceptual; do not create application folders in documentation phase.

```text
apps/
  web/             consumer web client
  mobile/          consumer mobile client
  creator-studio/  creator business client
  admin/           privileged operations client
  api/             shared API composition/runtime
packages/
  types/           stable shared value types, not domain behavior
  validation/      shared input/schema validation
  api-client/      generated/handwritten contract clients
  domain/          bounded domain modules and published contracts
  config/          typed non-secret configuration interfaces
  observability/   structured telemetry primitives
docs/
  product/ architecture/ domains/ flows/ security/ engineering/
  ai/ surfaces/ design/ compliance/ operations/ decisions/
```

## Rules

- Apps consume published API/domain contracts; they do not import another app or private domain internals.
- `packages/domain` contains separate modules matching [domain boundaries](03-domain-boundaries.md), not one shared utility pile.
- `types`, `validation`, and `api-client` stay dependency-light and cannot contain authorization, persistence, or provider calls.
- `api` composes modules, authenticates requests, and maps transport errors; domain rules remain in owning modules.
- Provider adapters are injected behind ports owned by affected domain/platform capability, never called directly from UI.
- AI Gateway/Orchestrator belongs behind shared API/platform contracts; product clients never embed provider SDKs or direct model access.
- Approved Figma, not repository scaffolding, is visual source of truth. Future code consumes approved design tokens/components without coupling surface permissions.

## Security and migration

Configuration references secret identifiers only; secret values belong in controlled runtime secret stores. Domain-owned migrations must be backward compatible and follow [data/migrations](../engineering/02-data-migrations.md). No module reads another module's tables as a convenience.

## Phase and open questions

V1: shape and boundaries. `DECISION REQUIRED`: language/runtime, monorepo tooling, API style, deployment topology. These choices cannot alter ownership or client separation.

## Cross-references

[System overview](01-system-overview.md), [contracts/events](04-contracts-events.md), [API contracts](../engineering/01-api-contracts.md), [Figma authority](../design/03-figma-source-of-truth.md), [ADR-0001](../decisions/ADR-0001-documentation-first.md).
