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

export type MediaDelivery = z.infer<typeof mediaDeliverySchema>;
export type MediaDeliveryListResponse = z.infer<
  typeof mediaDeliveryListResponseSchema
>;
