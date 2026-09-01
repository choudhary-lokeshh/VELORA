import {
  enabledCoinLedger,
  localTestCoinAcquisition,
  localTestWebCoinAcquisition,
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
import { WalletRoutes, type CoinPackCatalogue } from './routes.js';
import { WalletService, type WalletProfilePort } from './service.js';

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
  /**
   * BILLING's own offers for the platform's coin packs, priced.
   *
   * Supplied by the composition that holds both domains rather than read from
   * here, so WALLET keeps no copy of a price and BILLING keeps no copy of a
   * coin count. Absent in a composition with no BILLING, in which case nothing
   * is on sale — which is also the answer in every deployed environment.
   */
  readonly packs?: (userId: string) => Promise<CoinPackCatalogue>;
  /**
   * USERS' answer to what the *buyer* says they speak.
   *
   * The one cross-domain read this service makes, and it is about the caller
   * rather than about anybody they might meet. Absent in a worker composition,
   * which sells nothing; a language preference is then refused rather than sold
   * without being checked.
   */
  readonly profiles?: WalletProfilePort;
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
    ...(input.profiles === undefined ? {} : { profiles: input.profiles }),
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
      // What the platform sells its own currency in. Nothing at all where the
      // environment cannot sell, which is what an empty list means to a
      // surface: no pack renders and no purchase control exists.
      packs:
        input.packs ?? (() => Promise.resolve({ gates: undefined, packs: [] })),
      /*
       * Web acquisition is a configured gate of its own.
       *
       * Deliberately not inferred from the payment provider. A provider being
       * configured says money can move; it does not say VELORA has decided to
       * sell its own currency, at what price, from which country, or under
       * whose consumer-protection regime — all of which are undecided, and the
       * environment guard refuses this value outside local and test.
       *
       * A coin pack reaches the ledger through BILLING's ordinary seam:
       * `./entitlement-intake.ts` consumes the entitlement fact a settled
       * purchase publishes and credits idempotently. There is no
       * wallet-specific checkout, and there deliberately never will be.
       */
      webAcquisition:
        input.config.WALLET_WEB_ACQUISITION === localTestWebCoinAcquisition &&
        input.packs !== undefined
          ? 'local-test'
          : 'unavailable',
    }),
    service,
  };
}

export { unavailableCoinLedger };
