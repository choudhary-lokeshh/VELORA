import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const contractPath = 'packages/validation/openapi/velora.v1.json';
const expectedOperationCount = 164;
const expectedOperationDigest =
  'b890cf48d5e4147dbfd138619f0ecdd3f06d5fec33b113633f67d2393c10c6a6';
const methods = new Set(['delete', 'get', 'patch', 'post', 'put']);
const allowedClassifications = new Set([
  'ADMIN_BLOCKED',
  'PASS',
  'POLICY_BLOCKED',
  'PROVIDER_BLOCKED',
]);

const providerBlockedOperations = new Set([
  'createAiSuggestion',
  'receiveIdentityProviderEvent',
  'receiveNotificationProviderEvent',
  'receiveProviderEvent',
  'receiveRtcProviderEvent',
  'startPayoutOnboarding',
]);

const policyBlockedOperations = new Set(['requestPayout']);

function operationClassification(operation) {
  if (operation.path.startsWith('/v1/admin/')) return 'ADMIN_BLOCKED';
  if (providerBlockedOperations.has(operation.operationId)) {
    return 'PROVIDER_BLOCKED';
  }
  if (policyBlockedOperations.has(operation.operationId)) {
    return 'POLICY_BLOCKED';
  }
  return 'PASS';
}

function readOperations() {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const operations = [];

  for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method) || typeof operation.operationId !== 'string') {
        continue;
      }
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        responses: new Set(Object.keys(operation.responses ?? {})),
      });
    }
  }

  return operations.sort((left, right) =>
    left.operationId.localeCompare(right.operationId),
  );
}

function assertFrozenInventory(operations) {
  const duplicateIds = operations
    .map(({ operationId }) => operationId)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate operation ids: ${duplicateIds.join(', ')}`);
  }

  const digest = createHash('sha256')
    .update(
      operations
        .map(
          ({ method, operationId, path }) => `${operationId} ${method} ${path}`,
        )
        .join('\n'),
    )
    .digest('hex');

  if (
    operations.length !== expectedOperationCount ||
    digest !== expectedOperationDigest
  ) {
    throw new Error(
      `Runtime inventory drifted: found ${String(operations.length)} operations with digest ${digest}. Review every new or changed operation, then update the frozen count and digest.`,
    );
  }

  for (const operation of operations) {
    const classification = operationClassification(operation);
    if (!allowedClassifications.has(classification)) {
      throw new Error(
        `${operation.operationId} has invalid classification ${classification}`,
      );
    }
  }
}

function safeLoopbackBase(raw) {
  const url = new URL(raw);
  const loopback = new Set(['127.0.0.1', '::1', 'localhost']);
  if (
    url.protocol !== 'http:' ||
    !loopback.has(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(
      'Live runtime inventory accepts only an uncredentialed HTTP loopback origin.',
    );
  }
  return url;
}

async function probeOperation(base, operation) {
  const response = await fetch(new URL(operation.path, base), {
    method: operation.method,
    headers:
      operation.method === 'GET'
        ? undefined
        : { 'content-type': 'application/json' },
    body: operation.method === 'GET' ? undefined : '{}',
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });

  const status = String(response.status);
  if (!operation.responses.has(status) && !operation.responses.has('default')) {
    throw new Error(
      `${operation.operationId} returned undocumented status ${status}`,
    );
  }

  if (response.status === 500) {
    throw new Error(`${operation.operationId} returned unexplained 500`);
  }

  if (response.status > 500) {
    const classification = operationClassification(operation);
    if (classification === 'PASS') {
      throw new Error(
        `${operation.operationId} returned unexplained ${String(response.status)}`,
      );
    }
    return classification;
  }

  return response.ok ? 'PASS' : 'EXPECTED_REJECTION';
}

async function runLiveInventory(operations) {
  const baseArgument = process.argv.find((argument) =>
    argument.startsWith('--base-url='),
  );
  const base = safeLoopbackBase(
    baseArgument?.slice('--base-url='.length) ?? 'http://127.0.0.1:4000',
  );
  const outcomes = new Map();

  for (const operation of operations) {
    const outcome = await probeOperation(base, operation);
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
  }

  process.stdout.write(
    `Live runtime inventory: ${[...outcomes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([classification, count]) => `${String(count)} ${classification}`)
      .join(', ')}, 0 unexplained 500.\n`,
  );
}

const operations = readOperations();
assertFrozenInventory(operations);

const classifications = new Map();
for (const operation of operations) {
  const classification = operationClassification(operation);
  classifications.set(
    classification,
    (classifications.get(classification) ?? 0) + 1,
  );
}

process.stdout.write(
  `Runtime inventory: ${String(operations.length)} operations; ${[
    ...classifications.entries(),
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([classification, count]) => `${String(count)} ${classification}`)
    .join(', ')}.\n`,
);

if (process.argv.includes('--live')) {
  await runLiveInventory(operations);
}
