import type { DatabaseHandle, Executor } from '../database/executor.js';
import { IntroductionRepository } from './introductions.js';

/**
 * The connection fact DISCOVERY publishes.
 *
 * Two people being mutually introduced is the only thing that authorizes a
 * conversation, and DISCOVERY is the domain that knows it. MESSAGING therefore
 * asks through this contract rather than reading `discovery_introductions`,
 * which is what `docs/architecture/03-domain-boundaries.md` requires: another
 * domain may call an approved service contract, not reach into a schema it does
 * not own.
 *
 * The contract publishes the fact and nothing else. It does not say who
 * signalled first, when a signal expired, whether a pair ever declined, or what
 * closed an earlier introduction, because none of that is a caller's business —
 * and because the moment it were published, another domain could start making
 * decisions that belong to this one.
 */
export interface MutualConnection {
  readonly counterpartId: string;
  readonly introductionId: string;
  readonly mutualAt: Date;
}

export interface ConnectionDirectoryPort {
  /**
   * The mutual introduction with that identifier, if the caller is one of its
   * two people. A pending, expired, closed, or someone else's introduction is
   * reported identically to one that does not exist.
   */
  /**
   * The executor is optional for the same reason it is mandatory below. A
   * caller that only wants to read may omit it and be served from the handle.
   * A caller that is about to write inside a transaction passes its own, so the
   * relationship it authorizes against is the one that is true at the moment of
   * the write — and so it does not need a second pooled connection to ask,
   * which is what turns one request into two connections and a busy pool into a
   * stalled one.
   */
  mutualConnectionFor(input: {
    readonly actorId: string;
    readonly executor?: Executor;
    readonly introductionId: string;
  }): Promise<MutualConnection | undefined>;

  /**
   * Whether these two people currently hold a mutual introduction.
   *
   * The caller supplies the executor because this question is asked as part of
   * deciding whether to durably accept a write. "Revalidated at the moment of
   * the action" is only true if the revalidation and the write are the same
   * transaction; running it on a separate handle would leave a window, and
   * would also mean a caller inside a transaction needs a second pooled
   * connection to ask.
   */
  isMutuallyIntroduced(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly second: string;
  }): Promise<boolean>;
}

export class ConnectionDirectory implements ConnectionDirectoryPort {
  private readonly introductions: IntroductionRepository;

  constructor(private readonly database: DatabaseHandle) {
    this.introductions = new IntroductionRepository(database);
  }

  async mutualConnectionFor(input: {
    readonly actorId: string;
    readonly executor?: Executor;
    readonly introductionId: string;
  }): Promise<MutualConnection | undefined> {
    const row = await this.introductions.findForActor(
      input.executor ?? this.database,
      {
        actorId: input.actorId,
        id: input.introductionId,
      },
    );
    if (row?.state !== 'mutual' || row.mutualAt === null) return undefined;
    return {
      counterpartId:
        row.pairLowId === input.actorId ? row.pairHighId : row.pairLowId,
      introductionId: row.id,
      mutualAt: row.mutualAt,
    };
  }

  async isMutuallyIntroduced(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly second: string;
  }): Promise<boolean> {
    const row = await this.introductions.findMutualPair(input.executor, {
      first: input.first,
      second: input.second,
    });
    return row !== undefined;
  }
}
