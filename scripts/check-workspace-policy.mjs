import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const failures = [];
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const config = JSON.parse(
  execFileSync('pnpm', ['config', 'list', '--json'], { encoding: 'utf8' }),
);

for (const [name, expected] of [
  ['engineStrict', true],
  ['saveExact', true],
  ['strictPeerDependencies', true],
]) {
  if (config[name] !== expected) {
    failures.push(`pnpm ${name} must be ${String(expected)}`);
  }
}

if (root.packageManager !== `pnpm@${root.engines.pnpm}`) {
  failures.push('packageManager and pnpm engine do not match');
}

const manifests = ['apps', 'packages'].flatMap((base) =>
  readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name, 'package.json')),
);

for (const file of ['package.json', ...manifests]) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (version !== 'catalog:' && !String(version).startsWith('workspace:')) {
        failures.push(
          `${file} ${section}.${name} must use catalog: or workspace:`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(
    `Workspace policy verified across ${manifests.length + 1} manifests.`,
  );
}
