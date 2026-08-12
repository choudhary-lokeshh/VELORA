# ADR-0009: Authentication, sessions, authorization, and approvals

- Decision date: 2026-08-12
- ADR status: Accepted

## Context

Consumer Web, Consumer Mobile, Creator Studio, and Platform Admin share one identity ecosystem but have different device, browser, assurance, and privilege risks. Velora must support revocable sessions, future social login, privileged MFA, object-level authorization, creator scope, country/compliance gates, and human approvals without creating four identity systems or trusting client claims.

## Requirements

- Centralize identity, credentials/factors, recovery, and device sessions in AUTH.
- Support secure Web cookies, Mobile token storage/rotation, session inventory/revocation, and future OIDC providers.
- Separate authentication assurance from roles, creator eligibility, entitlements, and object authorization.
- Enforce RBAC plus relationship/object/country/channel/safety policy in owner domains.
- Require step-up and independent approval for high-risk operations.
- Permit local/mock/test authentication before production provider choice.

## Options evaluated

1. Central AUTH module with Velora-owned session registry and provider adapters.
2. Four independent authentication integrations per client.
3. Stateless long-lived JWTs for every surface.
4. Opaque server sessions for every client.
5. Hybrid Web cookies and Mobile short-lived access/rotating refresh tokens.
6. Central policy engine versus explicit domain authorization policies.

## Decision

- Use one AUTH module and one canonical subject/session registry for all surfaces. Credential, OTP, social, passkey, and identity-provider integrations sit behind AUTH adapters; provider subject IDs are unique external references, never platform authorization truth.
- Use local/mock/test adapters during bootstrap. Production credential/social/OTP provider choice remains deferred until integration review. If self-managed passwords are enabled, store only approved adaptive password hashes and isolate recovery/factor secrets.
- Browser applications use host-only `Secure`, `HttpOnly`, appropriately `SameSite` opaque session cookies. Store only a hash of the high-entropy session token in PostgreSQL. Use server-side rotation, idle/absolute expiry, device/session metadata, CSRF tokens plus Origin/Fetch-Metadata checks for state-changing requests, and immediate revocation checks for sensitive actions.
- Do not share one broad cookie across Consumer Web, Creator Studio, and Admin hosts. AUTH may issue audience-bound session families from the same identity after explicit authentication/step-up. Creator access remains a role/eligibility check, not a different account.
- Mobile uses system secure storage for a rotating opaque refresh token and a short-lived audience-bound signed access token. Use authorization-code-with-PKCE style app handoff, exact redirect/app-link allowlists, refresh-token family reuse detection, per-device revocation, key/algorithm pinning, and no token in ordinary app logs or backups.
- Admin always uses a dedicated privileged audience/session, short idle/absolute limits, re-authentication for sensitive actions, and phishing-resistant MFA such as WebAuthn/passkeys before production privileged access. Consumer session possession cannot be upgraded silently into Admin access.
- Central session policy defines risk-tier durations, rotation, assurance age, device limits, and revocation. Exact consumer/creator duration values are decided before AUTH launch; exact Admin values and recovery/break-glass policy are decided before privileged production access.
- AUTH authenticates identity and assurance only. ADMIN owns role grants/approval records. Each domain authorizes every read/action using current actor identity, active role grant, action, object relationship/ownership, creator/tenant scope, country/channel gate, safety/enforcement, assurance, consent, and current state.
- Implement authorization as deny-by-default TypeScript policy/application-service code in the owning domain with reusable actor/context types. Do not introduce a general policy engine initially. Central middleware may authenticate and enforce coarse route requirements but cannot replace owner authorization.
- High-impact operations bind exact target, action, arguments, source/current-state version, requester, human approver(s), assurance, expiry, and correlation ID. Owning domain re-authorizes at execution. AI, Admin UI, role label, prior approval, or upstream service claim never authorizes by itself.
- Service/workload identities use separate audience-bound credentials and least-privilege scopes. Never forward a user token as unrestricted service authority or embed service credentials in jobs.

