import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const adrPath =
  'docs/decisions/ADR-0017-auth-session-recovery-security-policy.md';
const documentationRoot = 'docs';
/**
 * The one module allowed to state a locked value in code. Everything else in
 * the API must derive from it, so a constant cannot drift into a service, a
 * route, or a client.
 */
const policyModulePath = 'apps/api/src/auth/policy.ts';
const apiSourceRoot = 'apps/api/src';

/**
 * The locked baseline. It is deliberately a second, independent copy of the
 * values in ADR-0017: a drift test that reads its expectations from the
 * document it is checking would assert nothing. Changing a value here without
 * amending ADR-0017 fails, and so does the reverse.
 */
const lockedPolicy = {
  breakGlass: {
    accounts: 2,
    maximumElevation: '30m',
    postEventReview: '24h',
  },
  policyVersion: 1,
  recovery: {
    highImpactCooldown: '24h',
    perAccountPerDay: 5,
    perAccountPerHour: 3,
    perIpPerHour: 10,
    revokesPriorSessions: true,
    tokenExpiry: '15m',
  },
  sessions: {
    consumerMobile: {
      accessToken: '10m',
      refreshAbsolute: '90d',
      refreshIdle: '30d',
      refreshStorage: 'hash-only',
      refreshUse: 'single-use-rotating',
      reuseResponse: 'revoke-family',
    },
    consumerWeb: {
      absolute: '30d',
      cookieAttributes: [
        'Secure',
        'HttpOnly',
        'Path=/',
        'no-Domain',
        'SameSite=Lax',
      ],
      cookiePrefix: '__Host-',
      idle: '14d',
      mechanism: 'opaque',
      serverStorage: 'hash-only',
    },
    creatorStudio: {
      absolute: '7d',
      idle: '8h',
      mechanism: 'opaque',
      serverStorage: 'hash-only',
    },
    platformAdmin: {
      absolute: '8h',
      authenticatorsBeforeProduction: 2,
      idle: '15m',
      privilegedMfa: 'webauthn-or-passkey',
      stepUpAssuranceAge: '5m',
    },
  },
};

/**
 * Binds the machine-readable block to the human tables it projects. Editing one
 * without the other is the drift this exists to catch.
 */
const requiredProse = [
  '| Idle timeout | 14 days |',
  '| Absolute lifetime | 30 days |',
  '| Idle timeout | 8 hours |',
  '| Absolute lifetime | 7 days |',
  '| Access token | Signed, audience-bound, 10-minute lifetime |',
  '| Refresh family idle timeout | 30 days |',
  '| Refresh family absolute lifetime | 90 days |',
  '| Refresh use | Single-use, rotated on every successful refresh |',
  '| Refresh storage | Hash only in PostgreSQL |',
  '| Recovery token expiry | 15 minutes |',
  '| Per account or destination | 3 per hour, 5 per day |',
  '| Per IP or device baseline | 10 per hour |',
  '| Idle timeout | 15 minutes |',
  '| Absolute lifetime | 8 hours |',
  '| Step-up assurance age for high-impact actions | 5 minutes maximum |',
  '| Server storage | Hash only; plaintext token never persisted |',
  '`__Host-` prefix with `Secure`, `HttpOnly`, `Path=/`, no `Domain` attribute, and `SameSite=Lax`',
  'Phishing-resistant WebAuthn or passkey MFA is mandatory',
  'Two independently stored authenticators are enrolled before production privileged access',
  'revokes the entire refresh family',
  'Successful recovery revokes all previous sessions',
  'A 24-hour cooldown applies afterwards',
  'Two named emergency accounts are prepared',
  'Maximum elevation is 30 minutes',
  'Post-event review happens within 24 hours',
];

/**
 * A locked value restated in another document is unbound truth. These phrases
 * are only normative when they sit next to an authentication concept, so the
 * scan requires both on the same line.
 */
const lockedValuePhrases = [
  '14 days',
  '30 days',
  '90 days',
  '8 hours',
  '7 days',
  '15 minutes',
  '10 minutes',
  '10-minute',
  '5 minutes',
  '30 minutes',
  '30-minute',
  '24 hours',
  '24-hour',
  '3 per hour',
  '5 per day',
  '10 per hour',
];
const authenticationKeywords = [
  'session',
  'idle timeout',
  'absolute lifetime',
  'refresh',
  'access token',
  'recovery',
  'step-up',
  'break-glass',
  'elevation',
  'cooldown',
  'authenticator',
];

/**
 * Exact bindings the policy module must contain. They are literal because a
 * value that is computed cannot be compared against the ADR by inspection, and
 * each is matched with a terminator so `3` cannot be satisfied by `30`.
 */
const requiredCodeBindings = [
  ['consumerMobileAccessToken', "'10m'"],
  ['consumerMobileRefreshAbsolute', "'90d'"],
  ['consumerMobileRefreshIdle', "'30d'"],
  ['consumerWebAbsolute', "'30d'"],
  ['consumerWebIdle', "'14d'"],
  ['creatorStudioAbsolute', "'7d'"],
  ['creatorStudioIdle', "'8h'"],
  ['platformAdminAbsolute', "'8h'"],
  ['platformAdminIdle', "'15m'"],
  ['recoveryHighImpactCooldown', "'24h'"],
  ['recoveryTokenExpiry', "'15m'"],
  ['stepUpAssuranceAge', "'5m'"],
  ['recoveryPerAccountPerDay', '5'],
  ['recoveryPerAccountPerHour', '3'],
  ['recoveryPerRequesterPerHour', '10'],
];

