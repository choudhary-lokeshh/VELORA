# AUTH domain

## Purpose, scope, non-goals

AUTH owns authentication identity, credentials/factors, sessions, recovery, device/session security, and authentication assurance state. It does not own public profiles, verified age/identity/creator/KYC evidence, adult/creator policy approval, application roles, payment state, or authorization to a product object. IDENTITY ASSURANCE links evidence to an AUTH principal by opaque reference without issuing credentials or sessions.

## Actors and flows

Anonymous visitor starts signup/sign-in. AUTH validates permitted method, creates/links identity, issues bounded session, and emits `AuthenticationIdentityCreated`, `SessionIssued`, `SessionRevoked`, or recovery events. USERS creates account/profile only after valid identity flow. Sign-out, password/factor change, suspicious activity, deletion, or enforcement can revoke all/specific sessions.

## Security and failure rules

Store passwords only with approved adaptive hash; never log or expose plaintext password, recovery token, or authentication secret. Rate-limit and abuse-protect sign-in/recovery/OTP, use short-lived single-use tokens, bind redirects, prevent account enumeration, and record security audit events. Duplicate callback/request is idempotent by provider/request reference. Concurrent factor/session changes use version/transaction guards. Verification completion is not a blanket authorization grant.

## Data, permissions, phase

AUTH owns identity/session records and exposes opaque principal ID plus authentication assurance state. User manages own sessions/factors; Admin actions are scoped/audited and never disclose secrets. V1: account/session baseline and the opaque link contract consumed by IDENTITY ASSURANCE. Phase 2: additional factors/device assurance as needed. `DECISION REQUIRED`: auth methods. Adult/identity evidence belongs to [IDENTITY ASSURANCE](identity-assurance.md); jurisdiction policy remains unresolved.

## Session, recovery, and privileged policy

Each browser surface has its own audience-scoped session cookie with its own name, so a browser normally holds at most one and there is nothing to resolve. Two surfaces deployed on one host is the exception — a cookie is scoped to a host and ignores the port, so a browser then sends both. AUTH resolves that by the request's `Origin`, matched against the origins the audience is configured to accept: the browser sets that header, page script cannot forge it, and the selected cookie still passes the same origin check every browser request already passes. Anything that does not resolve to exactly one audience — no origin, a foreign origin, or one origin configured for two audiences — is refused rather than guessed at, because guessing is exactly the audience confusion the separate cookie names exist to prevent.

Exact session lifetimes, cookie policy, Mobile access/refresh token behaviour, refresh reuse response, account-recovery channels/limits, post-recovery revocation, Admin MFA/session/step-up values, privileged recovery, and break-glass semantics are locked by [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md) inside the [ADR-0009](../decisions/ADR-0009-auth-authorization.md) architecture. Implementation reads those values from that authority instead of choosing constants. In code they exist once, in the API's AUTH policy module, and `pnpm auth:policy` fails if that module, the ADR, or any other document disagrees.

## Implemented persistence

AUTH owns `auth_accounts`, `auth_identities`, `auth_sessions`, `auth_refresh_families`, `auth_refresh_tokens`, `auth_security_events`, `auth_known_devices`, `auth_recovery_requests`, `auth_recovery_rate_events`, `auth_admin_authenticators`, `auth_security_owners`, `auth_privileged_recovery_requests`, `auth_privileged_recovery_approvals`, and `auth_high_impact_authorizations`. No profile, preference, display-name, or discovery field appears in any of them; those belong to [USERS](users.md).

Critical invariants are database constraints, not only service checks:

- A provider and its subject identify one identity, so concurrent first authentication converges on one account.
- One live refresh token per family, and one live refresh family per installation, are partial unique indexes.
- A compromised refresh family is always a revoked refresh family.
- Every stored digest must be a SHA-256 hex digest; revocation timestamp and reason are set together or not at all.
- Idle expiry never exceeds absolute expiry, and one privileged-recovery approver counts once.

## Token and credential handling

Session, refresh, CSRF, and recovery credentials are opaque, versioned, and carry at least 256 bits of CSPRNG entropy. Only a SHA-256 digest is stored. A keyed digest would add a key to provision, rotate, and keep on the lookup path while defending only against a search the entropy already rules out, so the simpler construction is used deliberately; ADR-0009's versioned-format requirement is met by the version prefix, which the digest covers.

Consumer Mobile access tokens are signed with Ed25519, not a shared secret. That is a trust boundary rather than a preference: a component that only needs to verify a token holds the public key and cannot mint one, so a compromised or extracted verifier is not a token factory. A symmetric algorithm would hand minting authority to every API replica, every future extracted service, and every surface that ever needs to check a token. Ed25519 is deterministic, so there is no per-signature nonce to misuse, and Bun and Node implement it natively, so no cryptographic dependency and no hand-written cryptography enters the trust boundary. Any production signing authority must preserve that property: it may hold the private key, but verification must remain possible with public material alone.

Verification pins algorithm, curve, token type, key identifier, issuer, and audience, refuses an oversized or malformed token before decoding it, and additionally rechecks the backing refresh family in PostgreSQL, so revocation takes effect immediately rather than after the token's remaining lifetime.

Signing keys rotate without invalidating live tokens: the authority signs with one key and verifies with that key plus any retired public keys still configured. Removing a key from the accepted set is the emergency revocation seam, and it takes effect for every token that key ever signed.

## Refresh rotation and replay

