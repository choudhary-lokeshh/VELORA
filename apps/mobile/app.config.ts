import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

/**
 * Consumer Mobile's native configuration, and the only source of it.
 *
 * The Android project is generated rather than committed
 * ([ADR-0031](../../docs/decisions/ADR-0031-android-native-build-pipeline.md)),
 * so everything a native build needs is either in this file or in a config
 * plugin beside it. There is no `android/` directory to edit by hand, which is
 * what keeps two developers and CI producing the same binary: `expo prebuild`
 * throws the project away and rebuilds it from here every time.
 *
 * **Android is the only platform.** `platforms` says so, `expo prebuild` is
 * always run with `--platform android`, and `pnpm android:verify` fails if an
 * `ios/` directory ever appears. iOS is out of scope rather than merely
 * unfinished.
 */

interface AndroidRelease {
  readonly version: string;
  readonly versionCode: number;
}

/**
 * The version a release carries, read from a file a person edits.
 *
 * Deriving it from the git history or stamping it at build time would mean the
 * same commit produced different binaries, and mutating it on every local
 * `expo start` would put a version bump in every developer's diff. It is one
 * committed file, advanced deliberately by whoever cuts a release, and
 * `pnpm android:verify` refuses a `versionCode` that is not a positive integer
 * or that moved backwards from `origin/main`.
 */
