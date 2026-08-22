import { introductionMutualEventName } from '../discovery/events.js';
import { messageSentEventName } from '../messaging/events.js';
import {
  callInvitedEventName,
  callMissedEventName,
} from '../realtime/events.js';
import { rtcInvitationTimeoutMilliseconds } from '../realtime/policy.js';

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
 * What a notice is about, for the purpose of deciding whether a preference may
 * silence it.
 *
 * A category, not a boolean, because "can the recipient turn this off" has more
 * than two correct answers and the difference is governance rather than topic.
 * Some notices are offers and some are obligations, and a single
 * `notifications_enabled` flag cannot express the second kind without either
 * letting somebody silence a security notice or refusing to let them silence
 * anything.
 *
 * Categories are also the unit a person actually reasons about. "Stop telling
 * me about calls" is a preference somebody holds; "stop
 * `realtime.call.missed.v1`" is not.
 */
export const notificationCategories = [
  /** Sessions, credentials, recovery. Mandatory: see below. */
  'account_security',
  /** Safety and legal notices the platform is obliged to deliver. Mandatory. */
  'safety_legal',
  'direct_message',
  'introduction',
  'call',
  /**
   * Consent-gated and unreachable. No template carries it, `marketing` purpose
   * is refused everywhere, and it defaults to off rather than on. It exists so
   * that a promotional notice cannot be quietly reclassified as transactional
   * to escape a consent decision nobody has taken.
   */
  'marketing',
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

/**
 * Categories a preference may not silence.
 *
 * This list is also a CHECK constraint on the preferences table, so a
 * disabled row for one of these cannot exist in the database at all. That is
 * deliberate: expressed only in application code, "a security notice is always
 * sent" survives exactly until somebody writes a second code path that sets
 * preferences, and the failure is silent.
 *
 * No V1 template uses either of them. The platform sends no security or legal
 * notice yet, and the vocabulary exists ahead of the templates because the
 * constraint has to be in place before the first one is written, not after.
 */
export const mandatoryNotificationCategories = [
  'account_security',
  'safety_legal',
] as const;

export function isMandatoryCategory(category: NotificationCategory): boolean {
  return (mandatoryNotificationCategories as readonly string[]).includes(
    category,
  );
}

/**
 * What a category does when nobody has expressed a preference.
 *
 * Everything a person took part in defaults to on, because a missing row means
 * "never asked" and silence about a message somebody sent you is worse than a
 * notification you did not want. `marketing` defaults to off, because consent
 * is not the absence of a refusal.
 */
export function defaultPreferenceEnabled(
  category: NotificationCategory,
): boolean {
  return category !== 'marketing';
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
  /**
   * The recipient turned this category off on this channel. Never reachable
   * for a mandatory category: the preferences table refuses to store one.
   */
  'recipient_opted_out',
  /**
   * There is nowhere to send it. No device is registered for a push notice, or
   * no address exists for an email one.
   *
   * This is a suppression rather than a failure because nothing was wrong and
   * nobody was asked. It is also the reason the delivered path cannot lie: a
   * channel that reported success for a recipient with no destination would be
   * reporting that somebody was reached who could not have been.
   */
  'destination_unavailable',
] as const;
export type SuppressionReason = (typeof suppressionReasons)[number];

/**
 * Why a delivery attempt failed, normalized by the adapter that made it.
 *
 * The class decides what happens next. A provider's error text never does:
 * vendor strings differ per vendor, change without notice, and describe the
 * transport rather than the obligation. Every adapter converts whatever it was
 * told into exactly one of these, and the retry decision reads only this.
 *
 * The split that matters is not severity, it is whether trying again could
 * ever work. A timeout might; a mailbox that does not exist never will, and
 * retrying it six times teaches a provider that this sender does not read
 * bounces — which is how a sending reputation is lost.
 */
export const deliveryFailureClasses = [
  /** The provider could not be reached, or answered in a way nobody planned. */
  'transport',
  /** The provider asked for less traffic. Retryable, and its own class so a
   * throttle is never mistaken for a fault in the notice. */
  'throttled',
  /** The destination refused this message and may accept a later one. */
  'soft_bounce',
  /** The destination does not exist or has refused permanently. */
  'hard_bounce',
  /** The provider retired this device token. It never becomes valid again. */
  'invalid_token',
  /** The provider refused the content or the sender on policy grounds. */
  'policy_refused',
  /** This destination is suppressed and must not be attempted at all. */
  'destination_suppressed',
  /**
   * Recorded before this vocabulary existed. No adapter produces it, and a
   * test asserts that. It exists so the shape constraint below can be added to
   * a table that may already hold failed attempts, without inventing a cause
   * for one nobody classified.
   */
  'unclassified',
] as const;
export type DeliveryFailureClass = (typeof deliveryFailureClasses)[number];

/**
 * The classes worth another attempt. Everything absent from this list is
 * terminal on the first occurrence, whatever the attempt budget still says.
 */
const retryableFailureClasses: readonly DeliveryFailureClass[] = [
  'transport',
  'throttled',
  'soft_bounce',
];

export function isRetryableFailure(
  failureClass: DeliveryFailureClass,
): boolean {
  return retryableFailureClasses.includes(failureClass);
}

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
  /** Somebody is calling, right now. */
  'call_incoming',
  /** A call went unanswered. Derived from the lifecycle, not from delivery. */
  'call_missed',
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
  /** Decides whether a recipient's preference may silence this notice. */
  readonly category: NotificationCategory;
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
    category: 'direct_message',
    channel: 'push',
    key: 'messaging.message.received.v1',
    kind: 'message_received',
    purpose: 'transactional',
    requiresPairEligibility: true,
    timeToLiveMilliseconds: oneDayMilliseconds,
  },
  [introductionMutualEventName]: {
    allowedProducer: 'discovery',
    category: 'introduction',
    channel: 'push',
    key: 'discovery.introduction.mutual.v1',
    kind: 'introduction_mutual',
    purpose: 'transactional',
    requiresPairEligibility: true,
    timeToLiveMilliseconds: oneDayMilliseconds,
  },
  [callInvitedEventName]: {
    allowedProducer: 'realtime',
    category: 'call',
    channel: 'push',
    key: 'realtime.call.incoming.v1',
    kind: 'call_incoming',
    purpose: 'transactional',
    requiresPairEligibility: true,
    // Seconds, not a day. A ring that arrives after the invitation has expired
    // is an interruption about something that is already over, and the delivery
    // path drops a notice whose time to live has passed rather than sending it.
    // This is deliberately longer than the invitation itself so a notice is
    // never discarded before the call it is about has finished ringing.
    timeToLiveMilliseconds: rtcInvitationTimeoutMilliseconds * 2,
  },
  [callMissedEventName]: {
    allowedProducer: 'realtime',
    category: 'call',
    channel: 'push',
    key: 'realtime.call.missed.v1',
    kind: 'call_missed',
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
 * Platforms a device registration may name.
 *
 * Both are the operating system rather than a vendor: a token belongs to a
 * device and the provider that will eventually carry it is configuration, not
 * a property of the registration. That separation is what lets the provider
 * decision land later without rewriting every stored row.
 */
export const pushPlatforms = ['ios', 'android'] as const;
export type PushPlatform = (typeof pushPlatforms)[number];

/**
 * Why a device registration stopped being usable.
 *
 * Every one is terminal for that registration. A registration is never
 * re-enabled: the device registers again and gets a new row, which is the only
 * way this side can be sure the token it holds is one the device still has.
 */
export const pushDeviceDisableReasons = [
  /** The person signed out on this installation. */
  'signed_out',
  /** The same token registered under a different principal. */
  'claimed_by_another_principal',
  /** The installation registered a different token. */
  'token_rotated',
  /** The provider reported the token invalid. It never becomes valid again. */
  'provider_invalidated',
  /** An operator or a retention pass retired it. */
  'retired',
] as const;
export type PushDeviceDisableReason = (typeof pushDeviceDisableReasons)[number];

/**
 * Bounds on a device token, as a shape rather than as a vendor format.
 *
 * APNs tokens are 64 hexadecimal characters and FCM registration tokens are
 * longer and opaque, so pinning either vendor's format here would refuse the
 * other. What is bounded instead is what any credential may be: printable,
 * bounded in length, and not empty.
 */
export const minimumPushTokenLength = 32;
export const maximumPushTokenLength = 4_096;

/**
 * The category and channel pairs a person can actually decide about.
 *
 * Derived from the approved catalogue rather than listed by hand, so a setting
 * cannot outlive the template it governs. Offering a switch for something the
 * platform has no template to send would be a control that does nothing, which
 * misrepresents what the platform does more than offering no control would.
 *
 * Mandatory categories are excluded because they are not offers. They are
 * absent from this list, absent from the read surface, and refused by the
 * preferences table's own CHECK if anything tries to store one as disabled.
 */
export const settablePreferencePairs: readonly {
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
}[] = Object.values(notificationTemplates)
  .filter((template) => !isMandatoryCategory(template.category))
  .map((template) => ({
    category: template.category,
    channel: template.channel,
  }))
  .filter(
    (pair, index, all) =>
      all.findIndex(
        (other) =>
          other.category === pair.category && other.channel === pair.channel,
      ) === index,
  )
  .toSorted(
    (first, second) =>
      first.category.localeCompare(second.category) ||
      first.channel.localeCompare(second.channel),
  );

export function isSettablePreferencePair(
  category: string,
  channel: string,
): boolean {
  return settablePreferencePairs.some(
    (pair) => pair.category === category && pair.channel === channel,
  );
}

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
