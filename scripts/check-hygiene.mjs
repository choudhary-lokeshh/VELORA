import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const failures = [];
const ignoredTextChecks = new Set(['pnpm-lock.yaml']);

let checked = 0;
for (const file of files) {
  // A path in the index that is not on disk is a deletion the working tree has
  // made and nobody has staged yet. It has no contents to have hygiene, and
  // reading it would abort the whole check over a file that is on its way out.
  if (!existsSync(file)) continue;
  checked += 1;
  const stat = statSync(file);
  if (stat.size > 5_000_000) {
    failures.push(`${file}: file exceeds 5 MB repository hygiene limit`);
    continue;
  }
  if (ignoredTextChecks.has(file)) continue;
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  if (text.length > 0 && !text.endsWith('\n')) {
    failures.push(`${file}: missing final newline`);
  }
  if (/[ \t]+$/mu.test(text)) {
    failures.push(`${file}: trailing whitespace`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(
    `Repository hygiene passed for ${checked} tracked/untracked files.`,
  );
}
