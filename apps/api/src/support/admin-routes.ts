import {
  adminSupportTicketDetailResponseSchema,
  adminSupportTicketListResponseSchema,
  adminUpdateSupportTicketRequestSchema,
  apiQueryParameters,
  productErrorCodes,
} from '@velora/validation';

import type { AdminContextResolver } from '../admin/context.js';
import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import { supportTicketStatuses, type SupportTicketStatus } from './policy.js';
import type { SupportTicketEventRow } from './repository.js';
import { supportPaginationOf } from './routes.js';
import type { SupportService, SupportTicketView } from './service.js';

export interface AdminSupportRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly support: SupportService;
}

/**
 * The smallest operator surface a support ticket needs to be answerable.
 *
 * Three routes: read the queue, read one ticket with its history, move one
 * ticket and optionally say why. There is deliberately no fourth. An operator
 * cannot delete a ticket, cannot edit what somebody wrote, cannot reassign one,
 * and cannot reach an account, an enforcement, or a balance from here — those
 * are other surfaces with their own authority, and a support console that grew
 * a shortcut into one of them would be an enforcement path with none of the
 * audit the real one carries.
 *
 * `docs/decisions/ADR-0036-platform-admin-operations-console.md` is the
 * standard these follow: the operator is resolved first, which refuses a wrong
 * audience and a stale assurance separately and refuses both before any lookup
 * happens on the caller's behalf, and every query value is checked against a
 * closed vocabulary rather than passed through to a comparison.
 */
export class AdminSupportRoutes {
  constructor(private readonly dependencies: AdminSupportRoutesDependencies) {}

  async listTickets(input: RouteRequest): Promise<RouteResult> {
    const operator = await this.dependencies.adminContext.resolve(
      input,
      'support.read',
    );
    if ('failure' in operator) return operator.failure;
    const paging = supportPaginationOf(input);
    if (paging === undefined) return this.invalid(input);

    const raw = new URL(input.request.url).searchParams.get('status');
    if (raw !== null && !isTicketStatus(raw)) return this.invalid(input);
    const status = raw ?? undefined;

    const outcome = await this.dependencies.support.listForOperator({
      cursor: paging.cursor,
      pageSize: paging.pageSize,
      status,
    });
    if (outcome.kind !== 'page') return this.invalid(input);
    return {
      body: adminSupportTicketListResponseSchema.parse({
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
        tickets: outcome.tickets.map((view) => operatorTicketBody(view)),
      }),
      status: 200,
    };
  }

  async getTicket(input: RouteRequest): Promise<RouteResult> {
    const operator = await this.dependencies.adminContext.resolve(
      input,
      'support.read',
    );
    if ('failure' in operator) return operator.failure;
    const raw = new URL(input.request.url).searchParams.get('ticketId');
    const ticketId =
      raw === null ? undefined : apiQueryParameters.ticketId.safeParse(raw);
    if (ticketId?.success !== true) return this.invalid(input);

    const outcome = await this.dependencies.support.operatorTicket(
      ticketId.data,
    );
    if (outcome.kind !== 'ticket') {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: adminSupportTicketDetailResponseSchema.parse({
        events: outcome.events.map((event) => eventBody(event)),
        ticket: operatorTicketBody(outcome.view),
      }),
      status: 200,
    };
  }

  async updateTicket(input: RouteRequest): Promise<RouteResult> {
    const operator = await this.dependencies.adminContext.resolve(
      input,
      'support.update',
    );
    if ('failure' in operator) return operator.failure;
    const parsed = parseRouteBody(
      adminUpdateSupportTicketRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.support.transition({
      // The operator reference comes from the resolved context and never from
      // the body. A body field for it would be a field somebody could put
      // another operator's reference in.
      actorReference: operator.context.actorReference,
      note: parsed.value.note,
      status: parsed.value.status,
      ticketId: parsed.value.ticketId,
    });
    switch (outcome.kind) {
      case 'ticket': {
        return { body: operatorTicketBody(outcome.view), status: 200 };
      }
      case 'not_permitted': {
        return routeFailure(
          409,
          productErrorCodes.conflict,
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

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}

function isTicketStatus(value: string): value is SupportTicketStatus {
  return (supportTicketStatuses as readonly string[]).includes(value);
}

/**
 * A ticket as an operator sees it.
 *
 * The owner's account identifier is the one field the owner's own view does not
 * carry, and it is here because an operator has to be able to look the person
 * up through the existing account surface in order to help them. There is still
 * no address, no display name, and no device detail: this answers what somebody
 * asked for help with, and every other question about that account belongs to
 * another surface.
 */
function operatorTicketBody(view: SupportTicketView) {
  return {
    category: view.category,
    createdAt: view.createdAt.toISOString(),
    description: view.description,
    id: view.id,
    ownerId: view.ownerId,
    reference: view.reference,
    status: view.status,
    subject: view.subject,
    updatedAt: view.updatedAt.toISOString(),
  };
}

function eventBody(event: SupportTicketEventRow) {
  return {
    ...(event.actorReference === null
      ? {}
      : { actorReference: event.actorReference }),
    createdAt: event.createdAt.toISOString(),
    id: event.id,
    kind: event.kind,
    ...(event.note === null ? {} : { note: event.note }),
    ...(event.status === null ? {} : { status: event.status }),
  };
}
