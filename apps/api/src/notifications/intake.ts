import type { SafeLogger } from '@velora/observability/server';

import {
  introductionMutualEventName,
  parseIntroductionMutualEvent,
} from '../discovery/events.js';
import type { OutboxConsumer, OutboxEvent } from '../events/relay.js';
import {
  messageSentEventName,
  parseMessageSentEvent,
} from '../messaging/events.js';
import {
  callInvitedEventName,
  callMissedEventName,
  parseCallInvitedEvent,
  parseCallMissedEvent,
} from '../realtime/events.js';
import { notificationTemplates } from './policy.js';
import type { NotificationRepository } from './repository.js';

/**
 * Where a published fact becomes a notice the platform owes somebody.
 *
 * This is the handoff that keeps durability continuous. The source fact was
 * committed by the transaction that produced the business state, and the relay
 * does not record it as dispatched until the rows this class writes exist. So
 * there is no instant at which the obligation lives only in a process: it is a
 * committed outbox row, then briefly both, then a committed intent. Kill the
 * worker anywhere in that sequence and the next relay cycle resumes it.
 *
 * Evaluation happens here rather than at delivery because it is a decision
 * about whether a notice is owed at all, and it depends on nothing that can
 * change later: which producer emitted the fact, whether that producer is
 * allowed to trigger this template, and what channel the template is written
 * for. Everything that *can* change between now and delivery — the block, the
 * recipient's standing — is deliberately not decided here.
 *
 * Recipient preference and quiet hours are not evaluated. No default preference
 * set, quiet-hour window, or marketing classification is approved
 * (`docs/decisions/DECISIONS_REQUIRED.md`), and V1 sends only transactional
 * notices, which those rules would not suppress anyway. The evaluation point
 * exists; the policy that will sit in it does not yet.
 */

/**
 * A published fact reduced to what a notice needs.
 *
 * The reduction is the minimization. Whatever the producer said, only these
 * fields survive into storage, so a template can never render something the
 * producer did not intend to publish and this domain never had.
 */
interface NotificationFact {
  /** In-app deep-link target. Exactly one of the three is present. */
  readonly callId?: string;
  readonly conversationId?: string;
  readonly introductionId?: string;
  /** What an external channel is allowed to see. Identifiers only. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recipientId: string;
  /** The other person, and the one the delivery-time recheck is against. */
  readonly subjectId: string;
}

type FactReader = (payload: unknown) => NotificationFact | undefined;

/**
 * How each approved source event is read.
 *
 * Keyed by event name, so a producer whose fact has no reader here cannot
 * produce a notice at all — the relay retries it and then retires it loudly,
 * which is the correct outcome for an event nobody agreed to act on.
 */
const factReaders: Readonly<Record<string, FactReader>> = {
  [messageSentEventName]: (payload) => {
    const fact = parseMessageSentEvent(payload);
    if (fact === undefined) return undefined;
    return {
      conversationId: fact.conversationId,
      // The body, the sender's name, and the sequence stay in MESSAGING: a
      // field that is never stored cannot be rendered onto a lock screen by a
      // later template change.
      payload: { conversationId: fact.conversationId },
      recipientId: fact.recipientId,
      subjectId: fact.senderId,
    };
  },
  [introductionMutualEventName]: (payload) => {
    const fact = parseIntroductionMutualEvent(payload);
    if (fact === undefined) return undefined;
    return {
      introductionId: fact.introductionId,
      payload: { introductionId: fact.introductionId },
      recipientId: fact.initiatorId,
      subjectId: fact.respondingActorId,
    };
  },
  [callInvitedEventName]: (payload) => {
    const fact = parseCallInvitedEvent(payload);
    if (fact === undefined) return undefined;
    return {
      callId: fact.callId,
      // Identifiers only. The medium, the caller's name, and everything else
      // stay in REALTIME, so no later template change can render them onto a
      // lock screen from a field this domain never held.
      payload: { callId: fact.callId },
      recipientId: fact.recipientId,
      subjectId: fact.callerId,
    };
  },
  [callMissedEventName]: (payload) => {
    const fact = parseCallMissedEvent(payload);
    if (fact === undefined) return undefined;
    return {
      callId: fact.callId,
      payload: { callId: fact.callId },
      recipientId: fact.recipientId,
      subjectId: fact.callerId,
    };
  },
};

