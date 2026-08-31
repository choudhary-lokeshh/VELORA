import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Binds the configuration schema, the environment template, and the
 * configuration document to each other.
 *
 * Twenty fields once existed in `packages/config/src/server.ts` and in no
 * template and no document, which is how a developer ends up inventing a
 * variable name that already exists under another spelling. Nothing detected
 * that, because nothing was comparing the three. This does.
 *
 * It never asserts what a value should be. `packages/config` owns validation,
 * and a second opinion about a value here would be a weaker copy of it. What
 * this owns is coverage: every field the runtime reads is discoverable, every
 * templated field is one the runtime actually understands, and no secret wears
 * a client-public prefix.
 */

const schemaPath = 'packages/config/src/server.ts';
const templatePath = '.env.example';
const documentPath = 'docs/engineering/07-configuration-environments.md';

/**
 * Environment variables Velora reads that are not server configuration fields,
 * and that a developer still has to set. Each must appear in the template and
 * in the document, exactly like a schema field.
 */
const templatedNonSchemaKeys = new Map([
  ['EXPO_PUBLIC_API_BASE_URL', 'Consumer Mobile bundle'],
  ['EXPO_PUBLIC_APP_ENV', 'Consumer Mobile bundle'],
  ['VELORA_APP_ENV', 'Next.js surfaces at request time'],
  ['VELORA_BIND_HOST', 'Next.js dev and standalone start scripts'],
  ['VELORA_MEDIA_DELIVERY_ORIGIN', 'Next.js surfaces at request time'],
  ['VELORA_POSTGRES_PORT', 'local Docker Compose host port'],
  ['VELORA_REDIS_PORT', 'local Docker Compose host port'],
]);

/**
 * Environment variables supplied by a harness, a runtime, or a CI provider.
 * Nobody sets one by hand, so putting one in the template would invite somebody
 * to try. They must stay out of it.
 */
const internalKeys = new Map([
  [
    'ANDROID_HOME',
    'where a machine keeps its Android SDK; read by the Android toolchain scripts',
  ],
  ['ANDROID_SDK_ROOT', 'the older spelling of ANDROID_HOME'],
  ['CI', 'set by the CI provider; read by playwright.config.ts'],
  ['EXPO_NO_TELEMETRY', 'set by the Android scripts when they invoke Expo'],
  [
    'JAVA_HOME',
    'where a machine keeps its JDK; read by the Android toolchain scripts',
  ],
  ['NODE_ENV', 'set by Next.js and the test runners'],
  [
    'VELORA_DEV_ORIGIN_HOSTS',
    'set by `start-local-development.mjs --domains`; read by each surface next.config.ts',
  ],
  ['STABILITY_ITERATIONS', 'scripts/rtc-stability-proof.mjs argument'],
  ['STABILITY_OUTPUT_DIRECTORY', 'scripts/rtc-stability-proof.mjs argument'],
  ['TEST_DATABASE_URL', 'injected by the integration harness per run'],
  ['TEST_REDIS_CONTAINER_ID', 'injected by the integration harness per run'],
  ['TEST_REDIS_HOST', 'injected by the integration harness per run'],
  ['TEST_REDIS_PORT', 'injected by the integration harness per run'],
  ['TEST_REDIS_URL', 'injected by the integration harness per run'],
]);

/**
 * The only two variables that may carry a client-public prefix.
 *
 * `EXPO_PUBLIC_` values are compiled into the shipped mobile bundle and are
 * readable by anyone holding the app, so this list is the boundary between a
 * deliberate public value and a published secret. `NEXT_PUBLIC_` appears here
 * not at all: the Next.js surfaces resolve their API origin at request time on
 * purpose, so one build artifact serves every environment.
 */
const publicPrefixes = ['EXPO_PUBLIC_', 'NEXT_PUBLIC_'];
const allowedPublicKeys = new Set([
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_APP_ENV',
]);

const sourceRoots = ['apps', 'packages', 'scripts', 'e2e'];
const sourceExtensions = new Set(['.ts', '.tsx', '.mjs', '.js']);
const skippedDirectories = new Set([
  '.expo',
  '.next',
  '.turbo',
  'dist',
  'generated',
  'node_modules',
]);

const failures = [];

function readServerConfigKeys() {
  const source = readFileSync(schemaPath, 'utf8');
  const start = source.indexOf('export const serverConfigSchema = z');
  const end = source.indexOf('\n  .superRefine(', start);
  if (start < 0 || end < 0) {
    throw new Error(
      `${schemaPath}: could not locate the serverConfigSchema object literal`,
    );
  }
  const keys = [
    ...source.slice(start, end).matchAll(/^ {4}([A-Z][A-Z0-9_]*):/gmu),
  ].map((match) => match[1]);
  if (keys.length === 0) {
    throw new Error(`${schemaPath}: serverConfigSchema declared no fields`);
  }
  return new Set(keys);
}

