import {
  mediaDeliveryListResponseSchema,
  mediaDeliveryRequestSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type {
  ConsumerContextResolver,
  OptionalConsumerResolution,
} from '../users/context.js';
import type { DistributionSurface } from '../safety/policy.js';
import type { MediaDeliveryService } from './delivery.js';
import type { MediaRepository } from './repository.js';

/**
 * The one route that turns an asset reference into something a client can
 * fetch.
 *
 * Everything it needs already existed and was unreachable: `MediaDeliveryService`
 * re-derives the whole publication decision at issuance, the owning domains each
 * answer for their own attachments, and Trust and Safety answers for
 * restriction. What was missing was a door. This is the door, and it is
 * deliberately thin — it decides nothing, and every refusal below comes from
 * somewhere else.
 *
 * ## Why one answer for the whole batch, and silence per asset
 *
 * A caller names references it already holds, which means an identifier in the
 * request is not a secret and the interesting question is never "does this
 * exist". An asset that is absent, unprocessed, unpublished, not this caller's
 * to see, or restricted is simply missing from the response, so no combination
 * of requests distinguishes those cases. The single exception is a platform with
 * no delivery provider at all, which is a truthful statement about the
 * environment rather than about anything named in the request, and is therefore
 * the one refusal that answers the whole call.
 *
 * ## Why the surface is not a request field
 *
 * `DistributionSurface` participates in the mature-content gate, so a client
 * choosing its own value would be a client choosing its own safety answer. It is
 * derived from the audience of the credential presented, and an unauthenticated
 * caller is `web` because the only unauthenticated surface that renders media is
 * a published creator page in a browser.
 */
export class MediaDeliveryRoutes {
  constructor(
    private readonly dependencies: {
      readonly consumerContext: ConsumerContextResolver;
      readonly delivery: MediaDeliveryService;
      readonly repository: MediaRepository;
    },
  ) {}

  async createDeliveries(input: RouteRequest): Promise<RouteResult> {
    const parsed = parseRouteBody(mediaDeliveryRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const resolution = await this.dependencies.consumerContext.resolveOptional(
      input.request,
      input.correlationId,
    );
    if (resolution.kind === 'denied') return resolution.result;
    const viewer = viewerOf(resolution);

    // No transaction. Each authorization is a point-in-time read and holding
    // one open across a batch would keep a pooled connection for the whole
    // walk, while the association ports below legitimately read through their
    // own domains' handles. Nothing here writes.
    const executor = this.dependencies.repository.transactionless;
    const deliveries: {
      assetId: string;
      expiresAt?: string;
      url: string;
    }[] = [];

    // Sequential, not concurrent. Each authorization takes its own pooled
    // connection, so running a batch together lets one in-flight request hold
    // several at once — and a handful of concurrent requests then hold every
    // connection while each waits for one more, which is a deadlock the pool
    // cannot break. A request holds at most one pooled connection at a time.
    for (const assetId of dedupe(parsed.value.assetIds)) {
      const outcome = await this.dependencies.delivery.authorize({
        assetId,
        executor,
        surface: viewer.surface,
        variantKind: parsed.value.variant,
        viewerId: viewer.id,
      });
      switch (outcome.kind) {
        case 'unavailable': {
          // The environment has no delivery provider, so nothing in this batch
          // could ever be served and continuing would produce an empty list
          // that reads as "you may see none of these".
          return routeFailure(
            503,
            productErrorCodes.dependencyUnavailable,
            input.correlationId,
          );
        }
        case 'denied': {
          break;
        }
        case 'public': {
          deliveries.push({ assetId, url: outcome.url });
          break;
        }
        case 'private': {
          deliveries.push({
            assetId,
            expiresAt: outcome.expiresAt.toISOString(),
            url: outcome.url,
          });
          break;
        }
      }
    }

    return {
      body: mediaDeliveryListResponseSchema.parse({ deliveries }),
      status: 200,
    };
  }
}

/** Who is asking, and from where, in the two terms delivery is decided on. */
function viewerOf(resolution: OptionalConsumerResolution): {
  readonly id: string | undefined;
  readonly surface: DistributionSurface;
} {
  if (resolution.kind !== 'resolved') {
    return { id: undefined, surface: 'web' };
  }
  return {
    id: resolution.context.userId,
    surface:
      resolution.context.auth.audience === 'consumer_mobile'
        ? // Android is the only mobile surface this platform has: ADR-0031
          // generates no iOS project and `MOBILE_IOS` is structurally
          // ineligible. Both mobile surfaces are mature-ineligible in any case,
          // so this choice cannot change a delivery decision today — it names
          // the one that exists rather than guessing between two.
          'mobile_android'
        : 'web',
  };
}

/**
 * The same asset named twice is one authorization and one entry.
 *
 * A caller assembling a batch from a rendered page can legitimately repeat a
 * reference; charging it twice would mean the bound on the request is not a
 * bound on the work.
 */
function dedupe(assetIds: readonly string[]): readonly string[] {
  return [...new Set(assetIds)];
}
