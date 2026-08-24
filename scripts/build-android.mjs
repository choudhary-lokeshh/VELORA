import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  blockedPermissions,
  developmentOnlyPermissions,
  permittedInRelease,
} from './android-permission-model.mjs';
import { prebuildAndroid } from './prebuild-android.mjs';

/**
 * Builds the Android application and then reads what came out.
 *
 * The reading is the point. A Gradle invocation that exits zero proves that
 * Gradle was happy, not that the artifact is the one this repository intends —
 * a debug-signed release, a permission a dependency added, a `versionCode` that
 * never made it out of the config, and an application that is debuggable in
 * release all exit zero. So every artifact is opened afterwards and its
 * manifest is asserted against `apps/mobile/android-release.json` and the
 * permission model.
 *
 * It needs a JDK, the Android SDK, and the NDK, which `pnpm android:doctor`
 * reports on and which `pnpm ci:verify` deliberately does not require: the
 * configuration gate `pnpm android:verify` compiles nothing and runs
 * everywhere, and this runs where a toolchain exists.
 *
 * Usage:
 *   pnpm android:build             debug APK, release APK, and release AAB
 *   pnpm android:build --debug     just the installable debug APK
 *
 * Release signing material is never required and never fabricated. Without it
 * the release artifacts come out unsigned, which is stated rather than hidden;
 * see `docs/engineering/12-android-release-and-signing.md`.
 */

const mobileRoot = 'apps/mobile';
const androidRoot = join(mobileRoot, 'android');
const releaseFile = join(mobileRoot, 'android-release.json');
const outputs = join(androidRoot, 'app/build/outputs');

const debugOnly = process.argv.includes('--debug');

const applicationId = 'com.velora.consumer';
/** Google Play refuses an upload without every 64-bit ABI it declares. */
const requiredAbis = ['arm64-v8a', 'x86_64'];

function fail(message) {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function resolveAndroidHome() {
  for (const name of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const value = process.env[name];
    if (value !== undefined && value !== '' && existsSync(value)) return value;
  }
  const conventional =
    process.platform === 'darwin'
      ? join(homedir(), 'Library/Android/sdk')
      : join(homedir(), 'Android/Sdk');
  if (existsSync(conventional)) return conventional;
  return undefined;
}

const androidHome = resolveAndroidHome();
if (androidHome === undefined) {
  fail('No Android SDK. Run `pnpm android:doctor` for what is missing.');
}

const environment = {
  ...process.env,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  EXPO_NO_TELEMETRY: '1',
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.error !== undefined) {
    fail(`Could not run ${command}: ${result.error.message}`);
  }
  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    status: result.status,
  };
}

/** `apkanalyzer`, which reads a built APK rather than the source it came from. */
function analyze(...args) {
  const binary = join(androidHome, 'cmdline-tools/latest/bin/apkanalyzer');
  if (!existsSync(binary)) fail(`apkanalyzer not found at ${binary}`);
  const result = run(binary, args);
  if (result.status !== 0) {
    fail(`apkanalyzer ${args.join(' ')} failed:\n${result.output}`);
  }
  return result.output.trim();
}

function megabytes(file) {
  return (statSync(file).size / (1024 * 1024)).toFixed(1);
}

/* ------------------------------------------------------------------ build */

function preflight() {
  const doctor = run('node', [
    'scripts/check-android-toolchain.mjs',
    '--quiet',
  ]);
  if (doctor.status !== 0) {
    process.stderr.write(doctor.output);
    fail('The Android toolchain is incomplete; nothing was built.');
  }
}

function prebuild() {
  process.stdout.write('Generating the Android project…\n');
  const result = prebuildAndroid();
  if (result.status !== 0) {
    process.stderr.write(result.output);
    fail('expo prebuild failed.');
  }
}

