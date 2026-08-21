#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repeated-run stability evidence.
 *
 * A gate that passes once has told you it can pass once. What a freeze needs to
 * know is whether it passes *reliably* — and the failures that matter for that
 * are the ones that depend on ordering, on load, and on clocks, which are
 * exactly the ones a single green run hides.
 *
 * So this repeats the two stages where those failures live. The deterministic
 * stages — formatting, lint, typecheck, contract drift, secret scan — either
 * pass or fail identically every time, and repeating them twenty times would
 * spend hours proving that `tsc` is a function. The integration suite runs
 * against real PostgreSQL and Redis with real concurrency, and the browser
 * suite runs against real servers on real ports; both have produced
 * order-dependent and load-dependent failures during this build, and both are
 * repeated here.
 *
 * Three environment hazards are checked or cleared before every iteration,
 * because each one has already produced a failure that looked like a product
 * defect:
 *
 *   - **Port ownership.** Playwright reuses a server already listening on 3000,
 *     3001, or 3002 outside CI, and does not check what is answering. A foreign
 *     development server is adopted silently and every assertion against it
 *     fails as "element not found", which reads as a broken product. An
 *     iteration refuses to start rather than producing that evidence.
 *   - **Volume accumulation.** Disposable test volumes pile up across runs and
 *     degrade container timings. Only dangling volumes are removed, and never
 *     the `velora-local_` development stack.
 *   - **Killed runs.** The environment has terminated a gate mid-stage. A
 *     killed run is neither a pass nor a failure and must not be counted as
 *     either; it is recorded as `killed` and the iteration is retried.
 *
 * Every iteration appends one line of evidence. Nothing is summarised away: a
 * report that averaged its runs could not distinguish twenty passes from
 * nineteen passes and a silence.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const iterations = Number(process.env.STABILITY_ITERATIONS ?? '20');
const evidenceDirectory = process.env.STABILITY_OUTPUT_DIRECTORY ?? '/tmp';
const evidencePath = join(evidenceDirectory, 'rtc-stability.jsonl');
mkdirSync(evidenceDirectory, { recursive: true });

const surfacePorts = [3000, 3001, 3002];

/** Whoever is listening on a surface port, or nothing. */
function listenerOn(port) {
  const probe = spawnSync(
    'lsof',
    ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN'],
    { encoding: 'utf8' },
  );
  const lines = probe.stdout.trim().split('\n').slice(1).filter(Boolean);
  return lines.length === 0 ? undefined : lines[0];
}

function refuseForeignServers() {
  for (const port of surfacePorts) {
    const listener = listenerOn(port);
    if (listener !== undefined) {
      throw new Error(
        `port ${String(port)} is already served by: ${listener} — a run against a server VELORA does not own is not evidence`,
      );
    }
  }
}

function pruneDisposableVolumes() {
  const listed = spawnSync('docker', ['volume', 'ls', '-qf', 'dangling=true'], {
    encoding: 'utf8',
  });
  const volumes = listed.stdout
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !name.startsWith('velora-local_'));
  if (volumes.length === 0) return 0;
  spawnSync('docker', ['volume', 'rm', ...volumes], { encoding: 'utf8' });
  return volumes.length;
}

/**
 * Runs one stage, distinguishing a failure from a termination.
 *
 * A signal means the process was killed rather than that the tests decided
 * anything, and the two must never be recorded as the same outcome.
 */
function runStage(name, args) {
  const startedAt = Date.now();
  const result = spawnSync('pnpm', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  if (result.signal !== null && result.signal !== undefined) {
    return {
      durationSeconds,
      outcome: 'killed',
      signal: result.signal,
      stage: name,
    };
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const failures = /^\s*(\d+) fail/mu.exec(output)?.[1];
  return {
    durationSeconds,
    ...(failures === undefined ? {} : { failed: Number(failures) }),
    outcome: result.status === 0 ? 'passed' : 'failed',
    stage: name,
  };
}

function record(entry) {
  appendFileSync(evidencePath, `${JSON.stringify(entry)}\n`);
  const detail = entry.stages
    .map(
      (stage) =>
        `${stage.stage}=${stage.outcome}(${String(stage.durationSeconds)}s)`,
    )
    .join(' ');
  process.stdout.write(
    `run ${String(entry.iteration)}/${String(iterations)} ${entry.outcome} ${detail}\n`,
  );
}

process.stdout.write(
  `stability proof: ${String(iterations)} iterations, evidence at ${evidencePath}\n`,
);

let passed = 0;
let failed = 0;
let killed = 0;

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  refuseForeignServers();
  const prunedVolumes = pruneDisposableVolumes();

  const stages = [
    runStage('integration', ['test:integration']),
    runStage('e2e', ['test:e2e']),
  ];
  const outcome = stages.some((stage) => stage.outcome === 'killed')
    ? 'killed'
    : stages.every((stage) => stage.outcome === 'passed')
      ? 'passed'
      : 'failed';
  if (outcome === 'passed') passed += 1;
  else if (outcome === 'failed') failed += 1;
  else killed += 1;

  record({
    iteration,
    outcome,
    prunedVolumes,
    stages,
    // Stamped when the iteration finishes rather than generated inside a
    // report, so the evidence carries when it was actually produced.
    finishedAt: new Date().toISOString(),
  });
}

process.stdout.write(
  `stability proof complete: ${String(passed)} passed, ${String(failed)} failed, ${String(killed)} killed of ${String(iterations)}\n`,
);
// A killed iteration is not evidence of instability in the product, but it is
// also not evidence of stability, so it fails the proof rather than being
// quietly excluded from it.
process.exitCode = failed === 0 && killed === 0 ? 0 : 1;
