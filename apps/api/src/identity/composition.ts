import {
  localTestIdentityJurisdictionPolicy,
  localTestIdentityVerificationProvider,
  unavailableIdentityVerificationProvider,
  unpublishedIdentityJurisdictionPolicy,
  type ServerConfig,
} from '@velora/config/server';

import type { DatabaseHandle } from '../database/executor.js';
import { OutboxRepository } from '../events/outbox.js';
import type { SafeLogger } from '@velora/observability/server';
import {
  IdentityAdultAssuranceReader,
  IdentityCommercialKycEvidenceReader,
  IdentityCreatorEvidenceReader,
  IdentityDepictedPersonEvidenceReader,
} from './assurance-reader.js';
import { IdentityProviderEventRepository } from './event-repository.js';
import {
  LocalTestIdentityJurisdictionPolicy,
  IdentityReverificationPolicy,
  UnpublishedIdentityJurisdictionPolicy,
  type IdentityJurisdictionPolicyPort,
} from './jurisdiction.js';
import { LocalTestIdentityVerificationProvider } from './local-test-provider.js';
import { IdentityOrchestrator } from './orchestrator.js';
import { IdentityProviderEventRoutes } from './provider-event-routes.js';
import { IdentityProviderEventService } from './provider-events.js';
import { IdentityReconciliationService } from './reconciliation.js';
import {
  UnavailableIdentityVerificationProvider,
  type IdentityVerificationProviderPort,
} from './provider.js';
import { IdentityRepository } from './repository.js';
import { identityOutbox } from './schema.js';

export interface IdentityRuntime {
  readonly adultAssurance: IdentityAdultAssuranceReader;
  readonly commercialKyc: IdentityCommercialKycEvidenceReader;
  readonly creatorEvidence: IdentityCreatorEvidenceReader;
  readonly depictedPersonEvidence: IdentityDepictedPersonEvidenceReader;
  readonly events: IdentityProviderEventRepository;
  readonly jurisdictionPolicy: IdentityJurisdictionPolicyPort;
  readonly orchestrator: IdentityOrchestrator;
  readonly outbox: OutboxRepository;
  readonly provider: IdentityVerificationProviderPort;
  readonly providerEventRoutes: IdentityProviderEventRoutes;
  readonly providerEvents: IdentityProviderEventService;
  readonly reconciliation: IdentityReconciliationService;
  readonly reverificationPolicy: IdentityReverificationPolicy;
  readonly repository: IdentityRepository;
}

const identityProviders: Readonly<
  Record<string, (now: () => Date) => IdentityVerificationProviderPort>
> = {
  [localTestIdentityVerificationProvider]: (now) =>
    new LocalTestIdentityVerificationProvider(now),
  [unavailableIdentityVerificationProvider]: () =>
    new UnavailableIdentityVerificationProvider(),
};

const jurisdictionPolicies: Readonly<
  Record<string, () => IdentityJurisdictionPolicyPort>
> = {
  [localTestIdentityJurisdictionPolicy]: () =>
    new LocalTestIdentityJurisdictionPolicy(),
  [unpublishedIdentityJurisdictionPolicy]: () =>
    new UnpublishedIdentityJurisdictionPolicy(),
};

/**
 * Provider and policy are selected once from validated server configuration.
 * No route, owner contract, header, or query value reaches either registry.
 */
export function createIdentityRuntime(input: {
  readonly config: ServerConfig;
  readonly database: DatabaseHandle;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  readonly owner: string;
}): IdentityRuntime {
  const buildProvider =
    identityProviders[input.config.IDENTITY_VERIFICATION_PROVIDER];
  if (buildProvider === undefined) {
    throw new Error(
      `Unknown identity verification provider: ${input.config.IDENTITY_VERIFICATION_PROVIDER}`,
    );
  }
  const buildPolicy =
    jurisdictionPolicies[input.config.IDENTITY_JURISDICTION_POLICY];
  if (buildPolicy === undefined) {
    throw new Error(
      `Unknown identity jurisdiction policy: ${input.config.IDENTITY_JURISDICTION_POLICY}`,
    );
  }

  const now = input.now ?? (() => new Date());
  const provider = buildProvider(now);
  const jurisdictionPolicy = buildPolicy();
  const repository = new IdentityRepository(input.database);
  const events = new IdentityProviderEventRepository(input.database);
  const outbox = new OutboxRepository(input.database, identityOutbox);
  const providerEvents = new IdentityProviderEventService({
    events,
    logger: input.logger,
    now,
    outbox,
    owner: input.owner,
    provider,
    repository,
  });
  return {
    adultAssurance: new IdentityAdultAssuranceReader(repository),
    commercialKyc: new IdentityCommercialKycEvidenceReader(repository),
    creatorEvidence: new IdentityCreatorEvidenceReader(repository),
    depictedPersonEvidence: new IdentityDepictedPersonEvidenceReader(
      repository,
    ),
    events,
    jurisdictionPolicy,
    orchestrator: new IdentityOrchestrator({
      jurisdictionPolicy,
      now,
      provider,
      repository,
    }),
    outbox,
    provider,
    providerEventRoutes: new IdentityProviderEventRoutes(providerEvents),
    providerEvents,
    reconciliation: new IdentityReconciliationService({
      logger: input.logger,
      now,
      provider,
      providerEvents,
      repository,
    }),
    reverificationPolicy: new IdentityReverificationPolicy(jurisdictionPolicy),
    repository,
  };
}
