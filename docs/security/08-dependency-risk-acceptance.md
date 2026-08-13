# Dependency risk acceptance register

## Purpose and authority

This register is the single authority for temporarily accepted supply-chain dependency advisories. It exists so that an unavoidable transitive advisory can be recorded, bounded, and enforced instead of being silently suppressed. It is a supply-chain security control only. It grants no product, business, provider, compliance, or design authority, and it never relaxes any control in [security baseline](01-security-baseline.md) or [abuse and outbound networking](06-abuse-outbound-networking.md).

The register is not an audit exception list in the ordinary sense. It does not lower the audit level, ignore severities, filter packages, or mute output. Every accepted finding remains visible in raw audit evidence on every run.

## Enforcement contract

`pnpm audit:dependencies` runs `scripts/check-dependency-security.mjs`, which:

1. executes the real audit (`pnpm audit --json`) across the complete dependency graph and prints raw advisory evidence;
2. validates that the audit actually completed and returned a structurally well-formed report before interpreting it at all;
3. parses the machine-readable acceptance block in this document as the only acceptance source;
4. validates every acceptance record structurally before it may authorise anything;
5. matches audit findings to acceptances by exact package name, exact GHSA identifier, exact installed version, exact severity, and an authorised dependency chain for **every** reported path;
6. verifies reachability independently against the complete reverse-dependency graph, because the audit truncates its reported paths;
7. prints every accepted finding prominently with owner and expiry;
8. reports one of three results.

```text
DEPENDENCY SECURITY:
PASS
```

```text
DEPENDENCY SECURITY:
PASS WITH EXPLICIT TEMPORARY ACCEPTED RISK
```

```text
DEPENDENCY SECURITY:
FAIL
```

A plain `PASS` is only possible when no accepted finding is present. The gate can never print `PASS` while an accepted high-severity finding is live.

### Audit scope

The gate audits the whole dependency graph, not production dependencies only. Velora's threat model treats the build host as in scope: install scripts, bundlers, code generators, mobile bundling, tests, and release tooling all execute code. Excluding development dependencies would hide exactly the advisories that model cares about.

### Failing to audit is never a pass

An audit that could not be performed is not evidence of zero vulnerabilities. Registry unavailability, network failure, authentication failure, engine failure, an internal package-manager failure, malformed or truncated JSON, empty output, an unexpected schema, a top-level error object, missing metadata, missing vulnerability counts, or counts that disagree with the reported advisories each produce:

```text
AUDIT EXECUTION FAILURE
```

followed by `DEPENDENCY SECURITY: FAIL`. None of these are ever converted into an accepted-risk or clean result. The gate proves this on every run with probes that spawn a real process emitting each malformed payload, so the process and parser boundary itself is exercised rather than mocked.

### Gate failure conditions

The gate fails when any of the following is true:

- the audit itself did not complete and return a well-formed report;
- a `high` or `critical` advisory has no matching acceptance record;
- an accepted advisory now resolves to a version the record does not list;
- an advisory identifier in the register does not match the advisory reported by the audit;
- an accepted advisory's severity has changed in **either** direction from the recorded severity;
- an acceptance has passed its expiry date;
- an acceptance is malformed, or omits owner, decision date, expiry, dependency path, reachable workspaces, reachability, impact, compensating controls, review triggers, or remediation condition;
- an acceptance uses a version range, wildcard package, or wildcard advisory identifier;
- an acceptance's dependency chain is shorter than two exact package segments, contains a wildcard, or does not end at the accepted package;
- **any** reported dependency path does not pass through the accepted chain;
- **any** reported dependency path originates from a workspace the acceptance does not list;
- the independently computed set of workspaces that can reach the package differs from the accepted set;
- the audit reports no version or dependency-path evidence for an accepted advisory, so its reachability cannot be validated;
- an acceptance names a workspace that does not exist;
- an acceptance horizon exceeds the maximum in the next section;
- an acceptance is stale because the audit no longer reports that advisory.

Severity drift fails in both directions on purpose. The owner accepted an exact advisory state, not a severity band, so any movement returns the decision to the owner.

Reachability is the entire basis of these acceptances, so one surviving trusted path never licenses a newly appeared one. If an advisory is reported through ten paths and nine match the accepted chain, the gate fails. Because `pnpm audit` truncates its reported paths at one hundred, observed paths are corroborating rather than complete evidence; the authoritative check walks the complete reverse-dependency graph and requires the set of Velora workspaces that can reach the package to equal the accepted set exactly.

Stale acceptances fail deliberately. A register entry that no longer describes reality is governance drift, and clearing it is a one-line change.

Advisories below the `high` gate threshold that have no acceptance record are printed as `BELOW THRESHOLD` and do not fail the gate. They are still visible in raw evidence.

