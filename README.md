# VELORA

Documentation-driven foundation for a globally scalable, adult social platform. The repository now contains the production workspace bootstrap, neutral application shells, shared contract/configuration/observability foundations, and local PostgreSQL/Redis development infrastructure. It intentionally contains no V1 product feature implementation or live provider integration.

Velora is one ecosystem with four separate product surfaces sharing backend/domain contracts:

- Consumer Web and Mobile: one consumer account ecosystem with platform-specific interfaces.
- Creator Studio: creator business, club, content, analytics, and earnings experience.
- Platform Admin: privileged, audited operations console.
- API/backend: future shared domain and provider-adapter layer.

AI is documented as an isolated platform capability, never a business source of truth. The approved VELORA Master Visual Language is the current visual authority; the Figma Starter limitation prevents a production multi-mode token library but does not block code-level semantic token contracts. Country, creator-content, payment/payout, and data-residency capabilities remain gated until documented decisions and legal/compliance review are complete.

Start with [documentation index](docs/DOCS_INDEX.md), which routes product surfaces, domains, flows, AI, Design/Figma, compliance, operations, security, and engineering. Future implementers must also follow [AGENTS.md](AGENTS.md).

## Repository shape

```text
apps/
  web/                 Consumer web
  mobile/              Consumer mobile
  creator-studio/      Creator business client
  admin/               Privileged platform operations client
  api/                 Shared backend/API
packages/
  types/ validation/ api-client/ domain/ config/ observability/ design-tokens/
docs/
```

See [repository shape](docs/architecture/02-repository-shape.md) for dependency rules.

Technical choices are locked in the [technical stack matrix](docs/architecture/09-technical-stack.md) and ADR-0003 through ADR-0018. ADR-0016 supersedes the backend-runtime portions of earlier ADRs; ADR-0017 locks the session, recovery, and privileged-access values ADR-0009 left open; ADR-0018 locks toolchain provisioning and the verification pipeline. Product phase, provider, security, compliance, and design gates remain authoritative.

## Local bootstrap

Requirements: Bun 1.3.14, Node.js 24.19.0, pnpm 11.21.0, and Docker Compose. pnpm/Turbo own workspace installation and orchestration; Bun runs the API, worker, migrations, and backend tests; Node remains required for Next.js, Expo, Playwright, contract generation, and Testcontainers orchestration.

Runtime versions are provisioned by [mise](https://mise.jdx.dev) from `mise.toml`, which is the single provisioning authority per [ADR-0018](docs/decisions/ADR-0018-toolchain-provisioning-verification-ci.md). `package.json#engines` enforces them with `engineStrict`, and `pnpm toolchain:check` fails if `mise.toml`, `engines`, `.node-version`, and `.bun-version` ever disagree. Installing the exact versions another way is fine; the pins are what matter.

```bash
mise install
pnpm install --frozen-lockfile
pnpm ci:verify
pnpm infra:up
pnpm infra:down
```

CI is `.github/workflows/verify.yml`. It provisions the same pinned toolchain and runs `pnpm ci:verify` on every push, pull request, and once daily, so the dependency risk acceptance expiries fire without waiting for a commit. It has read-only permissions and deploys nothing.

`pnpm ci:verify` ends with the dependency security gate. It audits the complete dependency graph, prints raw advisory evidence, and reports `PASS`, `PASS WITH EXPLICIT TEMPORARY ACCEPTED RISK`, or `FAIL`. An audit that cannot run is a failure, never a pass. Accepted findings are the exact, expiring, owner-signed records in [dependency risk acceptance](docs/security/08-dependency-risk-acceptance.md); anything else at high or critical severity fails.

Copy `.env.example` only for local development. It contains safe local placeholders, never production credentials. If host services already use 5432 or 6379, set `VELORA_POSTGRES_PORT` or `VELORA_REDIS_PORT` before Compose and use the same ports in the local service URLs. Local Redis persists AOF/RDB data in a named volume so BullMQ restart durability can be tested; it is not a production topology or backup policy. `EPHEMERAL_REDIS_URL` and `QUEUE_REDIS_URL` must remain logically separate even when local development uses different logical databases on one instance.
