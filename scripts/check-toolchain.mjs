import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

function commandVersion(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function readPinFile(path) {
  return readFileSync(path, 'utf8').trim();
}

// mise.toml is the provisioning authority. package.json#engines is the
// enforcement authority. `.node-version`/`.bun-version` exist for editors and
// other tooling that read them. All four must agree or a checkout can be
// provisioned with a runtime the gate would reject.
function miseToolVersions(source) {
  const versions = {};
  let inTools = false;
  let sawTools = false;
  for (const line of source.split('\n')) {
    const heading = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
    if (heading) {
      inTools = heading[1] === 'tools';
      sawTools ||= inTools;
      continue;
    }
    if (!inTools) continue;
    const entry = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"\s*$/u.exec(line);
    if (entry) versions[entry[1]] = entry[2];
  }
  if (!sawTools) throw new Error('mise.toml must declare a [tools] section');
  return versions;
}

const actual = {
  bun: commandVersion('bun', ['--version']),
  node: process.versions.node,
  pnpm: commandVersion('pnpm', ['--version']),
};
const expected = manifest.engines;
const failures = Object.entries(expected)
  .filter(([name, version]) => actual[name] !== version)
  .map(
    ([name, version]) =>
      `${name} must be ${version}; found ${actual[name] ?? 'missing'}`,
  );

if (manifest.packageManager !== `pnpm@${expected.pnpm}`) {
  failures.push('packageManager must match engines.pnpm');
}

const declared = {
  ...miseToolVersions(readFileSync('mise.toml', 'utf8')),
  '.bun-version': readPinFile('.bun-version'),
  '.node-version': readPinFile('.node-version'),
};
for (const [source, engine] of [
  ['bun', 'bun'],
  ['node', 'node'],
  ['pnpm', 'pnpm'],
  ['.bun-version', 'bun'],
  ['.node-version', 'node'],
]) {
  if (declared[source] !== expected[engine]) {
    failures.push(
      `${source} pins ${declared[source] ?? 'nothing'} but engines.${engine} is ${expected[engine]}`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(
    `Toolchain verified: Bun ${actual.bun}, Node ${actual.node}, pnpm ${actual.pnpm}.`,
  );
}
