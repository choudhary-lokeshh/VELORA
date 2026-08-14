import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import {
  creatorContentLifecycles,
  creatorContentVisibilities,
  maximumCreatorContentBodyLength,
  maximumCreatorContentSummaryLength,
  maximumCreatorContentTitleLength,
  minimumCreatorContentTitleLength,
  type CreatorContentLifecycle,
  type CreatorContentVisibility,
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
