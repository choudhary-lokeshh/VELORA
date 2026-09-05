import {
  adminDisputeListResponseSchema,
  adminFinancialStateResponseSchema,
  defaultPageSize,
  idempotencyHeader,
  idempotencyKeySchema,
  issueRefundRequestSchema,
  pageSizeSchema,
  productErrorCodes,
  refundResponseSchema,
} from '@velora/validation';

import type {
  RefundOutcome,
  RefundRefusal,
  RefundService,
} from '../billing/refund-service.js';
import { decodeOfferCursor, encodeOfferCursor } from '../billing/cursor.js';
import type {
  DisputeRepository,
  DisputeRow,
} from '../billing/dispute-repository.js';
import type { MonetisationReadiness } from '../billing/offer-service.js';
import type { RefundRow } from '../billing/refund-repository.js';
import {
  contractHeader,
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { AdminContextResolver } from './context.js';
import type { AdminFinancialDirectory } from './financial-directory.js';

/**
 * The operator financial surface.
 *
 * There is deliberately no consumer counterpart anywhere in the API. Refund
 * eligibility — who may ask for their money back, within what window, for what
 * proportion — is unresolved commercial policy in
 * `docs/decisions/DECISIONS_REQUIRED.md`, and a self-service control would be a
 * commercial promise nobody has approved. Until that decision exists, a
 * reversal is something a person with operator authority decides, on a record,
 * with a reason.
 *
 * In a deployed environment this route is unreachable twice over. ADR-0017
 * requires a fresh phishing-resistant assurance and no verifier that can
 * produce one is approved, so no session reaches the handler; and
 * `BILLING_PAYMENT_PROVIDER` is `unavailable` there, so the service refuses
 * before it writes anything. Neither refusal depends on the other.
 *
 * Nothing here edits a financial row. An operator names a payment, an amount,
 * and a reason; BILLING decides whether that is a reversal it can make, and the
 * only thing that changes state afterwards is the provider's own answer.
 */

export interface AdminBillingRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  /** Which capability seams are configured, reported by adapter name. */
  readonly capabilities: {
    readonly commerceEligibility: string;
    readonly commercePolicy: string;
    readonly paymentProvider: string;
    readonly payoutPolicy: string;
    readonly payoutProvider: string;
    readonly taxAuthority: string;
  };
  readonly disputes: DisputeRepository;
  readonly financial: AdminFinancialDirectory;
  /** What the platform may currently sell, which is also what it may answer for. */
  readonly readiness: () => MonetisationReadiness;
  readonly refunds: RefundService;
}

/**
 * One claim as the operator answering it sees it.
 *
 * The provider's own reference is here because answering a dispute means
 * quoting it back, and an operator who cannot name the case cannot work it.
 * Nothing about the cardholder appears: a dispute is about a payment, and who
 * made that payment is not something a finance queue should be able to group by.
 */
function disputeBody(dispute: DisputeRow) {
  return {
    amount: {
      amountMinor: dispute.amountMinor.toString(),
      currency: dispute.currency,
    },
    createdAt: dispute.createdAt.toISOString(),
    ...(dispute.evidenceDueAt === null
      ? {}
      : { evidenceDueAt: dispute.evidenceDueAt.toISOString() }),
    id: dispute.id,
    openedAt: dispute.openedAt.toISOString(),
    paymentId: dispute.paymentId,
    providerReference: dispute.providerReference,
    reasonCode: dispute.reasonCode,
    ...(dispute.resolvedAt === null
      ? {}
      : { resolvedAt: dispute.resolvedAt.toISOString() }),
    state: dispute.state,
  };
}

/** One reversal as an operator sees it. No provider reference, no actor name. */
function refundBody(refund: RefundRow) {
  return {
    amount: {
      amountMinor: refund.amountMinor.toString(),
      currency: refund.currency,
    },
    createdAt: refund.createdAt.toISOString(),
    ...(refund.failureReason === null
      ? {}
      : { failureReason: refund.failureReason }),
    id: refund.id,
    paymentId: refund.paymentId,
    reasonCode: refund.reasonCode,
    state: refund.state,
    updatedAt: refund.updatedAt.toISOString(),
  };
}

export class AdminBillingRoutes {
  constructor(private readonly dependencies: AdminBillingRoutesDependencies) {}

