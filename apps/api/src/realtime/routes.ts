import {
  callActionRequestSchema,
  callSchema,
  createCallRequestSchema,
  joinAuthorizationSchema,
  productErrorCodes,
  type CallEndReason,
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
import type { ConsumerDirectory } from '../users/directory.js';
import type { RtcJoinAuthorizationService } from './authorization.js';
import type { CallOutcome, CallView, RtcService } from './service.js';

export interface RtcRoutesDependencies {
  readonly authorization: RtcJoinAuthorizationService;
  readonly consumerContext: ConsumerContextResolver;
  readonly directory: ConsumerDirectory;
  readonly realtime: RtcService;
}

/**
 * The call-control surface.
 *
 * Flat paths rather than `/{id}/verb`, matching every other route this
 * repository publishes. The call an action is about is named in the body, which
 * also keeps a call identifier out of access logs and referers.
 *
 * Nothing here decides anything. Authorization, membership, eligibility, and
 * state are all decided by the domain inside the transaction that writes; these
 * handlers parse a bounded body, hand it to the service, and translate one
 * outcome into one status. A route that made a decision would be a second place
 * the rules live.
 *
 * Every refusal is uniform. A call that does not exist, a call belonging to two
 * other people, and a call the caller is not a participant of all answer `404`
 * with the same body, so no identifier can be probed.
 */
export class RtcRoutes {
  constructor(private readonly dependencies: RtcRoutesDependencies) {}

  /** Places a call. The body names a relationship, never a person. */
  async createCall(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(createCallRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    return this.respond(
      input,
      await this.dependencies.realtime.invite(resolved.context.account, {
        introductionId: parsed.value.introductionId,
        medium: parsed.value.medium,
      }),
    );
  }

  async acceptCall(input: RouteRequest): Promise<RouteResult> {
    return this.action(input, (context, callId) =>
      this.dependencies.realtime.accept(context.account, callId),
    );
  }

  async rejectCall(input: RouteRequest): Promise<RouteResult> {
    return this.action(input, (context, callId) =>
      this.dependencies.realtime.reject(context.account, callId),
    );
  }

  async cancelCall(input: RouteRequest): Promise<RouteResult> {
    return this.action(input, (context, callId) =>
      this.dependencies.realtime.cancel(context.account, callId),
    );
  }

  async endCall(input: RouteRequest): Promise<RouteResult> {
    return this.action(input, (context, callId) =>
      this.dependencies.realtime.end(context.account, callId),
    );
  }

  /**
   * Issues this participant's means of joining.
   *
   * The participant is derived from the authenticated principal, never from the
   * body, which is what makes "user A can never receive a credential for user
   * B" a property of the code rather than of this handler.
   */
  async issueJoinAuthorization(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(callActionRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.authorization.issue({
      actorId: resolved.context.account.id,
      sessionId: parsed.value.callId,
    });
    switch (outcome.kind) {
      case 'authorization': {
        return {
          body: joinAuthorizationSchema.parse({
            callId: outcome.value.sessionId,
            credential: outcome.value.credential,
            expiresAt: outcome.value.expiresAt.toISOString(),
            medium: outcome.value.medium,
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
      case 'unavailable': {
        // No approved provider. `503` rather than `409`: nothing about this
        // caller or this call is wrong, and the answer may differ later.
        return routeFailure(
          503,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        );
      }
    }
  }

  /** Reads one call the caller is a participant of. */
  async getCall(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const callId = new URL(input.request.url).searchParams.get('callId');
    if (callId === null) return this.invalid(input);

    return this.respond(
      input,
      await this.dependencies.realtime.read(resolved.context.account, callId),
    );
  }

  private async action(
    input: RouteRequest,
    run: (
      context: Extract<ConsumerRouteContext, { context: unknown }>['context'],
      callId: string,
    ) => Promise<CallOutcome>,
  ): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(callActionRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    return this.respond(
      input,
      await run(resolved.context, parsed.value.callId),
    );
  }

  private async respond(
    input: RouteRequest,
    outcome: CallOutcome,
  ): Promise<RouteResult> {
    switch (outcome.kind) {
      case 'call': {
        return {
          body: callSchema.parse(await this.callBody(outcome.view)),
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

  /**
   * The wire shape.
   *
   * The counterpart's name comes from USERS' published directory rather than
   * from anything REALTIME stores, because a display name is not this domain's
   * truth and a copy of one would go stale.
   */
  private async callBody(view: CallView): Promise<unknown> {
    const [counterpart] = await this.dependencies.directory.namesFor([
      view.counterpartId,
    ]);
    return {
      ...(view.acceptedAt === undefined
        ? {}
        : { acceptedAt: view.acceptedAt.toISOString() }),
      ...(view.connectedAt === undefined
        ? {}
        : { connectedAt: view.connectedAt.toISOString() }),
      counterpart: {
        displayName: counterpart?.displayName ?? 'Unavailable',
        id: view.counterpartId,
      },
      createdAt: view.createdAt.toISOString(),
      ...(view.endReason === undefined
        ? {}
        : { endReason: disclosableReason(view.endReason) }),
      ...(view.endedAt === undefined
        ? {}
        : { endedAt: view.endedAt.toISOString() }),
      id: view.id,
      invitationExpiresAt: view.invitationExpiresAt.toISOString(),
      medium: view.medium,
      role: view.role,
      state: view.state,
    };
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      400,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}

/**
 * What a participant may be told about why a call ended.
 *
 * A block and an enforcement are separate decisions with separate owners, and
 * neither is a peer's business. Both become `ended_by_platform` here — the
 * distinction stays inside the domain, where an operator can see it, and never
 * reaches the other person on the call.
 */
function disclosableReason(reason: string): CallEndReason {
  if (reason === 'safety_block' || reason === 'safety_enforcement') {
    return 'ended_by_platform';
  }
  if (reason === 'operator_terminated' || reason === 'provider_failed') {
    return 'ended_by_platform';
  }
  return reason as CallEndReason;
}
