import { readFileSync } from 'node:fs';

/**
 * An override that exists to deduplicate must move with the thing it duplicates.
 *
 * `pnpm-workspace.yaml` pins `expo-constants` in `overrides` for a structural
 * reason: a native module may exist once in a build, `expo-asset` asks for
 * `~57.0.15`, and the resolver keeps an older resolution alongside the
 * catalog's — so `expo-doctor` refuses the duplicate, correctly. The pin exists
 * to collapse the tree onto the catalog's copy, and the comment beside it says
 * to raise both together.
 *
 * Nothing enforced that. Raising the catalog alone leaves the override pinning
 * the version the catalog just moved off, which is worse than no override at
 * all: it silently holds the whole tree on a stale native module, `expo-doctor`
 * stays green because there is still only one copy, and the release-age and
 * security policies are applied to a version nobody is actually installing.
 *
 * A self-retiring override is the goal — this one exists only until `expo-asset`
 * widens its range — and the way a self-retiring thing goes wrong is by
 * outliving its reason quietly.
 *
 * So every override naming a package the catalog also names must state the same
 * version. That is the whole rule. An override for something the catalog does
 * not carry is left alone: it is pinning a transitive dependency, which is a
 * different decision with different reasons.
 */

const manifest = 'pnpm-workspace.yaml';

/** The `name: version` pairs under one top-level key of the workspace file. */
function sectionEntries(source, key) {
  const entries = new Map();
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `${key}:`);
  if (start === -1) return entries;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line) && line.trim() !== '') break;
    const pair = /^\s{2}'?([^':\s]+)'?:\s*(\S+)\s*$/u.exec(line);
    if (pair !== null) entries.set(pair[1], pair[2]);
  }
  return entries;
}

const source = readFileSync(manifest, 'utf8');
const catalog = sectionEntries(source, 'catalog');
const overrides = sectionEntries(source, 'overrides');

if (catalog.size === 0) {
  process.stderr.write(
    `${manifest} published no catalog, which cannot be right\n`,
  );
  process.exit(1);
}

const drifted = [];
for (const [name, pinned] of overrides) {
  const catalogued = catalog.get(name);
  if (catalogued === undefined) continue;
  if (catalogued !== pinned) drifted.push({ catalogued, name, pinned });
}

if (drifted.length > 0) {
  process.stderr.write(
    'An override has been left behind by its catalog entry:\n',
  );
  for (const one of drifted) {
    process.stderr.write(
      `  ${one.name}: overrides pins ${one.pinned}, catalog says ${one.catalogued}\n`,
    );
  }
  process.stderr.write(
    'These overrides exist to collapse a duplicate onto the catalog copy, so a stale pin holds the whole tree on the version the catalog moved off. Raise both together.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `Every override the catalog also names agrees with it: ${String(overrides.size)} override(s) against ${String(catalog.size)} catalog entries.\n`,
);
