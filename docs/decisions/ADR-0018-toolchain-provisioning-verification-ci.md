# ADR-0018: Toolchain provisioning and verification CI

- Decision date: 2026-08-13
- ADR status: Accepted
- Owners: Founder (decision owner), platform operations, security

## Context

The repository pins exact runtimes — Bun 1.3.14, Node 24.19.0, pnpm 11.21.0 — and enforces them strictly: `engineStrict` is true, so every `pnpm` script aborts when the running Node differs from the pin. The pins were correct, but nothing in a fresh checkout provisioned them. `.node-version` and `.bun-version` existed as text that no installed tool consumed, so a developer on any other Node could not run `pnpm ci:verify` at all, and the failure surfaced as an engine error rather than as missing provisioning.

Separately, `docs/security/08-dependency-risk-acceptance.md`, [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md), [AGENTS.md](../../AGENTS.md), and [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md) each asserted that controls are enforced by CI, while no CI pipeline existed anywhere in the repository. The dependency risk acceptances carry a hard expiry that only fires when something executes the gate; with no pipeline, expiry was an aspiration.

[ADR-0014](ADR-0014-deployment-environments-cicd.md) deferred the CI vendor along with cloud, container, registry, CDN, and DNS vendors. That deferral is correct for deployment. It is not correct for verification: verification must run before any deployment vendor is chosen, and choosing where to run `pnpm ci:verify` does not commit Velora to a deployment platform.

## Requirements

- A plain checkout must have one obvious, documented path to the exact pinned runtimes.
- One version manager, not several competing ones.
- `engineStrict` stays true and the pins stay exact.
- Local developers and CI must resolve identical versions from the same declaration.
- CI must run the canonical `pnpm ci:verify` graph rather than restating it in pipeline configuration.
- CI must support Docker so the real PostgreSQL and Redis integration tests run.
- The dependency risk acceptance expiry must execute even when no commit lands.
- No deployment, release, publish, or push from this pipeline, and no secrets it does not need.

## Options evaluated

1. Document the required versions and leave provisioning to each developer.
2. Volta, pinning Node and pnpm through `package.json`.
3. mise, pinning Node, pnpm, and Bun in one file.
4. Corepack for pnpm plus a separate Node manager plus a separate Bun installer.
5. A repository script that downloads runtimes into the working tree on demand.
6. Defer CI until the deployment vendor decision in ADR-0014 resolves.

## Decision

Option 3 for provisioning and GitHub Actions for verification CI.

`mise.toml` is the single provisioning authority and declares all three runtimes. Bootstrap is `mise install` followed by `pnpm install --frozen-lockfile`. `package.json#engines` remains the enforcement authority, and `.node-version` and `.bun-version` remain for editors and other tooling that read them. `pnpm toolchain:check` now fails when any of those four sources disagrees, so the pins cannot drift apart.

Verification CI is `.github/workflows/verify.yml`, on the platform that already hosts the repository. It checks out, provisions from `mise.toml`, verifies the toolchain, installs frozen, installs browsers, and runs `pnpm ci:verify`. Its 90-minute whole-job budget accommodates a slow first browser download plus the unchanged real-container verification graph; it does not omit, shorten, or make any gate optional. It holds `contents: read` only, defines no secrets, cancels superseded runs for a ref, and deploys nothing. It also runs on a daily schedule so that the hard expiry on every dependency risk acceptance fires on time rather than waiting for a commit.

This locks the verification CI vendor. It does not resolve ADR-0014's deferred cloud, container, registry, CDN, or DNS decisions, and it grants no deployment authority.

## Why

Provisioning failure and enforcement failure were the same defect wearing two faces: a control that is declared but never executed. Pinning a runtime that nothing installs produces a repository that cannot verify itself, and asserting CI enforcement without a pipeline produces security documentation whose compensating controls are fiction.

mise covers Node, pnpm, and Bun from one file, which is exactly the set Velora pins; Volta does not manage Bun, so it would have required a second mechanism and reintroduced the drift the pins exist to prevent. Declaring versions without a manager leaves every developer to reconstruct them by hand, which is how a pinned toolchain becomes advisory. Downloading runtimes from package scripts hides a network fetch and a trust decision inside an ordinary install.

CI invokes `pnpm ci:verify` rather than restating its stages because a pipeline that lists the stages independently drifts from the repository, and then the pipeline rather than the repository becomes the real definition of "verified".

## Rejected alternatives