## Why

Central AUTH preserves one account ecosystem and unified revocation. Opaque Web sessions allow strong server control and avoid browser token exposure. Short-lived Mobile access tokens work with native apps and intermittent connectivity while rotating refresh families retain revocation. Explicit owner-domain policy keeps authorization close to current business truth and avoids a second policy language before complexity requires it.

## Rejected alternatives

- Four independent authentication systems: create account-linking, revocation, assurance, and support inconsistencies.
- Long-lived stateless JWTs: make immediate revocation, device/session control, and claim freshness unsafe.
- Browser tokens in local storage: increase script-exfiltration exposure and complicate CSRF/XSS posture.
- One cross-subdomain session cookie: expands compromise and audience-confusion blast radius.
- UI, API gateway, or AI-only authorization: cannot evaluate current owner state and object rules.
- General policy engine initially: adds a second language/runtime and policy synchronization burden without demonstrated policy scale.

## Consequences

AUTH and PostgreSQL are on the protected request path. Web and Mobile have different token transports but one session model. Every domain must implement and test its policy rather than assuming a central role check. Admin access requires stronger operational setup before production.

## Risks

- Hybrid token transport can drift into inconsistent semantics.
- Access-token lifetime creates a small Mobile revocation window.
- Session database lookup can add latency.
- Role/authorization policies can diverge across domains.
- Account linking/recovery can enable takeover.

## Mitigations

Use one session contract and test suite, short Mobile access TTL, sensitive-action online recheck, Valkey revocation acceleration backed by PostgreSQL, versioned permission catalogue, negative authorization tests, link/recovery step-up, reuse detection, security notifications, rate limits, and immutable audit.

## Scaling path

Phase A keeps AUTH inside modular monolith with shared PostgreSQL. Phase B adds cache acceleration and isolated authentication rate-limit capacity while PostgreSQL remains truth. Extract AUTH only when security isolation, availability, or team ownership requires it, using the same session/introspection contracts. Add a policy engine only after measured policy complexity and parity tests.

## Security implications

Use TLS, secure cookies, CSRF controls, PKCE, redirect allowlists, key rotation, token hashing, adaptive password hashing if applicable, enumeration resistance, recovery rate limits, session fixation protection, MFA, device/session revocation, breach/audit events, and secret-manager-held signing/provider keys. Never expose credentials, factors, recovery tokens, or session tokens to ANALYTICS or AI.

## Testing implications

Test signup/sign-in/link/recovery, cookie flags and CSRF, token rotation/reuse, audience/issuer/algorithm, device revocation, role revocation, object authorization, creator scope, country/safety gates, step-up, approval binding, session expiry, race conditions, and cross-surface privilege attempts. Run a shared conformance suite against every auth adapter.

## Migration/reversibility

Provider adapters and canonical internal subject IDs allow identity provider replacement after account-link mapping, dual verification, cutover, and rollback. Token/cookie formats are versioned. Policy-engine adoption can shadow-evaluate against current domain policies before enforcement. Existing sessions can be revoked during incompatible migrations.

## Status

| Decision | Classification |
|---|---|
| One centralized AUTH/session registry | LOCK NOW |
| Opaque browser sessions | LOCK NOW |
| Short-lived Mobile access plus rotating refresh token | LOCK NOW |
| Domain-owned RBAC/object authorization policies | LOCK NOW |
| Privileged MFA and bound human approvals | LOCK NOW |
| Production credential/social/OTP provider | DEFER UNTIL PROVIDER INTEGRATION |
| Exact risk-tier session durations and recovery rules | DECISION REQUIRED BEFORE FEATURE |
| External policy engine | DEFER UNTIL SCALE REQUIRES |
| Four independent auth systems and long-lived stateless sessions | REJECTED |

