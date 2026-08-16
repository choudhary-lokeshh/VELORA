import { asc, isNull, sql } from 'drizzle-orm';

import type { MediaExecutor, MediaRepository } from './repository.js';
import {
  mediaAssets,
  mediaDriftFindings,
  mediaObjects,
  mediaObligations,
} from './schema.js';
import type {
  MediaAssetLifecycle,
  MediaDriftKind,
  MediaObjectRole,
  MediaObjectState,
  MediaPurgeRecord,
  MediaRejectionReason,
  MediaVariantKind,
} from './policy.js';

/**
 * What an operator may see of the media platform.
 *
 * This lives in MEDIA rather than in ADMIN, and the difference from the
 * financial operator screen is deliberate. `AdminFinancialDirectory` queries
 * `billing_` tables directly; nothing outside MEDIA queries a `media_` table,
 * because the whole point of the readiness projection is that other domains
 * cannot learn the technical lifecycle by accident. An operator genuinely needs
 * that lifecycle — they are the one person the coarse projection is useless to —
 * so the query belongs here, where the rule is, rather than in a module that
 * would have had to break it.
 *
 * Two shapes, and the split matters. The **state** is counts and nothing else:
 * no asset identifier, no owner, no object key, no digest. It is the screen an
 * operator watches, and a screen carrying identifiers is a screen that leaks one
 * person's upload into a war room. The **detail** is one named asset, reached
 * only by an operator who already has its identifier from a finding or a report,
 * and it carries the technical truth because triaging drift without it is
 * guesswork.
 *
 * There is no list of assets and no search. An operator who could page through
 * everybody's media has a browsing surface over private images, which is not an
 * operations tool however it is labelled.
 */

/** One count under a label. The same shape the financial screen uses. */
export interface MediaStateCount {
  readonly count: number;
  readonly state: string;
}

export interface MediaOperationalState {
  /** Which adapters are in force, by name. `unavailable` is the truth. */
  readonly adapters: {
    readonly scanner: string;
    readonly storage: string;
  };
  /** The classes that need a person to look at them. */
  readonly attention: readonly MediaStateCount[];
  readonly assets: readonly MediaStateCount[];
  /** Outstanding disagreements between the record and the provider, by kind. */
  readonly drift: readonly MediaStateCount[];
  readonly objects: readonly MediaStateCount[];
  readonly obligations: readonly MediaStateCount[];
}

/** One stored object as an operator sees it. */
export interface MediaObjectDetail {
  readonly byteSize: number | undefined;
  readonly format: string | undefined;
  readonly id: string;
  /**
   * The provider's own address for these bytes.
   *
   * Included on purpose, and it is the one field here worth arguing about. A
   * key is not a credential: delivery requires a signature the platform mints
   * against current server truth, and key knowledge is nowhere in the
   * authorization model — which is exactly why keys are random rather than
   * derived. An operator whose delivery layer is still serving something taken
   * down has to be able to name the object to their provider, and withholding
   * it would push them to query the database by hand.
   */
  readonly objectKey: string;
  readonly purgeOutcome: MediaPurgeRecord | undefined;
  readonly purgeRequestedAt: Date | undefined;
  readonly role: MediaObjectRole;
  readonly state: MediaObjectState;
  readonly variantKind: MediaVariantKind | undefined;
  readonly verifiedAt: Date;
}

export interface MediaFindingDetail {
  readonly firstObservedAt: Date;
  readonly kind: MediaDriftKind;
  readonly lastObservedAt: Date;
  readonly occurrences: number;
}

export interface MediaObligationDetail {
  readonly attempts: number;
  readonly availableAt: Date;
  /** A short code the platform chose. Never a provider message. */
  readonly failureReason: string | undefined;
  readonly kind: string;
  readonly state: string;
}