The gate self-tests its own decision logic on every run. Probes cover audit execution failure, malformed and truncated audit output, missing metadata, inconsistent vulnerability counts, unknown high and critical advisories, wrong versions, wrong advisory identifiers, expired acceptances, stale acceptances, malformed acceptances, wildcard versions, wildcard and single-segment dependency chains, severity drift, an accepted path joined by a new runtime path, an accepted chain reached from an unaccepted workspace, missing findings, missing paths, over-long and boundary acceptance horizons, unknown workspaces, and contradicted or unavailable reachability verification. A missed probe fails the gate.

### Maximum acceptance horizon

An acceptance may run for at most **90 days** from its decision date. A longer window is an indefinite exception wearing an expiry date. Anything beyond 90 days is not a register entry; it requires a separate, explicit security decision recorded as an ADR, and the standard gate will keep failing until either the risk is remediated or that decision exists.

Renewal is not automatic. Extending an acceptance means a new decision date, fresh upstream verification, and a fresh horizon inside the same 90-day maximum.

### Advisories below the gate threshold

These are reported on every run and blocked from silent accumulation by remaining visible in raw evidence. They hold no acceptance record and no owner signature.

| Advisory | Package | Severity | Path | Remediation available |
|---|---|---|---|---|
| GHSA-67mh-4wv8-2f99 | `esbuild@0.18.20` | moderate | `apps__api>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild` | Not directly. `drizzle-kit` pins the archived `@esbuild-kit` loader chain; the fix arrives when `drizzle-kit` moves to `tsx` or a patched loader. |

The esbuild advisory concerns its development server, which Velora never starts: `drizzle-kit` uses the loader for one-shot TypeScript transpilation during migration generation on a build host. It is recorded here for visibility, not accepted, and it does not gate the build.

## Record lifecycle

An acceptance is created only when all of the following hold: no compatible patched upstream release exists on the decision date, verified from primary sources; the exposure is understood and bounded; compensating controls are real; an owner accepts the risk explicitly; and a hard expiry is set. Acceptance is never automatic, never inherited by a new advisory, never renewed silently, and never longer than the 90-day maximum horizon.

Acceptance ends at expiry. Before expiry the owner must either remediate, or record a new decision with fresh upstream evidence. Any listed review trigger forces immediate reassessment regardless of expiry.

## Current acceptances

### VRA-2026-001 and VRA-2026-002: Expo/Metro `image-size`

Metro's asset plugin depends on `image-size@1.2.1`, which has two high-severity malformed-image infinite-loop advisories. Verified on 2026-08-13 against the npm registry: the latest published `image-size` is `2.0.2`, which is itself within the vulnerable range `<=2.0.2`; the patched range `>=2.0.3` has no published release. Metro `0.87.0`, the current latest, still declares `image-size: ^1.0.2`, so no Metro or Expo release can resolve a fixed version. There is no compatible fix to adopt, and forcing a major override across Metro's asset pipeline is not a verified-safe change.

Exposure is build-time only, inside Metro asset parsing. Velora's Mobile build consumes repository-controlled and dependency-controlled assets exclusively; no user-supplied, remote, or otherwise untrusted asset enters the Metro pipeline. The advisories are denial of service, not code execution, and the affected work happens on a developer or CI build host, never in a deployed runtime.

Enforcement of that claim is exact: every reported dependency path must pass through `metro>image-size`, and `@velora/mobile` must be the only workspace from which `image-size` is reachable in the complete reverse-dependency graph. A path appearing under `@velora/api` or any other workspace fails the gate rather than inheriting this acceptance.

### VRA-2026-003: Expo/Xcode `uuid`

Expo's iOS project generation reaches `uuid@7.0.3` through `@expo/config-plugins` and `xcode`. The advisory is a missing buffer bounds check in `v3`/`v5`/`v6` when the caller supplies a buffer. Verified on 2026-08-13: `xcode`'s current latest `3.0.1` and its nightly builds all declare `uuid: ^7.0.3`, and `@expo/config-plugins` `57.0.7` and the `58.x` canary line all declare `xcode: ^3.0.1`. The patched `uuid` `>=11.1.1` is outside every declared range in that path, so forcing it is an unsupported override rather than a fix.

The observed caller uses `uuid.v4()` without a caller-provided buffer, which is not the vulnerable shape. Exposure is limited to iOS project generation on a build host.

Every reported dependency path must pass through `xcode>uuid`, and `@velora/mobile` must be the only workspace from which `uuid` is reachable.

## Machine-readable acceptance records

This block is the enforced source of truth. Editing it changes CI behaviour and requires the same review as any security control change.