function bindingPattern(key, value) {
  const escaped = `${key}: ${value}`.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    String.raw`\$&`,
  );
  return new RegExp(`${escaped}(?![\\w'])`, 'u');
}

/** Duration literals no other API source file may contain. */
const lockedCodeLiterals = [
  "'14d'",
  "'30d'",
  "'90d'",
  "'8h'",
  "'7d'",
  "'15m'",
  "'10m'",
  "'5m'",
  "'24h'",
];

const failures = [];

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function parsePolicyBlock(markdown) {
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map(
    (match) => match[1],
  );
  if (blocks.length !== 1) {
    throw new Error(
      `${adrPath} must contain exactly one machine-readable JSON block; found ${String(blocks.length)}`,
    );
  }
  return JSON.parse(blocks[0]);
}

function compare(expected, actual, path) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(`${path} must be an array`);
      return;
    }
    if (expected.length !== actual.length) {
      failures.push(
        `${path} must list exactly ${String(expected.length)} entries; found ${String(actual.length)}`,
      );
      return;
    }
    expected.forEach((entry, index) => {
      compare(entry, actual[index], `${path}[${String(index)}]`);
    });
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') {
      failures.push(`${path} must be an object`);
      return;
    }
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (expectedKeys.join(',') !== actualKeys.join(',')) {
      failures.push(
        `${path} must declare exactly [${expectedKeys.join(', ')}]; found [${actualKeys.join(', ')}]`,
      );
      return;
    }
    for (const key of expectedKeys) {
      compare(expected[key], actual[key], `${path}.${key}`);
    }
    return;
  }
  if (expected !== actual) {
    failures.push(
      `${path} is locked to ${JSON.stringify(expected)} but ADR-0017 declares ${JSON.stringify(actual)}`,
    );
  }
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

const adrSource = readFileSync(adrPath, 'utf8');

let declared;
try {
  declared = parsePolicyBlock(adrSource);
} catch (error) {
  console.error(`AUTH POLICY FAILURE: ${error.message}`);
  console.log('');
  console.log('AUTH POLICY ASSERTIONS:');
  console.log('FAIL');
  process.exitCode = 1;
}

if (declared !== undefined) {
  compare(lockedPolicy, declared, 'authPolicy');

  for (const phrase of requiredProse) {
    if (!adrSource.includes(phrase)) {
      failures.push(
        `${adrPath} no longer states "${phrase}", so the machine-readable block is unbound from its human authority`,
      );
    }
  }

  for (const file of markdownFiles(documentationRoot)) {
    const relativePath = relative(process.cwd(), file);
    if (relativePath === adrPath) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      const lowered = line.toLowerCase();
      if (!authenticationKeywords.some((word) => lowered.includes(word))) {
        continue;
      }
      for (const phrase of lockedValuePhrases) {
        if (lowered.includes(phrase)) {
          failures.push(
            `${relativePath}:${String(index + 1)} restates the locked value "${phrase}" in an authentication context; point at ADR-0017 instead of duplicating it`,
          );
        }
      }
    }
  }

  if (!existsSync(policyModulePath)) {
    failures.push(
      `${policyModulePath} is missing, so no code projection of ADR-0017 can be verified`,
    );
  } else {
    const policySource = readFileSync(policyModulePath, 'utf8');
    for (const [key, value] of requiredCodeBindings) {
      if (!bindingPattern(key, value).test(policySource)) {
        failures.push(
          `${policyModulePath} no longer declares \`${key}: ${value}\`, so the runtime has drifted from ADR-0017`,
        );
      }
    }
    for (const file of sourceFiles(apiSourceRoot)) {
      const relativePath = relative(process.cwd(), file);
      if (relativePath === policyModulePath) continue;
      const source = readFileSync(file, 'utf8');
      for (const literal of lockedCodeLiterals) {
        if (source.includes(literal)) {
          failures.push(
            `${relativePath} states the locked duration ${literal}; derive it from ${policyModulePath} instead`,
          );
        }
      }
    }
  }

  const counts = [
    ['sessions', Object.keys(lockedPolicy.sessions).length],
    ['recovery', Object.keys(lockedPolicy.recovery).length],
    ['breakGlass', Object.keys(lockedPolicy.breakGlass).length],
  ];

  if (failures.length > 0) {
    for (const failure of [...new Set(failures)]) {
      console.error(`AUTH POLICY FAILURE: ${failure}`);
    }
    console.log('');
    console.log('AUTH POLICY ASSERTIONS:');
    console.log('FAIL');
    process.exitCode = 1;
  } else {
    console.log(
      `AUTH policy assertions passed: ${counts
        .map(([name, size]) => `${String(size)} ${name} values`)
        .join(
          ', ',
        )} match ADR-0017, ${String(requiredProse.length)} prose bindings intact, ${String(requiredCodeBindings.length)} code bindings intact in ${policyModulePath}, and no other document or API source restates a locked value.`,
    );
    console.log('');
    console.log('AUTH POLICY ASSERTIONS:');
    console.log('PASS');
  }
}
