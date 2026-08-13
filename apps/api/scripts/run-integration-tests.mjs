import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';

const reportDirectory = mkdtempSync(join(tmpdir(), 'velora-integration-'));
const reportPath = join(reportDirectory, 'results.xml');

/**
 * Diagnostics must never become a credential leak. Everything printed below
 * passes through here: connection URIs carry a password, and container logs can
 * echo one back.
 */
const secretValues = new Set();
// Stripping userinfo from URLs below already covers every place a credential
// can appear as a credential. Bare-value masking is an extra net for
// distinctive generated secrets only: short common words such as the
// Testcontainers default would otherwise redact ordinary prose like
// "bun test" and destroy the diagnostics this file exists to produce.
const bareValueMaskMinimumLength = 8;
function rememberSecret(value) {
  if (typeof value === 'string' && value.length >= bareValueMaskMinimumLength) {
    secretValues.add(value);
  }
}
function redact(text) {
  if (typeof text !== 'string') return String(text);
  let output = text.replaceAll(
    /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/giu,
    '$1[REDACTED]@',
  );
  for (const secret of secretValues) {
    output = output.replaceAll(secret, '[REDACTED]');
  }
  return output;
}
function safeEndpoint(uri) {
  try {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}:${url.port}${url.pathname}`;
  } catch {
    return '[unparseable endpoint]';
  }
}

function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stderr: result.stderr ?? '',
    stdout: (result.stdout ?? '').trim(),
  };
}

function mappedPort(containerId, containerPort) {
  const inspected = docker([
    'inspect',
    '-f',
    `{{json (index .NetworkSettings.Ports "${containerPort}/tcp")}}`,
    containerId,
  ]);
  if (!inspected.ok) return undefined;
  try {
    return JSON.parse(inspected.stdout)?.[0]?.HostPort;
  } catch {
    return undefined;
  }
}

function containerDiagnostics(label, containerId, containerPort, expectedPort) {
  const lines = [`  ${label} (${containerId.slice(0, 12)}):`];
  const state = docker([
    'inspect',
    '-f',
    '{{.State.Status}} exit={{.State.ExitCode}} oomKilled={{.State.OOMKilled}} restarting={{.State.Restarting}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}',
    containerId,
  ]);
  lines.push(`    state: ${state.ok ? state.stdout : 'unavailable'}`);

  const current = mappedPort(containerId, containerPort);
  lines.push(
    `    published ${String(containerPort)}/tcp: now=${current ?? 'none'} handed-to-tests=${expectedPort}`,
  );
  if (current !== undefined && current !== expectedPort) {
    lines.push(
      `    NOTE: the published host port changed after the tests started. Docker re-allocates an ephemeral port on every container start, so any URL captured before a restart is stale.`,
    );
  }

  // Only named fields are read. Never dump Config.Env, which holds credentials.
  const logs = docker(['logs', '--tail', '40', containerId]);
  const body = `${logs.stdout}\n${logs.stderr}`.trim();
  lines.push('    last log lines:');
  for (const line of redact(body).split('\n').slice(-40)) {
    lines.push(`      ${line}`);
  }
  return lines.join('\n');
}

function failedTestsFromReport() {
  let xml;
  try {
    xml = readFileSync(reportPath, 'utf8');
  } catch {
    return [];
  }
  const failures = [];
  // The JUnit report is immune to console formatting, terminal width, and any
  // truncation the CI log viewer applies, so the failing test names survive.
  // A self-closing <testcase/> is a pass; only elements with a nested
  // <failure>/<error> child are reported.
  for (const segment of xml.split('<testcase').slice(1)) {
    const tagEnd = segment.indexOf('>');
    if (tagEnd === -1) continue;
    const rawAttributes = segment.slice(0, tagEnd);
    if (rawAttributes.trimEnd().endsWith('/')) continue;
    const close = segment.indexOf('</testcase>');
    if (close === -1) continue;
    const body = segment.slice(tagEnd + 1, close);
    if (!/<(?:failure|error)\b/u.test(body)) continue;
    const attribute = (name) =>
      new RegExp(`${name}="([^"]*)"`, 'u').exec(rawAttributes)?.[1];
    failures.push({
      file: attribute('file') ?? 'unknown file',
      line: attribute('line') ?? '?',
      message:
        /<(?:failure|error)[^>]*\smessage="([^"]*)"/u.exec(body)?.[1] ?? '',
      name: attribute('name') ?? 'unnamed test',
      type:
        /<(?:failure|error)[^>]*\stype="([^"]*)"/u.exec(body)?.[1] ?? 'failure',
    });
  }
  return failures;
}

