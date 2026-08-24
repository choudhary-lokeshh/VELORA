import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Proves every workspace package exposes what its `package.json` promises.
 *
 * A package here publishes itself through `exports` targets under `dist/`, and
 * `dist/` is not committed. Nothing was comparing the promise to the artifact,
 * so two failures could reach a developer's terminal as the same unhelpful
 * `Cannot find module '@velora/validation'`: a `dist/` that was never built,
 * and a `dist/` that was built without the subpath a package advertises.
 *
 * This resolves each target the way a runtime does — a real dynamic `import()`
 * of the file the export map names — so a file that exists but throws on load
 * fails here rather than three services later. Types are checked for presence
 * only; `tsc` is the authority on whether they are correct.
 *
 * It asserts nothing about what a package should export. The export map is the
 * declaration and this only holds it to it, which is what keeps the check
 * useful when a package legitimately grows a new entry point.
 */

const packagesDirectory = 'packages';
const failures = [];
let verified = 0;

const packageNames = readdirSync(packagesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const packageName of packageNames) {
  const manifestPath = join(packagesDirectory, packageName, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const exported = manifest.exports;

  if (exported === undefined) {
    failures.push(
      `${manifestPath} declares no exports, so nothing can import it by name`,
    );
    continue;
  }

  for (const [subpath, target] of Object.entries(exported)) {
    // Only the conditions this repository actually publishes. A package that
    // grows `require` or `default` should be added here deliberately rather
    // than checked by a loop that silently accepts whatever it finds.
    for (const condition of ['import', 'types']) {
      const relative = target[condition];
      if (relative === undefined) {
        failures.push(
          `${manifest.name} ${subpath} declares no "${condition}" target`,
        );
        continue;
      }
      const absolute = resolve(packagesDirectory, packageName, relative);
      if (condition === 'types') {
        try {
          readFileSync(absolute);
          verified += 1;
        } catch {
          failures.push(
            `${manifest.name} ${subpath} types target is missing: ${relative}`,
          );
        }
        continue;
      }
      try {
        await import(pathToFileURL(absolute).href);
        verified += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${manifest.name} ${subpath} did not import: ${reason}`);
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error(
    '\nBuild the workspace libraries with `pnpm turbo run build --filter=./packages/*`.',
  );
  process.exitCode = 1;
} else {
  console.log(
    `Workspace entry points verified: ${String(verified)} targets across ${String(packageNames.length)} packages.`,
  );
}
