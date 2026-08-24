# ADR-0031: Android native build pipeline

- Decision date: 2026-08-24
- ADR status: Accepted

## Context

Consumer Mobile shipped a complete product interface with no native build behind it. `pnpm --filter @velora/mobile build` ran `expo export`, which produces Metro JavaScript bundles and compiles no native code; there was no `android/`, no `ios/`, no `eas.json`, and `expo-dev-client` was not a dependency.

That single gap was the second, independent blocker on four separate capabilities, and every one of them is recorded that way in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md): push registration, call media, a camera, and any future native module. The [notifications freeze report](../architecture/17-notifications-freeze-report.md) says of push that "no vendor answer removes it". The [RTC freeze report](../architecture/16-rtc-freeze-report.md) says the same of media. The reasoning was identical in each case and it was correct: adding a package that requires custom native code would put code into the tree that **no gate in this repository compiles, links, signs, or runs**, so `pnpm ci:verify` would stay green while the application was unbuildable, and a check that cannot fail is not a check.

Two further facts framed the decision.

**Google Play is not Apple.** [Surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md) records both stores prohibiting the mature-content class outright, and records `MOBILE_IOS` and `MOBILE_ANDROID` as structurally ineligible surfaces *for that content*. Neither finding says a Consumer Mobile application may not exist; whether one may be published once mature content is enabled on Consumer Web remains an open legal decision. Building one is not publishing one.

**The toolchain is not vendorable.** A JDK, an Android SDK platform, build tools, and the NDK are gigabytes of licensed, machine-scoped software. `mise` provisions Node, Bun, and pnpm under [ADR-0018](ADR-0018-toolchain-provisioning-verification-ci.md); it cannot reasonably provision these, and a gate that required them would be a gate most contributors could not run.

## Decision

### The Android project is generated on demand and never committed

`apps/mobile/android` is produced by `expo prebuild --platform android --clean` and is git-ignored. `apps/mobile/app.config.ts` and the config plugins beside it are the only description of the native build, so there is exactly one place a native fact can live and no possibility of a hand edit surviving.

The alternative — committing the generated project — was rejected on the property that matters here. A committed `android/` is reviewable, and it also drifts: it stops matching what the config would generate the moment somebody edits either one, and nothing detects that. Regenerating from nothing on every gate run makes drift impossible to express.

**iOS is out of scope rather than unfinished.** `platforms: ['android']`, prebuild is always run with `--platform android`, and the gate fails if an `ios/` directory ever appears.

### The generated project is asserted, because nobody reviews a file that is not in the tree

Generation buys reproducibility and costs the diff. A config plugin that silently stopped applying, a dependency that contributed a permission, or a template change that reintroduced the shared debug keystore would all land unnoticed.

`pnpm android:verify` closes that. It regenerates the project and asserts the result against the same files a reviewer would read: the application id, the version, the SDK levels, the backup and cleartext posture, which components are exported, the deep-link filters, that over-the-air updates are disabled, that the release build type cannot reach the debug keystore, and — as an **allow-list, not a deny-list** — every permission in the manifest. A permission nobody predicted fails the build.

It compiles nothing, so it needs no JDK, no Android SDK, and no secret, and it runs inside `pnpm ci:verify` in under a minute.

### The native template is a pinned dependency, because it is the baseline of the project

`expo prebuild` downloads `expo-template-bare-minimum` from the registry at the moment it runs. That template *is* the native project's baseline — the Gradle wrapper version, the root and app build files, the manifest, the debug signing block — so an unpinned fetch means two runs a week apart can generate different native projects from identical source. For a repository whose native project is generated rather than committed, that is the reproducibility question rather than a detail of it.

It is therefore an ordinary devDependency in the catalog, under the same `minimumReleaseAge` as everything else, and `scripts/prebuild-android.mjs` packs the installed copy and passes it to `--template`. Nothing is fetched, so prebuild also works offline.

### Compiling is a separate gate from configuring

`pnpm android:build` needs the toolchain and is not part of `pnpm ci:verify`. Requiring a JDK, an SDK platform, build tools, and the NDK for the repository's only gate would make it unrunnable for most contributors and would put a multi-gigabyte provisioning step on the critical path of every check.

