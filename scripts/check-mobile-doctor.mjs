import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * The mobile surface's project check, bounded so that one external release
 * cannot turn the only gate red on its own.
 *
 * `expo-doctor` runs twenty checks. Nineteen are static properties of this
 * repository: a malformed app config, a native module that does not belong in a
 * managed project, a peer dependency that is genuinely missing. They fail
 * because something here is wrong, and they block unconditionally.
 *
 * The twentieth — "Check that packages match versions required by installed
 * Expo SDK" — is different in kind. It compares the pinned versions against a
 * version map `expo-doctor` fetches at run time, so publishing a patch to npm
 * changes its answer with no commit here at all. That alone would be tolerable.
 * What makes it a defect is that its remedy is forbidden: `minimumReleaseAge`
 * in `pnpm-workspace.yaml` refuses any package published inside the policy
 * window, so for the whole of that window the repository is required to install
 * a version it is simultaneously forbidden to install. It happened three times
 * in six days on the Expo SDK 57 patch line, and `docs/security/09-dependency-age-blockers.md`
 * records each one.
 *
 * This script resolves that contradiction in favour of the stricter control,
 * and only for exactly as long as the contradiction exists:
 *
 * - Every other check blocks, always. Nothing about them is deferred.
 * - The version check blocks whenever the versions it wants are installable —
 *   old enough under the policy, or carrying an owner-authorized exact-version
 *   exclusion. An upgrade that is merely inconvenient still fails the gate.
 * - It defers only while every version it wants is younger than the policy
 *   allows, and it reports the exact instant each one becomes installable and
 *   the gate resumes blocking.
 * - Anything it cannot attribute — an unparseable report, a version the
 *   registry does not know, an unreachable registry — fails closed.
 *
 * This is narrower than it could be and still a real narrowing: for up to the
 * policy window after an Expo patch, the gate does not enforce currency with
 * that patch. That is a deliberate decision recorded in
 * [ADR-0018](../docs/decisions/ADR-0018-toolchain-provisioning-verification-ci.md),
 * not an omission. The alternative on the table was a third release-age
 * override in six days, which would have bought the same time by reducing the
 * observation window on real packages instead.
 */

const workspaceManifestPath = 'pnpm-workspace.yaml';
const mobileFilter = '@velora/mobile';
const registryOrigin = 'https://registry.npmjs.org';
const registryTimeoutMilliseconds = 15_000;

const exactVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const packageNamePattern = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/u;
/** `name  ~1.2.3  1.2.2`, as the report's mismatch tables are laid out. */
const mismatchRowPattern =
  /^\s{0,8}(@?[A-Za-z0-9][\w./-]*)[ \t]+([~^]?\d+\.\d+\.\d+[\w.+-]*)[ \t]+(\S+)[ \t]*$/u;
// eslint-disable-next-line no-control-regex -- stripping terminal styling is the point
const ansiPattern = /\u001B\[[0-9;]*m/gu;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function stripAnsi(value) {
  return value.replace(ansiPattern, '');
}

/**
 * The release-age policy, read from the file that enforces it.
 *
 * Restating the number here would let the gate keep deferring against a window
 * the policy no longer has, which is precisely the drift this reads to avoid.
 */
function readReleaseAgePolicy() {
  let manifest;
  try {
    manifest = readFileSync(workspaceManifestPath, 'utf8');
  } catch {
    fail(`Cannot read ${workspaceManifestPath}`);
  }

  const declared = /^minimumReleaseAge:[ \t]*(\d+)[ \t]*$/mu.exec(manifest);
  if (declared === null) {
    fail(
      `${workspaceManifestPath} declares no minimumReleaseAge; refusing to guess one`,
    );
  }
  const minutes = Number.parseInt(declared[1], 10);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    fail(`${workspaceManifestPath} declares an unusable minimumReleaseAge`);
  }

  // Exact `name@version` entries only. The register forbids wildcards, so a
  // literal set comparison is the whole of what this needs to be.
  const excluded = new Set();
  const block = /^minimumReleaseAgeExclude:\n((?:[ \t]+[^\n]*\n|\n)*)/mu.exec(
    manifest,
  );
  if (block !== null) {
    for (const line of block[1].split('\n')) {
      const entry = /^[ \t]*-[ \t]*'?([^'#\s]+)'?[ \t]*$/u.exec(line);
      if (entry !== null) excluded.add(entry[1]);
    }
  }
  return { excluded, minutes };
}

