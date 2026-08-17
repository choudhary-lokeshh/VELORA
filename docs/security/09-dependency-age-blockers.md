# Dependency age blockers

## Purpose and authority

This register records upgrades that are **required by a gate step but forbidden by the repository's minimum release age**, together with the exact moment each becomes installable, and — where the wait was not allowed to elapse — the owner-authorized override that cleared it.

It is not a risk acceptance. [Dependency risk acceptance](08-dependency-risk-acceptance.md) is the authority for temporarily accepted *advisories*, and nothing here touches it. An entry in this file concerns release **age** only: how long a version has existed, not what is known about it. An age override says a named person accepted the reduced observation window for exact versions they named; it says nothing about advisories, and it never suppresses the dependency security gate.

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so a package published less than twenty-four hours ago cannot be installed. That control exists because a package's first day is when a compromised or mistakenly published release is most likely to be live and least likely to have been noticed. A gate step that wants a same-day release is therefore in genuine conflict with it.

## Rules

- An entry is added when a gate step fails **only** because a required version is younger than the cutoff.
- The entry records every affected package, the version the gate requires, that version's publication instant from the registry, and the earliest instant at which installation is permitted.
- The earliest safe instant is the **latest** publication among all packages the install would newly resolve, plus twenty-four hours. A single package inside the window blocks the whole install, so the newest one sets the date.
- **Waiting is the default resolution.** Until the cutoff, `pnpm ci:verify` is expected to fail and the affected work is not ready to freeze. That is the correct state.

### When an override is permitted

An entry may instead be cleared early, before the cutoff, only when **all** of the following hold. Anything less is a wait, not an override.

- A named human owner authorized the specific clearance, in writing, with the packages in front of them.
- `minimumReleaseAge` remains `1440` repository-wide. The policy is not lowered, disabled, or scoped away.
- Every exclusion in `minimumReleaseAgeExclude` is an **exact `name@version`**. No wildcards, no bare package names, no scope patterns such as `@expo/*`. A bare name would exempt every future release of that package forever, which is a standing hole rather than a decision; an exact version expires on its own as the version ages.
- The excluded set is the **minimum proven necessary** by an actual resolution attempt: a package is listed only because pnpm refused that exact version by name, and every listed version is present in the resulting lockfile.
- The dependency security gate, the lockfile review, and the surface's own verification all still run and still pass. An age override buys nothing else.
- The entry below records the authorization, the packages, the publication times, the override instant, and the condition under which the exclusions are removed.

An override is recorded honestly. An entry cleared this way is never described as having aged out naturally.

- An entry is removed once the upgrade is installed and the gate is green again. Where an override was used, the exclusions are removed separately, under the removal condition stated in the entry.

## Current blockers

None. `minimumReleaseAgeExclude` currently carries the exact-version exclusions from DAB-2026-002, which are pending removal under the condition recorded below. The sixteen exclusions DAB-2026-001 authorized were removed on 2026-08-17 once both of its stated conditions held, and that entry is deleted rather than archived — the register's rules are the durable part, and a cleared entry whose exclusions are gone has nothing left to govern. The `globals@17.11.0` exclusion is unrelated to either and stays.

## Cleared

### DAB-2026-002: Expo SDK 57 patch line, second occurrence

**Status: cleared 2026-08-17T18:21:08Z (2026-08-17 23:51:08 IST) by explicit human-approved exact-version release-age override.** The twenty-four-hour age policy was **not** allowed to elapse before installation. This entry is retained, rather than deleted, because the exclusions it authorizes are still in `pnpm-workspace.yaml` and their removal condition has not yet been met.

This is the second occurrence of the same conflict in three days, on the same Expo SDK 57 patch line, and the second override taken rather than waited out. That is worth naming: a pattern of overrides is a standing reduction in observation window even though each one is version-scoped and expires on its own. If this recurs a third time, the repository should decide whether the mobile surface's Expo pins belong on the same gate cadence as everything else, rather than reaching for another exception.

#### The conflict

`expo-doctor` failed its "packages match versions required by installed Expo SDK" check for four pinned catalog versions. The conflict was not caused by any change in this repository: `pnpm ci:verify` passed in full at **2026-08-17T06:06:16Z**, the first of these releases appeared at **10:48:33Z**, and the next full run reached the same check at **14:31Z** and failed it. `expo-doctor` reads the SDK's remote version map on every run, so a release changes the answer with no local change at all.

