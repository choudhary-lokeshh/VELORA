import {
  creatorMatureReadinessResponseSchema,
  type CreatorMatureReadinessResponse,
} from '@velora/validation';

import {
  requireCreator,
  type CreatorContextResolver,
} from '../creators/context.js';
import type { RouteRequest, RouteResult } from '../http/route-kit.js';
import {
  distributionSurfaces,
  matureIneligibleSurfaces,
  matureReadinessBlockers,
} from './policy.js';

/**
 * What Creator Studio is told about mature content.
 *
 * The answer is no, in every environment, and the surface says so plainly with
 * the real reasons rather than rendering a workflow that cannot succeed.
 * [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * asks for exactly this: a creator who is shown an upload form that always
 * fails learns nothing, and one who is told "not yet" with no reason will
 * reasonably assume the remaining work is theirs.
 *
 * Each blocker is owned by a different authority and each is separately
 * liftable, which is the whole architecture. Satisfying one enables nothing,
 * and the shape makes that visible rather than collapsing them into a single
 * "not ready".
 *
 * Surface ineligibility is reported *beside* the blockers rather than among
 * them. Both app stores prohibit the content class outright with no published
 * approval path, so it is a permanent property of those surfaces rather than
 * something anybody is working on, and listing it as a blocker would imply
 * otherwise.
 */
export interface CreatorSafetyRoutesDependencies {
  /** The configured sources, reported by name rather than as booleans. */
  readonly capabilities: {
    readonly consentPolicy: string;
    readonly depictedPersonVerifier: string;
    readonly matureContent: string;
  };
  readonly creatorContext: CreatorContextResolver;
}

export class CreatorSafetyRoutes {
  constructor(private readonly dependencies: CreatorSafetyRoutesDependencies) {}

  async getMatureReadiness(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;

    const { capabilities } = this.dependencies;
    const body: CreatorMatureReadinessResponse = {
      // Every one of them, because every one of them is closed. This is not a
      // list that shortens as a creator does work: none of the remaining work
      // is theirs.
      blockers: [...matureReadinessBlockers],
      consentPolicySource: capabilities.consentPolicy,
      enabled: false,
      matureContentSource: capabilities.matureContent,
      surfaces: distributionSurfaces.map((surface) => ({
        eligible: !matureIneligibleSurfaces.includes(surface),
        surface,
      })),
      verifierSource: capabilities.depictedPersonVerifier,
    };
    return {
      body: creatorMatureReadinessResponseSchema.parse(body),
      status: 200,
    };
  }
}
