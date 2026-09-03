import { z } from 'zod';

import { idempotencyKeySchema } from './product.js';

/**
 * Consumer support contract.
 *
 * The complaint this answers is the flattest one in the whole category: there
 * is no way to reach anybody. Competitor reviews say it in the same words over
 * and over — "there is no support", "they tell you to email and nobody
 * replies" — and an address in a policy document is not a support path, because
 * the person using it can never tell whether anything happened.
 *
 * So the whole of this contract is shaped around one property: after somebody
 * submits, they hold a reference they can read back, and a status that is the
 * server's answer rather than a promise made by a screen. Everything else here
 * is subordinate to that.
 *
 * **This is not the safety surface and must never become one.** A report is
 * evidence about another person, filed under rules that forbid telling the
 * reporter what happened next; a ticket is somebody asking for help with their
 * own account, and the whole point is that they *are* told what happened next.
 * The two have different owners, different lifecycles, and different
 * disclosure rules, and folding either into the other would break one of them.
 * A person who needs to report somebody is pointed at reporting, not at this.
 *
 * **No response-time promise appears anywhere in this contract.** There is no
 * `respondBy`, no `slaHours`, and no queue position, because VELORA has nobody
 * on a rota and a deadline it cannot keep is worse than no deadline at all.
 */

/**
 * What somebody needs help with.
 *
 * Seven, chosen to match how a person describes their own problem rather than
 * how the platform is built: they know they cannot sign in, not that AUTH
 * refused a session. Deliberately short — a list long enough to be
 * comprehensive is a list somebody abandons halfway down, and a mis-filed
 * ticket costs an operator one read while an abandoned one costs a user.
 */
export const supportCategorySchema = z.enum([
  /** Signing in, signing up, session or account trouble. */
  'account_access',
  /** Live conversations: matching, calls, audio, video, reconnecting. */
  'live',
  /** Somebody's behaviour, a block, a report, or a decision about the account. */
  'safety',
  /** Coins, a purchase, a balance, or anything that moved money. */
  'wallet',
  /** The Inbox: messages that did not send, arrive, or persist. */
  'messaging',
  /** Profile, photographs, languages, preferences. */
  'profile',
  'other',
]);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

/**
 * Where a ticket is, in words that are true.
 *
 * Four states, each of which corresponds to something that has actually
 * happened rather than to something intended. `received` means the platform
 * holds it and nobody has looked yet — said plainly, because "we are on it"
 * when nobody is on it is the lie that makes people stop believing status
 * altogether. `in_review` means an operator has picked it up. `resolved` means
 * an operator decided it is answered; `closed` means it was ended without one,
 * which is a different fact and is not disguised as the first.
 */
export const supportTicketStatusSchema = z.enum([
  'received',
  'in_review',
  'resolved',
  'closed',
]);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

/** Bounds on what somebody may write. Shorter than a report, and on purpose. */
export const minimumSupportSubjectCharacters = 3;
export const maximumSupportSubjectCharacters = 120;
export const minimumSupportDescriptionCharacters = 10;
export const maximumSupportDescriptionCharacters = 4_000;

/**
 * The shape of the reference somebody is given.
 *
 * Published so a surface can validate one a person typed back in, and so no
 * client has to invent a pattern from an example. It is deliberately
 * human-transcribable: grouped, upper case, and drawn from an alphabet with no
 * `I`, `L`, `O`, or `U` — the four that get read back wrong, plus the one that
 * turns a random string into a word nobody wants to read out.
 */
export const supportReferencePattern =
  /^VS-[0-9A-HJ-KMNP-TV-Z]{4}-[0-9A-HJ-KMNP-TV-Z]{4}$/u;
export const supportReferenceSchema = z.string().regex(supportReferencePattern);

export const createSupportTicketRequestSchema = z
  .object({
    category: supportCategorySchema,
    /** Makes submission retry-safe. Scoped by the server to its owner. */
    clientTicketId: idempotencyKeySchema,
    description: z
      .string()
      .min(minimumSupportDescriptionCharacters)
      .max(maximumSupportDescriptionCharacters),
    subject: z
      .string()
      .min(minimumSupportSubjectCharacters)
      .max(maximumSupportSubjectCharacters),
  })
  .strict();

