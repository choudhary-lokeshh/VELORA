import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import {
  acquisitionEventNames,
  inviteCodeLength,
  maximumAcquisitionParameterCharacters,
  type AcquisitionEventName,
} from './policy.js';

/**
 * GROWTH-owned persistence.
 *
 * GROWTH owns how somebody arrived and nothing that follows from arriving. The
 * list it does not own is the load-bearing part: no balance, no entitlement, no
 * standing, no reward, no profile, and no session. An invitation is a code and
 * an owner; an attribution is one row saying where one account came from; a
 * window is two instants and a name. Anything that would turn one of those into
 * a permission belongs to the domain that owns the permission.
 *
 * Every account reference is an opaque USERS identifier with no foreign key,
 * on the rule `docs/architecture/05-data-ownership.md` records. GROWTH cannot
 * read a profile, cannot resolve a name, and never learns anything about the
 * people on either side of an invitation beyond that they are two different
 * identifiers.
 *
 * **Nothing here is a page view.** There is no address column, no referer, no
 * user agent, no IP address, and no session identifier anywhere in this schema.
 * A funnel built out of those would be surveillance with a business
 * justification attached, and it is not needed: what the platform has to know
 * is how many invitations were made, how many were opened, and how many signups
 * each channel produced, and all three are counted from rows that already exist
 * for a product reason.
 *
 * Retention is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, like every other
 * personal-data class in this repository. Nothing expires and there is no
 * sweep; an approved schedule later applies as a deletion pass.
 */

/**
 * One person's invitation link.
 *
 * One per account, forever. A person who has sent their link to six people and
 * then mints a seventh code has broken six links they already sent, and nothing
 * in this product needs per-share accounting badly enough to pay for that. The
 * uniqueness on the owner is what enforces it, so two taps in the same
 * millisecond produce one link rather than two.
 *
 * `code` is random rather than derived. A code built from an account identifier
 * would publish that identifier to everybody who was ever sent a link.
 */
