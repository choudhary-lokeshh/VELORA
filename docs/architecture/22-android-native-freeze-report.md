# Android native production freeze report

- Freeze status: Frozen
- Freeze SHA: `a7e6b7082de07d8c379d5f49d6799df6a0bf5774`
- Freeze date: 2026-08-24
- Hosted CI: run 32751438543, both jobs green on the freeze SHA
- Starting SHA: `21a05b4ab76735efbffc38c5bbc32ec56db7de09`
- Architecture authority: [ADR-0031](../decisions/ADR-0031-android-native-build-pipeline.md)

## What this work owns

The Android native build for `apps/mobile`, and the capabilities that build unblocked. It owns no product design: NIGHT CURRENT is frozen by [ADR-0030](../decisions/ADR-0030-consumer-mobile-product-interface.md) and the only interface changes here are two defects a real device exposed.

**iOS is out of scope rather than unfinished.** `platforms: ['android']`, prebuild runs `--platform android`, and the gate fails if an `ios/` directory appears.

## Where it started

Consumer Mobile was a complete product with no native build behind it. `pnpm --filter @velora/mobile build` ran `expo export`, which produces JavaScript bundles and compiles nothing; there was no `android/`, no `eas.json`, and no `expo-dev-client`.

That one gap was the second, independent blocker on four capabilities, and every one of them was recorded that way: push registration, call media, a camera, and any future native module. The reasoning was correct — adding a package with native code would have put code into the tree that no gate compiled, so `pnpm ci:verify` would have stayed green while the application was unbuildable.

## The native strategy

Continuous generation. `apps/mobile/android` is produced by `expo prebuild` from `app.config.ts` and the config plugins beside it, is git-ignored, and is thrown away on every run. There is exactly one place a native fact can live and no way for a hand edit to survive.

Generation costs the diff a committed project would have given, so `pnpm android:verify` regenerates the project and asserts what came out — as an **allow-list**, so a permission nobody predicted fails the build. It compiles nothing, needs no toolchain and no secret, and runs inside `pnpm ci:verify`.

The native template is a pinned dependency. `expo prebuild` otherwise downloads `expo-template-bare-minimum` at run time, and that template *is* the project's baseline — the Gradle wrapper, the build files, the manifest, the debug signing block. `scripts/prebuild-android.mjs` packs the installed copy and passes it to `--template`, so generation is reproducible and works offline.

## What was built, and what was read back out of it

| | |
|---|---|
| applicationId / namespace | `com.velora.consumer` |
| Version | `0.1.0`, versionCode `1` |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 |
| Build tools / NDK / AGP / Gradle / Kotlin | 36.0.0 / 27.1.12297006 / 8.12.0 / 9.3.1 / 2.1.20 |
| Expo / React Native | 57.0.15 / 0.86.2, new architecture and Hermes on |
| Debug APK | 255.7 MB, `debuggable=true`, signed with the template's debug key, 12 permissions |
| Release APK | 101.3 MB, `debuggable=false`, **unsigned**, 10 permissions |
| Release AAB | 70.5 MB, 1446 entries, base module and protobuf manifest present, **unsigned** |
| Release signing | None supplied, so both release artifacts came out unsigned and are named `app-release-unsigned.apk`. This is the fail-closed outcome, read back with `apksigner` rather than inferred |
| ABIs | `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` |

Every artifact was opened afterwards and its manifest asserted, because a Gradle invocation exits zero for a debug-signed release, an unexpected permission, and a debuggable release alike.

The hosted job produced the same three artifacts with byte-identical reports — the same sizes, the same version, the same ten and twelve permissions, the same signing states — on a Linux runner from a clean checkout. Two machines, two operating systems, one result, which is what the generated-project strategy was chosen for. They are retained as `android-a7e6b7082de07d8c379d5f49d6799df6a0bf5774` for fourteen days.

## Permissions, and the gate that could not see them

**The most important thing this vertical found is that its own first gate was looking at the wrong file.**

There are two manifests. The one in `apps/mobile/android/app/src/main/AndroidManifest.xml` is what this repository declares. The one inside the built APK is that manifest merged with every library's, and it is the only one a person installing the application ever meets.

The declared manifest asked for six permissions. The first release APK built from it asked for **thirty-two**. The twenty-six additions came from libraries and appeared in no file in this repository:

- **Sixteen OEM launcher-badge permissions** — Samsung, Huawei, HTC, Sony, Oppo, and four others — carried by `expo-notifications` through ShortcutBadger, for a mechanism Android replaced in Oreo with the notification channel's own `showBadge`, which this application already sets.
- **Two biometric permissions**, from an `expo-secure-store` per-item authentication option nothing uses.
- **Play install-referrer binding**, for acquisition attribution VELORA does not measure.
- Cloud Messaging's three, which the push client genuinely needs.
- One AndroidX-generated, application-scoped permission that keeps a runtime-registered receiver unexported.

