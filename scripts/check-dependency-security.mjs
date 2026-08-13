import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const registerPath = 'docs/security/08-dependency-risk-acceptance.md';
const auditCommand = ['audit', '--json'];
const failingSeverities = new Set(['critical', 'high']);
const knownSeverities = ['info', 'low', 'moderate', 'high', 'critical'];
const knownSeveritySet = new Set(knownSeverities);
const acceptedStatus = 'temporarily-accepted';
const expiryWarningDays = 30;
// A risk acceptance is a temporary, owner-signed exception. Anything longer
// than this is an indefinite exception wearing an expiry date, and requires a
// separate security decision rather than the standard gate.
const maximumAcceptanceDays = 90;
// pnpm truncates `findings[].paths`. Observed paths are therefore necessary
// but never sufficient evidence, so reachability is additionally verified from
// the complete reverse-dependency graph.
const auditPathReportLimit = 100;
const recordIdPattern = /^VRA-\d{4}-\d{3}$/u;
const advisoryIdPattern = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/u;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const exactVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const packageNamePattern = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/u;
const requiredTextFields = [
  'risk',
  'dependencyPath',
  'reachability',
  'impact',
  'remediation',
  'owner',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return (
    Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
  );
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidIsoDate(value) {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function dayDifference(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function acceptanceKey(packageName, advisory) {
  return `${packageName}@@${advisory}`;
}

export function parseAcceptanceRegister(markdown) {
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map(
    (match) => match[1],
  );
  if (blocks.length !== 1) {
    throw new Error(
      `${registerPath} must contain exactly one machine-readable JSON block; found ${String(blocks.length)}`,
    );
  }
  const parsed = JSON.parse(blocks[0]);
  if (parsed.registerVersion !== 1) {
    throw new Error(`${registerPath} registerVersion must be 1`);
  }
  if (!Array.isArray(parsed.acceptances)) {
    throw new Error(`${registerPath} acceptances must be an array`);
  }
  return parsed.acceptances;
}

/**
 * A vulnerability audit that could not be performed is not evidence of safety.
 * Every structural expectation of a successful pnpm audit report is asserted
 * here, and any shortfall is an audit execution failure rather than an empty
 * advisory list.
 */
export function parseAuditReport(execution) {
  const fail = (reason) => ({ failure: reason, ok: false });

  if (execution.spawnError !== undefined) {
    return fail(`audit process could not be started: ${execution.spawnError}`);
  }
  if (execution.signal) {
    return fail(`audit process terminated by signal ${execution.signal}`);
  }
  if (execution.status === null || execution.status === undefined) {
    return fail('audit process produced no exit status');
  }
  if (typeof execution.raw !== 'string' || execution.raw.trim().length === 0) {
    return fail(
      `audit process exited with status ${String(execution.status)} and produced no output`,
    );
  }

  let report;
  try {
    report = JSON.parse(execution.raw);
  } catch (error) {
    return fail(
      `audit output is not parseable JSON (${error.message}); output may be truncated or not a report`,
    );
  }
  if (!isPlainObject(report)) {
    return fail('audit output is not a JSON object');
  }
  // pnpm reports registry, network, authentication, and engine failures as a
  // top-level error object while still exiting with parseable JSON.
  if (report.error !== undefined) {
    const code = isPlainObject(report.error)
      ? (report.error.code ?? 'unknown')
      : 'unknown';
    const message = isPlainObject(report.error)
      ? (report.error.message ?? '')
      : String(report.error);
    return fail(`audit reported error ${String(code)}: ${String(message)}`);
  }
  if (!isPlainObject(report.metadata)) {
    return fail('audit report is missing its metadata object');
  }
  const counts = report.metadata.vulnerabilities;
  if (!isPlainObject(counts)) {
    return fail('audit report is missing metadata.vulnerabilities');
  }
  for (const severity of knownSeverities) {
    const count = counts[severity];
    if (!Number.isInteger(count) || count < 0) {
      return fail(
        `audit report metadata.vulnerabilities.${severity} is not a non-negative integer`,
      );
    }
  }
  if (!isPlainObject(report.advisories)) {
    return fail('audit report is missing its advisories object');
  }

  const advisories = Object.values(report.advisories);
  const tally = Object.fromEntries(
    knownSeverities.map((severity) => [severity, 0]),
  );
  for (const advisory of advisories) {
    if (!isPlainObject(advisory)) {
      return fail('audit report contains a non-object advisory');
    }
    if (!isNonEmptyString(advisory.module_name)) {
      return fail('audit report contains an advisory without a module name');
    }
    if (
      !isNonEmptyString(advisory.github_advisory_id) ||
      !advisoryIdPattern.test(advisory.github_advisory_id)
    ) {
      return fail(
        `audit report advisory for ${advisory.module_name} has no valid GHSA identifier`,
      );
    }
    if (!knownSeveritySet.has(advisory.severity)) {
      return fail(
        `audit report advisory ${advisory.github_advisory_id} has unknown severity ${String(advisory.severity)}`,
      );
    }
    if (!Array.isArray(advisory.findings) || advisory.findings.length === 0) {
      return fail(
        `audit report advisory ${advisory.github_advisory_id} has no findings`,
      );
    }
    for (const finding of advisory.findings) {
      if (!isPlainObject(finding) || !isNonEmptyString(finding.version)) {
        return fail(
          `audit report advisory ${advisory.github_advisory_id} has a finding without a version`,
        );
      }
      if (!isNonEmptyStringArray(finding.paths)) {
        return fail(
          `audit report advisory ${advisory.github_advisory_id} has a finding without dependency paths`,
        );
      }
    }
    tally[advisory.severity] += 1;
  }
  for (const severity of knownSeverities) {
    if (tally[severity] !== counts[severity]) {
      return fail(
        `audit report is internally inconsistent: metadata counts ${String(counts[severity])} ${severity} advisories but ${String(tally[severity])} were reported`,
      );
    }
  }

  return { advisories, ok: true, report };
}

function isSpecificDependencyChain(chain, packageName) {
  if (!isNonEmptyString(chain)) return false;
  const segments = chain.split('>');
  if (segments.length < 2) return false;
  if (segments[segments.length - 1] !== packageName) return false;
  return segments.every(
    (segment) =>
      isNonEmptyString(segment) &&
      segment !== '*' &&
      packageNamePattern.test(segment),
  );
}

function validateAcceptances(acceptances, workspaceRootTokens) {
  const failures = [];
  const seenIds = new Set();
  const seenKeys = new Set();

  for (const [index, record] of acceptances.entries()) {
    const label = isNonEmptyString(record?.id)
      ? record.id
      : `acceptance[${String(index)}]`;
    const fail = (message) => {
      failures.push(`malformed acceptance ${label}: ${message}`);
    };

    if (record === null || typeof record !== 'object') {
      fail('record must be an object');
      continue;
    }
    if (!isNonEmptyString(record.id) || !recordIdPattern.test(record.id)) {
      fail('id must match VRA-YYYY-NNN');
    } else if (seenIds.has(record.id)) {
      fail('duplicate id');
    } else {
      seenIds.add(record.id);
    }

    for (const field of requiredTextFields) {
      if (!isNonEmptyString(record[field])) fail(`${field} is required`);
    }
    if (!isNonEmptyStringArray(record.compensatingControls)) {
      fail('compensatingControls must list at least one control');
    }
    if (!isNonEmptyStringArray(record.reviewTriggers)) {
      fail('reviewTriggers must list at least one trigger');
    }
    if (
      !isNonEmptyString(record.package) ||
      !packageNamePattern.test(record.package)
    ) {
      fail('package must be an exact package name');
    }
    if (
      !isNonEmptyString(record.advisory) ||
      !advisoryIdPattern.test(record.advisory)
    ) {
      fail('advisory must be an exact GHSA identifier');
    }
    if (
      !Array.isArray(record.versions) ||
      record.versions.length === 0 ||
      !record.versions.every(
        (version) =>
          isNonEmptyString(version) && exactVersionPattern.test(version),
      )
    ) {
      fail('versions must list exact versions without ranges or wildcards');
    }
    // A one-segment or wildcard path matches every dependency graph and would
    // silently authorise an unreviewed reachability model.
    if (!isSpecificDependencyChain(record.dependencyPath, record.package)) {
      fail(
        'dependencyPath must be at least two exact package segments ending at the accepted package',
      );
    }
    if (!isNonEmptyStringArray(record.reachableWorkspaces)) {
      fail('reachableWorkspaces must list at least one Velora workspace');
    } else {
      for (const workspace of record.reachableWorkspaces) {
        if (!workspaceRootTokens.has(workspace)) {
          fail(`reachableWorkspaces contains unknown workspace ${workspace}`);
        }
      }
    }
    if (!knownSeveritySet.has(record.severity)) {
      fail('severity must be a known audit severity');
    }
    if (record.status !== acceptedStatus) {
      fail(`status must be ${acceptedStatus}`);
    }
    if (
      !isNonEmptyString(record.decisionDate) ||
      !isValidIsoDate(record.decisionDate)
    ) {
      fail('decisionDate must be an ISO calendar date');
    }
    if (!isNonEmptyString(record.expires) || !isValidIsoDate(record.expires)) {
      fail('expires must be an ISO calendar date');
    }
    if (
      isNonEmptyString(record.decisionDate) &&
      isNonEmptyString(record.expires) &&
      isValidIsoDate(record.decisionDate) &&
      isValidIsoDate(record.expires)
    ) {
      if (record.expires <= record.decisionDate) {
        fail('expires must be later than decisionDate');
      } else if (
        dayDifference(record.decisionDate, record.expires) >
        maximumAcceptanceDays
      ) {
        fail(
          `acceptance horizon exceeds the ${String(maximumAcceptanceDays)}-day maximum and requires a separate security decision`,
        );
      }
    }

    if (isNonEmptyString(record.package) && isNonEmptyString(record.advisory)) {
      const key = acceptanceKey(record.package, record.advisory);
      if (seenKeys.has(key)) fail('duplicate package and advisory pair');
      seenKeys.add(key);
    }
  }

  return failures;
}

function pathMatchesRecordedTail(auditPath, recordedPath) {
  const auditSegments = auditPath.split('>');
  const recordedSegments = recordedPath.split('>');
  if (recordedSegments.length > auditSegments.length) return false;
  const tail = auditSegments.slice(
    auditSegments.length - recordedSegments.length,
  );
  return recordedSegments.every((segment, index) => segment === tail[index]);
}

export function evaluateDependencySecurity({
  acceptances,
  advisories,
  reachabilityLookup,
  today,
  workspaceRootTokens = new Map(),
}) {
  const failures = validateAcceptances(acceptances, workspaceRootTokens);
  const accepted = [];
  const informational = [];
  const matchedKeys = new Set();
  const byKey = new Map(
    acceptances
      .filter(
        (record) =>
          isNonEmptyString(record?.package) &&
          isNonEmptyString(record?.advisory),
      )
      .map((record) => [
        acceptanceKey(record.package, record.advisory),
        record,
      ]),
  );

  for (const advisory of advisories) {
    const key = acceptanceKey(
      advisory.module_name,
      advisory.github_advisory_id,
    );
    const findings = advisory.findings ?? [];
    const versions = [...new Set(findings.map((finding) => finding.version))];
    const paths = findings.flatMap((finding) => finding.paths ?? []);
    const identity = `${advisory.module_name}@${versions.join(',')} ${advisory.github_advisory_id} (${advisory.severity})`;
    const record = byKey.get(key);

    if (record === undefined) {
      if (failingSeverities.has(advisory.severity)) {
        failures.push(`unaccepted ${advisory.severity} advisory: ${identity}`);
      } else {
        informational.push(
          `${identity} is below the ${[...failingSeverities].join('/')} gate threshold and has no acceptance record`,
        );
      }
      continue;
    }

    matchedKeys.add(key);
    let recordFailed = false;
    const rejectRecord = (message) => {
      recordFailed = true;
      failures.push(`${record.id} ${message}: ${identity}`);
    };

    if (
      failures.some((failure) => failure.includes(`acceptance ${record.id}:`))
    ) {
      continue;
    }
    if (record.expires < today) {
      rejectRecord(`acceptance expired on ${record.expires}`);
    }
    // Without version and path evidence the acceptance cannot be shown to
    // still describe the risk the owner signed off, so it authorises nothing.
    if (versions.length === 0 || paths.length === 0) {
      rejectRecord(
        'audit reported no version or dependency-path evidence, so the accepted reachability model cannot be validated',
      );
    }
    const unlistedVersions = versions.filter(
      (version) => !record.versions.includes(version),
    );
    if (unlistedVersions.length > 0) {
      rejectRecord(
        `acceptance does not cover installed version(s) ${unlistedVersions.join(', ')}`,
      );
    }
    // Any severity movement invalidates the acceptance. The owner signed off an
    // exact advisory state, not a severity band.
    if (record.severity !== advisory.severity) {
      rejectRecord(
        `acceptance records severity ${record.severity} but the audit reports ${advisory.severity}`,
      );
    }

    // Every reported path must be authorised. One surviving trusted path can
    // never license a newly appeared one.
    const allowedRoots = new Set(
      (record.reachableWorkspaces ?? [])
        .map((workspace) => workspaceRootTokens.get(workspace))
        .filter((token) => token !== undefined),
    );
    const unauthorisedChains = [
      ...new Set(
        paths.filter(
          (path) => !pathMatchesRecordedTail(path, record.dependencyPath),
        ),
      ),
    ];
    if (unauthorisedChains.length > 0) {
      rejectRecord(
        `${String(unauthorisedChains.length)} reported dependency path(s) do not pass through the accepted chain ${record.dependencyPath}, including ${unauthorisedChains[0]}`,
      );
    }
    const unauthorisedRoots = [
      ...new Set(
        paths
          .map((path) => path.split('>')[0])
          .filter((root) => !allowedRoots.has(root)),
      ),
    ];
    if (unauthorisedRoots.length > 0) {
      rejectRecord(
        `dependency paths originate from unaccepted workspace root(s) ${unauthorisedRoots.join(', ')}`,
      );
    }

    // Reported paths are truncated by pnpm, so they are corroborating rather
    // than complete evidence. The full reverse-dependency graph decides.
    if (typeof reachabilityLookup === 'function') {
      const reachability = reachabilityLookup(record);
      if (!reachability.ok) {
        rejectRecord(
          `independent reachability verification failed: ${reachability.reason}`,
        );
      } else {
        const declared = new Set(record.reachableWorkspaces ?? []);
        const unexpected = reachability.workspaces.filter(
          (workspace) => !declared.has(workspace),
        );
        const absent = [...declared].filter(
          (workspace) => !reachability.workspaces.includes(workspace),
        );
        if (unexpected.length > 0) {
          rejectRecord(
            `reachable from unaccepted workspace(s) ${unexpected.join(', ')}`,
          );
        }
        if (absent.length > 0) {
          rejectRecord(
            `no longer reachable from accepted workspace(s) ${absent.join(', ')}, so the recorded reachability model is stale`,
          );
        }
      }
    } else {
      rejectRecord(
        'independent reachability verification was not performed, so the accepted reachability model is unproven',
      );
    }

    if (!recordFailed) {
      const remainingDays = dayDifference(today, record.expires);
      accepted.push({
        expires: record.expires,
        id: record.id,
        identity,
        owner: record.owner,
        pathsTruncated: paths.length >= auditPathReportLimit,
        remainingDays,
        risk: record.risk,
      });
    }
  }

  for (const [key, record] of byKey) {
    if (!matchedKeys.has(key)) {
      failures.push(
        `stale acceptance ${record.id}: ${record.package} ${record.advisory} is no longer reported by the audit and must be removed`,
      );
    }
  }

  const status =
    failures.length > 0 ? 'fail' : accepted.length > 0 ? 'accepted' : 'pass';
  return { accepted, failures, informational, status };
}

function workspaceRootTokenMap(root) {
  const tokens = new Map();
  for (const workspaceRoot of ['apps', 'packages']) {
    const base = join(root, workspaceRoot);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(base, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      // pnpm audit reports the importer directory with separators doubled.
      tokens.set(manifest.name, `${workspaceRoot}__${entry.name}`);
    }
  }
  return tokens;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    raw: result.stdout,
    signal: result.signal,
    spawnError: result.error?.message,
    status: result.status,
    stderr: result.stderr,
  };
}

function runAudit() {
  return runCommand('pnpm', auditCommand);
}

/**
 * `pnpm why --recursive --json` returns the complete reverse-dependency tree,
 * which is not subject to the audit report's path truncation.
 */
function verifyReachability(record, knownWorkspaces) {
  const execution = runCommand('pnpm', [
    'why',
    record.package,
    '--recursive',
    '--json',
  ]);
  if (execution.spawnError !== undefined) {
    return {
      ok: false,
      reason: `pnpm why could not start: ${execution.spawnError}`,
    };
  }
  if (execution.status !== 0) {
    return {
      ok: false,
      reason: `pnpm why exited with status ${String(execution.status)}`,
    };
  }
  let trees;
  try {
    trees = JSON.parse(execution.raw);
  } catch (error) {
    return {
      ok: false,
      reason: `pnpm why output unparseable: ${error.message}`,
    };
  }
  if (!Array.isArray(trees)) {
    return { ok: false, reason: 'pnpm why output is not an array' };
  }
  const relevant = trees.filter(
    (tree) =>
      tree?.name === record.package && record.versions.includes(tree.version),
  );
  if (relevant.length === 0) {
    return {
      ok: false,
      reason: `pnpm why reported no installed ${record.package} matching accepted version(s) ${record.versions.join(', ')}`,
    };
  }
  const workspaces = new Set();
  const seen = new Set();
  const walk = (node) => {
    if (!isPlainObject(node)) return;
    const key = `${String(node.name)}@${String(node.version)}#${String(node.peersSuffixHash ?? '')}`;
    if (knownWorkspaces.has(node.name)) workspaces.add(node.name);
    if (node.circular === true || seen.has(key)) return;
    seen.add(key);
    for (const dependent of node.dependents ?? []) walk(dependent);
  };
  for (const tree of relevant) walk(tree);
  return { ok: true, workspaces: [...workspaces].sort() };
}

function auditExecutionProbes() {
  // These probe the real process and parser boundary, which is exactly where
  // the fail-open defect lived. Nothing here is mocked.
  const emit = (body, exitCode) =>
    `process.stdout.write(${JSON.stringify(body)}); process.exit(${String(exitCode)});`;
  const cases = [
    {
      expected: 'ok',
      name: 'successful audit with findings and non-zero exit',
      script: emit(
        JSON.stringify({
          advisories: {
            1: {
              findings: [
                { paths: ['apps__mobile>metro>image-size'], version: '1.2.1' },
              ],
              github_advisory_id: 'GHSA-w3rx-r6r6-pgpr',
              module_name: 'image-size',
              severity: 'high',
            },
          },
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 1,
              info: 0,
              low: 0,
              moderate: 0,
            },
          },
        }),
        1,
      ),
    },
    {
      expected: 'ok',
      name: 'successful clean audit',
      script: emit(
        JSON.stringify({
          advisories: {},
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 0,
              info: 0,
              low: 0,
              moderate: 0,
            },
          },
        }),
        0,
      ),
    },
    {
      expected: 'fail',
      name: 'registry or network failure reported as a top-level error',
      script: emit(
        JSON.stringify({
          error: {
            code: 'ERR_PNPM_FETCH_ECONNREFUSED',
            message: 'request to registry failed',
          },
        }),
        1,
      ),
    },
    {
      expected: 'fail',
      name: 'audit process emits no output',
      script: 'process.exit(1);',
    },
    {
      expected: 'fail',
      name: 'audit output is truncated JSON',
      script: emit('{"advisories":{},"metadata":{"vulnerabi', 0),
    },
    {
      expected: 'fail',
      name: 'audit output is not JSON at all',
      script: emit('ERR_PNPM_UNSUPPORTED_ENGINE', 1),
    },
    {
      expected: 'fail',
      name: 'audit report omits metadata',
      script: emit(JSON.stringify({ advisories: {} }), 0),
    },
    {
      expected: 'fail',
      name: 'audit report omits metadata.vulnerabilities',
      script: emit(JSON.stringify({ advisories: {}, metadata: {} }), 0),
    },
    {
      expected: 'fail',
      name: 'audit report has malformed vulnerability counts',
      script: emit(
        JSON.stringify({
          advisories: {},
          metadata: { vulnerabilities: { critical: 'none' } },
        }),
        0,
      ),
    },
    {
      expected: 'fail',
      name: 'audit report omits advisories',
      script: emit(
        JSON.stringify({
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 0,
              info: 0,
              low: 0,
              moderate: 0,
            },
          },
        }),
        0,
      ),
    },
    {
      expected: 'fail',
      name: 'audit report counts disagree with reported advisories',
      script: emit(
        JSON.stringify({
          advisories: {},
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 3,
              info: 0,
              low: 0,
              moderate: 0,
            },
          },
        }),
        0,
      ),
    },
    {
      expected: 'fail',
      name: 'advisory reported without dependency paths',
      script: emit(
        JSON.stringify({
          advisories: {
            1: {
              findings: [{ paths: [], version: '1.2.1' }],
              github_advisory_id: 'GHSA-w3rx-r6r6-pgpr',
              module_name: 'image-size',
              severity: 'high',
            },
          },
          metadata: {
            vulnerabilities: {
              critical: 0,
              high: 1,
              info: 0,
              low: 0,
              moderate: 0,
            },
          },
        }),
        0,
      ),
    },
  ];

  return cases.map((probe) => ({
    ...probe,
    actual: parseAuditReport(runCommand(process.execPath, ['-e', probe.script]))
      .ok
      ? 'ok'
      : 'fail',
  }));
}