function gradle(tasks) {
  process.stdout.write(`Gradle ${tasks.join(' ')}…\n`);
  const result = run('./gradlew', [...tasks, '--console=plain'], {
    cwd: androidRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0) fail(`Gradle failed on ${tasks.join(' ')}.`);
}

/**
 * Where the release APK landed, which is itself evidence about signing.
 *
 * The Android Gradle Plugin names an unsigned release `app-release-unsigned.apk`
 * and a signed one `app-release.apk`. That is a fact worth reading rather than
 * papering over: with no signing material supplied the unsigned name is the
 * expected outcome and the signed name would mean something had signed it, which
 * — since the release build type cannot reach the debug keystore — should be
 * impossible. Finding neither is a build that did not produce a release at all.
 */
function releaseApkPath() {
  const signed = join(outputs, 'apk/release/app-release.apk');
  const unsigned = join(outputs, 'apk/release/app-release-unsigned.apk');
  if (existsSync(signed) && existsSync(unsigned)) {
    fail(
      'Both a signed and an unsigned release APK exist. Clean ' +
        `${join(outputs, 'apk/release')} and build again; there is no way to ` +
        'tell which one a later step would pick up.',
    );
  }
  if (existsSync(signed)) return signed;
  if (existsSync(unsigned)) return unsigned;
  fail(
    `No release APK at ${signed} or ${unsigned}. Gradle reported success, so ` +
      'the packaging task changed where it writes.',
  );
  return signed;
}

/* -------------------------------------------------------------- inspection */

function inspectApk(file, { debuggable, label }) {
  if (!existsSync(file)) fail(`${label} was not produced at ${file}`);
  const release = JSON.parse(readFileSync(releaseFile, 'utf8'));

  const found = {
    applicationId: analyze('manifest', 'application-id', file),
    debuggable: analyze('manifest', 'debuggable', file),
    minSdk: analyze('manifest', 'min-sdk', file),
    targetSdk: analyze('manifest', 'target-sdk', file),
    versionCode: analyze('manifest', 'version-code', file),
    versionName: analyze('manifest', 'version-name', file),
  };
  // `apkanalyzer` prints a capped permission as
  // `android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32`, so the name
  // has to be taken off the front rather than matched whole. Reading the line
  // as one string is how the first run of this check reported a permission it
  // had itself allowed.
  const permissions = analyze('manifest', 'permissions', file)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const capped = /^(\S+)'\s*maxSdkVersion='(\d+)$/u.exec(line);
      return capped === null
        ? { maxSdkVersion: undefined, name: line }
        : { maxSdkVersion: capped[2], name: capped[1] };
    });

  const problems = [];
  const expect = (name, actual, wanted) => {
    if (String(actual) !== String(wanted)) {
      problems.push(
        `${label}: ${name} is ${String(actual)}, expected ${String(wanted)}`,
      );
    }
  };
  expect('applicationId', found.applicationId, applicationId);
  expect('versionCode', found.versionCode, release.versionCode);
  expect('versionName', found.versionName, release.version);
  expect('minSdkVersion', found.minSdk, 24);
  expect('targetSdkVersion', found.targetSdk, 36);
  expect('debuggable', found.debuggable, String(debuggable));

  /*
   * The merged manifest, which is the only one anybody installing this
   * application ever meets. A permission is admitted when the repository
   * declared it, when it is a dependency's that this product justifies, or —
   * for the debug variant only — when it belongs to the development client.
   */
  const permitted = permittedInRelease();
  const names = new Set(permissions.map((permission) => permission.name));
  for (const permission of permissions) {
    const allowedHere =
      permitted.has(permission.name) ||
      (debuggable && developmentOnlyPermissions.has(permission.name));
    if (!allowedHere) {
      problems.push(
        `${label}: requests ${permission.name}, which nothing in this product ` +
          'justifies. Add it to blockedPermissions in app.config.ts, or justify ' +
          'it in scripts/android-permission-model.mjs.',
      );
    }
  }
  for (const permission of permitted) {
    if (!names.has(permission)) {
      problems.push(`${label}: no longer requests ${permission}`);
    }
  }
  for (const permission of blockedPermissions.keys()) {
    // A permission can be blocked *and* development-only, and one is:
    // `SYSTEM_ALERT_WINDOW` is blocked so the release build drops it, and the
    // debug manifest re-declares it at a higher merge priority so the
    // development overlay keeps working. Expecting it gone from every variant
    // would be expecting the merger to ignore that priority.
    if (debuggable && developmentOnlyPermissions.has(permission)) continue;
    if (names.has(permission)) {
      problems.push(
        `${label}: still requests ${permission}, which is on the blocked list. ` +
          'The manifest merger did not remove it.',
      );
    }
  }
  if (!debuggable) {
    for (const permission of developmentOnlyPermissions) {
      if (names.has(permission)) {
        problems.push(
          `${label}: carries ${permission}, which belongs to the development ` +
            'client and must not reach a release build.',
        );
      }
    }
  }

  const files = analyze('files', 'list', file).split('\n');
  for (const abi of requiredAbis) {
    if (!files.some((entry) => entry.includes(`/lib/${abi}/`))) {
      problems.push(`${label}: carries no native libraries for ${abi}`);
    }
  }

  return { file, found, permissions, problems, sizeMb: megabytes(file) };
}

