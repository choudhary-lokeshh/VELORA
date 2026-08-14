import { introductionMutualEventName } from '../discovery/events.js';
import { messageSentEventName } from '../messaging/events.js';

/**
 * NOTIFICATIONS policy: what may be sent, over what, how often it is retried,
 * and what stops it.
 *
 * Everything in this module is a decision this domain owns. A source domain
 * states that something happened; it does not choose a channel, a retry
 * budget, or whether its fact survives a block. Keeping those here is what
 * makes "source domain cannot bypass suppression with a different template"
 * (`docs/flows/notification-delivery.md`) enforceable rather than aspirational.
 */

/**
 * Delivery channels the schema admits. No provider is approved for any of them
 * — `docs/decisions/DECISIONS_REQUIRED.md` lists email, push, and SMS as
 * pending — so the configured adapter refuses to send in every deployed
 * environment. The vocabulary exists because a template has to name the channel
 * it was written for, and that is a product fact rather than a vendor one.
 */
export const notificationChannels = ['push', 'email', 'sms'] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

/**
 * Why a notice is being sent. `transactional` follows something the recipient
 * did; `safety` is a security or safety notice that may, under approved legal
 * policy only, ignore ordinary marketing preference; `marketing` is Phase 3 and
 * consent-gated. Nothing in V1 produces `marketing`.
 */
export const notificationPurposes = [
  'transactional',
  'safety',
  'marketing',
] as const;
export type NotificationPurpose = (typeof notificationPurposes)[number];

/**
 * The intent lifecycle.
 *
 * `docs/flows/notification-delivery.md` names the transitions
 * `requested -> evaluated -> queued -> attempted -> delivered/failed/suppressed`.
 * Two of those are not stored states here, and deliberately so. Evaluation
 * happens in the same transaction that records the intent, so nothing is ever
 * observably `requested` but unevaluated. And a failed attempt is a fact about
 * an attempt, not about the intent: a retryable failure returns the intent to
 * `queued` and is recorded on its own attempt row, so "how many times did this
 * fail" is answered from evidence rather than from a state that gets
 * overwritten.
 *
 * `attempted` means a claim is held and a provider call may be in flight. It is
 * the state a crashed worker leaves behind, and the lease is what makes that
 * recoverable rather than terminal.
 */
export const notificationStates = [
  'queued',
  'attempted',
  'delivered',
  'suppressed',
  'dead_letter',
] as const;
export type NotificationState = (typeof notificationStates)[number];

export const terminalNotificationStates = [
  'delivered',
  'suppressed',
  'dead_letter',
] as const;

export function isTerminal(state: NotificationState): boolean {
  return (terminalNotificationStates as readonly string[]).includes(state);
}

/**
 * Why a notice was not sent.
 *
 * Stored for operators and never told to the recipient. A person who learns
 * that a notification was suppressed for `safety_block` has learned that
 * somebody blocked them, which is another person's safety decision and never
 * theirs to see.
 */
export const suppressionReasons = [
  /** Recipient and subject may no longer interact. */
  'safety_block',
  /** The recipient's account is no longer in a state that receives notices. */
  'recipient_not_deliverable',
  /** The notice outlived the moment it was about. */
  'expired',
] as const;
export type SuppressionReason = (typeof suppressionReasons)[number];

export const attemptOutcomes = ['delivered', 'failed', 'suppressed'] as const;
export type AttemptOutcome = (typeof attemptOutcomes)[number];

/**
 * What the in-app surface renders.
 *
 * The same vocabulary the contract publishes. It is separate from the channel
 * list on purpose: the in-app feed is not an external channel, has no provider,
 * no retry budget, and no attempt record. A person sees these because they
 * opened the app, not because anybody sent anything.
 */
