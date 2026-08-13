# ADR-0017: Session, recovery, privileged access, and break-glass policy

- Decision date: 2026-08-13
- ADR status: Accepted
- Owners: Founder (decision owner), AUTH, ADMIN, security

## Context

[ADR-0009](ADR-0009-auth-authorization.md) locked the authentication architecture: one AUTH registry, opaque browser sessions, short-lived Mobile access tokens with rotating refresh families, domain-owned authorization, and bound privileged approvals. It deliberately left three items open: exact risk-tier session durations, recovery rules, and privileged/break-glass policy. [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md) recorded these as `AUTH risk policy` and `Privileged authentication policy`, due before AUTH feature implementation and before any privileged production access respectively.

Those values cannot be discovered during implementation. Session lifetime, refresh-reuse response, recovery assurance, step-up age, and emergency access are security policy, and scattering them as unexplained constants inside future AUTH code would leave no reviewable authority. This ADR fixes the exact values inside the architecture ADR-0009 already accepted. It changes no architecture and introduces no product capability.

This ADR is policy only. No signup route, sign-in route, session table, identity provider, factor implementation, or authentication screen ships with it. Repository state remains zero product features.

## Requirements

- Fix exact idle and absolute lifetimes for every surface risk tier.
- Fix Mobile access-token lifetime, refresh-token properties, rotation, and reuse response.
- Fix account-recovery channels, token properties, rate limits, and post-recovery revocation.
- Fix privileged MFA, Admin session limits, step-up assurance age, and exact-action approval binding.
- Fix privileged recovery and break-glass semantics without inventing an emergency system on identity infrastructure that does not exist yet.
- Keep every value testable and keep PostgreSQL authoritative for session and revocation truth.

## Options evaluated

1. Defer the values into implementation and let the first AUTH vertical choose them.
2. Adopt one uniform session policy for all four surfaces.
3. Adopt risk-tiered values per surface with a single session model.
4. Copy a provider's default policy and inherit its lifecycle.
5. Build a break-glass implementation now versus documenting required semantics and seams.

## Decision

Option 3 with option 5's documentation-only break-glass. Values below are locked. They sit inside ADR-0009's architecture; nothing here replaces it.

### Consumer Web session

| Property | Value |
|---|---|
| Mechanism | Opaque random session token |
| Token entropy | At least 256 bits |
| Server storage | Hash only; plaintext token never persisted |
| Idle timeout | 14 days |
| Absolute lifetime | 30 days |

Cookie carries the `__Host-` prefix with `Secure`, `HttpOnly`, `Path=/`, no `Domain` attribute, and `SameSite=Lax`.

State-changing requests require server-bound CSRF protection, exact `Origin` validation, and Fetch Metadata validation where the browser supplies reliable values. CORS is not relaxed without a documented, reviewed need.

Sessions rotate after authentication, privilege or assurance change, account recovery, a suspicious event, and any sensitive factor change. Normal logout revokes the current session; global logout revokes all relevant session families.

PostgreSQL is the authority for session existence, expiry, and revocation. Ephemeral Redis may accelerate checks but never owns revocation truth; a Redis miss or loss falls back to PostgreSQL rather than granting access.

### Creator Studio session

Creator Studio carries elevated business sensitivity and uses the same opaque-session model with shorter bounds.

| Property | Value |
|---|---|
| Idle timeout | 8 hours |
| Absolute lifetime | 7 days |

Sensitive creator finance and security operations require step-up reauthentication when those capabilities exist. Payout logic is not implemented by this ADR and remains gated by [ADR-0011](ADR-0011-payments-payouts.md) and payout compliance authority.

### Consumer Mobile session

| Property | Value |
|---|---|
| Access token | Signed, audience-bound, 10-minute lifetime |
| Refresh token | Opaque random, at least 256 bits entropy |
| Refresh storage | Hash only in PostgreSQL |
| Refresh use | Single-use, rotated on every successful refresh |
| Refresh family idle timeout | 30 days |
| Refresh family absolute lifetime | 90 days |

