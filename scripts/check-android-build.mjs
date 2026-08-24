import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  blockedPermissions,
  declaredPermissions,
} from './android-permission-model.mjs';
import { prebuildAndroid } from './prebuild-android.mjs';

/**
 * The Android native configuration gate.
 *
 * `apps/mobile/android` is generated, never committed, and thrown away on
 * every prebuild ([ADR-0031](../docs/decisions/ADR-0031-android-native-build-pipeline.md)).
 * That buys reproducibility and costs the one thing a committed native project
 * gives you for free: a diff. Nobody reviews a manifest that does not exist in
 * the tree, so a config plugin that silently stopped applying, a dependency
 * that added a permission, or a template change that reintroduced the shared
 * debug keystore would all land unnoticed.
 *
 * This closes that hole. It regenerates the project and asserts what came out,
 * against the same files a reviewer would read. It is deliberately an
 * allow-list rather than a deny-list: a permission nobody has justified fails
 * the build even though nobody predicted it.
 *
 * It compiles nothing, so it needs no JDK, no Android SDK, and no secret, and
 * it runs inside `pnpm ci:verify` in well under a minute. Compiling is
 * `pnpm android:build`, which is a separate job because it needs a toolchain
 * this one does not.
 */

const mobileRoot = 'apps/mobile';
const androidRoot = join(mobileRoot, 'android');
const iosRoot = join(mobileRoot, 'ios');
const manifestFile = join(androidRoot, 'app/src/main/AndroidManifest.xml');
const appGradleFile = join(androidRoot, 'app/build.gradle');
const gradlePropertiesFile = join(androidRoot, 'gradle.properties');
const releaseFile = join(mobileRoot, 'android-release.json');
const appConfigFile = join(mobileRoot, 'app.config.ts');
const tokensFile = join(mobileRoot, 'src/design/tokens.ts');
const easFile = join(mobileRoot, 'eas.json');
const mobileManifestFile = join(mobileRoot, 'package.json');

const applicationId = 'com.velora.consumer';

/**
 * The permission model lives in one module that both Android gates read.
 *
 * This gate sees the manifest this repository *declares*; `pnpm android:build`
 * sees the manifest that actually ships, after every library's has merged into
 * it. They check different files against the same table, which is the only way
 * neither can drift from the other.
 */
const allowedPermissions = declaredPermissions;

/** Gradle properties whose values are a decision rather than a default. */
const requiredGradleProperties = new Map([
  ['android.buildToolsVersion', '36.0.0'],
  ['android.compileSdkVersion', '36'],
  ['android.enableMinifyInReleaseBuilds', 'false'],
  ['android.enableShrinkResourcesInReleaseBuilds', 'false'],
  ['android.minSdkVersion', '24'],
  ['android.targetSdkVersion', '36'],
  ['expo.useLegacyPackaging', 'false'],
  ['hermesEnabled', 'true'],
  ['newArchEnabled', 'true'],
]);

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

/**
 * The XML reader Expo itself used to write the file.
 *
 * Reaching it through the workspace's own dependency graph rather than adding
 * a parser here means the gate cannot disagree with the generator about what
 * the manifest says. A regular expression over generated XML would pass
 * silently the first time the generator changed its formatting.
 */
