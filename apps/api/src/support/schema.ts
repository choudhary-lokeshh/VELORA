import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import {
  maximumSupportDescriptionCharacters,
  maximumSupportNoteCharacters,
  maximumSupportSubjectCharacters,
  minimumSupportDescriptionCharacters,
  minimumSupportSubjectCharacters,
  maximumSupportClientTicketIdCharacters,
  minimumSupportClientTicketIdCharacters,
  supportCategories,
  supportEventKinds,
  supportTicketStatuses,
  type SupportCategory,
  type SupportEventKind,
  type SupportTicketStatus,
} from './policy.js';

/**
 * SUPPORT-owned persistence.
 *
 * SUPPORT owns what somebody asked for help with and what an operator did
 * about it. It owns nothing else, and the list of things it deliberately does
 * not own is the important part: no enforcement, no report, no case, no
 * evidence, no decision, no account status. Those belong to TRUST & SAFETY and
 * to USERS, and a support ticket that could reach any of them would be an
 * enforcement path with none of the audit, dual control, or appeal rights the
 * real one carries.
 *
 * The owner is an opaque consumer account reference with no foreign key, on the
 * rule `docs/architecture/05-data-ownership.md` records.
 *
 * **Nothing here is a channel.** There is no address column, no phone number,
 * no device identifier, no attachment, and no outbound message record. A ticket
 * is answered by an operator reading it in Platform Admin and moving its
 * status, which the owner reads back through their own ticket. That is the
 * whole mechanism, and it is the reason this needs no provider, no hosted help
 * desk, and no spend: the one path a person uses when everything else has
 * failed them must not itself depend on something that can fail.
 *
 * Retention is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, like every other
 * personal-data class in this repository. Nothing expires, there is no sweep,
 * and no correctness rule depends on a row being physically gone, so an
 * approved schedule later applies as a deletion pass.
 */

/**
 * One request for help.
 *
 * `reference` is what a person quotes. It is generated rather than derived, so
 * it discloses no ordering, no volume, and nothing about anybody else — a
 * sequential reference would tell every user how many tickets the platform has
 * ever had, which is a business fact nobody decided to publish.
 *
 * `clientTicketId` is the submitter's own idempotency key, unique per owner. It
 * is what makes a retry after a lost response one ticket instead of two, which
 * matters most on exactly the flaky connection that produced the ticket.
 */
export const supportTickets = pgTable(
  'support_tickets',
  {
    category: text('category').notNull().$type<SupportCategory>(),
    /** The submitter's idempotency key. Unique within one owner. */
    clientTicketId: text('client_ticket_id').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    description: text('description').notNull(),
    id: uuid('id').primaryKey(),
    /** Opaque consumer account reference. No foreign key, by ownership rule. */
    ownerId: uuid('owner_id').notNull(),
    /** What the person quotes. Generated, never derived from a counter. */
    reference: text('reference').notNull(),
    /** Durable total order; timestamps and random UUIDs can tie. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    status: text('status').notNull().$type<SupportTicketStatus>(),
    subject: text('subject').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // One ticket per submission, however many times it is submitted. The index
    // is the guarantee rather than a prior read: two taps a few milliseconds
    // apart both pass a read and only one passes this.
    uniqueIndex('support_tickets_owner_client_uk').on(
      table.ownerId,
      table.clientTicketId,
    ),
    uniqueIndex('support_tickets_reference_uk').on(table.reference),
    uniqueIndex('support_tickets_sequence_uk').on(table.sequence),
    // "My tickets, newest first", which is the only read the owner has.
    index('support_tickets_owner_recency_idx').on(
      table.ownerId,
      table.createdAt,
      table.id,
    ),
    // The operator queue: what is still somebody's to answer, oldest first.
    index('support_tickets_open_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.status} in ('received', 'in_review')`),
    index('support_tickets_status_recency_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      'support_tickets_category_check',
      inList(table.category, supportCategories),
    ),
    check(
      'support_tickets_status_check',
      inList(table.status, supportTicketStatuses),
    ),
    check(
      'support_tickets_subject_length_check',
      lengthBetween(
        table.subject,
        minimumSupportSubjectCharacters,
        maximumSupportSubjectCharacters,
      ),
    ),
    check(
      'support_tickets_description_length_check',
      lengthBetween(
        table.description,
        minimumSupportDescriptionCharacters,
        maximumSupportDescriptionCharacters,
      ),
    ),
    check(
      'support_tickets_client_ticket_id_length_check',
      lengthBetween(
        table.clientTicketId,
        minimumSupportClientTicketIdCharacters,
        maximumSupportClientTicketIdCharacters,
      ),
    ),
    // The published reference shape, enforced by the database rather than only
    // by the generator. A reference that did not match would be one a person
    // could not type back into the surface that validates it.
    check(
      'support_tickets_reference_shape_check',
      sql`${table.reference} ~ '^VS-[0-9A-HJ-KMNP-TV-Z]{4}-[0-9A-HJ-KMNP-TV-Z]{4}$'`,
    ),
    check(
      'support_tickets_updated_after_creation_check',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * What happened to a ticket, in the order it happened.
 *
 * Append-only, and enforced as such by a trigger the migration adds rather than
 * only by convention: this is the record an operator relies on when a person
 * says "somebody already told me it was fixed", and a record that can be edited
 * is not that record.
 *
 * `note` is operator-facing and never published to the ticket's owner. There is
 * no route that returns one to a consumer, and no consumer response shape has a
 * field it could occupy.
 */
export const supportTicketEvents = pgTable(
  'support_ticket_events',
  {
    /** Opaque operator reference. Absent when the owner's own act made it. */
    actorReference: text('actor_reference'),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull().$type<SupportEventKind>(),
    note: text('note'),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    /** The status the ticket moved to. Absent on a note. */
    status: text('status').$type<SupportTicketStatus>(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id),
  },
  (table) => [
    index('support_ticket_events_ticket_idx').on(
      table.ticketId,
      table.sequence,
    ),
    uniqueIndex('support_ticket_events_sequence_uk').on(table.sequence),
    check(
      'support_ticket_events_kind_check',
      inList(table.kind, supportEventKinds),
    ),
    check(
      'support_ticket_events_status_check',
      sql`${table.status} is null or ${inList(table.status, supportTicketStatuses)}`,
    ),
    // A lifecycle entry names the state it moved to and a note does not. Without
    // this, "what status was this ticket in when the note was written" would be
    // answerable two ways for the same row.
    check(
      'support_ticket_events_shape_check',
      sql`(${table.kind} = 'note') = (${table.status} is null)`,
    ),
    check(
      'support_ticket_events_note_length_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${sql.raw(String(maximumSupportNoteCharacters))}`,
    ),
    // A note with nothing written on it is not a note.
    check(
      'support_ticket_events_note_presence_check',
      sql`${table.kind} <> 'note' or ${table.note} is not null`,
    ),
  ],
);
