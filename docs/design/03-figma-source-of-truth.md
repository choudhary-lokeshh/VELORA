# Figma source of truth

## Purpose and authority

Approved Figma files are Velora's visual source of truth. They own typography, colors, spacing, radius, elevation, iconography, grids, responsive behavior, components, variants, interaction states, and screen layouts. Documentation owns product meaning, phase, domain behavior, security, and compliance.

## Approval states

Figma work uses explicit status such as exploration, product review, accessibility review, approved for build, superseded, and archived. Only a named approved version/page/component is implementation authority. Draft explorations and AI-generated mockups are not approved design.

Each approved handoff records:

- surface, feature, product phase, and owning product/domain references;
- Figma file/page/frame/component identifiers and version/date;
- product, design, accessibility, and security/compliance reviewers as applicable;
- responsive frames, states, prototype behavior, and content assumptions;
- unresolved `DESIGN REQUIRED` or `DECISION REQUIRED` items;
- assets and rights/source status;
- implementation notes and superseded design links.

## Current approved checkpoint

- File: [VELORA — Master Visual Language](https://www.figma.com/design/e1aFf8THDJUZshsAqOU8b7/VELORA-%E2%80%94-Master-Visual-Language?node-id=1-2)
- Page: `00 — Master Visual Language`
- Review-board frame: `1:2`
- Status: Master Visual Language approved as current visual authority.
- Scope: shared visual DNA and controlled Consumer, Creator Studio, and Platform Admin expression. It is not a full production component library or product-screen handoff.
- Historical source: `VELORA — Visual Direction Exploration` remains unchanged and non-authoritative.

Figma Starter limits each local variable collection to one mode and therefore prevents production multi-mode token implementation. This limitation does not block repository or product architecture. Coding agents may implement semantic code-level theme maps matching the approved Master through `packages/design-tokens`; they must not create fake Figma modes, redesign the direction, or invent unapproved colors/components/screens.

One surface has an owner-authorised exception, recorded rather than assumed. [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md) fills in the Consumer expression of the approved Master — the surface ladder, the remaining foreground and border weights, the semantic status hues, radii, elevation, the type scale, and motion timing — inside `apps/web` and nowhere else, and it locks the Consumer information architecture. It changes no approved value, adds nothing to `packages/design-tokens`, and does not extend to Consumer Mobile, Creator Studio, or Platform Admin. An approved Consumer product-screen handoff supersedes it, and reconciling is a change to one stylesheet because no component encodes a raw value.

Identity Assurance product surfaces have no approved handoff yet. A future checkpoint may add `01 — Identity Assurance Handoff` to this same authoritative file for Consumer Web, Consumer Mobile handoff/resume, Creator Studio, and read-only Platform Admin states. Until human visual/accessibility approval and the matching product-phase gate, this name is a planned handoff only: no screen, layout, component, route, or client workflow may be inferred from it.

## Source-of-truth precedence

If Figma conflicts with product phase, authorization, domain ownership, payment/entitlement, privacy, or compliance documents, those authoritative documents prevail and design must be corrected before implementation. Figma cannot enable a future or gated capability.

If code conflicts with approved Figma visual/interaction specification and no documented accessibility/platform exception exists, approved Figma prevails. If platform accessibility or native behavior requires deviation, document it in Figma and the relevant surface/design authority.

## Agent and engineering rules

Before UI work, coding agents read the relevant surface, flow, security, phase, design-system contract, and exact approved Figma handoff. They must not invent a theme, token value, component variant, screen layout, responsive behavior, or interaction when approved Figma exists.

When no approved design exists, implementation pauses for design rather than silently generating production UI. Low-fidelity engineering scaffolds require explicit scope and must not be mistaken for approved visual design.

## Design-to-code traceability

Future implementation should map screen/component stories and tests to Figma identifiers and design-system versions. Code review checks visual/state coverage, responsive behavior, accessibility annotations, content extremes, and source authority. Design changes after implementation use versioned migration and visual regression review.

## Security and privacy in design files

Use synthetic/redacted sample data. Do not place real passwords, tokens, payment data, identity documents, private messages/media, moderation evidence, or production personal data in Figma. Restrict sensitive internal/Admin prototypes and review access. External share links follow project access policy.

## Open design decisions

`DESIGN REQUIRED`: full component/system pages, production screen set, remaining exact tokens, component ownership, approval roles beyond the current checkpoint, branching/version process, developer handoff method, design QA workflow, prototype testing process, and archival policy.

## Cross-references

See [design principles](01-design-principles.md), [design-system contract](02-design-system-contract.md), [screen states](06-screen-state-requirements.md), [AGENTS](../../AGENTS.md), and [product phases](../product/01-product-phases.md).
