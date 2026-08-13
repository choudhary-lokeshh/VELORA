# AUTH domain

## Purpose, scope, non-goals

AUTH owns authentication identity, credentials/factors, sessions, recovery, device/session security, and authentication assurance state. It does not own public profiles, adult/creator policy approval, application roles, payment state, or authorization to a product object.

## Actors and flows

Anonymous visitor starts signup/sign-in. AUTH validates permitted method, creates/links identity, issues bounded session, and emits `AuthenticationIdentityCreated`, `SessionIssued`, `SessionRevoked`, or recovery events. USERS creates account/profile only after valid identity flow. Sign-out, password/factor change, suspicious activity, deletion, or enforcement can revoke all/specific sessions.

## Security and failure rules

Store passwords only with approved adaptive hash; never log or expose plaintext password, recovery token, or authentication secret. Rate-limit and abuse-protect sign-in/recovery/OTP, use short-lived single-use tokens, bind redirects, prevent account enumeration, and record security audit events. Duplicate callback/request is idempotent by provider/request reference. Concurrent factor/session changes use version/transaction guards. Verification completion is not a blanket authorization grant.

## Data, permissions, phase

AUTH owns identity/session records and exposes opaque subject ID plus assurance state. User manages own sessions/factors; Admin actions are scoped/audited and never disclose secrets. V1: account/session baseline. Phase 2: additional factors/device assurance as needed. `DECISION REQUIRED`: auth methods, adult/age verification policy boundary.

## Session, recovery, and privileged policy

Exact session lifetimes, cookie policy, Mobile access/refresh token behaviour, refresh reuse response, account-recovery channels/limits, post-recovery revocation, Admin MFA/session/step-up values, privileged recovery, and break-glass semantics are locked by [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md) inside the [ADR-0009](../decisions/ADR-0009-auth-authorization.md) architecture. Implementation reads those values from that authority instead of choosing constants.

## Cross-references

[onboarding](../flows/onboarding.md), [consumer account/profile](../flows/consumer-account-profile.md), [adult verification](../compliance/02-adult-age-verification.md), [RBAC](../security/02-access-control-rbac.md), [privacy](../security/03-privacy-retention.md), [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md), [USERS](users.md).