export const notificationKinds = [
  'message_received',
  'introduction_mutual',
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

/**
 * An approved template, and the governance attached to it.
 *
 * Keyed by the source event, because that is what decides which template a
 * producer is allowed to trigger. MESSAGING emitting `messaging.message.sent.v1`
 * gets exactly this notice and has no way to ask for another one; a producer
 * that could name the template could pick one whose safety rules are weaker.
 */
export interface NotificationTemplate {
  /** Only this producer may trigger it. */
  readonly allowedProducer: string;
  readonly channel: NotificationChannel;
  /** What the in-app feed calls this. Published; see the contract. */
  readonly kind: NotificationKind;
  readonly key: string;
  readonly purpose: NotificationPurpose;
  /**
   * Whether delivery depends on the recipient and the subject still being
   * permitted to interact. True for anything that tells somebody about another
   * person's action, which is every notice V1 sends.
   */
  readonly requiresPairEligibility: boolean;
  /**
   * After this, the notice is about something too old to be worth telling
   * anybody. It is suppressed rather than sent, and never silently dropped.
   */
  readonly timeToLiveMilliseconds: number;
}

const oneDayMilliseconds = 86_400_000;

/**
 * The whole approved catalogue. V1 sends two transactional notices, and that is
 * the complete list of business events judged to warrant one.
 *
 * Both follow something the recipient deliberately took part in and both tell
 * them about a change they cannot see without being told: somebody wrote to
 * them, or somebody they signalled interest in signalled back. Every other V1
 * transition was evaluated and rejected. A pass, a suppression, and a block are
 * silent by design — telling anybody would disclose another person's decision.
 * A report acknowledgement is the response to the reporter's own request. A
 * profile, availability, or media change is the recipient's own action.
 * Enforcement notices are a legal-policy decision that is not yet approved.
 *
 * The payload each carries is a deep-link target and nothing else. No body, no
 * sender name, no message preview: `docs/flows/notification-delivery.md`
 * requires lock-screen and email copy to minimize message text and identity,
 * and a field that is never stored cannot later be rendered into a template by
 * somebody who did not read that document.
 */
export const notificationTemplates: Readonly<
  Record<string, NotificationTemplate>
> = {
  [messageSentEventName]: {
    allowedProducer: 'messaging',
    channel: 'push',
    key: 'messaging.message.received.v1',
    kind: 'message_received',
    purpose: 'transactional',
    requiresPairEligibility: true,
    timeToLiveMilliseconds: oneDayMilliseconds,
  },
  [introductionMutualEventName]: {
    allowedProducer: 'discovery',
    channel: 'push',
    key: 'discovery.introduction.mutual.v1',
    kind: 'introduction_mutual',
    purpose: 'transactional',
    requiresPairEligibility: true,
    timeToLiveMilliseconds: oneDayMilliseconds,
  },
};

/**
 * The same catalogue, reachable from a stored row.
 *
 * Intake resolves a template from the event that triggered it; delivery
 * resolves one from the `templateKey` already written on the intent, because by
 * then the event is history and the notice is the thing being acted on.
 */
export const notificationTemplateByKey: Readonly<
  Record<string, NotificationTemplate>
> = Object.fromEntries(
  Object.values(notificationTemplates).map((template) => [
    template.key,
    template,
  ]),
);

/**
 * Retry budget for one intent.
 *
 * An attempt is counted when the claim is taken, before the provider is called,
 * so a worker that crashes mid-call still consumes budget. That is the property
 * that makes a permanently poisonous notice retire instead of being retried by
 * every worker forever.
 */
export const maximumDeliveryAttempts = 6;

/** How long a delivery claim stays valid before another worker may take it. */
export const deliveryLeaseMilliseconds = 60_000;

/** Deterministic capped exponential backoff between delivery attempts. */
export function deliveryBackoffMilliseconds(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts) * 5_000, 900_000);
}

/**
 * How long to wait before retrying a notice that was never attempted because no
 * delivery channel is configured. Longer than a failure backoff and it consumes
 * no attempt budget: nothing is wrong with the notice, and it must still be
 * deliverable on the day a provider is approved.
 */
export const channelUnavailableRetryMilliseconds = 900_000;

export const deliveryBatchSize = 50;

/**
 * How many times one in-app feed read may refill after safety filtering.
 *
 * Filtering removes rows, so a page has to be refilled or it is always short.
 * The bound is what stops a consumer whose notices are mostly about people they
 * have since blocked from turning one request into a scan of their whole
 * history; past it the page is returned short with its cursor.
 */
export const maximumFeedFilterRounds = 4;

/** How much each refill over-reads, so one round usually suffices. */
export const feedFilterOverFetchFactor = 2;

/**
 * How often the delivery sweep runs.
 *
 * It is the recovery path, not the fast path — a queue wake-up normally gets
 * there first — so it is paced for a backlog rather than for latency.
 */
export const deliverySweepIntervalMilliseconds = 15_000;
