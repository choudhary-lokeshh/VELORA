import { z } from 'zod';

import { profileRequirementSchema, regionSchema } from './users.js';

/**
 * Consumer profile contract and the approved V1 profile policy.
 *
 * The bounds live here rather than in the API because they are contract: a
 * client must be able to validate a display name before sending it, the
 * published OpenAPI document must state the same limits the server enforces,
 * and the database CHECK constraints are generated from these same constants.
 * One definition, three consumers, no drift.
 *
 * The minimum discoverable profile is deliberately small — a display name, a
 * coarse region, a language, and one image. Date of birth, precise location,
 * gender, and orientation are not part of it, so nobody is asked to hand over
 * sensitive data as the price of being seen.
 */

export const minimumDisplayNameLength = 2;
export const maximumDisplayNameLength = 32;
export const maximumBioLength = 500;

/** BCP 47 primary language subtag, kept extensible to three-letter codes. */
export const languagePattern = /^[a-z]{2,3}$/u;

export const minimumProfileLanguages = 1;
export const maximumProfileLanguages = 5;

/** Image slots a profile may hold. Positions are zero-based and dense. */
export const maximumProfileMedia = 6;

/**
 * Accepted image types. The server decides an object's type from its own bytes;
 * this list is published so a client can refuse an obviously wrong file early,
 * never so the server can trust what a client claims.
 */
export const acceptedProfileMediaTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type ProfileMediaContentType =
  (typeof acceptedProfileMediaTypes)[number];

export const maximumProfileMediaBytes = 8 * 1024 * 1024;

/**
 * Display names are neither unique nor reserved. Impersonation and offensive
 * naming are moderation questions whose taxonomy is `DECISION REQUIRED`, so
 * nothing here invents one. What is enforced is structural: bounded length, no
 * control characters, and no leading or trailing whitespace that would let two
 * names render identically.
 */
export const displayNameSchema = z
  .string()
  .min(minimumDisplayNameLength)
  .max(maximumDisplayNameLength)
  .refine(
    (value) => value.trim() === value,
    'Display name must not begin or end with whitespace',
  )
  .refine(
    (value) => !/\p{Cc}/u.test(value),
    'Display name must not contain control characters',
  );

export const bioSchema = z.string().max(maximumBioLength);

export const profileLanguageSchema = z.string().regex(languagePattern);

export const profileLanguagesSchema = z
  .array(profileLanguageSchema)
  .min(minimumProfileLanguages)
  .max(maximumProfileLanguages)
  .refine(
    (values) => new Set(values).size === values.length,
    'Languages must not repeat',
  );

export const profileMediaStateSchema = z.enum([
  'pending_upload',
  'ready',
  'rejected',
  'removed',
]);

export const profileMediaRejectionReasonSchema = z.enum([
  'unsupported_type',
  'too_large',
  'not_uploaded',
  'content_rejected',
]);

/**
 * A profile image as its owner sees it.
 *
 * There is no URL. Consumer media has no durable public address: delivery is
 * authorized and signed per request, so a link that outlives the authorization
 * decision cannot exist.
 */
export const profileMediaSchema = z
  .object({
    contentType: z.enum(acceptedProfileMediaTypes).optional(),
    id: z.uuid(),
    position: z
      .number()
      .int()
      .min(0)
      .max(maximumProfileMedia - 1),
    rejectionReason: profileMediaRejectionReasonSchema.optional(),
    state: profileMediaStateSchema,
    uploadExpiresAt: z.iso.datetime(),
  })
  .strict();

export const profileResponseSchema = z
  .object({
    bio: bioSchema.optional(),
    /** True only when every requirement below is satisfied. */
    complete: z.boolean(),
    discoverable: z.boolean(),
    displayName: displayNameSchema.optional(),
    languages: z.array(profileLanguageSchema),
    media: z.array(profileMediaSchema),
    outstandingRequirements: z.array(profileRequirementSchema),
    preferencesVersion: z.number().int().min(1).optional(),
    region: regionSchema.optional(),
    /** Absent until a profile has been saved. Required to edit one. */
    version: z.number().int().min(1).optional(),
  })
  .strict();

/**
 * `expectedVersion` is absent exactly when the caller believes no profile
 * exists. Being wrong in either direction is a conflict rather than a silent
 * create-or-overwrite.
 */
export const saveProfileRequestSchema = z
  .object({
    bio: bioSchema.optional(),
    displayName: displayNameSchema,
    expectedVersion: z.number().int().min(1).optional(),
    languages: profileLanguagesSchema,
  })
  .strict();

export const savePreferencesRequestSchema = z
  .object({
    discoverable: z.boolean(),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();

/**
 * A short-lived capability to write exactly one object. The client uploads the
 * bytes and then asks the platform to inspect them; it never declares what it
 * uploaded.
 */
export const profileMediaUploadResponseSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    maximumBytes: z.literal(maximumProfileMediaBytes),
    mediaId: z.uuid(),
    method: z.literal('PUT'),
    uploadHeaders: z.record(z.string(), z.string()),
    uploadUrl: z.url(),
  })
  .strict();

export const profileMediaReferenceRequestSchema = z
  .object({ mediaId: z.uuid() })
  .strict();

export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type SaveProfileRequest = z.infer<typeof saveProfileRequestSchema>;
export type SavePreferencesRequest = z.infer<
  typeof savePreferencesRequestSchema
>;

/**
 * Availability.
 *
 * `docs/flows/consumer-account-profile.md` fixes what this is and is not: a
 * user-managed, bounded preference, not online presence, not consent to be
 * contacted, not a guarantee of appearing in discovery, and never an override of
 * a block or an enforcement decision.
 *
 * Being available always carries an end. An availability with no end would drift
 * into presence — a claim that somebody is around right now, made by a server
 * that has no idea whether they are — and stale availability is exactly what the
 * approved discovery policy excludes.
 */
export const availabilityStateSchema = z.enum(['available', 'unavailable']);
export type AvailabilityState = z.infer<typeof availabilityStateSchema>;

/** Longest a single availability window may run before it must be renewed. */
export const maximumAvailabilityWindowMilliseconds = 24 * 60 * 60 * 1000;

export const availabilityResponseSchema = z
  .object({
    /** Absent when the account is unavailable. */
    availableUntil: z.iso.datetime().optional(),
    /**
     * What the platform acts on: `available` only while the window is still
     * open. An expired window reads as `unavailable` without anything having to
     * rewrite the stored row.
     */
    effectiveState: availabilityStateSchema,
    /** What the person last chose. */
    state: availabilityStateSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const saveAvailabilityRequestSchema = z
  .object({
    availableUntil: z.iso.datetime().optional(),
    state: availabilityStateSchema,
  })
  .strict()
  .refine(
    (value) =>
      (value.state === 'available') === (value.availableUntil !== undefined),
    'Availability requires an end exactly when it is available',
  );

export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
