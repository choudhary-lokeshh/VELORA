import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  livekitRtcProvider,
  loadServerConfig,
  localAccessTokenSigner,
  localIdentityProvider,
  localRecoveryDelivery,
  localTestOperatorBootstrap,
  localTestPrivilegedVerifier,
  redactServerConfig,
  unavailablePrivilegedVerifier,
  type ServerConfig,
} from '@velora/config/server';
import { Redis } from 'ioredis';

/**
 * What this environment is, and what it cannot yet do.
 *
 * Read-only and safe to run against anything. It opens a connection, counts
 * some rows, and closes them; it starts nothing, changes nothing, and writes
 * nothing. Every line it prints is either a configured selection or an answer a
 * dependency actually gave — there is no branch that reports a provider healthy
 * because an environment variable was present, which is the failure an
 * operations screen must never commit.
 *
 * It never prints a secret. The configuration it reports comes from
 * `redactServerConfig`, which publishes selections and presence booleans and no
 * value that would matter if it reached a log.
 *
 * The exit code is the whole of its opinion: non-zero when something would stop
 * this environment serving, zero when the remaining gaps are provider decisions
 * an owner has not made. A staging deployment with no payment provider is
 * healthy; one whose database is three migrations behind is not.
 */

type Severity = 'blocking' | 'note' | 'ok';

interface Finding {
  readonly detail: string;
  readonly name: string;
  readonly severity: Severity;
}

const findings: Finding[] = [];

function report(severity: Severity, name: string, detail: string): void {
  findings.push({ detail, name, severity });
}

const applicationRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationsFolder = resolve(applicationRoot, 'drizzle');

function journalEntries(): readonly {
  readonly tag: string;
  readonly when: number;
}[] {
  const journal: unknown = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  );
  return (
    (journal as { entries?: readonly { tag: string; when: number }[] })
      .entries ?? []
  );
}

function checkJournal(): number {
  const entries = journalEntries();
  let previous = -1;
  for (const entry of entries) {
    if (entry.when <= previous) {
      report(
        'blocking',
        'migration journal',
        `${entry.tag} is stamped no later than the one before it, so every migration after it would be skipped`,
      );
      return entries.length;
    }
    previous = entry.when;
  }
  report(
    'ok',
    'migration journal',
    `${String(entries.length)} migrations, timestamps strictly increasing`,
  );
  return entries.length;
}

async function checkDatabase(
  config: ServerConfig,
  expectedMigrations: number,
): Promise<void> {
  const client = new Bun.SQL(config.DATABASE_URL, {
    connectionTimeout: 5,
    max: 1,
  });
  try {
    const applied: readonly { readonly total: number }[] = await client`
      select count(*)::int as total from drizzle.__drizzle_migrations
    `;
    const total = applied[0]?.total ?? 0;
    if (total === expectedMigrations) {
      report(
        'ok',
        'database',
        `reachable, ${String(total)} of ${String(expectedMigrations)} migrations applied`,
      );
    } else {
      report(
        'blocking',
        'database',
        `reachable, but ${String(total)} of ${String(expectedMigrations)} migrations are applied; this build expects the schema it ships`,
      );
    }
    await checkFirstOperator(client, config);
  } catch (error) {
    report(
      'blocking',
      'database',
      `unreachable: ${error instanceof Error ? error.message : 'unknown failure'}`,
    );
  } finally {
    await client.close();
  }
}

/**
 * Who can operate this deployment, said in counts rather than identities.
 *
 * An operator's account reference is not printed. What an operator running this
 * needs to know is whether anybody holds a grant and whether the one-time door
 * is still open, and both are numbers.
 */