const [postgres, redis] = await Promise.all([
  new PostgreSqlContainer('postgres:18.4-alpine3.24').start(),
  new GenericContainer('redis:8.10.0-alpine3.23')
    .withCommand([
      'redis-server',
      '--appendonly',
      'yes',
      '--appendfsync',
      'always',
      '--save',
      '60',
      '1',
    ])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections tcp'))
    .start(),
]);

const databaseUri = postgres.getConnectionUri();
const databasePort = new URL(databaseUri).port;
const redisPort = String(redis.getMappedPort(6379));
const redisUrl = `redis://${redis.getHost()}:${redisPort}`;
try {
  const parsed = new URL(databaseUri);
  // The username is not a secret and the user:password pair is already
  // removed from any URL by redact().
  rememberSecret(decodeURIComponent(parsed.password));
} catch {
  // A URI that cannot be parsed still never gets printed raw.
}

let capturedOutput = '';
try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      'bun',
      [
        'test',
        '--timeout',
        '180000',
        '--reporter=junit',
        `--reporter-outfile=${reportPath}`,
        'test/integration',
      ],
      {
        env: {
          ...process.env,
          TEST_DATABASE_URL: databaseUri,
          TEST_POSTGRES_CONTAINER_ID: postgres.getId(),
          TEST_REDIS_CONTAINER_ID: redis.getId(),
          TEST_REDIS_HOST: redis.getHost(),
          TEST_REDIS_PORT: redisPort,
          TEST_REDIS_URL: redisUrl,
        },
        stdio: ['inherit', 'pipe', 'pipe'],
      },
    );
    // Stream live for ordinary runs, and keep a copy so the failure summary can
    // be reprinted at the very end where no log viewer can bury it.
    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        capturedOutput += text;
        sink.write(redact(text));
      });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Bun integration tests ended with ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
    const failures = failedTestsFromReport();
    const report = [
      '',
      '===== INTEGRATION FAILURE DIAGNOSTICS =====',
      `runner: ${process.platform}/${process.arch} node ${process.versions.node}`,
      `docker: ${docker(['version', '--format', '{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}']).stdout || 'unavailable'}`,
      `postgres endpoint handed to tests: ${safeEndpoint(databaseUri)}`,
      `redis endpoint handed to tests:    ${redisUrl}`,
      '',
      failures.length > 0
        ? `failing tests (${String(failures.length)}):`
        : 'failing tests: none recorded in the JUnit report; see captured output below',
    ];
    for (const failure of failures) {
      report.push(
        `  ✗ ${failure.name}`,
        `      at ${failure.file}:${failure.line}`,
        `      ${failure.type}${failure.message ? `: ${redact(failure.message)}` : ''}`,
      );
    }
    report.push('', 'container state:');
    report.push(
      containerDiagnostics('postgres', postgres.getId(), 5432, databasePort),
    );
    report.push(containerDiagnostics('redis', redis.getId(), 6379, redisPort));
    report.push('', 'captured test output (tail):');
    for (const line of redact(capturedOutput).split('\n').slice(-80)) {
      report.push(`  ${line}`);
    }
    report.push('===== END INTEGRATION FAILURE DIAGNOSTICS =====', '');
    process.stderr.write(`${report.join('\n')}\n`);
  }
} finally {
  rmSync(reportDirectory, { force: true, recursive: true });
  await Promise.allSettled([postgres.stop(), redis.stop()]);
}