/**
 * A ticket as its own owner sees it.
 *
 * Their own words come back, which is the one place this contract deliberately
 * differs from the safety one: a report's narrative is evidence about somebody
 * else and echoing it would turn an evidence store into a readable one, while a
 * ticket is a person's account of their own problem and being able to re-read
 * it is most of what "see your ticket" means.
 *
 * What never comes back is an operator's note, an operator's identity, a queue,
 * or anything about how the ticket is being handled internally. There is no
 * field for any of them, so no response can carry one.
 */
export const supportTicketSchema = z
  .object({
    category: supportCategorySchema,
    createdAt: z.iso.datetime(),
    description: z.string(),
    id: z.uuid(),
    /** What to quote when asking about it. Stable for the life of the ticket. */
    reference: supportReferenceSchema,
    status: supportTicketStatusSchema,
    subject: z.string(),
    /** When the status last moved. Equal to `createdAt` until it does. */
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const supportTicketListResponseSchema = z
  .object({
    nextCursor: z.string().optional(),
    /** Newest first. Paging is keyset on immutable values. */
    tickets: z.array(supportTicketSchema),
  })
  .strict();

export type SupportTicket = z.infer<typeof supportTicketSchema>;
export type SupportTicketListResponse = z.infer<
  typeof supportTicketListResponseSchema
>;
export type CreateSupportTicketRequest = z.infer<
  typeof createSupportTicketRequestSchema
>;

/* ============================ Operator surface ======================= */

/**
 * Longest internal note an operator may attach.
 *
 * Short on purpose. This is a working note on a ticket, not a case file: the
 * moderation architecture already owns evidence, findings, and decisions, and a
 * note here that grew into one of those would be an unaudited copy of a record
 * that belongs somewhere else.
 */
export const maximumSupportNoteCharacters = 1_000;

/**
 * One ticket as an operator sees it.
 *
 * The owner's account identifier is present because an operator has to be able
 * to look the person up through the existing account surface in order to help
 * them, and it is deliberately the only thing here the owner's own view does
 * not carry. There is still no email address, no display name, and no device
 * detail: this surface answers "what did somebody ask for help with", and every
 * other question about that account is another surface's to answer.
 */
export const adminSupportTicketSchema = supportTicketSchema
  .extend({
    /** Opaque consumer account reference. Resolvable only through ADMIN. */
    ownerId: z.uuid(),
  })
  .strict();

export const adminSupportTicketListResponseSchema = z
  .object({
    nextCursor: z.string().optional(),
    tickets: z.array(adminSupportTicketSchema),
  })
  .strict();

/**
 * One thing that happened to a ticket, in the order it happened.
 *
 * Append-only and operator-facing. `note` is present only on a note entry and
 * is never published to the ticket's owner — an operator's working thought
 * about somebody's problem is not something that person is owed, and a field
 * that could carry one into a consumer response is a field that eventually
 * does.
 */
export const adminSupportTicketEventSchema = z
  .object({
    /** Opaque operator reference. Never an operator's name. */
    actorReference: z.string().optional(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    kind: z.enum(['opened', 'status_changed', 'note']),
    note: z.string().optional(),
    status: supportTicketStatusSchema.optional(),
  })
  .strict();

export const adminSupportTicketDetailResponseSchema = z
  .object({
    events: z.array(adminSupportTicketEventSchema),
    ticket: adminSupportTicketSchema,
  })
  .strict();

/**
 * Moving a ticket, and optionally saying why.
 *
 * One shape rather than two endpoints, because an operator who changed a status
 * and then failed to record why would leave the next operator with a state and
 * no account of it. The note is optional rather than required: a great many
 * status changes are self-explanatory, and a mandatory field on a routine
 * action is a field that fills with a full stop.
 */
export const adminUpdateSupportTicketRequestSchema = z
  .object({
    note: z.string().min(1).max(maximumSupportNoteCharacters).optional(),
    status: supportTicketStatusSchema,
    ticketId: z.uuid(),
  })
  .strict();

export type AdminSupportTicket = z.infer<typeof adminSupportTicketSchema>;
export type AdminSupportTicketListResponse = z.infer<
  typeof adminSupportTicketListResponseSchema
>;
export type AdminSupportTicketDetailResponse = z.infer<
  typeof adminSupportTicketDetailResponseSchema
>;
