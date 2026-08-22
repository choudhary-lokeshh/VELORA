# Configuration and environments

Primary authority for what every environment variable Velora reads controls,
who owns it, whether it is secret, which environment needs it, and what happens
when it is absent. [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md)
owns the environment and secret-boundary decisions this document projects;
`packages/config` owns validation. Neither is restated here as a competing
opinion.

## Rules

- `packages/config/src/server.ts` is the only schema for API and worker
  configuration, and `packages/config/src/client.ts` the only one for the
  browser and mobile surfaces. A new field is added there, never parsed ad hoc
  at a call site.
- Every field the runtime reads appears in `.env.example` and in the matrix
  below. `pnpm env:check` fails the gate when the schema, the template, and this
  document disagree, so the three cannot drift apart again.
- Validation happens once, at startup. A configuration error stops the process
  before the port opens; it never surfaces as a failed request.
- `local` and `test` may use safe defaults. `staging` and `production` fail
  closed: an absent required value, or a development adapter, refuses to start.
- Secrets live in the runtime secret manager. `.env.example` carries
  placeholders only, `.env` is never committed, and `pnpm secrets:check` fails
  on a tracked environment file at any path.
- A value with a `NEXT_PUBLIC_` or `EXPO_PUBLIC_` prefix is compiled into a
  shipped client bundle and is public forever. Only `EXPO_PUBLIC_APP_ENV` and
  `EXPO_PUBLIC_API_BASE_URL` may carry one; `pnpm env:check` fails on any other.

## What staging and production do today

Neither starts. Every AUTH adapter that exists is a development or test
implementation, and the loader refuses all four unconditionally outside `local`
and `test`:

```text
AUTH_IDENTITY_PROVIDER is not usable in production: no production identity
provider is approved; see DECISIONS_REQUIRED
```

That is the accurate state of a platform with no approved identity provider,
signing authority, recovery delivery channel, or phishing-resistant
authenticator verifier. It is lifted by the decisions in
[open decisions](../decisions/DECISIONS_REQUIRED.md), not by configuration.
Every provider seam below is refused in those environments for its own separate
reason, so lifting the AUTH block alone enables nothing else.

## Classifications

| Classification | Meaning |
|---|---|
| Required now | Must be set for the process to run at all in that environment |
| Safe default | Absent is a supported state; the default is the documented behaviour |
| Fixed | The schema admits one value; anything else is a configuration error |
| Future provider | Exists so an approved adapter can be selected later; refuses today |
| Blocked in production | A value that works locally and is rejected in staging and production |

## API and worker configuration

Owner: `packages/config/src/server.ts`, read once by `apps/api/src/application.ts`
and `apps/api/src/worker.ts`. Surfaces: API service, worker service, migration
runner. None of these values ever reaches a browser or a mobile bundle.

### Runtime

| Variable | Secret | Classification | Default | If missing |
|---|---|---|---|---|
| `APP_ENV` | No | Safe default | `local` | Treated as `local`, which disables every deployed guard. Set it explicitly in every deployed environment |
| `HOST` | No | Safe default | `127.0.0.1` in `local`/`test`, `0.0.0.0` otherwise | The derived value applies; a container that must bind elsewhere sets it |
| `PORT` | No | Safe default | `4000` | The default applies |
| `LOG_LEVEL` | No | Safe default | `info` | The default applies. One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

`APP_ENV` decides every fail-closed guard in this document. It is the one field
whose wrong value is silently permissive rather than loud.

### Data stores

| Variable | Secret | Classification | Local value | If missing |
|---|---|---|---|---|
| `DATABASE_URL` | Yes when deployed | Required now, every environment | `postgresql://velora:velora_local_only@127.0.0.1:5432/velora` | Startup fails. The API opens its pool before the port binds, so an unreachable database is a failed start rather than failing readiness |
| `EPHEMERAL_REDIS_URL` | Yes when deployed | Required now, every environment | `redis://127.0.0.1:6379/0` | Startup fails |
| `QUEUE_REDIS_URL` | Yes when deployed | Required now, every environment | `redis://127.0.0.1:6379/1` | Startup fails |

Format: `postgres:`/`postgresql:` and `redis:`/`rediss:` respectively; anything
else is refused. The local credentials match `compose.yaml` and grant nothing
anywhere else. Where the deployed values come from: the managed PostgreSQL and
Redis instances of that environment, through its secret manager.

The two Redis duties stay logically separate in every environment, including
local development, where they are different logical databases on one instance.
Ephemeral Redis holds cache, rate-limit, and signalling state and may be flushed;
queue Redis is durable BullMQ infrastructure and may not.

### AUTH