| Package | Was | Now | Published (UTC) |
| --- | --- | --- | --- |
| `expo` | 57.0.13 | 57.0.14 | 2026-08-17T10:48:33.098Z |
| `expo-router` | 57.0.13 | 57.0.14 | 2026-08-17T10:54:45.995Z |
| `expo-constants` | 57.0.11 | 57.0.12 | 2026-08-17T10:48:33.411Z |
| `@expo/metro-runtime` | 57.0.10 | 57.0.11 | 2026-08-17T10:49:20.285Z |

Raising those four pins made the install newly resolve six more packages from the same release train, each subject to the same cutoff. pnpm refused all ten by name.

| Transitive package | Version | Published (UTC) |
| --- | --- | --- |
| `@expo/cli` | 57.0.16 | 2026-08-17T10:49:24.111Z |
| `@expo/config` | 57.0.8 | 2026-08-17T10:48:46.461Z |
| `@expo/fingerprint` | 0.20.8 | 2026-08-17T10:50:27.671Z |
| `@expo/inline-modules` | 0.1.6 | 2026-08-17T10:48:42.184Z |
| `@expo/log-box` | 57.0.3 | 2026-08-17T10:48:39.158Z |
| `expo-asset` | 57.0.12 | 2026-08-17T10:50:30.441Z |

The set did not grow beyond those ten. A forced re-resolution at 2026-08-17T18:20Z — `pnpm install --lockfile-only --force`, which re-runs both resolution and the lockfile supply-chain verification rather than short-circuiting on an up-to-date tree — completed with no violation and produced a byte-identical lockfile. Ten is the whole set.

**Latest publication among them:** `expo-router@57.0.14`, 2026-08-17T10:54:45.995Z.

**Normal eligibility, had the wait been taken:** **2026-08-18T10:54:46Z — 2026-08-18 16:24:46 IST.**

#### The override

The repository owner, with the package list above in front of them, declined to wait for that instant and authorized immediate clearance of these exact versions.

What was authorized:

- Exact-version entries in `minimumReleaseAgeExclude` for the ten versions named above, and only those.

What was **not** authorized, and what did not change:

- `minimumReleaseAge` remains **1440** repository-wide.
- No wildcard, scope pattern, or bare package name was added. A future `expo@57.0.15` is refused by exactly the same control that refused `expo@57.0.14`.
- No advisory, vulnerability, or audit finding was accepted, suppressed, or excluded. The dependency security gate is unchanged and still runs. This is a **release-age governance exception, not a vulnerability risk acceptance**; [dependency risk acceptance](08-dependency-risk-acceptance.md) remains the sole authority for advisories and gained no new record from this clearance.
- No `expo-doctor` finding was ignored or added to `expo.install.exclude`. `pnpm mobile:doctor` reports 20/20 checks passed on its own terms.
- No unrelated package was upgraded. The lockfile delta is ten package additions and ten removals, every one of them the Expo SDK 57 patch train. No package outside that train entered or left the tree.

**Scope evidence.** The exclusions are version-scoped, not name-scoped. Replacing `expo@57.0.14` with a non-matching `expo@57.0.99` in the exclusion list and re-resolving produced `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION: expo@57.0.14 was published at 2026-08-17T10:48:33.098Z, within the minimumReleaseAge cutoff` — the exclusion stopped applying the moment the version stopped matching.

**Minimality evidence.** Ten versions were refused by pnpm; ten exclusions were added; all ten appear in the resulting lockfile, and all ten are among the ten `name@version` entries the delta adds. No package was excluded that the install did not name and then resolve.

#### Removal condition

Remove the ten Expo exclusions from `minimumReleaseAgeExclude` in a later maintenance change once **both** hold:

1. Every excluded version is older than the 1440-minute policy — that is, after **2026-08-18T10:54:46Z**, which is the latest publication among them plus twenty-four hours.
2. A normal `pnpm install --frozen-lockfile` succeeds with those entries deleted and the lockfile unchanged.

Then delete this entry, leaving the register's rules in place.
