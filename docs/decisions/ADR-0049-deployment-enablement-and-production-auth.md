# ADR-0049: Production stops being impossible, and starts being unconfigured

- Decision date: 2026-09-11
- ADR status: Accepted
- Owners: Founder (decision owner), AUTH, OPERATIONS, ADMIN, platform/security

## Context

VELORA was fail-closed everywhere and unreachable in one place, and the two look identical from inside a running process.

`packages/config/src/server.ts` refused four AUTH selections in staging and production unconditionally — not the value that was set, but every value the schema admitted:

```text
AUTH_IDENTITY_PROVIDER is not usable in production: no production identity
provider is approved; see DECISIONS_REQUIRED
```

The enum behind that field had exactly one member, and it was the development adapter. The same was true of the signer and of the recovery sink, and the authenticator verifier offered only "refuses everything" and "accepts everything". So there was no environment file, no secret manager, and no owner decision that would ever have started a deployed VELORA. The closed-beta rehearsal that discovered this reported it accurately: a beta could run only on `APP_ENV=local`.

That is a different thing from being blocked on a provider, and the difference matters more than it sounds. A platform blocked on a provider tells an owner what to go and get. A platform with no admissible value tells an owner nothing, cannot be rehearsed, cannot be threat-modelled against a real topology, and quietly accumulates code that has never once run outside a developer's machine.

Three smaller absences had the same shape. A deployment with no operator grant had nobody who could issue one. Two deploys could apply migrations concurrently with nothing to stop them, on a repository that had already been bitten once by a migration journal defect. And there was no command an operator could run against an environment to be told what it was.

## Decision

### The four AUTH seams each get one production-capable selection, and each names a standard rather than a vendor

| Seam | Development | Production-capable | What it needs |
|---|---|---|---|
| `AUTH_IDENTITY_PROVIDER` | `local` | `oidc` | issuer, client id, client secret, redirect address |
| `AUTH_ACCESS_TOKEN_SIGNER` | `local-development-ed25519` | `managed-ed25519` | Ed25519 key material from the secret manager |
| `AUTH_RECOVERY_DELIVERY` | `local-test` | `smtp` | a submission endpoint and a sender address |
| `AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER` | `unavailable`, `local-test-privileged` | `webauthn` | a relying-party domain and its origins |

Every one is an open standard, and that is the point rather than a coincidence. The vendor questions in [open decisions](DECISIONS_REQUIRED.md) — which identity platform, which email provider — stay open, because none of these adapters embeds a vendor. An owner answers them later by writing configuration, not by asking for an adapter.

**The load-bearing property is the shape of the refusal, not the presence of the adapter.** A deployed environment with no provider configured now fails on

```text
AUTH_OIDC_ISSUER is required when AUTH_IDENTITY_PROVIDER is oidc
```

which names something an owner can go and get. The development adapters are still refused in staging and production, by name and individually, with each refusal saying what the adapter actually does and which value to select instead.

Provider-configuration completeness is checked in **every** environment, not only deployed ones, on the rule the LiveKit selection already followed: an adapter selected without what it needs is a startup failure, never a quiet downgrade. An environment that presented "no provider exists" to one developer and a working sign-in to the next, from the same commit, would be the most misleading state this platform could be in.

### OpenID Connect, verified rather than decoded

`OidcIdentityProvider` is a confidential relying party and the whole trust decision fits in one file. A browser is sent to the provider carrying a single-use state, nonce, and PKCE challenge that were committed to PostgreSQL *before* the redirect. The code that comes back is exchanged over the back channel with `client_secret_basic`. The ID token is believed only after its signature verifies against a key the provider published at the `jwks_uri` in its own discovery document, its issuer matches character for character, its audience contains this client, its authorized party is this client whenever there is more than one audience, its lifetime is current, and its nonce is the one minted for this attempt.

Discovery and the key set are re-read on a one-hour cadence. A key already held is trusted only while the set it came from is inside that cadence, because removing a key from the published set is how a provider revokes it: a removed key stops verifying at the next re-read rather than for the life of the process. An unknown key identifier forces a re-read at most once a minute, which makes a provider's rotation immediately usable and an attacker-chosen identifier worthless as a way to make the platform fetch. Corrected on 2026-10-21; before that, a known identifier was returned from the cache without the age check.

`alg: none` is not refused by a branch; it is absent from the set of algorithms that can find a verification function at all, so there is no path on which an unsigned token reaches a claim check.

