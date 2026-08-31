import {
  apiQueryParameters,
  createLiveInvitationRequestSchema,
  liveConnectionResponseSchema,
  liveEncounterActionRequestSchema,
  liveInvitationListResponseSchema,
  liveMessageListResponseSchema,
  liveSearchRequestSchema,
  liveSimulationRequestSchema,
  liveSimulationResponseSchema,
  liveStateResponseSchema,
  productErrorCodes,
  respondToLiveInvitationRequestSchema,
  sendLiveMessageRequestSchema,
  sendLiveReactionRequestSchema,
  type LiveEndReason as WireLiveEndReason,
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
import type { LiveMessageRow } from './repository.js';
import type { LiveSimulator } from './simulation.js';
import type {
  LiveEncounterView,
  LiveInvitationView,
  LiveOutcome,
  LivePersonView,
  LiveService,
  LiveStateView,
} from './service.js';

export interface LiveRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly live: LiveService;
  /** Absent unless a simulation adapter is configured. */
  readonly simulator?: LiveSimulator;
}

/**
 * The live-discovery surface.
 *
 * Flat paths rather than `/{id}/verb`, matching every other route this
 * repository publishes. The encounter an action is about is named in the body,
 * which also keeps an encounter identifier out of access logs and referers.
 *
 * Nothing here decides anything. Admission, eligibility, allocation, membership,
 * and state are all decided by the domain inside the transaction that writes;
 * these handlers parse a bounded body, hand it to the service, and translate one
 * outcome into one status. A route that made a decision would be a second place
 * the rules live.
 *
 * Every refusal is uniform. An encounter that does not exist, one belonging to
 * two other people, and one the caller is not in all answer `404` with the same
 * body, so no identifier can be probed.
 */
export class LiveRoutes {
  constructor(private readonly dependencies: LiveRoutesDependencies) {}