```json
{
  "registerVersion": 1,
  "acceptances": [
    {
      "id": "VRA-2026-001",
      "risk": "expo-metro-image-size",
      "package": "image-size",
      "versions": ["1.2.1"],
      "advisory": "GHSA-w3rx-r6r6-pgpr",
      "severity": "high",
      "dependencyPath": "metro>image-size",
      "reachableWorkspaces": ["@velora/mobile"],
      "reachability": "Build-time only. Metro parses repository-controlled and dependency-controlled assets during Mobile bundling. No user-controlled, remote, or otherwise untrusted asset enters the Metro pipeline, and no deployed Velora runtime executes this parser.",
      "impact": "Denial of service through an infinite loop in the ICNS parser on a developer or CI build host. No code execution, no data exposure, no production runtime path.",
      "compensatingControls": [
        "Metro receives only trusted repository and dependency assets; remote or untrusted asset ingestion into the build pipeline requires reassessment before it is introduced.",
        "The advisory remains visible in raw audit evidence on every CI run.",
        "CI validates the exact package, version, advisory identifier, severity, every reported dependency path, and the independently computed set of workspaces that can reach the package; any drift fails the gate.",
        "Acceptance expires automatically and new high or critical advisories still fail the gate."
      ],
      "owner": "Founder",
      "decisionDate": "2026-08-13",
      "expires": "2026-09-30",
      "reviewTriggers": [
        "any Expo update",
        "any React Native update",
        "any Metro update",
        "any image-size update",
        "an upstream patched compatible release becomes available",
        "new exploit or reachability information is published",
        "Velora begins ingesting untrusted build assets",
        "before public beta or release"
      ],
      "remediation": "Adopt the first Expo/Metro release that resolves image-size >= 2.0.3. Do not force an unverified major override across Metro's asset pipeline.",
      "status": "temporarily-accepted"
    },
    {
      "id": "VRA-2026-002",
      "risk": "expo-metro-image-size",
      "package": "image-size",
      "versions": ["1.2.1"],
      "advisory": "GHSA-5p2g-fcmc-qvqq",
      "severity": "high",
      "dependencyPath": "metro>image-size",
      "reachableWorkspaces": ["@velora/mobile"],
      "reachability": "Build-time only. Metro parses repository-controlled and dependency-controlled assets during Mobile bundling. No user-controlled, remote, or otherwise untrusted asset enters the Metro pipeline, and no deployed Velora runtime executes this parser.",
      "impact": "Denial of service through infinite loops in the JXL and HEIF parsers on a developer or CI build host. No code execution, no data exposure, no production runtime path.",
      "compensatingControls": [
        "Metro receives only trusted repository and dependency assets; remote or untrusted asset ingestion into the build pipeline requires reassessment before it is introduced.",
        "The advisory remains visible in raw audit evidence on every CI run.",
        "CI validates the exact package, version, advisory identifier, severity, every reported dependency path, and the independently computed set of workspaces that can reach the package; any drift fails the gate.",
        "Acceptance expires automatically and new high or critical advisories still fail the gate."
      ],
      "owner": "Founder",
      "decisionDate": "2026-08-13",
      "expires": "2026-09-30",
      "reviewTriggers": [
        "any Expo update",
        "any React Native update",
        "any Metro update",
        "any image-size update",
        "an upstream patched compatible release becomes available",
        "new exploit or reachability information is published",
        "Velora begins ingesting untrusted build assets",
        "before public beta or release"
      ],
      "remediation": "Adopt the first Expo/Metro release that resolves image-size >= 2.0.3. Do not force an unverified major override across Metro's asset pipeline.",
      "status": "temporarily-accepted"
    },
    {
      "id": "VRA-2026-003",
      "risk": "expo-xcode-uuid",
      "package": "uuid",
      "versions": ["7.0.3"],
      "advisory": "GHSA-w5hq-g745-h8pq",
      "severity": "moderate",
      "dependencyPath": "xcode>uuid",
      "reachableWorkspaces": ["@velora/mobile"],
      "reachability": "Build-time only, during Expo iOS project generation. The advisory requires a caller-supplied buffer in uuid v3/v5/v6; the observed caller invokes uuid.v4() without a buffer.",
      "impact": "Out-of-bounds buffer access during iOS project file generation on a build host. No deployed Velora runtime path and no user-controlled input.",
      "compensatingControls": [
        "iOS project generation runs only on trusted developer and CI build hosts with repository-controlled input.",
        "The advisory remains visible in raw audit evidence on every CI run.",
        "CI validates the exact package, version, advisory identifier, severity, every reported dependency path, and the independently computed set of workspaces that can reach the package; any drift fails the gate.",
        "Acceptance expires automatically and any severity increase fails the gate."
      ],
      "owner": "Founder",
      "decisionDate": "2026-08-13",
      "expires": "2026-09-30",
      "reviewTriggers": [
        "any Expo update",
        "any @expo/config-plugins update",
        "any xcode package update",
        "any uuid update",
        "an upstream patched compatible release becomes available",
        "new exploit or reachability information is published",
        "before public beta or release"
      ],
      "remediation": "Adopt the first Expo/Xcode release whose declared dependency range admits uuid >= 11.1.1. Do not force an override outside the declared range.",
      "status": "temporarily-accepted"
    }
  ]
}
```

## Cross-references

[security baseline](01-security-baseline.md), [testing and release](../engineering/05-testing-release.md), [open decisions](../decisions/DECISIONS_REQUIRED.md), [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md), and [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md).