function decisionProbes() {
  const workspaceRootTokens = new Map([
    ['@velora/api', 'apps__api'],
    ['@velora/mobile', 'apps__mobile'],
  ]);
  const baseRecord = {
    advisory: 'GHSA-w3rx-r6r6-pgpr',
    compensatingControls: ['control'],
    decisionDate: '2026-08-13',
    dependencyPath: 'metro>image-size',
    expires: '2026-09-30',
    id: 'VRA-2026-001',
    impact: 'impact',
    owner: 'Founder',
    package: 'image-size',
    reachability: 'reachability',
    reachableWorkspaces: ['@velora/mobile'],
    remediation: 'remediation',
    reviewTriggers: ['trigger'],
    risk: 'risk',
    severity: 'high',
    status: acceptedStatus,
    versions: ['1.2.1'],
  };
  const baseAdvisory = {
    findings: [
      {
        paths: ['apps__mobile>expo>@expo/cli>@expo/metro>metro>image-size'],
        version: '1.2.1',
      },
    ],
    github_advisory_id: 'GHSA-w3rx-r6r6-pgpr',
    module_name: 'image-size',
    severity: 'high',
  };
  const mobileOnly = () => ({ ok: true, workspaces: ['@velora/mobile'] });
  const today = '2026-08-13';

  return [
    { advisories: [], acceptances: [], expected: 'pass', name: 'clean audit' },
    {
      acceptances: [baseRecord],
      advisories: [baseAdvisory],
      expected: 'accepted',
      name: 'exact accepted advisory',
    },
    {
      acceptances: [],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'unknown high advisory',
    },
    {
      acceptances: [],
      advisories: [{ ...baseAdvisory, severity: 'critical' }],
      expected: 'fail',
      name: 'unknown critical advisory',
    },
    {
      acceptances: [baseRecord],
      advisories: [
        {
          ...baseAdvisory,
          findings: [
            {
              paths: ['apps__mobile>expo>metro>image-size'],
              version: '1.2.2',
            },
          ],
        },
      ],
      expected: 'fail',
      name: 'wrong vulnerable version',
    },
    {
      acceptances: [{ ...baseRecord, expires: '2026-08-12' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'expired acceptance',
    },
    {
      acceptances: [{ ...baseRecord, advisory: 'GHSA-aaaa-bbbb-cccc' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'wrong advisory identifier',
    },
    {
      acceptances: [baseRecord],
      advisories: [],
      expected: 'fail',
      name: 'stale acceptance after advisory removal',
    },
    {
      acceptances: [{ ...baseRecord, owner: '' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'acceptance without owner',
    },
    {
      acceptances: [{ ...baseRecord, decisionDate: 'yesterday' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'acceptance without valid decision date',
    },
    {
      acceptances: [{ ...baseRecord, reachability: '' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'acceptance without recorded reason',
    },
    {
      acceptances: [{ ...baseRecord, severity: 'moderate' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'severity drift away from the accepted state',
    },
    {
      acceptances: [{ ...baseRecord, dependencyPath: 'rollup>image-size' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'dependency chain no longer matches',
    },
    {
      acceptances: [{ ...baseRecord, versions: ['*'] }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'wildcard version acceptance',
    },
    {
      acceptances: [{ ...baseRecord, dependencyPath: 'image-size' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'single-segment dependency chain is too ambiguous to authorise',
    },
    {
      acceptances: [{ ...baseRecord, dependencyPath: '*>image-size' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'wildcard dependency chain',
    },
    {
      acceptances: [baseRecord],
      advisories: [
        {
          ...baseAdvisory,
          findings: [
            {
              paths: [
                'apps__mobile>expo>@expo/cli>@expo/metro>metro>image-size',
                'apps__api>elysia>image-size',
              ],
              version: '1.2.1',
            },
          ],
        },
      ],
      expected: 'fail',
      name: 'accepted build-time path plus a new runtime path',
    },
    {
      acceptances: [baseRecord],
      advisories: [
        {
          ...baseAdvisory,
          findings: [
            {
              paths: ['apps__api>drizzle-kit>metro>image-size'],
              version: '1.2.1',
            },
          ],
        },
      ],
      expected: 'fail',
      name: 'accepted chain reached from an unaccepted workspace root',
    },
    {
      acceptances: [baseRecord],
      advisories: [{ ...baseAdvisory, findings: [] }],
      expected: 'fail',
      name: 'advisory with no findings cannot validate reachability',
    },
    {
      acceptances: [baseRecord],
      advisories: [
        {
          ...baseAdvisory,
          findings: [{ paths: [], version: '1.2.1' }],
        },
      ],
      expected: 'fail',
      name: 'advisory with no dependency paths cannot validate reachability',
    },
    {
      acceptances: [{ ...baseRecord, expires: '2999-12-31' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'effectively permanent acceptance horizon',
    },
    {
      acceptances: [{ ...baseRecord, expires: '2026-11-12' }],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'acceptance horizon one day beyond the maximum',
    },
    {
      acceptances: [{ ...baseRecord, expires: '2026-11-11' }],
      advisories: [baseAdvisory],
      expected: 'accepted',
      name: 'acceptance horizon exactly at the maximum',
    },
    {
      acceptances: [
        { ...baseRecord, reachableWorkspaces: ['@velora/nonexistent'] },
      ],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'acceptance naming a workspace that does not exist',
    },
    {
      acceptances: [baseRecord],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'independent reachability contradicts the accepted workspaces',
      reachabilityLookup: () => ({
        ok: true,
        workspaces: ['@velora/api', '@velora/mobile'],
      }),
    },
    {
      acceptances: [baseRecord],
      advisories: [baseAdvisory],
      expected: 'fail',
      name: 'independent reachability verification unavailable',
      reachabilityLookup: () => ({ ok: false, reason: 'pnpm why failed' }),
    },
    {
      acceptances: [],
      advisories: [
        {
          ...baseAdvisory,
          github_advisory_id: 'GHSA-w5hq-g745-h8pq',
          module_name: 'uuid',
          severity: 'moderate',
        },
      ],
      expected: 'pass',
      name: 'unaccepted moderate advisory below gate threshold',
    },
  ].map((probe) => ({
    ...probe,
    actual: evaluateDependencySecurity({
      acceptances: probe.acceptances,
      advisories: probe.advisories,
      reachabilityLookup: probe.reachabilityLookup ?? mobileOnly,
      today,
      workspaceRootTokens,
    }).status,
  }));
}

function printRawEvidence(report, advisories) {
  console.log(`RAW AUDIT EVIDENCE (pnpm ${auditCommand.join(' ')})`);
  console.log(`metadata: ${JSON.stringify(report.metadata)}`);
  for (const advisory of advisories) {
    const findings = advisory.findings ?? [];
    const versions = [...new Set(findings.map((finding) => finding.version))];
    const paths = findings.flatMap((finding) => finding.paths ?? []);
    console.log(
      [
        `advisory=${advisory.github_advisory_id}`,
        `package=${advisory.module_name}`,
        `installed=${versions.join(',')}`,
        `severity=${advisory.severity}`,
        `vulnerable=${advisory.vulnerable_versions}`,
        `patched=${advisory.patched_versions}`,
        `paths=${String(paths.length)}${paths.length >= auditPathReportLimit ? ' (truncated by pnpm)' : ''}`,
        `url=${advisory.url}`,
      ].join(' '),
    );
    console.log(`  title: ${advisory.title}`);
    if (paths[0] !== undefined) console.log(`  path: ${paths[0]}`);
  }
}

function reportFailure(heading, lines) {
  console.log('');
  console.log(heading);
  for (const line of lines) console.error(`  ${line}`);
  console.log('');
  console.log('DEPENDENCY SECURITY:');
  console.log('FAIL');
  process.exitCode = 1;
}

function main() {
  const executionProbes = auditExecutionProbes();
  const probes = [...executionProbes, ...decisionProbes()];
  const failedProbes = probes.filter(
    (probe) => probe.actual !== probe.expected,
  );
  for (const probe of failedProbes) {
    console.error(
      `dependency security self-test failed: ${probe.name} expected ${probe.expected}, got ${probe.actual}`,
    );
  }
  if (failedProbes.length > 0) {
    reportFailure('SELF-TEST FAILURE', [
      `${String(failedProbes.length)} of ${String(probes.length)} gate probes did not behave as specified`,
    ]);
    return;
  }
  console.log(
    `Dependency security gate self-test passed for ${String(probes.length)} probes (${String(executionProbes.length)} against the real audit process and parser boundary).`,
  );
  for (const probe of probes) {
    console.log(`  probe: ${probe.name} -> ${probe.expected}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const parsed = parseAuditReport(runAudit());
  if (!parsed.ok) {
    reportFailure('AUDIT EXECUTION FAILURE', [
      parsed.failure,
      'A vulnerability audit that could not be completed is not evidence of zero vulnerabilities.',
    ]);
    return;
  }
  console.log('');
  console.log('AUDIT EXECUTION: OK');
  printRawEvidence(parsed.report, parsed.advisories);

  let acceptances;
  try {
    acceptances = parseAcceptanceRegister(readFileSync(registerPath, 'utf8'));
  } catch (error) {
    reportFailure('ACCEPTANCE REGISTER FAILURE', [
      `acceptance register unreadable: ${error.message}`,
    ]);
    return;
  }

  const workspaceRootTokens = workspaceRootTokenMap(process.cwd());
  const knownWorkspaces = new Set(workspaceRootTokens.keys());
  const reachabilityCache = new Map();
  const result = evaluateDependencySecurity({
    acceptances,
    advisories: parsed.advisories,
    reachabilityLookup: (record) => {
      const cacheKey = `${record.package}@${record.versions.join(',')}`;
      if (!reachabilityCache.has(cacheKey)) {
        reachabilityCache.set(
          cacheKey,
          verifyReachability(record, knownWorkspaces),
        );
      }
      return reachabilityCache.get(cacheKey);
    },
    today,
    workspaceRootTokens,
  });

  console.log('');
  for (const entry of result.accepted) {
    console.log(
      `ACCEPTED TEMPORARY RISK ${entry.id} (${entry.risk}): ${entry.identity} accepted by ${entry.owner} until ${entry.expires} (${String(entry.remainingDays)} days remaining)`,
    );
    if (entry.pathsTruncated) {
      console.log(
        `  pnpm truncated the reported dependency paths; reachability was verified independently from the complete reverse-dependency graph`,
      );
    }
    if (entry.remainingDays <= expiryWarningDays) {
      console.log(
        `  acceptance ${entry.id} expires within ${String(expiryWarningDays)} days and must be re-decided or remediated`,
      );
    }
  }
  for (const entry of result.informational) {
    console.log(`BELOW THRESHOLD: ${entry}`);
  }

  if (result.status === 'fail') {
    reportFailure('UNACCEPTED VULNERABILITY OR INVALID ACCEPTANCE', [
      ...new Set(result.failures),
    ]);
    return;
  }

  console.log('');
  if (result.status === 'accepted') {
    console.log('DEPENDENCY SECURITY:');
    console.log('PASS WITH EXPLICIT TEMPORARY ACCEPTED RISK');
    return;
  }
  console.log('CLEAN AUDIT: no advisory requires an acceptance record.');
  console.log('');
  console.log('DEPENDENCY SECURITY:');
  console.log('PASS');
}

if (import.meta.filename === process.argv[1]) {
  main();
}
