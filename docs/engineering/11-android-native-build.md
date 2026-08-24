# Android native build

## What this covers

How `apps/mobile` becomes an Android application: what a machine needs, what generates the native project, what checks it, and what each command actually proves. The decision behind all of it is [ADR-0031](../decisions/ADR-0031-android-native-build-pipeline.md).

Android is the only native platform this repository builds. `app.config.ts` declares `platforms: ['android']`, prebuild is always run with `--platform android`, and `pnpm android:verify` fails if an `ios/` directory appears.

## The one thing to understand first

**`apps/mobile/android` is generated, git-ignored, and thrown away on every prebuild.** Do not edit it. Nothing you change there survives, and no gate will tell you it vanished.

Every native fact lives in one of two places:

| Where | What belongs there |
|---|---|
| `apps/mobile/app.config.ts` | Application identity, version, icons, splash, permissions, blocked permissions, SDK levels, plugin configuration |
| `apps/mobile/plugins/with-velora-android.ts` | Everything the Expo config has no field for: backup rules, cleartext posture, exported-component assertion, scheme hygiene, release signing |

If a native change has no home in either, it needs a new config plugin, not a file in `android/`.

## Prerequisites

`pnpm android:doctor` reports on all of these, installs none of them, and tells you the exact command for each thing it finds missing. It reads the required versions out of `react-native`'s own Gradle version catalog and out of `app.config.ts`, so a dependency bump moves the requirement with it rather than leaving this document stale.

| Component | Version | Notes |
|---|---|---|
| JDK | 17 or later | `mise install java@temurin-17`, then export `JAVA_HOME` |
| Android SDK platform | 36 | `sdkmanager "platforms;android-36"` |
| Build tools | 36.0.0 | `sdkmanager "build-tools;36.0.0"` |
| NDK | 27.1.12297006 | `sdkmanager "ndk;27.1.12297006"` — required because React Native's new architecture and `expo-modules-core` compile C++ |
| Platform tools | any | `sdkmanager "platform-tools"`, for `adb` |
| Accepted licences | — | `sdkmanager --licenses`; Gradle downloads nothing until they are accepted |

The SDK is expected at `ANDROID_HOME`, or at `~/Library/Android/sdk` on macOS and `~/Android/Sdk` on Linux. Roughly six gigabytes in total, plus a Gradle cache of a similar size on first build.

`java` is deliberately **not** in `mise.toml`. The four-source pin agreement that `pnpm toolchain:check` enforces covers the runtimes the canonical gate needs, and the canonical gate does not compile Android. Adding it there would add a provisioning step to every check for the benefit of one job.

## Commands

| Command | What it does | What it needs |
|---|---|---|
| `pnpm android:doctor` | Reports what this machine is missing | nothing |
| `pnpm android:verify` | Regenerates the project and asserts the result | nothing |
| `pnpm android:build` | Builds debug APK, release APK, release AAB, then inspects each | full toolchain |
| `pnpm android:build --debug` | Just the installable debug APK | full toolchain |
| `pnpm --filter @velora/mobile prebuild` | Regenerates `android/` and stops | nothing |
| `pnpm --filter @velora/mobile android` | `expo run:android` — builds and installs on a running device or emulator | full toolchain, device |
| `pnpm mobile:assets` | Redraws the launcher, notification, and splash images | nothing |

`pnpm android:verify` runs inside `pnpm ci:verify`. `pnpm android:build` does not, and runs as its own CI job instead — see [testing and release](05-testing-release.md).

## Developing against it

Normal product work needs none of this. `bun run dev` starts the whole local stack and `expo start` serves JavaScript to a client that is already installed; a change to a screen is a reload, not a rebuild.

A **native rebuild is required** only when the native project itself changes:

- a dependency with native code is added, removed, or upgraded
- `app.config.ts` or a config plugin changes
- the Expo SDK or React Native version moves

The development client is a real application built from this repository, not Expo Go. Expo Go was dropped when the first native module landed: it cannot load custom native code, so a build that runs there is not the build that ships.

### Getting it onto a device or emulator

```
pnpm android:build --debug        # produces app-debug.apk
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:4000 tcp:4000     # so 127.0.0.1:4000 on the device reaches the API
pnpm --filter @velora/mobile dev  # serves the JavaScript
```

`adb reverse` is the part people miss. The development build resolves its endpoint from `EXPO_PUBLIC_APP_ENV=local`, which means `http://127.0.0.1:4000` — and on a device that is the device itself. The reverse tunnel is what makes it the host machine.

## What the checks actually prove

**`pnpm android:verify`** proves that the project generated from this commit has the declared application id, version, and SDK levels; requests exactly the permissions the product justifies and blocks the ones dependencies contribute; exports only the launcher activity; disables backup, device transfer, cleartext traffic, and over-the-air updates; declares the `velora://` filter and no verified App Link; and cannot reach the debug keystore from the release build type. It proves nothing about whether the project compiles.

**`pnpm android:build`** proves it compiles, links, and packages, and then re-asserts the same properties against the built artifacts rather than against the source — because a Gradle invocation exits zero for a debug-signed release, an unexpected permission, and a debuggable release alike.

**Neither proves the application runs.** That needs a device or an emulator, and what has been run on one is recorded in the [Android native freeze report](../architecture/22-android-native-freeze-report.md).

## Cross-references

[ADR-0031](../decisions/ADR-0031-android-native-build-pipeline.md), [Android release and signing](12-android-release-and-signing.md), [testing and release](05-testing-release.md), [configuration and environments](07-configuration-environments.md), [Consumer Mobile surface](../surfaces/02-consumer-mobile.md), and [ADR-0018](../decisions/ADR-0018-toolchain-provisioning-verification-ci.md).
