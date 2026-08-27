# ADR-0034: Local-test privileged authenticator adapter for Platform Admin

- Decision date: 2026-08-27
- ADR status: Accepted

## Context

[ADR-0029](ADR-0029-platform-admin-product-interface.md) records that Platform Admin is unreachable in every environment. Two independent conditions block it:

1. `/v1/auth/local/web-sessions` admits only `consumer_web` and `creator_studio` audiences. No route can issue a `platform_admin` session.
2. The only composed verifier is `UnavailablePrivilegedAuthenticatorVerifier`, which refuses every assertion. No session can reach the `phishing_resistant` assurance `AdminContextResolver` requires, because [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md) mandates a phishing-resistant authenticator for privileged access and no real implementation has been approved.

The freeze report documents this honestly. ADR-0029 goes further, noting that "the ten console screens were driven at the same ten widths against a scratchpad stub... **That is a weaker guarantee than the other two surfaces have**" — and that it becomes a browser assertion the day a privileged authenticator is approved.

This creates a concrete, bounded problem: the Platform Admin surface cannot be reached in local development for manual product testing, UI review, or verifying that the screens work end-to-end with a real API. The same adapter pattern every other deferred provider uses — a deterministic `local-test` implementation that is refused by configuration in staging and production — resolves it without weakening any deployed environment.

## Decision

### Add a `local-test-privileged` privileged authenticator adapter

A new `LocalTestPrivilegedAuthenticatorVerifier` class is added to `apps/api/src/auth/identity-provider.ts`. It implements `PrivilegedAuthenticatorVerifier` exactly — same interface, same return shape — and accepts every assertion deterministically. It performs no cryptography, reaches no network, and keeps no state. Its `kind` is `'local-test-privileged'`, which is distinct from `'unavailable'` and from any future real verifier's kind.

The adapter exists so the AUTH domain's privileged-access path — enrolment, step-up, assurance freshness, exact-action binding — is fully exercisable during local development. It does not constitute approval of a real verifier; that decision remains `DEFER UNTIL PROVIDER INTEGRATION` in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).

### Register it in the config adapter registry

A new constant `localTestPrivilegedVerifier = 'local-test-privileged'` is exported from `packages/config/src/server.ts`. It is added to the `AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER` enum in `serverConfigSchema`, and to the existing `superRefine` guard that rejects every non-`unavailable` auth adapter in staging and production. That guard already covers the identity provider, access-token signer, and recovery delivery channel; adding this adapter to it keeps the four-adapter fail-closed contract complete and consistent.

Configuration refuses `local-test-privileged` in staging and production at schema parse time, before any adapter is instantiated. The API process does not start rather than starting with a degraded security posture.

### Add a dedicated local admin session issuance route

A new route `POST /v1/auth/local/admin-sessions` is registered. It:

- Is gated by the same two-condition guard that all local auth routes use: the identity adapter must be `local`, and `APP_ENV` must be `local` or `test`. A staging or production deployment that somehow carried the `local-test-privileged` verifier would still be refused by this check.
- Additionally checks that the configured privileged verifier's `kind` is `local-test-privileged`. The `unavailable` verifier cannot satisfy this check, so the route is inert whenever the default adapter is composed.
- Validates the request origin against the `platform_admin` allowed-origins list, which is empty in staging and production and must be explicitly populated for local development.
- Accepts a `{ subject, deviceId? }` body (no audience field — the audience is always `platform_admin`).
- Issues the session with `assurance: 'phishing_resistant'` directly at creation time. This is safe because the route handler is the only caller of the `assuranceOverride` parameter, which is internal to the AUTH service; no client can supply it.

### Update `.env` to configure the admin origin

`AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN=http://127.0.0.1:3002` is set in `.env`. The value was previously empty, which meant the admin audience could not start any browser session at all. The port matches the admin Next.js dev server.

`AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER=local-test-privileged` is set in `.env`, activating the new adapter for local development.

### Add a local sign-in panel to the access page

`apps/admin/src/product/access.tsx` is updated to conditionally render a local-development sign-in panel when `appEnvironment === 'local'`. The panel is clearly labelled "Local development only — not a production authentication mechanism". It accepts a subject, calls the new route, and on success causes the session context to reload, which passes the gate check and enters the console. No sign-in control of any kind appears in staging or production builds, because the environment prop comes from the server at request time and the condition is never satisfied there.

The existing `BlockedState` explanation continues to render in all environments. In staging and production it is the only thing on the page. In local development it appears alongside the sign-in panel, making explicit that the local mechanism does not change the deployed behaviour.

## Security properties

| Property | How it holds |
|---|---|
| Staging and production cannot use this adapter | `serverConfigSchema.superRefine` rejects `local-test-privileged` in staging and production at config parse time. The API fails to start rather than starting with a weakened verifier. |
| Mis-wired composition root cannot expose it | The route handler checks `verifier.kind === 'local-test-privileged'` independently of config. The `unavailable` verifier, which is the composition-root default, cannot satisfy this check. |
| Loopback-only | `AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN` in staging and production is empty or a non-loopback origin. The origin check in `CallerResolver` refuses any request whose origin is not in the allowed list. |
| No production platform_admin session until a real provider is approved | The config schema `AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER` enum currently contains only `unavailable` and `local-test-privileged`. A real WebAuthn verifier is a new enum value, a new ADR, a new registry entry, a security review, and an updated `superRefine` guard. No shortcut exists. |
| Existing security checks unchanged | CSRF validation, origin validation, cookie flags, `AdminContextResolver.requireFreshAssurance`, rate limiting, and all other AUTH invariants are unchanged. The local admin route is admitted by the existing `admitted` middleware rather than bypassing it. |
| `AdminContextResolver` is unchanged | It continues to require `platform_admin` audience and `phishing_resistant` assurance within the ADR-0017 step-up window. The local session satisfies both because the route issues both at creation. |

## What this does not change

- **ADR-0017** locked values: session lifetimes (15m idle / 8h absolute for Platform Admin), step-up assurance maximum age (5 min). Nothing here restates or changes a locked constant.
- **The real verifier decision**: choosing, reviewing, and approving a production phishing-resistant authenticator remains `DEFER UNTIL PROVIDER INTEGRATION` in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
- **The role and scope matrix**: which role may claim a case, record a decision, or issue a refund is an open decision. The console offers what the contract publishes to a session that could hold it; local access does not change that.
- **The approval, dual control, and break-glass decision**: locked in ADR-0017 semantics; implementation remains deferred.

## Consequences

- Platform Admin is reachable in local development for the first time. Manual product testing, UI review, and end-to-end browser assertions over the console screens are now possible.
- The freeze report is updated: "Zero in staging and production; reachable in local/test with the `local-test-privileged` adapter" replaces "Zero, in every environment".
- The access page adds an explicit "Local development only" panel rather than only an explanation, making it a usable entry point in local without obscuring the deployed behaviour.
- The adapter pattern used by every other deferred provider (identity, access-token signer, recovery delivery, payment, payout, media, RTC, notifications) now extends to the privileged authenticator verifier.

## Amendment scope

This ADR amends the adapter registry in ADR-0009 (adds one entry to the `privilegedVerifiers` map) and does not change any value locked by ADR-0017. It does not authorise a production verifier, a production admin session, or any production capability.

## Cross-references

[ADR-0009](ADR-0009-auth-authorization.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md), [ADR-0029](ADR-0029-platform-admin-product-interface.md), [platform admin freeze report](../architecture/20-platform-admin-freeze-report.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md), [platform admin surface](../surfaces/04-platform-admin.md).
