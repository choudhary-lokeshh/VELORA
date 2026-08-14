import {
  cursorSchema,
  defaultPageSize,
  markNotificationsReadRequestSchema,
  notificationListResponseSchema,
  notificationReadResponseSchema,
  pageSizeSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
  type ConsumerRouteContext,
} from '../users/context.js';
import type { NotificationFeedService, NotificationView } from './feed.js';

/**
 * Consumer-facing notification routes.
 *
 * There are two, and they address the in-app surface only. Nothing here can
 * reach a delivery intent, an attempt, or the outbox that produced either: a
 * consumer has no route to lease state, retry counts, provider references, or
 * the reason a notice was suppressed, because no handler in this file can
 * produce one.
 */
export class NotificationRoutes {
  constructor(
    private readonly dependencies: {
      readonly consumerContext: ConsumerContextResolver;
      readonly feed: NotificationFeedService;
    },
  ) {}

  async listNotifications(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const paging = paginationOf(input);
    if (paging === undefined) return this.invalid(input);

    const outcome = await this.dependencies.feed.list(
      resolved.context.account,
      paging,
    );
    if (outcome.kind !== 'page') return this.invalid(input);
    return {
      body: notificationListResponseSchema.parse({
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
        notifications: outcome.notifications.map(notificationBody),
      }),
      status: 200,
    };
  }

  async markNotificationsRead(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      markNotificationsReadRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    const readIds = await this.dependencies.feed.markRead(
      resolved.context.account,
      parsed.value.notificationIds,
    );
    return {
      body: notificationReadResponseSchema.parse({ readIds: [...readIds] }),
      status: 200,
    };
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }
}

function paginationOf(
  input: RouteRequest,
):
  | { readonly cursor: string | undefined; readonly pageSize: number }
  | undefined {
  const parameters = new URL(input.request.url).searchParams;
  const rawCursor = parameters.get('cursor');
  const rawPageSize = parameters.get('pageSize');
  const cursor =
    rawCursor === null ? undefined : cursorSchema.safeParse(rawCursor);
  const pageSize =
    rawPageSize === null ? undefined : pageSizeSchema.safeParse(rawPageSize);
  if (cursor?.success === false || pageSize?.success === false)
    return undefined;
  return { cursor: cursor?.data, pageSize: pageSize?.data ?? defaultPageSize };
}

/**
 * A notice as its recipient sees it. Every field here is one the recipient can
 * already reach through an authorized route; there is no field for delivery
 * state, and so no response can carry one.
 */
function notificationBody(view: NotificationView) {
  return {
    ...(view.conversationId === undefined
      ? {}
      : { conversationId: view.conversationId }),
    createdAt: view.createdAt.toISOString(),
    id: view.id,
    ...(view.introductionId === undefined
      ? {}
      : { introductionId: view.introductionId }),
    kind: view.kind,
    ...(view.readAt === undefined ? {} : { readAt: view.readAt.toISOString() }),
    subjectId: view.subjectId,
  };
}
