import type { OperationsRepository } from './repository.js';
import {
  controlCacheMilliseconds,
  controlDefault,
  controlKeys,
  type ControlKey,
} from './policy.js';

/**
 * The thing every governed feature actually asks.
 *
 * A narrow published contract rather than a shared client, because a domain
 * that could read arbitrary controls would be a domain that learns the whole
 * control vocabulary and can be pointed at somebody else's switch. LIVE asks
 * whether it may admit a search; it does not know that a control store exists.
 */
export interface OperationalControlReader {
  isEnabled(key: ControlKey): Promise<boolean>;
}

interface CacheEntry {
  readonly enabled: boolean;
  readonly readAt: number;
}

/**
 * Reads a control, remembers it briefly, and never lets a failure change it.
 *
 * Three behaviours, and each is a decision rather than a convenience.
 *
 * **It caches.** These controls are consulted on the paths people press several
 * times a minute, and a query per press would put the busiest read in the
 * product behind a table that changes a handful of times a year. The cost is
 * that a change takes effect within `controlCacheMilliseconds` rather than
 * instantly, and that bound is published — by the API, and by the console
 * beside the switch — because an operator pausing something during an incident
 * has to know whether to wait or press again.
 *
 * **A failure keeps the last value rather than reverting to the default.** An
 * operator who paused live search and then lost a database replica must not
 * have their pause undone by the very failure they were reacting to. Where
 * nothing has ever been read the declared default applies, which is the product
 * as it shipped — the one state that is safe to assume about a platform this
 * domain has never spoken to.
 *
 * **It never throws.** A control read is not a reason to fail a request that
 * would otherwise succeed. The worst case is that a feature keeps behaving the
 * way it behaved a few seconds ago, which is exactly what an operator would
 * choose over an outage.
 */
export class CachedControlReader implements OperationalControlReader {
  private readonly cache = new Map<ControlKey, CacheEntry>();

  constructor(
    private readonly dependencies: {
      readonly monotonic?: () => number;
      readonly now?: () => Date;
      readonly repository: OperationsRepository;
    },
  ) {}

  private clock(): number {
    return this.dependencies.monotonic?.() ?? Date.now();
  }

  async isEnabled(key: ControlKey): Promise<boolean> {
    const at = this.clock();
    const cached = this.cache.get(key);
    if (cached !== undefined && at - cached.readAt < controlCacheMilliseconds) {
      return cached.enabled;
    }
    try {
      const row = await this.dependencies.repository.readControl(key);
      const enabled = row?.enabled ?? controlDefault(key);
      this.cache.set(key, { enabled, readAt: at });
      return enabled;
    } catch {
      // The last value stands. Where there has never been one, the platform as
      // it shipped stands, which is the only assumption that cannot turn a
      // database blip into a self-inflicted outage.
      return cached?.enabled ?? controlDefault(key);
    }
  }

  /**
   * Forgets what it believed, so a write takes effect in the process that made
   * it without waiting out the cache.
   *
   * Only this process. Another API instance still waits out its own window,
   * which is why the bound is published rather than described as instant.
   */
  forget(key?: ControlKey): void {
    if (key === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(key);
  }
}

/**
 * A reader for an environment with no control store at all.
 *
 * Answers the declared default for everything, which is what makes OPERATIONS
 * optional in a composition: a runtime assembled without it behaves exactly as
 * the product behaved before this domain existed, rather than failing closed on
 * a feature nobody asked to pause.
 */
export class DefaultControlReader implements OperationalControlReader {
  isEnabled(key: ControlKey): Promise<boolean> {
    return Promise.resolve(controlDefault(key));
  }
}

/** Every control's current value in one read, for the operator console. */
export async function readAllControls(
  repository: OperationsRepository,
): Promise<
  readonly {
    readonly changedBy: string | undefined;
    readonly enabled: boolean;
    readonly key: ControlKey;
    readonly reason: string | undefined;
    readonly updatedAt: Date | undefined;
    readonly version: number;
  }[]
> {
  const rows = await repository.listControls();
  const stored = new Map(rows.map((row) => [row.key, row]));
  return controlKeys.map((key) => {
    const row = stored.get(key);
    if (row === undefined) {
      // Never set. Version zero is the token a first write must present, which
      // is what makes "set a control nobody has touched" a compare-and-set like
      // every other write rather than a special case.
      return {
        changedBy: undefined,
        enabled: controlDefault(key),
        key,
        reason: undefined,
        updatedAt: undefined,
        version: 0,
      };
    }
    return {
      changedBy: row.changedBy,
      enabled: row.enabled,
      key,
      reason: row.reason,
      updatedAt: row.updatedAt,
      version: row.version,
    };
  });
}
