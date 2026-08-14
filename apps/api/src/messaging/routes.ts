import {
  conversationIdSchema,
  conversationListResponseSchema,
  conversationReadResponseSchema,
  conversationSchema,
  createConversationRequestSchema,
  cursorSchema,
  defaultPageSize,
  markConversationReadRequestSchema,
  messageListResponseSchema,
  messageSchema,
  pageSizeSchema,
  productErrorCodes,
  sendMessageRequestSchema,
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
import type {
  ConversationView,
  MessageView,
  MessagingService,
} from './service.js';

export interface MessagingRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly messaging: MessagingService;
}

export class MessagingRoutes {
  constructor(private readonly dependencies: MessagingRoutesDependencies) {}

  async createConversation(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(createConversationRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.messaging.openConversation(
      resolved.context.account,
      parsed.value.introductionId,
    );
    switch (outcome.kind) {
      case 'conversation': {
        return {
          body: conversationSchema.parse(conversationBody(outcome.view)),
          status: 200,
        };
      }
      case 'not_found': {
        return routeFailure(
          404,
          productErrorCodes.notFound,
          input.correlationId,
        );
      }
      case 'not_permitted': {
        return routeFailure(
          409,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
      }
    }
  }

  async listConversations(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const paging = paginationOf(input);
    if (paging === undefined) return this.invalid(input);

    const outcome = await this.dependencies.messaging.listConversations(
      resolved.context.account,
      paging,
    );
    if (outcome.kind === 'invalid_cursor') return this.invalid(input);
    if (outcome.kind === 'not_eligible') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return {
      body: conversationListResponseSchema.parse({
        conversations: outcome.conversations.map(conversationBody),
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
      }),
      status: 200,
    };
  }

  async listMessages(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const paging = paginationOf(input);
    const parameters = new URL(input.request.url).searchParams;
    const conversationId = conversationIdSchema.safeParse(
      parameters.get('conversationId') ?? '',
    );
    if (paging === undefined || !conversationId.success) {
      return this.invalid(input);
    }

    const outcome = await this.dependencies.messaging.listMessages(
      resolved.context.account,
      { ...paging, conversationId: conversationId.data },
    );
    switch (outcome.kind) {
      case 'page': {
        return {
          body: messageListResponseSchema.parse({
            conversationId: outcome.conversationId,
            messages: outcome.messages.map(messageBody),
            ...(outcome.nextCursor === undefined
              ? {}
              : { nextCursor: outcome.nextCursor }),
          }),
          status: 200,
        };
      }
      case 'invalid_cursor': {
        return this.invalid(input);
      }
      case 'not_found': {
        return routeFailure(
          404,
          productErrorCodes.notFound,
          input.correlationId,
        );
      }
      case 'not_permitted': {
        return routeFailure(
          409,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
      }
    }
  }

  async sendMessage(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(sendMessageRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.messaging.sendMessage(
      resolved.context.account,
      parsed.value,
    );
    switch (outcome.kind) {
      case 'message': {
        return {
          body: messageSchema.parse(messageBody(outcome.view)),
          status: 200,
        };
      }
      case 'not_found': {
        return routeFailure(
          404,
          productErrorCodes.notFound,
          input.correlationId,
        );
      }
      case 'idempotency_mismatch': {
        return routeFailure(
          409,
          productErrorCodes.idempotencyMismatch,
          input.correlationId,
        );
      }
      case 'not_permitted': {
        return routeFailure(
          409,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
      }
    }
  }

  async markConversationRead(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      markConversationReadRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.messaging.markRead(
      resolved.context.account,
      parsed.value,
    );
    switch (outcome.kind) {
      case 'read': {
        return {
          body: conversationReadResponseSchema.parse({
            conversationId: outcome.conversationId,
            lastReadSequence: outcome.lastReadSequence,
          }),
          status: 200,
        };
      }
      case 'not_found': {
        return routeFailure(
          404,
          productErrorCodes.notFound,
          input.correlationId,
        );
      }
      case 'not_permitted': {
        return routeFailure(
          409,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
      }
    }
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
  return {
    cursor: cursor?.data,
    pageSize: pageSize?.data ?? defaultPageSize,
  };
}

/**
 * A conversation as one of its two people sees it.
 *
 * The counterpart carries a name and a picture and nothing else. The other
 * person's read position is absent: whether somebody has read a message is
 * their business, and publishing it is a presence signal the approved policy
 * does not include.
 */
function conversationBody(view: ConversationView) {
  return {
    counterpart: {
      displayName: view.counterpart.displayName,
      id: view.counterpart.id,
      media: view.counterpart.media.map((item) => ({
        id: item.id,
        position: item.position,
      })),
    },
    createdAt: view.createdAt.toISOString(),
    id: view.id,
    lastActivityAt: view.lastActivityAt.toISOString(),
    lastMessageSequence: view.lastMessageSequence,
    lastReadSequence: view.lastReadSequence,
    state: view.state,
  };
}

function messageBody(view: MessageView) {
  return {
    body: view.body,
    clientMessageId: view.clientMessageId,
    conversationId: view.conversationId,
    createdAt: view.createdAt.toISOString(),
    id: view.id,
    senderId: view.senderId,
    sequence: view.sequence,
  };
}
