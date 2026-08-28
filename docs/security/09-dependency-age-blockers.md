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

## What changed on 2026-08-20, and why this register gets quieter

This register recorded two overrides in three days, and warned that a third occurrence should prompt a decision about the cadence rather than another exception. The third occurrence arrived on 2026-08-20: Expo published five SDK-57 patches between 10:47Z and 10:55Z, and `pnpm ci:verify` went red on a commit nobody had made.

The decision was taken rather than the exception, and it is recorded as an [amendment to ADR-0018](../decisions/ADR-0018-toolchain-provisioning-verification-ci.md#amendment-2026-08-20-bounding-the-mobile-dependency-currency-check). `pnpm mobile:doctor` now runs through `scripts/check-mobile-doctor.mjs`, which defers `expo-doctor`'s dependency-currency check **only** while every version it demands is younger than the policy window — that is, only while this repository is forbidden to install the thing the check is asking for — and blocks in every other case, including when a version carries an authorized exclusion.

Nothing in this register's authority changed. `minimumReleaseAge` is still 1440, exclusions are still exact-version and still need a named human's written authorization, and the dependency security gate is untouched. What changed is the trigger: an entry belongs here when a genuine upgrade is due and the age policy blocks it, not every time an upstream patch ships. An Expo patch alone no longer produces a red gate to be waited out or overridden.

## Current blockers

None, and `minimumReleaseAgeExclude` is gone from `pnpm-workspace.yaml` entirely. `minimumReleaseAge` is still 1440; what is absent is the exemption list, not the policy.

DAB-2026-002's ten exact-version exclusions were removed on 2026-08-21, under both conditions its entry stated. The first was satisfied on 2026-08-18T10:54:46Z. The second was proven by the resolution this change performed rather than asserted: the five Expo SDK 57 patch pins the mobile check required were raised with the exclusion list already deleted, and `pnpm install` completed against the unchanged 1440-minute policy without a single age violation. Nothing needed an exemption any more, which is exactly what an exact-version exclusion expiring on its own is supposed to look like.

The lockfile delta was confined to the Expo SDK 57 train and its own closure. `expo-router@57.0.15` dropped its dependency on `@testing-library/jest-dom`, so that package and the packages only it pulled in — `@testing-library/dom`, `@adobe/css-tools`, `css.escape`, `aria-query@5.3.0`, `dom-accessibility-api@0.5.16` — left the tree with it; `@expo/cli` moved 57.0.16 to 57.0.17 and brought `agent-cli-detector@0.1.6`. No package outside that closure entered or left, `pnpm install --frozen-lockfile` verifies the result, and `pnpm mobile:doctor` reports 20/20 on its own terms.

The sixteen exclusions DAB-2026-001 authorized were removed on 2026-08-17, and that entry was deleted rather than archived — the register's rules are the durable part, and a cleared entry whose exclusions are gone has nothing left to govern. DAB-2026-002 is deleted on the same principle.

## What happened on 2026-08-28

The Expo SDK 57 patch train `pnpm mobile:doctor` had been reporting since 2026-08-26 was taken: twelve pins raised to the versions the check named, plus `expo-template-bare-minimum` to 57.0.19. Every one of those versions was published on 2026-08-26 and had aged past the 1440-minute window before the upgrade was attempted, so this is not a blocker and gets no entry above. `pnpm install` resolved the whole train against the unchanged policy with the exclusion list already empty, and no version was refused.

Two standing dependency-policy entries were retired in the same change, both because they had stopped authorizing anything.

The first is not this register's business but is recorded here because it was load-bearing for the Expo graph: the `overrides: react-native: 0.86.3` entry added on 2026-08-27. It existed only because `expo-template-bare-minimum@57.0.17` pinned react-native `0.86.2` exactly and so held a second copy of the runtime, and every Expo package resolving against it, in the tree. Template `57.0.19` pins `0.86.3` — the version the catalog already carries — so the duplication has no source any more. The override was deleted rather than kept as insurance, and the result was proven rather than assumed: after a clean reinstall the virtual store holds exactly one `react-native@` and one `expo@` directory, the lockfile contains no reference to `0.86.2`, the duplicate `@expo/config-plugins`, `@expo/config`, and `@expo/require-utils` copies collapsed to one each, and `pnpm mobile:doctor` reports 20/20.

The second is this register's business: the `globals@17.11.0` exclusion, the last entry in `minimumReleaseAgeExclude`, carried over from the foundation commit. `globals@17.11.0` was published 2026-08-12T11:07:59Z, so by 2026-08-13 it satisfied the policy on its own and the exclusion had been exempting a version that needed no exemption for a fortnight. That is precisely the self-expiry the rules above describe, and a dead exemption left in place is a standing hole nobody is watching.

It was removed and the removal proven by resolution rather than by arithmetic, with a control. Under pnpm 11.21.0 and `minimumReleaseAge: 1440` with no exclusion list at all, a package published inside the window is still refused by name — `typescript@7.1.0-dev.20260827.1` and its seven platform packages were rejected with `within the minimumReleaseAge cutoff` — while `globals@17.11.0` resolves without comment. The policy is intact and enforcing; the exclusion was simply no longer part of why the install worked.

`minimumReleaseAgeExclude` is therefore absent rather than empty. Nothing about the rules above changes: the next genuine blocker adds the key back with exactly the exact-version entries a named owner authorizes, and nothing else.
