import type { DatabaseHandle, Executor } from '../database/executor.js';
import { liveRematchSuppressionMilliseconds } from './policy.js';
import { LiveRepository } from './repository.js';

/**
 * The two facts LIVE publishes about a pair, and the whole of them.
 *
 * REALTIME asks one of them on every authorization it takes for a random live
 * session; DISCOVERY asks the other when deciding whether two people may be
 * introduced. Both are booleans. Neither says who the other person is, when the
 * encounter started, how long it lasted, what was said in it, or how many
 * encounters anybody has had — because none of that is either domain's business
 * and because the moment it were published, one of them could start deciding
 * something that belongs to this one.
 *
 * Constructed from a database handle rather than from LIVE's runtime, on the
 * same shape as `RtcCallEnforcement` and `ConversationEnforcement`, and for the
 * same reason. LIVE is composed *after* DISCOVERY and REALTIME, because it
 * consumes contracts from both; handing either of them a whole live runtime
 * would be a cycle needing a late setter. There is no cycle to break: this
 * class answers two questions and authorizes nothing.
 */
export class LiveEncounterDirectory {
  private readonly repository: LiveRepository;

  constructor(
    private readonly database: DatabaseHandle,
    private readonly options: {
      /** Bounded so a past encounter is never a standing permission. */
      readonly recentWindowMilliseconds?: number;
    } = {},
  ) {
    this.repository = new LiveRepository(database);
  }

  /** Present so the class owns a handle of its own, as the other contracts do. */
  get transactionless(): DatabaseHandle {
    return this.database;
  }

  /**
   * Whether these two are in a live encounter right now.
   *
   * REALTIME's second eligibility arm. It is the exact analogue of "are these
   * two still mutually introduced", and it is asked in exactly the same places
   * — which is what makes an encounter ending refuse the join credential a
   * client is already reaching for, rather than merely refusing the next one.
   */
  hasLiveEncounter(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly second: string;
  }): Promise<boolean> {
    return this.repository.hasLiveEncounter(input.executor, {
      first: input.first,
      second: input.second,
    });
  }

  /**
   * Whether these two met live recently enough for one to signal the other.
   *
   * DISCOVERY's second introducibility arm. Deliberately not restricted to a
   * *live* encounter: Connect and the encounter ending race constantly — the
   * other person presses Next in the same second — and somebody whose Connect
   * lost that race by a few milliseconds has still met the person and should
   * still be able to reach for them.
   *
   * It is bounded by the same window that stops the matcher handing the same
   * two people to each other again, because that is the honest span of "we just
   * met": long enough that a slow tap still works, short enough that it is a
   * reason to introduce now rather than a permission that outlives the meeting.
   */
  hasMetLiveRecently(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean> {
    const window =
      this.options.recentWindowMilliseconds ??
      liveRematchSuppressionMilliseconds;
    return this.repository.metRecently(input.executor, {
      first: input.first,
      second: input.second,
      since: new Date(input.now.getTime() - window),
    });
  }
}
