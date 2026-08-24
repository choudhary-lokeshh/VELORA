import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Whether this machine can build the Android application, and exactly what is
 * missing when it cannot.
 *
 * A native Android build needs four things this repository does not and should
 * not vendor: a JDK, the Android SDK platform it compiles against, the build
 * tools that package it, and the NDK its C++ dependencies are compiled with.
 * They are large, they are licensed, and they live outside the workspace, so
 * `mise install` cannot provision them the way it provisions Node and Bun.
 *
 * This script therefore does one thing: it reports the truth about the machine
 * it runs on, in enough detail to act on. It installs nothing, it downloads
 * nothing, and it changes no environment variable — a build tool that quietly
 * fixes the machine is a build tool whose output nobody can reproduce.
 *
 * The required versions are not restated here. They are read from
 * `react-native`'s own Gradle version catalog and from the Expo build
 * properties in `apps/mobile/app.config.ts`, so a dependency bump that moves
 * the compile level moves this check with it.
 *
 * Exit codes: 0 when the toolchain is complete, 1 when something is missing.
 * `--quiet` prints only failures, which is what the build driver wants.
 */

const appConfigFile = 'apps/mobile/app.config.ts';
const quiet = process.argv.includes('--quiet');

const notes = [];
const problems = [];

function note(message) {
  notes.push(message);
}

function problem(what, remedy) {
  problems.push({ remedy, what });
}

function readBuildProperty(name) {
  const source = readFileSync(appConfigFile, 'utf8');
  const found = new RegExp(`\\n\\s+${name}: '?([\\w.]+)'?,`, 'u').exec(source);
  if (found === null) {
    throw new Error(`${appConfigFile} declares no ${name}`);
  }
  return found[1];
}

/** The NDK the installed React Native asks for, from its own version catalog. */
function readRequiredNdk() {
  const candidates = readdirSync('node_modules/.pnpm').filter((entry) =>
    entry.startsWith('react-native@'),
  );
  for (const candidate of candidates) {
    const file = join(
      'node_modules/.pnpm',
      candidate,
      'node_modules/react-native/gradle/libs.versions.toml',
    );
    if (!existsSync(file)) continue;
    const found = /^ndkVersion = "([\d.]+)"$/mu.exec(
      readFileSync(file, 'utf8'),
    );
    if (found !== null) return found[1];
  }
  throw new Error(
    'Could not read ndkVersion from react-native; run pnpm install first',
  );
}

function resolveJavaHome() {
  const declared = process.env.JAVA_HOME;
  if (declared !== undefined && declared !== '' && existsSync(declared)) {
    return declared;
  }
  return undefined;
}

function javaMajorVersion(javaHome) {
  const binary = javaHome === undefined ? 'java' : join(javaHome, 'bin/java');
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) return undefined;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const found = /version "(\d+)(?:\.(\d+))?/u.exec(output);
  if (found === null) return undefined;
  const major = Number(found[1]);
  // Java 8 and earlier report `1.8.0_x`; nothing here supports them anyway.
  return major === 1 ? Number(found[2] ?? 0) : major;
}

function resolveAndroidHome() {
  for (const name of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const value = process.env[name];
    if (value !== undefined && value !== '' && existsSync(value)) {
      return { source: name, value };
    }
  }
  const conventional =
    process.platform === 'darwin'
      ? join(homedir(), 'Library/Android/sdk')
      : join(homedir(), 'Android/Sdk');
  if (existsSync(conventional)) {
    return { source: 'the platform default location', value: conventional };
  }
  return undefined;
}