The attempt is bound to the browser that opened it by a host-only, `SameSite=Lax` cookie set alongside the authorization address. Without it the callback would accept any code and state pair from any browser, which is login CSRF: somebody completes an attempt on their own machine and then walks a victim onto the callback, and the victim's browser is handed a session for an account that is not theirs. The state alone stops a replay; the cookie is what makes the replay have to come from the same browser.

VELORA asks for the `openid` scope and nothing else. It stores no email address and displays no provider profile, so requesting one would be collecting personal data with no purpose to justify it — and it keeps the [email address ownership](DECISIONS_REQUIRED.md) decision genuinely open rather than answering it by accident.

### WebAuthn, without a CBOR parser

`WebAuthnAuthenticatorVerifier` verifies real assertions. The browser already exposes the credential public key as SPKI through `getPublicKey()` and the raw authenticator data through `getAuthenticatorData()`, so the server receives exactly the two structures it must check and parses neither an attestation object nor a COSE key. Every byte it reads is a fixed-offset field or plain JSON, which is the smallest parser this ceremony can be built on.

What it checks is the phishing resistance itself: the challenge is one this server issued and consumed exactly once, and the origin is the one the browser actually reached, written into the client data where no page can forge it. An operator phished onto another host produces an assertion naming that host, and it verifies nowhere.

The signature algorithm is derived from the stored key rather than stored beside it. Storing it separately would be storing the same fact twice, and the copy would be the one a caller could influence at enrolment.

Attestation is not requested and not verified. That is the recommended posture for a relying party not enforcing an enterprise authenticator allowlist: an enrolled credential is trusted because an already-authenticated operator enrolled it against a challenge this server issued, not because of a certificate chain nobody has decided how to pin.

Challenges live in `auth_privileged_challenges` rather than in memory or ephemeral Redis. Single use is the entire anti-replay property, and a control a restart forgets is not one.

### Recovery delivery is SMTP submission, and the transport is encrypted or nothing is sent

`smtps:` connects with implicit TLS; `smtp:` must complete a STARTTLS upgrade before the adapter authenticates or names a recipient. A permissive client would carry on in cleartext, and a recovery code on the wire is the whole account.

It is production-*capable* and not production-*approved*, and the reason is recorded rather than implied: a recovery message needs a destination, and no domain stores a consumer's email address. That remains its own decision.

One defect was found and fixed alongside it. `RecoveryService` delivered outside its transaction and let a delivery failure escape, and only a request for an account that *exists* reaches that line — so a real provider would have turned the one path that is careful never to disclose whether an account exists into the place it was disclosed, by answering `500` for a known subject and `202` for an unknown one. Delivery failures are now absorbed and logged; the token expires on its own.

### Outbound networking gets exactly two approved adapters, named individually

`docs/security/06-abuse-outbound-networking.md` is deny-all and allows one shape of exception: an approved adapter that owns the primitive, is reviewed on its own, and is the thing every other module is handed instead. This phase creates the first two.

`security/outbound-http.ts` owns `fetch`. It enforces TLS except on loopback in local and test, refuses redirects, validates every address a hostname resolves to against loopback, private, link-local, unique-local, carrier-grade NAT, multicast, and the metadata address, bounds time and response bytes, sends no cookies, and refuses a URL carrying credentials outright. It deliberately does not decide *where* a caller may go: that is a capability decision belonging to the provider adapter making it, and the OIDC adapter derives every destination from the configured issuer or from the discovery document that issuer served.

`security/smtp-client.ts` owns `node:net` and `node:tls`, and nothing else in the backend may.

Both are listed by exact path in `scripts/check-boundaries.mjs`, which additionally fails if a listed path stops existing — an exemption nobody is checking is an exemption that has quietly widened.

One residual risk is written down rather than hidden: addresses are validated and the connection is then made by name, so a hostile authoritative DNS server could answer differently for the two lookups. Pinning the connection to a validated address needs an agent neither Bun's nor Node's `fetch` exposes. It matters little for destinations that come from a deployment's own configuration, and it is named so a future caller that takes a destination from a request knows this port is not sufficient alone.

### A deployed environment refuses addresses only it can reach

Browser origins must be `https` and must not name a loopback host, and all three audience lists must name at least one origin — an audience with no allowed origin cannot start a session at all, which is a deployment that looks broken rather than one that is closed. `AUTH_TOKEN_ISSUER`, `WEB_PUBLIC_ORIGIN`, `VELORA_API_BASE_URL`, `AUTH_OIDC_ISSUER`, and `AUTH_OIDC_REDIRECT_URI` are held to the same rule, and the `.invalid` placeholder issuer is refused by name.

### The first operator grant needs three independent things, and the database enforces the "once"

