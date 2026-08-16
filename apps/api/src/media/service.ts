import type { SafeLogger } from '@velora/observability/server';

import type { MediaAssetRow, MediaObjectRow } from './schema.js';
import type { MediaInspectionFacts, MediaRepository } from './repository.js';
import {
  maximumMediaObjectBytes,
  mediaObjectKey,
  mediaUploadWindowMilliseconds,
  requiredMediaVariants,
  type MediaAssetClass,
  type MediaOwnerDomain,
  type MediaRejectionReason,
} from './policy.js';
import {
  MediaStorageUnavailableError,
  type MediaStoragePort,
} from './storage.js';

/**
 * The MEDIA domain service.
 *
 * It answers exactly three kinds of question: does this binary exist, what is
 * it technically, and what does the platform still owe against it. It answers
 * no question about whether anybody may see it, and it holds no contract that
 * could be mistaken for one.
 *
 * Every method takes the owning domain and its reference. That is not
 * decoration: an operation that cannot name its owner cannot be authorized, and
 * making the owner a parameter rather than an ambient value is what stops a
 * future caller from reaching an asset it does not own.
 */

export type MediaOutcome =
  | { readonly asset: MediaAssetRow; readonly kind: 'asset' }
  | {
      readonly asset: MediaAssetRow;
      readonly capability: MediaUploadHandoff;
      readonly kind: 'upload_ready';
    }
  /** The operation identity was reused with a materially different request. */
  | { readonly kind: 'idempotency_conflict' }
  | { readonly kind: 'not_found' }
  /** A concurrent writer moved the asset out from under this attempt. */
  | { readonly kind: 'conflict' }
  /** No approved storage provider, so nothing can be accepted at all. */
  | { readonly kind: 'storage_unavailable' };

/**
 * What a client is given so it can write bytes.
 *
 * It carries no object key, no provider name, no capability reference, and no
 * digest. Those are provider state; what leaves the platform is an address, the
 * method, the ceiling, and when it stops working.
 */
export interface MediaUploadHandoff {
  readonly assetId: string;
  readonly expiresAt: Date;
  readonly headers: Readonly<Record<string, string>>;
  readonly maximumBytes: number;
  readonly method: 'PUT';
  readonly url: string;
}

export interface MediaServiceDependencies {
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly repository: MediaRepository;
  readonly storage: MediaStoragePort;
}

export class MediaService {
  constructor(private readonly dependencies: MediaServiceDependencies) {}

  /** Which derivatives a class owes before it may ever be `ready`. */
  requiredVariants(assetClass: MediaAssetClass) {
    return requiredMediaVariants[assetClass];
  }

