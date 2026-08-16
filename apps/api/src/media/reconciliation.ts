import type { SafeLogger } from '@velora/observability/server';

import type { MediaImageProcessorPort } from './processing.js';
import type { MediaRepository } from './repository.js';
import type {
  MediaAssetRow,
  MediaDriftFindingRow,
  MediaObjectRow,
} from './schema.js';
import {
  maximumMediaObligationAttempts,
  maximumMediaReadBytes,
  mediaObligationBackoffMilliseconds,
  mediaObligationLeaseMilliseconds,
  mediaPurgeStallMilliseconds,
  mediaReconciliationBatchSize,
  mediaStallMilliseconds,
  mediaStallRemedies,
  mediaVerificationGraceMilliseconds,
  stalledMediaLifecycles,
  type MediaDriftKind,
  type MediaDriftResolution,
  type MediaObligationKind,
  type StalledMediaLifecycle,
} from './policy.js';
import { mediaContentTypes, type MediaStoragePort } from './storage.js';

/**
 * Finding out where the record and the provider stopped agreeing.
 *
 * Every other part of this domain writes the record and the bytes in a fixed
 * order so that a crash leaves a *recoverable* shape rather than an invisible
 * one. This is what goes and looks. It answers one question — does the provider
 * hold what the platform says it holds — and it answers it about a bounded,
 * indexed slice of the platform per cycle rather than about everything.
 *
 * Four rules shape it, and they are the same four the financial reconciler
 * follows because the problem is the same problem.
 *
 * **It reads before it acts.** Nothing is corrected from a finding alone; the
 * repair re-asks the provider, because the ordinary pipeline is running the
 * whole time and usually got there first.
 *
 * **No provider call happens inside a transaction.** Candidates are claimed and
 * the transaction closes; the provider is asked afterwards; a second write
 * records what it said.
 *
 * **Provider state is evidence, never authority over product or safety
 * state.** An object the provider has lost means the *record about the bytes*
 * is wrong. It does not mean a takedown did not happen, it does not lift a
 * hold, and it does not make anything deliverable. The corrections available
 * here are: destroy bytes nothing claims, restore a derivative from an original
 * the platform still has, and owe the ordinary pipeline a duty it will carry
 * out under its own rules. There is deliberately no correction that writes a
 * product conclusion.
 *
 * **What cannot be safely corrected is written down rather than swallowed.** An
 * original the provider has lost is not repairable by anybody, and a sweep that
 * closed that quietly would be worse than one that never looked.
 */

export interface MediaReconciliationReport {
  /** Rows this cycle actually looked at, across every check. */
  readonly examined: number;
  /** Disagreements recorded or re-observed. */
  readonly found: number;
  /** Findings still unresolved when the cycle ended. */
  readonly outstanding: number;
  /** Findings this cycle closed by doing something about them. */
  readonly repaired: number;
}

export interface MediaReconciliationDependencies {
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly processor: MediaImageProcessorPort;
  readonly repository: MediaRepository;
  readonly storage: MediaStoragePort;
}

/**
 * Which lifecycles each remedy covers, derived from the policy table.
 *
 * Inverted from {@link mediaStallRemedies} rather than written out, so a new
 * stallable state cannot be added to the vocabulary and silently left
 * undetected here.
 */
const stallGroups = new Map<MediaObligationKind, StalledMediaLifecycle[]>();
for (const lifecycle of stalledMediaLifecycles) {
  const remedy = mediaStallRemedies[lifecycle];
  stallGroups.set(remedy, [...(stallGroups.get(remedy) ?? []), lifecycle]);
}

