# Deployment and release

## Purpose and authority

How a VELORA environment is built, configured, started, migrated, backed up,
rolled back, and operated — and which of those steps this repository owns
against which belong to an owner who has bought something.

It selects no hosting platform, approves no provider, and invents no schedule.
Where a value is an owner decision it says so and names the decision.
[ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md) locks the
environment model and controlled egress;
[ADR-0049](../decisions/ADR-0049-deployment-enablement-and-production-auth.md)
locks what makes a deployed environment startable at all.

Every command here exists and every claim was produced by running it. Where a
step has not been performed against a real host, this document says that rather
than describing it as though it had.

## The five processes and the two data stores

| Process | Start | Answers on | Health |
|---|---|---|---|
| API | `pnpm --filter @velora/api start` (`bun run dist/main.js`) | `PORT`, default 4000 | `GET /v1/health/live`, `GET /v1/health/ready` |
| Worker | `pnpm --filter @velora/api start:worker` | no port | supervisor liveness only; it serves nothing |
| Consumer Web | `pnpm --filter @velora/web start` | `PORT`, default 3000 | `GET /` |
| Creator Studio | `pnpm --filter @velora/creator-studio start` | `PORT`, default 3001 | `GET /` |
| Platform Admin | `pnpm --filter @velora/admin start` | `PORT`, default 3002 | `GET /` |

PostgreSQL 18.4 and Redis 8.10 are the two stores, and the two Redis duties stay
logically separate in every environment: `EPHEMERAL_REDIS_URL` holds cache,
rate-limit, and signalling state and may be flushed; `QUEUE_REDIS_URL` is
durable BullMQ infrastructure and may not.

The API and the worker are separate processes here because they deploy
separately. `bun run dev` orchestrates them locally rather than merging them,
so the local topology and the deployed one are the same shape.

### What each process needs

The API and worker both open a pool of ten PostgreSQL connections at startup,
before the port binds, and admit at most eight units of work that may touch it
([ADR-0019](../decisions/ADR-0019-database-connection-admission.md)). Size the
database's connection ceiling above ten times the number of API and worker
instances, with headroom for the migration runner's single connection.

Neither runs migrations. Startup never invokes the migrator and there is no
schema push anywhere; migrations are a deployment step, described below.

## Packaging

Every deployable is a deterministic build followed by a deterministic start:

```bash
pnpm install --frozen-lockfile
pnpm build            # turbo, cached
pnpm entrypoints:check
```

The API build emits `apps/api/dist/main.js` and `apps/api/dist/worker.js`. Each
Next.js surface emits a standalone server under
`apps/<surface>/.next/standalone/apps/<surface>/server.js`, and its `start`
script runs exactly that.

Four properties a container image must preserve, and none of them needs a
particular base image:

- **Nothing writes to the source tree at runtime.** The only path any process
  writes is `MEDIA_LOCAL_STORAGE_DIRECTORY`, which exists only for the
  development storage adapter and is refused in staging and production.
- **No process needs root.** None binds a privileged port and none reads a
  system path outside its own tree.
- **Configuration arrives as environment values.** Staging and production do
  not read `.env`; they take values from the runtime secret manager per
  ADR-0014.
- **The image is one build of one commit.** `RELEASE_SHA` is set from that
  commit so every report an environment produces names the build that produced
  it.

`CODE READY, HOST SETUP REQUIRED`: this repository ships no Dockerfile and no
deployment manifest, because both encode a platform nobody has chosen. The
contract above is what any platform has to satisfy, and the commands are the
same ones CI runs.

## Origins, DNS, and why they share one registrable domain

Four public origins, each its own hostname:

| Origin | Serves | Example |
|---|---|---|
| Consumer Web | the public product | `https://app.example` |
| Creator Studio | the creator business surface | `https://studio.example` |
| Platform Admin | the operator console | `https://admin.example` |
| API | every backend route | `https://api.example` |

They must sit under **one registrable domain**, and that is a constraint rather
than a convention. Browser sessions are `__Host-` cookies with `SameSite=Lax`,
so the API only receives one on a request the browser considers same-site — and
same-site is decided by registrable domain, not by hostname or port. Surfaces on
`app.example` and an API on `velora-api.net` would authenticate nobody, and
nothing in the product would say why.

Two consequences follow and both are configuration:

- `AUTH_BROWSER_ORIGINS_*` lists the exact origins each audience may
  authenticate from, and a deployed environment refuses any that is not `https`
  or that names a loopback host.
- `AUTH_WEBAUTHN_RELYING_PARTY_ID` is that registrable domain, and every origin
  in `AUTH_WEBAUTHN_ORIGINS` must be it or a subdomain of it. Configuration
  refuses a combination that could never verify.

