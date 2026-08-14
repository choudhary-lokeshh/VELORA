import { z } from 'zod';

import { creatorHandleSchema } from './creator.js';

/**
 * PRIVATE CLUBS wire vocabulary.
 *
 * `docs/architecture/03-domain-boundaries.md` gives PRIVATE CLUBS the club
 * configuration, the content catalog, membership, and entitlement; CREATORS
 * keeps the creator identity and its eligibility to operate. That split is why
 * content lives here rather than beside the creator profile: what a creator
 * *is* and what a creator *publishes* have different owners, different
 * lifecycles, and different audiences.
 *
 * Nothing in this file describes money. There is no price, no offer, no
 * purchase, no subscription, and no earnings: `docs/product/01-product-phases.md`
 * puts creator subscriptions and PPV behind BILLING in a later phase, and a
 * field here would be a promise the platform cannot keep.
 */

export const minimumCreatorContentTitleLength = 2;
export const maximumCreatorContentTitleLength = 120;
export const maximumCreatorContentSummaryLength = 300;
export const maximumCreatorContentBodyLength = 20_000;

/**
 * Content lifecycle.
 *
 * `draft` is where everything starts and nothing about it is visible to anybody
 * else. `published` is the only state a visitor can ever reach. `archived` is a
 * withdrawal that keeps the record: a creator who takes something down has not
 * asked for it to be destroyed, and `docs/flows/creator-lifecycle-content.md`
 * treats removal and deletion as different acts.
 */
export const creatorContentLifecycleValues = [
  'draft',
  'published',
  'archived',
] as const;
export const creatorContentLifecycleSchema = z.enum(
  creatorContentLifecycleValues,
);
export type CreatorContentLifecycleValue = z.infer<
  typeof creatorContentLifecycleSchema
>;

/**
 * Who a published item is for.
 *
 * `members_only` exists from the start and is deliberately unreadable by
 * anybody today: no club, membership, or entitlement exists yet, so the read
 * path has nobody to admit and refuses. Adding the value later would have meant
 * a migration of rows whose authors had already decided what they meant; having
 * it now means the catalog fails closed rather than defaulting somebody's
 * private work into public view.
 */
export const creatorContentVisibilityValues = [
  'public',
  'members_only',
] as const;
export const creatorContentVisibilitySchema = z.enum(
  creatorContentVisibilityValues,
);
export type CreatorContentVisibilityValue = z.infer<
  typeof creatorContentVisibilitySchema
>;

/** The creator's own view of one item, including a draft nobody else can see. */
export const creatorContentSchema = z
  .object({
    archivedAt: z.iso.datetime().optional(),
    body: z.string().max(maximumCreatorContentBodyLength).optional(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    lifecycle: creatorContentLifecycleSchema,
    publishedAt: z.iso.datetime().optional(),
    summary: z.string().max(maximumCreatorContentSummaryLength).optional(),
    title: z
      .string()
      .min(minimumCreatorContentTitleLength)
      .max(maximumCreatorContentTitleLength),
    updatedAt: z.iso.datetime(),
    /** Optimistic concurrency token; a stale one is refused, never applied. */
    version: z.number().int().min(1),
    visibility: creatorContentVisibilitySchema,
  })
  .strict();
export type CreatorContent = z.infer<typeof creatorContentSchema>;

export const creatorContentListResponseSchema = z
  .object({
    content: z.array(creatorContentSchema).max(50),
    /** Absent when the server has no further page to offer. */
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type CreatorContentListResponse = z.infer<
  typeof creatorContentListResponseSchema
>;

/**
 * Creating or editing one item.
 *
 * `contentId` and `version` travel together: both absent creates, both present
 * edits. A body carrying one without the other is refused rather than guessed
 * at, because "edit something I have not read" and "create" are exactly the two
 * intentions that must never be confused.
 */
export const saveCreatorContentRequestSchema = z
  .object({
    body: z.string().max(maximumCreatorContentBodyLength).optional(),
    contentId: z.uuid().optional(),
    summary: z.string().max(maximumCreatorContentSummaryLength).optional(),
    title: z
      .string()
      .min(minimumCreatorContentTitleLength)
      .max(maximumCreatorContentTitleLength),
    version: z.number().int().min(1).optional(),
    visibility: creatorContentVisibilitySchema,
  })
  .strict();
export type SaveCreatorContentRequest = z.infer<
  typeof saveCreatorContentRequestSchema
>;

/**
 * Moving one item between lifecycle states.
 *
 * Separate from saving, because publishing is a decision about who may see
 * something and editing is not. Folding them together would make every save a
 * potential publication.
 */
export const creatorContentLifecycleRequestSchema = z
  .object({
    contentId: z.uuid(),
    lifecycle: creatorContentLifecycleSchema,
    version: z.number().int().min(1),
  })
  .strict();
export type CreatorContentLifecycleRequest = z.infer<
  typeof creatorContentLifecycleRequestSchema
>;

/**
 * One item as a visitor sees it.
 *
 * An allow-list, not a filtered record. There is no creator identifier, no
 * lifecycle, no visibility, no version, no draft, and nothing purchasable —
 * only what a published, public item actually says.
 */
export const publicCreatorContentSchema = z
  .object({
    body: z.string().max(maximumCreatorContentBodyLength).optional(),
    id: z.uuid(),
    publishedAt: z.iso.datetime(),
    summary: z.string().max(maximumCreatorContentSummaryLength).optional(),
    title: z
      .string()
      .min(minimumCreatorContentTitleLength)
      .max(maximumCreatorContentTitleLength),
  })
  .strict();
export type PublicCreatorContent = z.infer<typeof publicCreatorContentSchema>;

export const publicCreatorCatalogResponseSchema = z
  .object({
    content: z.array(publicCreatorContentSchema).max(50),
    handle: creatorHandleSchema,
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type PublicCreatorCatalogResponse = z.infer<
  typeof publicCreatorCatalogResponseSchema
>;
