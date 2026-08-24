import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The one command a developer runs to work on Velora locally: `bun run dev`.
 *
 * Everything below already existed as a separate command — `pnpm env:bootstrap`,
 * `pnpm infra:up`, `pnpm db:migrate`, five workspace `dev` scripts, and a worker
 * nobody remembered to start. Each remains available and unchanged; this file
 * only removes the requirement to remember the order, and the requirement to
 * type `mise exec` in a shell where the pinned runtimes are not on PATH.
 *
 * What it deliberately does not do is decide anything destructive. It never
 * resets a database, never overwrites `.env`, never recreates a healthy
 * container, and never stops a process it did not start. A port held by another
 * project is a refusal with the owner named, not a kill: the machine running
 * this is also running somebody's other work.
 *
 * Production topology is untouched. The API and the worker stay separate
 * processes here exactly as they deploy separately, because collapsing them for
 * local convenience would make local development the one place the split is
 * never exercised.
 */

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(repositoryRoot);

const loopbackHost = '127.0.0.1';

/**
 * Every process this command owns, in the order they are started: the API and
 * the worker first, because a surface that renders before its API answers is
 * the confusing half-minute this ordering removes. `port` is what the
 * workspace's own `dev` script binds; nothing here chooses a port, so changing
 * one stays a single edit in that workspace.
 */
const services = [
  {
    label: 'api',
    name: 'API',
    packageName: '@velora/api',
    port: 4000,
    readiness: { kind: 'http', path: '/v1/health/live' },
    script: 'dev',
  },
  {
    label: 'worker',
    name: 'Worker',
    packageName: '@velora/api',
    port: undefined,
    readiness: { kind: 'process' },
    script: 'dev:worker',
  },
  {
    label: 'web',
    name: 'Consumer Web',
    packageName: '@velora/web',
    port: 3000,
    readiness: { kind: 'tcp' },
    script: 'dev',
  },
  {
    label: 'creator-studio',
    name: 'Creator Studio',
    packageName: '@velora/creator-studio',
    port: 3001,
    readiness: { kind: 'tcp' },
    script: 'dev',
  },
  {
    label: 'admin',
    name: 'Platform Admin',
    packageName: '@velora/admin',
    port: 3002,
    readiness: { kind: 'tcp' },
    script: 'dev',
  },
  {
    label: 'mobile',
    name: 'Mobile Metro',
    packageName: '@velora/mobile',
    port: 8081,
    readiness: { kind: 'http', path: '/status' },
    script: 'dev',
  },
];

const labelWidth = Math.max(...services.map((service) => service.label.length));

function note(message) {
  process.stdout.write(`${message}\n`);
}

