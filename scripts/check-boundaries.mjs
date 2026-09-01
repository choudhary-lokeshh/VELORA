import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const workspaces = [];

for (const workspaceRoot of ['apps', 'packages']) {
  const base = join(root, workspaceRoot);
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(base, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    workspaces.push({
      kind: workspaceRoot,
      manifest,
      name: manifest.name,
      path: join(base, entry.name),
    });
  }
}

const failures = [];
const byName = new Map(
  workspaces.map((workspace) => [workspace.name, workspace]),
);
const clientSafe = new Set([
  '@velora/api-client',
  '@velora/config',
  '@velora/consumer-client',
  '@velora/creator-client',
  '@velora/design-tokens',
  '@velora/observability',
  '@velora/types',
  '@velora/validation',
]);
const forbiddenBackendNetworkDependencies = new Set([
  'axios',
  'got',
  'node-fetch',
  'superagent',
  'undici',
]);
const approvedBackendRuntimeDependencies = new Map([
  [
    '@velora/api',
    new Set([
      '@opentelemetry/api',
      '@velora/config',
      '@velora/domain',
      '@velora/observability',
      '@velora/validation',
      'bullmq',
      'drizzle-orm',
      'elysia',
      'ioredis',
      // The RTC transport SDK, in-process behind `RtcProviderPort`. It is
      // reached only from `src/realtime/livekit-provider.ts`, which is the one
      // adapter that speaks to a media provider, and it is selected by
      // configuration that refuses it in staging and production. It mints
      // tokens and calls one vendor's room API; nothing else in the repository
      // imports it, and no domain outside REALTIME may.
      'livekit-server-sdk',
      'pino',
      // The platform's image decoder and encoder, in-process behind
      // `MediaImageProcessor`. A library rather than a provider: no bytes leave
      // the machine, there is no account, and no terms of service apply. It is
      // here because every assessed hosted image processor prohibits content
      // Velora does not author — see ADR-0023 and the media provider
      // eligibility register — so the transformation has to be something the
      // platform performs itself.
      'sharp',
    ]),
  ],
  ['@velora/domain', new Set(['@velora/types'])],
]);
const forbiddenNetworkModules =
  /^(?:node:)?(?:dgram|http|http2|https|net|tls)(?:\/|$)|^undici(?:\/|$)/u;

function internalDependencies(workspace) {
  return [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ].flatMap((section) =>
    Object.keys(workspace.manifest[section] ?? {}).filter((name) =>
      byName.has(name),
    ),
  );
}

for (const workspace of workspaces) {
  const dependencies = internalDependencies(workspace);
  if (
    workspace.name === '@velora/design-tokens' &&
    Object.keys(workspace.manifest.dependencies ?? {}).length > 0
  ) {
    failures.push('@velora/design-tokens cannot have runtime dependencies');
  }
  if (workspace.kind === 'apps' && workspace.name !== '@velora/api') {
    for (const dependency of dependencies) {
      if (!clientSafe.has(dependency)) {
        failures.push(`${workspace.name} cannot depend on ${dependency}`);
      }
    }
  }
  if (workspace.name === '@velora/api' || workspace.name === '@velora/domain') {
    for (const dependency of Object.keys(
      workspace.manifest.dependencies ?? {},
    )) {
      if (
        !approvedBackendRuntimeDependencies.get(workspace.name)?.has(dependency)
      ) {
        failures.push(
          `${workspace.name} declares unapproved backend runtime dependency ${dependency}`,
        );
      }
      if (forbiddenBackendNetworkDependencies.has(dependency)) {
        failures.push(
          `${workspace.name} declares unapproved HTTP dependency ${dependency}`,
        );
      }
    }
  }
  for (const dependency of dependencies) {
    if (byName.get(dependency)?.kind === 'apps') {
      failures.push(
        `${workspace.name} cannot depend on application ${dependency}`,
      );
    }
  }
}