Twenty-two are now blocked, four are kept and justified, and the reason for each is in `scripts/android-permission-model.mjs` — one table that **both** gates read, so they cannot drift. `pnpm android:verify` asserts the declared manifest and needs no toolchain; `pnpm android:build` asserts the merged manifest by reading it back out of the artifact. Neither replaces the other: the first catches a permission somebody wrote down, the second catches a permission a dependency brought.

### What the release binary requests

| Permission | Why |
|---|---|
| `INTERNET` | The product |
| `CAMERA` | The profile photograph |
| `POST_NOTIFICATIONS` | Android 13's runtime gate on showing a notification |
| `VIBRATE` | The notification channels created at first launch |
| `READ_EXTERNAL_STORAGE` (`maxSdkVersion=32`) | Gallery selection below Android 13, where no photo picker exists |
| `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=32`) | The same legacy path |
| `ACCESS_NETWORK_STATE` | The push client reads connectivity before calling a registration failed |
| `WAKE_LOCK` | A push message has to wake the device long enough to be handled |
| `com.google.android.c2dm.permission.RECEIVE` | Cloud Messaging receipt — the push client itself |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX-generated and application-scoped; how an unexported runtime receiver is kept unexported |

No microphone, no Bluetooth, no contacts, no location, no SMS, and no launcher-badge permission of any kind.

`SYSTEM_ALERT_WINDOW` and `CHANGE_WIFI_MULTICAST_STATE` belong to the development client — an overlay and mDNS bundler discovery. Both are present in the debug variant and **absent from release**, and the gate asserts that separation in both directions rather than assuming the merger got it right.

## Security posture of the shipped binary

Backup and device-to-device transfer both closed (`allowBackup=false` plus explicit extraction rules). Cleartext traffic refused in release and permitted only in the debug variant, so Metro is reachable in development and nothing is in production. Only the launcher activity is exported. Over-the-air updates disabled, so the binary cannot replace its own JavaScript after review. Release builds are not debuggable. No verified App Link is declared, because no domain is owned. R8 is off, deliberately: shrinking a React Native release needs keep rules whose correctness is only observable by running the shrunk binary.

Release signing cannot reach the template's shared debug keystore — that line is replaced rather than added beside, so there is no path back. Absent signing material yields a deliberately **unsigned** artifact that Google Play refuses, and `-Pvelora.android.requireSignedRelease=true` turns the absence into a build failure instead.

## What ran on a real device

An Android 36 emulator (Pixel 7, 1080×2400, 420 dpi, arm64), with the debug build installed from `adb`, the local API on `adb reverse`, and Metro serving JavaScript.

**Proven:** cold launch; the `velora://` intent filter (the development client is launched through it); sign-in against the real API; **session restore across force-stop and cold start**, from the Android Keystore; the onboarding ladder end to end — adult declaration, policy acknowledgement, profile; the photo sheet; **the camera permission in all four states** — never asked, granted, denied, and permanently denied, each rendering its own sentence and the last offering Settings; **camera capture through the system camera app**; the media capability request and the upload-failure path; the media slot state machine; all five destinations; deep links to `velora://notices` and `velora://you/safety`; malformed and traversal links landing safely on Notices; 200 % font scale; landscape; and **sign-out, with the device revocation firing before the logout while the access token is still valid**.

**Not proven, and not claimed:** a physical device, any Android version below 36, the legacy gallery path below Android 13, the release binary running (it is unsigned, so it cannot be installed), push delivery, and call media.

### Two facts a browser walk could not have found

> **Both were fixed after this freeze, in the whole-platform runtime recovery.** The `local-test` storage adapter was given a transport on the API's own origin, so the upload the two paragraphs below describe as impossible now succeeds. A later emulator walk completed the onboarding ladder with a photo chosen from the device gallery, uploaded over HTTP, inspected and processed by the worker, and reached Discover, Introductions, Messages, and a sent message — with no database fixture anywhere. The paragraphs are kept as written because they are what this vertical actually found; see `docs/engineering/07-configuration-environments.md` for the transport.

**The product surface is unreachable on a device with a real API.** `stepFor` requires `profileComplete`, which requires a photo in `ready` state; a photo reaches `ready` only through a storage provider, and the local-test adapter deliberately issues an unresolvable `media.velora.invalid` address. So a new account stops at the profile step forever. The five destinations above were reached by marking one asset `ready` directly in the local development database — a fixture, stated as one, and not evidence that an upload works anywhere.

**The upload byte-write cannot succeed in any environment today.** The client asked for the capability, received one, failed the write, and reported it without leaking the storage address — which is the correct behaviour and is as far as this can be taken before a provider exists.

## Defects this work found and fixed