export interface MediaAssetDetail {
  readonly assetClass: string;
  readonly createdAt: Date;
  readonly deletionRequestedAt: Date | undefined;
  readonly findings: readonly MediaFindingDetail[];
  readonly id: string;
  readonly legalHold: boolean;
  readonly lifecycle: MediaAssetLifecycle;
  readonly lifecycleChangedAt: Date;
  readonly objects: readonly MediaObjectDetail[];
  readonly obligations: readonly MediaObligationDetail[];
  /** Which domain asked for the asset. Never the owner's identifier. */
  readonly ownerDomain: string;
  readonly readyAt: Date | undefined;
  readonly rejectionReason: MediaRejectionReason | undefined;
  /**
   * Whether any list here was cut short.
   *
   * Obligations and findings are retained rather than tidied away, so an asset
   * that has been through several removals and several provider incidents
   * accumulates them. Saying that the view was truncated is the difference
   * between an operator knowing they are looking at part of the history and
   * believing they have all of it.
   */
  readonly truncated: boolean;
}

/**
 * How much of one asset's history the detail view carries.
 *
 * Bounded because the lists are retained history rather than current state, and
 * an operator screen that could return a thousand discharged obligations is a
 * screen that eventually returns a thousand discharged obligations. Newest
 * first, because the ones that explain what is happening now are the recent
 * ones, and the response says when it cut something off.
 */
const assetDetailLimit = 50;

export interface MediaOperationsDependencies {
  readonly repository: MediaRepository;
  readonly scannerName: string;
  readonly storageName: string;
}

export class MediaOperations {
  constructor(private readonly dependencies: MediaOperationsDependencies) {}

  /**
   * The media platform in operational terms.
   *
   * A read and only a read, and the cost is stated rather than claimed away:
   * these are four grouped aggregates over whole tables, so each one is
   * proportional to the table it counts. That is deliberate. Covering indexes
   * would make them index-only scans and would tax every insert and update on
   * the three busiest tables in this domain, permanently, for a screen nobody
   * reads continuously — the same trade `AdminFinancialDirectory` makes over
   * the `billing_` tables. What keeps it safe is that this is an operator
   * screen rather than a request path, and that it returns counts rather than
   * rows however large the platform gets.
   */
  async operationalState(): Promise<MediaOperationalState> {
    const executor = this.dependencies.repository.transactionless;
    const [assets, objects, obligations, drift] = await Promise.all([
      this.assetStates(executor),
      this.objectStates(executor),
      this.obligationStates(executor),
      this.driftKinds(executor),
    ]);

    return {
      adapters: {
        scanner: this.dependencies.scannerName,
        storage: this.dependencies.storageName,
      },
      assets,
      // Everything a person has to act on, gathered from the three places it
      // hides. A dead-lettered obligation is a duty the platform gave up on; a
      // quarantined asset is somebody's upload that will never work; and
      // outstanding drift is a disagreement with the provider nothing could
      // safely correct. None of them resolves on its own.
      attention: [
        ...obligations
          .filter((row) => row.state.endsWith('_dead_letter'))
          .map((row) => ({ count: row.count, state: row.state })),
        ...drift.map((row) => ({
          count: row.count,
          state: `drift_${row.state}`,
        })),
        ...assets
          .filter((row) => row.state === 'quarantined')
          .map((row) => ({ count: row.count, state: 'quarantined_assets' })),
      ],
      drift,
      objects,
      obligations,
    };
  }

