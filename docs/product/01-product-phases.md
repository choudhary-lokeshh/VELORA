# Product phase classification

## Authority

Every product capability has exactly one classification below. This document is authoritative for phase placement; a feature cannot enter a build plan without a classification and owning domain.

| Classification | Meaning |
|---|---|
| V1 | Strong usable adult social core and prerequisites for safe future expansion |
| Phase 2 | Build after V1 learning/stability, using V1 seams |
| Phase 3 | Larger social/community or commercial expansion after validated need |
| Future / Moonshot | Directional concept, not implementation commitment |
| Conditional / Compliance-Gated | Disabled until documented legal, provider, country/channel, safety and operational gates pass |

## Capability map

| Capability | Classification | Owner |
|---|---|---|
| Adult account onboarding, sessions, profile, availability | V1 | AUTH / USERS |
| Discovery eligibility, mutual introductions, text chat, blocks/reports | V1 | DISCOVERY / MESSAGING / TRUST & SAFETY |
| Notifications, baseline Admin, audit trail, moderation workflow | V1 | NOTIFICATIONS / ADMIN / MODERATION |
| Additional authentication assurance and push notification expansion | Phase 2 | AUTH / NOTIFICATIONS |
| AI-assisted moderation triage, classification, summarization and policy retrieval with human decision | Phase 2 | AI PLATFORM / MODERATION; TRUST & SAFETY remains enforcement authority |
| Consumer premium plan and non-person-guaranteeing boosts | Phase 2 | BILLING / DISCOVERY |
| Presence and voice/video lifecycle | Phase 2 | REALTIME |
| Creator identity/business profile and web-first club pilot | Phase 2 | CREATORS / PRIVATE CLUBS |
| Creator subscriptions, locked posts/media, PPV entitlement | Phase 2 | PRIVATE CLUBS / BILLING |
| Creator analytics, earnings/payout operations | Phase 3 | ANALYTICS / PAYOUTS |
| Communities, rooms, hosted sessions, events, posts/moments | Phase 3 | new/extended bounded domains |
| Coins, gifts, advanced filters, paid visibility controls | Phase 3 | BILLING plus owning product domain |
| Consumer AI assistance limited to approved explanations and user-controlled drafts | Phase 3 | AI PLATFORM plus affected consumer domain |
| Creator AI assistance for drafts, organization, policy preparation and authorized analytics explanation | Phase 3 | AI PLATFORM plus CREATORS / PRIVATE CLUBS / ANALYTICS as applicable |
| Platform Admin AI assistance for authorized summaries, procedure guidance and operation drafts | Phase 3 | AI PLATFORM / ADMIN plus affected domain |
| Mature/explicit creator content | Conditional / Compliance-Gated | CREATORS / PRIVATE CLUBS / MODERATION |
| Global multi-region launch and advanced social graph | Future / Moonshot | multiple |
| Broader autonomous/agentic AI capabilities | Future / Moonshot | AI PLATFORM plus affected domains; deterministic authorization remains mandatory |

## V1 scope and non-goals

V1 proves safe, useful social discovery: adults-only account path, profiles, availability, candidate selection, mutual introductions, text communication, blocks/reports, notifications, moderation/admin foundation, auditability and provider seams. V1 excludes AI product capabilities, creator paid clubs, payouts, RTC, communities/rooms/events/posts, coins/gifts, guaranteed paid introductions, and any globally enabled explicit content. Architecture documentation alone does not move AI into V1.

## Change control

Moving scope to an earlier phase requires product rationale, owning-domain capacity, safety/security review, dependencies, tests, rollout/rollback plan, and update to this document plus a decision/ADR if architectural. Conditional features additionally require all listed gates in their authoritative product document.

Surface documents, Figma designs, technical ADRs, provider capability, and AI architecture do not change phase. A product capability absent from this map is unclassified and must not be implemented until added through change control.

## Cross-references

[Consumer product](02-consumer-product.md), [Creator Private Clubs](03-creator-private-clubs.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [surface authority](../DOCS_INDEX.md#product-surface-authority), [monetisation](05-monetisation.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).
