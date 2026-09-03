import {
  apiQueryParameters,
  createSupportTicketRequestSchema,
  cursorSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
  supportTicketListResponseSchema,
  supportTicketSchema,
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
import type { SupportService, SupportTicketView } from './service.js';

export interface SupportRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly support: SupportService;
}

/**
 * The consumer support surface.
 *
 * Three routes and no fourth. Somebody opens a ticket, reads their own tickets,
 * and reads one of them. There is deliberately no route that closes a ticket,
 * changes its status, or replies to it: a status is an operator's account of
 * what happened, and a person setting their own would make the one field this
 * whole surface exists to make trustworthy into a field anybody can write.
 *
 * Nothing here is gated on standing. A restricted account, an account whose
 * adult assurance has lapsed, and an account mid-deletion may all open a
 * ticket, because those are the accounts most likely to have something to ask
 * about — the same rule TRUST & SAFETY applies to blocking and reporting.
 *
 * Every refusal about somebody else's ticket is a `404` with the same body as
 * one that does not exist, so an identifier cannot be probed.
 */
export class SupportRoutes {
  constructor(private readonly dependencies: SupportRoutesDependencies) {}

  async createTicket(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(createSupportTicketRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.support.open({
      category: parsed.value.category,
      clientTicketId: parsed.value.clientTicketId,
      description: parsed.value.description,
      ownerId: resolved.context.userId,
      subject: parsed.value.subject,
    });
    switch (outcome.kind) {
      case 'ticket': {
        return { body: ticketBody(outcome.view), status: 200 };
      }
      case 'rate_limited': {
        // The product convention for a bound reached. It says only that, and
        // never which bound or how much of it remains.
        return routeFailure(
          409,
          productErrorCodes.rateLimited,
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          404,
          productErrorCodes.notFound,
          input.correlationId,
        );
      }
    }
  }

  async listTickets(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const paging = paginationOf(input);
    if (paging === undefined) return this.invalid(input);

    const outcome = await this.dependencies.support.listOwn({
      cursor: paging.cursor,
      ownerId: resolved.context.userId,
      pageSize: paging.pageSize,
    });
    if (outcome.kind !== 'page') return this.invalid(input);
    return {
      body: supportTicketListResponseSchema.parse({
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
        tickets: outcome.tickets.map((view) => ticketBody(view)),
      }),
      status: 200,
    };
  }

  async getTicket(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    // Validated against the published parameter before it reaches the domain.
    // Anything else is not an identifier this platform ever issued.
    const raw = new URL(input.request.url).searchParams.get('ticketId');
    const ticketId =
      raw === null ? undefined : apiQueryParameters.ticketId.safeParse(raw);
    if (ticketId?.success !== true) return this.invalid(input);

    const outcome = await this.dependencies.support.ownTicket({
      ownerId: resolved.context.userId,
      ticketId: ticketId.data,
    });
    return outcome.kind === 'ticket'
      ? { body: ticketBody(outcome.view), status: 200 }
      : routeFailure(404, productErrorCodes.notFound, input.correlationId);
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

/**
 * A ticket as its owner sees it.
 *
 * Their own words come back, which is the one place this deliberately differs
 * from a safety report: a report's narrative is evidence about somebody else,
 * and this is a person's account of their own problem. What never comes back is
 * an operator note, an operator reference, or anything about how the ticket is
 * being handled — none of those has a field in the shape this parses against.
 */
export function ticketBody(
  view: SupportTicketView,
): ReturnType<typeof supportTicketSchema.parse> {
  return supportTicketSchema.parse({
    category: view.category,
    createdAt: view.createdAt.toISOString(),
    description: view.description,
    id: view.id,
    reference: view.reference,
    status: view.status,
    subject: view.subject,
    updatedAt: view.updatedAt.toISOString(),
  });
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
  if (cursor?.success === false || pageSize?.success === false) {
    return undefined;
  }
  return { cursor: cursor?.data, pageSize: pageSize?.data ?? defaultPageSize };
}

export { paginationOf as supportPaginationOf };