export interface NotificationIntakeDependencies {
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly repository: NotificationRepository;
  /**
   * Best-effort low-latency wake-up for the delivery worker. It is allowed to
   * fail: the queue holds a hint, PostgreSQL holds the notice, and the sweeper
   * delivers it either way.
   */
  readonly wake?: (intentId: string) => Promise<void>;
}

export class NotificationIntake implements OutboxConsumer {
  constructor(
    readonly eventName: string,
    private readonly dependencies: NotificationIntakeDependencies,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const template = notificationTemplates[event.eventName];
    if (template === undefined) {
      throw new Error(`No approved template for ${event.eventName}`);
    }
    // A producer may trigger only its own approved template. Without this, any
    // domain able to append an event could pick a template whose safety rules
    // are weaker than the ones its own facts are subject to.
    if (template.allowedProducer !== event.producer) {
      throw new Error(
        `Producer ${event.producer} may not trigger ${template.key}`,
      );
    }

    const read = factReaders[event.eventName];
    const fact = read?.(event.payload);
    if (fact === undefined) {
      // Throwing routes this through the relay's retry and then its
      // dead-letter, which is where a malformed published fact belongs: visible,
      // retained, and alerted. Silently ignoring it would be the one outcome
      // this whole path exists to prevent.
      throw new Error(`Malformed payload for ${event.eventName}`);
    }

    const now = this.dependencies.now();
    const intent = await this.dependencies.repository.transaction(
      async (executor) => {
        // Both rows or neither. The in-app line and the external obligation
        // describe the same promise, and a crash between two separate writes
        // would leave a person either seeing something nobody owes them or
        // owed something they will never see.
        const created = await this.dependencies.repository.insertIntent(
          executor,
          {
            channel: template.channel,
            correlationId: event.correlationId,
            expiresAt: new Date(
              now.getTime() + template.timeToLiveMilliseconds,
            ),
            now,
            payload: fact.payload,
            purpose: template.purpose,
            recipientId: fact.recipientId,
            sourceEventId: event.id,
            sourceProducer: event.producer,
            subjectId: fact.subjectId,
            templateKey: template.key,
          },
        );
        await this.dependencies.repository.insertFeedEntry(executor, {
          callId: fact.callId ?? null,
          conversationId: fact.conversationId ?? null,
          introductionId: fact.introductionId ?? null,
          kind: template.kind,
          now,
          recipientId: fact.recipientId,
          sourceEventId: event.id,
          subjectId: fact.subjectId,
          templateKey: template.key,
        });
        return created;
      },
    );

    // Absent means the unique index refused a duplicate: this event has already
    // produced its notice, and a redelivery must change nothing.
    if (intent === undefined) return;

    if (this.dependencies.wake === undefined) return;
    try {
      await this.dependencies.wake(intent.id);
    } catch (error) {
      this.dependencies.logger.warn(
        { error, intentId: intent.id },
        'notification wake-up could not be queued; sweeper will deliver',
      );
    }
  }
}

/**
 * One consumer per approved source event.
 *
 * The relay routes by event name and a consumer declares one, so the catalogue
 * decides what is registered. A template added to the policy without a reader
 * here fails loudly at construction rather than at three in the morning.
 */
export function createNotificationIntakes(
  dependencies: NotificationIntakeDependencies,
): readonly NotificationIntake[] {
  return Object.keys(notificationTemplates).map((eventName) => {
    if (factReaders[eventName] === undefined) {
      throw new Error(`No published fact reader for ${eventName}`);
    }
    return new NotificationIntake(eventName, dependencies);
  });
}
