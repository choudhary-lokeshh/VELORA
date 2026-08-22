import type { Executor } from '../database/executor.js';
import {
  defaultPreferenceEnabled,
  isMandatoryCategory,
  isSettablePreferencePair,
  settablePreferencePairs,
  type NotificationCategory,
  type NotificationChannel,
} from './policy.js';
import type { NotificationRepository } from './repository.js';

export interface EffectiveNotificationPreference {
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

export type PreferenceUpdateOutcome =
  | { readonly kind: 'updated' }
  /** The pairing is not one the platform sends on, or is mandatory. */
  | { readonly kind: 'not_settable' };

/**
 * What a person has decided about being told things, and what they may decide.
 *
 * The service reports *effective* preferences rather than stored ones. A
 * category nobody has expressed a preference about reports its default, so a
 * client never holds a copy of the defaults and a default that changes does
 * not require rewriting rows that were never anybody's decision.
 *
 * Every read and write is scoped to one principal by its caller, and this class
 * has no method that takes two. There is no shape of call here that returns
 * somebody else's preferences.
 */
export class NotificationPreferenceService {
  constructor(
    private readonly dependencies: {
      readonly now: () => Date;
      readonly repository: NotificationRepository;
    },
  ) {}

  /**
   * The complete settable set, with the recipient's decisions applied.
   *
   * Always the whole set rather than the stored subset: a client rendering
   * switches needs every switch, and one that had to distinguish "off" from
   * "never set" would be reimplementing the defaults.
   */
  async list(
    executor: Executor,
    recipientId: string,
  ): Promise<readonly EffectiveNotificationPreference[]> {
    const stored = await this.dependencies.repository.listPreferences(
      executor,
      recipientId,
    );
    return settablePreferencePairs.map((pair) => {
      const row = stored.find(
        (candidate) =>
          candidate.category === pair.category &&
          candidate.channel === pair.channel,
      );
      return {
        category: pair.category,
        channel: pair.channel,
        enabled: row?.enabled ?? defaultPreferenceEnabled(pair.category),
      };
    });
  }

  /**
   * Records one decision.
   *
   * A mandatory category is refused here and refused again by the table's own
   * CHECK. Two defences for one rule, because the failure mode is silent: a
   * person stops receiving notices about their own account security and
   * nothing reports it.
   */
  async set(
    executor: Executor,
    input: {
      readonly category: NotificationCategory;
      readonly channel: NotificationChannel;
      readonly enabled: boolean;
      readonly recipientId: string;
    },
  ): Promise<PreferenceUpdateOutcome> {
    if (isMandatoryCategory(input.category)) return { kind: 'not_settable' };
    if (!isSettablePreferencePair(input.category, input.channel)) {
      return { kind: 'not_settable' };
    }
    await this.dependencies.repository.setPreference(executor, {
      category: input.category,
      channel: input.channel,
      enabled: input.enabled,
      now: this.dependencies.now(),
      recipientId: input.recipientId,
    });
    return { kind: 'updated' };
  }
}
