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
- an acceptance's dependency chain is shorter than two exact package segments, contains a wildcard, or does not end at the accepted package — or, where one advisory reaches the package through more than one parent and the record lists its chains, any listed chain fails that rule, the list is empty, or it repeats a chain;
- **any** reported dependency path does not pass through an accepted chain;
- a listed chain appears in no reported path while the audit's path report is complete (fewer than one hundred paths), because the record would then be broader than the risk;
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

The gate self-tests its own decision logic on every run. Probes cover audit execution failure, malformed and truncated audit output, missing metadata, inconsistent vulnerability counts, unknown high and critical advisories, wrong versions, wrong advisory identifiers, expired acceptances, stale acceptances, malformed acceptances, wildcard versions, wildcard and single-segment dependency chains, chain lists that cover every path, name an unreached chain, carry a single-segment chain, are empty or repeat a chain, severity drift, an accepted path joined by a new runtime path, an accepted chain reached from an unaccepted workspace, missing findings, missing paths, over-long and boundary acceptance horizons, unknown workspaces, and contradicted or unavailable reachability verification. A missed probe fails the gate.

### Maximum acceptance horizon

An acceptance may run for at most **90 days** from its decision date. A longer window is an indefinite exception wearing an expiry date. Anything beyond 90 days is not a register entry; it requires a separate, explicit security decision recorded as an ADR, and the standard gate will keep failing until either the risk is remediated or that decision exists.

Renewal is not automatic. Extending an acceptance means a new decision date, fresh upstream verification, and a fresh horizon inside the same 90-day maximum.

### Advisories below the gate threshold

These are reported on every run and blocked from silent accumulation by remaining visible in raw evidence. They hold no acceptance record and no owner signature.

| Advisory | Package | Severity | Path | Remediation available |
|---|---|---|---|---|
| GHSA-67mh-4wv8-2f99 | `esbuild@0.18.20` | moderate | `apps__api>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild` | Not directly. `drizzle-kit` pins the archived `@esbuild-kit` loader chain; the fix arrives when `drizzle-kit` moves to `tsx` or a patched loader. |
| GHSA-vcc3-ghjq-m6fr | `decode-uri-component@0.2.2` | moderate | `apps__mobile>…>expo-router>query-string>decode-uri-component` | Not in range. `expo-router` pins `query-string@7.1.3`, which declares `decode-uri-component: ^0.2.2`; the patched `0.4.3` arrives with an `expo-router` release on `query-string@9`. |
| GHSA-hp3w-g68c-fv3c | `sprintf-js@1.0.3` | moderate | `apps__mobile>…>js-yaml>argparse>sprintf-js` | Not in range. `argparse@1.0.10`, reached through Jest's `js-yaml@3`, declares `sprintf-js: ~1.0.2`; the patched `1.1.4` is outside it. |

The esbuild advisory concerns its development server, which Velora never starts: `drizzle-kit` uses the loader for one-shot TypeScript transpilation during migration generation on a build host. It is recorded here for visibility, not accepted, and it does not gate the build.

## Record lifecycle

An acceptance is created only when all of the following hold: no compatible patched upstream release exists on the decision date, verified from primary sources; the exposure is understood and bounded; compensating controls are real; an owner accepts the risk explicitly; and a hard expiry is set. Acceptance is never automatic, never inherited by a new advisory, never renewed silently, and never longer than the 90-day maximum horizon.

Acceptance ends at expiry. Before expiry the owner must either remediate, or record a new decision with fresh upstream evidence. Any listed review trigger forces immediate reassessment regardless of expiry.

## Current acceptances

VRA-2026-001 and VRA-2026-002 were removed on 2026-08-27, remediated rather than expired. Raising the `react-native` pin to 0.86.3 moved the Metro closure onto a version that no longer depends on `image-size` at all: the package is absent from `pnpm-lock.yaml` and from the installed graph, and `pnpm audit` reports neither GHSA-w3rx-r6r6-pgpr nor GHSA-5p2g-fcmc-qvqq. Both entries were deleted rather than archived, on the same principle the age register uses — the rules above are the durable part, and an acceptance describing a package the repository no longer installs has nothing left to govern.

### VRA-2026-003: Expo/Xcode `uuid`

Expo's iOS project generation reaches `uuid@7.0.3` through `@expo/config-plugins` and `xcode`. The advisory is a missing buffer bounds check in `v3`/`v5`/`v6` when the caller supplies a buffer. Verified on 2026-08-13: `xcode`'s current latest `3.0.1` and its nightly builds all declare `uuid: ^7.0.3`, and `@expo/config-plugins` `57.0.7` and the `58.x` canary line all declare `xcode: ^3.0.1`. The patched `uuid` `>=11.1.1` is outside every declared range in that path, so forcing it is an unsupported override rather than a fix.

