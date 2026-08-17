import {
  localTestMediaScanner,
  localTestMediaStorage,
  unavailableMediaScanner,
  unavailableMediaStorage,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import { MediaDeliveryService } from './delivery.js';
import { MediaInspector } from './inspection.js';
import { MediaOperations } from './operations.js';
import { SharpMediaImageProcessor } from './processing.js';
import {
  DenyingMediaSafety,
  MediaPublicationAuthority,
  UnattachedMediaAssociation,
  type MediaAssociationPort,
  type MediaSafetyPort,
} from './publication.js';
import { MediaReconciliation } from './reconciliation.js';
import { MediaRepository } from './repository.js';
import {
  LocalTestMediaScanner,
  UnavailableMediaScanner,
  type MediaScannerPort,
} from './scanner.js';
import { MediaService } from './service.js';
import {
  LocalTestMediaStorage,
  UnavailableMediaStorage,
  type MediaStoragePort,
} from './storage.js';

export interface MediaRuntime {
  /**
   * Turns an allowed decision into something a client can fetch: a permanent
   * immutable address for a public derivative, or a short-lived credential
   * bound to one asset and one variant for a restricted one.
   */
  readonly delivery: MediaDeliveryService;
  /**
   * What an operator may see of this platform.
   *
   * Composed everywhere, unlike the reconciler: reading operational state
   * touches no bytes, and the API is where an operator's request arrives.
   */
  readonly operations: MediaOperations;
  /**
   * Whether these bytes may reach this person, on this surface, right now.
   *
   * The composition of MEDIA's technical answer with the owning domain's
   * association and Trust and Safety's decision. It is the only thing any
   * surface may ask, and `ready` alone never satisfies it.
   */
  readonly publication: MediaPublicationAuthority;
  /**
   * Checking the record against the provider, and repairing what can be
   * repaired.
   *
   * Present only where the process performs byte work, because restoring a
   * derivative means decoding an original and re-encoding it — which belongs on
   * the worker for exactly the reason processing does.
   */
  readonly reconciliation: MediaReconciliation | undefined;
  readonly repository: MediaRepository;
  /** Exposed so operational surfaces can report which scanner is in force. */
  readonly scanner: MediaScannerPort;
  readonly service: MediaService;
  /** Exposed so operational surfaces can report which adapter is in force. */
  readonly storage: MediaStoragePort;
}

/**
 * MEDIA composition root.
 *
 * It takes no contract from any other domain, because it asks none of them
 * anything: an owning domain authorizes a purpose and then calls MEDIA, never
 * the other way round. Nothing here reads or writes a table outside `media_`.
 */
export function createMediaRuntime(input: {
  readonly config: ServerConfig;
  readonly database: DatabaseHandle;
  /**
   * Whether this process performs byte work.
   *
   * Only the worker does. The API composes neither an inspector nor a
   * processor, so decoding hostile input cannot happen on a request thread —
   * not because a route declines to ask, but because the objects that could do
   * it were never constructed.
   */
  readonly performsByteWork?: boolean;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  /**
   * The owning domain's answer, and Trust and Safety's.
   *
   * Both default to refusing. A composition that has not been given a safety
   * adapter has not been told there are no restrictions; it has been told
   * nothing, and nothing is not permission. Phases 7 and 8 wire the real ones.
   */
  readonly association?: MediaAssociationPort;
  readonly safety?: MediaSafetyPort;
}): MediaRuntime {
  const repository = new MediaRepository(input.database);
  const storage = selectMediaStorage(input.config);
  const scanner = selectMediaScanner(input.config);
  const now = input.now ?? (() => new Date());
  const association = input.association ?? new UnattachedMediaAssociation();
  const publication = new MediaPublicationAuthority({
    association,
    repository,
    safety: input.safety ?? new DenyingMediaSafety(),
  });
  const processor =
    input.performsByteWork === true
      ? new SharpMediaImageProcessor()
      : undefined;
  return {
    delivery: new MediaDeliveryService({
      association,
      now,
      publication,
      repository,
      storage,
    }),
    operations: new MediaOperations({
      now,
      repository,
      scannerName: scanner.name,
      storageName: storage.name,
    }),
    publication,
    reconciliation:
      processor === undefined
        ? undefined
        : new MediaReconciliation({
            logger: input.logger,
            now,
            processor,
            repository,
            storage,
          }),
    repository,
    scanner,
    service: new MediaService({
      ...(processor === undefined
        ? {}
        : {
            inspector: new MediaInspector({ scanner, storage }),
            processor,
          }),
      logger: input.logger,
      now,
      repository,
      storage,
    }),
    storage,
  };
}

/**
 * The scanner registry. Same shape and same reasoning as the storage one: a
 * table so the selectable set is visible in one place, and configuration alone
 * decides, so nothing in a request can reach it.
 */
const mediaScannerAdapters: Readonly<Record<string, () => MediaScannerPort>> = {
  [localTestMediaScanner]: () => new LocalTestMediaScanner(),
  [unavailableMediaScanner]: () => new UnavailableMediaScanner(),
};

function selectMediaScanner(config: ServerConfig): MediaScannerPort {
  const build = mediaScannerAdapters[config.MEDIA_MALWARE_SCANNER];
  if (build === undefined) {
    throw new Error(
      `Unsupported media malware scanner: ${config.MEDIA_MALWARE_SCANNER}`,
    );
  }
  return build();
}

/**
 * The adapter registry.
 *
 * A table rather than a conditional, so the set of things that can be selected
 * is visible in one place and adding an approved provider is an entry with a
 * configuration value beside it. The choice is made once, here, from
 * configuration alone: no route, header, query parameter, or request field
 * reaches this function, which is what makes a test adapter impossible to
 * activate from outside the process.
 */
const mediaStorageAdapters: Readonly<
  Record<string, (config: ServerConfig) => MediaStoragePort>
> = {
  [localTestMediaStorage]: (config) => {
    // Configuration has already refused this selection without both values, so
    // reaching here without them is a defect rather than a misconfiguration.
    const directory = config.MEDIA_LOCAL_STORAGE_DIRECTORY;
    const signingKey = config.MEDIA_DELIVERY_SIGNING_KEY;
    if (directory === undefined || signingKey === undefined) {
      throw new Error(
        'local-test media storage requires a directory and a delivery signing key',
      );
    }
    return new LocalTestMediaStorage({ directory, signingKey });
  },
  [unavailableMediaStorage]: () => new UnavailableMediaStorage(),
};

function selectMediaStorage(config: ServerConfig): MediaStoragePort {
  const build = mediaStorageAdapters[config.MEDIA_STORAGE_PROVIDER];
  if (build === undefined) {
    throw new Error(
      `Unsupported media storage provider: ${config.MEDIA_STORAGE_PROVIDER}`,
    );
  }
  return build(config);
}
