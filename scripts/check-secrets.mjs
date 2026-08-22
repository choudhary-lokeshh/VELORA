import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

const failures = [];
for (const file of files) {
  if (!existsSync(file) || file === 'pnpm-lock.yaml') continue;
  // Any path, not just the repository root: an `apps/api/.env` is exactly as
  // committed as a root one, and anchoring this to the root is how one gets
  // missed. The single root template is the one exemption, so a second
  // `.env.example` beside an application fails here rather than becoming a
  // parallel place to declare configuration.
  if (/(?:^|\/)\.env(?:\.|$)/u.test(file) && file !== '.env.example') {
    failures.push(
      `${file}: environment files must not be tracked; the only template is .env.example at the repository root`,
    );
    continue;
  }
  const content = readFileSync(file, 'utf8');
  if (patterns.some((pattern) => pattern.test(content))) {
    failures.push(`${file}: possible secret`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${files.length} files.`);
}