const visiting = new Set();
const visited = new Set();
function visit(name, trail = []) {
  if (visiting.has(name)) {
    failures.push(
      `workspace dependency cycle: ${[...trail, name].join(' -> ')}`,
    );
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  const workspace = byName.get(name);
  if (workspace) {
    for (const dependency of internalDependencies(workspace)) {
      visit(dependency, [...trail, name]);
    }
  }
  visiting.delete(name);
  visited.add(name);
}
for (const name of byName.keys()) visit(name);

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

function sourceAnalysis(source, fileName) {
  const modules = [];
  const nonLiteralImports = [];
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function recordModule(expression, kind) {
    if (ts.isStringLiteralLike(expression)) {
      modules.push(expression.text);
    } else {
      nonLiteralImports.push(kind);
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      recordModule(node.moduleSpecifier, 'import');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      recordModule(node.moduleSpecifier, 'export');
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      recordModule(node.moduleReference.expression, 'import equals');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [argument] = node.arguments;
        if (argument) recordModule(argument, 'dynamic import');
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      ) {
        const [argument] = node.arguments;
        if (argument) recordModule(argument, 'require');
        else nonLiteralImports.push('require');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { modules, nonLiteralImports, sourceFile };
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (!ts.isElementAccessExpression(node)) return undefined;
  const argument = node.argumentExpression;
  return argument && ts.isStringLiteralLike(argument)
    ? argument.text
    : undefined;
}

function memberRoot(node) {
  return ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
    ? node.expression
    : undefined;
}

// Outbound primitives available to the pinned Bun/Node runtime. Velora server
// code reaches the network only through a registered composition-root port, so
// every one of these is denied at source level.
const forbiddenBunMembers = new Set(['connect', 'fetch', 'udpSocket']);
const forbiddenGlobalMembers = new Set([
  'EventSource',
  'WebSocket',
  'XMLHttpRequest',
  'fetch',
]);
// These identifiers have no legitimate non-network meaning in server source, so
// any reference is rejected regardless of how it is reached.
const forbiddenNetworkIdentifiers = new Set([
  'EventSource',
  'WebSocket',
  'XMLHttpRequest',
  'fetch',
]);
// Member names that are network primitives no matter which object carries them.
const forbiddenMemberNames = new Set(['sendBeacon', 'udpSocket']);
const runtimeRootAliases = [
  ['Bun', 'bun'],
  ['global', 'global'],
  ['globalThis', 'global'],
  ['self', 'global'],
  ['window', 'global'],
];

// Type assertions and parentheses are erasable wrappers, so they must never
// break alias resolution.
function unwrapExpression(node) {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      (ts.isSatisfiesExpression?.(current) ?? false)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

// Distinguishes reading a binding from merely naming a property, a declaration,
// or an import specifier, so that `Bun.serve({ fetch: handler })` is not
// mistaken for a call to global fetch.
function isValueReference(node) {
  const parent = node.parent;
  if (!parent) return true;
  const namedBy = [
    ts.isPropertyAccessExpression,
    ts.isQualifiedName,
    ts.isPropertyAssignment,
    ts.isMethodDeclaration,
    ts.isMethodSignature,
    ts.isPropertySignature,
    ts.isPropertyDeclaration,
    ts.isVariableDeclaration,
    ts.isParameter,
    ts.isFunctionDeclaration,
    ts.isEnumMember,
  ];
  for (const predicate of namedBy) {
    if (predicate(parent) && (parent.name === node || parent.right === node)) {
      return false;
    }
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent))
    return false;
  return true;
}

function backendNetworkFailures(analysis, fileName) {
  const found = [];
  const rootAliases = new Map(runtimeRootAliases);
  // Maps a variable holding an object literal to the runtime roots its
  // properties carry, so `const holder = { rt: Bun }` cannot launder access.
  const objectAliases = new Map();
  const networkAliases = new Set(forbiddenNetworkIdentifiers);
  const nodes = [];
  const collect = (node) => {
    nodes.push(node);
    ts.forEachChild(node, collect);
  };
  collect(analysis.sourceFile);

  const resolveRoot = (expression) => {
    const node = unwrapExpression(expression);
    if (ts.isIdentifier(node)) return rootAliases.get(node.text);
    if (
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node)
    ) {
      return undefined;
    }
    const base = unwrapExpression(node.expression);
    const property = memberName(node);
    if (property === undefined || !ts.isIdentifier(base)) return undefined;
    return objectAliases.get(base.text)?.get(property);
  };

  const isForbiddenMember = (root, property) =>
    property === 'fetch' ||
    (root === 'bun' && forbiddenBunMembers.has(property)) ||
    (root === 'global' && forbiddenGlobalMembers.has(property));

  let changed = true;
  while (changed) {
    changed = false;
    const remember = (map, key, value) => {
      if (map.get(key) === value) return;
      map.set(key, value);
      changed = true;
    };

    for (const node of nodes) {
      if (!ts.isVariableDeclaration(node) || !node.initializer) continue;
      const initializer = unwrapExpression(node.initializer);

      if (ts.isIdentifier(node.name)) {
        const root = resolveRoot(initializer);
        if (root && !rootAliases.has(node.name.text)) {
          remember(rootAliases, node.name.text, root);
        }
        if (ts.isObjectLiteralExpression(initializer)) {
          const properties = objectAliases.get(node.name.text) ?? new Map();
          for (const property of initializer.properties) {
            if (ts.isShorthandPropertyAssignment(property)) {
              const carried = rootAliases.get(property.name.text);
              if (carried) remember(properties, property.name.text, carried);
            } else if (
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) ||
                ts.isStringLiteralLike(property.name))
            ) {
              const carried = resolveRoot(property.initializer);
              if (carried) remember(properties, property.name.text, carried);
            }
          }
          if (properties.size > 0 && !objectAliases.has(node.name.text)) {
            objectAliases.set(node.name.text, properties);
            changed = true;
          }
        }
        const memberRootExpression = memberRoot(initializer);
        const property = memberName(initializer);
        const memberRootKind = memberRootExpression
          ? resolveRoot(memberRootExpression)
          : undefined;
        if (
          (ts.isIdentifier(initializer) &&
            networkAliases.has(initializer.text)) ||
          (memberRootKind !== undefined &&
            property !== undefined &&
            isForbiddenMember(memberRootKind, property))
        ) {
          if (!networkAliases.has(node.name.text)) {
            networkAliases.add(node.name.text);
            changed = true;
          }
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        const root = resolveRoot(initializer);
        if (root === undefined) continue;
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (!ts.isIdentifier(property) || !ts.isIdentifier(element.name)) {
            continue;
          }
          if (isForbiddenMember(root, property.text)) {
            if (!networkAliases.has(element.name.text)) {
              networkAliases.add(element.name.text);
              changed = true;
            }
          }
        }
      }
    }
  }

  for (const kind of analysis.nonLiteralImports) {
    found.push(`${fileName} uses non-literal ${kind}`);
  }
  for (const imported of analysis.modules) {
    if (forbiddenNetworkModules.test(imported)) {
      found.push(`${fileName} imports unrestricted network module ${imported}`);
    }
  }
  for (const node of nodes) {
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      networkAliases.has(unwrapExpression(node.expression).text)
    ) {
      found.push(
        `${fileName} uses direct network API ${unwrapExpression(node.expression).text}`,
      );
      continue;
    }
    if (
      ts.isIdentifier(node) &&
      forbiddenNetworkIdentifiers.has(node.text) &&
      isValueReference(node)
    ) {
      found.push(`${fileName} references direct network API ${node.text}`);
      continue;
    }
    if (
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node)
    ) {
      continue;
    }
    const property = memberName(node);
    if (property !== undefined && forbiddenMemberNames.has(property)) {
      found.push(`${fileName} references direct network API .${property}`);
      continue;
    }
    const rootExpression = memberRoot(node);
    const root = rootExpression ? resolveRoot(rootExpression) : undefined;
    if (!root) continue;
    if (property === undefined) {
      found.push(`${fileName} uses computed ${root} runtime access`);
    } else if (isForbiddenMember(root, property)) {
      found.push(
        `${fileName} references direct network API ${root}.${property}`,
      );
    }
  }
  return [...new Set(found)];
}

