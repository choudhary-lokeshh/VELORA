# Design system contract

## Purpose and authority

Define how approved Figma design becomes an implementation contract without choosing technology or visual values. Figma owns approved visual and interaction specification; product/domain documents own behavior, phase, authorization, and data semantics.

## Token contract

Figma defines named, semantic tokens for:

- typography roles, families, weights, sizes, line heights, and tracking;
- color roles for surfaces, text, borders, actions, focus, status, charts, and overlays;
- spacing, sizing, grids, breakpoints, safe areas, and content widths;
- radius, elevation, stroke, opacity, and layering;
- iconography, illustration/image treatment, and motion timing/easing.

Actual values remain `DESIGN REQUIRED`. Token names should express purpose rather than a raw value or one screen. Responsive and theme modes use documented aliases, not copied one-off values.

## Component contract

Each approved component specifies purpose, allowed content, variants, sizes, composition, responsive behavior, interaction, accessibility name/role/value, keyboard/touch behavior, truncation/wrapping, localization, and all applicable states from [screen-state requirements](06-screen-state-requirements.md).

Components must distinguish visual state from business truth. For example, a disabled purchase button does not authorize payment; an entitlement badge reflects server state; an Admin confirmation does not record approval until owner workflow confirms it.

## Surface boundaries and reuse

Share primitives and brand foundations where meaning is identical. Surface-specific composites may differ:

- Consumer components favor social clarity, touch, and personal control.
- Creator Studio components favor editing, workflow status, tables, and content operations.
- Platform Admin components favor dense data, audit context, safe bulk operations, and high-risk confirmation.

Do not force identical Web/Mobile UI for code reuse. Do not expose Admin or creator behavior through a shared component API merely because visual appearance is similar.

## Change and implementation handoff

Every design-system release has version, change notes, affected components/screens, migration guidance, accessibility review, and owner approval. Breaking semantic changes require coordinated code and Figma migration. Deprecated tokens/components remain documented until consuming surfaces migrate.

Implementation maps approved tokens and components to code through technology-specific ADRs after stack selection. Coding agents consume named values and variants from approved handoff; they do not invent new visual styles, magic values, or undocumented states when Figma defines them.

If implementation exposes a missing state or accessibility need, update Figma and this contract rather than creating silent divergence. Product behavior conflicts are resolved in product/domain docs, not by altering visuals alone.

## Quality checks and open design

Handoff requires component inventory, state coverage, responsive examples, content extremes, keyboard/touch behavior, accessibility annotation, asset rights/source, and platform differences. Visual regression and accessibility testing are future implementation requirements.

`DESIGN REQUIRED`: token taxonomy/names, themes, component inventory, chart/data-visualization system, icon/asset library, content templates, versioning process, and ownership.

## Cross-references

See [Figma source of truth](03-figma-source-of-truth.md), [responsive rules](04-responsive-platform-rules.md), [accessibility/motion](05-accessibility-motion.md), and [testing/release](../engineering/05-testing-release.md).
