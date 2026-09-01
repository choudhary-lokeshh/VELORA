import {
  enabledCoinLedger,
  localTestCoinAcquisition,
  unavailableCoinAcquisition,
  unavailableCoinLedger,
  type ServerConfig,
} from '@velora/config/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { ConsumerContextResolver } from '../users/context.js';
import {
  LocalTestCoinAcquisition,
  UnavailableCoinAcquisition,
  type CoinAcquisitionPort,
} from './acquisition.js';
import { CoinLedger } from './ledger.js';
import { WalletRepository } from './repository.js';
import { WalletRoutes } from './routes.js';
import { WalletService } from './service.js';

export interface WalletRuntime {
  /** How Android acquires coins in this environment. */
  readonly acquisition: CoinAcquisitionPort;
  readonly ledger: CoinLedger;
  readonly repository: WalletRepository;
  readonly routes: WalletRoutes;
  readonly service: WalletService;
}

/**
 * The Android acquisition adapter, on the same registry rule as every other
 * adapter in this repository: a configured name with no entry is an error
 * rather than a silent default.
 *
 * `unavailable` refuses every acquisition and is what every deployed
 * environment gets, because no Play Console project, product identifier,
 * application signing key, or service-account credential exists to verify a
 * purchase against. `local-test` verifies a token it shaped itself and is
 * refused outside local and test.
 *
 * There is deliberately no `google-play` entry. The port it would implement is
 * declared in full in `./acquisition.ts`, so adding one is an adapter and a
 * credential rather than a redesign — but a name that could be selected and
 * could not verify anything would be a channel that mints currency on a
 * client's word.
 */
const coinAcquisitions: Readonly<Record<string, () => CoinAcquisitionPort>> = {
  [localTestCoinAcquisition]: () => new LocalTestCoinAcquisition(),
  [unavailableCoinAcquisition]: () => new UnavailableCoinAcquisition(),
};

function selectAcquisition(config: ServerConfig): CoinAcquisitionPort {
  const build = coinAcquisitions[config.WALLET_ANDROID_ACQUISITION];
  if (build === undefined) {
    throw new Error(
      `No coin acquisition adapter is registered for ${config.WALLET_ANDROID_ACQUISITION}`,
    );
  }
  return build();
}

/**
 * WALLET composition root.
 *
 * Composed before LIVE, because LIVE consumes the published preference contract
 * and owns none of what this domain decides. It consumes nothing from LIVE: an
 * activation knows nothing about matching, and the capture that charges for one
 * arrives as a call from the matcher rather than as a read into it.
 *
 * This domain writes nothing outside `wallet_`.
 */
export function createWalletRuntime(input: {
  readonly config: ServerConfig;
  /** Present when this composition publishes routes. */
  readonly consumerContext?: ConsumerContextResolver;
  readonly database: DatabaseHandle;
  readonly now?: () => Date;
}): WalletRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new WalletRepository(input.database);
  const ledger = new CoinLedger(now);
  const acquisition = selectAcquisition(input.config);
  const service = new WalletService({
    // The gate, read once at composition. An unknown value resolves to the
    // refusing one rather than throwing, on the same rule the live-discovery
    // mode follows: here the refusing value is the safe one, and a process that
    // would otherwise run correctly with coins off must not fail to start.
    enabled: input.config.WALLET_COIN_LEDGER === enabledCoinLedger,
    ledger,
    now,
    repository,
  });
  return {
    acquisition,
    ledger,
    repository,
    routes: new WalletRoutes({
      acquisition,
      // Routes are only reachable when a composition supplies the consumer
      // seam; a worker composition has no use for them and supplies none.
      consumerContext: input.consumerContext as never,
      // A grant creates coins nobody paid for, so its availability follows the
      // environment rather than a configuration value somebody could set. There
      // is no variable that turns it on in staging or production.
      grantsPermitted:
        input.config.APP_ENV === 'local' || input.config.APP_ENV === 'test',
      wallet: service,
      /*
       * Web acquisition is BILLING's, and it is unavailable everywhere.
       *
       * Two independent reasons, and either alone is enough. No payment
       * provider is approved in any environment. And BILLING's offer model is
       * creator-scoped by construction — `billing_offers.creator_id` is not
       * null and its revenue routes to a creator payable position — so a
       * platform-owned coin pack is not an offer it can currently express.
       * Making it one is a change to the money architecture with tax and
       * revenue-split consequences, recorded as an owner decision in
       * `DECISIONS_REQUIRED.md` rather than improvised here.
       *
       * The seam that will carry it already exists and is inert:
       * `./entitlement-intake.ts` consumes BILLING's published entitlement
       * facts and credits coins for a `coins` resource type that nothing yet
       * emits. So the day a platform-owned pack is sellable, Web acquisition is
       * an offer and a catalogue entry rather than a new checkout.
       *
       * Reported as `unavailable` rather than computed from the payment
       * provider, because a surface told `local-test` would render a buy
       * control for a product that does not exist.
       */
      webAcquisition: 'unavailable',
    }),
    service,
  };
}

export { unavailableCoinLedger };
