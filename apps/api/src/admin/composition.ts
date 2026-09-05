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
import type { JobQueueInspectionPort } from '../jobs/inspection.js';
import { UnobservedJobQueues } from '../jobs/inspection.js';
import type { OperationalControlReader } from '../operations/controls.js';
import { DefaultControlReader } from '../operations/controls.js';
import type { OperationsService } from '../operations/service.js';
import { AdminAccountDirectory } from './account-directory.js';
import { AdminActivityDirectory } from './activity-directory.js';
import { AdminBillingRoutes } from './billing-routes.js';
import {
  AdminInsightRoutes,
  type SessionRevocationPort,
} from './insight-routes.js';
import { AdminLiveDirectory } from './live-directory.js';
import { AdminOperationsHealthDirectory } from './operations-health-directory.js';
import { AdminOperatorRoutes } from './operator-routes.js';
import {
  AdminPlatformRoutes,
  type DependencyReadinessPort,
} from './platform-routes.js';
import { AdminPublicEntryDirectory } from './public-entry-directory.js';
import { AdminReconciliationDirectory } from './reconciliation-directory.js';
import { AdminSearchDirectory } from './search-directory.js';
import { AdminFinancialDirectory } from './financial-directory.js';
import {
  AdminContextResolver,
  UngrantedOperatorStanding,
  type OperatorStandingPort,
} from './context.js';
import { AdminCreatorDirectory } from './directory.js';
import { AdminMediaRoutes } from './media-routes.js';
import { AdminOperationsDirectory } from './operations-directory.js';
import { AdminOperationsRoutes } from './operations-routes.js';
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
  /**
   * The operator reads that are not one domain's health: what needs a person,
   * accounts under enforcement, payments, payouts, clubs, and the two audit
   * records. Every one is a GET, and the module has no service to write with.
   */
  readonly operationsRoutes: AdminOperationsRoutes;
  /**
   * The reads an operator uses to find something and understand who it happened
   * to: the composed activity stream, one person's timeline, the identifier
   * resolver, the account record, and the one command that follows from them.
   */
  readonly insightRoutes: AdminInsightRoutes | undefined;
  /** The control plane: standing, grants, controls, and the operator audit. */
  readonly operatorRoutes: AdminOperatorRoutes | undefined;
  /** Platform health, live operations, money reconciliation, public entry. */
  readonly platformRoutes: AdminPlatformRoutes;
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
  /**
   * OPERATIONS' answer to "what may this operator do".
   *
   * Optional so a composition can be assembled without a control plane, and
   * fail-closed when it is absent: no grant store means no capabilities, which
   * refuses every privileged route rather than admitting every operator to all
   * of them.
   */
  readonly standing?: OperatorStandingPort;
  /**
   * OPERATIONS' service, where a control plane is composed.
   *
   * Absent leaves the control-plane routes off the runtime entirely rather than
   * present and broken — the application answers `503` for a route whose runtime
   * is missing, after refusing the audience, which is the order every operator
   * route in this codebase follows.
   */
  readonly operations?: OperationsService;
  /** The reader LIVE also consults, so a screen and the code cannot disagree. */
  readonly controls?: OperationalControlReader;
  /** AUTH's own revocation, so a security event commits with the revocation. */
  readonly sessions?: SessionRevocationPort;
  /** BullMQ counters, where this process holds a queue client. */
  readonly jobs?: JobQueueInspectionPort;
  /**
   * Every dependency's readiness, resolved where configuration actually is.
   *
   * Optional, and an absent one reports nothing rather than reporting health.
   * A composition that never wired this must not answer "everything is fine"
   * for eight subsystems it was never given a way to ask about.
   */
  readonly dependencyReadiness?: DependencyReadinessPort;
  readonly environment: 'local' | 'test' | 'staging' | 'production';
  readonly publicWebOrigin?: string | undefined;
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
  // No standing port means no control plane in this composition, and an
  // operator with no capabilities. Fail closed: a runtime assembled without
  // OPERATIONS must refuse every privileged route rather than admit everybody
  // to it, which is what an "admin = true" default would have done.
  const adminContext = new AdminContextResolver({
    caller: input.caller,
    now,
    standing: input.standing ?? new UngrantedOperatorStanding(),
  });
  const controls = input.controls ?? new DefaultControlReader();
  const operations = input.operations;
  const sessions = input.sessions;
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
    operationsRoutes: new AdminOperationsRoutes({
      adminContext,
      operations: new AdminOperationsDirectory({
        database: input.database,
        now,
      }),
    }),
    insightRoutes:
      operations === undefined || sessions === undefined
        ? undefined
        : new AdminInsightRoutes({
            accounts: new AdminAccountDirectory(input.database),
            activity: new AdminActivityDirectory(input.database),
            adminContext,
            now,
            operations,
            search: new AdminSearchDirectory(input.database),
            sessions,
          }),
    operatorRoutes:
      operations === undefined
        ? undefined
        : new AdminOperatorRoutes({
            adminContext,
            environment: input.environment,
            now,
            operations,
          }),
    platformRoutes: new AdminPlatformRoutes({
      adminContext,
      controls,
      environment: input.environment,
      health: new AdminOperationsHealthDirectory(input.database),
      jobs: input.jobs ?? new UnobservedJobQueues(),
      live: new AdminLiveDirectory({ database: input.database, now }),
      now,
      publicEntry: new AdminPublicEntryDirectory({
        database: input.database,
        now,
      }),
      ...(input.publicWebOrigin === undefined
        ? {}
        : { publicWebOrigin: input.publicWebOrigin }),
      readiness: input.dependencyReadiness ?? (() => Promise.resolve([])),
      reconciliation: new AdminReconciliationDirectory({
        database: input.database,
        now,
      }),
    }),
    routes: new AdminRoutes({ adminContext, directory, service }),
    service,
  };
}
