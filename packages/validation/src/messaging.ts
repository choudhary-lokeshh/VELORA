import { z } from 'zod';

import { idempotencyKeySchema } from './product.js';
import { maximumMessageBodyCharacters } from './messaging-bounds.js';

export { maximumMessageBodyCharacters } from './messaging-bounds.js';

/**
 * Messaging contract.
 *
 * V1 is text only. There is no attachment, no voice note, no editing, no
 * disappearing message, and no real-time transport in this contract, because
 * none of those are approved for V1 and a schema is the easiest place for an
 * unapproved capability to appear by accident.
 *
 * **End-to-end encryption is not implemented.** Message bodies are stored in a
 * form the server can read, because moderation, reporting, and lawful safety
 * review require server-side product authority over message content. Nothing in
 * this contract, in the API documentation it generates, or in any surface built
 * on it may describe messaging as end-to-end encrypted.
 */

/**
 * The other person in a conversation.
 *
 * Deliberately smaller than a discovery candidate: a conversation list needs a
 * name and a picture. It does not need a bio, a region, a language overlap, or
 * anything else that describes why the two people were introduced.
 *
 * `media` carries asset references exchanged at `/v1/media/deliveries` for a
 * short-lived address, on the same terms as everywhere else: the exchange
 * re-decides visibility, so a reference held after a block stops resolving.
 */
export const conversationCounterpartSchema = z
  .object({
    displayName: z.string(),
    id: z.uuid(),
    media: z
      .array(
        z.object({ id: z.uuid(), position: z.number().int().min(0) }).strict(),
      )
      .max(8),
  })
  .strict();

/**
 * `active` is the only state V1 produces. `closed` exists because enforcement
 * and account lifecycle can end a conversation, and a client has to be able to
 * render that without being told why.
 */
export const conversationStateSchema = z.enum(['active', 'closed']);

/**
 * The newest durable message, reduced to what a conversation row needs.
 *
 * `bodyPreview` is whitespace-normalized and bounded by MESSAGING. It is not a
 * client cache of a draft or a delivery claim. The relative sender avoids
 * publishing another identifier and lets a surface truthfully say "You".
 */
export const conversationLastMessageSchema = z
  .object({
    bodyPreview: z.string().min(1).max(160),
    createdAt: z.iso.datetime(),
    sender: z.enum(['caller', 'counterpart']),
    sequence: z.number().int().min(1),
  })
  .strict();

/** Why this thread exists, and the relationship operation it authorizes. */
export const conversationRelationshipSchema = z
  .object({
    introductionId: z.uuid(),
    kind: z.literal('mutual_introduction'),
  })
  .strict();

export const conversationSchema = z
  .object({
    counterpart: conversationCounterpartSchema,
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    /**
     * When the conversation last moved. Equal to its creation instant while no
     * message has been sent, so a client never has to special-case an empty
     * conversation to sort a list.
     */
    lastActivityAt: z.iso.datetime(),
    /** Absent only while the conversation has no messages. */
    lastMessage: conversationLastMessageSchema.optional(),
    /** Ordering position of the newest message, or 0 when there is none. */
    lastMessageSequence: z.number().int().min(0),
    /** Highest position the calling participant has acknowledged reading. */
    lastReadSequence: z.number().int().min(0),
    relationship: conversationRelationshipSchema,
    state: conversationStateSchema,
  })
  .strict();

export const conversationListResponseSchema = z
  .object({
    conversations: z.array(conversationSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

/**
 * C0 and C1 controls other than tab, newline, and carriage return. Named as
 * escapes rather than written literally so the source stays readable text.
 */
const controlCharacters =
  // eslint-disable-next-line no-control-regex -- naming them is the purpose.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/**
 * A message body.
 *
 * Bounded, non-blank, and free of control characters other than tab, newline,
 * and carriage return. Those characters carry no text; what they do carry is
 * the ability to make one string render as another, which is the beginning of
 * every impersonation trick a chat product has to refuse.
 */
export const messageBodySchema = z
  .string()
  .min(1)
  .max(maximumMessageBodyCharacters)
  .refine(
    (value) => value.trim().length > 0,
    'A message must contain something other than whitespace',
  )
  .refine(
    (value) => !controlCharacters.test(value),
    'A message must not contain control characters',
  );

/**
 * Client-supplied identifier that makes a send idempotent, scoped by the server
 * to the conversation and the sender. It is the same bounded opaque shape every
 * other idempotency key in the product uses.
 */
export const clientMessageIdSchema = idempotencyKeySchema;

export const messageSchema = z
  .object({
    body: z.string(),
    clientMessageId: clientMessageIdSchema,
    conversationId: z.uuid(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    senderId: z.uuid(),
    /**
     * Server-assigned position in the conversation. Strictly increasing and
     * unique within a conversation, and assigned by the server rather than
     * derived from any clock a client controls. It is not promised to be
     * contiguous.
     */
    sequence: z.number().int().min(1),
  })
  .strict();

export const messageListResponseSchema = z
  .object({
    conversationId: z.uuid(),
    /** Newest first. Paging is keyset on the immutable sequence. */
    messages: z.array(messageSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

/**
 * A conversation is opened from a mutual introduction and from nothing else.
 * Repeating the call returns the conversation that already exists.
 */
export const createConversationRequestSchema = z
  .object({ introductionId: z.uuid() })
  .strict();

export const sendMessageRequestSchema = z
  .object({
    body: messageBodySchema,
    clientMessageId: clientMessageIdSchema,
    conversationId: z.uuid(),
  })
  .strict();

/** Read state is monotonic: a lower position than the one already recorded is
 * accepted and changes nothing, so an out-of-order client cannot un-read. */
export const markConversationReadRequestSchema = z
  .object({
    conversationId: z.uuid(),
    sequence: z.number().int().min(0),
  })
  .strict();

export const conversationReadResponseSchema = z
  .object({
    conversationId: z.uuid(),
    lastReadSequence: z.number().int().min(0),
  })
  .strict();

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationListResponse = z.infer<
  typeof conversationListResponseSchema
>;
export type Message = z.infer<typeof messageSchema>;
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
