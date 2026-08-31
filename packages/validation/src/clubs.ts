import { z } from 'zod';

import {
  clubSlugPattern,
  maximumClubSlugLength,
  minimumClubSlugLength,
  submittedClubSlugPattern,
} from './address-bounds.js';
import { mediaOwnerStateSchema, mediaRejectionReasonSchema } from './media.js';
import { maximumContentMedia } from './profile-bounds.js';

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
 * How many images one content item may carry.
 *
 * Bounded because every attachment is a derivative set to render, an address
 * to authorise, and a purge obligation on takedown. Six is the same bound a
 * consumer profile already has, and neither number is a product ceiling
 * anybody has asked to raise.
 */
export { maximumContentMedia };

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
/** One image attached to a content item, as its creator sees it. */
export const creatorContentMediaSchema = z
  .object({
    id: z.uuid(),
    position: z
      .number()
      .int()
      .min(0)
      .max(maximumContentMedia - 1),
    rejectionReason: mediaRejectionReasonSchema.optional(),
    state: mediaOwnerStateSchema,
    uploadExpiresAt: z.iso.datetime().optional(),
  })
  .strict();

export const creatorContentSchema = z
  .object({
    archivedAt: z.iso.datetime().optional(),
    body: z.string().max(maximumCreatorContentBodyLength).optional(),
    clubId: z.uuid().optional(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    /** Attached images in position order, including ones not yet ready. */
    media: z.array(creatorContentMediaSchema).max(maximumContentMedia),
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
    /**
     * The club this item belongs to, if any. Setting it is what makes
     * `members_only` mean something: an item with no club has nobody to admit,
     * so it stays unreachable however it is marked.
     */
    clubId: z.uuid().optional(),
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
    /**
     * References to the item's ready images, in position order. Ones that are
     * not ready are absent rather than reported: a reader is owed the item, not
     * its author's pipeline.
     */
    media: z
      .array(
        z.object({ id: z.uuid(), position: z.number().int().min(0) }).strict(),
      )
      .max(maximumContentMedia),
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

export const minimumClubNameLength = 2;
export const maximumClubNameLength = 80;
export const maximumClubDescriptionLength = 600;
// In `address-bounds.ts` with the creator handle, and re-exported here: a slug
// appears in a public address, so a client has to be able to recognise one
// without importing a schema library to do it.
export {
  maximumClubSlugLength,
  minimumClubSlugLength,
} from './address-bounds.js';

/**
 * What a creator promises a member, as short lines rather than as prose.
 *
 * Bounded in both directions on purpose. A benefit list is the part of a
 * membership a visitor actually reads before deciding, and an unbounded one
 * turns into a second description that nobody finishes. Eight lines of a
 * hundred and twenty characters is enough to say what somebody gets and too
 * little to hide a term in.
 *
 * These are presentation, owned by PRIVATE CLUBS along with the rest of a
 * club's identity. They are deliberately not commercial terms: nothing here
 * carries a price, a cadence, a refund rule, or a guarantee, because those are
 * BILLING's to publish and none of them is approved.
 */
export const maximumClubBenefits = 8;
export const maximumClubBenefitLength = 120;
export const clubBenefitSchema = z
  .string()
  .min(1)
  .max(maximumClubBenefitLength);

/**
 * A club's address within one creator.
 *
 * The same repertoire as a creator handle and for the same reason — lower-case
 * ASCII cannot carry a confusable — but scoped to its creator rather than
 * globally unique: two creators may both have a `studio`, and forcing them to
 * compete for the name would make the first club anybody opened valuable for
 * no product reason.
 */
export { clubSlugPattern, submittedClubSlugPattern } from './address-bounds.js';

export const clubSlugSchema = z
  .string()
  .min(minimumClubSlugLength)
  .max(maximumClubSlugLength)
  .regex(clubSlugPattern);

export const submittedClubSlugSchema = z
  .string()
  .min(minimumClubSlugLength)
  .max(maximumClubSlugLength)
  .regex(submittedClubSlugPattern);

/**
 * Club lifecycle.
 *
 * `draft` has no members and no public presence. `published` is visible on the
 * creator's public page and is the only state an invite may be redeemed into.
 * `closed` ends the club without deleting it, and existing memberships stop
 * admitting anybody the moment it happens.
 */
export const clubLifecycleValues = ['draft', 'published', 'closed'] as const;
export const clubLifecycleSchema = z.enum(clubLifecycleValues);
export type ClubLifecycleValue = z.infer<typeof clubLifecycleSchema>;

/**
 * Where an entitlement came from.
 *
 * Never a boolean. `docs/flows/creator-entitlement.md` requires the access fact
 * to record its own provenance, and a `paid = true` column would have made a
 * complimentary invite and a purchase indistinguishable — which is exactly the
 * confusion that lets somebody be told they bought something they did not.
 *
 * `billing` exists in the vocabulary and cannot be written today: no payment
 * provider is approved, and the seam that would produce it refuses outside
 * local and test environments.
 */
export const membershipSourceValues = [
  'creator_invite',
  'admin_grant',
  'billing',
] as const;
export const membershipSourceSchema = z.enum(membershipSourceValues);
export type MembershipSourceValue = z.infer<typeof membershipSourceSchema>;

export const membershipStateValues = ['active', 'revoked'] as const;
export const membershipStateSchema = z.enum(membershipStateValues);
export type MembershipStateValue = z.infer<typeof membershipStateSchema>;

/** The creator's own view of one club, including a draft nobody else can see. */
export const creatorClubSchema = z
  .object({
    /** What a member is told they get, in the creator's own words. */
    benefits: z.array(clubBenefitSchema).max(maximumClubBenefits),
    createdAt: z.iso.datetime(),
    description: z.string().max(maximumClubDescriptionLength).optional(),
    id: z.uuid(),
    lifecycle: clubLifecycleSchema,
    /** Members whose entitlement is active right now. Computed, never stored. */
    memberCount: z.number().int().min(0),
    name: z.string().min(minimumClubNameLength).max(maximumClubNameLength),
    publishedAt: z.iso.datetime().optional(),
    slug: clubSlugSchema,
    updatedAt: z.iso.datetime(),
    version: z.number().int().min(1),
  })
  .strict();
export type CreatorClub = z.infer<typeof creatorClubSchema>;

export const creatorClubListResponseSchema = z
  .object({
    clubs: z.array(creatorClubSchema).max(50),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type CreatorClubListResponse = z.infer<
  typeof creatorClubListResponseSchema
>;

export const saveCreatorClubRequestSchema = z
  .object({
    /**
     * The whole list, every time. A partial update of an ordered list is how
     * two editors silently reorder each other's work; sending the list the
     * creator is looking at makes the optimistic version check mean something.
     */
    benefits: z.array(clubBenefitSchema).max(maximumClubBenefits).optional(),
    clubId: z.uuid().optional(),
    description: z.string().max(maximumClubDescriptionLength).optional(),
    name: z.string().min(minimumClubNameLength).max(maximumClubNameLength),
    slug: submittedClubSlugSchema,
    version: z.number().int().min(1).optional(),
  })
  .strict();
export type SaveCreatorClubRequest = z.infer<
  typeof saveCreatorClubRequestSchema
>;

export const clubLifecycleRequestSchema = z
  .object({
    clubId: z.uuid(),
    lifecycle: clubLifecycleSchema,
    version: z.number().int().min(1),
  })
  .strict();
export type ClubLifecycleRequest = z.infer<typeof clubLifecycleRequestSchema>;

/**
 * An invitation, returned exactly once.
 *
 * The secret is in the response of the request that created it and nowhere
 * else: the server keeps only a digest, so a creator who loses it issues a new
 * one rather than asking for it again. That is what makes the stored record
 * useless to anybody who reads the database.
 */
export const clubInviteSecretSchema = z.string().min(32).max(128);

export const clubInviteSchema = z
  .object({
    clubId: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    id: z.uuid(),
    redeemedAt: z.iso.datetime().optional(),
    revokedAt: z.iso.datetime().optional(),
  })
  .strict();
export type ClubInvite = z.infer<typeof clubInviteSchema>;

export const clubInviteIssuedResponseSchema = z
  .object({
    invite: clubInviteSchema,
    /**
     * Shown once. It is a complimentary invitation and never a purchase: the
     * membership it creates records `creator_invite` as its source.
     */
    secret: clubInviteSecretSchema,
  })
  .strict();
export type ClubInviteIssuedResponse = z.infer<
  typeof clubInviteIssuedResponseSchema
>;

export const issueClubInviteRequestSchema = z
  .object({ clubId: z.uuid() })
  .strict();
export type IssueClubInviteRequest = z.infer<
  typeof issueClubInviteRequestSchema
>;

export const revokeClubInviteRequestSchema = z
  .object({ inviteId: z.uuid() })
  .strict();
export type RevokeClubInviteRequest = z.infer<
  typeof revokeClubInviteRequestSchema
>;

export const clubInviteListResponseSchema = z
  .object({ invites: z.array(clubInviteSchema).max(50) })
  .strict();
export type ClubInviteListResponse = z.infer<
  typeof clubInviteListResponseSchema
>;

/**
 * A member as the creator may see them.
 *
 * No display name, no consumer identifier, no email, and no behaviour. A
 * creator needs to know how many people have access and to be able to withdraw
 * one, and `docs/domains/private-clubs.md` keeps subscriber private behaviour
 * out of creator views entirely. The membership identifier is the handle for
 * revocation and says nothing about who holds it.
 */
export const clubMembershipSchema = z
  .object({
    clubId: z.uuid(),
    grantedAt: z.iso.datetime(),
    id: z.uuid(),
    revokedAt: z.iso.datetime().optional(),
    source: membershipSourceSchema,
    state: membershipStateSchema,
  })
  .strict();
export type ClubMembership = z.infer<typeof clubMembershipSchema>;

export const clubMembershipListResponseSchema = z
  .object({
    memberships: z.array(clubMembershipSchema).max(50),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ClubMembershipListResponse = z.infer<
  typeof clubMembershipListResponseSchema
>;

export const revokeClubMembershipRequestSchema = z
  .object({ membershipId: z.uuid() })
  .strict();
export type RevokeClubMembershipRequest = z.infer<
  typeof revokeClubMembershipRequestSchema
>;

export const redeemClubInviteRequestSchema = z
  .object({ secret: clubInviteSecretSchema })
  .strict();
export type RedeemClubInviteRequest = z.infer<
  typeof redeemClubInviteRequestSchema
>;

/**
 * What a member is told after redeeming, and after asking what they hold.
 *
 * Ended memberships are carried here alongside live ones rather than dropped,
 * because somebody who paid for a club last month is entitled to see that they
 * were in it — and because a subscription that has run out otherwise leaves a
 * row on the Memberships page with nothing to name it. `state` is what tells
 * the two apart; nothing about a revoked row grants a read.
 */
export const clubAccessSchema = z
  .object({
    clubId: z.uuid(),
    clubName: z.string().min(minimumClubNameLength).max(maximumClubNameLength),
    clubSlug: clubSlugSchema,
    creatorHandle: creatorHandleSchema,
    /** Present exactly when the entitlement has ended. */
    endedAt: z.iso.datetime().optional(),
    grantedAt: z.iso.datetime(),
    source: membershipSourceSchema,
    state: membershipStateSchema,
  })
  .strict();
export type ClubAccess = z.infer<typeof clubAccessSchema>;

export const clubAccessListResponseSchema = z
  .object({ access: z.array(clubAccessSchema).max(50) })
  .strict();
export type ClubAccessListResponse = z.infer<
  typeof clubAccessListResponseSchema
>;

/**
 * Leaving a club somebody was invited into.
 *
 * Deliberately not a cancellation. A creator invitation is a gift and giving it
 * back ends it; a paid membership is a commercial relationship and ending it is
 * a billing decision with a period, a renewal, and a refund question attached.
 * The route refuses a membership whose source is `billing` and says where to go
 * instead, rather than quietly ending access somebody has already paid for.
 */
export const leaveClubRequestSchema = z.object({ clubId: z.uuid() }).strict();
export type LeaveClubRequest = z.infer<typeof leaveClubRequestSchema>;

/**
 * Club metadata a visitor may see on a published creator page.
 *
 * The identifier is published because a visitor has to be able to join this
 * club to what it costs, and what it costs is BILLING's to publish against the
 * same opaque resource identifier. Neither domain reads the other's tables and
 * neither route knows about the other; the join happens where both answers
 * arrive, which is the surface.
 *
 * `membership` is present exactly when the person asking already holds one, so
 * a page can say "you are in this" instead of offering to sell it to them
 * again. It is absent for a visitor with no session, which is why the whole
 * field is optional rather than a state with a `none` value.
 */
export const publicClubSchema = z
  .object({
    benefits: z.array(clubBenefitSchema).max(maximumClubBenefits),
    description: z.string().max(maximumClubDescriptionLength).optional(),
    id: z.uuid(),
    membership: z
      .object({
        grantedAt: z.iso.datetime(),
        source: membershipSourceSchema,
      })
      .strict()
      .optional(),
    name: z.string().min(minimumClubNameLength).max(maximumClubNameLength),
    slug: clubSlugSchema,
  })
  .strict();
export type PublicClub = z.infer<typeof publicClubSchema>;

export const publicClubListResponseSchema = z
  .object({
    clubs: z.array(publicClubSchema).max(50),
    handle: creatorHandleSchema,
  })
  .strict();
export type PublicClubListResponse = z.infer<
  typeof publicClubListResponseSchema
>;

/**
 * One members-only item, as somebody who may read it sees it.
 *
 * The same allow-list discipline the public catalog gets, and for the same
 * reason: a member is owed the item, not its author's lifecycle, version, or
 * pipeline. That it is members-only is already implied by where it was read
 * from, so `visibility` is not repeated here.
 */
export const memberClubContentSchema = z
  .object({
    body: z.string().max(maximumCreatorContentBodyLength).optional(),
    id: z.uuid(),
    media: z
      .array(
        z.object({ id: z.uuid(), position: z.number().int().min(0) }).strict(),
      )
      .max(maximumContentMedia),
    publishedAt: z.iso.datetime(),
    summary: z.string().max(maximumCreatorContentSummaryLength).optional(),
    title: z
      .string()
      .min(minimumCreatorContentTitleLength)
      .max(maximumCreatorContentTitleLength),
  })
  .strict();
export type MemberClubContent = z.infer<typeof memberClubContentSchema>;

/**
 * A club as its own destination.
 *
 * Two answers in one response because they are decided together. `membership`
 * says whether this person is in the club right now, re-derived from current
 * club, creator, standing and entitlement state rather than from anything
 * cached; `content` is populated only when it is present. A visitor who is not
 * a member gets the club's public identity and an empty feed — never a body, a
 * summary, or a media reference belonging to a protected item.
 */
export const clubDetailResponseSchema = z
  .object({
    club: publicClubSchema,
    content: z.array(memberClubContentSchema).max(50),
    creatorHandle: creatorHandleSchema,
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ClubDetailResponse = z.infer<typeof clubDetailResponseSchema>;

/** Which club a creator-scoped read addresses. */
export const clubIdSchema = z.uuid();
/** Which item a protected read addresses. */
export const contentIdSchema = z.uuid();

/** Which content item an upload is being reserved against. */
export const creatorContentMediaRequestSchema = z
  .object({ contentId: contentIdSchema })
  .strict();