  /**
   * The platform's money in operational terms.
   *
   * A read and only a read. Every figure is a count or a per-currency total,
   * and nothing on it identifies a person, a provider object, or a payout
   * recipient — an operator needs to know what state the money is in, and a
   * screen that also carried a bank detail would be a screen somebody
   * eventually screenshots.
   */
  async getFinancialState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'billing.read',
    );
    if ('failure' in resolved) return resolved.failure;
    const state = await this.dependencies.financial.operationalState();
    return {
      body: adminFinancialStateResponseSchema.parse({
        capabilities: this.dependencies.capabilities,
        disputes: state.disputes,
        openDisputeTotals: state.openDisputeTotals,
        payableTotals: state.payableTotals,
        payments: state.payments,
        payouts: state.payouts,
        reconciliation: state.reconciliation,
        refunds: state.refunds,
        subscriptions: state.subscriptions,
      }),
      status: 200,
    };
  }

  /**
   * The dispute queue.
   *
   * A read and only a read. There is no evidence submission and no field that
   * could become one: whether VELORA may submit evidence, in what form, and
   * through which provider is unresolved, and a control that accepted a file
   * and did nothing with it would be worse than its absence.
   */
  async listDisputes(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'billing.read',
    );
    if ('failure' in resolved) return resolved.failure;
    const query = new URL(input.request.url).searchParams;
    const rawPageSize = query.get('pageSize');
    const pageSize =
      rawPageSize === null
        ? defaultPageSize
        : pageSizeSchema.safeParse(rawPageSize).data;
    const open = query.get('open');
    if (
      pageSize === undefined ||
      (open !== null && open !== 'true' && open !== 'false')
    ) {
      return this.invalid(input);
    }
    const cursor = query.get('cursor');
    const rows = await this.dependencies.disputes.listRecent(
      this.dependencies.disputes.transactionless,
      {
        after: cursor === null ? undefined : decodeOfferCursor(cursor),
        limit: pageSize + 1,
        openOnly: open === 'true',
      },
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      body: adminDisputeListResponseSchema.parse({
        disputes: page.map(disputeBody),
        ...(rows.length > pageSize && last !== undefined
          ? {
              nextCursor: encodeOfferCursor({
                id: last.id,
                moment: last.openedAt,
              }),
            }
          : {}),
        readiness: this.readinessBody(),
      }),
      status: 200,
    };
  }

  private readinessBody() {
    const readiness = this.dependencies.readiness();
    return {
      currencies: [...readiness.currencies],
      enabled: readiness.enabled,
      intervals: [...readiness.intervals],
      modes: [...readiness.modes],
      source: readiness.source,
    };
  }

  async issueRefund(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'billing.refund',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(issueRefundRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    // A key is required rather than optional. Without one a double-submitted
    // reversal is two reversals, and the server has nothing to recognise the
    // second by — which for money is the difference between returning it once
    // and returning it twice.
    const key = idempotencyKeySchema.safeParse(
      contractHeader(input.request, idempotencyHeader) ?? '',
    );
    if (!key.success) return this.invalid(input);

    const outcome = await this.dependencies.refunds.issue({
      actorReference: resolved.context.actorReference,
      amountMinor: BigInt(parsed.value.amountMinor),
      correlationId: input.correlationId,
      currency: parsed.value.currency,
      idempotencyKey: key.data,
      paymentId: parsed.value.paymentId,
      reasonCode: parsed.value.reasonCode,
    });
    return this.answer(input, outcome);
  }

  private answer(input: RouteRequest, outcome: RefundOutcome): RouteResult {
    if (outcome.kind === 'issued') {
      return {
        body: refundResponseSchema.parse({
          refund: refundBody(outcome.refund),
        }),
        status: 201,
      };
    }
    return this.refusal(input, outcome.reason);
  }

  private refusal(input: RouteRequest, reason: RefundRefusal): RouteResult {
    if (reason === 'unavailable') {
      // The environment cannot move money. A truthful statement about the
      // platform rather than a client error.
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (reason === 'idempotency_mismatch') {
      return routeFailure(
        409,
        productErrorCodes.idempotencyMismatch,
        input.correlationId,
      );
    }
    // One code for a payment that did not settle, a payment that does not
    // exist, a currency that is not the one it was captured in, and a reversal
    // that would exceed what was taken. An operator has the payment in front of
    // them; anybody probing this endpoint learns nothing finer.
    return routeFailure(409, productErrorCodes.conflict, input.correlationId);
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