  /**
   * Creates an asset and its first upload session, then obtains a capability.
   *
   * The ordering is the interesting part and it is forced by two rules that
   * pull in opposite directions. Provider calls must not happen inside a
   * database transaction, and a capability must not exist for an object no row
   * describes. So the rows commit first and the capability is obtained and
   * recorded afterwards; a crash in between leaves a session with no capability
   * — recoverable, visible, and reconcilable — instead of a live capability
   * pointing at an object the platform has never heard of.
   *
   * Idempotency is the owning domain's operation identity. A repeat resolves to
   * the same asset. A repeat that names a different class is a conflict and is
   * refused, because silently returning the first asset would hand the caller
   * something other than what it asked for.
   */
  async createUpload(input: {
    readonly assetClass: MediaAssetClass;
    readonly idempotencyKey: string;
    readonly ownerDomain: MediaOwnerDomain;
    readonly ownerReference: string;
  }): Promise<MediaOutcome> {
    const { repository, storage } = this.dependencies;
    const now = this.dependencies.now();
    const assetId = crypto.randomUUID();
    const objectKey = mediaObjectKey({ assetId, role: 'original' });

    const created = await repository.transaction(async (executor) => {
      const outcome = await repository.createAsset(executor, {
        assetClass: input.assetClass,
        id: assetId,
        idempotencyKey: input.idempotencyKey,
        now,
        ownerDomain: input.ownerDomain,
        ownerReference: input.ownerReference,
      });
      if (outcome.asset.assetClass !== input.assetClass) return 'conflict';
      if (!outcome.created) return outcome.asset;

      const session = await repository.insertUploadSession(executor, {
        assetId: outcome.asset.id,
        attempt: 1,
        expiresAt: new Date(now.getTime() + mediaUploadWindowMilliseconds),
        id: crypto.randomUUID(),
        maximumBytes: maximumMediaObjectBytes,
        now,
        objectKey,
      });
      if (session === undefined) return 'conflict';
      const advanced = await repository.transitionAsset(executor, {
        assetId: outcome.asset.id,
        expectedLifecycle: 'initiated',
        lifecycle: 'awaiting_upload',
        now,
      });
      return advanced ?? 'conflict';
    });
    if (created === 'conflict') return { kind: 'idempotency_conflict' };

    const session = await repository.findOpenUploadSession(
      repository.transactionless,
      created.id,
    );
    // A repeat whose window already closed is not a failure of this call: the
    // asset exists and its state is the answer. Reissuing is Phase 2's job and
    // belongs to the caller that knows whether the person is still waiting.
    if (session === undefined) return { asset: created, kind: 'asset' };

    let capability;
    try {
      capability = await storage.createUploadCapability({
        expiresAt: session.expiresAt,
        maximumBytes: session.maximumBytes,
        objectKey: session.objectKey,
      });
    } catch (error) {
      if (error instanceof MediaStorageUnavailableError) {
        return { kind: 'storage_unavailable' };
      }
      throw error;
    }

    await repository.recordUploadCapability(repository.transactionless, {
      now: this.dependencies.now(),
      provider: storage.name,
      providerReference: capability.providerReference,
      sessionId: session.id,
    });

    return {
      asset: created,
      capability: {
        assetId: created.id,
        expiresAt: capability.expiresAt,
        headers: capability.headers,
        maximumBytes: capability.maximumBytes,
        method: capability.method,
        url: capability.url,
      },
      kind: 'upload_ready',
    };
  }

  /** An asset, but only for the domain and owner that created it. */
  async readOwned(input: {
    readonly assetId: string;
    readonly ownerDomain: MediaOwnerDomain;
    readonly ownerReference: string;
  }): Promise<MediaOutcome> {
    const asset = await this.dependencies.repository.findOwnedAsset(
      this.dependencies.repository.transactionless,
      input,
    );
    return asset === undefined
      ? { kind: 'not_found' }
      : { asset, kind: 'asset' };
  }

  /** Every object the provider holds for an asset. Internal callers only. */
  listObjects(assetId: string): Promise<readonly MediaObjectRow[]> {
    return this.dependencies.repository.listObjects(
      this.dependencies.repository.transactionless,
      assetId,
    );
  }

  /**
   * Records that an object exists at the expected key and that its bytes are
   * untrusted.
   *
   * Completion is a signal, never a transition on its own. The provider is
   * asked whether the object is there and how big it is, and what it says is
   * recorded as evidence about storage rather than about content — a provider
   * echoing a client-supplied content type is echoing the client. The
   * inspection obligation is written by the same transaction that records the
   * state, so a process that dies immediately afterwards has lost a queue
   * message and not a duty.
   */
  async recordUpload(input: {
    readonly assetId: string;
    readonly ownerDomain: MediaOwnerDomain;
    readonly ownerReference: string;
  }): Promise<MediaOutcome> {
    const { repository, storage } = this.dependencies;
    const asset = await repository.findOwnedAsset(
      repository.transactionless,
      input,
    );
    if (asset === undefined) return { kind: 'not_found' };
    // Repeating a completion that already landed is a no-op success, so a
    // client that retried a lost response does not turn its own upload into a
    // conflict.
    if (asset.lifecycle !== 'awaiting_upload') {
      return { asset, kind: 'asset' };
    }

    const session = await repository.findOpenUploadSession(
      repository.transactionless,
      asset.id,
    );
    if (session === undefined) return { kind: 'conflict' };

    let stat;
    try {
      stat = await storage.statObject(session.objectKey);
    } catch (error) {
      if (error instanceof MediaStorageUnavailableError) {
        return { kind: 'storage_unavailable' };
      }
      throw error;
    }
    if (stat === undefined) return { kind: 'conflict' };

    const now = this.dependencies.now();
    const recorded = await repository.transaction(async (executor) => {
      const advanced = await repository.transitionAsset(executor, {
        assetId: asset.id,
        expectedLifecycle: 'awaiting_upload',
        lifecycle: 'uploaded',
        now,
      });
      if (advanced === undefined) return undefined;
      await repository.closeUploadSession(executor, {
        now,
        sessionId: session.id,
        state: 'completed',
      });
      await repository.insertObject(executor, {
        assetId: asset.id,
        id: crypto.randomUUID(),
        now,
        objectKey: session.objectKey,
        provider: storage.name,
        role: 'original',
      });
      await repository.appendObligation(executor, {
        assetId: asset.id,
        id: crypto.randomUUID(),
        kind: 'inspect',
        now,
      });
      return advanced;
    });
    return recorded === undefined
      ? { kind: 'conflict' }
      : { asset: recorded, kind: 'asset' };
  }

