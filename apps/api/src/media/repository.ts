import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
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
  mediaDriftFindings,
  mediaObjects,
  mediaObligations,
  mediaUploadSessions,
  type MediaAssetRow,
  type MediaDriftFindingRow,
  type MediaObjectRow,
  type MediaObligationRow,
  type MediaUploadSessionRow,
} from './schema.js';
import {
  mediaTransitionAllowed,
  type MediaAssetClass,
  type MediaAssetLifecycle,
  type MediaDriftKind,
  type MediaDriftResolution,
  type MediaImageFormat,
  type MediaObjectRole,
  type MediaObligationKind,
  type MediaOwnerDomain,
  type MediaPurgeRecord,
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

  /** Several assets by identifier, for the batched readiness projection. */
  listAssets(
    executor: MediaExecutor,
    assetIds: readonly string[],
  ): Promise<readonly MediaAssetRow[]> {
    if (assetIds.length === 0) return Promise.resolve([]);
    return executor
      .select()
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, [...assetIds]));
  }

  /** The open upload window of each named asset, where one is still open. */
  listOpenUploadSessions(
    executor: MediaExecutor,
    assetIds: readonly string[],
  ): Promise<readonly MediaUploadSessionRow[]> {
    if (assetIds.length === 0) return Promise.resolve([]);
    return executor
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          inArray(mediaUploadSessions.assetId, [...assetIds]),
          eq(mediaUploadSessions.state, 'issued'),
        ),
      );
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
    return executor
      .select()
      .from(mediaAssets)
      .where(
        and(
          inArray(mediaAssets.lifecycle, ['initiated', 'awaiting_upload']),
          lte(mediaAssets.lifecycleChangedAt, input.before),
          // A correlated anti-join rather than `not in (select ...)`. The two
          // read the same but cost differently at size: `not in` builds a hash
          // of *every* open window before it can reject one candidate, so the
          // sweep's cost grew with how many uploads were in flight. This probes
          // the one-open-window index once per candidate instead, so the cost
          // is the batch. Measured at two hundred thousand open windows: five
          // thousand five hundred and six buffers before, four hundred after.
          notExists(
            executor
              .select({ present: sql`1` })
              .from(mediaUploadSessions)
              .where(
                and(
                  eq(mediaUploadSessions.assetId, mediaAssets.id),
                  eq(mediaUploadSessions.state, 'issued'),
                ),
              ),
          ),
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
        // The row is written either just after the provider was observed to
        // hold the object or just before the platform writes it, so this
        // instant is a real observation rather than a placeholder — and the
        // audit's grace period is what keeps the second case honest.
        verifiedAt: input.now,
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

  /**
   * Takes the next obligations of one kind under a lease.
   *
   * The same claim the outbox relay uses, for the same reasons. `for update
   * skip locked` means a second worker takes different rows instead of waiting
   * for the first; the state and lease predicates appear in the outer statement
   * as well, so a row somebody else already claimed cannot be claimed again
   * even where it was not skipped.
   *
   * A lease is a database fact rather than a memory one, which is the whole
   * reason a worker can die mid-effect without the duty dying with it: the
   * lease expires and the next cycle picks the row up.
   */
  claimObligations(input: {
    readonly kind: MediaObligationKind;
    readonly leaseMilliseconds: number;
    readonly limit: number;
    readonly now: Date;
    readonly owner: string;
  }): Promise<readonly MediaObligationRow[]> {
    const leaseExpiresAt = new Date(
      input.now.getTime() + input.leaseMilliseconds,
    );
    return this.database.transaction(async (executor) => {
      const claimable = await executor
        .select({ id: mediaObligations.id })
        .from(mediaObligations)
        .where(
          and(
            eq(mediaObligations.kind, input.kind),
            eq(mediaObligations.state, 'pending'),
            lte(mediaObligations.availableAt, input.now),
            or(
              isNull(mediaObligations.leaseExpiresAt),
              lte(mediaObligations.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(asc(mediaObligations.sequence))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (claimable.length === 0) return [];

      return executor
        .update(mediaObligations)
        .set({
          leaseExpiresAt,
          leaseOwner: input.owner,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(mediaObligations.state, 'pending'),
            or(
              isNull(mediaObligations.leaseExpiresAt),
              lte(mediaObligations.leaseExpiresAt, input.now),
            ),
            inArray(
              mediaObligations.id,
              claimable.map((row) => row.id),
            ),
          ),
        )
        .returning();
    });
  }

  /**
   * Discharges an obligation.
   *
   * The lease owner is part of the predicate, so a worker whose lease expired
   * while it was working — and whose row another worker has since taken —
   * cannot report completion on top of the new owner's claim.
   */
  completeObligation(
    executor: MediaExecutor,
    input: {
      readonly now: Date;
      readonly obligationId: string;
      readonly owner: string;
    },
  ): Promise<MediaObligationRow | undefined> {
    return executor
      .update(mediaObligations)
      .set({
        completedAt: input.now,
        leaseExpiresAt: null,
        leaseOwner: null,
        state: 'completed',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(mediaObligations.id, input.obligationId),
          eq(mediaObligations.leaseOwner, input.owner),
          eq(mediaObligations.state, 'pending'),
        ),
      )
      .returning()
      .then(([row]) => row);
  }

  /**
   * Records a failed attempt and either defers it or gives up on it.
   *
   * Giving up is `dead_letter`, retained rather than deleted: a duty the
   * platform could not discharge is evidence and stays a visible operational
   * obligation. `failureReason` is a short code the caller chose, never a
   * provider message and never a fragment of content.
   */
  failObligation(
    executor: MediaExecutor,
    input: {
      readonly backoffMilliseconds: number;
      readonly failureReason: string;
      readonly maximumAttempts: number;
      readonly now: Date;
      readonly obligationId: string;
      readonly owner: string;
    },
  ): Promise<MediaObligationRow | undefined> {
    const exhausted = sql`${mediaObligations.attempts} + 1 >= ${input.maximumAttempts}`;
    return executor
      .update(mediaObligations)
      .set({
        attempts: sql`${mediaObligations.attempts} + 1`,
        availableAt: sql`case when ${exhausted} then ${mediaObligations.availableAt} else ${new Date(input.now.getTime() + input.backoffMilliseconds)} end`,
        failureReason: input.failureReason,
        leaseExpiresAt: null,
        leaseOwner: null,
        state: sql`case when ${exhausted} then 'dead_letter' else 'pending' end`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(mediaObligations.id, input.obligationId),
          eq(mediaObligations.leaseOwner, input.owner),
          eq(mediaObligations.state, 'pending'),
        ),
      )
      .returning()
      .then(([row]) => row);
  }

  /** Records what the delivery layer said when asked to forget an address. */
  recordPurgeOutcome(
    executor: MediaExecutor,
    input: {
      readonly now: Date;
      readonly objectId: string;
      readonly outcome: MediaPurgeRecord;
    },
  ): Promise<MediaObjectRow | undefined> {
    return executor
      .update(mediaObjects)
      .set({
        purgeOutcome: input.outcome,
        purgedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(mediaObjects.id, input.objectId))
      .returning()
      .then(([row]) => row);
  }

  /** Marks that a purge has been asked for, before anybody asks a provider. */
  markPurgeRequested(
    executor: MediaExecutor,
    input: { readonly now: Date; readonly objectId: string },
  ): Promise<void> {
    return executor
      .update(mediaObjects)
      .set({ purgeRequestedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(mediaObjects.id, input.objectId),
          isNull(mediaObjects.purgeRequestedAt),
        ),
      )
      .then(() => undefined);
  }

  /** Places or lifts a legal hold. Independent of whether delivery is denied. */
  setLegalHold(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly held: boolean;
      readonly now: Date;
    },
  ): Promise<MediaAssetRow | undefined> {
    return executor
      .update(mediaAssets)
      .set({
        legalHoldAt: input.held ? input.now : null,
        updatedAt: input.now,
      })
      .where(eq(mediaAssets.id, input.assetId))
      .returning()
      .then(([row]) => row);
  }

  /** One object by identifier, for an obligation that names one. */
  findObject(
    executor: MediaExecutor,
    objectId: string,
  ): Promise<MediaObjectRow | undefined> {
    return executor
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, objectId))
      .limit(1)
      .then(([row]) => row);
  }

  /** Records what inspection measured about the stored object itself. */
  recordObjectFacts(
    executor: MediaExecutor,
    input: {
      readonly byteSize: number;
      readonly digest: string;
      readonly format: MediaImageFormat;
      readonly height: number;
      readonly now: Date;
      readonly objectId: string;
      readonly width: number;
    },
  ): Promise<MediaObjectRow | undefined> {
    return executor
      .update(mediaObjects)
      .set({
        byteSize: input.byteSize,
        digest: input.digest,
        format: input.format,
        height: input.height,
        updatedAt: input.now,
        width: input.width,
      })
      .where(eq(mediaObjects.id, input.objectId))
      .returning()
      .then(([row]) => row);
  }

  /** One derivative of one asset, at one processing version. */
  findVariant(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly processingVersion: number;
      readonly variantKind: MediaVariantKind;
    },
  ): Promise<MediaObjectRow | undefined> {
    return executor
      .select()
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.assetId, input.assetId),
          eq(mediaObjects.role, 'variant'),
          eq(mediaObjects.variantKind, input.variantKind),
          eq(mediaObjects.processingVersion, input.processingVersion),
        ),
      )
      .limit(1)
      .then(([row]) => row);
  }

  /** The asset's original object, if one has been recorded. */
  findOriginalObject(
    executor: MediaExecutor,
    assetId: string,
  ): Promise<MediaObjectRow | undefined> {
    return executor
      .select()
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.assetId, assetId),
          eq(mediaObjects.role, 'original'),
        ),
      )
      .limit(1)
      .then(([row]) => row);
  }

  /**
   * The next closed upload windows nobody has checked for orphaned bytes.
   *
   * A closed window is the one place bytes can exist that no object record
   * claims: a capability honoured late, or a client that finished uploading and
   * never told the platform. The claim marks them checked in the same statement
   * that takes them, so two workers audit different windows rather than both
   * calling the provider about the same one.
   *
   * Served by the partial index, which holds only windows still owing a look —
   * so this costs the same on a platform with ten million spent windows as on
   * one with ten.
   */
  claimClosedSessionsForAudit(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly MediaUploadSessionRow[]> {
    return this.database.transaction(async (executor) => {
      const claimable = await executor
        .select({ id: mediaUploadSessions.id })
        .from(mediaUploadSessions)
        .where(
          and(
            inArray(mediaUploadSessions.state, ['abandoned', 'expired']),
            isNull(mediaUploadSessions.reconciledAt),
          ),
        )
        .orderBy(
          asc(mediaUploadSessions.createdAt),
          asc(mediaUploadSessions.id),
        )
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (claimable.length === 0) return [];

      return executor
        .update(mediaUploadSessions)
        .set({ reconciledAt: input.now, updatedAt: input.now })
        .where(
          and(
            // Re-checked in the outer statement, for the same reason the expiry
            // sweep re-checks its state: a row that was not skipped may have
            // been claimed by somebody else while this one waited.
            isNull(mediaUploadSessions.reconciledAt),
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
   * Puts a claimed window back, because the provider never answered.
   *
   * A cursor that moved on a call that failed is a check nobody will ever make
   * again, and the thing it would have found is bytes at a key no record
   * claims. Releasing it costs one statement and is the difference between a
   * transient provider failure delaying an audit and permanently skipping one.
   */
  async releaseSessionAudit(
    executor: MediaExecutor,
    sessionId: string,
  ): Promise<void> {
    await executor
      .update(mediaUploadSessions)
      .set({ reconciledAt: null })
      .where(eq(mediaUploadSessions.id, sessionId));
  }

  /** Whether any object record claims this key. Answers "is this an orphan". */
  async objectExistsForKey(
    executor: MediaExecutor,
    objectKey: string,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(eq(mediaObjects.objectKey, objectKey))
      .limit(1);
    return row !== undefined;
  }

  /**
   * The next objects due a check against the provider.
   *
   * A rolling audit rather than a periodic pass: least recently verified first,
   * bounded, and the instant is advanced by the claiming statement so the walk
   * moves on whatever happens next. Every object is therefore revisited within
   * a bounded period, and no cycle reads the whole table.
   *
   * `before` is what keeps the ordinary pipeline out of the results. A variant
   * row is written before its bytes are, deliberately, so an object younger
   * than the grace period may legitimately not be at the provider yet.
   */
  claimObjectsForVerification(input: {
    readonly before: Date;
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly MediaObjectRow[]> {
    return this.database.transaction(async (executor) => {
      const claimable = await executor
        .select({ id: mediaObjects.id })
        .from(mediaObjects)
        .where(lte(mediaObjects.verifiedAt, input.before))
        .orderBy(asc(mediaObjects.verifiedAt), asc(mediaObjects.id))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (claimable.length === 0) return [];

      return executor
        .update(mediaObjects)
        .set({ verifiedAt: input.now })
        .where(
          and(
            lte(mediaObjects.verifiedAt, input.before),
            inArray(
              mediaObjects.id,
              claimable.map((row) => row.id),
            ),
          ),
        )
        .returning();
    });
  }

  /**
   * Assets the platform owes a move and nothing is carrying.
   *
   * Two exclusions, and both stop the same failure — a candidate that can never
   * leave the batch crowding out the ones behind it. An asset whose remedy is
   * already pending is being carried, so it is not stalled. An asset that has
   * already been reported is not reported again until its finding is settled,
   * which is what keeps a stall nobody can repair from occupying a slot every
   * cycle forever.
   *
   * Assets under a legal hold are excluded outright. One sitting in `deleting`
   * is doing exactly what a hold means, and owing it another deletion would
   * discharge against the hold and come straight back.
   */
  listStalledAssets(
    executor: MediaExecutor,
    input: {
      readonly before: Date;
      readonly lifecycles: readonly MediaAssetLifecycle[];
      readonly limit: number;
      readonly remedy: MediaObligationKind;
    },
  ): Promise<readonly MediaAssetRow[]> {
    return executor
      .select()
      .from(mediaAssets)
      .where(
        and(
          inArray(mediaAssets.lifecycle, [...input.lifecycles]),
          lte(mediaAssets.lifecycleChangedAt, input.before),
          isNull(mediaAssets.legalHoldAt),
          // Correlated anti-joins, for the reason the abandonment sweep uses
          // them, and this was by far the worse of the two. As `not in`
          // subqueries these defeated every index on the table and the sweep
          // scanned all four hundred thousand assets every sixty seconds:
          // measured at ten thousand four hundred and forty buffers, against
          // six now. Rewriting alone was not enough — without a narrow index
          // leading on the lifecycle it still scanned — so both halves of that
          // fix are load-bearing and neither is sufficient.
          notExists(
            executor
              .select({ present: sql`1` })
              .from(mediaObligations)
              .where(
                and(
                  eq(mediaObligations.assetId, mediaAssets.id),
                  eq(mediaObligations.kind, input.remedy),
                  eq(mediaObligations.state, 'pending'),
                ),
              ),
          ),
          notExists(
            executor
              .select({ present: sql`1` })
              .from(mediaDriftFindings)
              .where(
                and(
                  eq(mediaDriftFindings.assetId, mediaAssets.id),
                  eq(mediaDriftFindings.kind, 'stalled_lifecycle'),
                  isNull(mediaDriftFindings.resolvedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(mediaAssets.lifecycleChangedAt), asc(mediaAssets.id))
      .limit(input.limit);
  }

  /**
   * Objects whose purge was asked for and never answered.
   *
   * The same two exclusions as the stall query, for the same reason. A purge
   * that is already owed is being carried; one already reported waits for its
   * finding to be settled rather than being rediscovered every cycle.
   */
  listStalePurgeObjects(
    executor: MediaExecutor,
    input: { readonly before: Date; readonly limit: number },
  ): Promise<readonly MediaObjectRow[]> {
    return executor
      .select()
      .from(mediaObjects)
      .where(
        and(
          isNotNull(mediaObjects.purgeRequestedAt),
          isNull(mediaObjects.purgeOutcome),
          lte(mediaObjects.purgeRequestedAt, input.before),
          // Anti-joins here too. This query was already index-driven, because
          // the partial purge-backlog index is selective enough to lead — but
          // the `not in` form would have started hashing every pending purge
          // obligation the moment a backlog existed, which is exactly when this
          // query runs. Consistent with the other two, and free.
          notExists(
            executor
              .select({ present: sql`1` })
              .from(mediaObligations)
              .where(
                and(
                  eq(mediaObligations.objectId, mediaObjects.id),
                  eq(mediaObligations.kind, 'purge'),
                  eq(mediaObligations.state, 'pending'),
                ),
              ),
          ),
          notExists(
            executor
              .select({ present: sql`1` })
              .from(mediaDriftFindings)
              .where(
                and(
                  eq(mediaDriftFindings.objectId, mediaObjects.id),
                  eq(mediaDriftFindings.kind, 'stale_purge'),
                  isNull(mediaDriftFindings.resolvedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(mediaObjects.purgeRequestedAt), asc(mediaObjects.id))
      .limit(input.limit);
  }

  /**
   * Records a disagreement, or notes that an outstanding one is still there.
   *
   * Idempotent by subject rather than by call: a second observation of the same
   * unresolved drift bumps the count and the instant instead of adding a row,
   * so an operator sees one fault observed nine times rather than nine faults.
   * The partial unique indexes settle that, not a read.
   *
   * A finding may be recorded already resolved. That is not a contradiction —
   * some drift is corrected in the act of noticing it, and writing the
   * observation and its outcome together is more honest than a row that was
   * briefly outstanding for the length of a function call.
   */
  async recordDriftFinding(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly id: string;
      readonly kind: MediaDriftKind;
      readonly now: Date;
      readonly objectId?: string;
      readonly objectKey?: string;
      readonly resolution?: MediaDriftResolution;
    },
  ): Promise<{
    readonly finding: MediaDriftFindingRow;
    readonly first: boolean;
  }> {
    const [inserted] = await executor
      .insert(mediaDriftFindings)
      .values({
        assetId: input.assetId,
        createdAt: input.now,
        id: input.id,
        kind: input.kind,
        lastObservedAt: input.now,
        objectId: input.objectId ?? null,
        objectKey: input.objectKey ?? null,
        resolution: input.resolution ?? null,
        resolvedAt: input.resolution === undefined ? null : input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) return { finding: inserted, first: true };

    const [bumped] = await executor
      .update(mediaDriftFindings)
      .set({
        lastObservedAt: input.now,
        occurrences: sql`${mediaDriftFindings.occurrences} + 1`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(mediaDriftFindings.assetId, input.assetId),
          eq(mediaDriftFindings.kind, input.kind),
          isNull(mediaDriftFindings.resolvedAt),
          input.objectKey === undefined
            ? isNull(mediaDriftFindings.objectKey)
            : eq(mediaDriftFindings.objectKey, input.objectKey),
        ),
      )
      .returning();
    if (bumped === undefined) {
      // The insert was refused and the outstanding row is not there to bump.
      // That is not a state the indexes permit, so it is raised rather than
      // papered over.
      throw new Error('Media drift finding conflict resolved to no row');
    }
    return { finding: bumped, first: false };
  }

  /** Every outstanding finding against one asset, oldest first. */
  listOutstandingFindings(
    executor: MediaExecutor,
    input: { readonly assetId: string },
  ): Promise<readonly MediaDriftFindingRow[]> {
    return executor
      .select()
      .from(mediaDriftFindings)
      .where(
        and(
          eq(mediaDriftFindings.assetId, input.assetId),
          isNull(mediaDriftFindings.resolvedAt),
        ),
      )
      .orderBy(asc(mediaDriftFindings.createdAt), asc(mediaDriftFindings.id));
  }

  /**
   * Findings against one asset, resolved or not, newest first.
   *
   * Retained history rather than a backlog. "This asset's derivative went
   * missing twice last month" is a question an operator will ask, and a view
   * that showed only what is currently wrong could not answer it — but the
   * history has no natural bound, so the caller says how much of it it wants
   * and the newest is what explains what is happening now.
   */
  listFindings(
    executor: MediaExecutor,
    input: { readonly assetId: string; readonly limit: number },
  ): Promise<readonly MediaDriftFindingRow[]> {
    return executor
      .select()
      .from(mediaDriftFindings)
      .where(eq(mediaDriftFindings.assetId, input.assetId))
      .orderBy(desc(mediaDriftFindings.createdAt), desc(mediaDriftFindings.id))
      .limit(input.limit);
  }

  /** Closes a finding, saying which of the three things happened to it. */
  resolveDriftFinding(
    executor: MediaExecutor,
    input: {
      readonly findingId: string;
      readonly now: Date;
      readonly resolution: MediaDriftResolution;
    },
  ): Promise<MediaDriftFindingRow | undefined> {
    return executor
      .update(mediaDriftFindings)
      .set({
        resolution: input.resolution,
        resolvedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(mediaDriftFindings.id, input.findingId),
          isNull(mediaDriftFindings.resolvedAt),
        ),
      )
      .returning()
      .then(([row]) => row);
  }

  /** How much drift is still outstanding. The number an operator watches. */
  async countOutstandingFindings(executor: MediaExecutor): Promise<number> {
    const [row] = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(mediaDriftFindings)
      .where(isNull(mediaDriftFindings.resolvedAt));
    return row?.total ?? 0;
  }

  /**
   * Obligations against one asset.
   *
   * Discharged rows are retained, so an old asset accumulates them and an
   * unbounded read here would grow without limit. A caller that wants a bound
   * gives one and gets the newest by claim order; the internal callers that
   * ask about a specific kind want every one of them and say so by omitting it.
   */
  listObligations(
    executor: MediaExecutor,
    input: {
      readonly assetId: string;
      readonly kinds?: readonly MediaObligationKind[];
      readonly limit?: number;
    },
  ): Promise<readonly MediaObligationRow[]> {
    const query = executor
      .select()
      .from(mediaObligations)
      .where(
        input.kinds === undefined
          ? eq(mediaObligations.assetId, input.assetId)
          : and(
              eq(mediaObligations.assetId, input.assetId),
              inArray(mediaObligations.kind, [...input.kinds]),
            ),
      )
      .orderBy(desc(mediaObligations.sequence));
    return input.limit === undefined ? query : query.limit(input.limit);
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
