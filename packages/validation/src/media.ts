import { z } from 'zod';

/**
 * The media delivery contract.
 *
 * MEDIA owns bytes and their technical lifecycle; every question about whether
 * anybody may see them belongs to the domain that reserved the asset. This
 * contract is the narrow place where the two meet: a caller names assets it
 * already holds references to, and the platform answers with addresses for the
 * ones it is currently willing to serve that caller.
 *
 * Three properties are deliberate.
 *
 * **An asset nobody may see is absent rather than refused.** A response that
 * distinguished "no such asset" from "not for you" would be a way to test
 * whether somebody's photograph exists, and the reference itself is already
 * published in projections that other people can hold.
 *
 * **There is no durable address for restricted media.** A credentialed address
 * carries the instant it stops working, and it is short enough that an
 * authorization withdrawn now is not outlived for long. A caller may keep an
 * address until then and must ask again afterwards; nothing here may be stored,
 * shared, or embedded in a page that outlives it.
 *
 * **A request names one variant.** Sizes are roles rather than pixel values, so
 * a surface asks for the role it is rendering and the platform decides what that
 * measures. Asking for every size at once would produce credentials for
 * derivatives nothing was going to fetch.
 */

/**
 * Derivative roles a client may request.
 *
 * The single definition. `apps/api` builds its processing geometry from this
 * list, so a role cannot exist in the pipeline without being requestable, or be
 * requestable without being produced.
 */
export const mediaVariants = [
  'avatar_small',
  'avatar_large',
  'card',
  'display',
] as const;

export const mediaVariantSchema = z.enum(mediaVariants);
export type MediaVariant = z.infer<typeof mediaVariantSchema>;

/**
 * How many assets one request may name.
 *
 * Sized for what a screenful actually renders — a page of discovery cards, a
 * gallery, a conversation list — so a surface never has to issue a request per
 * image, and no caller can turn one call into an unbounded walk of authorization
 * decisions.
 */
export const maximumMediaDeliveryBatch = 24;

export const mediaDeliveryRequestSchema = z
  .object({
    assetIds: z.array(z.uuid()).min(1).max(maximumMediaDeliveryBatch),
    variant: mediaVariantSchema,
  })
  .strict();

/**
 * One address, and how long it is good for.
 *
 * `expiresAt` is absent exactly when the address is a public one whose content
 * decides its own identity, so there is nothing to expire. Its presence is the
 * only signal a client needs: an address with an expiry is a bearer credential
 * and is treated as one.
 */
export const mediaDeliverySchema = z
  .object({
    assetId: z.uuid(),
    expiresAt: z.iso.datetime().optional(),
    url: z.url(),
  })
  .strict();

export const mediaDeliveryListResponseSchema = z
  .object({
    deliveries: z.array(mediaDeliverySchema).max(maximumMediaDeliveryBatch),
  })
  .strict();

/**
 * How far an image has got, as the person who added it sees it.
 *
 * Coarser than the media platform's own lifecycle, deliberately. Whether a
 * worker is decoding or encoding is not a product fact, and publishing it would
 * make every pipeline change a breaking contract change. It is the same
 * vocabulary for a consumer's profile photograph and a creator's cover, because
 * it describes what happened to some bytes rather than what they are for.
 */
export const mediaOwnerStateSchema = z.enum([
  'pending_upload',
  'checking',
  'preparing',
  'ready',
  'rejected',
  'removed',
]);
export type MediaOwnerState = z.infer<typeof mediaOwnerStateSchema>;

/** Why an image was refused, in terms its owner can act on. */
export const mediaRejectionReasonSchema = z.enum([
  'unsupported_type',
  'too_large',
  'not_uploaded',
  'content_rejected',
]);
export type MediaRejectionReason = z.infer<typeof mediaRejectionReasonSchema>;

/**
 * A short-lived capability to write exactly one object.
 *
 * The client uploads the bytes and then asks the platform to inspect them; it
 * never declares what it uploaded. Nothing here names an object key, a provider,
 * or a digest — what leaves the platform is an address, the method, the
 * ceiling, and the instant it stops working.
 *
 * `maximumBytes` is a number rather than a fixed value because the ceiling is a
 * product decision per kind of image, and a contract that pinned one would be
 * wrong for the next one.
 */
export const mediaUploadCapabilitySchema = z
  .object({
    expiresAt: z.iso.datetime(),
    maximumBytes: z.number().int().positive(),
    mediaId: z.uuid(),
    method: z.literal('PUT'),
    uploadHeaders: z.record(z.string(), z.string()),
    uploadUrl: z.url(),
  })
  .strict();
export type MediaUploadCapability = z.infer<typeof mediaUploadCapabilitySchema>;

export type MediaDelivery = z.infer<typeof mediaDeliverySchema>;
export type MediaDeliveryListResponse = z.infer<
  typeof mediaDeliveryListResponseSchema
>;
