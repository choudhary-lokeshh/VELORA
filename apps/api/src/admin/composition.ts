import type { CallerResolver } from '../auth/caller.js';
import type { PrivilegedAccessService } from '../auth/privileged.js';
import type { RefundService } from '../billing/refund-service.js';
import type { ClubRepository } from '../clubs/club-repository.js';
import type { ClubsRepository } from '../clubs/repository.js';
import type {
  CreatorProfileRepository,
  CreatorsDatabase,
  CreatorsRepository,
} from '../creators/repository.js';
import type { MediaOperations } from '../media/operations.js';
import type { NotificationOperations } from '../notifications/operations.js';
import type { RtcOperations } from '../realtime/operations.js';
import { AdminNotificationRoutes } from './notification-routes.js';
import { AdminRtcRoutes } from './rtc-routes.js';
import type { IdentityOperations } from '../identity/operations.js';
import type { AppealService } from '../safety/appeals.js';
import type { EnforcementAuthority } from '../safety/enforcement.js';
import type { ModerationService } from '../safety/moderation.js';
import type { DisputeRepository } from '../billing/dispute-repository.js';
import type { MonetisationReadiness } from '../billing/offer-service.js';
import { AdminBillingRoutes } from './billing-routes.js';
import { AdminFinancialDirectory } from './financial-directory.js';
import { AdminContextResolver } from './context.js';
import { AdminCreatorDirectory } from './directory.js';
import { AdminMediaRoutes } from './media-routes.js';
import { AdminIdentityRoutes } from './identity-routes.js';
import { AdminModerationRoutes } from './moderation-routes.js';
import { AdminRoutes } from './routes.js';
import { AdminCreatorService, type AdminMediaPurgePort } from './service.js';

export interface AdminRuntime {
  readonly adminContext: AdminContextResolver;
  /** Operator financial surface. Nothing here owns a financial row. */
  readonly billingRoutes: AdminBillingRoutes;
  readonly directory: AdminCreatorDirectory;
  /** Privacy-minimized health and exact-action subject inspection only. */
  readonly identityRoutes: AdminIdentityRoutes;
  /** Operator media surface. A read, a read, and one idempotent repair. */
  readonly mediaRoutes: AdminMediaRoutes;
  readonly notificationRoutes: AdminNotificationRoutes;
  readonly rtcRoutes: AdminRtcRoutes;
  /** Operator moderation surface. Every route is an explicit command. */
  readonly moderationRoutes: AdminModerationRoutes;
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
  /** AUTH exact-action execution, not an ADMIN role or permission store. */
  readonly privilegedAccess?: PrivilegedAccessService;
  readonly clubs: ClubRepository;
  readonly content: ClubsRepository;
  readonly creators: CreatorsRepository;
  readonly database: CreatorsDatabase;
  readonly now?: () => Date;
  readonly profiles: CreatorProfileRepository;
  /** Which capability seams are configured, for the operator's own screen. */
  readonly capabilities: {
    readonly commerceEligibility: string;
    readonly commercePolicy: string;
    readonly paymentProvider: string;
    readonly payoutPolicy: string;
    readonly payoutProvider: string;
    readonly taxAuthority: string;
  };
  /**
   * MEDIA's operator seam.
   *
   * The operational read lives in MEDIA rather than here because nothing
   * outside that domain queries a `media_` table — the readiness projection
   * exists so other domains cannot learn the technical lifecycle by accident,
   * and an Admin module holding raw SQL over `media_objects` would have been
   * the first exception. The purge port is separate and narrow: it is the one
   * thing a takedown owes the bytes, and ADMIN is given nothing it does not
   * need.
   */
  readonly media: {
    readonly operations: MediaOperations;
    readonly purge: AdminMediaPurgePort;
  };
  /** IDENTITY's published operations seam; ADMIN never sees `identity_` SQL. */
  readonly identity: IdentityOperations;
  /**
   * REALTIME's published operations seam, on the same rule as MEDIA's: nothing
   * outside that domain queries a `realtime_` table. ADMIN is given the read
   * and no action at all — ending somebody's call is a safety decision, and it
   * goes through TRUST & SAFETY where it acquires a record, a reason, and an
   * appeal path.
   */
  readonly notifications: NotificationOperations;
  readonly rtc: RtcOperations;
  /** BILLING's own dispute record. A read; nothing here may originate one. */
  readonly disputes: DisputeRepository;
  /** What the platform may currently sell, reported rather than inferred. */
  readonly readiness: () => MonetisationReadiness;
  /** BILLING's reversal orchestration. ADMIN authorizes; BILLING decides. */
  readonly refunds: RefundService;
  /** TRUST & SAFETY's complaint seam. */
  readonly appeals: AppealService;
  /** TRUST & SAFETY's review seam. ADMIN calls it; it owns no queue of its own. */
  readonly moderation: ModerationService;
  /** TRUST & SAFETY's one writer of enforcement records. */
  readonly safety: EnforcementAuthority;
}): AdminRuntime {
  const now = input.now ?? (() => new Date());
  const directory = new AdminCreatorDirectory(input.database, input.profiles);
  const service = new AdminCreatorService({
    authority: input.safety,
    clubs: input.clubs,
    content: input.content,
    creators: input.creators,
    database: input.database,
    media: input.media.purge,
    now,
    profiles: input.profiles,
  });
  const adminContext = new AdminContextResolver({ caller: input.caller, now });
  return {
    adminContext,
    billingRoutes: new AdminBillingRoutes({
      adminContext,
      capabilities: input.capabilities,
      disputes: input.disputes,
      financial: new AdminFinancialDirectory(input.database),
      readiness: input.readiness,
      refunds: input.refunds,
    }),
    directory,
    identityRoutes: new AdminIdentityRoutes({
      adminContext,
      ...(input.privilegedAccess === undefined
        ? {}
        : { exactActions: input.privilegedAccess }),
      identity: input.identity,
    }),
    notificationRoutes: new AdminNotificationRoutes({
      adminContext,
      operations: input.notifications,
    }),
    rtcRoutes: new AdminRtcRoutes({
      adminContext,
      operations: input.rtc,
    }),
    mediaRoutes: new AdminMediaRoutes({
      adminContext,
      media: input.media.purge,
      operations: input.media.operations,
    }),
    moderationRoutes: new AdminModerationRoutes({
      adminContext,
      appeals: input.appeals,
      moderation: input.moderation,
    }),
    routes: new AdminRoutes({ adminContext, directory, service }),
    service,
  };
}
