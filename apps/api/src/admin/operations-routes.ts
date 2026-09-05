import {
  adminAccountListResponseSchema,
  adminAuditResponseSchema,
  adminAuditStreamSchema,
  adminClubListResponseSchema,
  adminOverviewResponseSchema,
  adminPaymentDetailResponseSchema,
  adminPaymentListResponseSchema,
  adminPayoutListResponseSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
} from '@velora/validation';

import { paymentStates, type PaymentState } from '../billing/payment-policy.js';
import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  payoutInstructionStates,
  type PayoutInstructionState,
} from '../payouts/policy.js';
import { userAccountStatuses } from '../users/schema.js';
import type { AdminContextResolver } from './context.js';
import type {
  AdminAccountRow,
  AdminAuditRow,
  AdminClubMembershipRow,
  AdminClubRow,
  AdminDisputeRow,
  AdminOperationsDirectory,
  AdminPaymentRow,
  AdminPayoutRow,
  AdminRefundRow,
} from './operations-directory.js';

/**
 * The operator reads that are not one domain's health.
 *
 * Seven routes, every one a GET, and there is deliberately no eighth that
 * writes. The operations an operator has are the explicit commands the other
 * ADMIN route modules declare — a suspension, a reinstatement, an object
 * removal, a membership revocation, a case decision, an appeal outcome, a
 * refund, a media purge — and each of those goes through the owning domain's
 * own service with an actor and a reason. Nothing here could ever become one:
 * this module has a directory that only selects, and no service at all.
 *
 * Two things every handler does before anything else, in this order. It
 * resolves the operator, which refuses a wrong audience and a stale assurance
 * separately and refuses both before any lookup happens on the caller's behalf.
 * And it validates every query value against a closed vocabulary — a state, a
 * status, a stream — rather than passing a string through to a comparison,
 * because a filter that accepts anything is a filter somebody eventually
 * probes with something else.
 */

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * An optional identifier from the query, or the fact that it was not one.
 *
 * A shape rather than a sentinel string, because "the caller supplied nothing"
 * and "the caller supplied nonsense" lead to different answers — one reads the
 * whole list and the other is refused — and a sentinel that lives in the same
 * type as a legal value is a sentinel somebody eventually passes through.
 */
type OptionalIdentifier =
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false };

function optionalIdentifier(value: string | null): OptionalIdentifier {
  if (value === null) return { ok: true, value: undefined };
  return uuidPattern.test(value) ? { ok: true, value } : { ok: false };
}

/** An instant, or nothing, in the one shape the contract admits. */
function moment(value: Date | null | undefined): string | undefined {
  return value === null || value === undefined
    ? undefined
    : value.toISOString();
}

function accountBody(row: AdminAccountRow) {
  return {
    createdAt: row.createdAt.toISOString(),
    ...(row.deletionRequestedAt === null
      ? {}
      : { deletionRequestedAt: row.deletionRequestedAt.toISOString() }),
    id: row.id,
    ...(row.region === null ? {} : { region: row.region }),
    status: row.status,
    statusChangedAt: row.statusChangedAt.toISOString(),
    ...(row.statusReason === null ? {} : { statusReason: row.statusReason }),
  };
}

