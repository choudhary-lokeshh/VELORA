import {
  localTestConsentPolicy,
  localTestDepictedPersonVerifier,
  localTestTakedownPolicy,
  unavailableDepictedPersonVerifier,
  matureContentEnabled,
  unpublishedConsentPolicy,
  unpublishedTakedownPolicy,
  type ServerConfig,
} from '@velora/config/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { ConversationEnforcementPort } from '../messaging/enforcement.js';
import type { ConsumerContextResolver } from '../users/context.js';
import type { ConsumerEnforcementPort } from '../users/enforcement.js';
import type { UsersService } from '../users/service.js';
import {
  DepictedPersonConsentService,
  LocalTestConsentPolicy,
  LocalTestDepictedPersonVerifier,
  UnavailableDepictedPersonVerifier,
  UnpublishedConsentPolicy,
  type ConsentCopyPolicy,
  type DepictedPersonVerifier,
} from './consent.js';
import { ContentSafetyGate } from './content-safety.js';
import { SafetyDirectory } from './directory.js';
import { SafetyEligibility } from './eligibility.js';
import { EnforcementAuthority } from './enforcement.js';
import { ModerationService } from './moderation.js';
import { SafetyRepository } from './repository.js';
import { SafetyRoutes } from './routes.js';
import { SafetyService } from './service.js';
import {
  LocalTestTakedownPolicy,
  TakedownService,
  UnpublishedTakedownPolicy,
  type TakedownDeadlinePolicy,
} from './takedown.js';
import {
  ReportTargetResolver,
  type SafetyCatalogTargetPort,
  type SafetyConsumerTargetPort,
  type SafetyConversationTargetPort,
  type SafetyCreatorTargetPort,
} from './targets.js';

export interface SafetyRuntime {
  /** The one writer of enforcement records. MODERATION and ADMIN call it. */
  readonly authority: EnforcementAuthority;
  /** The depicted-person evidence and consent answer. Fails closed. */
  readonly consent: DepictedPersonConsentService;
  /** The composed content answer: publish, stay public, deliver, monetise. */
  readonly content: ContentSafetyGate;
  /** The pair answer this domain publishes to DISCOVERY and MESSAGING. */
  readonly directory: SafetyDirectory;
  /** The capability answer this domain publishes to every other one. */
  readonly eligibility: SafetyEligibility;
  /** The review and enforcement seam. Deliberately has no HTTP surface. */
  readonly moderation: ModerationService;
  readonly repository: SafetyRepository;
  readonly routes: SafetyRoutes;
  readonly service: SafetyService;
  /** Takedown claims and the deadlines a published policy would give them. */
  readonly takedown: TakedownService;
}

/**
 * TRUST & SAFETY composition root.
 *
 * It receives the two enforcement contracts it is allowed to call — USERS' for
 * account standing and MESSAGING' for conversation state — rather than writing
 * to either domain's tables. This domain writes nothing outside `safety_`.
 */
export function createSafetyRuntime(input: {
  readonly accounts: ConsumerEnforcementPort;
  /** PRIVATE CLUBS' answer about what a visitor could have been looking at. */
  readonly catalog: SafetyCatalogTargetPort;
  /** Chooses the depicted-person verifier and the consent wording policy. */
  readonly config: ServerConfig;
  readonly consumerContext: ConsumerContextResolver;
  /** USERS' answer about whether an account exists at all. */
  readonly consumers: SafetyConsumerTargetPort;
  readonly conversations: ConversationEnforcementPort;
  /** MESSAGING's answer about who is in a conversation. */
  readonly conversationTargets: SafetyConversationTargetPort;
  /** CREATORS' answer resolving a public handle. */
  readonly creators: SafetyCreatorTargetPort;
  readonly database: DatabaseHandle;
  readonly now?: () => Date;
  readonly users: UsersService;
}): SafetyRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new SafetyRepository(input.database);
  const targets = new ReportTargetResolver({
    catalog: input.catalog,
    consumers: input.consumers,
    conversations: input.conversationTargets,
    creators: input.creators,
  });
  const service = new SafetyService({
    now,
    repository,
    targets,
    users: input.users,
  });
  const authority = new EnforcementAuthority({ now, repository });
  const consent = new DepictedPersonConsentService({
    copy: selectConsentPolicy(input.config),
    now,
    repository,
    verifier: selectDepictedPersonVerifier(input.config),
  });
  const eligibility = new SafetyEligibility(repository);
  return {
    authority,
    consent,
    content: new ContentSafetyGate({
      consent,
      eligibility,
      // Read rather than written as a constant, so the gate reports what the
      // deployment says. The set of values that would enable it is empty.
      matureContentEnabled: matureContentEnabled(input.config),
      now,
      repository,
    }),
    directory: new SafetyDirectory(repository),
    eligibility,
    moderation: new ModerationService({
      accounts: input.accounts,
      authority,
      conversations: input.conversations,
      now,
      repository,
    }),
    repository,
    routes: new SafetyRoutes({
      consumerContext: input.consumerContext,
      safety: service,
    }),
    service,
    takedown: new TakedownService({
      now,
      policy: selectTakedownPolicy(input.config),
      repository,
    }),
  };
}

/**
 * The two depicted-person adapters, chosen the way every other provider is.
 *
 * A registry rather than a conditional, so adding an approved provider is a
 * table entry with a configuration value beside it, and so the set of things
 * that can be selected is visible in one place. Both default to the adapter
 * that refuses, and configuration rejects anything else in a deployed
 * environment — satisfying one of them enables nothing on its own.
 */
const depictedPersonVerifiers: Readonly<
  Record<string, () => DepictedPersonVerifier>
> = {
  [localTestDepictedPersonVerifier]: () =>
    new LocalTestDepictedPersonVerifier(),
  [unavailableDepictedPersonVerifier]: () =>
    new UnavailableDepictedPersonVerifier(),
};

const consentPolicies: Readonly<Record<string, () => ConsentCopyPolicy>> = {
  [localTestConsentPolicy]: () => new LocalTestConsentPolicy(),
  [unpublishedConsentPolicy]: () => new UnpublishedConsentPolicy(),
};

function selectDepictedPersonVerifier(
  config: ServerConfig,
): DepictedPersonVerifier {
  const build = depictedPersonVerifiers[config.SAFETY_DEPICTED_PERSON_VERIFIER];
  if (build === undefined) {
    throw new Error(
      `Unsupported depicted-person verifier: ${config.SAFETY_DEPICTED_PERSON_VERIFIER}`,
    );
  }
  return build();
}

function selectConsentPolicy(config: ServerConfig): ConsentCopyPolicy {
  const build = consentPolicies[config.SAFETY_CONSENT_POLICY];
  if (build === undefined) {
    throw new Error(
      `Unsupported consent policy: ${config.SAFETY_CONSENT_POLICY}`,
    );
  }
  return build();
}

const takedownPolicies: Readonly<Record<string, () => TakedownDeadlinePolicy>> =
  {
    [localTestTakedownPolicy]: () => new LocalTestTakedownPolicy(),
    [unpublishedTakedownPolicy]: () => new UnpublishedTakedownPolicy(),
  };

function selectTakedownPolicy(config: ServerConfig): TakedownDeadlinePolicy {
  const build = takedownPolicies[config.SAFETY_TAKEDOWN_POLICY];
  if (build === undefined) {
    throw new Error(
      `Unsupported takedown policy: ${config.SAFETY_TAKEDOWN_POLICY}`,
    );
  }
  return build();
}
