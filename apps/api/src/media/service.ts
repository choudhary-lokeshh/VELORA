import type { SafeLogger } from '@velora/observability/server';

import type {
  MediaAssetRow,
  MediaObjectRow,
  MediaObligationRow,
  MediaUploadSessionRow,
} from './schema.js';
import type { MediaInspector } from './inspection.js';
import type { MediaImageProcessorPort } from './processing.js';
import type {
  MediaExecutor,
  MediaInspectionFacts,
  MediaRepository,
} from './repository.js';
import {
  isMediaIdempotencyKey,
  maximumMediaBytesByClass,
  publicRejectionFor,
  readinessFor,
  maximumMediaObligationAttempts,
  maximumMediaReadBytes,
  mediaAbandonedUploadMilliseconds,
  mediaObjectKey,
  mediaObligationBackoffMilliseconds,
  mediaObligationLeaseMilliseconds,
  mediaSweepBatchSize,
  mediaUploadWindowMilliseconds,
  requiredMediaVariants,
  type MediaAssetClass,
  type MediaOwnerDomain,
  type MediaPublicRejectionReason,
  type MediaReadinessState,
  type MediaRejectionReason,
} from './policy.js';
import {
  mediaContentTypes,
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
  /** The owning domain supplied an operation identity outside the contract. */
  | { readonly kind: 'invalid_idempotency_key' }
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

/**
 * What an owning domain sees. No lifecycle value, no key, no digest, no size.
 */
export interface MediaReadiness {
  readonly assetId: string;
  readonly rejection: MediaPublicRejectionReason | undefined;
  readonly state: MediaReadinessState;
  /** Present only while a window is open, so a client can show a deadline. */
  readonly uploadExpiresAt: Date | undefined;
}

export interface MediaServiceDependencies {
  /**
   * Absent where the process does no byte work. The API composes no inspector:
   * decoding hostile input on a request thread is exactly what the worker
   * boundary exists to prevent, and a service that cannot inspect cannot be
   * talked into inspecting.
   */
  readonly inspector?: MediaInspector;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  /** Absent for the same reason the inspector is. Byte work is the worker's. */
  readonly processor?: MediaImageProcessorPort;
  readonly repository: MediaRepository;
  readonly storage: MediaStoragePort;
}

function digestOf(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

export class MediaService {
  constructor(private readonly dependencies: MediaServiceDependencies) {}

  /** Which derivatives a class owes before it may ever be `ready`. */
  requiredVariants(assetClass: MediaAssetClass) {
    return requiredMediaVariants[assetClass];
  }

  /**
   * What an owning domain may be told about the assets it holds.
   *
   * The published readiness contract, and the only way another domain learns
   * anything about a `media_` row. It carries a coarse product state, a coarse
   * refusal reason, and an upload expiry — never a lifecycle value, an object
   * key, a digest, a byte size, an adapter name, or an internal rejection code.
   *
   * Batched because the caller is almost always rendering a list, and a
   * per-asset round trip would make a profile page's cost a function of how
   * many images somebody uploaded.
   */
  async describeReadiness(input: {
    readonly assetIds: readonly string[];
    readonly executor?: MediaExecutor;
  }): Promise<readonly MediaReadiness[]> {
    if (input.assetIds.length === 0) return [];
    const { repository } = this.dependencies;
    const assets = await repository.listAssets(
      input.executor ?? repository.transactionless,
      input.assetIds,
    );
    const sessions = await repository.listOpenUploadSessions(
      input.executor ?? repository.transactionless,
      assets.map((asset) => asset.id),
    );
    const expiryByAsset = new Map(
      sessions.map((session) => [session.assetId, session.expiresAt]),
    );

    return assets.map((asset) => ({
      assetId: asset.id,
      rejection:
        asset.rejectionReason === null
          ? undefined
          : publicRejectionFor[asset.rejectionReason],
      state: readinessFor[asset.lifecycle],
      uploadExpiresAt: expiryByAsset.get(asset.id),
    }));
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
    const { repository } = this.dependencies;
    if (!isMediaIdempotencyKey(input.idempotencyKey)) {
      return { kind: 'invalid_idempotency_key' };
    }
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

      await repository.lockAssetUpload(executor, outcome.asset.id);
      const session = await repository.insertUploadSession(executor, {
        assetId: outcome.asset.id,
        attempt: 1,
        expiresAt: new Date(now.getTime() + mediaUploadWindowMilliseconds),
        id: crypto.randomUUID(),
        maximumBytes: maximumMediaBytesByClass[input.assetClass],
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
    // A repeat whose window already closed gets a new one. The caller asked to
    // upload; telling it the asset exists and leaving it with no way to send
    // bytes would be technically true and useless.
    if (session === undefined) {
      return this.reissueUpload({
        assetId: created.id,
        ownerDomain: input.ownerDomain,
        ownerReference: input.ownerReference,
      });
    }

    return this.issueCapability(created, session);
  }

  /**
   * Opens a new upload window on an asset that never received bytes.
   *
   * The new window gets a **new object key**, never the old one. An expired
   * capability is expired at the provider too, but reusing the key would mean
   * that if one ever were honoured late, its bytes would land exactly where the
   * next completion looks — and the platform would accept an object written
   * under an authorization that had already lapsed. A fresh key makes that
   * sequence describe nothing.
   *
   * Only an asset still waiting for its first bytes may be reissued. An asset
   * that is uploaded, inspecting, quarantined, ready, or being deleted has
   * moved past the point where a second window means anything, and handing one
   * out would invite a client to overwrite a decision.
   */
  async reissueUpload(input: {
    readonly assetId: string;
    readonly ownerDomain: MediaOwnerDomain;
    readonly ownerReference: string;
  }): Promise<MediaOutcome> {
    const { repository } = this.dependencies;
    const asset = await repository.findOwnedAsset(
      repository.transactionless,
      input,
    );
    if (asset === undefined) return { kind: 'not_found' };
    if (
      asset.lifecycle !== 'awaiting_upload' &&
      asset.lifecycle !== 'initiated'
    ) {
      return { kind: 'conflict' };
    }

    const now = this.dependencies.now();
    const opened = await repository.transaction(async (executor) => {
      // Before any row is touched, so two replicas reissuing the same asset
      // serialize instead of colliding on the second unique index.
      await repository.lockAssetUpload(executor, asset.id);

      const existing = await repository.findOpenUploadSession(
        executor,
        asset.id,
      );
      // Attempts count every window this asset ever had, so the number comes
      // from the latest row rather than from the open one — which, by the time
      // a reissue runs, has usually already been closed by the sweep.
      const latest = await repository.findLatestUploadSession(
        executor,
        asset.id,
      );
      if (existing !== undefined) {
        // Somebody else opened one while this call was waiting for the lock, or
        // the window was never actually closed. Either way there is a live
        // capability and a second one is not wanted.
        if (existing.expiresAt.getTime() > now.getTime()) return existing;
        await repository.closeUploadSession(executor, {
          now,
          sessionId: existing.id,
          state: 'expired',
        });
      }

      return repository.insertUploadSession(executor, {
        assetId: asset.id,
        attempt: (latest?.attempt ?? 0) + 1,
        expiresAt: new Date(now.getTime() + mediaUploadWindowMilliseconds),
        id: crypto.randomUUID(),
        maximumBytes: maximumMediaBytesByClass[asset.assetClass],
        now,
        objectKey: mediaObjectKey({ assetId: asset.id, role: 'original' }),
      });
    });
    if (opened === undefined) return { kind: 'conflict' };

    return this.issueCapability(asset, opened);
  }

  /**
   * Obtains a provider capability for an open window and records it.
   *
   * Split out because three paths need it: a first upload, a reissue, and the
   * recovery of a session that committed before the provider call could be
   * made. All three are the same two steps in the same order, and the order is
   * the point — the row exists first, so nothing here can leave a capability
   * for an object no row describes.
   */
  private async issueCapability(
    asset: MediaAssetRow,
    session: MediaUploadSessionRow,
  ): Promise<MediaOutcome> {
    const { repository, storage } = this.dependencies;
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
      // Any other provider failure is ambiguous, not a refusal. The session
      // stays open with no capability recorded, which is a shape recovery can
      // see, and the caller is told nothing succeeded.
      throw error;
    }

    await repository.recordUploadCapability(repository.transactionless, {
      now: this.dependencies.now(),
      provider: storage.name,
      providerReference: capability.providerReference,
      sessionId: session.id,
    });

    return {
      asset,
      capability: {
        assetId: asset.id,
        expiresAt: capability.expiresAt,
        headers: capability.headers,
        maximumBytes: capability.maximumBytes,
        method: capability.method,
        url: capability.url,
      },
      kind: 'upload_ready',
    };
  }

  /**
   * Closes upload windows whose instant has passed.
   *
   * Closing is all this does. Whether bytes reached the provider under a window
   * nobody completed is a question about provider state, and answering it is
   * reconciliation's job rather than a sweep's; what a sweep owes is that a
   * spent window stops being claimable and stops holding the one-open-window
   * slot against a reissue.
   */
  async sweepExpiredUploads(input?: {
    readonly limit?: number;
  }): Promise<number> {
    const { repository } = this.dependencies;
    const closed = await repository.claimExpiredUploadSessions({
      limit: input?.limit ?? mediaSweepBatchSize,
      now: this.dependencies.now(),
    });
    return closed.length;
  }

  /**
   * Reclaims assets that were reserved and never received bytes.
   *
   * This is a resource policy about uploads nobody finished, under the explicit
   * technical TTL in `policy.ts`, and it is deliberately not a retention policy
   * about accepted media — no duration for that is invented anywhere, and this
   * one may not be cited as a precedent for one.
   *
   * Reclaiming goes through the ordinary deletion path rather than deleting
   * rows, so whatever bytes did reach the provider become a recorded obligation
   * instead of an orphan nobody is looking for.
   */
  async sweepAbandonedUploads(input?: {
    readonly limit?: number;
  }): Promise<number> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const abandoned = await repository.findAbandonedAssets(
      repository.transactionless,
      {
        before: new Date(now.getTime() - mediaAbandonedUploadMilliseconds),
        limit: input?.limit ?? mediaSweepBatchSize,
      },
    );

    let reclaimed = 0;
    for (const asset of abandoned) {
      const outcome = await this.requestDeletion({ assetId: asset.id });
      if (outcome.kind === 'asset') reclaimed += 1;
    }
    return reclaimed;
  }

  /**
   * Re-obtains capabilities for sessions that committed and never got one.
   *
   * The crash window between the commit and the provider call, closed. It is
   * bounded and idempotent: a session that already has a capability is not in
   * the query, and re-obtaining one for a session that does not have it cannot
   * produce a second live window because the window is the row.
   */
  async recoverUploadCapabilities(input?: {
    readonly limit?: number;
  }): Promise<number> {
    const { repository } = this.dependencies;
    const stranded = await repository.findUncapabilitiedSessions(
      repository.transactionless,
      { limit: input?.limit ?? mediaSweepBatchSize },
    );

    let recovered = 0;
    for (const session of stranded) {
      const asset = await repository.findAsset(
        repository.transactionless,
        session.assetId,
      );
      if (asset === undefined) continue;
      const outcome = await this.issueCapability(asset, session);
      if (outcome.kind === 'upload_ready') recovered += 1;
    }
    return recovered;
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
   * Claims inspection obligations and discharges them.
   *
   * One cycle, bounded, and safe to run from several workers at once: the claim
   * is a database lease, so two cycles take different rows and a worker that
   * dies mid-inspection loses its lease rather than the duty.
   *
   * Every step is idempotent against a repeat. An obligation whose asset has
   * already moved past `uploaded` is discharged without touching the asset,
   * because the work it describes is already done — which is what makes a
   * reclaimed lease safe rather than a second inspection of the same bytes.
   */
  async runInspections(input: {
    readonly limit?: number;
    readonly owner: string;
  }): Promise<{ readonly inspected: number; readonly quarantined: number }> {
    const { inspector, repository } = this.dependencies;
    if (inspector === undefined) return { inspected: 0, quarantined: 0 };

    const claimed = await repository.claimObligations({
      kind: 'inspect',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: input.limit ?? mediaSweepBatchSize,
      now: this.dependencies.now(),
      owner: input.owner,
    });

    let inspected = 0;
    let quarantined = 0;
    for (const obligation of claimed) {
      const outcome = await this.discharge(obligation, input.owner, inspector);
      if (outcome === 'inspected') inspected += 1;
      if (outcome === 'quarantined') quarantined += 1;
    }
    return { inspected, quarantined };
  }

  private async discharge(
    obligation: MediaObligationRow,
    owner: string,
    inspector: MediaInspector,
  ): Promise<'inspected' | 'noop' | 'quarantined'> {
    const { repository } = this.dependencies;
    try {
      const asset = await repository.findAsset(
        repository.transactionless,
        obligation.assetId,
      );
      const original =
        asset === undefined
          ? undefined
          : await repository.findOriginalObject(
              repository.transactionless,
              asset.id,
            );
      // `inspecting` as well as `uploaded`, because a previous attempt may have
      // died between taking the state and reaching a conclusion. Without it a
      // reclaimed lease found an asset that was no longer `uploaded`, decided
      // the work no longer existed, and discharged the duty — leaving the asset
      // in `inspecting` for ever with nothing owed against it. Re-inspecting is
      // safe: it reads bytes and measures them, and the lease is what stops two
      // workers doing it at once.
      //
      // Anything else — gone, no recorded object, already concluded, being
      // deleted — is work that genuinely no longer exists, and the duty is
      // discharged rather than retried.
      if (
        asset === undefined ||
        original === undefined ||
        (asset.lifecycle !== 'uploaded' && asset.lifecycle !== 'inspecting')
      ) {
        await this.completeObligation(obligation.id, owner);
        return 'noop';
      }

      const started =
        asset.lifecycle === 'inspecting'
          ? asset
          : await repository.transitionAsset(repository.transactionless, {
              assetId: asset.id,
              expectedLifecycle: 'uploaded',
              lifecycle: 'inspecting',
              now: this.dependencies.now(),
            });
      if (started === undefined) {
        // Another worker took it between the read and the write.
        await this.completeObligation(obligation.id, owner);
        return 'noop';
      }

      const outcome = await inspector.inspect(original.objectKey);
      const now = this.dependencies.now();
      await repository.transaction(async (executor) => {
        if (outcome.kind === 'inspected') {
          await repository.transitionAsset(executor, {
            assetId: asset.id,
            expectedLifecycle: 'inspecting',
            facts: outcome.facts,
            lifecycle: 'inspected',
            now,
          });
          await repository.recordObjectFacts(executor, {
            byteSize: outcome.facts.byteSize,
            digest: outcome.facts.digest,
            format: outcome.facts.detectedFormat,
            height: outcome.facts.height,
            now,
            objectId: original.id,
            width: outcome.facts.width,
          });
          // The next duty is written by the transaction that recorded the
          // facts justifying it, so a process dying here loses a queue message
          // and not the obligation to process these bytes.
          await repository.appendObligation(executor, {
            assetId: asset.id,
            id: crypto.randomUUID(),
            kind: 'process',
            now,
          });
        } else {
          await repository.transitionAsset(executor, {
            assetId: asset.id,
            expectedLifecycle: 'inspecting',
            lifecycle: 'quarantined',
            now,
            rejectionReason: outcome.reason,
          });
        }
        await repository.completeObligation(executor, {
          now,
          obligationId: obligation.id,
          owner,
        });
      });
      return outcome.kind === 'inspected' ? 'inspected' : 'quarantined';
    } catch (error) {
      // A short code, never the underlying message: a decoder's text names
      // internals and a provider's may echo content. The asset stays in
      // `inspecting` and the lease expiry brings it back.
      await this.dependencies.repository.failObligation(
        this.dependencies.repository.transactionless,
        {
          backoffMilliseconds: mediaObligationBackoffMilliseconds,
          failureReason: 'inspection_failed',
          maximumAttempts: maximumMediaObligationAttempts,
          now: this.dependencies.now(),
          obligationId: obligation.id,
          owner,
        },
      );
      this.dependencies.logger.error(
        { error, obligation: obligation.kind },
        'media obligation attempt failed',
      );
      return 'noop';
    }
  }

  /**
   * Claims processing obligations and produces the derivative set.
   *
   * Every variant is rendered from decoded pixels and written under a fresh
   * server-generated key. The row is inserted **before** the bytes are written,
   * which is the same ordering the upload path uses and for the same reason: a
   * crash between the two leaves a record of an object that is missing, which
   * reconciliation can see, rather than bytes at a key nothing references,
   * which nobody would ever look for.
   *
   * Concurrency is settled by the database. Fifty attempts on one asset produce
   * one durable variant set, because the partial unique index over asset,
   * variant kind, and processing version admits exactly one row — and a losing
   * writer therefore never gets as far as writing bytes.
   */
  async runProcessing(input: {
    readonly limit?: number;
    readonly owner: string;
  }): Promise<{ readonly ready: number }> {
    const { processor, repository } = this.dependencies;
    if (processor === undefined) return { ready: 0 };

    const claimed = await repository.claimObligations({
      kind: 'process',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: input.limit ?? mediaSweepBatchSize,
      now: this.dependencies.now(),
      owner: input.owner,
    });

    let ready = 0;
    for (const obligation of claimed) {
      if (await this.process(obligation, input.owner, processor)) ready += 1;
    }
    return { ready };
  }

  private async process(
    obligation: MediaObligationRow,
    owner: string,
    processor: MediaImageProcessorPort,
  ): Promise<boolean> {
    const { repository, storage } = this.dependencies;
    try {
      const asset = await repository.findAsset(
        repository.transactionless,
        obligation.assetId,
      );
      const original =
        asset === undefined
          ? undefined
          : await repository.findOriginalObject(
              repository.transactionless,
              asset.id,
            );
      // `processing` as well as `inspected`, because a previous attempt may
      // have died partway and left the asset mid-flight. Anything else — gone,
      // quarantined, already ready, being deleted — is work that no longer
      // exists, and the duty is discharged rather than retried.
      if (
        asset === undefined ||
        original === undefined ||
        (asset.lifecycle !== 'inspected' && asset.lifecycle !== 'processing')
      ) {
        await this.completeObligation(obligation.id, owner);
        return false;
      }

      const started =
        asset.lifecycle === 'processing'
          ? asset
          : await repository.transitionAsset(repository.transactionless, {
              assetId: asset.id,
              expectedLifecycle: 'inspected',
              lifecycle: 'processing',
              now: this.dependencies.now(),
            });
      if (started === undefined) {
        await this.completeObligation(obligation.id, owner);
        return false;
      }

      const read = await storage.readObject({
        maximumBytes: maximumMediaReadBytes,
        objectKey: original.objectKey,
      });
      if (read.kind !== 'bytes') {
        // The original is gone or has grown beyond what the platform will
        // decode. Either way there is nothing to render from, and a derivative
        // set cannot be invented.
        await repository.transitionAsset(repository.transactionless, {
          assetId: asset.id,
          expectedLifecycle: 'processing',
          lifecycle: 'quarantined',
          now: this.dependencies.now(),
          rejectionReason:
            read.kind === 'absent' ? 'object_missing' : 'too_large',
        });
        await this.completeObligation(obligation.id, owner);
        return false;
      }

      const existing = await repository.listObjects(
        repository.transactionless,
        asset.id,
      );
      const present = new Set(
        existing
          .filter(
            (object) =>
              object.role === 'variant' &&
              object.processingVersion === processor.version,
          )
          .map((object) => object.variantKind),
      );

      for (const kind of requiredMediaVariants[asset.assetClass]) {
        // A retry re-renders only what is missing. Rendering a variant that
        // already exists would be work whose result the index would refuse
        // anyway.
        if (present.has(kind)) continue;
        const rendition = await processor.render({ bytes: read.bytes, kind });
        const objectKey = mediaObjectKey({
          assetId: asset.id,
          processingVersion: processor.version,
          role: 'variant',
          variantKind: kind,
        });
        const now = this.dependencies.now();
        const reserved = await repository.insertObject(
          repository.transactionless,
          {
            assetId: asset.id,
            byteSize: rendition.bytes.byteLength,
            digest: digestOf(rendition.bytes),
            format: rendition.format,
            height: rendition.height,
            id: crypto.randomUUID(),
            now,
            objectKey,
            processingVersion: processor.version,
            provider: storage.name,
            role: 'variant',
            variantKind: kind,
            width: rendition.width,
          },
        );
        // Another writer got there first. Nothing has been written to the
        // provider under this key, so there is nothing to clean up.
        if (reserved === undefined) continue;
        await storage.writeObject({
          bytes: rendition.bytes,
          contentType: mediaContentTypes[rendition.format],
          objectKey,
        });
      }

      const durable = await repository.listObjects(
        repository.transactionless,
        asset.id,
      );
      const complete = requiredMediaVariants[asset.assetClass].every((kind) =>
        durable.some(
          (object) =>
            object.role === 'variant' &&
            object.variantKind === kind &&
            object.processingVersion === processor.version &&
            object.state === 'present',
        ),
      );

      const now = this.dependencies.now();
      if (complete) {
        // `ready` is the strongest thing this domain says, and it says it only
        // once every derivative the class owes is durable.
        await repository.transitionAsset(repository.transactionless, {
          assetId: asset.id,
          expectedLifecycle: 'processing',
          lifecycle: 'ready',
          now,
          readyAt: now,
        });
      }
      await this.completeObligation(obligation.id, owner);
      return complete;
    } catch (error) {
      await this.dependencies.repository.failObligation(
        this.dependencies.repository.transactionless,
        {
          backoffMilliseconds: mediaObligationBackoffMilliseconds,
          failureReason: 'processing_failed',
          maximumAttempts: maximumMediaObligationAttempts,
          now: this.dependencies.now(),
          obligationId: obligation.id,
          owner,
        },
      );
      this.dependencies.logger.error(
        { error, obligation: obligation.kind },
        'media obligation attempt failed',
      );
      return false;
    }
  }

  /**
   * Discharges deletion obligations against the provider.
   *
   * Reaches **every** object of the asset, original and derivative alike. A
   * deletion that reached only the original would leave three sanitized copies
   * of the same picture on a CDN, which is the failure this enumeration exists
   * to prevent.
   *
   * Deletion is idempotent and an object the provider no longer has counts as
   * deleted — that conclusion is safe here because the local adapter's
   * semantics say so, and it is a question asked of every candidate provider
   * rather than assumed for all of them.
   *
   * A legal hold changes exactly one thing: the original survives. The
   * derivatives are still destroyed, the caches are still purged, and delivery
   * is still denied, because preservation and availability are independent and
   * conflating them would either serve something taken down or destroy
   * evidence a case needs. An asset under hold therefore stops at `deleting`,
   * and the database refuses to record it as `deleted` while the hold stands.
   */
  async runDeletions(input: {
    readonly limit?: number;
    readonly owner: string;
  }): Promise<{ readonly deleted: number; readonly held: number }> {
    const { repository, storage } = this.dependencies;
    const claimed = await repository.claimObligations({
      kind: 'delete',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: input.limit ?? mediaSweepBatchSize,
      now: this.dependencies.now(),
      owner: input.owner,
    });

    let deleted = 0;
    let held = 0;
    for (const obligation of claimed) {
      try {
        const asset = await repository.findAsset(
          repository.transactionless,
          obligation.assetId,
        );
        if (asset === undefined || asset.lifecycle === 'deleted') {
          await this.completeObligation(obligation.id, input.owner);
          continue;
        }

        const objects = await repository.listObjects(
          repository.transactionless,
          asset.id,
        );
        const underHold = asset.legalHoldAt !== null;
        let originalRemains = false;

        for (const object of objects) {
          if (object.state === 'deleted') continue;
          if (underHold && object.role === 'original') {
            originalRemains = true;
            continue;
          }
          await storage.deleteObject(object.objectKey);
          const now = this.dependencies.now();
          await repository.markObjectState(repository.transactionless, {
            deletedAt: now,
            now,
            objectId: object.id,
            state: 'deleted',
          });
          // A destroyed derivative may still be sitting in a cache. Owing the
          // purge separately is what keeps that visible rather than assumed.
          if (object.role === 'variant') {
            await repository.appendObligation(repository.transactionless, {
              assetId: asset.id,
              id: crypto.randomUUID(),
              kind: 'purge',
              now,
              objectId: object.id,
            });
          }
        }

        const now = this.dependencies.now();
        if (originalRemains) {
          held += 1;
        } else {
          await repository.transitionAsset(repository.transactionless, {
            assetId: asset.id,
            deletedAt: now,
            expectedLifecycle: 'deleting',
            lifecycle: 'deleted',
            now,
          });
          deleted += 1;
        }
        await this.completeObligation(obligation.id, input.owner);
      } catch (error) {
        await repository.failObligation(repository.transactionless, {
          backoffMilliseconds: mediaObligationBackoffMilliseconds,
          failureReason: 'deletion_failed',
          maximumAttempts: maximumMediaObligationAttempts,
          now: this.dependencies.now(),
          obligationId: obligation.id,
          owner: input.owner,
        });
        this.dependencies.logger.error(
          { error, obligation: obligation.kind },
          'media obligation attempt failed',
        );
      }
    }
    return { deleted, held };
  }

  /**
   * Asks the delivery layer to forget addresses, and records what it said.
   *
   * Origin denial never waits for this. A held or removed asset stops being
   * authorized the moment any authority says so, and a cache that has not yet
   * been told is a separate, visible obligation rather than a hole in the
   * decision.
   *
   * `unsupported` completes the obligation and is recorded as itself: a
   * provider with no purge mechanism has not purged, and writing that down is
   * the difference between an operator knowing the exposure and believing it
   * was handled. A failure stays pending and backs off, so a purge backlog is
   * something somebody can see.
   */
  async runPurges(input: {
    readonly limit?: number;
    readonly owner: string;
  }): Promise<{ readonly purged: number; readonly unsupported: number }> {
    const { repository, storage } = this.dependencies;
    const claimed = await repository.claimObligations({
      kind: 'purge',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: input.limit ?? mediaSweepBatchSize,
      now: this.dependencies.now(),
      owner: input.owner,
    });

    let purged = 0;
    let unsupported = 0;
    for (const obligation of claimed) {
      try {
        const object =
          obligation.objectId === null
            ? undefined
            : await repository.findObject(
                repository.transactionless,
                obligation.objectId,
              );
        if (object === undefined) {
          await this.completeObligation(obligation.id, input.owner);
          continue;
        }

        await repository.markPurgeRequested(repository.transactionless, {
          now: this.dependencies.now(),
          objectId: object.id,
        });
        const outcome = await storage.purge(object.objectKey);
        if (outcome.kind === 'failed') {
          // Not recorded as an outcome, because it is not one yet. The
          // obligation stays owed and visible.
          throw new Error(`purge refused: ${outcome.code}`);
        }
        await repository.recordPurgeOutcome(repository.transactionless, {
          now: this.dependencies.now(),
          objectId: object.id,
          outcome: outcome.kind,
        });
        if (outcome.kind === 'purged') purged += 1;
        else unsupported += 1;
        await this.completeObligation(obligation.id, input.owner);
      } catch (error) {
        await repository.failObligation(repository.transactionless, {
          backoffMilliseconds: mediaObligationBackoffMilliseconds,
          failureReason: 'purge_failed',
          maximumAttempts: maximumMediaObligationAttempts,
          now: this.dependencies.now(),
          obligationId: obligation.id,
          owner: input.owner,
        });
        this.dependencies.logger.error(
          { error, obligation: obligation.kind },
          'media obligation attempt failed',
        );
      }
    }
    return { purged, unsupported };
  }

  /**
   * Places or lifts a legal hold.
   *
   * Independent of removal in both directions. Holding an asset does not stop
   * it being taken down, and taking it down does not destroy what a case needs.
   */
  async setLegalHold(input: {
    readonly assetId: string;
    readonly held: boolean;
  }): Promise<MediaOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const row = await repository.setLegalHold(repository.transactionless, {
      assetId: input.assetId,
      held: input.held,
      now,
    });
    if (row === undefined) return { kind: 'not_found' };

    // Lifting a hold on an asset that was already being removed resumes the
    // deletion. The obligation that ran under the hold was discharged — it did
    // everything it was allowed to do — so without this the removal would stay
    // owed with nothing left to carry it out, and the asset would sit in
    // `deleting` until a reconciliation pass noticed. A deferred duty that
    // depends on somebody spotting it later is not a duty the platform owes.
    if (!input.held && row.lifecycle === 'deleting') {
      await repository.appendObligation(repository.transactionless, {
        assetId: row.id,
        id: crypto.randomUUID(),
        kind: 'delete',
        now,
      });
    }
    return { asset: row, kind: 'asset' };
  }

  /**
   * Owes a cache purge for every address of an asset that has one.
   *
   * The operation a takedown authority calls. It records an obligation rather
   * than performing anything, so a worker dying immediately afterwards loses a
   * queue message and not the duty — which is the whole reason a takedown
   * cannot quietly fail to reach a cache.
   */
  async requestPurge(input: {
    readonly assetId: string;
  }): Promise<{ readonly owed: number }> {
    const { repository } = this.dependencies;
    const objects = await repository.listObjects(
      repository.transactionless,
      input.assetId,
    );
    const now = this.dependencies.now();
    let owed = 0;
    for (const object of objects) {
      // Only derivatives are ever served from a public address, so only they
      // can be sitting in a cache.
      if (object.role !== 'variant') continue;
      const appended = await repository.appendObligation(
        repository.transactionless,
        {
          assetId: input.assetId,
          id: crypto.randomUUID(),
          kind: 'purge',
          now,
          objectId: object.id,
        },
      );
      if (appended !== undefined) owed += 1;
    }
    return { owed };
  }

  private async completeObligation(
    obligationId: string,
    owner: string,
  ): Promise<void> {
    await this.dependencies.repository.completeObligation(
      this.dependencies.repository.transactionless,
      { now: this.dependencies.now(), obligationId, owner },
    );
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
