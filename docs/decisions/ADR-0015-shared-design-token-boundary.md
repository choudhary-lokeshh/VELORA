# ADR-0015: Shared design-token package boundary

- Decision date: 2026-08-13
- ADR status: Accepted

## Context

VELORA has an approved Master Visual Language shared across four separate clients. Figma Starter prevents production multi-mode variables, while repository bootstrap needs semantic design concepts without duplicating raw values or creating a shared UI/privilege layer. ADR-0004 requires an approved design and package-boundary decision before sharing visual primitives.

## Decision

- Add `packages/design-tokens` as a client-safe workspace package.
- The package may export only approved primitive values, semantic token role names, theme names/shapes, typography stacks, rhythm, icon-stroke, focus, and other platform-neutral design contracts.
- Consumer Web, Consumer Mobile, Creator Studio, and Platform Admin may import it. It does not make their navigation, components, page state, responsive composition, permissions, or release artifacts shared.
- The package must not contain React/React Native components, product copy, routes, feature flags, authorization, business state, provider behavior, secrets, analytics behavior, or privilege assumptions.
- Only values present in the approved Master Visual Language may be implemented. Missing values remain explicitly `DESIGN REQUIRED`; neutral bootstrap shells do not become production design authority.
- Code-level contracts may represent Consumer dark, Consumer light where needed, Creator, and Admin themes. Figma remains the visual authority, and no fake Figma multi-mode workaround is authorized.
- A future shared Web component package remains a separate decision requiring approved components, bundle/privilege isolation evidence, ownership, tests, and an ADR update or superseding ADR.

## Consequences

One narrow package prevents drift in approved shared DNA while keeping all surface UI and privilege semantics local. Initial exports may define theme contracts without supplying unapproved values. Figma-to-code reconciliation can later populate or generate the same semantic API when richer Figma variables are available.

## Security and testing

Dependency checks allow clients to import `design-tokens` but continue to reject `packages/domain`, apps, repositories, workers, and provider SDKs. Tests pin approved values and reject forbidden runtime dependencies. Visual, accessibility, responsive, and component tests remain required before product UI release.

## Migration and reversibility

The package is data/contracts only. It can later be generated from approved Figma variables or split into platform renderers without changing semantic token names. Removal requires migrating every consumer and preserving approved visual meaning.

## Status

| Decision | Classification |
|---|---|
| Shared client-safe design-token contract | LOCK NOW |
| Shared Web/Native components | DECISION REQUIRED BEFORE FEATURE |
| Fake Figma mode collections or invented values | REJECTED |

## Cross-references

[Figma authority](../design/03-figma-source-of-truth.md), [design-system contract](../design/02-design-system-contract.md), [repository shape](../architecture/02-repository-shape.md), [ADR-0004](ADR-0004-client-frameworks.md), and [open decisions](DECISIONS_REQUIRED.md).
