import {
  consumerGiftListResponseSchema,
  creatorReceivedGiftListResponseSchema,
  creatorHandleSchema,
  currencyCodeSchema,
  giftCatalogResponseSchema,
  giftCatalogProvisionResponseSchema,
  idempotencyHeader,
  idempotencyKeySchema,
  productErrorCodes,
  sendGiftRequestSchema,
  sendGiftResponseSchema,
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
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
} from '../users/context.js';
import type { GiftHistoryRow } from './gift-repository.js';
import type { GiftRefusal, GiftService } from './gift-service.js';

export interface GiftRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly creatorContext: CreatorContextResolver;
  readonly service: GiftService;
}

function consumerGiftBody(row: GiftHistoryRow) {
  return {
    createdAt: row.createdAt.toISOString(),
    creator: {
      displayName: row.recipientDisplayName,
      handle: row.recipientHandle,
    },
    gift: { id: row.catalogItemId, name: row.name, visual: row.visual },
    id: row.giftId,
    price: { amountMinor: row.amountMinor.toString(), currency: row.currency },
    ...(row.sentAt === null ? {} : { sentAt: row.sentAt.toISOString() }),
    state: row.state,
  };
}

export class GiftRoutes {
  constructor(private readonly dependencies: GiftRoutesDependencies) {}

  async catalog(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const query = new URL(input.request.url).searchParams;
    const handle = creatorHandleSchema.safeParse(query.get('handle'));
    const currency = currencyCodeSchema.safeParse(query.get('currency'));
    if (!handle.success || !currency.success) return this.invalid(input);
    const outcome = await this.dependencies.service.catalog({
      currency: currency.data,
      handle: handle.data,
      senderUserId: resolved.context.userId,
    });
    if (outcome.kind === 'refused') return this.refusal(input, outcome.reason);
    return {
      body: giftCatalogResponseSchema.parse({
        creator: {
          displayName: outcome.recipient.displayName,
          handle: outcome.recipient.handle,
        },
        enabled: outcome.enabled,
        items: outcome.items.map((item) => ({
          description: item.catalog.description,
          id: item.catalog.id,
          name: item.catalog.name,
          price: {
            amountMinor: item.amountMinor.toString(),
            currency: item.currency,
          },
          tier: item.catalog.tier,
          visual: item.catalog.visual,
        })),
      }),
      status: 200,
    };
  }

  async send(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    if (resolved.context.auth.audience !== 'consumer_web') {
      return routeFailure(
        403,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }
    const parsed = parseRouteBody(sendGiftRequestSchema, input.body);
    const key = idempotencyKeySchema.safeParse(
      contractHeader(input.request, idempotencyHeader) ?? '',
    );
    if (!parsed.ok || !key.success) return this.invalid(input);
    const outcome = await this.dependencies.service.send({
      correlationId: input.correlationId,
      currency: parsed.value.currency,
      giftItemId: parsed.value.giftItemId,
      handle: parsed.value.handle,
      idempotencyKey: key.data,
      senderUserId: resolved.context.userId,
    });
    if (outcome.kind === 'refused') return this.refusal(input, outcome.reason);
    return {
      body: sendGiftResponseSchema.parse({
        gift: consumerGiftBody(outcome.gift),
      }),
      status: 201,
    };
  }

  async listSent(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const gifts = await this.dependencies.service.listSent(
      resolved.context.userId,
    );
    return {
      body: consumerGiftListResponseSchema.parse({
        gifts: gifts.map(consumerGiftBody),
      }),
      status: 200,
    };
  }

  async listReceived(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const gifts = await this.dependencies.service.listReceived(
      resolved.context.creatorId,
    );
    return {
      body: creatorReceivedGiftListResponseSchema.parse({
        gifts: gifts.map((row) => ({
          createdAt: row.createdAt.toISOString(),
          earning: {
            amountMinor: row.earning.amountMinor.toString(),
            currency: row.earning.currency,
          },
          gift: { id: row.catalogItemId, name: row.name, visual: row.visual },
          gross: {
            amountMinor: row.amountMinor.toString(),
            currency: row.currency,
          },
          id: row.giftId,
          senderVisibility: 'withheld',
          ...(row.sentAt === null ? {} : { sentAt: row.sentAt.toISOString() }),
          state: row.state,
        })),
      }),
      status: 200,
    };
  }

  async provisionLocalCatalog(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const offers = await this.dependencies.service.provisionLocalCatalog(
      resolved.context.creatorId,
    );
    if (offers === undefined) return this.refusal(input, 'unavailable');
    return {
      body: giftCatalogProvisionResponseSchema.parse({ offers }),
      status: 200,
    };
  }

  private refusal(input: RouteRequest, reason: GiftRefusal): RouteResult {
    if (reason === 'unavailable') {
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (reason === 'conflict') {
      return routeFailure(
        409,
        productErrorCodes.idempotencyMismatch,
        input.correlationId,
      );
    }
    if (reason === 'not_found') {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return routeFailure(
      403,
      productErrorCodes.accountNotEligible,
      input.correlationId,
    );
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
