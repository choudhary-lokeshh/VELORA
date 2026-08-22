import { copyFileSync, existsSync } from 'node:fs';

/**
 * Creates the local environment file from the template, once.
 *
 * The template is the only place variable names are declared, so a developer
 * starting out should never have to invent one. What this deliberately does not
 * do is decide anything: it copies, it never merges, it never overwrites, and
 * it never generates a secret. An existing `.env` holds real local values —
 * possibly a database somebody has data in — and replacing it silently to
 * "fix" a drifted file would destroy that.
 *
 * Local development only. Staging and production take configuration from the
 * runtime secret manager per ADR-0014 and read no file in the repository.
 */

const templatePath = '.env.example';
const environmentPath = '.env';

if (process.env.CI !== undefined) {
  console.error(
    'bootstrap-local-env is for local development; CI supplies configuration directly.',
  );
  process.exitCode = 1;
} else if (!existsSync(templatePath)) {
  console.error(`${templatePath} is missing; nothing to copy from.`);
  process.exitCode = 1;
} else if (existsSync(environmentPath)) {
  // Not a failure. The common case is running bootstrap again on a machine that
  // is already set up, and the correct answer there is to change nothing.
  console.log(
    `${environmentPath} already exists and was left untouched. Compare it against ${templatePath} if a new field was added.`,
  );
} else {
  copyFileSync(templatePath, environmentPath);
  console.log(
    `Created ${environmentPath} from ${templatePath}. It holds safe local values only and is never committed.`,
  );
}