function digestOf(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

export class MediaReconciliation {
  constructor(private readonly dependencies: MediaReconciliationDependencies) {}

  /**
   * One cycle.
   *
   * Detection first, repair second, and deliberately not in the same breath: a
   * repair is byte work that must survive the process doing it, so what
   * detection produces is a durable finding and a durable duty, and the repair
   * runs under a lease like every other piece of work in this domain. A worker
   * that dies between the two has lost nothing.
   */
  async reconcileOnce(input: {
    readonly limit?: number;
    readonly owner: string;
  }): Promise<MediaReconciliationReport> {
    const limit = input.limit ?? mediaReconciliationBatchSize;
    const sessions = await this.auditClosedSessions(limit);
    const objects = await this.auditObjects(limit);
    const stalls = await this.recoverStalls(limit);
    const purges = await this.recoverStalePurges(limit);
    const repaired = await this.runRepairs({ limit, owner: input.owner });

    return {
      examined:
        sessions.examined +
        objects.examined +
        stalls.examined +
        purges.examined,
      found: sessions.found + objects.found + stalls.found + purges.found,
      outstanding: await this.dependencies.repository.countOutstandingFindings(
        this.dependencies.repository.transactionless,
      ),
      repaired,
    };
  }

  /**
   * Bytes at a closed upload window's key that no record claims.
   *
   * This is where "the record says nothing arrived but the provider has
   * something" ends up, and deliberately so. While a window is open, bytes at
   * its key are an upload in progress and not drift. Once it has closed with
   * nothing verified, whatever is there was written under an authorization that
   * has lapsed, and the platform will not adopt it — a late capability's bytes
   * are exactly what the reissue rule's fresh key exists to make meaningless.
   * So they are destroyed rather than accepted.
   */
  private async auditClosedSessions(
    limit: number,
  ): Promise<{ readonly examined: number; readonly found: number }> {
    const { repository, storage } = this.dependencies;
    if (storage.name === 'unavailable') return { examined: 0, found: 0 };

    const now = this.dependencies.now();
    const sessions = await repository.claimClosedSessionsForAudit({
      limit,
      now,
    });
    let found = 0;
    for (const session of sessions) {
      try {
        const stat = await storage.statObject(session.objectKey);
        if (stat === undefined) continue;
        // A completed upload's key belongs to an object record, and this claim
        // takes only closed-without-completion windows — but the check is made
        // rather than assumed, because deleting bytes something references
        // would be the worst possible way to be wrong.
        if (
          await repository.objectExistsForKey(
            repository.transactionless,
            session.objectKey,
          )
        ) {
          continue;
        }
        await this.owe({
          assetId: session.assetId,
          kind: 'orphaned_object',
          objectKey: session.objectKey,
        });
        found += 1;
      } catch (error) {
        // The cursor is put back, so this window is looked at again rather than
        // being marked checked by a call that never got an answer. Nothing else
        // in this domain leaves an unexamined orphan behind a moved cursor.
        await repository.releaseSessionAudit(
          repository.transactionless,
          session.id,
        );
        this.dependencies.logger.warn(
          { error },
          'media reconciliation could not read a closed upload window',
        );
      }
    }
    return { examined: sessions.length, found };
  }

  /**
   * Objects the record and the provider may have stopped agreeing about.
   *
   * A rolling audit: least recently verified first, bounded, and the cursor
   * moves whatever the answer is, so every object is revisited within a bounded
   * period and no cycle reads the whole table. Objects younger than the grace
   * period are not examined at all — a variant's row is written before its
   * bytes are, on purpose, and reporting that window as drift would be
   * reporting the pipeline's own correct ordering.
   */
  private async auditObjects(
    limit: number,
  ): Promise<{ readonly examined: number; readonly found: number }> {
    const { repository, storage } = this.dependencies;
    if (storage.name === 'unavailable') return { examined: 0, found: 0 };

    const now = this.dependencies.now();
    const objects = await repository.claimObjectsForVerification({
      before: new Date(now.getTime() - mediaVerificationGraceMilliseconds),
      limit,
      now,
    });
    let found = 0;
    for (const object of objects) {
      // Mid-removal. Absent is what it is trying to become, and present is what
      // it still is; neither is a disagreement while the deletion is running.
      if (object.state === 'deleting') continue;
      try {
        const kind = await this.classify(object);
        if (kind === undefined) continue;
        await this.owe({
          assetId: object.assetId,
          kind,
          objectId: object.id,
          objectKey: object.objectKey,
        });
        found += 1;
      } catch (error) {
        // The cursor has moved and this object simply comes round again. A
        // provider that is refusing every read would otherwise have this cycle
        // record a fault against every object it holds.
        this.dependencies.logger.warn(
          { error },
          'media reconciliation could not read a stored object',
        );
      }
    }
    return { examined: objects.length, found };
  }

  /** What, if anything, the provider disagrees with about one object. */
  private async classify(
    object: MediaObjectRow,
  ): Promise<MediaDriftKind | undefined> {
    const stat = await this.dependencies.storage.statObject(object.objectKey);
    if (object.state === 'deleted') {
      // The record says these bytes are gone and they are not. Whatever removed
      // them was interrupted, and until they are actually gone the removal has
      // not happened however the row reads.
      return stat === undefined ? undefined : 'undeleted_object';
    }
    if (stat === undefined) {
      return object.role === 'original'
        ? 'original_missing'
        : 'variant_missing';
    }
    // Only ever compared against a size the platform measured itself. A row
    // whose size has not been recorded yet has nothing to disagree with.
    if (object.byteSize !== null && object.byteSize !== stat.byteSize) {
      return object.role === 'original'
        ? 'original_size_mismatch'
        : 'variant_size_mismatch';
    }
    return undefined;
  }

  /**
   * Assets the platform owes a move and nothing is carrying.
   *
   * The correction is to owe the ordinary duty again, never to perform it here.
   * That matters more than it looks: the inspection path knows to quarantine an
   * object whose bytes have vanished, and the processing path knows the same,
   * so re-owing the duty gets the *right* conclusion rather than a
   * reconciler's guess at one.
   *
   * A remedy that has already been given up on is not resurrected. Owing it
   * again would reset its attempts and it would dead-letter again, forever, one
   * cycle at a time. It is recorded as outstanding instead, which is the honest
   * description of a duty the platform could not discharge.
   */
  private async recoverStalls(
    limit: number,
  ): Promise<{ readonly examined: number; readonly found: number }> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const before = new Date(now.getTime() - mediaStallMilliseconds);
    let examined = 0;
    let found = 0;

    for (const [remedy, lifecycles] of stallGroups) {
      const stalled = await repository.listStalledAssets(
        repository.transactionless,
        { before, lifecycles, limit, remedy },
      );
      examined += stalled.length;
      for (const asset of stalled) {
        const abandoned = (
          await repository.listObligations(repository.transactionless, {
            assetId: asset.id,
            kinds: [remedy],
          })
        ).some((obligation) => obligation.state === 'dead_letter');
        await repository.transaction(async (executor) => {
          if (!abandoned) {
            await repository.appendObligation(executor, {
              assetId: asset.id,
              id: crypto.randomUUID(),
              kind: remedy,
              now,
            });
          }
          await repository.recordDriftFinding(executor, {
            assetId: asset.id,
            id: crypto.randomUUID(),
            kind: 'stalled_lifecycle',
            now,
            // Owing the duty *is* the repair, so the observation and its
            // outcome are written together. A stall nobody can remedy stays
            // outstanding, which is what keeps it visible.
            ...(abandoned ? {} : { resolution: 'owed' as const }),
          });
        });
        found += 1;
      }
    }
    return { examined, found };
  }

  /** Purges asked for long ago that no delivery layer ever answered. */
  private async recoverStalePurges(
    limit: number,
  ): Promise<{ readonly examined: number; readonly found: number }> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const stale = await repository.listStalePurgeObjects(
      repository.transactionless,
      { before: new Date(now.getTime() - mediaPurgeStallMilliseconds), limit },
    );

    let found = 0;
    for (const object of stale) {
      const abandoned = (
        await repository.listObligations(repository.transactionless, {
          assetId: object.assetId,
          kinds: ['purge'],
        })
      ).some(
        (obligation) =>
          obligation.objectId === object.id &&
          obligation.state === 'dead_letter',
      );
      await repository.transaction(async (executor) => {
        if (!abandoned) {
          await repository.appendObligation(executor, {
            assetId: object.assetId,
            id: crypto.randomUUID(),
            kind: 'purge',
            now,
            objectId: object.id,
          });
        }
        await repository.recordDriftFinding(executor, {
          assetId: object.assetId,
          id: crypto.randomUUID(),
          kind: 'stale_purge',
          now,
          objectId: object.id,
          objectKey: object.objectKey,
          ...(abandoned ? {} : { resolution: 'owed' as const }),
        });
      });
      found += 1;
    }
    return { examined: stale.length, found };
  }

  /**
   * Records a disagreement and the duty to do something about it, together.
   *
   * One transaction, for the same reason every other obligation in this domain
   * is written by the transaction that justified it: a process that dies here
   * has lost a queue message and not the duty.
   *
   * The duty is owed on the **first** observation only. A repeat means the
   * repair already ran and left the finding outstanding, which is this
   * component's way of saying there is nothing safe to do — and owing the same
   * fruitless duty once per audit round for the life of the asset would turn a
   * fault nobody can fix into an unbounded pile of discharged obligations. A
   * repair that genuinely fails is a different case and is already covered:
   * that obligation stays pending, backs off, and dead-letters as retained
   * evidence.
   */
  private async owe(input: {
    readonly assetId: string;
    readonly kind: MediaDriftKind;
    readonly objectId?: string;
    readonly objectKey: string;
  }): Promise<void> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    await repository.transaction(async (executor) => {
      const { first } = await repository.recordDriftFinding(executor, {
        assetId: input.assetId,
        id: crypto.randomUUID(),
        kind: input.kind,
        now,
        ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
        objectKey: input.objectKey,
      });
      if (!first) return;
      await repository.appendObligation(executor, {
        assetId: input.assetId,
        id: crypto.randomUUID(),
        kind: 'reconcile',
        now,
      });
    });
  }

  /**
   * Claims reconciliation duties and repairs what can be repaired.
   *
   * Leased, bounded, and attempt-limited like every other obligation, which is
   * what makes a repair survive the worker performing it. Each finding is
   * re-verified before anything is done, so a disagreement the ordinary
   * pipeline has already settled costs one provider read and closes.
   */
  private async runRepairs(input: {
    readonly limit: number;
    readonly owner: string;
  }): Promise<number> {
    const { repository } = this.dependencies;
    const claimed = await repository.claimObligations({
      kind: 'reconcile',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: input.limit,
      now: this.dependencies.now(),
      owner: input.owner,
    });

    let repaired = 0;
    for (const obligation of claimed) {
      try {
        const asset = await repository.findAsset(
          repository.transactionless,
          obligation.assetId,
        );
        if (asset !== undefined) {
          const findings = await repository.listOutstandingFindings(
            repository.transactionless,
            { assetId: asset.id },
          );
          for (const finding of findings) {
            const resolution = await this.repair(asset, finding);
            if (resolution === undefined) continue;
            await repository.resolveDriftFinding(repository.transactionless, {
              findingId: finding.id,
              now: this.dependencies.now(),
              resolution,
            });
            if (resolution === 'repaired') repaired += 1;
          }
        }
        await repository.completeObligation(repository.transactionless, {
          now: this.dependencies.now(),
          obligationId: obligation.id,
          owner: input.owner,
        });
      } catch (error) {
        await repository.failObligation(repository.transactionless, {
          backoffMilliseconds: mediaObligationBackoffMilliseconds,
          failureReason: 'reconciliation_failed',
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
    return repaired;
  }

  /**
   * What to do about one finding, or `undefined` to leave it outstanding.
   *
   * The cases with no entry here are the ones with no safe automatic
   * correction, and their absence is the design rather than an omission: an
   * original the provider has lost cannot be conjured, a size that changed
   * under the platform's feet is not something to overwrite on a guess, and a
   * duty already given up on is an operator's decision.
   */
  private async repair(
    asset: MediaAssetRow,
    finding: MediaDriftFindingRow,
  ): Promise<MediaDriftResolution | undefined> {
    const { repository, storage } = this.dependencies;
    switch (finding.kind) {
      case 'orphaned_object': {
        const objectKey = finding.objectKey;
        if (objectKey === null) return 'no_longer_present';
        // Re-checked, because a completion may have landed since. Adopting the
        // bytes is never on the table; not destroying bytes a record now claims
        // very much is.
        if (
          await repository.objectExistsForKey(
            repository.transactionless,
            objectKey,
          )
        ) {
          return 'no_longer_present';
        }
        if ((await storage.statObject(objectKey)) === undefined) {
          return 'no_longer_present';
        }
        await storage.deleteObject(objectKey);
        return 'repaired';
      }

      case 'undeleted_object': {
        const object = await this.objectOf(finding);
        if (object?.state !== 'deleted') return 'no_longer_present';
        if ((await storage.statObject(object.objectKey)) === undefined) {
          return 'no_longer_present';
        }
        // Idempotent, and the row already says deleted, so there is no state to
        // change — only bytes that outlived the decision to destroy them.
        await storage.deleteObject(object.objectKey);
        return 'repaired';
      }

      case 'variant_missing':
      case 'variant_size_mismatch':
        return this.rebuildVariant(asset, finding);

      case 'original_missing': {
        // The bytes are gone and nothing can invent them. What the platform can
        // do is let the pipeline that knows how to refuse find out: inspection
        // and processing both quarantine an object that is not there, and
        // deletion treats an absent object as deleted. Owing the duty gets the
        // right conclusion recorded by the code that owns it.
        if (!isStallable(asset.lifecycle)) return undefined;
        await repository.appendObligation(repository.transactionless, {
          assetId: asset.id,
          id: crypto.randomUUID(),
          kind: mediaStallRemedies[asset.lifecycle],
          now: this.dependencies.now(),
        });
        return 'owed';
      }

      default:
        return undefined;
    }
  }

  /**
   * Renders a derivative again, into the address the record already names.
   *
   * The same key rather than a new one, which is what makes this a repair and
   * not a second object: the row keeps its identity, a client or cache holding
   * the address finds the right picture there, and the partial unique index is
   * never asked to admit a duplicate.
   *
   * Two refusals matter more than the repair. A derivative is never rebuilt for
   * an asset that is being removed or has been refused — resurrecting bytes a
   * takedown destroyed would be the single worst thing this file could do. And
   * it is never rebuilt at a processing version other than the one recorded on
   * the row, because that would quietly change what a historical output means
   * under an address that promised not to change.
   */
  private async rebuildVariant(
    asset: MediaAssetRow,
    finding: MediaDriftFindingRow,
  ): Promise<MediaDriftResolution | undefined> {
    const { processor, repository, storage } = this.dependencies;
    if (asset.lifecycle !== 'processing' && asset.lifecycle !== 'ready') {
      return undefined;
    }

    const object = await this.objectOf(finding);
    if (
      object?.role !== 'variant' ||
      object.state !== 'present' ||
      object.variantKind === null
    ) {
      return 'no_longer_present';
    }
    if (object.processingVersion !== processor.version) return undefined;

    const stat = await storage.statObject(object.objectKey);
    // Re-verified before any work: processing retries on its own schedule and
    // usually beats this to it.
    if (stat !== undefined) {
      if (finding.kind === 'variant_missing') return 'no_longer_present';
      if (object.byteSize === null || stat.byteSize === object.byteSize) {
        return 'no_longer_present';
      }
    }

    const original = await repository.findOriginalObject(
      repository.transactionless,
      asset.id,
    );
    if (original === undefined) return undefined;
    const read = await storage.readObject({
      maximumBytes: maximumMediaReadBytes,
      objectKey: original.objectKey,
    });
    // Nothing to render from. The original's own absence is a separate finding
    // that the object audit raises in its own right, so this leaves the
    // derivative outstanding rather than inventing a conclusion about it.
    if (read.kind !== 'bytes') return undefined;

    const rendition = await processor.render({
      bytes: read.bytes,
      kind: object.variantKind,
    });
    const now = this.dependencies.now();
    await storage.writeObject({
      bytes: rendition.bytes,
      contentType: mediaContentTypes[rendition.format],
      objectKey: object.objectKey,
    });
    await repository.recordObjectFacts(repository.transactionless, {
      byteSize: rendition.bytes.byteLength,
      digest: digestOf(rendition.bytes),
      format: rendition.format,
      height: rendition.height,
      now,
      objectId: object.id,
      width: rendition.width,
    });
    return 'repaired';
  }

  private async objectOf(
    finding: MediaDriftFindingRow,
  ): Promise<MediaObjectRow | undefined> {
    if (finding.objectId === null) return undefined;
    return this.dependencies.repository.findObject(
      this.dependencies.repository.transactionless,
      finding.objectId,
    );
  }
}

function isStallable(
  lifecycle: MediaAssetRow['lifecycle'],
): lifecycle is StalledMediaLifecycle {
  return (stalledMediaLifecycles as readonly string[]).includes(lifecycle);
}