function loadAndroidConfig() {
  const fromMobile = createRequire(resolve(mobileManifestFile));
  const fromExpo = createRequire(fromMobile.resolve('expo/package.json'));
  const configPlugins = fromExpo.resolve('@expo/config-plugins');
  return createRequire(configPlugins)('@expo/config-plugins').AndroidConfig;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run ${command}: ${result.error.message}`);
  }
  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    status: result.status,
  };
}

/* ------------------------------------------------------------ regeneration */

/**
 * Regenerates the native project, and refuses to let the regeneration edit the
 * repository.
 *
 * `expo prebuild` will rewrite `package.json` and `tsconfig.json` to whatever
 * it thinks a project should have. That is helpful in a scaffold and
 * unacceptable in a gate: a check that modifies the tree it is checking turns
 * a green run into a dirty diff, and `pnpm whitespace:check` would then blame
 * the developer for it.
 */
function regenerate() {
  const guarded = [mobileManifestFile, join(mobileRoot, 'tsconfig.json')];
  const before = guarded.map((file) => readFileSync(file, 'utf8'));

  // Through the shared helper, so this gate and `pnpm android:build` cannot
  // generate the project from different templates.
  const prebuild = prebuildAndroid();
  if (prebuild.status !== 0) {
    process.stderr.write(prebuild.output);
    throw new Error('expo prebuild failed');
  }

  guarded.forEach((file, index) => {
    const after = readFileSync(file, 'utf8');
    if (after !== before[index]) {
      // Put it back before failing, so one run does not leave a dirty tree.
      writeFileSync(file, before[index]);
      failures.push(
        `expo prebuild rewrote ${file}. The generated project must not edit ` +
          'the repository; reconcile the file with what prebuild wants and ' +
          'commit that, rather than letting every run produce a diff.',
      );
    }
  });
}

/* ------------------------------------------------------------- assertions */

function checkNoIosProject() {
  check(
    !existsSync(iosRoot),
    `${iosRoot} exists. iOS is out of scope for this repository: prebuild is ` +
      'run with --platform android and app.config.ts declares platforms: ' +
      "['android'].",
  );
}

async function checkManifestAsync(androidConfig) {
  const parsed =
    await androidConfig.Manifest.readAndroidManifestAsync(manifestFile);
  const root = parsed.manifest;

  /* --------------------------------------------------------- permissions */
  const declared = root['uses-permission'] ?? [];
  const seen = new Set();
  for (const entry of declared) {
    const name = entry.$['android:name'];
    const removed = entry.$['tools:node'] === 'remove';
    if (removed) {
      check(
        blockedPermissions.has(name),
        `AndroidManifest.xml removes ${name}, which is not in the blocked list. ` +
          'Either justify it in app.config.ts or add it to this gate.',
      );
      continue;
    }
    seen.add(name);
    const allowed = allowedPermissions.get(name);
    check(
      allowed !== undefined,
      `AndroidManifest.xml requests ${name}, which no part of this product ` +
        'justifies. Add it to app.config.ts blockedPermissions, or justify it ' +
        'here and in the permission model documentation.',
    );
    if (allowed !== undefined) {
      check(
        entry.$['android:maxSdkVersion'] === allowed.maxSdkVersion,
        `AndroidManifest.xml declares ${name} with maxSdkVersion ` +
          `${String(entry.$['android:maxSdkVersion'])}; ${String(allowed.maxSdkVersion)} was expected.`,
      );
    }
  }
  for (const name of allowedPermissions.keys()) {
    check(
      seen.has(name),
      `AndroidManifest.xml no longer requests ${name}. If the capability was ` +
        'removed, remove it from this gate too.',
    );
  }
  for (const name of blockedPermissions.keys()) {
    check(
      declared.some(
        (entry) =>
          entry.$['android:name'] === name &&
          entry.$['tools:node'] === 'remove',
      ),
      `AndroidManifest.xml does not block ${name}. A dependency can then add ` +
        'it back without any commit here saying so.',
    );
  }

  /* --------------------------------------------------------- application */
  const application = root.application?.[0];
  check(application !== undefined, 'AndroidManifest.xml has no <application>');
  if (application === undefined) return;

  for (const [attribute, expected] of [
    ['android:allowBackup', 'false'],
    ['android:dataExtractionRules', '@xml/velora_data_extraction_rules'],
    ['android:fullBackupContent', '@xml/velora_backup_rules'],
    ['android:usesCleartextTraffic', 'false'],
  ]) {
    check(
      application.$[attribute] === expected,
      `AndroidManifest.xml <application> ${attribute} is ` +
        `${String(application.$[attribute])}; ${expected} was expected.`,
    );
  }

  for (const file of [
    'velora_data_extraction_rules.xml',
    'velora_backup_rules.xml',
  ]) {
    check(
      existsSync(join(androidRoot, 'app/src/main/res/xml', file)),
      `The backup rules the manifest points at were not generated: ${file}`,
    );
  }

  /* -------------------------------------------------- exported components */
  for (const kind of ['activity', 'service', 'receiver', 'provider']) {
    for (const component of application[kind] ?? []) {
      const name = component.$['android:name'];
      if (name === '.MainActivity') continue;
      check(
        component.$['android:exported'] !== 'true',
        `AndroidManifest.xml exports ${kind} ${name}. Only the launcher ` +
          'activity may be exported.',
      );
    }
  }

  /* ------------------------------------------------------------ the entry */
  const main = (application.activity ?? []).find(
    (candidate) => candidate.$['android:name'] === '.MainActivity',
  );
  check(main !== undefined, 'AndroidManifest.xml has no .MainActivity');
  if (main === undefined) return;
  check(
    main.$['android:exported'] === 'true',
    '.MainActivity must be exported; it is the launcher activity.',
  );

  const filters = main['intent-filter'] ?? [];
  const schemes = filters.flatMap((filter) =>
    (filter.data ?? [])
      .map((entry) => entry.$['android:scheme'])
      .filter((scheme) => scheme !== undefined),
  );
  check(
    schemes.includes('velora'),
    'AndroidManifest.xml declares no velora:// intent filter, so no deep link ' +
      'can reach the application.',
  );
  check(
    !schemes.includes('exp+velora'),
    'AndroidManifest.xml still declares the Expo Go scheme exp+velora. This ' +
      'application uses a development client, not Expo Go.',
  );
  check(
    !filters.some((filter) => filter.$?.['android:autoVerify'] === 'true'),
    'AndroidManifest.xml declares a verified Android App Link. No domain is ' +
      'owned or configured, so a verified link would fail verification on ' +
      'every device and open nothing. See DECISIONS_REQUIRED.',
  );
  check(
    filters.some((filter) =>
      (filter.category ?? []).some(
        (category) =>
          category.$['android:name'] === 'android.intent.category.LAUNCHER',
      ),
    ),
    '.MainActivity has no LAUNCHER category, so the application has no icon.',
  );

  /* ---------------------------------------------------------- OTA updates */
  const updatesEnabled = (application['meta-data'] ?? []).find(
    (entry) => entry.$['android:name'] === 'expo.modules.updates.ENABLED',
  );
  check(
    updatesEnabled?.$['android:value'] === 'false',
    'Over-the-air updates are not disabled. A binary that can replace its own ' +
      'JavaScript after review is a different binary from the one reviewed.',
  );
}

function checkAppGradle() {
  const gradle = readFileSync(appGradleFile, 'utf8');
  const release = JSON.parse(readFileSync(releaseFile, 'utf8'));

  check(
    gradle.includes(`namespace '${applicationId}'`),
    `${appGradleFile} declares a namespace other than ${applicationId}.`,
  );
  check(
    gradle.includes(`applicationId '${applicationId}'`),
    `${appGradleFile} declares an applicationId other than ${applicationId}. ` +
      'It is permanent once the application is published.',
  );
  check(
    new RegExp(
      `\\n\\s+versionCode ${String(release.versionCode)}\\n`,
      'u',
    ).test(gradle),
    `${appGradleFile} versionCode does not match ${releaseFile}.`,
  );
  check(
    gradle.includes(`versionName "${release.version}"`),
    `${appGradleFile} versionName does not match ${releaseFile}.`,
  );

  /* ------------------------------------------------------------- signing */
  const releaseBlock = /\n\s+release \{\n([\s\S]*?)\n\s+\}\n/u.exec(
    gradle.slice(gradle.indexOf('buildTypes {')),
  );
  check(
    releaseBlock !== null,
    `${appGradleFile} has no release build type to inspect.`,
  );
  if (releaseBlock !== null) {
    check(
      !/signingConfig\s+signingConfigs\.debug/u.test(releaseBlock[1]),
      `${appGradleFile} signs release builds with the debug keystore. That ` +
        'key is published in every React Native template on the internet.',
    );
    check(
      releaseBlock[1].includes('veloraReleaseSigningAvailable'),
      `${appGradleFile} release build type does not use the Velora signing ` +
        'configuration. The plugin that installs it has stopped applying.',
    );
  }
  check(
    gradle.includes('VELORA_ANDROID_KEYSTORE_PATH'),
    `${appGradleFile} carries no release signing block.`,
  );
  // The debug keystore's own two literals are the template's, are the
  // published Android debug password, and secure nothing. A third literal
  // password anywhere in this file is a committed credential.
  const literalPasswords =
    gradle.match(/\b(?:store|key)Password\s+['"][^'"]*['"]/gu) ?? [];
  check(
    literalPasswords.every((literal) => literal.includes("'android'")),
    `${appGradleFile} contains a literal signing password other than the ` +
      `template's debug one: ${literalPasswords.join(', ')}. Signing material ` +
      'is supplied at build time and never committed.',
  );
}

