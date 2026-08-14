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
 * Both are transactional and both follow from something the recipient
 * deliberately took part in. There is no marketing kind, and adding one is a
 * consent decision rather than a schema change.
 */
export const notificationKindSchema = z.enum([
  /** Somebody the recipient is in a conversation with sent them a message. */
  'message_received',
  /** A pending introduction the recipient took part in became mutual. */
  'introduction_mutual',
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