function readRelease(): AndroidRelease {
  const file = join(__dirname, 'android-release.json');
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${file} is not an object`);
  }
  const { version, versionCode } = parsed as Record<string, unknown>;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`${file} declares no usable version`);
  }
  if (!Number.isSafeInteger(versionCode) || (versionCode as number) < 1) {
    throw new Error(`${file} declares no usable versionCode`);
  }
  return { version, versionCode: versionCode as number };
}

/**
 * NIGHT CURRENT's ground and accent, restated here because a native build
 * reads a colour before any JavaScript runs.
 *
 * `pnpm android:verify` reads `src/design/tokens.ts` and fails if either value
 * drifts from the token it copies, so the duplication cannot go stale.
 */
const canvas = '#0c0a0c';
const ember = '#e17a66';

const release = readRelease();

const config: ExpoConfig = {
  name: 'VELORA',
  slug: 'velora',
  scheme: 'velora',
  version: release.version,
  orientation: 'default',
  // The approved Consumer expression is tonal dark and there is no light
  // theme to switch to, so the native shell is told that once rather than
  // being left to guess it per screen.
  userInterfaceStyle: 'dark',
  backgroundColor: canvas,
  platforms: ['android'],
  android: {
    package: 'com.velora.consumer',
    versionCode: release.versionCode,
    icon: './assets/android/icon.png',
    adaptiveIcon: {
      foregroundImage: './assets/android/adaptive-icon-foreground.png',
      monochromeImage: './assets/android/adaptive-icon-monochrome.png',
      backgroundColor: canvas,
    },
    /**
     * Every permission this application asks for, and nothing else.
     *
     * `INTERNET` is the product. `POST_NOTIFICATIONS` is Android 13's runtime
     * gate on showing a notification at all, and `VIBRATE` is what the
     * notification channels created at first launch are configured for — a
     * channel's vibration is immutable after it is created, so getting it
     * right now is what stops live delivery needing new channel identifiers
     * later. `CAMERA` is the profile photograph.
     *
     * What is deliberately absent is as important. There is no `RECORD_AUDIO`:
     * `expo-image-picker` adds it for video capture, this application captures
     * no video, and it is blocked below rather than merely unused. There is no
     * microphone or Bluetooth permission for calling, because calling opens no
     * audio route. There are no contacts, no location, and no SMS.
     */
    permissions: [
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
    ],
    /**
     * Permissions something else in the build asks for that this product does
     * not justify. Each becomes `tools:node="remove"`, so a dependency cannot
     * quietly reintroduce one.
     *
     * Most of this list could not have been written from the source manifest.
     * It was written from a built APK: the declared manifest asked for six
     * permissions and the merged one asked for thirty-two, because every
     * library's manifest merges in. Sixteen of the additions are OEM
     * launcher-badge permissions carried by `expo-notifications`, for a
     * mechanism Android replaced with the notification channel's own
     * `showBadge` in Oreo. Two are biometric permissions from a secure-storage
     * option nothing uses. One is Play install attribution.
     *
     * `SYSTEM_ALERT_WINDOW` is the bare template's, for the development
     * overlay; the debug variant declares it again at a higher merge priority,
     * so a development build keeps it and a release build does not.
     * `RECORD_AUDIO` belongs to video capture this application does not do.
     * `RECEIVE_BOOT_COMPLETED` lets `expo-notifications` re-arm notifications
     * it scheduled locally, and this application schedules none.
     *
     * The reason for each is in `scripts/android-permission-model.mjs`, which
     * both Android gates read so they cannot disagree.
     *
     * The two legacy storage permissions are *not* blocked. `expo-image-picker`
     * declares them capped at `maxSdkVersion="32"`, which is the modern
     * scoped-access answer: on Android 13 and later the photo picker needs no
     * permission at all, and below it there is no other way to read the
     * gallery. Blocking them would break photo selection on every device
     * running Android 12 or older, which `minSdkVersion` 24 still admits.
     */
    blockedPermissions: [
      'android.permission.READ_APP_BADGE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      'com.anddoes.launcher.permission.UPDATE_COUNT',
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
      'com.htc.launcher.permission.READ_SETTINGS',
      'com.htc.launcher.permission.UPDATE_SHORTCUT',
      'com.huawei.android.launcher.permission.CHANGE_BADGE',
      'com.huawei.android.launcher.permission.READ_SETTINGS',
      'com.huawei.android.launcher.permission.WRITE_SETTINGS',
      'com.majeur.launcher.permission.UPDATE_BADGE',
      'com.oppo.launcher.permission.READ_SETTINGS',
      'com.oppo.launcher.permission.WRITE_SETTINGS',
      'com.sec.android.provider.badge.permission.READ',
      'com.sec.android.provider.badge.permission.WRITE',
      'com.sonyericsson.home.permission.BROADCAST_BADGE',
      'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
      'me.everything.badger.permission.BADGE_COUNT_READ',
      'me.everything.badger.permission.BADGE_COUNT_WRITE',
    ],
  },
  plugins: [
    'expo-router',
    /**
     * The Android SDK levels, pinned rather than inherited.
     *
     * Without this the levels come from whichever `react-native` happens to be
     * installed, which means a dependency bump could move the compile or
     * target level with no commit that says so. `targetSdkVersion` 36 is what
     * Google Play requires of a new application from 31 August 2026.
     *
     * R8 is deliberately off. Shrinking a React Native release binary needs
     * keep rules whose correctness is only observable by running the shrunk
     * binary, and this repository has run one on an emulator and not on a
     * physical device. Turning it on unverified would trade a real size saving
     * for a class of crash that only appears in release.
     */
    [
      'expo-build-properties',
      {
        android: {
          buildToolsVersion: '36.0.0',
          compileSdkVersion: 36,
          minSdkVersion: 24,
          targetSdkVersion: 36,
          usesCleartextTraffic: false,
          enableProguardInReleaseBuilds: false,
          enableShrinkResourcesInReleaseBuilds: false,
        },
      },
    ],
    /**
     * The splash is the canvas the first screen paints, so the handover from
     * the system window to React is not a flash of another colour.
     */
    [
      'expo-splash-screen',
      {
        backgroundColor: canvas,
        image: './assets/android/splash-icon.png',
        imageWidth: 160,
        dark: { backgroundColor: canvas },
      },
    ],
    /**
     * Android throws a notification icon's colours away and keeps its alpha,
     * so the silhouette is white and the accent is supplied separately.
     */
    [
      'expo-notifications',
      {
        icon: './assets/android/notification-icon.png',
        color: ember,
      },
    ],
    /**
     * `microphonePermission: false` is the point of this entry. Left alone the
     * plugin adds `RECORD_AUDIO` for video capture, and this application
     * selects and captures still images only.
     */
    [
      'expo-image-picker',
      {
        cameraPermission:
          'VELORA uses the camera only when you choose to take a profile photograph.',
        microphonePermission: false,
      },
    ],
    /**
     * The live-discovery preview, and the same refusal for the same reason.
     *
     * `recordAudioAndroidPermission: false` keeps `RECORD_AUDIO` out. The
     * camera opens so somebody can see themselves before and during a live
     * encounter; nothing records, and no approved provider exists to carry
     * audio anywhere, so asking for a microphone would be asking for a
     * permission this build cannot use. `scripts/android-permission-model.mjs`
     * asserts the merged manifest against that.
     */
    [
      'expo-camera',
      {
        cameraPermission:
          'VELORA opens the camera when you start Live, so the person you meet can see you.',
        microphonePermission: false,
        recordAudioAndroidPermission: false,
      },
    ],
    './plugins/with-velora-android',
  ],
  experiments: {
    // The generated route union lives under `.expo/`, which is not committed,
    // and `expo export` rewrites it empty — so it is red locally and green in
    // CI for identical code. `src/frame/links.ts` builds every address instead.
    typedRoutes: false,
  },
};

export default config;