  /**
   * Records what inspection found, or why the object was refused.
   *
   * Both outcomes are transitions with a recorded reason. A quarantine is not a
   * deletion and not an error: the object stays, unreachable, with a
   * machine-readable reason nobody outside the platform sees.
   */
  async recordInspection(input: {
    readonly assetId: string;
    readonly outcome:
      | { readonly facts: MediaInspectionFacts; readonly kind: 'inspected' }
      | {
          readonly kind: 'quarantined';
          readonly reason: MediaRejectionReason;
        };
  }): Promise<MediaOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const row = await repository.transitionAsset(
      repository.transactionless,
      input.outcome.kind === 'inspected'
        ? {
            assetId: input.assetId,
            expectedLifecycle: 'inspecting',
            facts: input.outcome.facts,
            lifecycle: 'inspected',
            now,
          }
        : {
            assetId: input.assetId,
            expectedLifecycle: 'inspecting',
            lifecycle: 'quarantined',
            now,
            rejectionReason: input.outcome.reason,
          },
    );
    return row === undefined
      ? { kind: 'conflict' }
      : { asset: row, kind: 'asset' };
  }

  /**
   * Starts removal.
   *
   * Delivery stops at the record immediately; the bytes converge afterwards.
   * The obligation and the state change commit together, which is why a worker
   * dying next loses nothing: PostgreSQL already owes the deletion.
   */
  async requestDeletion(input: {
    readonly assetId: string;
  }): Promise<MediaOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const asset = await repository.findAsset(
      repository.transactionless,
      input.assetId,
    );
    if (asset === undefined) return { kind: 'not_found' };
    if (asset.lifecycle === 'deleting' || asset.lifecycle === 'deleted') {
      return { asset, kind: 'asset' };
    }

    const deleted = await repository.transaction(async (executor) => {
      const advanced = await repository.transitionAsset(executor, {
        assetId: asset.id,
        deletionRequestedAt: asset.deletionRequestedAt ?? now,
        expectedLifecycle: asset.lifecycle,
        lifecycle: 'deleting',
        now,
      });
      if (advanced === undefined) return undefined;
      const session = await repository.findOpenUploadSession(
        executor,
        asset.id,
      );
      if (session !== undefined) {
        await repository.closeUploadSession(executor, {
          now,
          sessionId: session.id,
          state: 'abandoned',
        });
      }
      await repository.appendObligation(executor, {
        assetId: asset.id,
        id: crypto.randomUUID(),
        kind: 'delete',
        now,
      });
      return advanced;
    });
    if (deleted !== undefined) return { asset: deleted, kind: 'asset' };

    // The transition applied to nothing, which means somebody moved the asset
    // between the read and the write. If what they did was start the same
    // removal, this call got what it asked for and reporting a conflict would
    // invite a caller to retry a duty that is already owed. Only a genuinely
    // different concurrent move is a conflict.
    const current = await repository.findAsset(
      repository.transactionless,
      input.assetId,
    );
    if (current === undefined) return { kind: 'not_found' };
    return current.lifecycle === 'deleting' || current.lifecycle === 'deleted'
      ? { asset: current, kind: 'asset' }
      : { kind: 'conflict' };
  }
}
