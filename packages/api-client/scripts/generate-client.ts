import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openApiPath = resolve(
  packageRoot,
  '../validation/openapi/velora.v1.json',
);
const outputPath = resolve(packageRoot, 'src/generated/schema.ts');
const nodes = await openapiTS(pathToFileURL(openApiPath));
const output = `${astToString(nodes)}\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== output) {
    console.error(
      'API client output is missing or stale. Run pnpm contracts:generate.',
    );
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
}
