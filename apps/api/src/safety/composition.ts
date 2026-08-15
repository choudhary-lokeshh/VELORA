import type { DatabaseHandle } from '../database/executor.js';
import type { ConversationEnforcementPort } from '../messaging/enforcement.js';
import type { ConsumerContextResolver } from '../users/context.js';
import type { ConsumerEnforcementPort } from '../users/enforcement.js';
import type { UsersService } from '../users/service.js';
import { SafetyDirectory } from './directory.js';
import { SafetyEligibility } from './eligibility.js';
import { EnforcementAuthority } from './enforcement.js';
import { ModerationService } from './moderation.js';
import { SafetyRepository } from './repository.js';
import { SafetyRoutes } from './routes.js';
import { SafetyService } from './service.js';
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
  /** The pair answer this domain publishes to DISCOVERY and MESSAGING. */
  readonly directory: SafetyDirectory;
  /** The capability answer this domain publishes to every other one. */
  readonly eligibility: SafetyEligibility;
  /** The review and enforcement seam. Deliberately has no HTTP surface. */
  readonly moderation: ModerationService;
  readonly repository: SafetyRepository;
  readonly routes: SafetyRoutes;
  readonly service: SafetyService;
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
  return {
    authority,
    directory: new SafetyDirectory(repository),
    eligibility: new SafetyEligibility(repository),
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
  };
}
