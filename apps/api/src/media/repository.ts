import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  notInArray,
  sql,
} from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import { lockIdempotentOperation } from '../database/idempotency-lock.js';
import {
  mediaAssets,
  mediaObjects,
  mediaObligations,
  mediaUploadSessions,
  type MediaAssetRow,
  type MediaObjectRow,
  type MediaObligationRow,
  type MediaUploadSessionRow,
} from './schema.js';
import {
  mediaTransitionAllowed,
  type MediaAssetClass,
  type MediaAssetLifecycle,
  type MediaImageFormat,
  type MediaObjectRole,
  type MediaObligationKind,
  type MediaOwnerDomain,
  type MediaRejectionReason,
  type MediaVariantKind,
} from './policy.js';

/**
 * MEDIA's persistence.
 *
 * Two rules hold throughout. Every write that depends on a current state
 * re-reads that state in the same statement that changes it, so a decision
 * taken from a stale read cannot be applied — which is what makes two API
 * replicas and two workers safe without a distributed lock. And no method here
 * touches a table outside `media_`; what another domain owns, another domain
 * writes.
 */

export type MediaDatabase = DatabaseHandle;
export type MediaExecutor = Executor;

/** The facts inspection derived, recorded together or not at all. */
export interface MediaInspectionFacts {
  readonly byteSize: number;
  readonly detectedFormat: MediaImageFormat;
  readonly digest: string;
  readonly frameCount: number;
  readonly height: number;
  readonly width: number;
}

export class MediaRepository {
  constructor(private readonly database: MediaDatabase) {}

  get transactionless(): MediaDatabase {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Creates an asset, or returns the one this operation identity already made.
   *
   * The conflict is resolved by the database rather than by a read followed by
   * an insert, so fifty simultaneous initiations of the same operation produce
   * one asset and forty-nine reads of it. `onConflictDoNothing` returns no row
   * on collision, which is the signal to go and fetch the winner.
   */
  async createAsset(
    executor: MediaExecutor,
    input: {
      readonly assetClass: MediaAssetClass;
      readonly id: string;
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly ownerDomain: MediaOwnerDomain;
      readonly ownerReference: string;
    },
  ): Promise<{ readonly asset: MediaAssetRow; readonly created: boolean }> {
    const [inserted] = await executor
      .insert(mediaAssets)
      .values({
        assetClass: input.assetClass,
        createdAt: input.now,
        id: input.id,
        idempotencyKey: input.idempotencyKey,
        lifecycle: 'initiated',
        lifecycleChangedAt: input.now,
        ownerDomain: input.ownerDomain,
        ownerReference: input.ownerReference,
        updatedAt: input.now,
      })
      .onConflictDoNothing({
        target: [
          mediaAssets.ownerDomain,
          mediaAssets.ownerReference,
          mediaAssets.idempotencyKey,
        ],
      })
      .returning();
    if (inserted !== undefined) return { asset: inserted, created: true };

    const existing = await this.findAssetByIdempotency(executor, {
      idempotencyKey: input.idempotencyKey,
      ownerDomain: input.ownerDomain,
      ownerReference: input.ownerReference,
    });
    if (existing === undefined) {
      // The unique index refused the insert and the row is not there to read.
      // That is not a state the schema permits, so it is raised rather than
      // papered over with a retry that would hide a real defect.
      throw new Error('Media asset conflict resolved to no row');
    }
    return { asset: existing, created: false };
  }

  findAsset(
    executor: MediaExecutor,
    assetId: string,
  ): Promise<MediaAssetRow | undefined> {
    return executor
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1)
      .then(([row]) => row);
  }

