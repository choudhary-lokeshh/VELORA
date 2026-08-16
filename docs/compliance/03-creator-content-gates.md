# Creator and content gates

## Purpose and status

Define gates for creator operation, content publication, private delivery, and potential mature/explicit content. This is not legal advice. Mature/explicit content is disabled by default and remains `Conditional / Compliance-Gated`. Country/category rules are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Separate predicates

Creator access requires independent current decisions for user adult eligibility, creator identity/business verification, creator status, country/channel eligibility, content-category eligibility, payment/payout readiness where relevant, safety/enforcement, and object authorization. Passing one predicate never implies another.

## Creator activation gates

Before activation, define and approve:

- minimum age, identity, residency, and business/individual requirements;
- creator application/review, sanctions/risk checks where lawful, and re-verification;
- tax/payment/payout prerequisites without collecting unnecessary financial secrets;
- content categories, prohibited content, country/channel distribution, and public preview rules;
- consent/ownership/participant evidence and record retention;
- moderation, appeal, takedown, law-enforcement/legal escalation, and emergency suspension;
- Studio permissions, delegated/team access if any, and auditability;
- support, finance, safety staffing and SLAs.

## Content lifecycle gates

Content moves from draft/upload through quarantine, processing, moderation/policy decision, publication, restriction/removal, appeal, and final retention/deletion. Owner checks creator, content category, country/channel, verification, rights/consent, safety, price/offer, and feature gate at publish and each private delivery.

Public creator page may show only policy-approved profile and safe/free preview. A URL, cached asset, payment indication, or prior entitlement never bypasses current content and delivery authorization.

## Mature/explicit content gates

Enable only for exact country, channel, creator, participant, content category, payment provider, storage/delivery route, and audience after all gates pass:

- verified adult audience and creator/participant age/identity as required;
- documented consent, ownership, withdrawal, and prohibited-content controls;
- category-specific moderation before publication and ongoing abuse detection;
- provider and channel acceptance, geo restrictions, and age-gated presentation;
- audit, evidence chain, rapid takedown, appeal, complaint, abuse response, and retention;
- legal/compliance approval and operations readiness.

Failure, expiry, or revocation disables new upload/publication/delivery as applicable and triggers documented customer/creator communication, access, refund, evidence, and appeal treatment. AI assistance cannot certify these gates or broaden availability.

## Implemented content gate

The gates above are a conjunction evaluated in one place rather than a property of one column. TRUST & SAFETY publishes a content answer that takes the item, its creator, the capability being attempted — publish, remain public, deliver, monetise — and the surface, and returns whether it is allowed together with **every** gate that is closed rather than only the first. A caller told only the first refusal would reasonably conclude that fixing it is enough, and for a mature class that is never true.

Surface is a separate predicate with its own closed vocabulary, and the two mobile surfaces are structurally ineligible for the mature classes rather than configurably so. Content classification is three classes rather than one flag, because actual and simulated conduct carry different evidence obligations. Depicted-person consent is asked per capability, so publication consent does not authorise delivery and neither authorises monetisation. Viewer assurance for a mature class is `verified_adult` and nothing weaker.

Enforcement applies to every class, not only the mature ones: a suspended creator publishes nothing and an item an operator removed stays removed, whatever it is.

**The mature capability itself has one configured value, in every environment, and it is off** — the configuration schema admits no other, so there is nothing to flip. Nothing in this implementation enables mature content and its presence is not capable of doing so; a regression asserts that an item satisfying every other gate is still refused. Details are in [TRUST & SAFETY](../domains/trust-safety.md); the dated primary-source findings are in [surface and distribution eligibility](07-surface-and-distribution-eligibility.md).

## Security and privacy

Restrict verification and consent evidence to justified roles. Never place raw evidence/media in generic logs, analytics, notifications, or AI context. Media uses quarantine and entitlement-bound signed delivery. Moderator/Admin access is scoped and audited; Owner does not receive unrestricted raw evidence.

## Open decisions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: creator countries, categories/taxonomy, participant evidence, consent withdrawal, prohibited-content policy, pre/post moderation, appeal/takedown SLA, provider/channel support, public preview, geo enforcement, record retention, and launch operations.

The dated primary-source findings that decide which surfaces and distribution channels may carry mature content at all, and what depicted-person evidence it requires, are in [surface and distribution eligibility](07-surface-and-distribution-eligibility.md). The architecture that keeps every gate above a separately revocable predicate rather than one flag is [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md).

See [Creator Private Clubs](../product/03-creator-private-clubs.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [media security](../security/04-media-upload-delivery.md), [entitlement flow](../flows/creator-entitlement.md), and [moderation operations](../operations/02-moderation-operations.md).