Reuse of an already-rotated refresh token revokes the entire refresh family, marks the session compromised, requires full authentication, emits a security event, and reaches the user-notification seam. Concurrency handling must distinguish a legitimate duplicate or retried refresh from an actual replay where the evidence allows it, and must fail closed toward family revocation when it cannot.

Token material lives in iOS Keychain-backed and Android Keystore-backed secure storage, is excluded from device backups where the platform supports it, is never written to ordinary asynchronous storage, and never appears in logs.

Each refresh family binds to an application installation or device record. Hardware-backed possession proof remains a future extension behind the same binding; no attestation provider is selected or assumed.

### Account recovery

Recovery channels in preference order: verified email recovery link, existing passkey or security key, single-use recovery code, support-assisted high-risk recovery. SMS is a secondary channel only and is never the sole high-assurance recovery method for a privileged account.

| Property | Value |
|---|---|
| Recovery token | Single-use, cryptographically strong, hashed at rest where applicable |
| Recovery token expiry | 15 minutes |
| Per account or destination | 3 per hour, 5 per day |
| Per IP or device baseline | 10 per hour |

Responses never disclose whether an account exists. High-risk or new-device recovery requires a second independent signal or manually reviewed recovery, notifies existing trusted channels, and does not immediately grant the highest assurance level.

Successful recovery revokes all previous sessions, revokes Mobile refresh families, rotates the relevant security state, and emits an audit and security event.

A 24-hour cooldown applies afterwards to high-impact actions including factor removal, payout destination change, privilege escalation, and any critical account-security change. Overriding the cooldown requires reviewed authorization recorded through the ADMIN approval path in [admin operations](../flows/admin-operations.md); it is never self-service.

### Platform Admin

Admin authentication is isolated from consumer and creator session authority. A consumer or creator session can never be upgraded into Admin authority.

Phishing-resistant WebAuthn or passkey MFA is mandatory. SMS, voice OTP, and email OTP are rejected as privileged primary MFA. Two independently stored authenticators are enrolled before production privileged access.

| Property | Value |
|---|---|
| Idle timeout | 15 minutes |
| Absolute lifetime | 8 hours |
| Step-up assurance age for high-impact actions | 5 minutes maximum |

High-impact actions include privilege and role changes, production configuration, security configuration, user enforcement, deletion, exports, financial operations, identity and security changes, and approvals.

Every high-impact operation binds approval to actor, target, operation, relevant arguments, before-state, expected after-state or effect, correlation ID, assurance level, approval timestamp, expiry, and approver where policy requires one. The owning domain re-authorizes current state at execution time. Broad reusable approvals do not exist.

### Privileged recovery

Recovering Admin authority requires dual control by two preauthorized security owners, verified operator identity, revocation of all old sessions, a short-lived bootstrap path, enrollment of new authenticators, post-recovery review, and the 24-hour high-impact restriction. An ordinary support agent can never recover Admin authority alone.

### Break-glass

Two named emergency accounts are prepared. They are disabled or just-in-time outside an incident, protected by hardware or passkey authenticators, and never share a credential. Maximum elevation is 30 minutes. Use requires an incident reference, triggers immediate alerting, writes immutable audit, and is never routine. Post-event review happens within 24 hours, and credentials and security state are reviewed and rotated after use.

No emergency system is implemented now. Production identity infrastructure does not exist, and a simulated break-glass path would be a false control. This ADR fixes the required semantics and the seams that the future implementation must satisfy; [incident response](../operations/04-incident-response.md) remains the operational authority for incident lifecycle.

### Durable AUTH invariants

- AUTH owns authentication and session truth. USERS owns profile and business identity fields outside authentication.
- Client applications never authorize themselves; server authorization is deny-by-default in the owning domain.
- The Admin audience is isolated from consumer and creator audiences.
- Mobile refresh reuse is detectable and revokes the family.
- Recovery revokes prior authority.
- Privileged operations require deterministic authorization, never a role label or an approval alone.
- Redis is never authoritative session truth.
- Passwords, tokens, and secrets never appear in logs.
- Session and recovery policy is testable.
- Provider selection stays behind adapters and remains `DEFER UNTIL PROVIDER INTEGRATION`.