The observed caller uses `uuid.v4()` without a caller-provided buffer, which is not the vulnerable shape. Exposure is limited to iOS project generation on a build host.

Reassessed on 2026-08-28, because the Expo SDK 57 patch upgrade of that date fired this record's "any Expo update" and "any @expo/config-plugins update" triggers. Nothing upstream had moved: `xcode` is still `3.0.1` at `latest`, its nightly line still declares `uuid: ^7.0.3`, and `@expo/config-plugins` `57.0.9` — now both the installed version and `latest` — and the `58.x` canary line still declare `xcode: ^3.0.1`. The patched `uuid` is `14.0.2` at `latest` and remains outside every declared range in that path. The upgrade also collapsed the duplicate `@expo/config-plugins` copies the tree carried, so `57.0.9` is now the only one, and the audit still reports the same package, version, advisory, severity, and chain. The reassessment therefore changes nothing about the record: this is not a renewal, and the decision date and expiry are unchanged.

Every reported dependency path must pass through `xcode>uuid`, and `@velora/mobile` must be the only workspace from which `uuid` is reachable.

Renewed on 2026-10-21 after it expired on 2026-09-30 and failed the gate, which is the intended behaviour. This is a new owner decision with fresh upstream evidence, not an extension: `xcode@4.0.0` (published 2026-10-20) no longer depends on `uuid`, but `@expo/config-plugins` `57.0.10` (installed), `58.0.9` (`latest`) and the `58.x` canary line all still declare `xcode: ^3.0.1`, and the `3.x` nightly still declares `uuid: ^7.0.3`. Forcing `xcode@4` would be an override outside a declared range. The horizon is deliberately short because an Expo release adopting `xcode@4` is the expected remediation.

### VRA-2026-004: Jest/Metro `braces`

`micromatch@4.0.8` reaches `braces@3.0.3`, which GHSA-vfj7-8cjw-p6xm reports as exhausting the stack on deeply nested brace patterns. Verified on 2026-10-21: the advisory lists `<= 3.0.3` as vulnerable with no first patched version, and `3.0.3` is the latest release, so no upgrade or in-range pin exists.

The pattern is the attacker's input. `micromatch` is reached through Jest (`@jest/core`, `@jest/transform`, `jest-config`, `jest-haste-map`, `jest-message-util`) and Metro's `metro-file-map`, which match repository-controlled test, transform and watch globs on a build or developer host. No Velora runtime path accepts a glob, and the package is not bundled into the app. `@velora/mobile` is the only workspace that reaches it.

### VRA-2026-005: Expo CLI `node-forge`

`node-forge@1.4.0` is reached through `@expo/cli` directly and through `@expo/code-signing-certificates`. GHSA-86w9-cpqp-85rv reports that RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements. Verified on 2026-10-21: the advisory lists `<= 1.4.0` as vulnerable with no first patched version, and `1.4.0` is the latest release.

Within `@expo/cli`, the package serves `expo-updates` manifest code signing (`utils/codesigning`) and iOS device signing (`run/ios/codeSigning`). Velora installs no `expo-updates`, configures no update code signing, and generates no iOS project, so neither verification path runs. The CLI executes only on build and developer hosts, and `@velora/mobile` is the only workspace that reaches it. This is the first record to list two chains, because the advisory reaches the package through two parents and one chain cannot describe both. Each chain is held to the single-chain rule.

## Machine-readable acceptance records

This block is the enforced source of truth. Editing it changes CI behaviour and requires the same review as any security control change.