Rotation is one transaction that locks the refresh family before deciding anything, so concurrent exchanges of the same token serialise: exactly one consumes it and every later arrival observes a consumed token. Consumption is recorded before the successor exists, which makes the one-live-token index an invariant the success path also obeys.

Every second presentation of a consumed token is replay, whoever sent it and however soon. The family is revoked, marked compromised, and recorded as a security event. There is deliberately no retry tolerance: a grace window keyed on anything a client sends is a window an attacker holding the stolen token can also enter, and its only effect would be to suppress detection of the theft. A legitimate client avoids the situation with single-flight refresh, and when it cannot, ADR-0017 prefers family revocation and a clear re-authentication path over silent acceptance. The cost is explicit: a client that loses the response to a successful rotation must re-authenticate.

## Authorization primitives

AUTH derives a server-owned context containing account, audience, assurance, assurance age, expiry, and the session or family reference. It never contains a credential, and no client assertion contributes to it. `requireAuthenticated`, `requireAudience`, `requireAssurance`, and `requireFreshAssurance` deny by default. The Platform Admin audience carries an assurance floor no other audience can satisfy, so a consumer or creator session cannot become Admin authority regardless of what a caller sends.

## Recovery

Recovery initiation answers identically for a known subject, an unknown subject, a malformed one, and an account that has reached its own quota, so no response discloses account existence. Per-requester limits are the only ones that answer differently, because they describe the caller rather than any account. Quotas that carry the security consequence are counted in PostgreSQL; ephemeral infrastructure cannot lift them.

Recovery tokens are single use and short lived, stored as a digest, and consumed by a conditional update inside the transaction that revokes prior authority, so two simultaneous attempts on one token cannot both succeed. Completing recovery revokes every browser session and refresh family, invalidates every other outstanding recovery token for the account, applies the high-impact restriction, records audit and security events, and establishes ordinary access only.

A device that has never completed an authentication for the account is high risk, and so is a request that carries no device reference at all. High-risk recovery is refused, because the second independent signal and the reviewed support path ADR-0017 requires do not exist yet. That is the deterministic seam a future risk engine replaces; it is not a risk engine.

## Privileged access

Platform Admin authentication is structurally isolated and cannot be produced by any implemented adapter. Enrolled authenticators store credential identifier, public key, signature counter, label, attachment, and revocation state; no secret is stored. Step-up requires the Admin audience, an enrolled unrevoked authenticator, and an accepted assertion, and it resets assurance age on the session record rather than trusting a caller.

A counter that fails to advance is treated as the cloned-authenticator signal only for authenticators that keep one. Most passkeys and multi-device credentials report zero forever, and a blanket rule would reject exactly the phishing-resistant credentials ADR-0017 mandates, so the verifier reports whether counters are supported and AUTH interprets that. For a counter-keeping authenticator the advance is also the concurrency claim, so one assertion cannot be presented twice; for a counterless one, single use rests on the verifier consuming its challenge exactly once, which is where that responsibility belongs.

Privileged recovery is a dual-control state machine: two distinct preauthorized security owners must approve, one owner cannot approve twice, and the account being recovered cannot approve its own recovery. Completing it revokes the target's sessions, refresh families, and enrolled authenticators, and applies the high-impact restriction. Issuing the short-lived bootstrap credential is deliberately absent until the phishing-resistant verifier and the operational identity process exist.

Break-glass is documented by ADR-0017 and deliberately unimplemented. No route, service, flag, or configuration value raises authority without a fresh phishing-resistant assertion.

## Access paths and growth

Both hot paths read once. A browser request resolves session and account state in a single indexed query; a Consumer Mobile request resolves refresh family and account state in a single indexed query after verifying the signature locally. Sliding idle expiry is persisted at most once per interval per session rather than on every request, so a busy session is not a hot row; expiry is still computed from the stored value, so no lifetime is shortened.

The append-heavy tables are security events, refresh-token rotation evidence, recovery requests, recovery rate events, and high-impact authorizations. None of them is read without a bounded predicate, and revocation correctness never depends on a row being physically deleted: expiry and revocation are recorded state, so a stale row is inert rather than dangerous. Retention durations are a privacy and legal decision recorded in [open decisions](../decisions/DECISIONS_REQUIRED.md), and the operational cleanup that enforces them is future work, not a correctness gap.

## Data minimisation

AUTH stores what authentication and revocation need and nothing else. There is no IP history, no user-agent history, no provider payload dump, and no profile field. A device reference is stored only as a digest and only to answer whether this account has authenticated from this device before. The identity subject is the provider's external reference and lives in the identity row alone. Security events carry an enumerated reason and no free-form payload, so there is no field for a secret to leak into.

## Provider boundaries

Identity, access-token signing, recovery delivery, and phishing-resistant authenticator verification are ports selected at one composition root. Only development/test implementations exist, and configuration refuses every one of them in staging and production, so those environments fail to start rather than run authentication on a stand-in. Selecting each real provider remains `DEFER UNTIL PROVIDER INTEGRATION` in [open decisions](../decisions/DECISIONS_REQUIRED.md).

## Cross-references

[onboarding](../flows/onboarding.md), [consumer account/profile](../flows/consumer-account-profile.md), [adult verification](../compliance/02-adult-age-verification.md), [IDENTITY ASSURANCE](identity-assurance.md), [RBAC](../security/02-access-control-rbac.md), [privacy](../security/03-privacy-retention.md), [API contracts](../engineering/01-api-contracts.md), [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md), [USERS](users.md).