| Variable | Secret | Classification | Default | If missing |
|---|---|---|---|---|
| `AUTH_IDENTITY_PROVIDER` | No | Fixed `local`; blocked in production | `local` | The default applies locally; staging and production refuse to start regardless of the value |
| `AUTH_ACCESS_TOKEN_SIGNER` | No | Fixed `local-development-ed25519`; blocked in production | `local-development-ed25519` | As above |
| `AUTH_RECOVERY_DELIVERY` | No | Fixed `local-test`; blocked in production | `local-test` | As above |
| `AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER` | No | Fixed `unavailable`; blocked in production | `unavailable` | As above |
| `AUTH_TOKEN_ISSUER` | No | Safe default | `https://auth.velora.invalid` | The default applies. A URL, and deliberately an unresolvable one until an issuer exists |
| `AUTH_ACCESS_TOKEN_SIGNING_KEY` | Yes | Safe default | none | The API generates an ephemeral Ed25519 key pair that does not survive a restart, so every issued access token stops verifying. Format: base64 PKCS8, at least 32 bytes decoded. Where the value comes from: an approved KMS or secret manager, which does not exist yet |
| `AUTH_ACCESS_TOKEN_VERIFICATION_KEYS` | No, public key material | Safe default | none | No retired key verifies. Comma-separated base64 SPKI Ed25519 public keys. Listing a key here rotates a signing key without invalidating live tokens; removing one revokes every token it signed |
| `AUTH_BROWSER_ORIGINS_CONSUMER_WEB` | No | Required for that audience | `http://127.0.0.1:3000` | That audience cannot start a browser session at all |
| `AUTH_BROWSER_ORIGINS_CREATOR_STUDIO` | No | Required for that audience | `http://127.0.0.1:3001` | As above |
| `AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN` | No | Required for that audience | blank | Platform Admin cannot start a browser session. Blank is the deliberate default: Admin has no approved origin |

Origin lists are comma-separated exact `scheme://host[:port]` values. A path, a
query, credentials, or a wildcard-looking entry is refused rather than silently
matching nothing. Session, recovery, and privileged-access constants are locked
by [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md)
and are not configurable.

### Identity Assurance

| Variable | Secret | Classification | Default | Local alternative |
|---|---|---|---|---|
| `IDENTITY_VERIFICATION_PROVIDER` | No | Future provider; blocked in production | `unavailable` | `local-test`, a network-free deterministic fixture |
| `IDENTITY_JURISDICTION_POLICY` | No | Future provider; blocked in production | `unpublished` | `local-test` |

Provider and jurisdiction policy are independent: an eligible provider does not
publish legal policy, and a published policy does not approve a vendor. Both
refuse by default and both are rejected in staging and production.

### Trust & Safety

| Variable | Secret | Classification | Default | Local alternative |
|---|---|---|---|---|
| `SAFETY_TAKEDOWN_POLICY` | No | Future policy; blocked in production | `unpublished` | `local-test` publishes deterministic arithmetic |
| `SAFETY_APPEAL_POLICY` | No | Future policy; blocked in production | `unpublished` | `local-test` |
| `SAFETY_CONSENT_POLICY` | No | Future policy; blocked in production | `unpublished` | `local-test` publishes deterministic wording |
| `SAFETY_MATURE_CONTENT` | No | Fixed `disabled`, every environment | `disabled` | none, deliberately |