The identity provider needs one redirect address registered:
`https://api.example/v1/auth/federated/callback`. One for every surface — the
API receives the callback and returns the browser to whichever surface started
the attempt.

TLS terminates in front of every origin. `TRUSTED_PROXY_HOP_COUNT` states how
many reverse proxies sit in front of the API, exactly; the default of zero
ignores `X-Forwarded-For` entirely, which is the only safe reading for a process
a client can reach directly.

## Deployment order

Every step is a command that exists. Steps 1 and 2 need no environment beyond
configuration; the rest need the target.

1. **Validate configuration.** `pnpm deployment:doctor` against the target
   environment. It is read-only and exits non-zero for anything that would stop
   the environment serving.
2. **Validate the journal.** `pnpm db:journal:check`. It runs in CI on every
   commit and again inside the migration runner, because CI guards a commit and
   this guards a database.
3. **Back up the database.** See below. A migration is the moment a backup is
   worth the most and the moment it is easiest to skip.
4. **Migrate.** `pnpm db:migrate`. It takes a PostgreSQL advisory lock derived
   from a constant key, applies what is outstanding, and then asserts that the
   number of applied migrations equals the number on disk. Two deploys racing
   resolve deterministically: the second waits up to two minutes and then
   refuses rather than applying anything concurrently.
5. **Deploy the API**, and wait for `GET /v1/health/ready` to answer `ready`.
6. **Deploy the worker.**
7. **Deploy Consumer Web, Creator Studio, and Platform Admin.**
8. **Re-run `pnpm deployment:doctor`.** The same command, now against a running
   environment.
9. **Take the first operator grant**, on a first deploy only. The runbook is
   below.
10. **Verify the console.** Sign in, step up, and confirm the operator audit
    recorded the grant.
11. **Smoke the consumer product** with an account created through the product's
    own routes.

Steps 9 to 11 happen once. Every later deploy stops at step 8.

## Migrations, and the failure that has no error message

Drizzle's migrator reads one number — the highest `created_at` already applied —
and applies a migration only when that migration's journal `when` is strictly
greater. A single entry stamped later than the ones after it therefore skips
every later migration on any database that has applied it, silently, with an
exit code of zero. It happened once here, and the repair is `627f181`.

Three defences, all in the deployment path:

- `pnpm db:journal:check` in CI, and the same check inside `pnpm db:migrate`.
- The advisory lock, so two migrators cannot interleave.
- The count assertion afterwards, which is the difference between "the migrator
  exited zero" and "the schema is the one this build expects".

**Repairing a database that already applied a malformed journal** is a manual,
deliberate act and stays that way. `pnpm deployment:doctor` reports it as
`BLOCKING database — reachable, but N of M migrations are applied`. The repair
is to apply the outstanding SQL files in order against that database and insert
the corresponding `drizzle.__drizzle_migrations` rows, then re-run the doctor
until the counts agree. It is not automated, because an automatic repair of a
schema mismatch is an automatic guess about which of two states is correct.

## The first operator, once

A deployment where nobody holds a capability grant has nobody who can issue one.
There is exactly one way out and it works exactly once.

**Before.** The environment must already have:

- an identity provider configured, so somebody can hold a Platform Admin
  session;
- `AUTH_WEBAUTHN_RELYING_PARTY_ID` and `AUTH_WEBAUTHN_ORIGINS`, so that session
  can reach phishing-resistant assurance;
- `ADMIN_OPERATOR_BOOTSTRAP_TOKEN` in the secret manager, generated as at least
  sixteen characters of CSPRNG output.

**Then**, at the Platform Admin origin:

1. Sign in through the identity provider. The session is `platform_admin` at
   single-factor assurance, which can reach nothing privileged.
2. Enrol a first authenticator. A first key needs only the signed-in session.
3. Present it. The session now holds phishing-resistant assurance, for five
   minutes.
4. Within that window, enrol a second authenticator on a different device. A
   second key is refused to a session that has not stepped up recently,
   because otherwise whoever held only the first factor could add a key of
   their own. [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md)
   requires two independently stored authenticators before production
   privileged access. Production enforces it: with one key, every console
   capability and the first-operator grant are refused, and a single key is one
   lost key away from a console nobody can open.
5. Present an authenticator again if the window has passed, then open the
   **First operator** panel, paste the bootstrap secret, and record why this
   person holds it. The reason is written to the operator audit beside the
   grant.

**Afterwards.**

- Confirm the grant on the operators screen and confirm the audit row.
- **Remove `ADMIN_OPERATOR_BOOTSTRAP_TOKEN` from the secret manager.** It is
  already useless — the bootstrap row is never deleted, so a replay fails the
  same way after a restart as it does a second later — but a secret nobody needs
  is a secret nobody is protecting.
