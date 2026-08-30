import { readFileSync } from 'node:fs';

/**
 * Every header the contract asks a browser to send must be one CORS allows.
 *
 * A custom request header makes a cross-origin request preflighted. If the
 * API's `access-control-allow-headers` does not name it, the browser never
 * sends the request at all — and what the surface reports is that VELORA could
 * not be reached, which is indistinguishable from the API being down.
 *
 * This has happened once already. `x-velora-idempotency-key` was absent from
 * the allowlist, and every jsdom suite in the repository passed throughout,
 * because a `fetch` double has no preflight. Nothing short of a real browser
 * talking to a real API across two origins could observe it, and no test does
 * that for every operation.
 *
 * So it is checked as a statement rather than exercised as a behaviour: the
 * generated OpenAPI document is the authority on what a client is asked to
 * send, `apps/api/src/http/cors.ts` is the authority on what is allowed, and
 * this fails when they disagree. That is the same reasoning `check-design-parity`
 * uses for two applications' palettes — it is a claim about two things agreeing,
 * which is nobody's unit test, and reading another workspace's source is exactly
 * what an application may not do.
 *
 * Both directions are checked. A header the contract declares and CORS omits is
 * a request no browser will make. A `x-velora-*` header CORS allows and no
 * operation declares is an allowance nothing needs, which is a small permission
 * granted for no reason and worth removing rather than carrying.
 */

const contractFile = 'packages/validation/openapi/velora.v1.json';
const corsFile = 'apps/api/src/http/cors.ts';

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    fail(`${path} could not be read`);
    return '';
  }
}

/* ========================= What the contract asks for ================ */

/** Every request header the document declares, and one operation using it. */
function declaredHeaders(source) {
  const declared = new Map();
  if (source === '') return declared;
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    fail(`${contractFile} is not readable JSON`);
    return declared;
  }
  for (const [path, operations] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (operation === null || typeof operation !== 'object') continue;
      for (const parameter of operation.parameters ?? []) {
        if (parameter?.in !== 'header') continue;
        if (!declared.has(parameter.name)) {
          declared.set(parameter.name, `${method.toUpperCase()} ${path}`);
        }
      }
    }
  }
  return declared;
}

/* ============================ What CORS allows ======================= */

/**
 * The allowlist, read by shape rather than by import.
 *
 * The entries are a mix of literals and imported constants, so each constant is
 * resolved back to the string `@velora/validation` publishes for it. A name this
 * cannot resolve is reported rather than skipped: silently ignoring an entry
 * would turn this check into one that cannot fail for exactly the header
 * somebody just added.
 */
function allowedHeaders(source) {
  const allowed = new Set();
  const block =
    /export const allowedRequestHeaderNames = \[([\s\S]*?)\] as const;/u.exec(
      source,
    );
  if (block === null) {
    fail(`${corsFile} no longer holds the allowlist in the expected shape`);
    return allowed;
  }
  const body = block[1]
    // Comments hold prose about headers; nothing in them is an entry.
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .replaceAll(/\/\/[^\n]*/gu, '');
  for (const entry of body.split(',')) {
    const name = entry.trim();
    if (name === '') continue;
    const literal = /^'([^']+)'$/u.exec(name);
    if (literal !== null) {
      allowed.add(literal[1].toLowerCase());
      continue;
    }
    const resolved = constantValue(name);
    if (resolved === undefined) {
      fail(`${corsFile} allows ${name}, which this check cannot resolve`);
      continue;
    }
    allowed.add(resolved.toLowerCase());
  }
  return allowed;
}

/** The string a `@velora/validation` header constant is declared as. */
function constantValue(name) {
  for (const path of [
    'packages/validation/src/auth.ts',
    'packages/validation/src/admin.ts',
    'packages/validation/src/product.ts',
    'packages/validation/src/index.ts',
  ]) {
    const found = new RegExp(`export const ${name} =\\s*'([^']+)'`, 'u').exec(
      readFileSync(path, 'utf8'),
    );
    if (found !== null) return found[1];
  }
  return undefined;
}

/* ================================ Compare ============================ */

const declared = declaredHeaders(read(contractFile));
const allowed = allowedHeaders(read(corsFile));

if (declared.size === 0) {
  fail(`${contractFile} declared no request headers, which cannot be right`);
}

for (const [name, operation] of declared) {
  if (!allowed.has(name.toLowerCase())) {
    fail(
      `the contract asks a client to send ${name} on ${operation}, and CORS does not allow it — a browser will not send the request at all`,
    );
  }
}

for (const name of allowed) {
  if (!name.startsWith('x-velora-')) continue;
  if (![...declared.keys()].some((each) => each.toLowerCase() === name)) {
    fail(`CORS allows ${name} and no operation declares it`);
  }
}

/* ================================ Result ============================= */

if (failures.length > 0) {
  process.stderr.write('The contract and CORS disagree:\n');
  for (const failure of failures) {
    process.stderr.write(`  ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `Every contract request header is allowed cross-origin: ${String(declared.size)} declared, ${String(allowed.size)} allowed.\n`,
);