/**
 * Whether an artifact is signed, and with what.
 *
 * `apksigner` exits non-zero on an unsigned APK, which is the expected state
 * for a release built with no signing material. That is reported as a fact
 * rather than treated as a build failure — an unsigned artifact is what
 * fail-closed looks like, and Google Play is where it is supposed to be
 * refused.
 */
function signingOf(file) {
  const binary = join(androidHome, 'build-tools/36.0.0/apksigner');
  if (!existsSync(binary)) return 'unknown (apksigner not installed)';
  const result = run(binary, ['verify', '--print-certs', file]);
  if (result.status !== 0) return 'UNSIGNED';
  const subject = /Signer #1 certificate DN: (.+)/u.exec(result.output);
  return subject === null ? 'signed' : `signed — ${subject[1].trim()}`;
}

function inspectBundle(file) {
  if (!existsSync(file)) fail(`The release bundle was not produced at ${file}`);
  // `apkanalyzer` reads APKs only, and `bundletool` is not part of the SDK, so
  // the bundle is verified structurally: the base module, its protobuf
  // manifest, and native libraries for every ABI Play requires.
  const entries = run('unzip', ['-Z1', file]);
  if (entries.status !== 0) fail('Could not read the release bundle.');
  const listed = entries.output.split('\n');
  const problems = [];
  for (const required of [
    'BundleConfig.pb',
    'base/manifest/AndroidManifest.xml',
    'base/dex/classes.dex',
  ]) {
    if (!listed.includes(required)) {
      problems.push(`The release bundle has no ${required}`);
    }
  }
  for (const abi of requiredAbis) {
    if (!listed.some((entry) => entry.startsWith(`base/lib/${abi}/`))) {
      problems.push(
        `The release bundle carries no native libraries for ${abi}`,
      );
    }
  }
  return { entries: listed.length, file, problems, sizeMb: megabytes(file) };
}

/* ------------------------------------------------------------------- main */

function main() {
  preflight();
  prebuild();

  const artifacts = [];
  gradle([':app:assembleDebug']);
  artifacts.push(
    inspectApk(join(outputs, 'apk/debug/app-debug.apk'), {
      debuggable: true,
      label: 'debug APK',
    }),
  );

  let bundle;
  if (!debugOnly) {
    gradle([':app:assembleRelease', ':app:bundleRelease']);
    artifacts.push(
      inspectApk(releaseApkPath(), {
        // The one property that would turn a release into a debugging target
        // for anybody holding the file.
        debuggable: false,
        label: 'release APK',
      }),
    );
    bundle = inspectBundle(join(outputs, 'bundle/release/app-release.aab'));
  }

  process.stdout.write('\n──────── Android artifacts ────────\n');
  for (const artifact of artifacts) {
    process.stdout.write(
      `\n${artifact.file}\n` +
        `  ${artifact.sizeMb} MB\n` +
        `  ${artifact.found.applicationId} ${artifact.found.versionName} (${artifact.found.versionCode})\n` +
        `  minSdk ${artifact.found.minSdk}, targetSdk ${artifact.found.targetSdk}, debuggable ${artifact.found.debuggable}\n` +
        `  signing: ${signingOf(artifact.file)}\n` +
        `  permissions (${String(artifact.permissions.length)}): ${artifact.permissions.map((p) => p.name).join(', ')}\n`,
    );
  }
  if (bundle !== undefined) {
    process.stdout.write(
      `\n${bundle.file}\n` +
        `  ${bundle.sizeMb} MB, ${String(bundle.entries)} entries\n` +
        `  signing: ${signingOf(bundle.file)}\n`,
    );
  }

  const problems = [
    ...artifacts.flatMap((artifact) => artifact.problems),
    ...(bundle?.problems ?? []),
  ];
  if (problems.length > 0) {
    process.stderr.write(
      '\nThe artifacts are not what this repository declares:\n',
    );
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    '\nEvery artifact matches the declared configuration.\n',
  );
}

main();