1. **An infinite remount loop that made the application unusable.** `LinkRouter`'s effect listed `toast` in its dependencies. `useToast` returns a new object whenever the visible toasts change, and the effect raised a toast — so it re-ran itself. The device remounted the root about thirty-six times a second (1793 mounts in fifty seconds), the session restore never settled, and the launch screen never left. Nothing in a browser walk could find it: `Linking.getInitialURL()` never answers there.
2. **The development client's own address was treated as a broken product link.** `velora://expo-development-client/?url=…` is how every development build is pointed at a bundler, so the product saw it on every launch, announced a refusal nobody caused, and navigated away from the address the launch was for. It was also the toast that fed the loop above. Foreign addresses on the scheme are now ignored rather than refused.
3. **The wordmark rendered as "VELOR".** Android places the letter-space after the last glyph and then measures the view without it, so a centred wordmark lost its final letter. The trailing advance now has padding to live in.
4. **The tab bar became unreadable at 200 % font scale**, truncating to "Discov..Introd..Messa..". Five labels share one screen width, so that slot cannot grow with body copy; it is capped at 1.3, which keeps five whole words.
5. **The build script looked for the wrong release artifact.** AGP names an unsigned release `app-release-unsigned.apk`; the inspection looked for `app-release.apk` and reported a successful build as a failure. The filename is now read as signing evidence in its own right.
6. **The permission gate read the declared manifest and called it the shipped one**, which is the defect described above: twenty-six permissions reached the artifact without any commit mentioning them. Both manifests are now checked against one shared table.
7. **The artifact inspector mis-read a capped permission.** `apkanalyzer` prints `android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32` as one line; matching the whole line against a bare name made the check report a permission it had itself allowed, and simultaneously claim the permission was missing.
8. **The toolchain doctor passed on a half-installed NDK.** It checked for the directory; an out-of-disk install leaves the directory and nothing in it. It now reads `source.properties`, the receipt `sdkmanager` writes only on success.

Two defects were found in the repository rather than in this work and are recorded rather than fixed here: `packages/consumer-client` published no operations for `/v1/notifications/devices`, though the server has had them since the notifications freeze; and every installation in the world sent the literal identifier `installation-local-device`, which made per-device revocation and push registration operations on one imaginary shared device. Both were closed, because the native work could not be correct without them.

## Capability separation

These are five different things and are not combined.

| | State |
|---|---|
| **Android native build pipeline** | **READY.** Generates, compiles, links, packages, and is asserted by two gates |
| **Android push client readiness** | **READY.** Channels, permission handling, token acquisition behind a provider-neutral port, registration and revocation against the contract, rotation handling, notification-intent routing |
| **Android RTC client readiness** | **ARCHITECTURE ONLY.** No media library is linked and no microphone permission is declared, deliberately |
| **Live push delivery** | **BLOCKED.** No approved provider, and none configured. No token is issued and no permission is ever requested |
| **Live RTC media** | **BLOCKED.** No approved SFU; `REALTIME_RTC_PROVIDER` is refused outside local and test |

Also blocked: **remote media delivery**, on the authorized delivery contract and a storage provider; and **Play Store submission**, which is human-owned and was not performed.

## Commits

Eight, from `21a05b4ab76735efbffc38c5bbc32ec56db7de09`: the pipeline, the native capability bindings, the documentation, and five fixes for things only the hosted runner could show — `sdkmanager` not being on its `PATH`, a native template that could not be repacked portably, a cold Gradle cache that outran its own budget, and two formatting misses.

## Tests and gates

119 mobile assertions across ten suites, up from 71. The four new suites cover the installation identifier, the four permission states, the deep-link allow-list including traversal and the development client's address, notification routing for every approved template, the notification channels, the push registration lifecycle — including a token rotation arriving during sign-out and a registration that lands after the sign-out it raced — and the media picker and upload paths.

`pnpm android:verify` joins `pnpm ci:verify`. It was shown to fail on an unjustified permission and on a config plugin that stopped applying, so it is a check that can fail. `pnpm android:build` runs as its own CI job on `ubuntu-24.04`, uploads the three artifacts, and needs no secret.

## What a person still has to do

A Google Play Developer account; an upload keystore and its custody in the approved secret manager; content rating, Data safety, target audience, and ads declarations; a published privacy policy; and the decision, still `LEGAL REVIEW REQUIRED`, on whether a Consumer Mobile application may be published at all once mature content exists on Consumer Web. Technical readiness is not permission.

## Cross-references

[ADR-0031](../decisions/ADR-0031-android-native-build-pipeline.md), [Android native build](../engineering/11-android-native-build.md), [Android release and signing](../engineering/12-android-release-and-signing.md), [Consumer Mobile surface](../surfaces/02-consumer-mobile.md), [Consumer Mobile freeze report](21-consumer-mobile-freeze-report.md), [notifications freeze report](17-notifications-freeze-report.md), [RTC freeze report](16-rtc-freeze-report.md), [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md), and [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