function checkGradleProperties() {
  const properties = readFileSync(gradlePropertiesFile, 'utf8');
  for (const [name, expected] of requiredGradleProperties) {
    const found = new RegExp(
      `^${name.replace(/\./gu, '\\.')}=(.*)$`,
      'mu',
    ).exec(properties);
    check(
      found !== null,
      `${gradlePropertiesFile} declares no ${name}. It should come from ` +
        'expo-build-properties in app.config.ts.',
    );
    if (found !== null) {
      check(
        found[1].trim() === expected,
        `${gradlePropertiesFile} sets ${name}=${found[1].trim()}; ${expected} ` +
          'was expected.',
      );
    }
  }
}

/**
 * The two colours `app.config.ts` states before any JavaScript can run,
 * checked against the tokens they copy.
 *
 * A native splash and an adaptive icon background are read by the platform
 * before React exists, so they cannot be tokens — they can only be copies. A
 * copy with an assertion against its source is the same arrangement
 * `pnpm design:parity` already uses for the two Consumer surfaces.
 */
function checkNativeColours() {
  const config = readFileSync(appConfigFile, 'utf8');
  const tokens = readFileSync(tokensFile, 'utf8');
  for (const name of ['canvas', 'ember']) {
    const inConfig = new RegExp(
      `^const ${name} = '(#[0-9a-f]{6})';$`,
      'mu',
    ).exec(config);
    const inTokens = new RegExp(`\\n {2}${name}: '(#[0-9a-f]{6})',`, 'u').exec(
      tokens,
    );
    check(inConfig !== null, `${appConfigFile} declares no ${name} colour.`);
    check(inTokens !== null, `${tokensFile} declares no ${name} colour.`);
    if (inConfig !== null && inTokens !== null) {
      check(
        inConfig[1] === inTokens[1],
        `${appConfigFile} uses ${name} ${inConfig[1]} and ${tokensFile} uses ` +
          `${inTokens[1]}. The native shell would paint a different ground ` +
          'from the first screen.',
      );
    }
  }
}