A deployment where nobody holds a grant has nobody who can issue one. `POST /v1/admin/operators/bootstrap` is the way out, and it requires all three of:

- a live Platform Admin session at fresh phishing-resistant assurance, which means a real identity provider admitted this person **and** a real authenticator answered a challenge;
- the deployment-time secret in `ADMIN_OPERATOR_BOOTSTRAP_TOKEN`, which means whoever is asking also deployed this environment;
- no live grant existing, checked inside the transaction that writes one.

`operations_operator_bootstraps` has room for exactly one row: `singleton` is constrained to true and uniquely indexed, so two concurrent attempts cannot both insert whatever order they interleave in, and the row is never removed — which is what makes a replay after a restart fail the same way a replay a second later does. The token is stored as a digest, because a platform that kept a comparable copy could re-run its own bootstrap.

Every refusal answers identically. Whether the session was not privileged enough, the secret did not match, or somebody already came through is not something a caller learns.

There is deliberately **no** CLI that writes the grant directly. A command holding database credentials would bypass the verifier, which is the control the other two conditions exist to compose with.

### Migration deployment gets a lock, a pre-check, and a verification

`apps/api/scripts/migrate-database.ts` now validates the journal before it migrates, holds a PostgreSQL advisory lock derived from a constant key while it does, and afterwards asserts that the number of applied migrations equals the number on disk.

The journal check is the same property `pnpm db:journal:check` guards in CI, repeated here because CI guards a commit and this guards a deployment, and the deployment is the one with a live database behind it. The verification is the assertion the journal defect defeated: it is the difference between "the migrator exited zero" and "the schema is the one this build expects".

The advisory lock is the right instrument rather than a lock table, because it is released when the connection closes — including when the process is killed, which is exactly when a lock table would strand a deployment.

### `pnpm deployment:doctor` is the command that answers "what is this environment"

Read-only, safe against anything, and never prints a secret: what it reports is either a configured selection or an answer a dependency actually gave. There is no branch that calls a provider healthy because an environment variable was present.

Its exit code is its whole opinion: non-zero when something would stop the environment serving, zero when the remaining gaps are provider decisions nobody has made. A staging deployment with no payment provider is healthy. One three migrations behind is not.

### `X-Forwarded-For` is read at a position a count names, or not at all

`TRUSTED_PROXY_HOP_COUNT` is a count rather than a boolean because the correct read is not derivable from the request. Reading the leftmost entry hands every caller a free rate-limit bypass; ignoring the header behind a proxy puts every caller in one bucket. With exactly `n` proxies in front, the address the outermost saw is the entry `n` from the right. Zero — the default — ignores the header entirely, which is the only safe answer for a process a client can reach directly.

## What this does not do

Selecting an AUTH provider enables authentication and nothing else. Every other seam is refused in staging and production for its own separate reason, and this ADR changes none of them: no media may be stored or delivered, no money may move, no notice may be delivered, no call may be carried, no identity may be verified, and no AI route may run. Those are decisions in [open decisions](DECISIONS_REQUIRED.md), not missing adapters.

It also does not approve an identity provider, an email provider, a hosting platform, a domain, or a secret manager. It makes each of them a configuration value rather than an architecture change.

## Consequences

- `APP_ENV=production` starts, serves `/v1/health/live` and `/v1/health/ready`, and reports ready — proved by a startup rehearsal against a production-shaped configuration.
- A deployed environment cannot select a development adapter, cannot name a loopback address, cannot run without a phishing-resistant verifier, and cannot leave an audience with no origin.
- The backend has two files that may hold a network primitive, and a boundary check that fails if either is renamed away.
- The first operator is a reviewable, auditable, exactly-once act rather than a row somebody with database access inserted.
- `pnpm ci:verify` gains nothing to run; `pnpm deployment:doctor` is deliberately outside it, because it asks a live environment questions CI has no environment to answer.

## References

- [ADR-0009](ADR-0009-auth-authorization.md) keeps identity, credential, and authenticator integrations behind AUTH adapters.
- [ADR-0014](ADR-0014-deployment-environments-cicd.md) locks environment separation, secret injection, and controlled egress.
- [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md) locks session, recovery, and privileged-access policy. No value in this ADR restates one.
- [ADR-0034](ADR-0034-local-test-admin-authenticator.md) introduced the local-test privileged verifier this ADR keeps local-only.
- [ADR-0048](ADR-0048-operator-control-plane-and-composed-activity.md) owns operator grants, which this ADR gives a first one.
- [outbound networking](../security/06-abuse-outbound-networking.md) is the authority the two approved adapters are the exception to.