function readTemplateKeys() {
  const keys = new Set();
  for (const line of readFileSync(templatePath, 'utf8').split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function readTemplateValues() {
  const values = new Map();
  for (const line of readFileSync(templatePath, 'utf8').split('\n')) {
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    values.set(key, line.slice(separator + 1));
  }
  return values;
}

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) continue;
      yield* sourceFiles(path);
      continue;
    }
    if (sourceExtensions.has(extname(entry.name))) yield path;
  }
}

/** Every named read of the process environment, dotted or bracketed. */
function readEnvironmentReads() {
  const reads = new Map();
  for (const root of sourceRoots) {
    for (const file of sourceFiles(root)) {
      if (statSync(file).size > 2_000_000) continue;
      const content = readFileSync(file, 'utf8');
      const pattern =
        /(?:process|Bun)\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\])/gu;
      for (const match of content.matchAll(pattern)) {
        const name = match[1] ?? match[2];
        if (!reads.has(name)) reads.set(name, file);
      }
    }
  }
  return reads;
}

const schemaKeys = readServerConfigKeys();
const templateKeys = readTemplateKeys();
const templateValues = readTemplateValues();
const documentText = readFileSync(documentPath, 'utf8');
const environmentReads = readEnvironmentReads();

/**
 * Local-environment value requirements.
 *
 * These are the specific template values that must be set for local product
 * flows to work. Coverage checks above ensure the key exists; this ensures it
 * holds the value the local flow requires.
 *
 * ADR-0032 (virtual gifting) requires local-test billing adapters. The four
 * values here must stay local-test or `bun run dev:seed` returns 503 on every
 * gift catalog provision call — the exact regression this guard prevents.
 * Staging and production already reject these values unconditionally in
 * packages/config/src/server.ts, so this guard does not weaken the production
 * fail-closed invariant.
 */
const requiredTemplateValues = new Map([
  ['BILLING_COMMERCE_ELIGIBILITY', 'local-test'],
  ['BILLING_COMMERCE_POLICY', 'local-test'],
  ['BILLING_PAYMENT_PROVIDER', 'local-test'],
  ['BILLING_TAX_AUTHORITY', 'local-test'],
]);

const expectedTemplateKeys = new Set([
  ...schemaKeys,
  ...templatedNonSchemaKeys.keys(),
]);

for (const key of expectedTemplateKeys) {
  if (!templateKeys.has(key)) {
    failures.push(
      `${templatePath}: ${key} is read at runtime and has no template entry`,
    );
  }
  if (!documentText.includes(`\`${key}\``)) {
    failures.push(`${documentPath}: ${key} is not documented`);
  }
}

for (const key of templateKeys) {
  if (expectedTemplateKeys.has(key)) continue;
  const internal = internalKeys.get(key);
  failures.push(
    internal === undefined
      ? `${templatePath}: ${key} is not a configuration field the runtime reads`
      : `${templatePath}: ${key} is ${internal} and must not be templated`,
  );
}

for (const key of [
  ...expectedTemplateKeys,
  ...templateKeys,
  ...environmentReads.keys(),
]) {
  if (!publicPrefixes.some((prefix) => key.startsWith(prefix))) continue;
  if (allowedPublicKeys.has(key)) continue;
  failures.push(
    `${key}: a client-public prefix publishes this value in a shipped bundle; add it to allowedPublicKeys only if that is intended`,
  );
}

for (const [key, file] of environmentReads) {
  if (expectedTemplateKeys.has(key)) continue;
  if (internalKeys.has(key)) continue;
  failures.push(
    `${file}: reads ${key}, which is in no schema, template, or internal list`,
  );
}

// A schema field nothing reads is dead configuration, but the loader reads the
// whole object at once, so absence from this scan proves nothing. Only the
// non-schema keys can be checked that way, and every one of them is a field a
// human sets for code that does read it, so they are checked above instead.

for (const [key, required] of requiredTemplateValues) {
  const actual = templateValues.get(key);
  if (actual !== required) {
    failures.push(
      `${templatePath}: ${key} must be '${required}' in the local template (found '${actual ?? '(missing)'}'); ` +
        `see ADR-0032 — local gifting requires this adapter, and staging/production already refuse it unconditionally`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(
    `Environment template covers ${String(schemaKeys.size)} configuration fields and ${String(templatedNonSchemaKeys.size)} surface variables.`,
  );
}