async function checkFirstOperator(
  client: Bun.SQL,
  config: ServerConfig,
): Promise<void> {
  const grants: readonly { readonly total: number }[] = await client`
    select count(*)::int as total
    from operations_operator_grants
    where revoked_at is null
  `;
  const live = grants[0]?.total ?? 0;
  const bootstraps: readonly { readonly total: number }[] = await client`
    select count(*)::int as total from operations_operator_bootstraps
  `;
  const consumed = (bootstraps[0]?.total ?? 0) > 0;

  if (live > 0) {
    report(
      'ok',
      'first operator',
      `${String(live)} operator${live === 1 ? '' : 's'} hold a grant; the bootstrap is ${consumed ? 'consumed' : 'unused and refused while a grant exists'}`,
    );
    return;
  }
  if (consumed) {
    report(
      'blocking',
      'first operator',
      'the bootstrap was consumed and no live grant remains, so nobody can operate this deployment and the door does not reopen',
    );
    return;
  }
  const deployed =
    config.APP_ENV === 'staging' || config.APP_ENV === 'production';
  const tokenConfigured = config.ADMIN_OPERATOR_BOOTSTRAP_TOKEN !== undefined;
  report(
    deployed && !tokenConfigured ? 'blocking' : 'note',
    'first operator',
    tokenConfigured
      ? 'nobody holds a grant yet and the bootstrap secret is configured, so the first grant can be taken once'
      : 'nobody holds a grant and no bootstrap secret is configured, so nobody can become an operator',
  );
}

