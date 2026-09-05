import type { ServerConfig } from '@velora/config/server';

/**
 * Every dependency's readiness, in the only four words that are ever true.
 *
 * The distinction this module exists for is between *unconfigured* and
 * *unavailable*. Most of VELORA's provider seams are deliberately switched off
 * — no payment provider is approved, no identity verifier is approved, no
 * notification channel is approved — and reporting those as failures would fill
 * an operator's screen with alarms about decisions that were made on purpose.
 * They are unconfigured, which is a true and calm statement about the platform.
 *
 * The second distinction is between *healthy* and *unknown*. A handle this
 * process can actually ask — the database, either Redis — reports what it
 * answered. An in-process deterministic adapter reports healthy, because there
 * is no network between here and it and nothing to be wrong. A real remote
 * provider reports `unknown`, because this process has not asked it and saying
 * otherwise would be reporting health with no evidence, which is exactly the
 * failure an operations screen must never commit.
 */

export interface DependencyReadiness {
  readonly adapter?: string | undefined;
  readonly name: string;
  readonly state: 'healthy' | 'unavailable' | 'unconfigured' | 'unknown';
}

export interface ReadinessHandle {
  isReady(): Promise<boolean>;
}

/**
 * The configured values that mean "nobody approved one of these".
 *
 * A closed list rather than a substring test, because a provider named
 * `unavailable-fallback` would pass a substring test and be reported as
 * switched off while it was in fact running.
 */
const absentAdapters = new Set(['unavailable', 'unpublished', 'disabled']);

/**
 * The configured values that name an adapter with no network behind it.
 *
 * These are deterministic, in-process, and refused outside local and test by
 * configuration. There is nothing between this process and them that can fail,
 * so `healthy` is a fact rather than an assumption.
 */
const inProcessAdapters = new Set([
  'enabled',
  'local',
  'local-test',
  'local-development-ed25519',
  'local-test-privileged',
  'open',
  'composed',
  'redis',
  'trust-and-safety',
]);

function adapterState(value: string): DependencyReadiness['state'] {
  if (absentAdapters.has(value)) return 'unconfigured';
  if (inProcessAdapters.has(value)) return 'healthy';
  // A real remote provider this process has not spoken to. Neither healthy nor
  // failing: unknown, which is the only honest answer to a question nobody
  // asked.
  return 'unknown';
}

async function handleState(
  handle: ReadinessHandle,
): Promise<DependencyReadiness['state']> {
  try {
    return (await handle.isReady()) ? 'healthy' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Asks everything this process can actually ask, and reports configuration for
 * everything it cannot.
 *
 * The three handles are probed in parallel and never throw: a readiness screen
 * that failed because one dependency was down would be useless in precisely the
 * situation it exists for.
 */
export async function resolveDependencyReadiness(input: {
  readonly config: ServerConfig;
  readonly database: ReadinessHandle;
  readonly ephemeralRedis: ReadinessHandle;
  readonly queueRedis: ReadinessHandle;
}): Promise<readonly DependencyReadiness[]> {
  const [database, ephemeral, queue] = await Promise.all([
    handleState(input.database),
    handleState(input.ephemeralRedis),
    handleState(input.queueRedis),
  ]);

  const configured: readonly {
    readonly name: string;
    readonly value: string;
  }[] = [
    { name: 'rtc provider', value: input.config.REALTIME_RTC_PROVIDER },
    { name: 'rtc signalling', value: input.config.REALTIME_SIGNAL_TRANSPORT },
    { name: 'live discovery', value: input.config.LIVE_DISCOVERY_MODE },
    { name: 'payment provider', value: input.config.BILLING_PAYMENT_PROVIDER },
    { name: 'payout provider', value: input.config.PAYOUTS_PROVIDER },
    {
      name: 'notification channel',
      value: input.config.NOTIFICATIONS_DELIVERY_CHANNEL,
    },
    { name: 'media storage', value: input.config.MEDIA_STORAGE_PROVIDER },
    { name: 'media scanner', value: input.config.MEDIA_MALWARE_SCANNER },
    {
      name: 'identity verification',
      value: input.config.IDENTITY_VERIFICATION_PROVIDER,
    },
    { name: 'coin ledger', value: input.config.WALLET_COIN_LEDGER },
    {
      name: 'coin acquisition (android)',
      value: input.config.WALLET_ANDROID_ACQUISITION,
    },
    {
      name: 'coin acquisition (web)',
      value: input.config.WALLET_WEB_ACQUISITION,
    },
    {
      name: 'privileged verifier',
      value: input.config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER,
    },
    { name: 'ai provider', value: input.config.AI_PROVIDER },
  ];

  return [
    { name: 'database', state: database },
    { name: 'redis (ephemeral)', state: ephemeral },
    { name: 'redis (queue)', state: queue },
    ...configured.map((entry) => ({
      // The adapter's configured name, which is what makes "off" and "off
      // because nobody approved one" distinguishable. It is never a credential:
      // every value here is an enumerated adapter name from configuration.
      adapter: entry.value,
      name: entry.name,
      state: adapterState(entry.value),
    })),
  ];
}
