# Accessibility and motion

## Purpose and authority

Set accessibility and motion requirements for all Velora surfaces. Exact target standards, audit process, and jurisdiction-specific obligations are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`; design and implementation must not treat accessibility as optional polish.

## Inclusive interaction baseline

All core tasks must be operable with keyboard, touch, switch/assistive input as supported, and screen reader semantics appropriate to platform. Provide logical reading/focus order, visible focus, accessible names/roles/states, adequate target size, non-color cues, meaningful headings, labels and instructions, and error association/recovery.

Support text resize/zoom and dynamic type without loss of content or action. Avoid fixed-height text containers and destructive truncation. Design for localization expansion, right-to-left layout where launched, locale-aware dates/numbers/currency, and plain-language critical instructions.

## Visual and media accessibility

Color and contrast tokens require measured approval for text, icons, focus, controls, states, charts, and overlays. Images need purpose-appropriate alternatives; decorative images are hidden from assistive technology. Audio/video features require explicit accessibility plan such as captions/transcripts only when product, consent, privacy, retention, and provider decisions approve them.

Do not use flashing, rapid animation, or sensory-only cues that can cause harm or block comprehension. Sensitive/adult media needs controlled preview and user-safe disclosure patterns defined in Figma and compliance policy.

## Motion principles

Motion communicates hierarchy, continuity, status, and feedback; it must not create pressure, fake progress, or obscure authoritative state. Respect reduced-motion preferences with no-loss alternatives. Essential time limits provide warning and extension where security/policy permits. Loading animation never implies completed payment, message delivery, entitlement, upload, or moderation action.

Gesture-only actions require discoverable alternatives. Drag/drop, swipe, long press, hover, and complex canvas interactions need keyboard/touch alternatives appropriate to surface.

## High-risk and AI UX

Payment, deletion, enforcement, role, payout, entitlement, and other high-impact flows announce target, effect, pending state, error, and confirmed outcome to assistive technology. Focus moves predictably after dialogs, errors, asynchronous completion, and route changes.

AI assistance is identified without relying only on color/icon. Streaming content does not overwhelm screen readers; provide pause or completed-result access where needed. Confidence and citations are understandable, while AI output is never presented as deterministic authority.

## Verification and governance

Figma handoff includes annotations for semantics, focus order, keyboard behavior, announcements, contrast, text scaling, reduced motion, and platform differences. Future implementation requires automated checks plus manual keyboard, screen-reader, zoom/dynamic-type, contrast, motion, and content-extreme testing.

## Open decisions and cross-references

`DESIGN REQUIRED`: target accessibility conformance, supported assistive technology/browser/device matrix, contrast and motion tokens, caption/transcript UX, testing ownership, and release thresholds. Country-specific requirements need `LEGAL REVIEW REQUIRED`.

See [design system](02-design-system-contract.md), [responsive rules](04-responsive-platform-rules.md), [screen states](06-screen-state-requirements.md), and [testing/release](../engineering/05-testing-release.md).