```json
{
  "registerVersion": 1,
  "acceptances": [
    {
      "id": "VRA-2026-003",
      "risk": "expo-xcode-uuid",
      "package": "uuid",
      "versions": [
        "7.0.3"
      ],
      "advisory": "GHSA-w5hq-g745-h8pq",
      "severity": "moderate",
      "dependencyPath": "xcode>uuid",
      "reachableWorkspaces": [
        "@velora/mobile"
      ],
      "reachability": "Build-time only, during Expo iOS project generation. The advisory requires a caller-supplied buffer in uuid v3/v5/v6; the observed caller invokes uuid.v4() without a buffer.",
      "impact": "Out-of-bounds buffer access during iOS project file generation on a build host. No deployed Velora runtime path and no user-controlled input.",
      "compensatingControls": [
        "iOS project generation runs only on trusted developer and CI build hosts with repository-controlled input.",
        "The advisory remains visible in raw audit evidence on every CI run.",
        "CI validates the exact package, version, advisory identifier, severity, every reported dependency path, and the independently computed set of workspaces that can reach the package; any drift fails the gate.",
        "Acceptance expires automatically and any severity increase fails the gate."
      ],
      "owner": "Founder",
      "decisionDate": "2026-10-21",
      "expires": "2026-12-15",
      "reviewTriggers": [
        "any Expo update",
        "any @expo/config-plugins update",
        "an @expo/config-plugins release declaring xcode ^4",
        "any xcode package update",
        "any uuid update",
        "an upstream patched compatible release becomes available",
        "new exploit or reachability information is published",
        "before public beta or release"
      ],
      "remediation": "Adopt the first Expo/Xcode release whose declared dependency range admits uuid >= 11.1.1. Do not force an override outside the declared range.",
      "status": "temporarily-accepted"
    },
    {
      "id": "VRA-2026-004",
      "risk": "jest-metro-braces",
      "package": "braces",
      "versions": [
        "3.0.3"
      ],
      "advisory": "GHSA-vfj7-8cjw-p6xm",
      "severity": "high",
      "dependencyPath": "micromatch>braces",
      "reachableWorkspaces": [
        "@velora/mobile"
      ],
      "reachability": "Build and test hosts only. Jest and Metro's file map match repository-controlled glob patterns through micromatch; no Velora runtime path accepts a glob and the package is not bundled into the app.",
      "impact": "Stack exhaustion, ending a test or bundling process on a build or developer host, if a deeply nested brace pattern were supplied. No deployed runtime path and no user-controlled input.",
      "compensatingControls": [
        "Glob patterns come only from repository configuration reviewed in pull requests.",
        "The advisory remains visible in raw audit evidence on every CI run.",
        "CI validates the exact package, version, advisory identifier, severity, every reported dependency path, and the independently computed set of workspaces that can reach the package; any drift fails the gate.",
        "Acceptance expires automatically and any severity increase fails the gate."
      ],
      "owner": "Founder",
      "decisionDate": "2026-10-21",
      "expires": "2026-12-15",
      "reviewTriggers": [
        "any braces release",
        "any micromatch release",
        "any Jest or Metro update",
        "new exploit or reachability information is published",
        "before public beta or release"
      ],
      "remediation": "Adopt the first braces release that fixes GHSA-vfj7-8cjw-p6xm, or a micromatch/Jest/Metro release that no longer reaches braces 3.0.3.",
      "status": "temporarily-accepted"
    },
    {
      "id": "VRA-2026-005",
      "risk": "expo-cli-node-forge",
      "package": "node-forge",
      "versions": [
        "1.4.0"
      ],
      "advisory": "GHSA-86w9-cpqp-85rv",
      "severity": "high",
      "dependencyPath": [
        "@expo/cli>node-forge",
        "@expo/code-signing-certificates>node-forge"
      ],
      "reachableWorkspaces": [
        "@velora/mobile"
      ],
      "reachability": "Build and developer hosts only, inside Expo CLI. Its node-forge uses are expo-updates manifest code signing and iOS device signing; Velora installs no expo-updates, configures no update code signing and generates no iOS project, so neither verification path runs.",
      "impact": "Acceptance of a forged PKCS#1 v1.5 signature by Expo CLI signature verification on a build host. No deployed runtime path, and the affected verification is not configured.",
      "compensatingControls": [
        "expo-updates is not installed and no update code-signing certificate is configured.",
        "No iOS project is generated; the Android build verification asserts no iOS project exists.",
        "The advisory remains visible in raw audit evidence on every CI run.",
        "CI validates the exact package, version, advisory identifier, severity, every reported dependency path, and the independently computed set of workspaces that can reach the package; any drift fails the gate.",
        "Acceptance expires automatically and any severity increase fails the gate."
      ],
      "owner": "Founder",
      "decisionDate": "2026-10-21",
      "expires": "2026-12-15",
      "reviewTriggers": [
        "any node-forge release",
        "any Expo update",
        "any @expo/cli or @expo/code-signing-certificates update",
        "adding expo-updates or update code signing",
        "generating an iOS project",
        "new exploit or reachability information is published",
        "before public beta or release"
      ],
      "remediation": "Adopt the first node-forge release that fixes GHSA-86w9-cpqp-85rv, or an Expo CLI release that no longer reaches node-forge 1.4.0.",
      "status": "temporarily-accepted"
    }
  ]
}
```

## Cross-references

[security baseline](01-security-baseline.md), [testing and release](../engineering/05-testing-release.md), [open decisions](../decisions/DECISIONS_REQUIRED.md), [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md), and [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md).