  async getState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    return this.state(
      await this.dependencies.live.read(resolved.context.account),
    );
  }

  async startSearch(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(liveSearchRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    return this.respond(
      input,
      await this.dependencies.live.search(
        resolved.context.account,
        parsed.value.medium,
        parsed.value.preferences === undefined
          ? undefined
          : {
              language: parsed.value.preferences.language,
              region: parsed.value.preferences.region,
            },
      ),
    );
  }

  async advance(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(liveEncounterActionRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    return this.respond(
      input,
      await this.dependencies.live.next(
        resolved.context.account,
        parsed.value.encounterId,
      ),
    );
  }

  async leave(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    return this.respond(
      input,
      await this.dependencies.live.leave(resolved.context.account),
    );
  }

  async getMessages(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    // Validated against the published parameter before it reaches the domain.
    // Anything else is not an identifier this platform ever issued, and handing
    // one to a query would turn a mistyped address into a server error.
    const raw = new URL(input.request.url).searchParams.get('encounterId');
    const encounterId =
      raw === null ? undefined : apiQueryParameters.encounterId.safeParse(raw);
    if (encounterId?.success !== true) return this.invalid(input);
    return this.messages(
      input,
      resolved.context.account.id,
      await this.dependencies.live.messages(
        resolved.context.account,
        encounterId.data,
      ),
    );
  }

  async sendMessage(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(sendLiveMessageRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    return this.messages(
      input,
      resolved.context.account.id,
      await this.dependencies.live.sendMessage(resolved.context.account, {
        body: parsed.value.body,
        clientMessageId: parsed.value.clientMessageId,
        encounterId: parsed.value.encounterId,
      }),
    );
  }

  async sendReaction(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(sendLiveReactionRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    return this.messages(
      input,
      resolved.context.account.id,
      await this.dependencies.live.sendReaction(resolved.context.account, {
        clientMessageId: parsed.value.clientMessageId,
        encounterId: parsed.value.encounterId,
        reaction: parsed.value.reaction,
      }),
    );
  }

  async invite(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(createLiveInvitationRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    return this.invitations(
      input,
      await this.dependencies.live.invite(resolved.context.account, {
        candidateId: parsed.value.candidateId,
        medium: parsed.value.medium,
      }),
    );
  }

  async respondToInvitation(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      respondToLiveInvitationRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);
    return this.invitations(
      input,
      await this.dependencies.live.respondToInvitation(
        resolved.context.account,
        {
          invitationId: parsed.value.invitationId,
          response: parsed.value.response,
        },
      ),
    );
  }

  async connect(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(liveEncounterActionRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.live.connect(
      resolved.context.account,
      parsed.value.encounterId,
    );
    switch (outcome.kind) {
      case 'connection': {
        return {
          body: liveConnectionResponseSchema.parse({
            connection: connectionBody(outcome.connection),
            encounterId: outcome.encounterId,
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
        return routeFailure(
          503,
          productErrorCodes.dependencyUnavailable,
          input.correlationId,
        );
      }
      case 'not_eligible': {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
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

  /**
   * Applies one deterministic local scenario.
   *
   * Reachable only where a simulation adapter is composed, which configuration
   * refuses outside local and test. Everywhere else this answers `503` — a
   * truthful statement about the environment rather than a client error.
   */
  async simulate(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(liveSimulationRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const simulator = this.dependencies.simulator;
    if (simulator === undefined) {
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    const applied = await simulator.apply({
      actor: resolved.context.account,
      scenario: parsed.value.scenario,
    });
    return {
      body: liveSimulationResponseSchema.parse({
        applied,
        scenario: parsed.value.scenario,
      }),
      status: 200,
    };
  }

  private respond(input: RouteRequest, outcome: LiveOutcome): RouteResult {
    switch (outcome.kind) {
      case 'state': {
        return this.state(outcome.view);
      }
      case 'unavailable': {
        // Live discovery is not switched on here. `503` rather than `409`:
        // nothing about this caller is wrong, and the answer may differ later.
        return routeFailure(
          503,
          productErrorCodes.dependencyUnavailable,
          input.correlationId,
        );
      }
      case 'rate_limited': {
        // The product convention for a bound reached, and deliberately not a
        // `429`: `429` is AUTH's answer about authentication attempts, and
        // reusing it here would put a product limit in the bucket a client
        // treats as "retry the sign-in".
        return routeFailure(
          409,
          productErrorCodes.rateLimited,
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

  private state(view: LiveStateView): RouteResult {
    return {
      body: liveStateResponseSchema.parse(stateBody(view)),
      status: 200,
    };
  }

  private messages(
    input: RouteRequest,
    viewerId: string,
    outcome: Awaited<ReturnType<LiveService['messages']>>,
  ): RouteResult {
    switch (outcome.kind) {
      case 'messages': {
        return {
          body: liveMessageListResponseSchema.parse({
            encounterId: outcome.encounterId,
            messages: outcome.messages.map((message) =>
              messageBody(message, viewerId),
            ),
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
        return routeFailure(
          503,
          productErrorCodes.dependencyUnavailable,
          input.correlationId,
        );
      }
      case 'rate_limited': {
        return routeFailure(
          409,
          productErrorCodes.rateLimited,
          input.correlationId,
        );
      }
      case 'not_eligible': {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
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

  private invitations(
    input: RouteRequest,
    outcome: Awaited<ReturnType<LiveService['invite']>>,
  ): RouteResult {
    switch (outcome.kind) {
      case 'invitations': {
        return {
          body: liveInvitationListResponseSchema.parse({
            invitations: outcome.views.map(invitationBody),
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
        return routeFailure(
          503,
          productErrorCodes.dependencyUnavailable,
          input.correlationId,
        );
      }
      case 'rate_limited': {
        return routeFailure(
          409,
          productErrorCodes.rateLimited,
          input.correlationId,
        );
      }
      case 'not_eligible': {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
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

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}

/**
 * One message on the wire.
 *
 * `self` is derived from the authenticated principal rather than claimed by
 * anybody, and there is no sender identifier in the shape at all: a live
 * encounter has exactly two people in it, one of whom is asking, so "mine or
 * theirs" is the whole of what a client needs — and publishing the other
 * person's identifier on every message would put it in more places than the one
 * that already carries it.
 */
function messageBody(message: LiveMessageRow, viewerId: string): unknown {
  return {
    body: message.body,
    id: message.id,
    kind: message.kind,
    self: message.senderId === viewerId,
    sentAt: message.createdAt.toISOString(),
    sequence: message.sequence,
  };
}

function personBody(person: LivePersonView): unknown {
  return {
    ...(person.bio === undefined ? {} : { bio: person.bio }),
    displayName: person.displayName,
    id: person.id,
    ...(person.region === undefined ? {} : { region: person.region }),
    sharedLanguages: person.sharedLanguages,
  };
}

function invitationBody(view: LiveInvitationView): unknown {
  return {
    createdAt: view.createdAt.toISOString(),
    direction: view.direction,
    expiresAt: view.expiresAt.toISOString(),
    id: view.id,
    medium: view.medium,
    person: personBody(view.person),
    state: view.state,
  };
}

function connectionBody(connection: LiveEncounterView['connection']): unknown {
  return {
    ...(connection.conversationId === undefined
      ? {}
      : { conversationId: connection.conversationId }),
    ...(connection.introductionId === undefined
      ? {}
      : { introductionId: connection.introductionId }),
    state: connection.state,
  };
}

/**
 * What a participant may be told about why an encounter ended.
 *
 * A block and an enforcement are separate decisions with separate owners, and
 * neither is a peer's business. Both become `ended_by_platform` here — the
 * distinction stays inside the domain, where an operator can see it, and never
 * reaches the other person.
 *
 * `departed` splits into two, and that split is the one piece of information a
 * surface genuinely needs: "you moved on" and "they moved on" are different
 * sentences, and it is derived from who the platform recorded as having ended
 * it rather than from a timestamp comparison.
 */
function disclosableEndReason(
  view: LiveEncounterView,
): WireLiveEndReason | undefined {
  if (view.endReason === undefined) return undefined;
  switch (view.endReason) {
    case 'departed': {
      return view.endedByViewer ? 'left' : 'peer_left';
    }
    case 'presence_lapsed': {
      return 'timed_out';
    }
    case 'session_failed': {
      return 'failed';
    }
    default: {
      return 'ended_by_platform';
    }
  }
}

function encounterBody(view: LiveEncounterView): unknown {
  const endReason = disclosableEndReason(view);
  return {
    ...(view.call === undefined ? {} : { call: view.call }),
    connection: connectionBody(view.connection),
    ...(endReason === undefined ? {} : { endReason }),
    ...(view.endedAt === undefined
      ? {}
      : { endedAt: view.endedAt.toISOString() }),
    id: view.id,
    messageSequence: view.messageSequence,
    peer: personBody(view.peer),
    startedAt: view.startedAt.toISOString(),
  };
}

function stateBody(view: LiveStateView): unknown {
  return {
    admission: view.admission,
    ...(view.encounter === undefined
      ? {}
      : { encounter: encounterBody(view.encounter) }),
    invitations: view.invitations.map(invitationBody),
    languageOptions: view.languageOptions,
    ...(view.medium === undefined ? {} : { medium: view.medium }),
    preferences: {
      ...(view.preferences.language === undefined
        ? {}
        : { language: view.preferences.language }),
      region: view.preferences.region,
    },
    ...(view.searchingSince === undefined
      ? {}
      : { searchingSince: view.searchingSince.toISOString() }),
    simulated: view.simulated,
    state: view.state,
  };
}