- Every later operator is granted through the console's own Operators control by
  somebody who holds `operators.manage`.

There is deliberately no command that writes the first grant directly. A CLI
holding database credentials would bypass the authenticator, which is the
control the other two conditions exist to compose with.

## Secret rotation

Every value below is injected from the secret manager and read once at startup,
so every rotation is "change the value, restart the process". What differs is
whether anything breaks in between.

| Secret | Overlap available | Restart | How to verify |
|---|---|---|---|
| `AUTH_ACCESS_TOKEN_SIGNING_KEY` | Yes. Move the retiring **public** key into `AUTH_ACCESS_TOKEN_VERIFICATION_KEYS` first, deploy, then change the signing key. Tokens signed by the old key keep verifying until it is removed | API and worker | `pnpm deployment:doctor` reports the retired verification key count |
| `AUTH_OIDC_CLIENT_SECRET` | Provider-dependent. Most OpenID providers allow two live secrets; where they do not, sign-in fails for the length of the restart | API | complete one sign-in |
| `AUTH_RECOVERY_SMTP_URL` credentials | Provider-dependent | API | one recovery request, which reports nothing either way by design — check the relay |
| `ADMIN_OPERATOR_BOOTSTRAP_TOKEN` | Not applicable. It is consumed once and then removed | API | the doctor reports the bootstrap consumed |
| `DATABASE_URL`, `EPHEMERAL_REDIS_URL`, `QUEUE_REDIS_URL` | Depends on the managed service. Prefer a credential the provider can rotate with overlap | API and worker | readiness reports all three up |
| `REALTIME_LIVEKIT_API_KEY` / `_SECRET` | Yes, if the project allows two key pairs | API | `pnpm rtc:doctor`, which proves server-API authentication and says so about nothing else |

Two rules that are not per-secret. **No secret is ever committed**, and
`pnpm secrets:check` fails on a tracked environment file at any path. **No
secret is ever rendered**: `redactServerConfig` publishes selections and
presence booleans, and the deployment doctor prints only what it returns.

The development LiveKit credentials are development credentials. A production
project needs its own key pair, and rotating away from the development one is a
precondition of any public launch rather than a later tidy-up.

## Backups, and what is worth backing up

**PostgreSQL is the only authoritative store.** Everything a person owns, every
financial position, every safety record, and every operator action is a row in
it. A backup of PostgreSQL is a backup of VELORA.

- Take a physical or logical backup on a schedule the host supports, and
  encrypt it at rest. `pg_dump --format=custom` is sufficient for a closed beta
  and restores with `pg_restore`.
- A backup is worth exactly what its last successful restore proved. Restore
  into a scratch database and count rows in `auth_accounts`,
  `billing_journal_entries`, `operations_operator_grants`, and
  `support_tickets`; a restore that produced a schema and no rows is a restore
  that failed quietly.
- Retention is an owner decision and is not invented here.

**Ephemeral Redis needs no backup.** Losing it loses cache, rate-limit counters,
and signalling fan-out, all of which rebuild. Every limit that carries a
security consequence is counted in PostgreSQL for exactly this reason.

**Queue Redis holds durable work.** A lost queue loses jobs that were owed but
not started; the PostgreSQL outboxes they drain still hold the facts, so the
work is re-derivable rather than lost, but it does not re-derive itself. Back it
up if the host offers it, and treat its loss as an incident rather than a
restart.

**Media needs no backup today** and that is a statement about configuration
rather than durability: no storage provider is approved, so a deployed
environment stores no media at all.

`RESTORE REHEARSAL PERFORMED: no.` Restoring a backup has not been exercised in
this repository, because there is no deployed database to back up. The commands
above are standard PostgreSQL and the verification counts are named so the first
rehearsal has something to assert rather than a feeling to report.

## Rollback

**Application rollback is redeploying the previous image.** Every deployable is
one build of one commit, and `RELEASE_SHA` says which.

**Database rollback is forward-only.** There are no down migrations and there
will not be: a down migration that drops a column drops the data in it, and a
rollback is exactly when nobody is in a position to decide that. A migration
that would not be safe to leave in place under the previous build is a migration
that must be split — add the column, deploy, use it, remove the old one in a
later release.

The order for a rollback is therefore the deployment order backwards, without
step 4:

1. Redeploy the previous surfaces.
2. Redeploy the previous worker.
3. Redeploy the previous API, and wait for readiness.
4. Leave the schema where it is.

**Feature rollback does not need a deploy.** OPERATIONS owns controls an
operator can flip from the console — live search, invitations, scheduled windows
— and the server obeys them on the path they govern within the published cache
bound. That is the instrument for an incident;
[ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md)
owns it.