It runs instead as its own job in the same workflow, on a runner image that already carries the Android SDK, so a commit that breaks the native build still fails on `main` — it just fails beside the canonical gate rather than inside it. `pnpm android:doctor` reports what a machine is missing and installs nothing, because a build tool that quietly fixes the machine is a build tool whose output nobody can reproduce.

**A Gradle invocation exiting zero is not evidence.** A debug-signed release, a permission a dependency added, and an application that is debuggable in release all exit zero, so `pnpm android:build` opens every artifact afterwards and asserts its manifest against `android-release.json` and the permission model.

### Release signing is supplied at build time, and its absence produces an unsigned artifact

The bare template signs release builds with the debug keystore it ships — a private key that is in every React Native project on the internet. An artifact signed with it is not a release; it is a debug build wearing the word.

So the debug signing configuration is not reachable from the release build type at all. Signing material is read from four environment variables or Gradle properties, is never committed, and when it is absent the build produces a deliberately **unsigned** artifact that Google Play refuses to accept. A release pipeline passes `-Pvelora.android.requireSignedRelease=true`, which turns the absence into a build failure instead of an unsigned file.

### The version is a committed file that a person edits

`apps/mobile/android-release.json` holds the human version and the `versionCode`. Deriving either from the git history would mean the same commit produced different binaries; stamping it at build time would mean nobody could reproduce one; mutating it on every local `expo start` would put a version bump in every developer's diff. The gate refuses a `versionCode` that is not a positive integer, exceeds what Play accepts, or has moved backwards from `origin/main`.

### R8 is off, and that is a decision rather than an omission

Shrinking a React Native release binary needs keep rules whose correctness is only observable by running the shrunk binary. Turning it on without a device run would trade a real size saving for a class of crash that appears only in release, which is the same shape of claim this repository refuses everywhere else.

## Consequences

**Resolved.** The native-build half of four blocked capabilities. A device push token can now be issued, a camera and photo library can be opened, and a native media client could be linked and run. Each of those still has its *other* blocker, and none of them is affected by this decision.

**Not resolved, and unchanged by this ADR.** No push delivery provider is approved. No RTC provider is approved. No storage provider is approved, so a photograph still has no authorized delivery route. Whether a Consumer Mobile application may be published to Google Play once mature content is enabled on Consumer Web is an open legal decision. A Play Console account, an upload key, and every store declaration are human-owned and were not created.

**A new class of check exists.** `pnpm android:verify` is a gate over generated output, which no other part of this repository has. It is an allow-list by construction so that it fails on things nobody predicted.

**A machine cost.** Anybody who wants to compile the application now needs roughly six gigabytes of Android toolchain. `pnpm android:doctor` tells them exactly what and exactly where, and nothing in the canonical gate requires it.

## Alternatives considered

**Committing `android/`.** Reviewable, and it drifts from the configuration that claims to generate it with nothing detecting the drift. Rejected in favour of regenerating and asserting.

**EAS-managed builds only.** `eas.json` exists and declares three Android profiles, but a pipeline that can only build on somebody else's infrastructure cannot gate a commit, and it puts an account and a vendor between a developer and a compiler. EAS is available; it is not the gate.

**Adding `react-native-webrtc` while the pipeline was being built.** Package compatibility permits it. Nothing to connect to does not: `REALTIME_RTC_PROVIDER` is rejected outside local and test, so no deployed environment can mint a join credential. Linking twenty megabytes of native media code and four device permissions for a capability with no provider would be exactly the claimed capability this repository refuses. The seam is in place; the vendor is not.

## Cross-references

[ADR-0004](ADR-0004-client-frameworks.md), [ADR-0018](ADR-0018-toolchain-provisioning-verification-ci.md), [ADR-0030](ADR-0030-consumer-mobile-product-interface.md), [Consumer Mobile surface](../surfaces/02-consumer-mobile.md), [Android native build](../engineering/11-android-native-build.md), [Android release and signing](../engineering/12-android-release-and-signing.md), [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md), and [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
