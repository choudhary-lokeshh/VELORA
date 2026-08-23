# Velora design principles

## Purpose and authority

Define product qualities and approved Master Visual Language foundations across Consumer Web, Consumer Mobile, Creator Studio, and Platform Admin. Exact unresolved tokens, components, imagery assets, screen layouts, and final interaction patterns remain owned by approved Figma work.

## Product character

Velora should feel premium, modern, social, human, confident, calm under pressure, and globally usable. It should support adult social connection without becoming visually childish, a generic dating clone, a generic AI-generated gradient/card interface, or unnecessarily explicit in public-facing brand design.

## Principles

- Human before mechanics: use respectful language, clear intent, and visible user control rather than gamified pressure.
- Trust through clarity: make eligibility, privacy, safety, payment, entitlement, moderation, and pending states understandable without leaking protected reasons.
- Premium through restraint: establish hierarchy, craft, spacing, typography, and motion deliberately; avoid decorative noise and novelty that harms comprehension.
- Distinct surfaces, shared ecosystem: preserve brand relation while matching each surface's job and risk. Consumer feels social; Studio feels creative/productive; Admin feels precise/operational.
- Global by design: accommodate language expansion, locale formats, writing direction, cultural review, connectivity, device variation, and accessible interaction.
- Honest state: never imply message delivery, mutual interest, payment success, entitlement, publication, moderation outcome, or AI certainty before authoritative confirmation.
- Safety without stigma: keep block/report/help reachable, use non-retaliatory copy, and avoid exposing another person's protected status or accusation.
- Phase discipline: do not design future capability as shipping scope unless phase authority permits it. Conditional features require approved gates.

## Surface expression

Consumer Web and Mobile may share core brand and components but can use different navigation and native interaction patterns. Creator Studio prioritizes creation, status, and business clarity. Platform Admin prioritizes information density, traceability, and safe operation over promotional presentation.

Public creator pages can be expressive within approved creator/brand constraints, but free preview, locked content, entitlement, and compliance state must remain clear. Public brand surfaces avoid relying on explicit imagery or suggestive visual treatment to explain product value.

## Content and AI presentation

Copy is direct, respectful, localized, and action-specific. Avoid dark patterns, artificial scarcity, guaranteed interpersonal outcomes, coercive upsell, or ambiguous destructive actions. AI assistance is labeled and keeps edit/reject/report control visible; model confidence is not styled as authority.

## Approved Master Visual Language

VELORA uses one shared visual foundation with controlled surface expression:

- Consumer: tonal dark, media-first, intimate, and socially alive.
- Creator Studio: warm editorial workspace.
- Platform Admin: light, dense, predictable, and audit-focused.

Approved shared DNA is a 4 px rhythm; restrained surfaces; IBM Plex Sans for interface text; Source Serif 4 only for Creator editorial moments; Noto global-script fallbacks; Living Ember `#B85645` with dark expression `#E17A66`; a coherent 1.75 px icon stroke; a 2 px focus treatment; and a semantic safety/status system.

The approved checkpoint does not authorize invention of the remaining palette, full component system, product screens, responsive layouts, imagery assets, elevation details, or motion tokens. Those remain `DESIGN REQUIRED` until an approved Figma handoff specifies them.

The Consumer dark expression is named NIGHT CURRENT and the Creator workspace expression WARM SIGNAL. NIGHT CURRENT is implemented in `apps/web` under [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md) and WARM SIGNAL in `apps/creator-studio` under [ADR-0028](../decisions/ADR-0028-creator-studio-product-interface.md). Each is an owner-authorised interim filling of the values above for one surface — not an approval of them for any other, and not a change to anything the Master already fixes. The two share the approved DNA and nothing else: separate tokens, separate components, separate icon sets, because `AGENTS.md` keeps the surfaces separate and a consumer feed and a creator workspace do not want the same things.

## Cross-references

See [design-system contract](02-design-system-contract.md), [Figma source of truth](03-figma-source-of-truth.md), [accessibility/motion](05-accessibility-motion.md), and [product surfaces](../DOCS_INDEX.md#product-surface-authority).
