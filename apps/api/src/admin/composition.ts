import type { CallerResolver } from '../auth/caller.js';
import type { RefundService } from '../billing/refund-service.js';
import type { ClubRepository } from '../clubs/club-repository.js';
import type { ClubsRepository } from '../clubs/repository.js';
import type {
  CreatorProfileRepository,
  CreatorsDatabase,
  CreatorsRepository,
} from '../creators/repository.js';
import { reportPolicyVersion } from '../safety/policy.js';
import type { SafetyRepository } from '../safety/repository.js';
import { AdminBillingRoutes } from './billing-routes.js';
import { AdminContextResolver } from './context.js';
import { AdminCreatorDirectory } from './directory.js';
import { AdminRoutes } from './routes.js';
import { AdminCreatorService } from './service.js';

export interface AdminRuntime {
  readonly adminContext: AdminContextResolver;
  /** Operator financial surface. Nothing here owns a financial row. */
  readonly billingRoutes: AdminBillingRoutes;
  readonly directory: AdminCreatorDirectory;
  readonly routes: AdminRoutes;
  readonly service: AdminCreatorService;
}

/**
 * ADMIN composition root.
 *
 * It receives the repositories of the domains it operates rather than a
 * database of its own, because ADMIN owns no table: a suspension is CREATORS'
 * lifecycle, an unpublished item is PRIVATE CLUBS' lifecycle, and the record of
 * the decision is TRUST & SAFETY's enforcement log.
 */
export function createAdminRuntime(input: {
  readonly caller: CallerResolver;
  readonly clubs: ClubRepository;
  readonly content: ClubsRepository;
  readonly creators: CreatorsRepository;
  readonly database: CreatorsDatabase;
  readonly now?: () => Date;
  readonly profiles: CreatorProfileRepository;
  /** BILLING's reversal orchestration. ADMIN authorizes; BILLING decides. */
  readonly refunds: RefundService;
  readonly safety: SafetyRepository;
}): AdminRuntime {
  const now = input.now ?? (() => new Date());
  const directory = new AdminCreatorDirectory(input.database, input.profiles);
  const service = new AdminCreatorService({
    clubs: input.clubs,
    content: input.content,
    creators: input.creators,
    now,
    policyVersion: reportPolicyVersion,
    profiles: input.profiles,
    safety: input.safety,
  });
  const adminContext = new AdminContextResolver({ caller: input.caller, now });
  return {
    adminContext,
    billingRoutes: new AdminBillingRoutes({
      adminContext,
      refunds: input.refunds,
    }),
    directory,
    routes: new AdminRoutes({ adminContext, directory, service }),
    service,
  };
}