export const growthInvites = pgTable(
  'growth_invites',
  {
    code: text('code').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    /** Opaque USERS account reference. No foreign key, by ownership rule. */
    inviterUserId: uuid('inviter_user_id').notNull(),
    /**
     * When the owner withdrew this link, if they ever did.
     *
     * A revoked link stops attributing and keeps its row, because the
     * attributions it already produced still point at it and a deleted
     * invitation would orphan them.
     */
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [
    uniqueIndex('growth_invites_code_uk').on(table.code),
    // One link per account, enforced by the database rather than by a prior
    // read: two presses a few milliseconds apart both pass a read.
    uniqueIndex('growth_invites_inviter_uk').on(table.inviterUserId),
    check(
      'growth_invites_code_shape_check',
      sql`${table.code} ~ '^[a-z0-9]{22}$'`,
    ),
    check(
      'growth_invites_code_length_check',
      lengthBetween(table.code, inviteCodeLength, inviteCodeLength),
    ),
  ],
);

/**
 * Where one account came from, recorded once and never again.
 *
 * The primary key is the account itself, which is the whole idempotency design:
 * a second attribution for the same person is not refused by a service
 * remembering to check, it is impossible. That is what makes "attributed
 * exactly once" a property of the schema rather than a promise.
 *
 * Both an invitation and a campaign can be absent, and the row still exists —
 * a signup that came from nowhere anybody tracked is a real answer, and
 * recording it is what makes the channel counts add up to the signups.
 *
 * The check that an inviter is not the invited account is the anti-self-referral
 * rule, stated where it cannot be forgotten. The service refuses it first with a
 * better answer; this is what holds if the service is ever wrong.
 */
export const growthSignupAttributions = pgTable(
  'growth_signup_attributions',
  {
    attributedAt: timestamptz('attributed_at').notNull(),
    campaign: text('campaign'),
    content: text('content'),
    /** The invitation this account arrived through, if it arrived through one. */
    inviteId: uuid('invite_id').references(() => growthInvites.id),
    /** Denormalised from the invitation so a count needs no join. */
    inviterUserId: uuid('inviter_user_id'),
    medium: text('medium'),
    /** `invite`, a normalised campaign source, or `direct`. Never null. */
    source: text('source').notNull(),
    /** The account this is about. One row per account, forever. */
    userId: uuid('user_id').primaryKey(),
  },
  (table) => [
    index('growth_signup_attributions_recency_idx').on(
      table.attributedAt,
      table.userId,
    ),
    index('growth_signup_attributions_source_idx').on(
      table.source,
      table.attributedAt,
    ),
    index('growth_signup_attributions_inviter_idx')
      .on(table.inviterUserId)
      .where(sql`${table.inviterUserId} is not null`),
    // Nobody invites themselves. The service refuses this with a better
    // explanation; the constraint is what makes it true whatever the service
    // does.
    check(
      'growth_signup_attributions_self_referral_check',
      sql`${table.inviterUserId} is null or ${table.inviterUserId} <> ${table.userId}`,
    ),
    // An invitation and the inviter it belongs to are set and cleared together.
    check(
      'growth_signup_attributions_invite_pairing_check',
      sql`(${table.inviteId} is null) = (${table.inviterUserId} is null)`,
    ),
    check(
      'growth_signup_attributions_source_length_check',
      lengthBetween(table.source, 1, maximumAcquisitionParameterCharacters),
    ),
  ],
);

/**
 * What GROWTH saw happen, in counts rather than in narratives.
 *
 * Four names, closed by a constraint, and no payload column — which is what
 * makes it structurally impossible for a message, a profile field, or a token
 * to end up in here. A row carries what happened, when, and which invitation or
 * channel it concerned, and there is nowhere to put anything else.
 *
 * `dedupeKey` is the visitor's own opening key, and it is why refreshing an
 * invitation page ten times is one opening. It identifies nobody: it is
 * generated by the browser for this one purpose, is never joined to an account,
 * and is worth nothing to anybody who reads it.
 */
export const growthAcquisitionEvents = pgTable(
  'growth_acquisition_events',
  {
    campaign: text('campaign'),
    /** The visitor's own key for one opening, so a refresh is not a second one. */
    dedupeKey: text('dedupe_key'),
    id: uuid('id').primaryKey(),
    inviteId: uuid('invite_id').references(() => growthInvites.id),
    medium: text('medium'),
    name: text('name').notNull().$type<AcquisitionEventName>(),
    occurredAt: timestamptz('occurred_at').notNull(),
    source: text('source'),
    /** The account this concerned, where there was one. Never for an opening. */
    subjectId: uuid('subject_id'),
  },
  (table) => [
    // The counting read: how many of each kind, since when.
    index('growth_acquisition_events_name_recency_idx').on(
      table.name,
      table.occurredAt,
    ),
    // One opening per visitor per event kind, whatever a refresh key does.
    uniqueIndex('growth_acquisition_events_dedupe_uk')
      .on(table.name, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    check(
      'growth_acquisition_events_name_check',
      inList(table.name, acquisitionEventNames),
    ),
  ],
);

/**
 * A time VELORA asks people to be looking at once.
 *
 * The smallest thing that can concentrate people without becoming an events
 * platform: two instants, a name, and an address. There is no host, no
 * attendee, no capacity, no registration, and no count — a count would be the
 * one number on this whole feature that nothing can know, and inventing it
 * would make every other honest number here worth less.
 *
 * State is derived from the two instants on every read rather than stored.
 * A stored state is wrong for exactly as long as it takes something to update
 * it, and the thing that would update it is a job that can be late, restarted,
 * or not running — which is precisely the failure mode the RTC and live
 * sweeps have already taught this repository about.
 */
export const growthLiveWindows = pgTable(
  'growth_live_windows',
  {
    /** When an operator withdrew it. A cancelled window stops being published. */
    cancelledAt: timestamptz('cancelled_at'),
    createdAt: timestamptz('created_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    id: uuid('id').primaryKey(),
    /** The shareable address. Human-readable on purpose: people paste it. */
    slug: text('slug').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    title: text('title').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('growth_live_windows_slug_uk').on(table.slug),
    index('growth_live_windows_schedule_idx').on(table.startsAt, table.endsAt),
    check(
      'growth_live_windows_slug_shape_check',
      sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'`,
    ),
    check(
      'growth_live_windows_title_length_check',
      lengthBetween(table.title, 2, 80),
    ),
    // A window that ends before it starts is not a window, and a window longer
    // than a day is opening hours with a name on it.
    check(
      'growth_live_windows_order_check',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      'growth_live_windows_duration_check',
      sql`${table.endsAt} <= ${table.startsAt} + interval '24 hours'`,
    ),
  ],
);