function verifyNetworkChecker() {
  const probes = [
    "const name = 'node:http'; void import(name);",
    'const { connect } = Bun; void connect({ hostname: "x", port: 1 });',
    'const runtime = Bun; const socket = runtime.connect; void socket({});',
    "const member = 'connect'; void Bun[member]({});",
    'const b = Bun; void b.connect({ hostname: "x", port: 1 });',
    'const holder = { rt: Bun }; void holder.rt.connect({ hostname: "x", port: 1 });',
    'const holder = { rt: Bun }; void holder.rt.udpSocket({});',
    'void (Bun as typeof Bun).connect({ hostname: "x", port: 1 });',
    'void (Bun satisfies typeof Bun).fetch("https://x.test");',
    'export const socket = new WebSocket("wss://x.test");',
    'export const stream = new EventSource("https://x.test");',
    'export const request = new XMLHttpRequest();',
    'void globalThis.fetch("https://x.test");',
    'const f = fetch; void f("https://x.test");',
    'const g = globalThis; void g.fetch("https://x.test");',
    'const h = { g: globalThis }; void h.g.fetch("https://x.test");',
    'const h = { g: globalThis }; const w = h.g.WebSocket; void w;',
    'void navigator.sendBeacon("https://x.test", "");',
    'const n = { nav: globalThis }; void n.nav.navigator.sendBeacon("https://x.test", "");',
    'void Bun.udpSocket({});',
    'void Bun.fetch("https://x.test");',
    'import { request } from "node:http"; void request;',
    'import { connect } from "node:tls"; void connect;',
    'import http2 from "node:http2"; void http2;',
    'import dgram from "node:dgram"; void dgram;',
    'import { Agent } from "undici"; void Agent;',
  ];
  for (const [index, source] of probes.entries()) {
    const fileName = `boundary-self-test-${String(index)}.ts`;
    const analysis = sourceAnalysis(source, fileName);
    if (backendNetworkFailures(analysis, fileName).length === 0) {
      failures.push(
        `boundary checker missed negative probe ${String(index)}: ${source}`,
      );
    }
  }
  const safeProbes = [
    'const sql = new Bun.SQL("postgresql://local"); void Bun.spawn(["true"]); void sql;',
    'import { Redis } from "ioredis"; const client = new Redis(); void client.connect();',
    'const server = Bun.serve({ port: 0, fetch: () => new Response("ok") }); void server;',
  ];
  for (const [index, source] of safeProbes.entries()) {
    const safeFile = `boundary-self-test-safe-${String(index)}.ts`;
    const safeAnalysis = sourceAnalysis(source, safeFile);
    const rejected = backendNetworkFailures(safeAnalysis, safeFile);
    if (rejected.length > 0) {
      failures.push(
        `boundary checker rejected safe probe ${String(index)}: ${rejected.join('; ')}`,
      );
    }
  }
}

