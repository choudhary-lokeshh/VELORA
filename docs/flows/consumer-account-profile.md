# Consumer account, profile, verification, and availability flow

## Purpose and authority

Define lifecycle after authentication for shared Consumer Web/Mobile account, profile, verification state, availability, restriction, and deactivation. AUTH owns principal/session; USERS owns account/profile/availability/self-declaration; IDENTITY ASSURANCE owns verified evidence; country policy and TRUST & SAFETY supply independent eligibility predicates.

## Preconditions and states

AUTH has created or resolved a unique identity and valid session. Country/channel admission and required notices are available. USERS account states are `pending_profile -> active/restricted -> deletion_pending -> deactivated -> erased/anonymized`; verification may be `not_required`, `required`, `pending`, `review`, `passed`, `failed`, `expired`, or `revoked` under country policy.

Availability is a user-managed, bounded preference such as available/unavailable with optional expiry. It is not online presence, consent to contact, discovery guarantee, or override of blocks/enforcement.

## Main lifecycle

1. Create or return one USERS account for authenticated AUTH subject idempotently.
2. Collect only required profile, consent/policy acknowledgements, country/channel, and adult/verification inputs.
3. In Phase 2, start approved stronger verification through IDENTITY ASSURANCE if current published policy requires it; the provider flow stores minimum normalized evidence, not raw identity data. V1 has no Consumer initiation route.
4. Activate account only when required profile, adult/country, policy, and safety predicates pass.
5. User edits permitted fields and visibility; owner validates version, content, and field-level rules, then updates projections/events.
6. User changes availability; DISCOVERY consumes only current minimized projection and rechecks all eligibility at action time.
7. Session/account/security, country policy, verification expiry, or enforcement may restrict account without rewriting AUTH or TRUST & SAFETY truth.
8. Deletion follows [account deletion](account-deletion.md).

## Alternate and failure paths

Duplicate creation/profile submit returns existing result. Validation failure preserves safe editable draft. Provider timeout stays pending; stale or conflicting profile update returns version conflict. Failed/expired verification gives a safe next step or review/appeal where policy allows, without leaking detection internals. Country or feature disable restricts affected capabilities across both consumer clients.

Profile removal or account restriction propagates to discovery/search/notification projections; it does not erase required financial/safety/audit records. Creator identity may be linked to same user, but creator business state and consequences follow CREATORS policy.

## Permissions, privacy, and events

User manages only own permitted fields, visibility, and availability. Support/Admin uses scoped owner operation with reason/audit. Raw verification evidence, exact birth data, internal safety reason, or hidden fields are not public profile. Identity evidence events carry minimized class/result/reference/version facts only; USERS computes account eligibility and publishes its own minimized lifecycle facts.

## Implemented V1 profile and visibility

The approved V1 minimum discoverable profile is a display name, a coarse country or region, at least one language, and at least one image in the `ready` state. A bio and any later enrichment stay optional, and date of birth, precise location, gender, and orientation are never required for discovery. Adult eligibility remains with [onboarding](onboarding.md) and the adult-assurance model rather than being re-derived from profile data.

A new consumer is not discoverable. Discoverability is an explicit user-controlled state that is off by default and cannot be turned on while the minimum profile is incomplete, and a consumer profile is never a public internet page: it is reachable only through authenticated consumer surfaces under the visibility rules the owning domains apply. Public creator storefront behaviour is a CREATORS requirement and does not reach this model.

Profile and preference edits use an expected version, so a conflicting change from another device is reported rather than silently overwritten. Account status follows the profile in both directions: completing the minimum profile activates the account, and losing it returns the account to `pending_profile` and turns discoverability off, so an account is never left visible on a profile it no longer has.

Profile media follows [media upload and delivery](../security/04-media-upload-delivery.md): the client obtains a short-lived object-bound upload capability, writes the bytes, and asks the platform to inspect them. The type is decided from the object's own bytes and the size is measured; a client's claim about either is never stored, and an object becomes usable only when the platform says so. No storage provider is approved, so the default adapter refuses everything and no deployed environment can produce a discoverable account yet.

Availability is implemented as a separate bounded state. It always carries an end, is bounded by a published maximum window, and resolves to unavailable once that window closes without anything rewriting the stored choice. It is not presence, not consent to be contacted, not a guarantee of appearing in discovery, and never an override of a block or an enforcement decision.

## Phase and open decisions

V1. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: required profile fields, visibility defaults, age/verification policy, availability model/expiry, content validation, re-verification triggers, restriction UX, and creator-account deletion linkage.

See [onboarding](onboarding.md), [USERS](../domains/users.md), [AUTH](../domains/auth.md), [IDENTITY ASSURANCE](../domains/identity-assurance.md), [identity verification](identity-assurance-verification.md), [adult verification](../compliance/02-adult-age-verification.md), and [Consumer surfaces](../surfaces/01-consumer-web.md).

## Implemented consumer surfaces

Consumer Web and Consumer Mobile carry the same journey and read it from the server on every screen: the admission ladder comes from `GET /v1/users/me/onboarding`, the outstanding profile requirements from the profile response, and the availability view from `effectiveState` rather than from any clock the client owns.

Neither surface can complete the profile in any environment. The minimum discoverable profile requires one ready image, no media storage provider is approved, and the configured adapter refuses to issue an upload target — which both surfaces report as exactly that rather than leaving an upload looking like it worked. Nothing on either surface claims an image was scanned or moderated.

Availability is presented as a bounded choice with a visible end, never as presence. A window that has ended is shown as ended rather than as never chosen, and both surfaces revalidate it when they come back into view: a tab left open overnight, or an app resumed from a pocket, must not still be showing "available" after the server stopped acting on it.

Both surfaces revalidate rather than synchronise. V1 has no realtime transport and neither client invents one: a session ended in another tab, a block made on another device, or an account restricted by enforcement reaches a surface the next time it asks, and every action it takes meanwhile is refused by the server.
