import {
  localTestMediaStorage,
  unavailableMediaStorage,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import { MediaRepository } from './repository.js';
import { MediaService } from './service.js';
import {
  LocalTestMediaStorage,
  UnavailableMediaStorage,
  type MediaStoragePort,
} from './storage.js';

export interface MediaRuntime {
  readonly repository: MediaRepository;
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
  readonly logger: SafeLogger;
  readonly now?: () => Date;
}): MediaRuntime {
  const repository = new MediaRepository(input.database);
  const storage = selectMediaStorage(input.config);
  return {
    repository,
    service: new MediaService({
      logger: input.logger,
      now: input.now ?? (() => new Date()),
      repository,
      storage,
    }),
    storage,
  };
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