function paymentBody(row: AdminPaymentRow) {
  return {
    amountMinor: row.amountMinor.toString(),
    createdAt: row.createdAt.toISOString(),
    currency: row.currency,
    ...(row.failureReason === null ? {} : { failureReason: row.failureReason }),
    id: row.id,
    ...(row.lastProviderSyncAt === null
      ? {}
      : { lastProviderSyncAt: row.lastProviderSyncAt.toISOString() }),
    provider: row.provider,
    ...(row.providerReference === null
      ? {}
      : { providerReference: row.providerReference }),
    ...(row.resourceType === null ? {} : { resourceType: row.resourceType }),
    state: row.state,
    ...(row.taxMinor === null ? {} : { taxMinor: row.taxMinor.toString() }),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function refundBody(row: AdminRefundRow) {
  return {
    amountMinor: row.amountMinor.toString(),
    createdAt: row.createdAt.toISOString(),
    currency: row.currency,
    ...(row.failureReason === null ? {} : { failureReason: row.failureReason }),
    id: row.id,
    paymentId: row.paymentId,
    provider: row.provider,
    ...(row.providerReference === null
      ? {}
      : { providerReference: row.providerReference }),
    reasonCode: row.reasonCode,
    state: row.state,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function disputeBody(row: AdminDisputeRow) {
  return {
    amountMinor: row.amountMinor.toString(),
    createdAt: row.createdAt.toISOString(),
    currency: row.currency,
    ...(moment(row.evidenceDueAt) === undefined
      ? {}
      : { evidenceDueAt: row.evidenceDueAt?.toISOString() }),
    id: row.id,
    openedAt: row.openedAt.toISOString(),
    paymentId: row.paymentId,
    providerReference: row.providerReference,
    reasonCode: row.reasonCode,
    ...(moment(row.resolvedAt) === undefined
      ? {}
      : { resolvedAt: row.resolvedAt?.toISOString() }),
    state: row.state,
  };
}

function payoutBody(row: AdminPayoutRow) {
  return {
    amountMinor: row.amountMinor.toString(),
    createdAt: row.createdAt.toISOString(),
    creatorId: row.creatorId,
    currency: row.currency,
    ...(row.failureReason === null ? {} : { failureReason: row.failureReason }),
    id: row.id,
    ...(row.lastProviderSyncAt === null
      ? {}
      : { lastProviderSyncAt: row.lastProviderSyncAt.toISOString() }),
    provider: row.provider,
    ...(row.providerReference === null
      ? {}
      : { providerReference: row.providerReference }),
    requestedBy: row.requestedBy,
    state: row.state,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clubBody(row: AdminClubRow) {
  return {
    ...(row.closedAt === null ? {} : { closedAt: row.closedAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
    creatorId: row.creatorId,
    ...(row.handle === undefined ? {} : { handle: row.handle }),
    id: row.id,
    lifecycle: row.lifecycle,
    memberships: row.memberships,
    name: row.name,
    ...(row.publishedAt === null
      ? {}
      : { publishedAt: row.publishedAt.toISOString() }),
    slug: row.slug,
  };
}

function membershipBody(row: AdminClubMembershipRow) {
  return {
    grantedAt: row.grantedAt.toISOString(),
    id: row.id,
    ...(row.revokedAt === null
      ? {}
      : { revokedAt: row.revokedAt.toISOString() }),
    source: row.source,
    state: row.state,
  };
}

function auditBody(row: AdminAuditRow) {
  return {
    ...(row.actorReference === undefined
      ? {}
      : { actorReference: row.actorReference }),
    ...(row.audience === undefined ? {} : { audience: row.audience }),
    ...(row.correlationId === undefined
      ? {}
      : { correlationId: row.correlationId }),
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
    stream: row.stream,
    ...(row.subjectType === undefined ? {} : { subjectType: row.subjectType }),
    what: row.what,
  };
}

export interface AdminOperationsRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly operations: AdminOperationsDirectory;
}

export class AdminOperationsRoutes {
  constructor(
    private readonly dependencies: AdminOperationsRoutesDependencies,
  ) {}

  /** What needs a person right now, counted over whole tables. */
  async getOverview(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operations.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const overview = await this.dependencies.operations.overview();
    return {
      body: adminOverviewResponseSchema.parse({
        attention: overview.attention,
        casesByPriority: overview.casesByPriority,
        casesByQueue: overview.casesByQueue,
        observedAt: overview.observedAt.toISOString(),
        ...(overview.oldestOpenCaseAt === undefined
          ? {}
          : { oldestOpenCaseAt: overview.oldestOpenCaseAt.toISOString() }),
      }),
      status: 200,
    };
  }

  async listAccounts(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'users.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const size = this.pageSize(query.get('pageSize'));
    if (size === undefined) return this.invalid(input);

    const status = query.get('status');
    if (
      status !== null &&
      !(userAccountStatuses as readonly string[]).includes(status)
    ) {
      return this.invalid(input);
    }
    const accountId = optionalIdentifier(query.get('accountId'));
    if (!accountId.ok) return this.invalid(input);

    const page = await this.dependencies.operations.accounts({
      accountId: accountId.value,
      cursor: query.get('cursor') ?? undefined,
      pageSize: size,
      status: status ?? undefined,
    });
    return {
      body: adminAccountListResponseSchema.parse({
        accounts: page.rows.map((row) => accountBody(row)),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
        statusCounts: page.statusCounts,
      }),
      status: 200,
    };
  }

  async listPayments(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'billing.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const size = this.pageSize(query.get('pageSize'));
    if (size === undefined) return this.invalid(input);

    const state = query.get('state');
    if (
      state !== null &&
      !(paymentStates as readonly string[]).includes(state)
    ) {
      return this.invalid(input);
    }

    const page = await this.dependencies.operations.payments({
      cursor: query.get('cursor') ?? undefined,
      pageSize: size,
      state: (state ?? undefined) as PaymentState | undefined,
    });
    return {
      body: adminPaymentListResponseSchema.parse({
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
        payments: page.rows.map((row) => paymentBody(row)),
      }),
      status: 200,
    };
  }

  /** One payment, with every reversal and claim recorded against it. */
  async getPayment(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'billing.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const paymentId = optionalIdentifier(
      new URL(input.request.url).searchParams.get('paymentId'),
    );
    if (!paymentId.ok || paymentId.value === undefined) {
      return this.invalid(input);
    }

    const detail = await this.dependencies.operations.payment(paymentId.value);
    if (detail === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: adminPaymentDetailResponseSchema.parse({
        disputes: detail.disputes.map((row) => disputeBody(row)),
        payment: paymentBody(detail.payment),
        refunds: detail.refunds.map((row) => refundBody(row)),
      }),
      status: 200,
    };
  }

  async listPayouts(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'billing.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const size = this.pageSize(query.get('pageSize'));
    if (size === undefined) return this.invalid(input);

    const state = query.get('state');
    if (
      state !== null &&
      !(payoutInstructionStates as readonly string[]).includes(state)
    ) {
      return this.invalid(input);
    }
    const creatorId = optionalIdentifier(query.get('creatorId'));
    if (!creatorId.ok) return this.invalid(input);

    const page = await this.dependencies.operations.payouts({
      creatorId: creatorId.value,
      cursor: query.get('cursor') ?? undefined,
      pageSize: size,
      state: (state ?? undefined) as PayoutInstructionState | undefined,
    });
    return {
      body: adminPayoutListResponseSchema.parse({
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
        payouts: page.rows.map((row) => payoutBody(row)),
      }),
      status: 200,
    };
  }

  async listClubs(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'creators.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const size = this.pageSize(query.get('pageSize'));
    if (size === undefined) return this.invalid(input);

    const clubId = optionalIdentifier(query.get('clubId'));
    if (!clubId.ok) return this.invalid(input);
    const creatorId = optionalIdentifier(query.get('creatorId'));
    if (!creatorId.ok) return this.invalid(input);

    const page = await this.dependencies.operations.clubs({
      clubId: clubId.value,
      creatorId: creatorId.value,
      cursor: query.get('cursor') ?? undefined,
      pageSize: size,
    });
    return {
      body: adminClubListResponseSchema.parse({
        clubs: page.rows.map((row) => clubBody(row)),
        ...(page.memberships === undefined
          ? {}
          : {
              memberships: page.memberships.map((row) => membershipBody(row)),
            }),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      }),
      status: 200,
    };
  }

  async listAudit(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'audit.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const size = this.pageSize(query.get('pageSize'));
    if (size === undefined) return this.invalid(input);

    const rawStream = query.get('stream');
    const stream =
      rawStream === null
        ? adminAuditStreamSchema.parse('security')
        : adminAuditStreamSchema.safeParse(rawStream);
    if (typeof stream !== 'string' && !stream.success) {
      return this.invalid(input);
    }

    const page = await this.dependencies.operations.audit({
      cursor: query.get('cursor') ?? undefined,
      pageSize: size,
      stream: typeof stream === 'string' ? stream : stream.data,
    });
    return {
      body: adminAuditResponseSchema.parse({
        entries: page.rows.map((row) => auditBody(row)),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
        stream: page.stream,
      }),
      status: 200,
    };
  }

  /** The requested page size, or nothing when it was not a legal one. */
  private pageSize(raw: string | null): number | undefined {
    if (raw === null) return defaultPageSize;
    const parsed = pageSizeSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
