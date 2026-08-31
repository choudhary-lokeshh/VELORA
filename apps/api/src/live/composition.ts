import {
  localTestLiveSimulation,
  openLiveDiscovery,
  unavailableLiveDiscovery,
  unavailableLiveSimulation,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { ConnectionDirectoryPort } from '../discovery/connections.js';
import type { ConsumerContextResolver } from '../users/context.js';
import { LiveEncounterDirectory } from './directory.js';
import { LiveEncounterEnforcement } from './enforcement.js';
import { LiveRepository } from './repository.js';
import { LiveRoutes } from './routes.js';
import { LiveSimulator, type LiveStandInAccountsPort } from './simulation.js';
import {
  LiveService,
  type LiveAdmissionPort,
  type LiveConversationPort,
  type LiveDirectoryPort,
  type LiveEnforcementPort,
  type LiveIntroductionPort,
  type LiveRtcSessionPort,
  type LiveSafetyPort,
  type LiveStandingPort,
} from './service.js';

export interface LiveRuntime {
  /**
   * The two facts this domain publishes to DISCOVERY and REALTIME. Exposed here
   * so a composition can hand it to both without either learning anything else
   * about live discovery.
   */
  readonly directory: LiveEncounterDirectory;
  /**
   * What TRUST & SAFETY is allowed to do to an encounter: end it. Published
   * here so the application can hand it to SAFETY without SAFETY reaching into
   * this domain for anything else.
   */
  readonly enforcement: LiveEncounterEnforcement;
  readonly repository: LiveRepository;
  readonly routes: LiveRoutes;
  readonly service: LiveService;
  /** Absent unless a simulation adapter is configured. */
  readonly simulator: LiveSimulator | undefined;
}

/**
 * The stand-in adapter, on the same registry rule as every other adapter here:
 * a configured name with no entry is an error rather than a silent default.
 *
 * `unavailable` offers nobody, which is the only behaviour a deployed
 * environment may have and the behaviour any environment gets by default.
 * `local-test` stands a seeded local account in for a second person, so one
 * developer can walk a feature that needs two; configuration rejects it outside
 * local and test, which is what makes it unreachable rather than merely unused.
 */
const simulators: Readonly<
  Record<
    string,
    (input: {
      readonly accounts: LiveStandInAccountsPort;
      readonly logger: SafeLogger;
      readonly repository: LiveRepository;
    }) => LiveSimulator | undefined
  >
> = {
  [localTestLiveSimulation]: (input) => new LiveSimulator(input),
  [unavailableLiveSimulation]: () => undefined,
};

function selectSimulator(input: {
  readonly accounts: LiveStandInAccountsPort;
  readonly config: ServerConfig;
  readonly logger: SafeLogger;
  readonly repository: LiveRepository;
}): LiveSimulator | undefined {
  const build = simulators[input.config.LIVE_DISCOVERY_SIMULATION];
  if (build === undefined) {
    throw new Error(
      `No live-discovery simulation adapter is registered for ${input.config.LIVE_DISCOVERY_SIMULATION}`,
    );
  }
  return build({
    accounts: input.accounts,
    logger: input.logger,
    repository: input.repository,
  });
}

/**
 * LIVE composition root.
 *
 * It is composed after USERS, DISCOVERY, MESSAGING, TRUST & SAFETY, and
 * REALTIME, because it consumes a published contract from each and owns none of
 * what they decide. The two facts it publishes back — that a pair is in a live
 * encounter, and that a pair met live recently — travel through
 * `LiveEncounterDirectory`, which is built from a database handle rather than
 * from this runtime, so DISCOVERY and REALTIME can be handed it before this
 * exists and there is no cycle to break with a late setter.
 *
 * This domain writes nothing outside `live_`.
 */
export function createLiveRuntime(input: {
  readonly accounts: LiveStandInAccountsPort;
  readonly admission: LiveAdmissionPort;
  readonly config: ServerConfig;
  readonly connections: ConnectionDirectoryPort;
  /** Present when this composition publishes routes. */
  readonly consumerContext?: ConsumerContextResolver;
  readonly conversations: LiveConversationPort;
  readonly database: DatabaseHandle;
  readonly directory: LiveDirectoryPort;
  readonly enforcement: LiveEnforcementPort;
  readonly introductions: LiveIntroductionPort;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  readonly realtime: LiveRtcSessionPort;
  readonly safety: LiveSafetyPort;
  readonly standing: LiveStandingPort;
}): LiveRuntime {
  const repository = new LiveRepository(input.database);
  const now = input.now ?? (() => new Date());
  const simulator = selectSimulator({
    accounts: input.accounts,
    config: input.config,
    logger: input.logger,
    repository,
  });
  const service = new LiveService({
    admission: input.admission,
    connections: input.connections,
    conversations: input.conversations,
    directory: input.directory,
    enforcement: input.enforcement,
    introductions: input.introductions,
    logger: input.logger,
    // The product gate, read once at composition. A mode this registry does not
    // know is an error rather than a silent refusal, on the same rule the
    // adapter registries follow — except that here the refusing value is the
    // safe one, so an unknown name resolves to it rather than throwing a
    // process that would otherwise run correctly with live discovery off.
    mode:
      input.config.LIVE_DISCOVERY_MODE === openLiveDiscovery
        ? openLiveDiscovery
        : unavailableLiveDiscovery,
    now,
    realtime: input.realtime,
    repository,
    safety: input.safety,
    ...(simulator === undefined ? {} : { simulation: simulator }),
    standing: input.standing,
  });
  // The stand-in drives the service, and the service asks the stand-in for
  // somebody to match. Closed here rather than by giving the simulator its own
  // copy of the matching and messaging logic, which is the whole reason it is
  // trustworthy as a walkthrough of the product.
  simulator?.attach(service);

  return {
    directory: new LiveEncounterDirectory(input.database),
    enforcement: new LiveEncounterEnforcement(input.database),
    repository,
    routes: new LiveRoutes({
      // Routes are only reachable when a composition supplies the consumer
      // seam; a worker composition has no use for them and supplies none.
      consumerContext: input.consumerContext as never,
      live: service,
      ...(simulator === undefined ? {} : { simulator }),
    }),
    service,
    simulator,
  };
}