  /**
   * Reads an asset only if it belongs to the caller.
   *
   * Ownership is part of the predicate rather than a check on the result,
   * because a method that returns the row and expects its caller to compare is
   * a method somebody eventually calls without comparing.
   */
  findOwnedAsset(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly ownerDomain: MediaOwnerDomain;
      readonly ownerReference: string;
    },
  ): Promise<MediaAssetRow | undefined> {
    return executor
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, input.assetId),
          eq(mediaAssets.ownerDomain, input.ownerDomain),
          eq(mediaAssets.ownerReference, input.ownerReference),
        ),
      )
      .limit(1)
      .then(([row]) => row);
  }

  findAssetByIdempotency(
    executor: MediaExecutor,
    input: {
      readonly idempotencyKey: string;
      readonly ownerDomain: MediaOwnerDomain;
      readonly ownerReference: string;
    },
  ): Promise<MediaAssetRow | undefined> {
    return executor
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.idempotencyKey, input.idempotencyKey),
          eq(mediaAssets.ownerDomain, input.ownerDomain),
          eq(mediaAssets.ownerReference, input.ownerReference),
        ),
      )
      .limit(1)
      .then(([row]) => row);
  }

  /**
   * Advances an asset's lifecycle.
   *
   * The expected current state is in the `where` clause, so a transition taken
   * from a stale read updates nothing and returns `undefined` rather than
   * overwriting whatever actually happened in between. The version is bumped in
   * the same statement, which is what makes "who won" answerable afterwards.
   *
   * The order of states is checked here; the shape of each state is checked by
   * the database. Neither is sufficient alone: this stops `quarantined` from
   * becoming `ready`, and the constraints stop `ready` from existing without
   * the measurements that justify it.
   */
  async transitionAsset(
    executor: MediaExecutor,
    input: {
      readonly deletedAt?: Date;
      readonly deletionRequestedAt?: Date;
      readonly expectedLifecycle: MediaAssetLifecycle;
      readonly facts?: MediaInspectionFacts;
      readonly assetId: string;
      readonly lifecycle: MediaAssetLifecycle;
      readonly now: Date;
      readonly readyAt?: Date;
      readonly rejectionReason?: MediaRejectionReason;
    },
  ): Promise<MediaAssetRow | undefined> {
    if (!mediaTransitionAllowed(input.expectedLifecycle, input.lifecycle)) {
      throw new InvalidMediaTransitionError(
        input.expectedLifecycle,
        input.lifecycle,
      );
    }
    const [row] = await executor
      .update(mediaAssets)
      .set({
        ...(input.facts === undefined
          ? {}
          : {
              byteSize: input.facts.byteSize,
              detectedFormat: input.facts.detectedFormat,
              digest: input.facts.digest,
              frameCount: input.facts.frameCount,
              height: input.facts.height,
              width: input.facts.width,
            }),
        ...(input.deletedAt === undefined
          ? {}
          : { deletedAt: input.deletedAt }),
        ...(input.deletionRequestedAt === undefined
          ? {}
          : { deletionRequestedAt: input.deletionRequestedAt }),
        ...(input.readyAt === undefined ? {} : { readyAt: input.readyAt }),
        ...(input.rejectionReason === undefined
          ? {}
          : { rejectionReason: input.rejectionReason }),
        lifecycle: input.lifecycle,
        lifecycleChangedAt: input.now,
        updatedAt: input.now,
        version: sql`${mediaAssets.version} + 1`,
      })
      .where(
        and(
          eq(mediaAssets.id, input.assetId),
          eq(mediaAssets.lifecycle, input.expectedLifecycle),
        ),
      )
      .returning();
    return row;
  }

  /**
   * Serializes work on one asset's upload window.
   *
   * `insertUploadSession` writes a row carrying two unique indexes — the global
   * object key and the partial one-open-window-per-asset — and
   * `lockIdempotentOperation` explains why that is a hazard: `on conflict do
   * nothing` arbitrates one index, and two writers that pass the arbiter's
   * check in the same instant collide on the *other* one as a raised `23505`
   * rather than a skipped insert. That would surface as a failed request for
   * what is only a double submission, and precisely when the machine is busy.
   *
   * **Ordering rule: take this before any row lock**, matching the rule that
   * file states, so the two compose and the wait graph stays acyclic.
   */
  lockAssetUpload(executor: TransactionHandle, assetId: string): Promise<void> {
    return lockIdempotentOperation(executor, 'media_upload_sessions', assetId);
  }

  insertUploadSession(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly attempt: number;
      readonly expiresAt: Date;
      readonly id: string;
      readonly maximumBytes: number;
      readonly now: Date;
      readonly objectKey: string;
    },
  ): Promise<MediaUploadSessionRow | undefined> {
    return (
      executor
        .insert(mediaUploadSessions)
        .values({
          assetId: input.assetId,
          attempt: input.attempt,
          createdAt: input.now,
          expiresAt: input.expiresAt,
          id: input.id,
          maximumBytes: input.maximumBytes,
          objectKey: input.objectKey,
          state: 'issued',
          updatedAt: input.now,
        })
        // A second open window for one asset is refused by the partial unique
        // index. Doing nothing rather than raising lets the caller treat it as
        // the retry it almost always is.
        .onConflictDoNothing()
        .returning()
        .then(([row]) => row)
    );
  }

  /**
   * Records the capability the provider issued.
   *
   * Separate from the insert because the provider call happens outside every
   * transaction. A crash between the two leaves a session with no capability,
   * which reconciliation can see and resolve; holding a transaction open across
   * a network call to avoid that would trade a recoverable state for a pool
   * exhaustion.
   */
  recordUploadCapability(
    executor: MediaExecutor,
    input: {
      readonly now: Date;
      readonly provider: string;
      readonly providerReference: string;
      readonly sessionId: string;
    },
  ): Promise<MediaUploadSessionRow | undefined> {
    return executor
      .update(mediaUploadSessions)
      .set({
        provider: input.provider,
        providerReference: input.providerReference,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(mediaUploadSessions.id, input.sessionId),
          eq(mediaUploadSessions.state, 'issued'),
        ),
      )
      .returning()
      .then(([row]) => row);
  }

  findOpenUploadSession(
    executor: MediaExecutor,
    assetId: string,
  ): Promise<MediaUploadSessionRow | undefined> {
    return executor
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, assetId),
          eq(mediaUploadSessions.state, 'issued'),
        ),
      )
      .limit(1)
      .then(([row]) => row);
  }

  closeUploadSession(
    executor: MediaExecutor,
    input: {
      readonly now: Date;
      readonly sessionId: string;
      readonly state: 'abandoned' | 'completed' | 'expired';
    },
  ): Promise<MediaUploadSessionRow | undefined> {
    return executor
      .update(mediaUploadSessions)
      .set({
        ...(input.state === 'completed' ? { completedAt: input.now } : {}),
        state: input.state,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(mediaUploadSessions.id, input.sessionId),
          eq(mediaUploadSessions.state, 'issued'),
        ),
      )
      .returning()
      .then(([row]) => row);
  }

  /**
   * The next batch of upload windows whose instant has passed.
   *
   * Bounded and served by the partial expiry index, so a backlog drains over
   * several cycles instead of one statement holding a transaction open across
   * every session the platform ever issued. The closing update re-checks the
   * state, so two replicas sweeping at once close each row once between them
   * rather than fighting over it.
   */
  claimExpiredUploadSessions(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly MediaUploadSessionRow[]> {
    return this.database.transaction(async (executor) => {
      // `for update skip locked` rather than a bare subselect. Without it two
      // sweeps take the same identifiers, the second blocks on the first's row
      // locks, and then updates rows the first has already closed — so both
      // report having closed them. Measured: two concurrent sweeps over three
      // expired windows returned three rows each.
      const claimable = await executor
        .select({ id: mediaUploadSessions.id })
        .from(mediaUploadSessions)
        .where(
          and(
            eq(mediaUploadSessions.state, 'issued'),
            lte(mediaUploadSessions.expiresAt, input.now),
          ),
        )
        .orderBy(
          asc(mediaUploadSessions.expiresAt),
          asc(mediaUploadSessions.id),
        )
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (claimable.length === 0) return [];

      return executor
        .update(mediaUploadSessions)
        .set({ state: 'expired', updatedAt: input.now })
        .where(
          and(
            // The state predicate belongs in the outer statement too, not only
            // in the selection. It is what makes this correct even where a row
            // was not skipped: PostgreSQL re-evaluates it against the updated
            // row after waiting, and a window somebody else already closed no
            // longer matches.
            eq(mediaUploadSessions.state, 'issued'),
            inArray(
              mediaUploadSessions.id,
              claimable.map((row) => row.id),
            ),
          ),
        )
        .returning();
    });
  }

  /**
   * The most recent window on an asset, open or not.
   *
   * Attempt numbering counts every window an asset ever had, so it has to look
   * past the open one — which, by the time a reissue runs, is usually closed.
   */
  findLatestUploadSession(
    executor: MediaExecutor,
    assetId: string,
  ): Promise<MediaUploadSessionRow | undefined> {
    return executor
      .select()
      .from(mediaUploadSessions)
      .where(eq(mediaUploadSessions.assetId, assetId))
      .orderBy(desc(mediaUploadSessions.attempt))
      .limit(1)
      .then(([row]) => row);
  }

  /**
   * Assets that were reserved, never received bytes, and have gone quiet.
   *
   * "Quiet" is deliberately measured from the last lifecycle change rather than
   * from creation, so an asset whose window was reissued an hour ago is not
   * swept while somebody is still trying. Rows with an open window are excluded
   * outright: a live capability is somebody's upload in progress.
   */
  findAbandonedAssets(
    executor: MediaExecutor,
    input: { readonly before: Date; readonly limit: number },
  ): Promise<readonly MediaAssetRow[]> {
    const openSessions = executor
      .select({ assetId: mediaUploadSessions.assetId })
      .from(mediaUploadSessions)
      .where(eq(mediaUploadSessions.state, 'issued'));
    return executor
      .select()
      .from(mediaAssets)
      .where(
        and(
          inArray(mediaAssets.lifecycle, ['initiated', 'awaiting_upload']),
          lte(mediaAssets.lifecycleChangedAt, input.before),
          notInArray(mediaAssets.id, openSessions),
        ),
      )
      .orderBy(asc(mediaAssets.lifecycleChangedAt), asc(mediaAssets.id))
      .limit(input.limit);
  }

  /**
   * Upload sessions the platform committed and never got a capability for.
   *
   * This is the crash window made visible: the rows commit, then the provider
   * is called outside the transaction, and a process that dies between the two
   * leaves exactly this shape. It is recoverable rather than orphaned, which is
   * the whole reason the capability is a second write.
   */
  findUncapabilitiedSessions(
    executor: MediaExecutor,
    input: { readonly limit: number },
  ): Promise<readonly MediaUploadSessionRow[]> {
    return executor
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.state, 'issued'),
          isNull(mediaUploadSessions.providerReference),
        ),
      )
      .orderBy(asc(mediaUploadSessions.createdAt), asc(mediaUploadSessions.id))
      .limit(input.limit);
  }

  /**
   * Records an object the provider holds.
   *
   * Uniqueness of an original per asset and of a variant per kind per
   * processing version is the database's, so concurrent writers converge on one
   * row instead of producing two durable truths for the same bytes.
   */
  insertObject(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly byteSize?: number;
      readonly digest?: string;
      readonly format?: MediaImageFormat;
      readonly height?: number;
      readonly id: string;
      readonly now: Date;
      readonly objectKey: string;
      readonly processingVersion?: number;
      readonly provider: string;
      readonly role: MediaObjectRole;
      readonly variantKind?: MediaVariantKind;
      readonly width?: number;
    },
  ): Promise<MediaObjectRow | undefined> {
    return executor
      .insert(mediaObjects)
      .values({
        assetId: input.assetId,
        byteSize: input.byteSize ?? null,
        createdAt: input.now,
        digest: input.digest ?? null,
        format: input.format ?? null,
        height: input.height ?? null,
        id: input.id,
        objectKey: input.objectKey,
        processingVersion: input.processingVersion ?? null,
        provider: input.provider,
        role: input.role,
        state: 'present',
        updatedAt: input.now,
        variantKind: input.variantKind ?? null,
        width: input.width ?? null,
      })
      .onConflictDoNothing()
      .returning()
      .then(([row]) => row);
  }

  listObjects(
    executor: MediaExecutor,
    assetId: string,
  ): Promise<readonly MediaObjectRow[]> {
    return executor
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.assetId, assetId));
  }

  markObjectState(
    executor: MediaExecutor,
    input: {
      readonly deletedAt?: Date;
      readonly now: Date;
      readonly objectId: string;
      readonly state: 'deleted' | 'deleting';
    },
  ): Promise<MediaObjectRow | undefined> {
    return executor
      .update(mediaObjects)
      .set({
        ...(input.state === 'deleted'
          ? { deletedAt: input.deletedAt ?? input.now }
          : {}),
        state: input.state,
        updatedAt: input.now,
      })
      .where(eq(mediaObjects.id, input.objectId))
      .returning()
      .then(([row]) => row);
  }

  /**
   * Records work the platform owes.
   *
   * Appending is idempotent by intent: an outstanding obligation of the same
   * kind against the same target is the same duty, and creating a second row
   * would mean discharging it twice. The partial unique indexes decide that,
   * not a read.
   */
  appendObligation(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly availableAt?: Date;
      readonly id: string;
      readonly kind: MediaObligationKind;
      readonly now: Date;
      readonly objectId?: string;
    },
  ): Promise<MediaObligationRow | undefined> {
    return executor
      .insert(mediaObligations)
      .values({
        assetId: input.assetId,
        availableAt: input.availableAt ?? input.now,
        createdAt: input.now,
        id: input.id,
        kind: input.kind,
        objectId: input.objectId ?? null,
        state: 'pending',
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning()
      .then(([row]) => row);
  }

  listObligations(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly kinds?: readonly MediaObligationKind[];
    },
  ): Promise<readonly MediaObligationRow[]> {
    return executor
      .select()
      .from(mediaObligations)
      .where(
        input.kinds === undefined
          ? eq(mediaObligations.assetId, input.assetId)
          : and(
              eq(mediaObligations.assetId, input.assetId),
              inArray(mediaObligations.kind, [...input.kinds]),
            ),
      );
  }
}

export class InvalidMediaTransitionError extends Error {
  constructor(
    readonly from: MediaAssetLifecycle,
    readonly to: MediaAssetLifecycle,
  ) {
    super(`Media lifecycle cannot go from ${from} to ${to}`);
    this.name = 'InvalidMediaTransitionError';
  }
}
