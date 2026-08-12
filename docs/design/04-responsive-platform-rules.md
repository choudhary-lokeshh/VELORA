# Responsive and platform rules

## Purpose and authority

Define responsive responsibilities and platform differences before Figma chooses exact breakpoints and layouts. Consumer Web, Consumer Mobile, Creator Studio, and Platform Admin share backend contracts but need not have identical interfaces or feature exposure.

## Viewport classes

Figma must define behavior for mobile, tablet, desktop, and wide desktop. Exact breakpoints are `DESIGN REQUIRED`; designs must demonstrate reflow based on content and interaction needs, not device names alone.

- Mobile: single-primary-task focus, touch-first targets, safe areas, software keyboard, compact navigation, interrupted connectivity.
- Tablet: adaptive navigation, split views where useful, touch and keyboard/pointer support, rotation and multi-window where relevant.
- Desktop: multi-column layouts, keyboard/pointer, persistent context, resizable windows, productivity shortcuts.
- Wide desktop: bounded readable content for consumer surfaces; deliberate additional panels/density for Studio/Admin rather than uncontrolled stretching.

## Consumer Web and Mobile

Consumer Web supports browser navigation, links, multiple tabs, hover/focus, keyboard, refresh, and responsive mobile browser layouts. Consumer Mobile may use native stacks, tabs, sheets, gestures, push entry, device permissions, offline/cache behavior, and platform accessibility conventions.

Core product truth stays consistent, but feature exposure can differ by channel/country/provider/distribution rule. Different placement or interaction is allowed. Missing mobile feature must have safe explanation or Web handoff where product approves it; it cannot be hidden to bypass customer/legal obligations.

## Creator Studio

Studio is web-first. Desktop/tablet layouts prioritize creation tools, status, tables, filters, side-by-side preview, and recoverable drafts. Narrow layouts may reduce editing or finance capability and focus on review/status. Public creator pages follow Consumer Web responsiveness but keep entitlement and content gates.

## Platform Admin

Admin is desktop-first and information-dense. Responsive design must preserve target identity, role/scope, current state, reason, approval, and outcome during high-risk workflows. Table collapse must not hide security-relevant fields or turn a scoped operation into ambiguous bulk action. Phone access is not assumed.

## Interaction and content rules

All classes support zoom/text scaling, long localized strings, right-to-left layouts where launched, orientation/resizing, visible focus, touch target minimums, safe truncation, and non-color status communication. Dense layouts provide keyboard order and accessible equivalents. Hover is enhancement, never sole disclosure/action.

Persistent actions must not cover content or system/browser controls. Destructive/high-impact actions retain target and effect context at every size. Loading, empty, error, offline, and permission states adapt without layout jumps that cause accidental action.

## Media and performance

Serve media appropriate to viewport/network while preserving authorization and private-cache controls. Responsive images do not create public derivatives of private media. Define performance budgets and skeleton behavior in future technical ADRs; low bandwidth must yield truthful degraded states.

## Open design decisions and cross-references

`DESIGN REQUIRED`: breakpoints, container/grid rules, navigation per surface, tablet behavior, wide-screen density, responsive typography, orientation, platform-specific component exceptions, and Web-to-app handoff.

See [surface docs](../DOCS_INDEX.md#product-surface-authority), [accessibility/motion](05-accessibility-motion.md), [screen states](06-screen-state-requirements.md), and [media delivery](../security/04-media-upload-delivery.md).
