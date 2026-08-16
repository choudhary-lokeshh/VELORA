import type { Executor } from '../database/executor.js';
import type { DistributionSurface } from '../safety/policy.js';
import {
  requiredMediaVariants,
  type MediaOwnerDomain,
  type MediaVariantKind,
} from './policy.js';
import type { MediaRepository } from './repository.js';
import type { MediaAssetRow } from './schema.js';

/**
 * Whether these bytes may reach this person, on this surface, right now.
 *
 * The composition, and deliberately nothing more. MEDIA contributes exactly one
 * of the answers below — is the derivative technically there — and asks for
 * every other one. It reproduces no part of the Trust and Safety policy engine,
 * reads no `safety_` row, and holds no opinion about what a restriction means:
 * it asks, and it obeys.
 *
 * The reason this lives in MEDIA rather than in each caller is that a
 * conjunction evaluated separately by four surfaces is four chances to omit a
 * term. Evaluated here, omitting one is a compile error.
 *
 * Every input is re-read at the moment of the decision, inside the caller's
 * executor. A delivery authorized from a safety answer fetched a second earlier
 * is a delivery authorized from a fact that may already be false, and the whole
 * point of a hold is that it takes effect now.
 */

/**
 * Why delivery was refused.
 *
 * Closed, coarse, and ordered by how much it tells the caller. What reaches a
 * consumer is coarser still — the distinction between "held by safety" and
 * "the creator is suspended" is operational detail — but the platform needs
 * every term separately, because each is owned by a different authority and
 * each is lifted by a different act.
 */
export const mediaDeliveryDenialReasons = [
  /** MEDIA's own answer: no derivative of this kind exists yet. */
  'not_technically_ready',
  /** The asset was refused at inspection. It never becomes deliverable. */
  'quarantined',
  /** The bytes are being removed, or are gone. */
  'removed',
  /** No owning domain currently attaches this asset to anything. */
  'not_attached',
  /** The owner attaches it but does not intend it visible on this surface. */
  'not_published',
  /** The viewer holds no entitlement the owning domain recognises. */
  'not_entitled',
  /** Trust and Safety denies it: a hold, a takedown, or a restriction. */
  'safety_restricted',
  /** The asset's class does not include the variant that was asked for. */
  'unknown_variant',
] as const;
export type MediaDeliveryDenialReason =
  (typeof mediaDeliveryDenialReasons)[number];

export type MediaDeliveryDecision =
  | { readonly allowed: true; readonly variantKind: MediaVariantKind }
  | {
      readonly allowed: false;
      /**
       * Every closed gate, not only the first.
       *
       * The same reasoning ADR-0022 applies to content safety: a caller told
       * only the first refusal reasonably concludes that fixing it is enough,
       * and here that is frequently untrue. An operator needs to know how many
       * separate things would have to change.
       */
      readonly closedGates: readonly MediaDeliveryDenialReason[];
      readonly reasonCode: MediaDeliveryDenialReason;
    };

/**
 * What the owning domain says about an asset it holds a reference to.
 *
 * MEDIA cannot answer any of this. It does not know which slot an image
 * occupies, whether a content item is published, or whether a viewer holds a
 * club entitlement — those are USERS, CREATORS, and PRIVATE CLUBS facts, and an
 * asset deliberately has no idea what it is for.
 *
 * `undefined` means the owning domain does not recognise the asset at all,
 * which is a denial rather than an error: an asset nobody attaches is an asset
 * nobody may fetch.
 */
export interface MediaAssociation {
  /**
   * Who the owner intends this for.
   *
   * `public` means the open internet, and it is the owning domain's call rather
   * than MEDIA's: only a domain that knows what an asset is attached to can say
   * whether that thing is a public creator page or somebody's private club.
   * The distinction decides whether delivery is a permanent immutable address
   * or a short-lived credential, and getting it wrong in the permissive
   * direction is how club media ends up on a cacheable URL.
   */
  readonly audience: 'public' | 'restricted';
  /** Whether the owner intends this visible to this viewer on this surface. */
  readonly published: boolean;
  /** Whether the viewer holds whatever access the owner requires. */
  readonly viewerEntitled: boolean;
}

export interface MediaAssociationPort {
  describe(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly now: Date;
    /**
     * Which domain reserved the asset.
     *
     * Passed in rather than probed for. MEDIA already knows it, and handing it
     * over means a router dispatches to one owning domain instead of asking
     * every domain whether it recognises an identifier — which would be both
     * slower and a way for one domain to learn about another's assets.
     */
    readonly ownerDomain: MediaOwnerDomain;
    readonly surface: DistributionSurface;
    /** Absent for an unauthenticated public read. */
    readonly viewerId: string | undefined;
  }): Promise<MediaAssociation | undefined>;
}

/**
 * Dispatches to whichever domain reserved the asset.
 *
 * A domain with no entry answers nothing, which denies. Adding an owning domain
 * to the vocabulary without wiring an adapter therefore makes its assets
 * undeliverable rather than accidentally public.
 */
export class RoutedMediaAssociation implements MediaAssociationPort {
  constructor(
    private readonly routes: Partial<
      Record<MediaOwnerDomain, MediaAssociationPort>
    >,
  ) {}