function fail(lines) {
  process.stderr.write(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

function withToolchain(prefix, command, args) {
  return prefix.length === 0
    ? [command, args]
    : [prefix[0], [...prefix.slice(1), command, ...args]];
}

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

/**
 * Finds a toolchain the repository's own gate accepts, without weakening it.
 *
 * `pnpm toolchain:check` is the authority — it compares the running Bun, Node,
 * and pnpm against `package.json#engines`, `mise.toml`, `.node-version`, and
 * `.bun-version`, and it is not reimplemented here. All this does is ask that
 * gate twice: once with whatever is on PATH, and once through `mise exec`. The
 * first answer that passes decides how every later command in this file is
 * spawned, which is how a developer stops having to type `mise exec` and why a
 * mismatched PATH runtime still cannot be used by accident.
 */
function resolveToolchain() {
  const candidates = [
    { description: 'PATH', prefix: [] },
    { description: 'mise', prefix: ['mise', 'exec', '--'] },
  ];
  const rejections = [];

  for (const candidate of candidates) {
    const [file, args] = withToolchain(candidate.prefix, 'pnpm', [
      'toolchain:check',
    ]);
    const result = spawnSync(file, args, { encoding: 'utf8' });
    if (result.status === 0) {
      return { ...candidate, report: result.stdout.trim() };
    }
    const reason =
      result.error === undefined
        ? [result.stdout, result.stderr].join('').trim()
        : `${file} could not be run: ${result.error.message}`;
    rejections.push(`  via ${candidate.description}:\n${indent(reason, 4)}`);
  }

  fail([
    'No toolchain on this machine satisfies the repository pins.',
    ...rejections,
    '',
    'Provision the pinned runtimes with `mise install`, or install the exact',
    'versions in `mise.toml` another way. The pins are what matter, not mise.',
  ]);
  return undefined;
}

function indent(text, width) {
  const padding = ' '.repeat(width);
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : `${padding}${line}`))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Preflight steps
// ---------------------------------------------------------------------------

function runQuietly(toolchain, command, args) {
  const [file, argv] = withToolchain(toolchain.prefix, command, args);
  return spawnSync(file, argv, { encoding: 'utf8' });
}

function runVisibly(toolchain, command, args) {
  const [file, argv] = withToolchain(toolchain.prefix, command, args);
  return spawnSync(file, argv, { stdio: 'inherit' });
}

function describeFailure(result, file) {
  if (result.error !== undefined) {
    return `${file} could not be run: ${result.error.message}`;
  }
  return [result.stdout, result.stderr].join('').trim();
}

function installDependenciesIfMissing(toolchain) {
  if (existsSync(resolve(repositoryRoot, 'node_modules'))) return;
  note('  workspace     node_modules is missing; installing once');
  const result = runVisibly(toolchain, 'pnpm', [
    'install',
    '--frozen-lockfile',
  ]);
  if (result.status !== 0) {
    fail([
      'pnpm install --frozen-lockfile failed, so no workspace command can run.',
      'The lockfile is authoritative; do not install without it to get past this.',
    ]);
  }
}

/**
 * Builds the workspace libraries the running surfaces import.
 *
 * Every package in `packages/` publishes itself through `exports` targets under
 * `dist/`, and `dist/` is not committed. A gate reaches those files because
 * turbo declares `^build` for `lint`, `typecheck`, and `test`; nothing declared
 * it for `dev`, so a fresh clone got as far as `bun run dev` and then died on
 * `Cannot find module '@velora/validation'` — the API exiting, port 4000 never
 * appearing, and every surface in front of it reporting that Velora could not
 * be reached.
 *
 * Turbo owns the work and its cache, so this is 5 seconds once and ~50ms on
 * every later start. It is not a substitute for the entry-point check below: a
 * build can succeed and still not emit a subpath a package promises.
 */
function buildWorkspaceLibraries(toolchain) {
  const result = runQuietly(toolchain, 'pnpm', [
    'turbo',
    'run',
    'build',
    '--filter=./packages/*',
    '--ui=stream',
  ]);
  if (result.status !== 0) {
    fail([
      'The workspace libraries did not build, so no surface can import them.',
      describeFailure(result, 'pnpm turbo run build --filter=./packages/*'),
      '',
      'A contract check fails here when a schema was edited without regenerating',
      'the OpenAPI document and the client: run `pnpm contracts:generate`.',
    ]);
  }
  const verified = runQuietly(toolchain, 'pnpm', ['entrypoints:check']);
  if (verified.status !== 0) {
    fail([
      'A workspace package does not expose what its package.json promises.',
      describeFailure(verified, 'pnpm entrypoints:check'),
    ]);
  }
  note('  packages      workspace libraries built');
}

function bootstrapEnvironmentFile(toolchain) {
  const existed = existsSync(resolve(repositoryRoot, '.env'));
  const result = runQuietly(toolchain, 'pnpm', ['env:bootstrap']);
  if (result.status !== 0) {
    fail([
      'Creating the local environment file failed.',
      describeFailure(result, 'pnpm env:bootstrap'),
    ]);
  }
  note(
    existed
      ? '  environment   .env present and untouched'
      : '  environment   .env created from .env.example',
  );
}

/**
 * Docker Compose owns the local PostgreSQL and Redis lifecycle, and it already
 * reuses a healthy container rather than recreating one, so this is safe to run
 * on every start. The named volumes are why that matters: a recreate that lost
 * them would take a developer's local data with it.
 */
function startInfrastructure(toolchain) {
  const available = spawnSync('docker', ['compose', 'version'], {
    encoding: 'utf8',
  });
  if (available.status !== 0) {
    fail([
      'Docker Compose is not available, so local PostgreSQL and Redis cannot start.',
      describeFailure(available, 'docker compose version'),
      '',
      'Start Docker and try again.',
    ]);
  }

  note('  infra         starting PostgreSQL and Redis');
  const result = runVisibly(toolchain, 'pnpm', ['infra:up']);
  if (result.status !== 0) {
    fail([
      'PostgreSQL and Redis did not become healthy.',
      '',
      'If a host service already holds 5432 or 6379, set VELORA_POSTGRES_PORT or',
      'VELORA_REDIS_PORT in .env and change the matching port in DATABASE_URL,',
      'EPHEMERAL_REDIS_URL, and QUEUE_REDIS_URL to agree with it.',
    ]);
  }
}

/**
 * Applies pending migrations only. Drizzle's migrator is additive and records
 * what it has applied, so a second run in an already-current checkout does
 * nothing; there is no reset path here and there must not be one.
 */
function applyMigrations(toolchain) {
  const result = runQuietly(toolchain, 'pnpm', ['db:migrate']);
  if (result.status !== 0) {
    fail([
      'Applying database migrations failed.',
      describeFailure(result, 'pnpm db:migrate'),
    ]);
  }
  note('  migrations    applied');
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

function probePort(port, timeoutMs) {
  return new Promise((settle) => {
    const socket = connect({ host: loopbackHost, port });
    const finish = (listening) => {
      socket.destroy();
      settle(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('timeout', () => {
      finish(false);
    });
    socket.once('error', () => {
      finish(false);
    });
  });
}

function parseListingFields(output) {
  const records = [];
  let current;
  for (const line of output.split('\n')) {
    const kind = line.slice(0, 1);
    const value = line.slice(1);
    if (kind === 'p') {
      if (current !== undefined) records.push(current);
      current = { command: undefined, pid: value };
      continue;
    }
    if (current === undefined) continue;
    if (kind === 'c') current.command = value;
  }
  if (current !== undefined) records.push(current);
  return records;
}

function processWorkingDirectory(pid) {
  const result = spawnSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-F', 'n'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('n')) return line.slice(1);
  }
  return undefined;
}

/**
 * Describes who holds a port. `lsof` is best effort on purpose: it is present
 * on macOS and on the Linux images Velora is developed on, and when it is not,
 * an unidentified holder is still reported as a conflict rather than assumed
 * to be ours.
 */
function describePortHolder(port) {
  const result = spawnSync(
    'lsof',
    ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    return {
      detail: `port ${port} is in use and the owning process could not be identified`,
      ours: false,
    };
  }

  const holders = parseListingFields(result.stdout).map((holder) => ({
    ...holder,
    workingDirectory: processWorkingDirectory(holder.pid),
  }));
  const ours = holders.some(
    (holder) =>
      holder.workingDirectory !== undefined &&
      (holder.workingDirectory === repositoryRoot ||
        holder.workingDirectory.startsWith(`${repositoryRoot}/`)),
  );
  const described = holders
    .map(
      (holder) =>
        `pid ${holder.pid} (${holder.command ?? 'unknown command'}) in ${
          holder.workingDirectory ?? 'an unknown directory'
        }`,
    )
    .join(', ');
  return { detail: `port ${port} is held by ${described}`, ours };
}

async function requireFreePorts() {
  const ports = services
    .filter((service) => service.port !== undefined)
    .map((service) => ({ port: service.port, service: service.name }));
  const conflicts = [];

  for (const entry of ports) {
    if (!(await probePort(entry.port, 500))) continue;
    const holder = describePortHolder(entry.port);
    conflicts.push(`  ${entry.service}: ${holder.detail}`);
    conflicts.push(
      holder.ours
        ? '    That process belongs to this checkout — another local dev session is probably already running. Stop it and try again.'
        : "    Velora will not stop another project's process. Free the port or stop that process yourself, then try again.",
    );
  }

  if (conflicts.length > 0) {
    fail([
      'Refusing to start: a port this session needs is already in use.',
      ...conflicts,
    ]);
  }
  note(
    `  ports         ${ports.map((entry) => entry.port).join(', ')} are free`,
  );
}

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function forwardOutput(stream, label, sink) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      sink.write(`${label.padEnd(labelWidth)} | ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffered.length > 0) {
      sink.write(`${label.padEnd(labelWidth)} | ${buffered}\n`);
      buffered = '';
    }
  });
}

/**
 * Each service runs in its own process group. `pnpm` starts a shell that starts
 * Next, Expo, or Bun, so signalling the group is the only way a stop reaches
 * the process actually holding the port; signalling the pnpm process alone is
 * how an orphaned worker or a still-bound 3000 survives a Ctrl+C.
 */
function startService(toolchain, service) {
  const [file, args] = withToolchain(toolchain.prefix, 'pnpm', [
    '--filter',
    service.packageName,
    service.script,
  ]);
  const child = spawn(file, args, {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forwardOutput(child.stdout, service.label, process.stdout);
  forwardOutput(child.stderr, service.label, process.stderr);

  const record = { child, exited: false, service };
  children.set(service.label, record);

  child.on('exit', (code, signal) => {
    record.exited = true;
    if (shuttingDown) return;
    exitCode = 1;
    process.stderr.write(
      `\n${service.name} (${service.label}) exited unexpectedly with ${
        signal === null ? `code ${String(code)}` : `signal ${signal}`
      }. Stopping the rest of this session.\n\n`,
    );
    void shutdown();
  });
  child.on('error', (error) => {
    record.exited = true;
    if (shuttingDown) return;
    exitCode = 1;
    process.stderr.write(
      `\n${service.name} (${service.label}) could not be started: ${error.message}\n\n`,
    );
    void shutdown();
  });
  return record;
}

function signalGroup(record, signal) {
  if (record.exited || record.child.pid === undefined) return;
  try {
    if (process.platform === 'win32') record.child.kill(signal);
    else process.kill(-record.child.pid, signal);
  } catch {
    // The group is already gone, which is the state this was asking for.
  }
}

function waitForExit(record, timeoutMs) {
  if (record.exited) return Promise.resolve(true);
  return new Promise((settle) => {
    const timer = setTimeout(() => {
      settle(false);
    }, timeoutMs);
    record.child.once('exit', () => {
      clearTimeout(timer);
      settle(true);
    });
  });
}

/**
 * Stops what this session started and nothing else. PostgreSQL and Redis keep
 * running: `pnpm infra:down` is the repository's explicit command for that, and
 * a dev command that tore down containers on exit would be deciding on a
 * developer's behalf that no other terminal is using them.
 */
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write('\nStopping local development processes.\n');

  for (const record of children.values()) signalGroup(record, 'SIGINT');
  await Promise.all(
    [...children.values()].map((record) => waitForExit(record, 10_000)),
  );

  const stubborn = [...children.values()].filter((record) => !record.exited);
  for (const record of stubborn) signalGroup(record, 'SIGKILL');
  await Promise.all(stubborn.map((record) => waitForExit(record, 5_000)));

  process.stdout.write(
    'Stopped. PostgreSQL and Redis are still running; stop them with `pnpm infra:down`.\n',
  );
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Readiness and summary
// ---------------------------------------------------------------------------

function delay(milliseconds) {
  return new Promise((settle) => {
    setTimeout(settle, milliseconds);
  });
}

async function respondsOverHttp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForReadiness(service, record, timeoutMs) {
  if (service.readiness.kind === 'process') return !record.exited;
  const deadline = Date.now() + timeoutMs;
  const url = `http://${loopbackHost}:${String(service.port)}${
    service.readiness.kind === 'http' ? service.readiness.path : ''
  }`;
  while (Date.now() < deadline) {
    if (record.exited) return false;
    const ready =
      service.readiness.kind === 'http'
        ? await respondsOverHttp(url)
        : await probePort(service.port, 1000);
    if (ready) return true;
    await delay(400);
  }
  return false;
}

/**
 * Reads in the order a developer opens things, which is not the order they are
 * started: the browser surfaces first, then the API behind them, then the two
 * processes with no address to visit.
 */
const summaryOrder = [
  'web',
  'creator-studio',
  'admin',
  'api',
  'mobile',
  'worker',
];

function summarise(statuses) {
  const nameWidth = Math.max(...services.map((service) => service.name.length));
  const lines = ['', 'VELORA LOCAL DEVELOPMENT', ''];
  // A service added above and forgotten here still gets a line, because a
  // process that is running and unlisted is the one a developer never finds.
  const ordered = [
    ...summaryOrder
      .map((label) => services.find((service) => service.label === label))
      .filter((service) => service !== undefined),
    ...services.filter((service) => !summaryOrder.includes(service.label)),
  ];
  for (const service of ordered) {
    const address =
      service.port === undefined
        ? 'running'
        : `http://${loopbackHost}:${String(service.port)}`;
    const ready = statuses.get(service.label) === true;
    lines.push(
      `${service.name.padEnd(nameWidth)}  ${address}${
        ready ? '' : '  (not responding yet — watch the log above)'
      }`,
    );
  }
  lines.push(
    '',
    'Ctrl+C stops these processes. PostgreSQL and Redis keep running; stop them',
    'with `pnpm infra:down`.',
    '',
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (process.env.CI !== undefined) {
  fail([
    'start-local-development is for a developer machine. CI provisions its own',
    'infrastructure and runs `pnpm ci:verify`.',
  ]);
}

note('Starting VELORA local development.');
const toolchain = resolveToolchain();
note(`  toolchain     ${toolchain.report} (via ${toolchain.description})`);
installDependenciesIfMissing(toolchain);
buildWorkspaceLibraries(toolchain);
bootstrapEnvironmentFile(toolchain);
await requireFreePorts();
startInfrastructure(toolchain);
applyMigrations(toolchain);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    void shutdown();
  });
}

note('  processes     starting API, worker, three web surfaces, and Metro\n');
const started = services.map((service) => ({
  record: startService(toolchain, service),
  service,
}));

const readiness = await Promise.all(
  started.map(async (entry) => [
    entry.service.label,
    await waitForReadiness(entry.service, entry.record, 180_000),
  ]),
);
if (!shuttingDown) summarise(new Map(readiness));
