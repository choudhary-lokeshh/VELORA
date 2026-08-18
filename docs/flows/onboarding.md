# Adult account onboarding flow

## Purpose and authority

Define V1 consumer onboarding lifecycle. AUTH owns principal/session; USERS owns account/profile and self-declaration; IDENTITY ASSURANCE owns verified adult-threshold evidence. This flow does not select an identity provider or jurisdiction rules.

## Preconditions

Visitor is in permitted channel/country, accepts required terms/privacy notices, and supplies allowed authentication input. Age/adult gate and any age-verification requirement are evaluated according to configured jurisdiction policy; do not treat a declared age as universal verification.

```mermaid
stateDiagram-v2
  [*] --> Visitor
  Visitor --> IdentityPending: start signup
  IdentityPending --> SessionActive: auth succeeds
  SessionActive --> ProfilePending: create account
  ProfilePending --> Active: required gates pass
  ProfilePending --> Restricted: policy/eligibility fails
  Active --> Restricted: later enforcement/region change
  Active --> DeletionPending: deletion request
```

## Main and alternate flows

1. AUTH validates signup/sign-in, rate limits, and creates/links identity idempotently.
2. AUTH establishes protected session; USERS creates account/profile draft.
3. User completes required profile and self-declared adult/region gates. If a published policy later requires stronger assurance, the approved Phase 2 flow obtains current evidence from IDENTITY ASSURANCE.
4. USERS activates account only when all necessary predicates are true, then emits lifecycle event.

Duplicate submission returns prior result. Expired/invalid token, rate limit, denied eligibility, failed provider check, or incomplete profile returns safe next step without exposing sensitive policy signals. Authentication success alone does not allow discovery/messaging if profile/safety state is not active.

## Permissions, data, security

Anonymous can start only own flow; authenticated subject edits only own draft. Passwords/tokens never appear in logs. Restrict enumeration, abuse, redirects, sessions, verification evidence and document access. Record consent/policy version and security audit where required. Lifecycle events are minimized and dedupable.

## Implemented progression

The step is derived from stored evidence on every read rather than recorded, so no account can hold a step that contradicts its own acknowledgement and assurance rows. The order is adult declaration, then the currently required policy acknowledgements, then the minimum profile; an unmet earlier step makes a later one unreachable regardless of the order a client calls endpoints in.

Adult status is self-declared with the region whose rules apply, and no birth date is collected while the minimum age per country is unresolved. A declaration that the person is not an adult is recorded as a refusal and restricts the account rather than being discarded; declaring again returns the account to the pending path and leaves the refusal on the record. Verified adult evidence migrates from the legacy USERS seam to IDENTITY ASSURANCE and remains unreachable in deployed environments until provider, jurisdiction, legal/privacy, and Phase 2 surface gates pass. The onboarding response shape stays compatible through the Identity reader contract.

## Concurrency and phase

Identity unique key plus command idempotency avoids duplicate accounts; profile activation uses authoritative eligibility recheck. V1 includes self-declaration and the fail-closed Identity core, not a Consumer stronger-verification workflow. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: exact adult proof, minimum profile, countries, re-verification triggers. See [AUTH](../domains/auth.md), [USERS](../domains/users.md), [IDENTITY ASSURANCE](../domains/identity-assurance.md), [consumer account/profile](consumer-account-profile.md), [identity verification](identity-assurance-verification.md), [adult verification](../compliance/02-adult-age-verification.md), [privacy](../security/03-privacy-retention.md).
