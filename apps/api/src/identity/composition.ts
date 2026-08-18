import {
  localTestIdentityJurisdictionPolicy,
  localTestIdentityVerificationProvider,
  unavailableIdentityVerificationProvider,
  unpublishedIdentityJurisdictionPolicy,
  type ServerConfig,
} from '@velora/config/server';

import type { DatabaseHandle } from '../database/executor.js';
import {
  LocalTestIdentityJurisdictionPolicy,
  UnpublishedIdentityJurisdictionPolicy,
  type IdentityJurisdictionPolicyPort,
} from './jurisdiction.js';
import { LocalTestIdentityVerificationProvider } from './local-test-provider.js';
import { IdentityOrchestrator } from './orchestrator.js';
import {
  UnavailableIdentityVerificationProvider,
  type IdentityVerificationProviderPort,
} from './provider.js';
import { IdentityRepository } from './repository.js';

export interface IdentityRuntime {
  readonly jurisdictionPolicy: IdentityJurisdictionPolicyPort;
  readonly orchestrator: IdentityOrchestrator;
  readonly provider: IdentityVerificationProviderPort;
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
  readonly now?: () => Date;
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
  return {
    jurisdictionPolicy,
    orchestrator: new IdentityOrchestrator({
      jurisdictionPolicy,
      now,
      provider,
      repository,
    }),
    provider,
    repository,
  };
}