- Documented versions with manual provisioning: reproduces the defect this ADR closes and pushes toolchain drift into review.
- Volta: no Bun support, so Bun's pin would be unmanaged or need a second manager.
- Corepack plus separate Node and Bun mechanisms: three tools, three failure modes, and no single declaration to check against `engines`.
- A downloader script inside package scripts: performs an unannounced network fetch during ordinary installs and makes the trust boundary invisible.
- Deferring CI with the deployment vendor: leaves expiring security acceptances unenforced and keeps four documents making a claim the repository cannot support.
- Restating the verification graph in pipeline YAML: creates a second definition of "verified" that silently diverges.

## Consequences

Contributors install mise once. `pnpm ci:verify` becomes runnable from a plain checkout, which is the precondition for treating any gate result as evidence. The claims about CI enforcement in the dependency risk register, DECISIONS_REQUIRED, AGENTS.md, and ADR-0017 become true statements. Runner minutes are now consumed on every push, pull request, and once daily. Changing a pinned runtime becomes a four-file edit that `toolchain:check` verifies rather than a silent one-file edit.

## Risks

- A single version manager is a single dependency; if mise is unavailable, bootstrap needs a documented manual fallback to the exact pinned versions.
- GitHub Actions availability now gates merge confidence.
- Action references by major tag can move under the repository.
- The daily scheduled run consumes minutes without a code change and can be disabled by repository inactivity policies.
- Testcontainers requires Docker on the runner, which couples verification to runner image contents.

## Mitigations

Keep `engines` authoritative so an unmanaged but correct toolchain still passes, and keep `.node-version`/`.bun-version` readable by other tooling. Keep the workflow minimal so it can be reproduced on another platform if the vendor changes; the canonical graph lives in `package.json`, not in YAML. Review action major-tag updates as dependency changes. Treat a missing scheduled run as an incident for acceptance expiry, since the register's compensating controls depend on it. Pin the runner image explicitly rather than tracking `ubuntu-latest`.

## Scaling path

Additional jobs may parallelise the graph later, but the canonical entry point stays `pnpm ci:verify`. Deployment, release, and publish pipelines remain out of scope until ADR-0014's deferred vendor decisions resolve, and they must be separate workflows with their own permissions and review.

## Security implications

The workflow holds `contents: read`, defines no secrets, and performs no write, publish, or deployment action. It runs the dependency security gate, the outbound-network boundary check, the AUTH policy assertions, the secret scan, and the whole test graph on every push, pull request, and daily schedule. Because the gate fails closed on an audit execution failure, a registry or network problem inside CI produces a failure rather than a false pass. Action versions are third-party code and are reviewed as dependencies.

## Testing implications

`pnpm toolchain:check` asserts that `mise.toml`, `package.json#engines`, `.node-version`, and `.bun-version` all agree, and that `packageManager` matches `engines.pnpm`. Changing one alone fails. The workflow's own correctness is demonstrated by the canonical graph it invokes; a claim that hosted CI passed is only made after a hosted run actually occurs.

## Migration/reversibility

Removing mise leaves `engines`, `.node-version`, and `.bun-version` intact, so reverting means restoring manual provisioning, not rewriting the pins. Replacing the CI vendor means rewriting one workflow file, because no verification logic lives in it.

## Status

| Decision | Classification |
|---|---|
| mise as the single toolchain provisioning authority | LOCK NOW |
| Exact Bun 1.3.14, Node 24.19.0, pnpm 11.21.0 pins with `engineStrict` | LOCK NOW |
| Four-source pin agreement enforced by `toolchain:check` | LOCK NOW |
| GitHub Actions as the verification CI platform | LOCK NOW |
| CI invokes canonical `pnpm ci:verify` and never restates it | LOCK NOW |
| Scheduled run so acceptance expiry fires without a commit | LOCK NOW |
| Deployment, release, and publish pipelines | DEFER UNTIL PROVIDER INTEGRATION |
| Cloud, container, registry, CDN, and DNS vendors | DEFER UNTIL PROVIDER INTEGRATION |
| Manual provisioning without a version manager | REJECTED |
| Multiple competing version managers | REJECTED |
| Runtime downloads from ordinary package scripts | REJECTED |
| Verification stages restated in pipeline configuration | REJECTED |

## Cross-references

[ADR-0003](ADR-0003-monorepo-runtime-language.md), [ADR-0014](ADR-0014-deployment-environments-cicd.md), [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md), [technical stack](../architecture/09-technical-stack.md), [testing and release](../engineering/05-testing-release.md), [dependency risk acceptance](../security/08-dependency-risk-acceptance.md), and [open decisions](DECISIONS_REQUIRED.md).
