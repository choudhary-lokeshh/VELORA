import type { Executor } from '../database/executor.js';
import type { ReportTargetType } from './policy.js';

/**
 * What a reporter names, and what SAFETY stores.
 *
 * These are two different things on purpose. A reporter names what they were
 * looking at — a creator's public handle, a club's slug, a content identifier
 * from a page they were on — because those are the only identifiers a public
 * surface exposes. SAFETY stores Velora's own identifier, resolved here through
 * the owning domain's published contract.
 *
 * The gap between the two is the whole point. A caller cannot invent a target,
 * cannot report something that was never published, and cannot learn an
 * internal identifier for something they could not already see. Every
 * resolution answers with one value or nothing, and "nothing" covers the
 * unknown, the unpublished, and the not-yours identically, so no shape of
 * refusal can be used to enumerate.
 */
export type ReportTargetRequest =
  | { readonly type: 'consumer_account'; readonly accountId: string }
  | { readonly type: 'creator_profile'; readonly handle: string }
  | { readonly type: 'creator_content'; readonly contentId: string }
  | { readonly type: 'club'; readonly handle: string; readonly slug: string }
  | { readonly type: 'conversation'; readonly conversationId: string };

export interface ResolvedReportTarget {
  readonly targetId: string;
  readonly targetType: ReportTargetType;
}

/**
 * The account answer SAFETY needs and does not own.
 *
 * USERS decides whether an account exists. SAFETY may not read `users_`, and a
 * report about somebody who is not there is a record pointing at nothing.
 */
export interface SafetyConsumerTargetPort {
  accountExists(input: {
    readonly accountId: string;
    readonly executor: Executor;
  }): Promise<boolean>;
}

/** The creator answer, satisfied by CREATORS' published directory. */
export interface SafetyCreatorTargetPort {
  publishedCreatorFor(input: {
    readonly executor: Executor;
    readonly handle: string;
  }): Promise<string | undefined>;
}

/**
 * The catalog answers, satisfied by PRIVATE CLUBS.
 *
 * Both are deliberately narrow: an identifier back, or nothing. Neither returns
 * a title, an owner, a visibility, or a lifecycle, because a reporter needs
 * none of those and a caller probing this path must not learn them.
 */
export interface SafetyCatalogTargetPort {
  /** A published content item's identifier, if that is what this names. */
  publishedContentFor(input: {
    readonly contentId: string;
    readonly executor: Executor;
  }): Promise<string | undefined>;

  /** A published club's identifier, addressed the way a visitor sees it. */
  publishedClubFor(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly slug: string;
  }): Promise<string | undefined>;
}

/**
 * The conversation answer, satisfied by MESSAGING.
 *
 * Membership is the whole predicate. A conversation somebody is not in is not a
 * conversation they may report, because a report naming one would be a way to
 * assert that two other people are talking.
 */
export interface SafetyConversationTargetPort {
  participates(input: {
    readonly accountId: string;
    readonly conversationId: string;
    readonly executor: Executor;
  }): Promise<boolean>;
}

export interface ReportTargetResolverDependencies {
  readonly catalog: SafetyCatalogTargetPort;
  readonly consumers: SafetyConsumerTargetPort;
  readonly conversations: SafetyConversationTargetPort;
  readonly creators: SafetyCreatorTargetPort;
}

export class ReportTargetResolver {
  constructor(
    private readonly dependencies: ReportTargetResolverDependencies,
  ) {}

  /**
   * Whether the reporter is in the conversation they attached as evidence.
   *
   * A report about an account may name the conversation it came from, and that
   * name was previously stored on the reporter's word alone. It is not a
   * harmless string: a moderation decision can close a conversation, so an
   * unchecked one is a way to point an operator at two people the reporter has
   * nothing to do with. Membership is the same predicate that makes a
   * conversation reportable at all, asked here for the evidence rather than for
   * the target.
   */
  async participatesIn(input: {
    readonly conversationId: string;
    readonly executor: Executor;
    readonly reporterId: string;
  }): Promise<boolean> {
    return this.dependencies.conversations.participates({
      accountId: input.reporterId,
      conversationId: input.conversationId,
      executor: input.executor,
    });
  }

  /**
   * Resolves what a reporter named into what SAFETY stores, or nothing.
   *
   * The reporter's own identifier is a parameter because two of these answers
   * depend on it: reporting yourself is refused, and a conversation is only a
   * target for somebody in it.
   */
  async resolve(input: {
    readonly executor: Executor;
    readonly reporterId: string;
    readonly target: ReportTargetRequest;
  }): Promise<ResolvedReportTarget | undefined> {
    const { executor, reporterId, target } = input;
    switch (target.type) {
      case 'consumer_account': {
        if (target.accountId === reporterId) return undefined;
        const exists = await this.dependencies.consumers.accountExists({
          accountId: target.accountId,
          executor,
        });
        return exists
          ? { targetId: target.accountId, targetType: 'consumer_account' }
          : undefined;
      }
      case 'creator_profile': {
        const creatorId = await this.dependencies.creators.publishedCreatorFor({
          executor,
          handle: target.handle,
        });
        return creatorId === undefined
          ? undefined
          : { targetId: creatorId, targetType: 'creator_profile' };
      }
      case 'creator_content': {
        const contentId = await this.dependencies.catalog.publishedContentFor({
          contentId: target.contentId,
          executor,
        });
        return contentId === undefined
          ? undefined
          : { targetId: contentId, targetType: 'creator_content' };
      }
      case 'club': {
        const creatorId = await this.dependencies.creators.publishedCreatorFor({
          executor,
          handle: target.handle,
        });
        if (creatorId === undefined) return undefined;
        const clubId = await this.dependencies.catalog.publishedClubFor({
          creatorId,
          executor,
          slug: target.slug,
        });
        return clubId === undefined
          ? undefined
          : { targetId: clubId, targetType: 'club' };
      }
      default: {
        const participates = await this.dependencies.conversations.participates(
          {
            accountId: reporterId,
            conversationId: target.conversationId,
            executor,
          },
        );
        return participates
          ? { targetId: target.conversationId, targetType: 'conversation' }
          : undefined;
      }
    }
  }
}
