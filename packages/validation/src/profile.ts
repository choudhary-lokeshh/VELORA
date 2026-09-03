import { z } from 'zod';

import { mediaOwnerStateSchema, mediaRejectionReasonSchema } from './media.js';
import {
  languagePattern,
  maximumBioLength,
  maximumDisplayNameLength,
  maximumProfileLanguages,
  maximumProfileMedia,
  maximumProfileMediaBytes,
  minimumDisplayNameLength,
  minimumProfileLanguages,
} from './profile-bounds.js';
import { hasDisplayControlCharacters } from './text-safety.js';
import {
  matchingGenderSchema,
  profileRequirementSchema,
  regionSchema,
} from './users.js';

/**
 * Re-exported so `@velora/validation` keeps publishing them under the name
 * every caller already uses. They live in `./profile-bounds` because Consumer
 * Mobile has to check a file's size and type before uploading it and must not
 * pull a schema library into a React Native bundle to do so.
 */
export {
  acceptedProfileMediaTypes,
  maximumProfileMediaBytes,
  type ProfileMediaContentType,
} from './profile-bounds.js';

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
 *
 * A declared matching gender exists here and is *not* part of that minimum.
 * It is optional, it is never a requirement for discovery, for Live, or for
 * being matched, and an account that never sets one is complete. What it
 * changes is only whether somebody else's category-specific preference can
 * reach you — see {@link saveMatchingGenderRequestSchema}.
 */

export {
  languagePattern,
  maximumBioLength,
  maximumDisplayNameLength,
  maximumProfileLanguages,
  maximumProfileMedia,
  minimumDisplayNameLength,
  minimumProfileLanguages,
} from './profile-bounds.js';

/**
 * Display names are neither unique nor reserved. Impersonation and offensive
 * naming are moderation questions whose taxonomy is `DECISION REQUIRED`, so
 * nothing here invents one. What is enforced is structural: bounded length, no
 * leading or trailing whitespace that would let two names render identically,
 * and none of the characters that exist only to change how text is drawn.
 *
 * That last group used to be `\p{Cc}` alone, which is the wrong half. The
 * characters that actually let one name render as another are the
 * bidirectional overrides and isolates, and they are not control characters —
 * a name carrying one is stored as written and drawn backwards. `p{Cf}` as a
 * whole is not the answer either: it would refuse the joiners Arabic, Persian,
 * several Indic scripts and every multi-part emoji require, which is refusing
 * people's own names to stop a trick.
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
    (value) => !hasDisplayControlCharacters(value),
    'Display name must not contain characters that change how text is drawn',
  );

/**
 * What somebody writes about themselves.
 *
 * Bounded, and refused the same characters a display name and a message are
 * refused. A bidirectional override in a bio is the same trick it is in a name:
 * it makes the rendered text differ from the stored text, which is how a
 * profile shows one thing to a reader and holds another. The joiners real
 * scripts and emoji need are still allowed.
 *
 * Leading and trailing whitespace is refused for the same reason it is on a
 * name: two bios that render identically must not be two different values, and
 * a client that trims before sending is not a guarantee.
 */
export const bioSchema = z
  .string()
  .max(maximumBioLength)
  .refine(
    (value) => value.trim() === value,
    'A bio must not begin or end with whitespace',
  )
  .refine(
    (value) => !hasDisplayControlCharacters(value),
    'A bio must not contain characters that change how text is drawn',
  );

export const profileLanguageSchema = z.string().regex(languagePattern);

export const profileLanguagesSchema = z
  .array(profileLanguageSchema)
  .min(minimumProfileLanguages)
  .max(maximumProfileLanguages)
  .refine(
    (values) => new Set(values).size === values.length,
    'Languages must not repeat',
  );

/**
 * How far an image has got, as its owner sees it.
 *
 * The platform's own vocabulary, aliased rather than restated: a creator's cover
 * and a consumer's photograph go through the same pipeline, so two copies of
 * this list would be two things to keep in step. The names stay because they are
 * what the published contract already calls them.
 */
export const profileMediaStateSchema = mediaOwnerStateSchema;

export const profileMediaRejectionReasonSchema = mediaRejectionReasonSchema;

/**
 * A profile image as its owner sees it.
 *
 * The identifier is the media asset reference, which is what every other
 * operation on this image takes: the completion, the removal, and the delivery
 * exchange. It is deliberately not this domain's internal slot key — a client
 * holding one of those could name an image the media platform has never heard
 * of.
 *
 * There is no URL. Consumer media has no durable public address: delivery is
 * authorized and signed per request, so a link that outlives the authorization
 * decision cannot exist.
 *
 * There is no detected content type either, and its removal is the point rather
 * than an omission. What format some bytes turned out to be is a technical fact
 * the media platform owns, no surface renders it, and publishing it from here
 * would be this domain restating an answer it no longer holds.
 *
 * `uploadExpiresAt` is present only while a window is actually open. Once bytes
 * have arrived there is no deadline left to show.
 */
export const profileMediaSchema = z
  .object({
    id: z.uuid(),
    position: z
      .number()
      .int()
      .min(0)
      .max(maximumProfileMedia - 1),
    rejectionReason: profileMediaRejectionReasonSchema.optional(),
    state: profileMediaStateSchema,
    uploadExpiresAt: z.iso.datetime().optional(),
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
    /**
     * What this person has declared about themselves for matching.
     *
     * Absent when they have never been asked, which is not the same as
     * `undisclosed` — that is somebody who was asked and said no. It appears in
     * the owner's own read of their own profile and in no projection anybody
     * else receives: it is not published on a discovery card, a live encounter,
     * a creator page, or an RTC session, and nothing derives a displayed value
     * from it.
     */
    matchingGender: matchingGenderSchema.optional(),
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
 * Declaring, or changing, what somebody says about themselves for matching.
 *
 * Its own operation rather than a field on {@link saveProfileRequestSchema},
 * for three reasons that are all the same reason. Somebody changing only this
 * must not have to resend their name, bio, and languages, because a write that
 * carries values it did not intend to change is a write that can silently
 * revert one. It must not contend on the profile version, because losing a race
 * with a photo upload is not a sensible way to fail at answering a question
 * about yourself. And a special-category attribute with exactly one write path
 * is one that can be audited, rate-limited, and erased on its own.
 *
 * There is no shape here for anybody else's declaration, and no shape for a
 * value the platform worked out. The caller is the subject, always, and the
 * server takes the subject from the authenticated principal rather than from
 * this body.
 *
 * Withdrawing is `undisclosed` rather than a delete. Somebody who declared and
 * changed their mind gets the same matching treatment as somebody who never
 * declared — neither is returned for a category-specific preference — and
 * saying so explicitly means a surface never has to ask twice.
 */
export const saveMatchingGenderRequestSchema = z
  .object({
    matchingGender: matchingGenderSchema,
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
export type SaveMatchingGenderRequest = z.infer<
  typeof saveMatchingGenderRequestSchema
>;
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
