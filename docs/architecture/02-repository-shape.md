# Repository shape

## Purpose

Define current code placement and allowed dependency direction. The repository bootstrap establishes these boundaries without implementing product domains.

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
  design-tokens/   approved client-safe primitive/semantic design contracts
docs/
  product/ architecture/ domains/ flows/ security/ engineering/
  ai/ surfaces/ design/ compliance/ operations/ decisions/
```

## Rules

- Client apps consume `types`, `validation`, `api-client`, approved client-safe configuration/observability entrypoints, and `design-tokens`; they do not import another app, `packages/domain`, backend modules, repositories, ORM schemas, workers, or provider SDKs.
- `packages/domain` contains separate modules matching [domain boundaries](03-domain-boundaries.md), not one shared utility pile.
- `types`, `validation`, and `api-client` stay dependency-light and cannot contain authorization, persistence, or provider calls.
- `design-tokens` contains approved primitive values, semantic role names, and surface-theme contracts only. It contains no components, navigation, content, permissions, or business behavior.
- `api` composes modules, authenticates requests, and maps transport errors; domain rules remain in owning modules.
- One domain may import another only through its published application contract; it may not import another domain's repository, persistence model, entity, or provider implementation.
- Provider adapters are injected behind ports owned by affected domain/platform capability, never called directly from UI.
- AI Gateway/Orchestrator belongs behind shared API/platform contracts; product clients never embed provider SDKs or direct model access.
- Approved Figma, not repository scaffolding, is visual source of truth. Future code consumes approved design tokens/components without coupling surface permissions.

## Security and migration

Configuration references secret identifiers only; secret values belong in controlled runtime secret stores. Domain-owned migrations must be backward compatible and follow [data/migrations](../engineering/02-data-migrations.md). No module reads another module's tables as a convenience.

## Technical implementation

[Technical stack](09-technical-stack.md) and ADR-0003 through ADR-0016 lock pnpm/Turborepo, Bun backend plus Node client/tooling runtimes, TypeScript, client/backend frameworks, REST/OpenAPI, PostgreSQL/Drizzle, logically separated Redis responsibilities, BullMQ, realtime, sessions, storage, AI, observability/testing, initial deployment, and the narrow shared design-token boundary. ADR-0016 is the active backend supersession authority. Provider and product/design/legal decisions remain in [open decisions](../decisions/DECISIONS_REQUIRED.md). No technical choice alters ownership or client separation.

## Cross-references

[System overview](01-system-overview.md), [technical stack](09-technical-stack.md), [contracts/events](04-contracts-events.md), [API contracts](../engineering/01-api-contracts.md), [Figma authority](../design/03-figma-source-of-truth.md), [ADR-0001](../decisions/ADR-0001-documentation-first.md).
