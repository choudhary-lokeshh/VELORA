import {
  creatorPayoutHistoryResponseSchema,
  creatorPayoutReadinessResponseSchema,
  idempotencyHeader,
  idempotencyKeySchema,
  payoutOnboardingResponseSchema,
  payoutResponseSchema,
  productErrorCodes,
  requestPayoutRequestSchema,
} from '@velora/validation';

import {
  requireCreator,
  type CreatorContextResolver,
} from '../creators/context.js';
import {
  contractHeader,
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { PayoutPolicy } from './payout-policy.js';
import { maximumPayoutPageSize } from './policy.js';
import type { PayoutProviderPort } from './provider.js';
import type { PayoutInstructionRow, PayoutsRepository } from './repository.js';
import type {
  PayoutOutcome,
  PayoutRefusal,
  PayoutsService,
} from './service.js';

/**
 * The creator payout surface.
 *
 * Three reads and one write, and in a deployed environment the write always
 * refuses and the reads always say why. That is the honest shape of a platform
 * whose payout architecture is built and whose payout capability is not
 * enabled: a creator is told plainly that payouts are unavailable rather than
 * meeting a button that fails, and the figures they are owed are still shown,
 * because the money is real whatever the platform can currently do with it.
 *
 * Onboarding is a redirect to the provider's own hosted flow and nothing else.
 * There is no route here that accepts a bank account number, a routing number,
 * an identity document, or a tax identifier, because there is no field for one
 * anywhere in this domain.
 */

export interface PayoutRoutesDependencies {
  readonly creatorContext: CreatorContextResolver;
  readonly policy: PayoutPolicy;
  readonly provider: PayoutProviderPort;
  readonly repository: PayoutsRepository;
  /** Where the provider returns a creator. Creator Studio, from configuration. */
  readonly returnOrigin: string | undefined;
  readonly service: PayoutsService;
}

function instructionBody(instruction: PayoutInstructionRow) {
  return {
    amount: {
      amountMinor: instruction.amountMinor.toString(),
      currency: instruction.currency,
    },
    createdAt: instruction.createdAt.toISOString(),
    ...(instruction.failureReason === null
      ? {}
      : { failureReason: instruction.failureReason }),
    id: instruction.id,
    state: instruction.state,
    updatedAt: instruction.updatedAt.toISOString(),
  };
}

export class PayoutRoutes {
  constructor(private readonly dependencies: PayoutRoutesDependencies) {}

  /**
   * Whether this creator could be paid, and what they hold in each currency.
   *
   * Readiness and balances travel together because they answer one question a
   * creator actually has. Separating them would let a surface show a balance
   * beside a control that cannot work.
   */
  async getReadiness(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const { policy, provider, repository } = this.dependencies;

    const balances = await repository.transaction(async (executor) => {
      const recipient = await repository.ensureRecipient(executor, {
        creatorId: resolved.context.creatorId,
        now: new Date(),
        provider: provider.provider,
      });
      const currencies = await repository.currenciesFor(
        executor,
        resolved.context.creatorId,
      );
      const rows = await Promise.all(
        currencies.map(async (currency) =>
          repository.balancesFor(executor, {
            creatorId: resolved.context.creatorId,
            currency,
          }),
        ),
      );
      return { recipient, rows };
    });

    return {
      body: creatorPayoutReadinessResponseSchema.parse({
        balances: balances.rows.map((row) => ({
          available: row.available.amountMinor.toString(),
          currency: row.currency,
          held: row.held.amountMinor.toString(),
          // What the policy would let go right now. Zero everywhere no terms
          // are published, which is what makes the control refuse honestly.
          releasable: (policy.releasable(row)?.amountMinor ?? 0n).toString(),
          reserved: row.reserved.amountMinor.toString(),
        })),
        // Two independent reasons a payout cannot happen, reported as two
        // fields, because a creator whose provider is fine but whose terms are
        // unpublished is in a different position from one who has not onboarded.
        enabled:
          provider.provider !== 'unavailable' &&
          policy.source !== 'unpublished',
        policySource: policy.source,
        providerSource: provider.provider,
        recipientStatus: balances.recipient?.status ?? 'absent',
      }),
      status: 200,
    };
  }

  /**
   * Starts the provider's own hosted onboarding.
   *
   * Velora returns a link and records the reference the provider gave it. It
   * collects nothing, stores nothing about a bank account or an identity
   * document, and has no field in which such a thing could arrive.
   */
  async startOnboarding(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const { provider, repository, returnOrigin } = this.dependencies;
    if (provider.provider === 'unavailable' || returnOrigin === undefined) {
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }

    await repository.transaction(async (executor) =>
      repository.ensureRecipient(executor, {
        creatorId: resolved.context.creatorId,
        now: new Date(),
        provider: provider.provider,
      }),
    );

    let session;
    try {
      // Outside every transaction, deliberately.
      session = await provider.startOnboarding({
        creatorReference: resolved.context.creatorId,
        returnUrl: `${returnOrigin}/payouts/onboarding/return`,
      });
    } catch {
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }

    // What the provider says about its own record, read back rather than
    // assumed. A provider that created a record and immediately refuses to pay
    // against it is a state Velora has to be able to report.
    const snapshot = await provider.retrieveRecipient(
      session.providerReference,
    );
    await repository.transaction(async (executor) =>
      repository.recordRecipient(executor, {
        capabilityCheckedAt: new Date(),
        creatorId: resolved.context.creatorId,
        now: new Date(),
        providerReference: session.providerReference,
        status: snapshot.status,
      }),
    );

    return {
      body: payoutOnboardingResponseSchema.parse({
        onboardingUrl: session.onboardingUrl,
        recipientStatus: snapshot.status,
      }),
      status: 201,
    };
  }

  /** Asks for money the book says this creator may have. */
  async requestPayout(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(requestPayoutRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    // A key is required rather than optional. Without one a double-submitted
    // request is two payouts, and the server has nothing to recognise the
    // second by.
    const key = idempotencyKeySchema.safeParse(
      contractHeader(input.request, idempotencyHeader) ?? '',
    );
    if (!key.success) return this.invalid(input);

    const outcome = await this.dependencies.service.request({
      amountMinor: BigInt(parsed.value.amountMinor),
      correlationId: input.correlationId,
      creatorId: resolved.context.creatorId,
      currency: parsed.value.currency,
      idempotencyKey: key.data,
      requestedBy: `creator:${resolved.context.creatorId}`,
    });
    return this.answer(input, outcome);
  }

  /** This creator's own payout instructions, newest first, keyset paged. */
  async listPayouts(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const { repository } = this.dependencies;
    const rows = await repository.listForCreator(repository.transactionless, {
      after: undefined,
      creatorId: resolved.context.creatorId,
      limit: maximumPayoutPageSize,
    });
    return {
      body: creatorPayoutHistoryResponseSchema.parse({
        payouts: rows.map(instructionBody),
      }),
      status: 200,
    };
  }

  private answer(input: RouteRequest, outcome: PayoutOutcome): RouteResult {
    if (outcome.kind === 'accepted') {
      return {
        body: payoutResponseSchema.parse({
          payout: instructionBody(outcome.instruction),
        }),
        status: 201,
      };
    }
    return this.refusal(input, outcome.reason);
  }

  private refusal(input: RouteRequest, reason: PayoutRefusal): RouteResult {
    if (reason === 'unavailable') {
      // The environment cannot send money. A truthful statement about the
      // platform rather than a client error, and the state every deployed
      // environment is in.
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