function main() {
  const compileSdk = readBuildProperty('compileSdkVersion');
  const buildTools = readBuildProperty('buildToolsVersion');
  const requiredNdk = readRequiredNdk();

  // ---------------------------------------------------------------- Java
  const javaHome = resolveJavaHome();
  const major = javaMajorVersion(javaHome);
  const minimumJava = 17;
  if (major === undefined) {
    problem(
      'No Java runtime was found.',
      `Install JDK ${String(minimumJava)} or later and set JAVA_HOME. ` +
        'With the toolchain provisioner this repository already uses: ' +
        `\`mise install java@temurin-${String(minimumJava)}\` then ` +
        `\`export JAVA_HOME="$(mise where java@temurin-${String(minimumJava)})"\`.`,
    );
  } else if (major < minimumJava) {
    problem(
      `Java ${String(major)} is installed; the Android Gradle Plugin needs ${String(minimumJava)} or later.`,
      `Install JDK ${String(minimumJava)} and point JAVA_HOME at it.`,
    );
  } else {
    note(`Java ${String(major)} at ${javaHome ?? 'the default java on PATH'}`);
  }

  // ----------------------------------------------------------- Android SDK
  const androidHome = resolveAndroidHome();
  if (androidHome === undefined) {
    problem(
      'No Android SDK was found.',
      'Install the command-line tools from ' +
        'https://developer.android.com/studio#command-line-tools-only into ' +
        `${join(homedir(), 'Library/Android/sdk/cmdline-tools/latest')} (macOS) or ` +
        `${join(homedir(), 'Android/Sdk/cmdline-tools/latest')} (Linux), then set ANDROID_HOME. ` +
        'See docs/engineering/11-android-native-build.md.',
    );
    report();
    return;
  }
  note(`Android SDK at ${androidHome.value}, from ${androidHome.source}`);

  const components = [
    {
      hint: `sdkmanager "platforms;android-${compileSdk}"`,
      path: join(androidHome.value, 'platforms', `android-${compileSdk}`),
      what: `Android platform ${compileSdk}`,
    },
    {
      hint: `sdkmanager "build-tools;${buildTools}"`,
      path: join(androidHome.value, 'build-tools', buildTools),
      what: `Build tools ${buildTools}`,
    },
    {
      hint: `sdkmanager "ndk;${requiredNdk}"`,
      path: join(androidHome.value, 'ndk', requiredNdk),
      what: `NDK ${requiredNdk}`,
    },
    {
      hint: 'sdkmanager "platform-tools"',
      path: join(androidHome.value, 'platform-tools'),
      what: 'Platform tools (adb)',
    },
  ];

  for (const component of components) {
    // `source.properties` is the receipt `sdkmanager` writes only once a
    // package has finished unpacking. The directory alone proves nothing: an
    // install that runs out of disk halfway leaves the directory behind and
    // nothing in it, and this check passed on exactly that before it read the
    // receipt instead.
    const receipt = join(component.path, 'source.properties');
    if (!existsSync(component.path)) {
      problem(
        `${component.what} is not installed.`,
        `Run \`${component.hint}\` with ANDROID_HOME=${androidHome.value}.`,
      );
    } else if (!existsSync(receipt)) {
      problem(
        `${component.what} is present but incomplete — ${component.path} has no source.properties.`,
        `An interrupted or out-of-disk install leaves this behind. Delete the ` +
          `directory and run \`${component.hint}\` again.`,
      );
    } else {
      note(`${component.what} at ${component.path}`);
    }
  }

  const licences = join(androidHome.value, 'licenses');
  if (!existsSync(licences)) {
    problem(
      'No accepted Android SDK licences were found.',
      'Run `sdkmanager --licenses` and accept them. Gradle refuses to ' +
        'download anything until they are accepted.',
    );
  }

  report();
}

function report() {
  if (!quiet) {
    for (const entry of notes) process.stdout.write(`  ok    ${entry}\n`);
  }
  if (problems.length === 0) {
    if (!quiet) {
      process.stdout.write(
        '\nAndroid build toolchain complete. `pnpm android:build` can run here.\n',
      );
    }
    return;
  }
  process.stderr.write(
    '\nThis machine cannot build the Android application.\n\n',
  );
  for (const entry of problems) {
    process.stderr.write(`  ${entry.what}\n      ${entry.remedy}\n\n`);
  }
  process.stderr.write(
    'Nothing was installed or changed. See docs/engineering/11-android-native-build.md.\n',
  );
  process.exit(1);
}

main();
