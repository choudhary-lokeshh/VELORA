import {
  localTestPayoutPolicy,
  localTestPayoutProvider,
  unavailablePayoutProvider,
  unpublishedPayoutPolicy,
  type ServerConfig,
} from '@velora/config/server';

import type { CreatorContextResolver } from '../creators/context.js';
import type { DatabaseHandle } from '../database/executor.js';
import { OutboxRepository } from '../events/outbox.js';
import { JournalStore } from '../money/journal.js';
import { LocalTestPayoutProvider } from './local-test-provider.js';
import {
  LocalTestPayoutPolicy,
  UnpublishedPayoutPolicy,
  type PayoutPolicy,
} from './payout-policy.js';
import { payoutsJournalPrefix } from './policy.js';
import {
  UnavailablePayoutProvider,
  type PayoutProviderPort,
} from './provider.js';
import { PayoutsRepository } from './repository.js';
import { PayoutRoutes } from './routes.js';
import { payoutsJournalTables, payoutsOutbox } from './schema.js';
import { PayoutsService } from './service.js';

/**
 * PAYOUTS composition root.
 *
 * Two adapters, chosen by two configuration values, each refusing for its own
 * reason. `PAYOUTS_PROVIDER` selects who could actually send money and its only
 * deployable value refuses every call; `PAYOUTS_POLICY` selects the approved
 * settlement terms and its only deployable value releases nothing. Either alone
 * stops a payout, and a deployed environment holds both — which is what makes
 * "payout architecture is built, payout capability is not enabled" a property
 * of configuration rather than of a runtime flag somebody could set.
 *
 * This domain writes nothing outside `payouts_`. It learns what a creator is
 * owed from a fact BILLING publishes, and it says when that obligation is
 * discharged by publishing one of its own.
 */
export interface PayoutsRuntime {
  readonly database: DatabaseHandle;
  readonly journal: JournalStore;
  /** PAYOUTS' transactional outbox, drained by the shared relay. */
  readonly outbox: OutboxRepository;
  /** The approved settlement terms. `unpublished` in every deployed environment. */
  readonly policy: PayoutPolicy;
  /** The payout adapter. `unavailable` in every deployed environment. */
  readonly provider: PayoutProviderPort;
  readonly repository: PayoutsRepository;
  readonly routes: PayoutRoutes;
  readonly service: PayoutsService;
}

const payoutPolicies: Readonly<Record<string, () => PayoutPolicy>> = {
  [localTestPayoutPolicy]: () => new LocalTestPayoutPolicy(),
  [unpublishedPayoutPolicy]: () => new UnpublishedPayoutPolicy(),
};

const payoutProviders: Readonly<Record<string, () => PayoutProviderPort>> = {
  [localTestPayoutProvider]: () => new LocalTestPayoutProvider(),
  [unavailablePayoutProvider]: () => new UnavailablePayoutProvider(),
};

export function createPayoutsRuntime(input: {
  readonly config: ServerConfig;
  readonly creatorContext: CreatorContextResolver;
  readonly database: DatabaseHandle;
  readonly now?: () => Date;
}): PayoutsRuntime {
  const now = input.now ?? (() => new Date());
  const buildPolicy = payoutPolicies[input.config.PAYOUTS_POLICY];
  if (buildPolicy === undefined) {
    throw new Error(`Unknown payout policy: ${input.config.PAYOUTS_POLICY}`);
  }
  const buildProvider = payoutProviders[input.config.PAYOUTS_PROVIDER];
  if (buildProvider === undefined) {
    throw new Error(
      `Unknown payout provider: ${input.config.PAYOUTS_PROVIDER}`,
    );
  }
  const policy = buildPolicy();
  const provider = buildProvider();
  const journal = new JournalStore({
    now,
    prefix: payoutsJournalPrefix,
    tables: payoutsJournalTables,
  });
  const repository = new PayoutsRepository(input.database, journal);
  const outbox = new OutboxRepository(input.database, payoutsOutbox);
  const service = new PayoutsService({
    journal,
    now,
    outbox,
    policy,
    provider,
    repository,
  });
  return {
    database: input.database,
    journal,
    outbox,
    policy,
    provider,
    repository,
    routes: new PayoutRoutes({
      creatorContext: input.creatorContext,
      policy,
      provider,
      repository,
      // A provider needs somewhere to return a creator to after its own hosted
      // onboarding. Creator Studio is the only surface that may start it.
      returnOrigin: input.config.AUTH_BROWSER_ORIGINS_CREATOR_STUDIO[0],
      service,
    }),
    service,
  };
}