function runDoctor(skipDependencyVersionCheck) {
  const environment = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };
  if (skipDependencyVersionCheck) {
    environment.EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK = '1';
  } else {
    delete environment.EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK;
  }

  const result = spawnSync(
    'pnpm',
    ['--filter', mobileFilter, 'run', 'doctor'],
    { encoding: 'utf8', env: environment, maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error !== undefined) {
    fail(`Could not run expo-doctor: ${result.error.message}`);
  }
  const output = stripAnsi(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  return { output, passed: result.status === 0 };
}

/**
 * The packages the version check wants, and the versions it wants them at.
 *
 * `expo-doctor` publishes no machine-readable report, so this reads the tables
 * it prints. An empty result is treated as a parse failure by the caller rather
 * than as "nothing was wrong", because the check has already failed by the time
 * this runs.
 */
export function parseVersionMismatches(report) {
  const mismatches = [];
  const seen = new Set();
  for (const rawLine of stripAnsi(report).split('\n')) {
    const row = mismatchRowPattern.exec(rawLine);
    if (row === null) continue;

    const [, name, expectedRange, found] = row;
    if (!packageNamePattern.test(name)) continue;

    const required = expectedRange.replace(/^[~^]/u, '');
    // A range this cannot reduce to one exact version is not something to
    // reason about an age for.
    if (!exactVersionPattern.test(required)) continue;
    if (seen.has(name)) continue;

    seen.add(name);
    mismatches.push({ found, name, required });
  }
  return mismatches;
}

async function publishedAt(name, version) {
  const url = `${registryOrigin}/${name.replace('/', '%2f')}`;
  let payload;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(registryTimeoutMilliseconds),
    });
    if (!response.ok) {
      fail(
        `Registry answered ${String(response.status)} for ${name}; cannot establish whether ${name}@${version} is installable, so the gate fails closed`,
      );
    }
    payload = await response.json();
  } catch (error) {
    fail(
      `Could not reach the registry for ${name} (${error instanceof Error ? error.message : 'unknown error'}); the gate fails closed rather than assuming a release is too new to install`,
    );
  }

  const stamp = payload?.time?.[version];
  if (typeof stamp !== 'string') {
    fail(
      `Registry has no publication time for ${name}@${version}; the gate fails closed`,
    );
  }
  const published = Date.parse(stamp);
  if (Number.isNaN(published)) {
    fail(`Registry gave an unusable publication time for ${name}@${version}`);
  }
  return published;
}

async function main() {
  const policy = readReleaseAgePolicy();

  const full = runDoctor(false);
  process.stdout.write(full.output);
  if (full.passed) return;

  // Isolate. Everything except the version check runs here, so a failure now is
  // a real defect in this repository and blocks with no further reasoning.
  const withoutVersionCheck = runDoctor(true);
  if (!withoutVersionCheck.passed) {
    process.stdout.write(withoutVersionCheck.output);
    fail(
      'expo-doctor failed a project check that has nothing to do with dependency currency. Fix the project.',
    );
  }

  const mismatches = parseVersionMismatches(full.output);
  if (mismatches.length === 0) {
    fail(
      'expo-doctor failed only its dependency-version check, but no version mismatch could be read from its report. The gate fails closed rather than deferring a failure it cannot attribute.',
    );
  }

  const now = Date.now();
  const windowMilliseconds = policy.minutes * 60_000;
  const installable = [];
  const tooNew = [];
  for (const mismatch of mismatches) {
    const published = await publishedAt(mismatch.name, mismatch.required);
    const eligible = published + windowMilliseconds;
    const excluded = policy.excluded.has(
      `${mismatch.name}@${mismatch.required}`,
    );
    const entry = { ...mismatch, eligible, excluded, published };
    if (excluded || eligible <= now) installable.push(entry);
    else tooNew.push(entry);
  }

  if (installable.length > 0) {
    process.stderr.write(
      '\nThese versions are installable now and the pins are behind them:\n',
    );
    for (const entry of installable) {
      const because = entry.excluded
        ? 'carries an authorized exact-version release-age exclusion'
        : `published ${new Date(entry.published).toISOString()}, older than the ${String(policy.minutes)}-minute policy`;
      process.stderr.write(
        `  ${entry.name}: pinned ${entry.found}, required ${entry.required} — ${because}\n`,
      );
    }
    fail(
      '\nNothing forbids this upgrade, so the gate blocks on it. Raise the pins.',
    );
  }

  const resumes = Math.max(...tooNew.map((entry) => entry.eligible));
  process.stdout.write(
    `\nexpo-doctor's dependency-version check is deferred, not passed.\n` +
      `Every version it requires is younger than the ${String(policy.minutes)}-minute minimumReleaseAge, ` +
      `so this repository is currently forbidden to install what that check demands.\n` +
      `Every other check ran and blocked normally.\n\n`,
  );
  for (const entry of tooNew) {
    process.stdout.write(
      `  ${entry.name}: pinned ${entry.found}, required ${entry.required}, ` +
        `published ${new Date(entry.published).toISOString()}, ` +
        `installable from ${new Date(entry.eligible).toISOString()}\n`,
    );
  }
  process.stdout.write(
    `\nThis check starts blocking again at ${new Date(resumes).toISOString()}. ` +
      `See docs/security/09-dependency-age-blockers.md and ADR-0018.\n`,
  );
}

await main();