## Why

Fixing the values now keeps them reviewable in one place rather than distributed across future AUTH code as unexplained constants. Risk-tiered lifetimes match the actual blast radius of each surface: a consumer session losing 14 idle days costs one account's social access, while a Creator Studio or Admin session of the same length would expose creator business data or platform-wide operations. Opaque tokens plus PostgreSQL truth keep revocation immediate, which is the property long-lived stateless tokens cannot provide. Single-use rotating refresh families make Mobile token theft detectable rather than silent. Documenting break-glass semantics without implementing them avoids a control that looks real in an audit and fails in an incident.

## Rejected alternatives

- Deferring values into implementation: the first AUTH vertical would set security policy implicitly, with no review point and no authority to test against.
- One uniform policy across all surfaces: either consumer usability suffers under Admin-grade limits, or privileged access inherits consumer-grade exposure.
- Provider default lifecycle: makes a vendor the owner of Velora's revocation and assurance policy and blocks portability.
- Implementing break-glass now: a simulated emergency path on absent production identity infrastructure is a false control and an audit liability.
- SMS, voice OTP, or email OTP as privileged primary MFA: not phishing-resistant, and SIM-swap and mailbox compromise are exactly the takeover paths privileged access must survive.

## Consequences

AUTH implementation now has exact, testable targets. Admin operators accept a 15-minute idle limit and 5-minute step-up window, which is deliberate friction. Creator Studio sessions expire faster than consumer sessions, so creators reauthenticate more often. Two hardware authenticators must be procured and enrolled before any privileged production access. The 24-hour post-recovery cooldown requires a reviewed override path, which ADMIN must build before support can handle legitimate urgent cases.

## Risks

- Short Admin and Creator limits can push operators toward unsafe workarounds.
- Refresh reuse detection can revoke a family on a legitimate network retry.
- Recovery rate limits can lock out a genuine user under shared IP conditions.
- The 10-minute access-token window leaves a bounded Mobile revocation gap.
- Hardware authenticator loss can strand privileged access.
- Values recorded here can drift from implementation if not tested.

## Mitigations

Measure real operator session behaviour before relaxing any Admin value, and change it by amending this ADR rather than in code. Distinguish retried refreshes from replay by request identity and rotation generation, and prefer family revocation plus a clear re-authentication path over silent acceptance. Apply per-account and per-destination limits ahead of per-IP limits so shared egress does not lock out individuals, and expose a support-assisted path. Recheck revocation online for sensitive Mobile actions rather than trusting access-token lifetime. Require two independently stored Admin authenticators and dual-control privileged recovery. Test every value in this ADR as a policy assertion so drift fails CI rather than surfacing in an incident.

## Scaling path

Values here fit the modular monolith with shared PostgreSQL. Ephemeral Redis may later accelerate session and revocation lookups while PostgreSQL remains truth. Device limits, continuous risk scoring, and hardware-backed device proof are additive extensions to the same session model and require an amendment only when they change a locked value. Extracting AUTH does not change this policy.

## Security implications

All values assume TLS, the cookie flags above, CSRF plus Origin and Fetch Metadata validation, token hashing at rest, enumeration-resistant responses, session fixation protection, recovery rate limits, immutable audit, and secret-manager-held signing keys, exactly as [ADR-0009](ADR-0009-auth-authorization.md) and [security baseline](../security/01-security-baseline.md) require. Session tokens, refresh tokens, recovery tokens, and factor secrets are never exposed to ANALYTICS or AI.

## Testing implications

Every value above is a test target: idle and absolute expiry per surface, cookie prefix and attribute assertions, CSRF and Origin rejection, Fetch Metadata handling, rotation on authentication and privilege change, logout scope, Mobile access-token expiry, single-use refresh rotation, refresh reuse family revocation, concurrent-refresh distinction, recovery token expiry and single use, recovery rate limits per account and per IP, enumeration resistance, post-recovery revocation of sessions and refresh families, the 24-hour cooldown and its override path, Admin idle and absolute expiry, 5-minute step-up assurance age, exact-action approval binding and execution-time re-authorization, and cross-surface privilege escalation attempts. Break-glass semantics are tested when the emergency path is implemented, not simulated before then.

