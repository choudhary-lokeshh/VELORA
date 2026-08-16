import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  digestColumn,
  inList,
  isHexDigest,
  lengthBetween,
  nullablePairing,
  timestamptz,
} from '../database/columns.js';
import {
  clubLifecycles,
  clubSlugPattern,
  creatorContentLifecycles,
  creatorContentVisibilities,
  maximumCreatorContentBodyLength,
  maximumCreatorContentSummaryLength,
  maximumCreatorContentTitleLength,
  maximumClubDescriptionLength,
  maximumClubNameLength,
  maximumContentMedia,
  membershipSources,
  membershipStates,
  minimumClubNameLength,
  minimumCreatorContentTitleLength,
  type ClubLifecycle,
  type CreatorContentLifecycle,
  type CreatorContentVisibility,
  type MembershipSource,
  type MembershipState,
} from './policy.js';

/**
 * PRIVATE CLUBS-owned persistence.
 *
 * `docs/architecture/03-domain-boundaries.md` gives this domain the club
 * configuration, the content catalog, membership, and entitlement, and
 * explicitly not creator identity proof or provider charge truth. The creator a
 * row belongs to is therefore an opaque identifier with no foreign key: a
 * cross-domain reference is a stable identifier rather than shared schema, and
 * a cascade from `creators_accounts` would let CREATORS silently destroy a
 * catalog that `docs/flows/account-deletion.md` says the owning domain must
 * coordinate.
 *
 * Nothing here is money. There is no price, offer, purchase, subscription, or
 * earnings column, because creator subscriptions and PPV are a later phase
 * owned by BILLING and a column that exists is a column something eventually
 * fills.
 */