  /**
   * One asset, in full, for an operator who already has its identifier.
   *
   * There is no way to arrive here by browsing. The identifier comes from a
   * drift finding, a report, or a support conversation, which is what keeps an
   * operations tool from becoming a way to read through other people's images.
   */
  async assetDetail(assetId: string): Promise<MediaAssetDetail | undefined> {
    const { repository } = this.dependencies;
    const executor = repository.transactionless;
    const asset = await repository.findAsset(executor, assetId);
    if (asset === undefined) return undefined;

    const [objects, obligations, findings] = await Promise.all([
      repository.listObjects(executor, assetId),
      // One past the bound, so "there is more" is answered by the query rather
      // than guessed at from a full page.
      repository.listObligations(executor, {
        assetId,
        limit: assetDetailLimit + 1,
      }),
      repository.listFindings(executor, {
        assetId,
        limit: assetDetailLimit + 1,
      }),
    ]);

    return {
      assetClass: asset.assetClass,
      createdAt: asset.createdAt,
      deletionRequestedAt: asset.deletionRequestedAt ?? undefined,
      findings: findings.slice(0, assetDetailLimit).map((finding) => ({
        firstObservedAt: finding.createdAt,
        kind: finding.kind,
        lastObservedAt: finding.lastObservedAt,
        occurrences: finding.occurrences,
      })),
      id: asset.id,
      legalHold: asset.legalHoldAt !== null,
      lifecycle: asset.lifecycle,
      lifecycleChangedAt: asset.lifecycleChangedAt,
      objects: objects.map((object) => ({
        byteSize: object.byteSize ?? undefined,
        format: object.format ?? undefined,
        id: object.id,
        objectKey: object.objectKey,
        purgeOutcome: object.purgeOutcome ?? undefined,
        purgeRequestedAt: object.purgeRequestedAt ?? undefined,
        role: object.role,
        state: object.state,
        variantKind: object.variantKind ?? undefined,
        verifiedAt: object.verifiedAt,
      })),
      obligations: obligations.slice(0, assetDetailLimit).map((obligation) => ({
        attempts: obligation.attempts,
        availableAt: obligation.availableAt,
        failureReason: obligation.failureReason ?? undefined,
        kind: obligation.kind,
        state: obligation.state,
      })),
      // The domain that asked, never the account that owns it. An operations
      // screen that named the person would be a screen that turns a technical
      // incident into a file on somebody.
      ownerDomain: asset.ownerDomain,
      readyAt: asset.readyAt ?? undefined,
      rejectionReason: asset.rejectionReason ?? undefined,
      truncated:
        obligations.length > assetDetailLimit ||
        findings.length > assetDetailLimit,
    };
  }

  private async assetStates(
    executor: MediaExecutor,
  ): Promise<readonly MediaStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: mediaAssets.lifecycle,
      })
      .from(mediaAssets)
      .groupBy(mediaAssets.lifecycle)
      .orderBy(asc(mediaAssets.lifecycle));
    return rows.map((row) => ({ count: row.count, state: row.state }));
  }

  private async objectStates(
    executor: MediaExecutor,
  ): Promise<readonly MediaStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        role: mediaObjects.role,
        state: mediaObjects.state,
      })
      .from(mediaObjects)
      .groupBy(mediaObjects.role, mediaObjects.state)
      .orderBy(asc(mediaObjects.role), asc(mediaObjects.state));
    return rows.map((row) => ({
      count: row.count,
      state: `${row.role}_${row.state}`,
    }));
  }

  /**
   * Work owed, by kind and state.
   *
   * Composed into one label the way the financial screen composes
   * `payment_reconciliation_pending`, so a `{count, state}` list stays one shape
   * across every operator surface rather than growing a second one here.
   */
  private async obligationStates(
    executor: MediaExecutor,
  ): Promise<readonly MediaStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        kind: mediaObligations.kind,
        state: mediaObligations.state,
      })
      .from(mediaObligations)
      .groupBy(mediaObligations.kind, mediaObligations.state)
      .orderBy(asc(mediaObligations.kind), asc(mediaObligations.state));
    return rows.map((row) => ({
      count: row.count,
      state: `${row.kind}_${row.state}`,
    }));
  }

  /** Outstanding findings only. A resolved one is history, not a backlog. */
  private async driftKinds(
    executor: MediaExecutor,
  ): Promise<readonly MediaStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: mediaDriftFindings.kind,
      })
      .from(mediaDriftFindings)
      .where(isNull(mediaDriftFindings.resolvedAt))
      .groupBy(mediaDriftFindings.kind)
      .orderBy(asc(mediaDriftFindings.kind));
    return rows.map((row) => ({ count: row.count, state: row.state }));
  }
}

/** Whether this composition could accept media at all. */
export function mediaLiveAvailability(input: {
  readonly scannerName: string;
  readonly storageName: string;
}): boolean {
  // Both, and by name rather than by a flag somebody could set. An approved
  // store with no scanner accepts bytes nobody vetted, and a scanner with no
  // store has nothing to vet.
  return (
    input.storageName !== 'unavailable' && input.scannerName !== 'unavailable'
  );
}