## The closed-beta feature profile

Derived from what each seam is configured to do in a deployed environment, not
chosen.

**Enabled**: sign-in and sign-out, account creation, profile, availability,
discovery, introductions, public creator and club pages, support, account
closure, invitations and referral attribution, scheduled live windows, the
operator console.

**Conditional**: notifications are recorded and owed but delivered nowhere until
a channel is approved; media uploads are refused entirely until a storage
provider is, which means profiles and creator pages have no photographs.

**Disabled until a provider decision**: every purchase path, memberships,
gifting, coin acquisition on Web and on Android, creator payouts, live calling
and random live discovery, identity verification, and every AI capability. None
of them renders an active control in a deployed environment, because each is
gated at the server and each surface reads that gate rather than assuming.

## Ready-to-host checklist

Every line is exactly one of `DONE IN CODE`, `OWNER INPUT REQUIRED`,
`HOST SETUP REQUIRED`, `PROVIDER CREDENTIAL REQUIRED`, or
`LEGAL REVIEW REQUIRED`.

| Item | Status |
|---|---|
| A deployed environment can start at all | DONE IN CODE |
| Development AUTH adapters refused in staging and production | DONE IN CODE |
| OpenID relying party, verified rather than decoded | DONE IN CODE |
| Ed25519 signing on injected key material, no fallback | DONE IN CODE |
| SMTP submission that refuses an unencrypted transport | DONE IN CODE |
| WebAuthn enrolment, step-up, and single-use challenges | DONE IN CODE |
| First operator bootstrap: exactly-once, race-safe, replay-safe, audited | DONE IN CODE |
| Migration journal validation, advisory lock, and verification | DONE IN CODE |
| Deployment doctor | DONE IN CODE |
| Deployed-origin strictness: https, non-loopback, every audience | DONE IN CODE |
| Staging is unindexable however it is configured | DONE IN CODE |
| Trusted-proxy-aware abuse control | DONE IN CODE |
| Approved outbound adapters, enforced by the boundary check | DONE IN CODE |
| Android build profiles for local, staging, and production | DONE IN CODE |
| Container image and deployment manifest | HOST SETUP REQUIRED |
| Cloud platform, container registry, and private networking | HOST SETUP REQUIRED |
| A registrable domain and DNS for four origins | OWNER INPUT REQUIRED |
| TLS certificates and termination | HOST SETUP REQUIRED |
| Managed PostgreSQL 18 and Redis 8, with backups | HOST SETUP REQUIRED |
| Secret manager or KMS holding the signing key | OWNER INPUT REQUIRED |
| An OpenID provider account and a confidential client | PROVIDER CREDENTIAL REQUIRED |
| A verified sending domain and an SMTP submission endpoint | PROVIDER CREDENTIAL REQUIRED |
| Which authenticator class operators must hold | OWNER INPUT REQUIRED |
| Who takes the first operator grant | OWNER INPUT REQUIRED |
| Telemetry, error, and paging backend | OWNER INPUT REQUIRED |
| CI/CD pipeline and artifact signing | HOST SETUP REQUIRED |
| Backup schedule, encryption, and a restore rehearsal | OWNER INPUT REQUIRED |
| Object storage, CDN, and a scanning position | PROVIDER CREDENTIAL REQUIRED |
| Email address ownership in a domain | OWNER INPUT REQUIRED |
| Notification delivery channels | PROVIDER CREDENTIAL REQUIRED |
| Payment provider, tax position, commerce policy, launch countries | LEGAL REVIEW REQUIRED |
| Payout provider and payout policy | LEGAL REVIEW REQUIRED |
| RTC provider approval, retention, and operations ownership | LEGAL REVIEW REQUIRED |
| Identity, age, and KYC verification provider | LEGAL REVIEW REQUIRED |
| Takedown, appeal, and consent policy content | LEGAL REVIEW REQUIRED |
| Retention schedules for every record class | LEGAL REVIEW REQUIRED |
| Google Play Console project, upload key, and store declarations | OWNER INPUT REQUIRED |
| Production LiveKit credentials, rotated away from the development pair | PROVIDER CREDENTIAL REQUIRED |

## Cross-references

[configuration and environments](07-configuration-environments.md),
[data and migrations](02-data-migrations.md),
[observability](04-observability.md),
[operator runbooks](09-operator-runbooks.md),
[closed-beta launch](../operations/08-closed-beta-launch.md),
[incident response](../operations/04-incident-response.md),
[platform health](../operations/05-platform-health.md),
[security baseline](../security/01-security-baseline.md),
[outbound networking](../security/06-abuse-outbound-networking.md).
