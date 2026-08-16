import type { Executor } from '../database/executor.js';
import type { DistributionSurface } from '../safety/policy.js';
import {
  mediaDeliveryCredentialSeconds,
  mediaProcessingVersion,
  type MediaVariantKind,
} from './policy.js';
import type {
  MediaAssociationPort,
  MediaDeliveryDenialReason,
  MediaPublicationAuthority,
} from './publication.js';
import type { MediaRepository } from './repository.js';
import {
  MediaStorageUnavailableError,
  type MediaStoragePort,
} from './storage.js';

/**
 * Turning a decision into something a client can actually fetch.
 *
 * Two paths, and confusing them is how private media ends up on a cacheable
 * address. A **public** derivative gets a permanent immutable address and long
 * cache directives, because it is genuinely public and its address changes when
 * its content does. A **restricted** one gets a credential bound to one asset
 * and one variant, valid for a bounded number of seconds, and a response nobody
 * may cache shared.
 *
 * Neither path is reachable without the publication authority having said yes
 * first, and it is asked at issuance rather than remembered.
 *
 * ## What revocation actually means
 *
 * It has two halves and both must always be stated together.
 *
 * **New** authorizations stop the instant any authority changes its answer,
 * because every issuance re-derives the decision inside the caller's
 * transaction. There is no cache to invalidate and no replica holding a stale
 * yes.
 *
 * **Already-issued** credentials remain valid until they expire. A signed URL
 * is a bearer token and the platform generally cannot recall one — the media
 * provider eligibility register records that at least one major provider
 * documents no per-URL revocation mechanism at all. The bound is the credential
 * lifetime, {@link mediaDeliveryCredentialSeconds}, and it is reported on every
 * grant so that no caller can describe delivery without it.
 *
 * Any statement that media access was revoked "instantly" which does not name
 * that window is false. For a public derivative the window is not a TTL at all
 * but a cache purge, whose semantics belong to a provider and are recorded
 * rather than assumed.
 */

export type MediaDeliveryOutcome =
  | {
      /** Long-lived and shareable, because the address changes with content. */
      readonly cacheControl: string;
      readonly kind: 'public';
      readonly url: string;
    }
  | {
      readonly cacheControl: string;
      readonly expiresAt: Date;
      readonly kind: 'private';
      /**
       * How long an already-issued credential outlives a revocation, in
       * seconds. Reported rather than assumed, so an operational claim about
       * revocation has a number attached to it.
       */
      readonly maximumRevocationExposureSeconds: number;
      readonly url: string;
    }
  | {
      readonly closedGates: readonly MediaDeliveryDenialReason[];
      readonly kind: 'denied';
      readonly reasonCode: MediaDeliveryDenialReason;
    }
  /** No approved delivery provider, so nothing can be served at all. */
  | { readonly kind: 'unavailable' };

export interface MediaDeliveryServiceDependencies {
  readonly association: MediaAssociationPort;
  readonly now: () => Date;
  readonly publication: MediaPublicationAuthority;
  readonly repository: MediaRepository;
  readonly storage: MediaStoragePort;
}

export class MediaDeliveryService {
  constructor(
    private readonly dependencies: MediaDeliveryServiceDependencies,
  ) {}

  async authorize(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly surface: DistributionSurface;
    readonly variantKind: MediaVariantKind;
    readonly viewerId: string | undefined;
  }): Promise<MediaDeliveryOutcome> {
    const { association, publication, repository, storage } = this.dependencies;
    const now = this.dependencies.now();

    const decision = await publication.decide({
      assetId: input.assetId,
      executor: input.executor,
      now,
      surface: input.surface,
      variantKind: input.variantKind,
      viewerId: input.viewerId,
    });
    if (!decision.allowed) {
      return {
        closedGates: decision.closedGates,
        kind: 'denied',
        reasonCode: decision.reasonCode,
      };
    }

    const variant = await repository.findVariant(input.executor, {
      assetId: input.assetId,
      processingVersion: mediaProcessingVersion,
      variantKind: input.variantKind,
    });
    // The authority said the asset is ready, so the row should be here. If it
    // is not, something is inconsistent and the safe reading is that there is
    // nothing to serve rather than that anything may be served.
    if (variant?.state !== 'present') {
      return {
        closedGates: ['not_technically_ready'],
        kind: 'denied',
        reasonCode: 'not_technically_ready',
      };
    }

    // Asked again rather than carried over from the decision, because the
    // audience decides which of two very different things gets handed out and
    // a stale answer here is the difference between a five-minute credential
    // and a permanent public address.
    const attachment = await association.describe({
      assetId: input.assetId,
      executor: input.executor,
      now,
      surface: input.surface,
      viewerId: input.viewerId,
    });
    if (attachment === undefined) {
      return {
        closedGates: ['not_attached'],
        kind: 'denied',
        reasonCode: 'not_attached',
      };
    }

    if (attachment.audience === 'public') {
      const url = storage.publicAddress(variant.objectKey);
      // A provider that serves no public class is not a reason to fall back to
      // a credential: the owning domain asked for a public address and there
      // is not one.
      if (url === undefined) return { kind: 'unavailable' };
      return {
        // Immutable because the address carries the processing version and a
        // random component, so a changed derivative is a different address
        // rather than the same one behind a cache.
        cacheControl: 'public, max-age=31536000, immutable',
        kind: 'public',
        url,
      };
    }

    const expiresAt = new Date(
      now.getTime() + mediaDeliveryCredentialSeconds * 1000,
    );
    let grant;
    try {
      grant = await storage.authorizeDelivery({
        expiresAt,
        objectKey: variant.objectKey,
      });
    } catch (error) {
      if (error instanceof MediaStorageUnavailableError) {
        return { kind: 'unavailable' };
      }
      throw error;
    }

    return {
      // Never shareable. A private derivative behind a shared cache is the
      // whole failure this distinction exists to prevent.
      cacheControl: 'private, no-store',
      expiresAt: grant.expiresAt,
      kind: 'private',
      maximumRevocationExposureSeconds: mediaDeliveryCredentialSeconds,
      url: grant.url,
    };
  }
}