export const creatorContent = pgTable(
  'clubs_content',
  {
    archivedAt: timestamptz('archived_at'),
    body: text('body'),
    /**
     * The club this item belongs to, if any. Nullable because most of a
     * creator's catalog is not club-scoped, and it is what makes
     * `members_only` mean something: an item with no club has nobody to
     * admit, so it stays unreachable however it is marked.
     */
    clubId: uuid('club_id'),
    createdAt: timestamptz('created_at').notNull(),
    /** Opaque CREATORS reference. No foreign key, by ownership rule. */
    creatorId: uuid('creator_id').notNull(),
    id: uuid('id').primaryKey(),
    lifecycle: text('lifecycle').notNull().$type<CreatorContentLifecycle>(),
    publishedAt: timestamptz('published_at'),
    summary: text('summary'),
    title: text('title').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
    visibility: text('visibility').notNull().$type<CreatorContentVisibility>(),
  },
  (table) => [
    // The catalog's only hot query: one creator's items, newest published
    // first. Partial, so a creator with a long history of drafts still answers
    // the public page from an index the size of what is actually published,
    // and ordered exactly as the cursor pages so the planner needs no sort.
    index('clubs_content_published_idx')
      .on(table.creatorId, table.publishedAt, table.id)
      .where(sql`${table.lifecycle} = 'published'`),
    // The Studio list, which is every lifecycle for one creator.
    index('clubs_content_creator_idx').on(
      table.creatorId,
      table.createdAt,
      table.id,
    ),
    check(
      'clubs_content_lifecycle_check',
      inList(table.lifecycle, creatorContentLifecycles),
    ),
    check(
      'clubs_content_visibility_check',
      inList(table.visibility, creatorContentVisibilities),
    ),
    check(
      'clubs_content_title_check',
      lengthBetween(
        table.title,
        minimumCreatorContentTitleLength,
        maximumCreatorContentTitleLength,
      ),
    ),
    check(
      'clubs_content_summary_check',
      sql`${table.summary} is null or ${lengthBetween(table.summary, 1, maximumCreatorContentSummaryLength)}`,
    ),
    check(
      'clubs_content_body_check',
      sql`${table.body} is null or ${lengthBetween(table.body, 1, maximumCreatorContentBodyLength)}`,
    ),
    // A published item has a publication instant and nothing else does, so no
    // row can be reachable by a visitor without recording when it became so.
    check(
      'clubs_content_published_shape_check',
      sql`(${table.lifecycle} = 'published') = (${table.publishedAt} is not null)`,
    ),
    check(
      'clubs_content_archived_shape_check',
      sql`(${table.lifecycle} = 'archived') = (${table.archivedAt} is not null)`,
    ),
    check('clubs_content_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * Images attached to a content item.
 *
 * PRIVATE CLUBS owns the attachment and the ordering; MEDIA owns the bytes.
 * The asset reference is opaque and carries no foreign key, on the same rule
 * every other cross-domain reference here follows.
 *
 * Whether an attachment may actually be shown is never answered here. It
 * depends on the item's lifecycle and visibility, on the viewer's entitlement
 * to the club, on the creator's standing, and on the content safety gate — and
 * a row in this table means only that a creator put an image on an item.
 */
export const creatorContentMedia = pgTable(
  'clubs_content_media',
  {
    contentId: uuid('content_id')
      .notNull()
      .references(() => creatorContent.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    mediaAssetId: uuid('media_asset_id').notNull(),
    /** Dense zero-based order within the item. */
    position: integer('position').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // One asset belongs to one item, so detaching and reattaching elsewhere is
    // an explicit act rather than a silent second reference to the same bytes.
    uniqueIndex('clubs_content_media_asset_uk').on(table.mediaAssetId),
    uniqueIndex('clubs_content_media_position_uk').on(
      table.contentId,
      table.position,
    ),
    check(
      'clubs_content_media_position_check',
      sql`${table.position} between 0 and ${sql.raw(String(maximumContentMedia - 1))}`,
    ),
  ],
);

/**
 * A creator's club.
 *
 * The slug is unique within its creator rather than globally: two creators may
 * both have a `studio`, and making them compete for the name would hand the
 * first person to open a club a value the product never intended to sell.
 */
export const clubs = pgTable(
  'clubs_clubs',
  {
    closedAt: timestamptz('closed_at'),
    createdAt: timestamptz('created_at').notNull(),
    /** Opaque CREATORS reference. No foreign key, by ownership rule. */
    creatorId: uuid('creator_id').notNull(),
    description: text('description'),
    id: uuid('id').primaryKey(),
    lifecycle: text('lifecycle').notNull().$type<ClubLifecycle>(),
    name: text('name').notNull(),
    publishedAt: timestamptz('published_at'),
    slug: text('slug').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('clubs_clubs_creator_slug_uk').on(table.creatorId, table.slug),
    index('clubs_clubs_creator_idx').on(
      table.creatorId,
      table.createdAt,
      table.id,
    ),
    check(
      'clubs_clubs_lifecycle_check',
      inList(table.lifecycle, clubLifecycles),
    ),
    check(
      'clubs_clubs_slug_shape_check',
      sql`${table.slug} ~ ${sql.raw(`'${clubSlugPattern}'`)}`,
    ),
    check(
      'clubs_clubs_name_check',
      lengthBetween(table.name, minimumClubNameLength, maximumClubNameLength),
    ),
    check(
      'clubs_clubs_description_check',
      sql`${table.description} is null or ${lengthBetween(table.description, 1, maximumClubDescriptionLength)}`,
    ),
    check(
      'clubs_clubs_published_shape_check',
      sql`(${table.lifecycle} = 'published') = (${table.publishedAt} is not null)`,
    ),
    check(
      'clubs_clubs_closed_shape_check',
      sql`(${table.lifecycle} = 'closed') = (${table.closedAt} is not null)`,
    ),
    check('clubs_clubs_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * An entitlement to one club, held by one consumer.
 *
 * The access fact records where it came from rather than whether it was paid
 * for. A `paid` boolean would have made a complimentary invitation and a
 * purchase indistinguishable, which is the confusion that lets somebody be told
 * they bought something they did not.
 *
 * The member is an opaque USERS reference. PRIVATE CLUBS never learns a name,
 * an address, or anything else about them, and no foreign key ties this table
 * to the consumer account for the same ownership reason the creator reference
 * carries none.
 */
export const clubMemberships = pgTable(
  'clubs_memberships',
  {
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    /** Where the entitlement came from. Never a claim that money moved. */
    source: text('source').notNull().$type<MembershipSource>(),
    grantedAt: timestamptz('granted_at').notNull(),
    id: uuid('id').primaryKey(),
    /** Opaque USERS reference for the person admitted. */
    memberId: uuid('member_id').notNull(),
    revokedAt: timestamptz('revoked_at'),
    state: text('state').notNull().$type<MembershipState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // One live entitlement per person per club. Partial, so revoking sets an
    // instant rather than deleting the record and the same person may be
    // admitted again afterwards — which is what keeps a revocation auditable.
    uniqueIndex('clubs_memberships_live_uk')
      .on(table.clubId, table.memberId)
      .where(sql`${table.state} = 'active'`),
    index('clubs_memberships_club_idx').on(
      table.clubId,
      table.grantedAt,
      table.id,
    ),
    index('clubs_memberships_member_idx').on(table.memberId, table.state),
    check(
      'clubs_memberships_state_check',
      inList(table.state, membershipStates),
    ),
    check(
      'clubs_memberships_source_check',
      inList(table.source, membershipSources),
    ),
    check(
      'clubs_memberships_revoked_shape_check',
      sql`(${table.state} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
  ],
);

/**
 * A complimentary invitation to one club.
 *
 * Only a digest is stored. The secret is returned once, at the moment it is
 * created, and never again: a creator who loses it issues another. That is what
 * makes the stored row useless to anybody who reads the database, and it is why
 * redemption compares digests rather than looking a secret up.
 *
 * Redemption is single-use and is settled by the database rather than by a
 * read: the partial unique index below admits one live invitation per digest,
 * and the redeeming update names the state it expects.
 */
export const clubInvites = pgTable(
  'clubs_invites',
  {
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    id: uuid('id').primaryKey(),
    redeemedAt: timestamptz('redeemed_at'),
    /** Opaque USERS reference for whoever used it, for audit. */
    redeemedBy: uuid('redeemed_by'),
    revokedAt: timestamptz('revoked_at'),
    tokenDigest: digestColumn('token_digest').notNull(),
  },
  (table) => [
    uniqueIndex('clubs_invites_token_digest_uk').on(table.tokenDigest),
    index('clubs_invites_club_idx').on(table.clubId, table.createdAt, table.id),
    check('clubs_invites_digest_check', isHexDigest(table.tokenDigest)),
    check(
      'clubs_invites_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    // Redeemed by somebody, or by nobody. A redemption instant with no
    // redeemer would be an admission the platform could not attribute.
    check(
      'clubs_invites_redeemed_shape_check',
      nullablePairing(table.redeemedAt, table.redeemedBy),
    ),
    // An invitation is used or withdrawn, never both.
    check(
      'clubs_invites_settled_once_check',
      sql`${table.redeemedAt} is null or ${table.revokedAt} is null`,
    ),
  ],
);
