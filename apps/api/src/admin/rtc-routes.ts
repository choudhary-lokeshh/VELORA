import {
  unavailableCallEligibility,
  unavailableRtcProvider,
} from '@velora/config/server';
import {
  adminRtcCallSchema,
  adminRtcStateResponseSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { RtcOperations } from '../realtime/operations.js';
import type { AdminContextResolver } from './context.js';

/**
 * The operator calling surface.
 *
 * Two routes, both reads, and what is missing from them is most of the design.
 *
 * There is **no list of calls and no search**. An operator able to page through
 * calls has a browsing surface over who contacts whom, which is not an
 * operations tool however it is labelled — and the comparison with media is
 * instructive: an asset has one owner, while a call is a relationship between
 * two people that neither of them published. The state screen carries no
 * identifier of any kind for the same reason.
 *
 * There is **no action** at all: no ending a call, no revoking a credential, no
 * forcing a teardown. Ending somebody's call from an operations console is a
 * safety decision, and safety decisions go through TRUST & SAFETY where they
 * acquire an enforcement record, a reason, and an appeal path. An operator
 * button here would be that same power with none of those, which is exactly the
 * unaudited action on a private conversation this design refuses. Teardown that
 * will not discharge is reconciliation's problem and is surfaced as a number to
 * be alerted on, not as a button to be pressed.
 *
 * Like every other Admin route, these are reachable by nobody today.
 * `AdminContextResolver` requires the Platform Admin audience and a fresh
 * phishing-resistant assurance, no approved verifier can produce one, and the
 * routes therefore fail closed rather than degrading to something weaker.
 */
export interface AdminRtcRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly operations: RtcOperations;
}

export class AdminRtcRoutes {
  constructor(private readonly dependencies: AdminRtcRoutesDependencies) {}

  /**
   * Calling in operational terms.
   *
   * Counts, ages, and adapter names. An operator needs to know how much work is
   * stuck, how long it has been stuck, whether a provider may still be holding
   * rooms for calls that ended, and whether this environment can carry a call
   * at all.
   */
  async getRtcState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operations.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const state = await this.dependencies.operations.operationalState();
    return {
      body: adminRtcStateResponseSchema.parse({
        adapters: state.adapters,
        backlogs: state.backlogs,
        calls: state.calls,
        endedWithUndischargedTeardown: state.endedWithUndischargedTeardown,
        // Derived from the adapters this process actually composed, not from
        // the configuration meant to select them. A screen reporting what was
        // configured while the process runs something else is exactly the lie
        // an operations screen exists to prevent.
        liveCallingAvailable: rtcLiveAvailability(state.adapters),
        providerEvents: state.providerEvents,
        providerObligations: state.providerObligations,
      }),
      status: 200,
    };
  }

  /** One call, for an operator who already has its identifier. */
  async getRtcCall(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'live.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const callId = new URL(input.request.url).searchParams.get('callId');
    if (callId === null || callId.length === 0) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const detail = await this.dependencies.operations.callDetail(callId);
    if (detail === undefined) {
      // The same answer a call that never existed gets. An operations tool is
      // still a place where guessing identifiers must not be productive.
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return { body: adminRtcCallSchema.parse(detail), status: 200 };
  }
}

/**
 * Whether this environment can carry a call at all.
 *
 * Both halves are required, and neither is sufficient. An eligibility answer
 * with no provider has nowhere to put a call; a provider with no eligibility
 * answer would be a room nobody was authorized to be in. Reported as a derived
 * boolean beside the adapter names rather than instead of them, so an operator
 * sees both that calling is off and which half is missing.
 */
export function rtcLiveAvailability(adapters: {
  readonly eligibility: string;
  readonly provider: string;
}): boolean {
  return (
    adapters.provider !== unavailableRtcProvider &&
    adapters.eligibility !== unavailableCallEligibility
  );
}
