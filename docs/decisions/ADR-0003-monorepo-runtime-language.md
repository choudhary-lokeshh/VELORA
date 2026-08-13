# ADR-0003: Monorepo, runtime, language, and dependency strategy

- Decision date: 2026-08-12
- ADR status: Accepted in part; backend-runtime portion superseded by ADR-0016

> Supersession note (2026-08-13): [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md) replaces Node.js as the API/worker/migration runtime and reverses this ADR's Bun rejection. pnpm/Turborepo remain workspace/task authorities, TypeScript 5.9.3 remains locked, and Node.js 24.19.0 remains the client/repository tooling runtime. Historical analysis below is retained intentionally.

## Context

Velora will contain five applications and a small set of shared packages. A solo founder and coding agents need one reproducible workspace, fast affected-task execution, strict dependency visibility, and one primary language across Web, Mobile, backend, contracts, tests, and tooling. Runtime or package-manager experimentation must not fracture product surfaces or domain ownership.

Current official sources were checked on the decision date. Node.js 24 is an LTS line supported through April 2028; pnpm 11 is stable and supports Node.js 24; TypeScript 6.0 is newly released, while the selected backend framework currently tests against TypeScript 5.9.3. See [Node.js releases](https://nodejs.org/en/about/previous-releases), [pnpm compatibility](https://pnpm.io/installation#compatibility), [TypeScript 6.0](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html), and [Nest package constraints](https://github.com/nestjs/nest/blob/master/package.json).

## Requirements

- Preserve `apps/web`, `apps/mobile`, `apps/creator-studio`, `apps/admin`, and `apps/api` as separate applications.
- Preserve `packages/types`, `packages/validation`, `packages/api-client`, `packages/domain`, `packages/config`, and `packages/observability` as explicit packages.
- Use one lockfile, deterministic installation, strict undeclared-dependency behavior, affected builds/tests, and cacheable tasks.
- Keep server-only domain behavior out of clients and keep surface code out of shared domain packages.
- Pin supported versions and make upgrades reviewable and reversible.

## Options evaluated

1. pnpm workspaces with Turborepo; Node.js and TypeScript.
2. npm workspaces with scripts only.
3. Yarn workspaces with Turborepo.
4. Nx-managed workspace.
5. Bun or Deno as primary runtime/package manager.
6. Multiple primary languages for backend and clients.

## Decision

- Use pnpm 11 workspaces with one root lockfile and Turborepo 2 for task orchestration and local/remote-cache-compatible task graphs. Remote cache service is optional and not required for correctness.
- Use Node.js 24 LTS for backend, Web build/runtime, repository scripts, and workers. Pin an exact current 24.x patch in repository and CI configuration at bootstrap; production follows supported security patch releases within the major.
- Use TypeScript 5.9.3 in strict mode as the initial application and shared-contract language. Use ESM and explicit per-target compiler configurations. TypeScript 6 adoption requires compatibility evidence from Next.js, Expo, NestJS, Drizzle, test tooling, and generated clients; it is a normal ADR review, not a silent compiler bump.
- Use Dart, Kotlin, Swift, SQL, shell, or infrastructure languages only where the selected platform requires them. They do not become alternative business-domain implementations.
- Declare every direct dependency in the consuming workspace. Use `workspace:` references for internal packages, a root pnpm catalogue for common external versions, exact package-manager/runtime pins, and one reviewed lockfile.
- Keep shared packages dependency-light. `types`, `validation`, and `api-client` may not import `domain`; clients may not import `domain`; `domain` may not import an app or provider implementation.
- Turborepo coordinates tasks only. It does not define module ownership, deployment coupling, or runtime topology.

## Why

pnpm gives strict, space-efficient workspace dependency behavior and a single reproducible lockfile. Turborepo adds a small task-graph layer without imposing application architecture. Node.js and TypeScript align all product clients except native generated code and permit generated/shared contracts without inventing a cross-language translation layer. Node.js 24 is the current production LTS. TypeScript 5.9.3 is selected over newly released 6.0 because the selected framework's current repository still tests on 5.9.3; strict typing matters more than immediate compiler novelty.

## Rejected alternatives

- npm workspaces alone: workable, but weaker workspace filtering/catalogue ergonomics and no built-in affected task graph.
- Yarn: capable, but adds no material advantage for this repository over pnpm.
- Nx: strong boundary and generator features, but higher configuration and migration surface than needed for the initial team.
- Bun or Deno as primary runtime: reduced compatibility confidence across NestJS, Expo, native tooling, OpenTelemetry, and operational libraries.
- Multiple backend/client languages: increases contract generation, tooling, hiring, and AI-agent review burden without current product need.

## Consequences

One repository change can update API, generated client, Web, Mobile, and tests atomically. Shared TypeScript does not permit clients to import server internals. pnpm/Turbo configuration becomes critical build infrastructure and must remain pinned, reviewed, and validated in CI.

## Risks

- Monorepo convenience can create hidden cross-surface or cross-domain imports.
- Task cache can return unsafe results if inputs, environment variables, generated files, or secrets are misdeclared.
- TypeScript types can create false confidence if runtime schemas are absent.
- Framework version support may lag Node or TypeScript upgrades.

## Mitigations

Enforce import boundaries with lint/dependency-graph tests; declare task inputs/outputs/environment explicitly; never cache secret-bearing or nondeterministic tasks; validate every external input at runtime; compile every workspace in CI; review supported-version evidence before major upgrades.

## Scaling path

Keep one workspace while one team owns the ecosystem. Add remote task caching only when CI time warrants it. Split a package or service into another repository only when independent ownership, release cadence, security isolation, or measured build/runtime pressure outweighs atomic changes; preserve published contracts first.

## Security implications

Use a frozen lockfile in CI, approved registries, install-script allowlists, provenance/checksum controls where available, vulnerability and license scanning, and dependency review. Package-manager caches never contain runtime secrets. Client bundles must not receive server-only environment values or packages.

## Testing implications

CI verifies lockfile immutability, workspace graph rules, duplicate/version policy, strict TypeScript builds, affected tests, clean full builds, and cache-disabled equivalence for release tasks.

Expo SDK 57's dependency-version heuristic currently advertises TypeScript `~6.0.3`, which conflicts with this ADR's locked 5.9.3 baseline. The Mobile manifest excludes only TypeScript from that heuristic. Expo configuration/schema checks, peer-dependency checks, strict Mobile typecheck, `jest-expo`, and both iOS/Android exports remain mandatory; the exclusion is removed when an approved TypeScript upgrade passes the full compatibility review.

## Migration/reversibility

pnpm and Turborepo are repository tooling, not runtime data formats. Migration to another workspace/task runner requires preserving package manifests, scripts, lockfile review, and clean build/test parity. Node/TypeScript major upgrades proceed through pinned branches, compatibility tests, and normal rollback to the previous image/artifact.

## Status

| Decision | Classification |
|---|---|
| pnpm 11 workspaces and one lockfile | LOCK NOW |
| Turborepo 2 task graph | LOCK NOW |
| Node.js 24 LTS | LOCK NOW |
| TypeScript 5.9.3 strict ESM baseline | LOCK NOW |
| TypeScript 6.0 at initial bootstrap | REJECTED |
| Remote Turborepo cache provider | DEFER UNTIL SCALE REQUIRES |
| Bun or Deno primary runtime | REJECTED |
| Polyglot business-domain backend | REJECTED |