verifyNetworkChecker();

// Server-capable scope is derived from the workspace graph, never from a list
// of file names. Any workspace the backend runtime can import is enforced in
// full, so adding a new module to one of them cannot create an egress gap.
const backendRuntimeRoots = ['@velora/api', '@velora/domain'];
const serverCapableWorkspaces = new Set();
function markServerCapable(name) {
  if (serverCapableWorkspaces.has(name)) return;
  const workspace = byName.get(name);
  if (!workspace) return;
  serverCapableWorkspaces.add(name);
  for (const dependency of internalDependencies(workspace)) {
    markServerCapable(dependency);
  }
}
for (const name of backendRuntimeRoots) markServerCapable(name);
for (const name of backendRuntimeRoots) {
  if (!serverCapableWorkspaces.has(name)) {
    failures.push(`backend runtime workspace ${name} is missing`);
  }
}

const applicationNames = new Set(
  workspaces
    .filter((workspace) => workspace.kind === 'apps')
    .map((workspace) => workspace.name),
);

for (const workspace of workspaces) {
  const directories = [join(workspace.path, 'src')];
  if (workspace.kind === 'apps' && workspace.name !== '@velora/api') {
    directories.push(join(workspace.path, 'app'));
  }
  if (workspace.name === '@velora/api') {
    directories.push(join(workspace.path, 'scripts'));
  }
  for (const file of directories.flatMap(sourceFiles)) {
    const source = readFileSync(file, 'utf8');
    const fileName = relative(root, file);
    const analysis = sourceAnalysis(source, fileName);
    // Applications are never importable by another workspace, whatever the
    // module resolver happens to allow today.
    for (const imported of analysis.modules) {
      for (const application of applicationNames) {
        if (
          application !== workspace.name &&
          (imported === application || imported.startsWith(`${application}/`))
        ) {
          failures.push(`${fileName} imports application package ${imported}`);
        }
      }
    }
    if (workspace.name !== '@velora/api' && workspace.kind === 'apps') {
      if (analysis.nonLiteralImports.length > 0) {
        failures.push(`${fileName} uses a non-literal client import`);
      }
      for (const imported of analysis.modules) {
        if (
          imported === '@velora/domain' ||
          imported.startsWith('@velora/domain/')
        ) {
          failures.push(`${fileName} imports server-only domain code`);
        }
        if (
          imported === '@velora/config' ||
          imported === '@velora/config/server'
        ) {
          failures.push(`${fileName} must use @velora/config/client`);
        }
        if (
          imported === '@velora/observability' ||
          imported === '@velora/observability/server'
        ) {
          failures.push(`${fileName} must use @velora/observability/client`);
        }
        if (imported.startsWith('.')) {
          const target = resolve(dirname(file), imported);
          const targetRelative = relative(workspace.path, target);
          if (
            targetRelative === '..' ||
            targetRelative.startsWith(
              `..${process.platform === 'win32' ? '\\' : '/'}`,
            )
          ) {
            failures.push(
              `${fileName} imports outside its application workspace`,
            );
          }
        }
      }
    }
    if (serverCapableWorkspaces.has(workspace.name)) {
      failures.push(...backendNetworkFailures(analysis, fileName));
    }
  }
}

if (failures.length > 0) {
  for (const failure of [...new Set(failures)]) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(
    `Boundary check passed for ${workspaces.length} workspaces; outbound network enforcement covers ${[...serverCapableWorkspaces].sort().join(', ')}.`,
  );
}
