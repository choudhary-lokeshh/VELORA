import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates `apps/mobile/android` from a pinned template.
 *
 * `expo prebuild` on its own downloads `expo-template-bare-minimum` from the
 * registry at the moment it runs, resolving whatever the SDK tag points at.
 * The template is the entire baseline of the native project — the Gradle
 * wrapper version, the root and app build files, the manifest, the debug
 * signing block — so an unpinned fetch means two runs a week apart can produce
 * different native projects from identical source. For a repository whose
 * native project is generated rather than committed, that is the reproducibility
 * question, not a detail of it.
 *
 * So the template is an ordinary pinned devDependency, governed by the same
 * catalog and the same `minimumReleaseAge` as everything else. The version the
 * lockfile installed is read from the store, and the publisher's own tarball
 * for exactly that version is fetched once and cached.
 *
 * Repacking the installed directory would be tidier and does not work. The
 * template contains a symlink — `android/app/src/debugOptimized/AndroidManifest.xml`
 * points at the debug variant's — and whether pnpm's store holds that as a link
 * or as a real file differs by platform. On macOS it is a file and the repack
 * is fine; on Linux it is a link, and `npm pack` rewrote its target relative to
 * the tarball's own prefix, so prebuild died with `ENOENT ... link` in CI while
 * passing locally. Fetching what Expo published avoids inventing a tarball at
 * all.
 *
 * Every caller goes through here — `pnpm android:verify`, `pnpm android:build`,
 * and `pnpm --filter @velora/mobile prebuild` — so there is no second path that
 * could quietly use an unpinned template.
 */

/*
 * Anchored to this file rather than to the working directory. Two callers run
 * this from two different places — the gates from the repository root and
 * `pnpm --filter @velora/mobile prebuild` from `apps/mobile` — and a relative
 * path put the packed template at `apps/mobile/apps/mobile/.expo/…`, which is
 * outside the ignore rule and was staged for commit.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobileRoot = join(repositoryRoot, 'apps/mobile');
const templateName = 'expo-template-bare-minimum';
const packedDirectory = join(mobileRoot, '.expo/velora-template');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
    maxBuffer: 64 * 1024 * 1024,
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

/**
 * The template as a tar file, packed from the version the lockfile installed.
 *
 * The result is named for that version and reused, so a repeated prebuild does
 * not repack. It lives under `.expo/`, which is already ignored, because it is
 * derived from a dependency and belongs in the tree no more than `node_modules`
 * does.
 */
export function packPinnedTemplate() {
  const fromMobile = createRequire(join(mobileRoot, 'package.json'));
  let manifestPath;
  try {
    manifestPath = fromMobile.resolve(`${templateName}/package.json`);
  } catch {
    fail(
      `${templateName} is not installed. It is a pinned devDependency of ` +
        '@velora/mobile so that the generated Android project is reproducible; ' +
        'run `pnpm install`.',
    );
  }
  // The lockfile decides the version; nothing here chooses one. Reading it from
  // the installed package is what keeps the catalog and the release-age policy
  // in charge of which template a prebuild uses.
  const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
  const packed = join(packedDirectory, `${templateName}-${version}.tgz`);
  if (existsSync(packed)) return packed;

  mkdirSync(packedDirectory, { recursive: true });
  const result = run(
    'npm',
    [
      'pack',
      `${templateName}@${version}`,
      '--pack-destination',
      packedDirectory,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0) {
    process.stderr.write(result.output);
    fail(
      `Could not fetch ${templateName}@${version}. The version is pinned by ` +
        'the lockfile; this only downloads the tarball Expo published for it.',
    );
  }
  if (!existsSync(packed)) {
    fail(`npm pack did not produce ${packed}`);
  }
  return packed;
}

export function prebuildAndroid() {
  const template = packPinnedTemplate();
  return run(
    'pnpm',
    [
      '--filter',
      '@velora/mobile',
      'exec',
      'expo',
      'prebuild',
      '--platform',
      'android',
      '--clean',
      '--no-install',
      '--template',
      template,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

// Also runnable on its own, which is what `pnpm --filter @velora/mobile
// prebuild` does.
if (process.argv[1]?.endsWith('prebuild-android.mjs') === true) {
  const result = prebuildAndroid();
  process.stdout.write(result.output);
  if (result.status !== 0) process.exit(1);
}
