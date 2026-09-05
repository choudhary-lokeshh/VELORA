import {
  adminMediaAssetResponseSchema,
  adminMediaPurgeRequestSchema,
  adminMediaPurgeResponseSchema,
  adminMediaStateResponseSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { MediaAssetDetail, MediaOperations } from '../media/operations.js';
import { mediaLiveAvailability } from '../media/operations.js';
import type { AdminContextResolver } from './context.js';
import type { AdminMediaPurgePort } from './service.js';

/**
 * The operator media surface.
 *
 * Three routes, and what is missing from them is most of the design. There is
 * **no deletion** here: destroying somebody's bytes is a decision the owning
 * domain or a legal process makes, and an operator button that did it would be
 * a button that destroys the evidence an appeal needs. There is **no legal
 * hold** either, which is a real gap and a deliberate one — a hold preserves
 * evidence for a case and belongs to a Trust & Safety decision vocabulary that
 * does not yet have a scope for it, and an operator placing one with no
 * enforcement record behind it would be an unaudited action on evidence. That
 * decision is recorded rather than worked around.
 *
 * What is here is a read, a read, and the one action that is safe in both
 * directions. A purge asks a delivery layer to forget an address; it destroys
 * nothing, denies nothing that was not already denied at the origin, and is
 * idempotent by construction — so it needs no enforcement record of its own,
 * and its own obligation rows are the audit. An operator who learns that an
 * edge is still serving something taken down needs exactly this and nothing
 * larger.
 *
 * Like every other Admin route, these are reachable by nobody today.
 * `AdminContextResolver` requires the Platform Admin audience and a fresh
 * phishing-resistant assurance, no approved verifier can produce one, and the
 * routes therefore fail closed rather than degrading to something weaker.
 */
export interface AdminMediaRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly media: AdminMediaPurgePort;
  readonly operations: MediaOperations;
}

export class AdminMediaRoutes {
  constructor(private readonly dependencies: AdminMediaRoutesDependencies) {}

  /**
   * The media platform in operational terms.
   *
   * Counts and adapter names, and nothing that identifies anybody. An operator
   * needs to know how much work is stuck, how much drift nobody could correct,
   * and whether the platform can accept media at all.
   */
  async getMediaState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operations.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const state = await this.dependencies.operations.operationalState();
    return {
      body: adminMediaStateResponseSchema.parse({
        adapters: state.adapters,
        assets: state.assets,
        attention: state.attention,
        backlogs: state.backlogs,
        drift: state.drift,
        // Derived from the adapters this process actually composed, not from
        // the configuration that was meant to select them. A screen reporting
        // what was configured while the process runs something else is exactly
        // the lie an operations screen exists to prevent.
        liveMediaAvailable: mediaLiveAvailability({
          scannerName: state.adapters.scanner,
          storageName: state.adapters.storage,
        }),
        objects: state.objects,
        obligations: state.obligations,
      }),
      status: 200,
    };
  }

  /** One asset, for an operator who already has its identifier. */
  async getMediaAsset(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const assetId = new URL(input.request.url).searchParams.get('assetId');
    if (assetId === null) return this.invalid(input);
    const detail = await this.dependencies.operations.assetDetail(assetId);
    if (detail === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: adminMediaAssetResponseSchema.parse({ asset: assetBody(detail) }),
      status: 200,
    };
  }

  /**
   * Asks the delivery layer to forget every public address of one asset.
   *
   * The manual counterpart of what a takedown already does for itself. It
   * records obligations rather than performing anything, so a worker dying
   * immediately afterwards loses a queue message and not the duty, and asking
   * twice owes it once — the partial unique index settles that, not a read.
   *
   * The asset comes back with the count, because zero owed is a success and an
   * operator has to be able to tell "already queued" from "nothing to do" by
   * looking at the objects rather than by interpreting a number.
   */
  async purgeMediaAsset(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.enforce',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(adminMediaPurgeRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const detail = await this.dependencies.operations.assetDetail(
      parsed.value.assetId,
    );
    if (detail === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    const { owed } = await this.dependencies.media.requestPurge({
      assetId: parsed.value.assetId,
    });
    // Re-read, so what comes back is the state after the request rather than
    // the state that justified it.
    const after = await this.dependencies.operations.assetDetail(
      parsed.value.assetId,
    );
    if (after === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: adminMediaPurgeResponseSchema.parse({
        asset: assetBody(after),
        owed,
      }),
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
}

/** One asset on the wire. No owner, no digest, no readiness projection. */
function assetBody(detail: MediaAssetDetail) {
  return {
    assetClass: detail.assetClass,
    createdAt: detail.createdAt.toISOString(),
    ...(detail.deletionRequestedAt === undefined
      ? {}
      : { deletionRequestedAt: detail.deletionRequestedAt.toISOString() }),
    findings: detail.findings.map((finding) => ({
      firstObservedAt: finding.firstObservedAt.toISOString(),
      kind: finding.kind,
      lastObservedAt: finding.lastObservedAt.toISOString(),
      occurrences: finding.occurrences,
    })),
    id: detail.id,
    legalHold: detail.legalHold,
    lifecycle: detail.lifecycle,
    lifecycleChangedAt: detail.lifecycleChangedAt.toISOString(),
    objects: detail.objects.map((object) => ({
      ...(object.byteSize === undefined ? {} : { byteSize: object.byteSize }),
      ...(object.format === undefined ? {} : { format: object.format }),
      id: object.id,
      objectKey: object.objectKey,
      ...(object.purgeOutcome === undefined
        ? {}
        : { purgeOutcome: object.purgeOutcome }),
      ...(object.purgeRequestedAt === undefined
        ? {}
        : { purgeRequestedAt: object.purgeRequestedAt.toISOString() }),
      role: object.role,
      state: object.state,
      ...(object.variantKind === undefined
        ? {}
        : { variantKind: object.variantKind }),
      verifiedAt: object.verifiedAt.toISOString(),
    })),
    obligations: detail.obligations.map((obligation) => ({
      attempts: obligation.attempts,
      availableAt: obligation.availableAt.toISOString(),
      ...(obligation.failureReason === undefined
        ? {}
        : { failureReason: obligation.failureReason }),
      kind: obligation.kind,
      state: obligation.state,
    })),
    ownerDomain: detail.ownerDomain,
    ...(detail.readyAt === undefined
      ? {}
      : { readyAt: detail.readyAt.toISOString() }),
    ...(detail.rejectionReason === undefined
      ? {}
      : { rejectionReason: detail.rejectionReason }),
    truncated: detail.truncated,
  };
}
