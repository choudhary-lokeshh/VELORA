import { z } from 'zod';

/**
 * In-app notification contract.
 *
 * This is the *in-app* surface and nothing else. External delivery — push,
 * email, SMS — is a separate obligation with its own durable record, its own
 * retry budget, and its own delivery-time safety recheck, and no part of that
 * record is published here. A consumer never sees a lease, an attempt count, a
 * provider reference, a failure reason, or a suppression reason: those are
 * operator facts, and `safety_block` in particular would disclose another
 * person's block.
 *
 * What a notice carries is the minimum a client needs to render a line and
 * follow it: what kind of thing happened, who it involves, and which object to
 * open. There is no message body, no display name, and no preview — the client
 * already has an authorized route to fetch those, and a field that never enters
 * this contract cannot leak through a notification list.
 */

/**
 * The kinds of thing the platform tells somebody about in V1.
 *
 * Every one is transactional and every one follows from something the
 * recipient deliberately took part in. There is no marketing kind, and adding
 * one is a consent decision rather than a schema change.
 */
export const notificationKindSchema = z.enum([
  /** Somebody the recipient is in a conversation with sent them a message. */
  'message_received',
  /** A pending introduction the recipient took part in became mutual. */
  'introduction_mutual',
  /** Somebody the recipient is introduced to is calling them, right now. */
  'call_incoming',
  /**
   * A call the recipient did not answer. Derived from the invitation's own
   * deadline rather than from whether a device ever rang, so it stays true
   * when a push is lost.
   */
  'call_missed',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/**
 * One notice as its recipient sees it.
 *
 * `subjectId` is the other person the notice is about. It discloses nothing:
 * the recipient is already in a conversation or a mutual introduction with
 * them, so the identifier is one they can already resolve through an authorized
 * route. Notices whose pair may no longer interact are not returned at all.
 */
export const notificationSchema = z
  .object({
    /** Deep-link target when the notice is about a conversation. */
    conversationId: z.uuid().optional(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    /** Deep-link target when the notice is about an introduction. */
    introductionId: z.uuid().optional(),
    kind: notificationKindSchema,
    /** Absent while unread. Set once, and never cleared back to unread. */
    readAt: z.iso.datetime().optional(),
    subjectId: z.uuid(),
  })
  .strict();

export const notificationListResponseSchema = z
  .object({
    /** Newest first. Paging is keyset on immutable values. */
    notifications: z.array(notificationSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

/**
 * Largest number of notices one call may acknowledge.
 *
 * A client marks what it has actually rendered, which is one page at most, so
 * the bound is a page. It exists so an acknowledgement cannot become an
 * unbounded write.
 */
export const maximumNotificationReadBatch = 50;

export const markNotificationsReadRequestSchema = z
  .object({
    notificationIds: z.array(z.uuid()).min(1).max(maximumNotificationReadBatch),
  })
  .strict();

/**
 * What the acknowledgement actually changed.
 *
 * Identifiers the caller does not own are silently absent rather than refused,
 * so this endpoint cannot be used to test whether a notification exists.
 */
export const notificationReadResponseSchema = z
  .object({ readIds: z.array(z.uuid()) })
  .strict();

export type Notification = z.infer<typeof notificationSchema>;
export type NotificationListResponse = z.infer<
  typeof notificationListResponseSchema
>;

/**
 * What a person may decide about, and on what.
 *
 * The vocabulary is the platform's, not the client's: a surface renders what
 * this endpoint returns rather than hard-coding a list of switches, so adding
 * a category never means shipping a client to match.
 */
export const notificationCategorySchema = z.enum([
  'account_security',
  'safety_legal',
  'direct_message',
  'introduction',
  'call',
  'marketing',
]);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const notificationChannelSchema = z.enum(['push', 'email', 'sms']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/**
 * One decision, as the recipient sees it.
 *
 * `enabled` is the effective answer rather than the stored one: a category
 * nobody has expressed a preference about reports its default, so a client
 * never has to know what the defaults are or when they changed.
 */
export const notificationPreferenceSchema = z
  .object({
    category: notificationCategorySchema,
    channel: notificationChannelSchema,
    enabled: z.boolean(),
  })
  .strict();

/**
 * Every decision this person can actually make.
 *
 * Only pairs the platform has an approved template for appear. A category and
 * channel combination nothing can be sent on is not a setting, it is a switch
 * that does nothing, and offering one would misrepresent what the platform
 * does. Mandatory categories never appear either — they are not offers.
 */
export const notificationPreferencesResponseSchema = z
  .object({ preferences: z.array(notificationPreferenceSchema) })
  .strict();

export const updateNotificationPreferenceRequestSchema =
  notificationPreferenceSchema;

export type NotificationPreference = z.infer<
  typeof notificationPreferenceSchema
>;
export type NotificationPreferencesResponse = z.infer<
  typeof notificationPreferencesResponseSchema
>;
