import { rmSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

// `tsc` and `bun build` write into an output directory but never prune it, so
// a source file that is deleted or renamed leaves a stale artifact behind that
// still resolves and still contains its old symbols. Builds clean first.

const [target] = process.argv.slice(2);
if (target === undefined || target.length === 0) {
  console.error('usage: node scripts/clean-build-output.mjs <directory>');
  process.exitCode = 1;
} else if (isAbsolute(target) || normalize(target).startsWith('..')) {
  console.error(
    `refusing to clean ${target}: only a path inside the current package may be removed`,
  );
  process.exitCode = 1;
} else {
  const directory = resolve(process.cwd(), target);
  rmSync(directory, { force: true, recursive: true });
  console.log(`Cleaned ${join(relative(process.cwd(), directory) || target)}.`);
}
