import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationName = process.argv[2];
if (!applicationName) {
  throw new Error('Application name is required');
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const applicationRoot = resolve(repositoryRoot, 'apps', applicationName);
const standaloneRoot = resolve(
  applicationRoot,
  '.next/standalone/apps',
  applicationName,
);

await mkdir(resolve(standaloneRoot, '.next'), { recursive: true });
await cp(
  resolve(applicationRoot, '.next/static'),
  resolve(standaloneRoot, '.next/static'),
  { recursive: true },
);

const publicDirectory = resolve(applicationRoot, 'public');
if (await stat(publicDirectory).catch(() => undefined)) {
  await cp(publicDirectory, resolve(standaloneRoot, 'public'), {
    recursive: true,
  });
}