  describe(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly ownerDomain: MediaOwnerDomain;
    readonly surface: DistributionSurface;
    readonly viewerId: string | undefined;
  }): Promise<MediaAssociation | undefined> {
    const route = this.routes[input.ownerDomain];
    if (route === undefined) return Promise.resolve(undefined);
    return route.describe(input);
  }
}

/**
 * The safety question MEDIA is allowed to ask.
 *
 * Narrower than the Trust and Safety contract on purpose. MEDIA does not choose
 * a capability, does not name a scope, and never sees an enforcement, a report,
 * or a reviewer. It asks one question and receives one boolean, which is the
 * shape that makes it impossible for this domain to accumulate opinions about
 * safety policy.
 */
export interface MediaSafetyPort {
  /** True when Trust and Safety currently permits this asset to be delivered. */
  mayDeliver(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly ownerDomain: MediaOwnerDomain;
    readonly surface: DistributionSurface;
  }): Promise<boolean>;
}

/**
 * The safety answer used where no owning domain has wired a real one.
 *
 * It denies. A missing safety adapter is not "no restrictions found"; it is a
 * question nobody answered, and the only safe reading of an unanswered safety
 * question is no.
 */
export class DenyingMediaSafety implements MediaSafetyPort {
  mayDeliver(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** The association answer where no owning domain has wired a real one. */
export class UnattachedMediaAssociation implements MediaAssociationPort {
  describe(): Promise<MediaAssociation | undefined> {
    return Promise.resolve(undefined);
  }
}

export interface MediaPublicationAuthorityDependencies {
  readonly association: MediaAssociationPort;
  readonly repository: MediaRepository;
  readonly safety: MediaSafetyPort;
}

export class MediaPublicationAuthority {
  constructor(
    private readonly dependencies: MediaPublicationAuthorityDependencies,
  ) {}

  /**
   * Decides whether one variant of one asset may be delivered.
   *
   * Every gate is evaluated rather than short-circuiting at the first refusal,
   * so the answer says how many separate things are wrong. The order they are
   * listed in is the order of how much they tell somebody, not the order they
   * were checked.
   */
  async decide(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly surface: DistributionSurface;
    readonly variantKind: MediaVariantKind;
    readonly viewerId: string | undefined;
  }): Promise<MediaDeliveryDecision> {
    const { association, repository, safety } = this.dependencies;
    const closed: MediaDeliveryDenialReason[] = [];

    const asset = await repository.findAsset(input.executor, input.assetId);
    if (asset === undefined) {
      // An asset nobody has heard of and an asset nobody may see are the same
      // answer to a caller, and saying which is a disclosure.
      return denial(['not_attached']);
    }

    for (const gate of this.technicalGates(asset, input.variantKind)) {
      closed.push(gate);
    }

    // Asked even when a technical gate is already closed. The cost is one
    // query; the benefit is that an operator sees the whole picture, and that a
    // held asset is reported as held rather than as merely unprocessed.
    const attachment = await association.describe({
      assetId: input.assetId,
      executor: input.executor,
      now: input.now,
      ownerDomain: asset.ownerDomain,
      surface: input.surface,
      viewerId: input.viewerId,
    });
    if (attachment === undefined) {
      closed.push('not_attached');
    } else {
      if (!attachment.published) closed.push('not_published');
      if (!attachment.viewerEntitled) closed.push('not_entitled');
    }

    const safeToDeliver = await safety.mayDeliver({
      assetId: input.assetId,
      executor: input.executor,
      now: input.now,
      ownerDomain: asset.ownerDomain,
      surface: input.surface,
    });
    if (!safeToDeliver) closed.push('safety_restricted');

    if (closed.length > 0) return denial(closed);
    return { allowed: true, variantKind: input.variantKind };
  }

  /**
   * What MEDIA itself knows, which is only ever about bytes.
   *
   * `ready` is necessary and nowhere near sufficient. It is one term in the
   * conjunction above and it is the only one this domain is entitled to supply.
   */
  private technicalGates(
    asset: MediaAssetRow,
    variantKind: MediaVariantKind,
  ): readonly MediaDeliveryDenialReason[] {
    const gates: MediaDeliveryDenialReason[] = [];
    if (!requiredMediaVariants[asset.assetClass].includes(variantKind)) {
      gates.push('unknown_variant');
    }
    if (asset.lifecycle === 'quarantined') gates.push('quarantined');
    else if (asset.lifecycle === 'deleting' || asset.lifecycle === 'deleted') {
      gates.push('removed');
    } else if (asset.lifecycle !== 'ready') gates.push('not_technically_ready');
    return gates;
  }
}

function denial(
  closedGates: readonly MediaDeliveryDenialReason[],
): MediaDeliveryDecision {
  const ordered = [...mediaDeliveryDenialReasons].filter((reason) =>
    closedGates.includes(reason),
  );
  return {
    allowed: false,
    closedGates: ordered,
    // The strongest gate by the vocabulary's own order. Never a random one.
    reasonCode: ordered[0] ?? 'not_attached',
  };
}
