# Consumer account, profile, verification, and availability flow

## Purpose and authority

Define lifecycle after authentication for shared Consumer Web/Mobile account, profile, verification state, availability, restriction, and deactivation. AUTH owns identity/session; USERS owns account/profile/availability; country policy and TRUST & SAFETY supply independent eligibility predicates.

## Preconditions and states

AUTH has created or resolved a unique identity and valid session. Country/channel admission and required notices are available. USERS account states are `pending_profile -> active/restricted -> deletion_pending -> deactivated -> erased/anonymized`; verification may be `not_required`, `required`, `pending`, `review`, `passed`, `failed`, `expired`, or `revoked` under country policy.

Availability is a user-managed, bounded preference such as available/unavailable with optional expiry. It is not online presence, consent to contact, discovery guarantee, or override of blocks/enforcement.

## Main lifecycle

1. Create or return one USERS account for authenticated AUTH subject idempotently.
2. Collect only required profile, consent/policy acknowledgements, country/channel, and adult/verification inputs.
3. Start approved verification through adapter if current policy requires it; store normalized outcome/reference, not unnecessary raw evidence.
4. Activate account only when required profile, adult/country, policy, and safety predicates pass.
5. User edits permitted fields and visibility; owner validates version, content, and field-level rules, then updates projections/events.
6. User changes availability; DISCOVERY consumes only current minimized projection and rechecks all eligibility at action time.
7. Session/account/security, country policy, verification expiry, or enforcement may restrict account without rewriting AUTH or TRUST & SAFETY truth.
8. Deletion follows [account deletion](account-deletion.md).

## Alternate and failure paths

Duplicate creation/profile submit returns existing result. Validation failure preserves safe editable draft. Provider timeout stays pending; stale or conflicting profile update returns version conflict. Failed/expired verification gives a safe next step or review/appeal where policy allows, without leaking detection internals. Country or feature disable restricts affected capabilities across both consumer clients.

Profile removal or account restriction propagates to discovery/search/notification projections; it does not erase required financial/safety/audit records. Creator identity may be linked to same user, but creator business state and consequences follow CREATORS policy.

## Permissions, privacy, and events

User manages only own permitted fields, visibility, and availability. Support/Admin uses scoped owner operation with reason/audit. Raw verification evidence, birth data, internal safety reason, or hidden fields are not public profile. Events contain minimized account/profile/availability/verification-eligibility facts with version and deletion handling.

## Phase and open decisions

V1. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: required profile fields, visibility defaults, age/verification policy, availability model/expiry, content validation, re-verification triggers, restriction UX, and creator-account deletion linkage.

See [onboarding](onboarding.md), [USERS](../domains/users.md), [AUTH](../domains/auth.md), [adult verification](../compliance/02-adult-age-verification.md), and [Consumer surfaces](../surfaces/01-consumer-web.md).