async function checkRedis(name: string, url: string): Promise<void> {
  const client = new Redis(url, {
    connectTimeout: 5_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    await client.ping();
    report('ok', name, 'reachable');
  } catch (error) {
    report(
      'blocking',
      name,
      `unreachable: ${error instanceof Error ? error.message : 'unknown failure'}`,
    );
  } finally {
    client.disconnect();
  }
}

function checkAuth(config: ServerConfig): void {
  const deployed =
    config.APP_ENV === 'staging' || config.APP_ENV === 'production';
  const redacted = redactServerConfig(config);

  report(
    config.AUTH_IDENTITY_PROVIDER === localIdentityProvider && deployed
      ? 'blocking'
      : 'ok',
    'identity provider',
    `${config.AUTH_IDENTITY_PROVIDER}; credentials ${redacted.identityProviderCredentialsConfigured ? 'configured' : 'absent'}`,
  );
  report(
    config.AUTH_ACCESS_TOKEN_SIGNER === localAccessTokenSigner && deployed
      ? 'blocking'
      : 'ok',
    'access token signer',
    `${config.AUTH_ACCESS_TOKEN_SIGNER}; key ${redacted.accessTokenSigningKeyConfigured ? 'configured' : 'absent, so an ephemeral one is generated per process'}; ${String(redacted.accessTokenVerificationKeyCount)} retired verification key${redacted.accessTokenVerificationKeyCount === 1 ? '' : 's'}`,
  );
  report(
    config.AUTH_RECOVERY_DELIVERY === localRecoveryDelivery && deployed
      ? 'blocking'
      : 'ok',
    'recovery delivery',
    `${config.AUTH_RECOVERY_DELIVERY}; submission ${redacted.recoveryDeliveryConfigured ? 'configured' : 'absent'}`,
  );
  const weakVerifier =
    config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER ===
      unavailablePrivilegedVerifier ||
    config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER ===
      localTestPrivilegedVerifier;
  report(
    weakVerifier && deployed ? 'blocking' : 'ok',
    'privileged verifier',
    `${config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER}; relying party ${redacted.privilegedVerifierConfigured ? 'configured' : 'absent'}`,
  );
  report(
    config.ADMIN_OPERATOR_BOOTSTRAP === localTestOperatorBootstrap && deployed
      ? 'blocking'
      : 'ok',
    'operator standing',
    config.ADMIN_OPERATOR_BOOTSTRAP,
  );
}

function checkOrigins(config: ServerConfig): void {
  for (const [name, origins] of [
    ['consumer web origins', config.AUTH_BROWSER_ORIGINS_CONSUMER_WEB],
    ['creator studio origins', config.AUTH_BROWSER_ORIGINS_CREATOR_STUDIO],
    ['platform admin origins', config.AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN],
  ] as const) {
    report(
      origins.length === 0 ? 'note' : 'ok',
      name,
      origins.length === 0
        ? 'none allowed, so that audience cannot start a browser session'
        : origins.join(', '),
    );
  }
  report('ok', 'api origin', config.VELORA_API_BASE_URL);
  report(
    'ok',
    'public web origin',
    config.WEB_PUBLIC_ORIGIN ?? 'none declared, so nothing is indexable',
  );
  report(
    'ok',
    'indexing',
    config.APP_ENV === 'production' && config.WEB_PUBLIC_ORIGIN !== undefined
      ? 'permitted: this is production and a public origin is declared'
      : 'refused: indexing needs production and a declared public origin, and one of them is absent',
  );
}

function checkProviders(config: ServerConfig): void {
  const redacted = redactServerConfig(config);
  report(
    'note',
    'rtc',
    config.REALTIME_RTC_PROVIDER === livekitRtcProvider
      ? `${config.REALTIME_RTC_PROVIDER}; credentials ${redacted.rtcProviderCredentialsConfigured ? 'configured' : 'absent'}. Server-API authentication is proved by \`pnpm rtc:doctor\`; media is proved only by the live-provider end-to-end spec`
      : `${config.REALTIME_RTC_PROVIDER}; no call can be carried`,
  );
  for (const [name, value] of [
    ['media storage', config.MEDIA_STORAGE_PROVIDER],
    ['media scanner', config.MEDIA_MALWARE_SCANNER],
    ['payments', config.BILLING_PAYMENT_PROVIDER],
    ['payouts', config.PAYOUTS_PROVIDER],
    ['notifications', config.NOTIFICATIONS_DELIVERY_CHANNEL],
    ['identity verification', config.IDENTITY_VERIFICATION_PROVIDER],
    ['coin ledger', config.WALLET_COIN_LEDGER],
    ['ai', config.AI_PROVIDER],
  ] as const) {
    report('note', name, value);
  }
  report(
    'note',
    'worker',
    'a separate process. This command does not start one and cannot see one; its liveness belongs to whatever supervises it',
  );
  report(
    'note',
    'release',
    config.RELEASE_SHA ??
      'not declared, so a report from this environment names no build',
  );
  report(
    'note',
    'trusted proxies',
    config.TRUSTED_PROXY_HOP_COUNT === 0
      ? 'none; X-Forwarded-For is ignored entirely'
      : `${String(config.TRUSTED_PROXY_HOP_COUNT)} hop(s); the client address is read that far from the right`,
  );
}

/**
 * One line per refusal.
 *
 * The loader raises a single error carrying every issue it found, and printing
 * it as one line produces a paragraph nobody reads at the moment they most need
 * to. Each refusal already names the field and says what to do about it, so
 * they are worth a line each.
 */
function configurationRefusals(error: unknown): readonly string[] {
  const { issues } = error as {
    readonly issues?: readonly { readonly message?: string }[];
  };
  if (issues !== undefined && issues.length > 0) {
    return issues.map((issue) => issue.message ?? 'configuration refused');
  }
  return [
    error instanceof Error
      ? error.message.replaceAll('\n', ' ')
      : 'configuration refused',
  ];
}

async function run(): Promise<void> {
  let config: ServerConfig;
  try {
    config = loadServerConfig(process.env);
  } catch (error) {
    process.stdout.write('VELORA deployment doctor\n\n');
    for (const refusal of configurationRefusals(error)) {
      process.stdout.write(`  BLOCKING  ${refusal}\n`);
    }
    process.stdout.write(
      '\nConfiguration did not load, so nothing else could be asked.\n',
    );
    process.exitCode = 1;
    return;
  }

  report('ok', 'environment', config.APP_ENV);
  checkAuth(config);
  checkOrigins(config);
  checkProviders(config);
  const expected = checkJournal();
  await checkDatabase(config, expected);
  await checkRedis('ephemeral redis', config.EPHEMERAL_REDIS_URL);
  await checkRedis('queue redis', config.QUEUE_REDIS_URL);

  process.stdout.write('VELORA deployment doctor\n\n');
  const width = Math.max(...findings.map((finding) => finding.name.length));
  for (const finding of findings) {
    const label =
      finding.severity === 'blocking'
        ? 'BLOCKING'
        : finding.severity === 'note'
          ? '    note'
          : '      ok';
    process.stdout.write(
      `  ${label}  ${finding.name.padEnd(width)}  ${finding.detail}\n`,
    );
  }

  const blocking = findings.filter(
    (finding) => finding.severity === 'blocking',
  );
  process.stdout.write(
    blocking.length === 0
      ? '\nNothing here would stop this environment serving. Every remaining gap is a provider decision.\n'
      : `\n${String(blocking.length)} blocking finding${blocking.length === 1 ? '' : 's'}. This environment cannot serve as configured.\n`,
  );
  if (blocking.length > 0) process.exitCode = 1;
}

await run();
