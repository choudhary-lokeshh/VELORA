# Consumer product

## Purpose and scope

Define Consumer Web and Mobile product behavior. Both operate on same user account, profile, social safety state, and backend contracts; they may differ in interface, device permissions, distribution rules, and notification capability. Surface-specific authority lives in [Consumer Web](../surfaces/01-consumer-web.md) and [Consumer Mobile](../surfaces/02-consumer-mobile.md). This document does not define Creator Studio or Admin behavior.

## Actors and V1 outcome

Adult User creates account, completes required profile/eligibility state, manages availability, receives eligible discovery candidates, sends/responds to introductions, messages after allowed connection, controls safety preferences, blocks/reports, and receives notifications. Platform rules decide eligibility; user controls do not override enforcement.

## Main V1 flow

1. AUTH establishes adult-eligible account session; USERS creates editable profile.
2. DISCOVERY returns only policy-eligible candidates, excluding blocked/enforced/ineligible accounts.
3. User sends introduction signal. Mutual valid signals create an introduction/connection under DISCOVERY rules.
4. MESSAGING authorizes conversation from connection state. TRUST & SAFETY blocks immediately supersede access.
5. NOTIFICATIONS delivers minimized notices according to preferences and platform capability.

## Alternate/error flows

Incomplete profile, age/region restriction, enforcement, rate limit, or safety setting yields clear non-sensitive denial. Duplicate introduction is idempotent. Stale candidate is revalidated at action time. A block revokes new discovery, communication, counterpart-generated notification, and call eligibility promptly; prior conversation/content visibility follows explicit safety and retention policy. Failed notification never changes core product state.

## Permissions/data/security

Consumer can act only on own account and objects explicitly authorized by source domain. Client must never infer entitlement, role, or another user's sensitive status. Profile visibility is policy-driven; exact fields and defaults are `DECISION REQUIRED`. Report and block flows minimize retaliation risk. No paid option guarantees access to another person.

## Events and phase

Track consent-aware product events such as onboarding completion, candidate shown, introduction outcome, message delivery, block/report submission, notification delivery. V1 as described. Phase 2: premium, RTC. Phase 3: coins/gifts/advanced controls, communities, and approved consumer AI assistance. See [phases](01-product-phases.md).

## Consumer AI boundary

Phase 3 AI may explain approved product information, help discover existing controls, or produce user-controlled drafts. Output must be labeled as assistance; user remains sender/publisher and owning domain re-authorizes any action. AI cannot autonomously send messages or introductions, rank/select candidates as a new source of truth, infer hidden traits or another user's private status, guarantee attention/relationship outcomes, or bypass safety and monetisation boundaries. Memory is optional, consent-aware, and non-authoritative.

## Cross-references

[onboarding](../flows/onboarding.md), [account/profile](../flows/consumer-account-profile.md), [discovery](../flows/discovery-introductions.md), [messaging/blocks](../flows/messaging-and-blocks.md), [notification delivery](../flows/notification-delivery.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [AI safety](../ai/04-ai-safety-security.md), [consumer security](../security/01-security-baseline.md), [AUTH](../domains/auth.md), [USERS](../domains/users.md).