## Migration/reversibility

Values are configuration-shaped policy, not schema. Shortening a lifetime takes effect on the next evaluation; lengthening one requires an amendment to this ADR and a security review. Token and cookie formats stay versioned per ADR-0009, and incompatible changes revoke existing sessions rather than accepting ambiguous state.

## Status

| Decision | Classification |
|---|---|
| Consumer Web opaque session values and cookie policy | LOCK NOW |
| Creator Studio elevated session values | LOCK NOW |
| Mobile access, refresh, rotation, and reuse-detection values | LOCK NOW |
| Account recovery channels, token properties, and rate limits | LOCK NOW |
| Post-recovery revocation and 24-hour high-impact cooldown | LOCK NOW |
| Admin phishing-resistant MFA, session values, and step-up assurance age | LOCK NOW |
| Exact-action approval binding and execution-time re-authorization | LOCK NOW |
| Privileged recovery dual control | LOCK NOW |
| Break-glass semantics and seams, documentation only | LOCK NOW |
| Break-glass implementation | DECISION REQUIRED BEFORE FEATURE |
| Device limits, continuous risk scoring, hardware-backed device proof | DEFER UNTIL SCALE REQUIRES |
| Credential, social, OTP, passkey, and identity providers | DEFER UNTIL PROVIDER INTEGRATION |
| SMS, voice OTP, or email OTP as privileged primary MFA | REJECTED |
| Uniform session policy across all four surfaces | REJECTED |
| Provider-default session lifecycle | REJECTED |

## Machine-readable locked policy

This block is the enforced projection of the tables above. `pnpm auth:policy` fails when it drifts from the locked baseline in `scripts/check-auth-policy.mjs`, when it disagrees with the prose in this ADR, or when another document restates a locked value instead of pointing here. Changing any value requires amending this ADR and the baseline together, under security review.

```json
{
  "policyVersion": 1,
  "sessions": {
    "consumerWeb": {
      "mechanism": "opaque",
      "serverStorage": "hash-only",
      "idle": "14d",
      "absolute": "30d",
      "cookiePrefix": "__Host-",
      "cookieAttributes": [
        "Secure",
        "HttpOnly",
        "Path=/",
        "no-Domain",
        "SameSite=Lax"
      ]
    },
    "creatorStudio": {
      "mechanism": "opaque",
      "serverStorage": "hash-only",
      "idle": "8h",
      "absolute": "7d"
    },
    "consumerMobile": {
      "accessToken": "10m",
      "refreshIdle": "30d",
      "refreshAbsolute": "90d",
      "refreshUse": "single-use-rotating",
      "refreshStorage": "hash-only",
      "reuseResponse": "revoke-family"
    },
    "platformAdmin": {
      "idle": "15m",
      "absolute": "8h",
      "stepUpAssuranceAge": "5m",
      "privilegedMfa": "webauthn-or-passkey",
      "authenticatorsBeforeProduction": 2
    }
  },
  "recovery": {
    "tokenExpiry": "15m",
    "perAccountPerHour": 3,
    "perAccountPerDay": 5,
    "perIpPerHour": 10,
    "highImpactCooldown": "24h",
    "revokesPriorSessions": true
  },
  "breakGlass": {
    "accounts": 2,
    "maximumElevation": "30m",
    "postEventReview": "24h"
  }
}
```

## Cross-references

[ADR-0009](ADR-0009-auth-authorization.md), [AUTH](../domains/auth.md), [onboarding](../flows/onboarding.md), [account deletion](../flows/account-deletion.md), [admin operations](../flows/admin-operations.md), [security baseline](../security/01-security-baseline.md), [RBAC](../security/02-access-control-rbac.md), [incident response](../operations/04-incident-response.md), [ADMIN](../domains/admin.md), and [open decisions](DECISIONS_REQUIRED.md).