`SAFETY_MATURE_CONTENT` is the one seam with no development alternative.
[ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
rejects shipping the workflow behind a flag that could be flipped, so the schema
admits exactly one value in every environment and any other is an error rather
than a switch. `unpublished` on the three policies is not a failure state: a
takedown deadline or a consent form invented in configuration would carry no
authority.

### Messaging

| Variable | Secret | Classification | Default | Local alternative |
|---|---|---|---|---|
| `MESSAGING_SAFETY_ELIGIBILITY` | No | Blocked in production | `unavailable` | `trust-and-safety`, the real block store |

The real source works locally and is refused when deployed, because messaging is
blocked on message retention duration and post-block history visibility rather
than on a missing capability.

### Realtime and RTC

| Variable | Secret | Classification | Default | Local alternative |
|---|---|---|---|---|
| `REALTIME_CALL_ELIGIBILITY` | No | Blocked in production | `unavailable` | `composed`, built from DISCOVERY and TRUST & SAFETY |
| `REALTIME_RTC_PROVIDER` | No | Future provider; blocked in production | `unavailable` | `local-test`, in-process, no network, no media |
| `REALTIME_SIGNAL_TRANSPORT` | No | Safe default, permitted in every environment | `unavailable` | `redis`, fan-out over ephemeral Redis |

The first two refuse for independent reasons and either alone stops a call.
`REALTIME_SIGNAL_TRANSPORT` is transport only: it holds no call state, decides
nothing, and losing it loses no durable fact, which is why it is the one
realtime field a deployed environment may set.

### Notifications

| Variable | Secret | Classification | Default | Local alternative |
|---|---|---|---|---|
| `NOTIFICATIONS_DELIVERY_CHANNEL` | No | Future provider; blocked in production | `unavailable` | `local-test`, recorded in process memory |

`unavailable` does not discard a notice. It records that no attempt was made,
leaving the notice owed in PostgreSQL and deliverable the day an email, push, or
SMS provider is approved.

### Media

| Variable | Secret | Classification | Default | If missing |
|---|---|---|---|---|
| `MEDIA_STORAGE_PROVIDER` | No | Future provider; blocked in production | `unavailable` | The default refuses every upload, read, delivery, and purge. `local-test` is filesystem-backed for local development |
| `MEDIA_MALWARE_SCANNER` | No | Future provider; blocked in production | `unavailable` | Inspection treats a refusal as a quarantine, so an environment with no scanning position accepts no media. An unavailable scanner never reports `clean` |
| `MEDIA_LOCAL_STORAGE_DIRECTORY` | No | Required when storage is `local-test` | none | Startup fails when `MEDIA_STORAGE_PROVIDER=local-test`. A filesystem path both the API and the worker can write |
| `MEDIA_DELIVERY_SIGNING_KEY` | Yes, even locally | Required when storage is `local-test` | none | Startup fails when `MEDIA_STORAGE_PROVIDER=local-test`. Any sufficiently random string; it is configured rather than generated per process because two replicas that generated their own would reject each other's delivery grants |

### Billing and payouts

Every seam that could move money. All default to the adapter that refuses, all
accept a `local-test` or `local-test`-equivalent value in local and test only,
and all are rejected in staging and production.

| Variable | Secret | Classification | Default | Local alternative |
|---|---|---|---|---|
| `BILLING_COMMERCE_ELIGIBILITY` | No | Blocked in production | `unavailable` | `local-test` |
| `BILLING_COMMERCE_POLICY` | No | Blocked in production | `unpublished` | `local-test` |
| `BILLING_PAYMENT_PROVIDER` | No | Future provider; blocked in production | `unavailable` | `local-test`, moves no money, reaches no network |
| `BILLING_TAX_AUTHORITY` | No | Blocked in production | `unavailable` | `local-test` |
| `CLUBS_BILLING_ENTITLEMENT` | No | Blocked in production | `unavailable` | `local-test` |
| `PAYOUTS_PROVIDER` | No | Future provider; blocked in production | `unavailable` | `local-test` |
| `PAYOUTS_POLICY` | No | Blocked in production | `unpublished` | `local-test` |

The `local-test` adapters fabricate successful payments, priced offers, and paid
instructions. One of them reachable in a deployed environment would mean fake
paid subscriptions and a creator balance nobody was ever charged for, which is
why each is refused by name rather than by a single shared switch.

## Next.js surface configuration

Owner: `packages/config/src/client.ts`, read by `apps/{web,creator-studio,admin}/src/api.ts`
and each surface's `middleware.ts`. Surfaces: Consumer Web, Creator Studio,
Platform Admin.

| Variable | Secret | Classification | Local | Staging/production | If missing |
|---|---|---|---|---|---|
| `VELORA_APP_ENV` | No | Safe default locally, required when deployed | `local` | The environment name | Falls back to `production` when `NODE_ENV` is `production`, `local` otherwise. Set it explicitly when deployed |
| `VELORA_API_BASE_URL` | No | Safe default locally, required now when deployed | `http://127.0.0.1:4000` | The environment's API origin | Local and test fall back to the loopback API. Staging and production throw at startup, and a loopback value there is refused outright |
| `VELORA_BIND_HOST` | No | Safe default | blank | Container/host interface if not `0.0.0.0` (start) or `127.0.0.1` (dev) | The `start` scripts default `0.0.0.0` and `dev` scripts default `127.0.0.1`. Read by `package.json` only, never by application code |

Both are read at request time and neither carries a `NEXT_PUBLIC_` prefix, on
purpose: a build-inlined value would bake one environment's endpoint into the
artifact every environment is supposed to share. The API origin a browser may
reach is also the origin named in that response's `connect-src`, so these two
facts cannot diverge.

## Consumer Mobile configuration

Owner: `packages/config/src/client.ts`, read by `apps/mobile/src/api.ts`.

| Variable | Secret | Classification | Local | If missing |
|---|---|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | Public, embedded in the bundle | Required for local development | `local` | The build is treated as `production`, which refuses a loopback endpoint |
| `EXPO_PUBLIC_API_BASE_URL` | Public, embedded in the bundle | Required for any non-loopback target | `http://127.0.0.1:4000` | Local and test fall back to the loopback API; a production build fails to resolve an endpoint |

These two are the only variables permitted to carry a client-public prefix.
Anything with that prefix is readable by anyone holding the app, so a secret
with one is a published secret. Expo reads `apps/mobile/.env` rather than the
repository-root file, so `pnpm dev` supplies these values to the mobile dev
server directly and no second environment file is needed.

## Local Docker infrastructure

Owner: `compose.yaml`, which reads them from the repository-root `.env`.

| Variable | Secret | Classification | Default | If missing |
|---|---|---|---|---|
| `VELORA_POSTGRES_PORT` | No | Local only | `5432` | Compose publishes 5432, which fails when a host PostgreSQL already holds it |
| `VELORA_REDIS_PORT` | No | Local only | `6379` | Compose publishes 6379, with the same conflict |

Changing one means changing the matching host port in `DATABASE_URL`,
`EPHEMERAL_REDIS_URL`, or `QUEUE_REDIS_URL`. Both are bound to `127.0.0.1`, so
neither container is reachable from outside the machine.

## Variables nobody sets by hand

`TEST_DATABASE_URL`, `TEST_REDIS_URL`, `TEST_REDIS_HOST`, `TEST_REDIS_PORT`, and
`TEST_REDIS_CONTAINER_ID` are injected per run by the integration harness in
`apps/api/scripts/run-integration-tests.mjs` from the containers it just started.
`STABILITY_ITERATIONS` and `STABILITY_OUTPUT_DIRECTORY` are arguments to
`scripts/rtc-stability-proof.mjs`. `CI` and `NODE_ENV` come from the CI provider
and the runtimes. None of them belongs in an environment file, and `pnpm
env:check` fails if one appears there.

## Local bootstrap

```bash
mise install
pnpm install --frozen-lockfile
pnpm dev:bootstrap
pnpm dev
```

`pnpm dev:bootstrap` copies `.env.example` to `.env` when `.env` does not exist,
starts PostgreSQL and Redis, and applies migrations. It never overwrites an
existing `.env`, never generates a secret, and never resets a database. Run the
steps individually with `pnpm env:bootstrap`, `pnpm infra:up`, and
`pnpm db:migrate`.

`pnpm dev` starts the API on 4000, Consumer Web on 3000, Creator Studio on 3001,
and Platform Admin on 3002, and the Expo dev server. The worker is separate:

```bash
pnpm --filter @velora/api dev:worker
```

The API and worker load the repository-root `.env` explicitly, because Bun reads
environment files from the working directory and theirs is `apps/api`. A real
process environment variable always wins over the file, so the same scripts work
unchanged under CI and the end-to-end harness, which set values directly.

Health checks, once the API is up:

```bash
curl -fsS http://127.0.0.1:4000/v1/health/live
curl -fsS http://127.0.0.1:4000/v1/health/ready
```

Readiness reports PostgreSQL, ephemeral Redis, and queue Redis separately and
answers 503 while any one of them is down.

## A note on commit 3feb6f3

`3feb6f3` is titled for the notification query-plan suite and also contains an
unrelated change: the three Next.js `dev` scripts gained
`--hostname ${VELORA_BIND_HOST:-127.0.0.1}`, and the `VELORA_BIND_HOST` row
above and its owner description in `scripts/check-env-template.mjs` were updated
to match.

That change was made in the working tree while the gate for the query-plan
commit was running, and it was swept in by a `git add -A` that should have named
its paths. It is recorded here rather than rewritten away, because the commit is
published and rewriting published history is not something this repository does.

The change itself stands on its own merits and was not reverted. Binding the
development servers to loopback by default is the safer default — a dev server
on `0.0.0.0` is reachable by anything on the network — and `VELORA_BIND_HOST`
still overrides it for anyone who needs to reach a dev server from a device.
It passed the full gate, because it was present in the tree for that run.

## What the gate checks

| Command | What it proves |
|---|---|
| `pnpm env:check` | The schema, `.env.example`, and this document name the same fields; no unknown variable is read; no secret carries a client-public prefix |
| `pnpm secrets:check` | No environment file at any path is tracked, and no known secret pattern is committed |
| `pnpm test` | Startup validation: defaults, fail-closed refusals by name in staging and production, redaction of every connection string and key |
| `pnpm infra:config` | `compose.yaml` parses with the current variable substitutions |

## Cross-references

- [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md): environments, typed configuration, secret boundary, feature gates.
- [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md): the session and recovery values that are locked rather than configured.
- [Open decisions](../decisions/DECISIONS_REQUIRED.md): every provider and policy decision that unblocks a seam above.
- [Provider adapters](../architecture/06-provider-adapters.md): why each seam is a named adapter rather than a vendor SDK.
- [Security baseline](../security/01-security-baseline.md): secret handling and client exposure rules.