/**
 * The release version, and the one property Google Play enforces about it.
 *
 * A `versionCode` that repeats or moves backwards is rejected at upload, which
 * is a slow and confusing place to find out. Comparing against `origin/main`
 * catches it at the commit that caused it. When that ref cannot be read — a
 * shallow clone, a fresh checkout with no remote — the comparison is reported
 * as not made rather than counted as passed.
 */
function checkReleaseVersion() {
  const release = JSON.parse(readFileSync(releaseFile, 'utf8'));
  check(
    typeof release.version === 'string' &&
      /^\d+\.\d+\.\d+$/u.test(release.version),
    `${releaseFile} version must be a three-part semantic version.`,
  );
  check(
    Number.isSafeInteger(release.versionCode) && release.versionCode >= 1,
    `${releaseFile} versionCode must be a positive integer.`,
  );
  // Google Play's own ceiling.
  check(
    release.versionCode <= 2_100_000_000,
    `${releaseFile} versionCode exceeds the maximum Google Play accepts.`,
  );

  const previous = run('git', ['show', `origin/main:${releaseFile}`]);
  if (previous.status !== 0) {
    process.stdout.write(
      `  versionCode was not compared against origin/main: that ref could not ` +
        `be read here. Monotonicity is unverified in this run.\n`,
    );
    return;
  }
  let baseline;
  try {
    baseline = JSON.parse(previous.output);
  } catch {
    failures.push(`origin/main:${releaseFile} is not readable JSON.`);
    return;
  }
  check(
    release.versionCode >= baseline.versionCode,
    `${releaseFile} versionCode moved backwards, from ` +
      `${String(baseline.versionCode)} on origin/main to ${String(release.versionCode)}. ` +
      'Google Play rejects an upload whose versionCode is not higher than the ' +
      'last one it accepted.',
  );
}

/** Build profiles: Android only, and no credential anywhere near them. */
function checkEasProfiles() {
  const eas = JSON.parse(readFileSync(easFile, 'utf8'));
  const profiles = Object.entries(eas.build ?? {});
  check(profiles.length > 0, `${easFile} declares no build profiles.`);
  for (const [name, profile] of profiles) {
    check(
      profile.ios === undefined,
      `${easFile} profile ${name} declares an iOS build. iOS is out of scope.`,
    );
    check(
      profile.android !== undefined,
      `${easFile} profile ${name} declares no Android build.`,
    );
    for (const [key, value] of Object.entries(profile.env ?? {})) {
      check(
        key.startsWith('EXPO_PUBLIC_'),
        `${easFile} profile ${name} sets ${key}. Only EXPO_PUBLIC_ values ` +
          'belong here: everything in this file is compiled into the binary ' +
          'and is readable by anyone holding it.',
      );
      check(
        !/(key|secret|token|password|credential)/iu.test(
          `${key}${String(value)}`,
        ),
        `${easFile} profile ${name} sets ${key} to something that reads like a ` +
          'credential.',
      );
    }
  }
  check(
    eas.submit === undefined,
    `${easFile} declares a submit configuration. Store submission is owned by ` +
      'a person with a Play Console account, not by this repository.',
  );
}

/* ------------------------------------------------------------------- main */

async function main() {
  process.stdout.write(
    'Regenerating the Android project from app.config.ts…\n',
  );
  regenerate();
  const androidConfig = loadAndroidConfig();

  checkNoIosProject();
  await checkManifestAsync(androidConfig);
  checkAppGradle();
  checkGradleProperties();
  checkNativeColours();
  checkReleaseVersion();
  checkEasProfiles();

  if (failures.length > 0) {
    process.stderr.write(
      `\nThe generated Android project is not what this repository declares:\n\n`,
    );
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write('\n');
    process.exit(1);
  }

  const release = JSON.parse(readFileSync(releaseFile, 'utf8'));
  process.stdout.write(
    `Android project verified: ${applicationId} ` +
      `${release.version} (${String(release.versionCode)}), ` +
      `minSdk 24, targetSdk 36, compileSdk 36, ` +
      `${String(allowedPermissions.size)} permissions, ` +
      `${String(blockedPermissions.size)} blocked, no iOS project.\n`,
  );
}

await main();
