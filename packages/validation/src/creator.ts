import { z } from 'zod';

/**
 * CREATORS wire vocabulary.
 *
 * A creator is a capability attached to an existing authenticated principal,
 * never a second account with its own credential. `docs/domains/creators.md`
 * gives CREATORS the creator identity and its eligibility to operate platform
 * features; AUTH keeps the credential and the session, USERS keeps the consumer
 * account, and neither identifier is interchangeable with the creator one.
 *
 * The creator identifier is distinct from both the AUTH account identifier and
 * the consumer user identifier on purpose. A surface that learns one must not
 * thereby learn anything addressable in another domain.
 */

/**
 * Creator capability lifecycle.
 *
 * `docs/decisions/ADR-0020-creator-capability-activation.md` records why this
 * ladder is shorter than the diagram in `docs/flows/creator-lifecycle-content.md`:
 * `under_review`, `verified`, and `declined` are states of the creator
 * identity-verification predicate, which has no approved provider and whose
 * criteria are still `DECISION REQUIRED`. Modelling them here would put states
 * in the schema that no code could ever leave.
 */
export const creatorAccountStatusValues = [
  /** Capability requested; at least one activation requirement is outstanding. */
  'applicant',
  /** Every currently required activation gate passes. */
  'active',
  /** Safety, compliance, or platform action stopped creator operation. */
  'suspended',
  /** Ended. Terminal for this capability; the person keeps their account. */
  'closed',
] as const;
export const creatorAccountStatusSchema = z.enum(creatorAccountStatusValues);
export type CreatorAccountStatusValue = z.infer<
  typeof creatorAccountStatusSchema
>;

/**
 * Coarse cause the creator may see about their own capability. It is
 * deliberately blunt: the exact enforcement decision behind a suspension
 * belongs to TRUST & SAFETY and is never restated here.
 */
export const creatorAccountStatusReasonValues = [
  'onboarding_incomplete',
  'eligibility_failed',
  'safety_enforcement',
  'platform_action',
  'creator_requested',
] as const;
export const creatorAccountStatusReasonSchema = z.enum(
  creatorAccountStatusReasonValues,
);
export type CreatorAccountStatusReasonValue = z.infer<
  typeof creatorAccountStatusReasonSchema
>;

export const creatorAccountResponseSchema = z
  .object({
    activatedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    status: creatorAccountStatusSchema,
    statusReason: creatorAccountStatusReasonSchema.optional(),
  })
  .strict();
export type CreatorAccountResponse = z.infer<
  typeof creatorAccountResponseSchema
>;

/**
 * Establishing creator capability carries no identity input at all — no legal
 * name, no business registration, no tax identifier, no document. The acting
 * principal comes from the presented credential, so a client cannot name
 * another account and become its creator.
 */
export const createCreatorAccountRequestSchema = z.object({}).strict();
export type CreateCreatorAccountRequest = z.infer<
  typeof createCreatorAccountRequestSchema
>;

/**
 * Creator admission ladder. Shorter than the consumer one because a creator is
 * an existing adult principal: the adult gate is USERS' answer rather than a
 * step taken here, and no minimum creator profile is required to hold the
 * capability.
 */
export const creatorOnboardingStepValues = [
  'adult_eligibility',
  'policy_acknowledgement',
  'completed',
] as const;
export const creatorOnboardingStepSchema = z.enum(creatorOnboardingStepValues);
export type CreatorOnboardingStepValue = z.infer<
  typeof creatorOnboardingStepSchema
>;

/**
 * Why the adult gate is unmet, reported only to the person it describes.
 *
 * `no_consumer_account` and `adult_declaration_missing` are distinct because
 * they need different next actions, and `not_in_good_standing` never says which
 * restriction applies — that is USERS' and TRUST & SAFETY's to explain, not
 * this domain's.
 */
export const creatorAdultGateReasonValues = [
  'no_consumer_account',
  'adult_declaration_missing',
  'not_in_good_standing',
] as const;
export const creatorAdultGateReasonSchema = z.enum(
  creatorAdultGateReasonValues,
);
export type CreatorAdultGateReasonValue = z.infer<
  typeof creatorAdultGateReasonSchema
>;

export const creatorPolicyKeyValues = [
  'creator_terms',
  'creator_content_policy',
] as const;
export const creatorPolicyKeySchema = z.enum(creatorPolicyKeyValues);
export type CreatorPolicyKeyValue = z.infer<typeof creatorPolicyKeySchema>;

/**
 * A creator policy document and the exact version currently required. No legal
 * copy travels on the wire: the acknowledgement records which version was
 * accepted, and the copy for a version is published by other means.
 */
export const creatorPolicyDocumentSchema = z
  .object({
    key: creatorPolicyKeySchema,
    version: z.string().min(1).max(32),
  })
  .strict();
export type CreatorPolicyDocument = z.infer<typeof creatorPolicyDocumentSchema>;

export const creatorOnboardingStateResponseSchema = z
  .object({
    account: creatorAccountResponseSchema,
    /**
     * Absent when the adult gate passes. Present with a coarse reason when it
     * does not, so a creator knows what to do without learning anything about
     * how another domain reached its answer.
     */
    adultGateReason: creatorAdultGateReasonSchema.optional(),
    adultGateSatisfied: z.boolean(),
    outstandingPolicies: z.array(creatorPolicyDocumentSchema).max(16),
    step: creatorOnboardingStepSchema,
  })
  .strict();
export type CreatorOnboardingStateResponse = z.infer<
  typeof creatorOnboardingStateResponseSchema
>;

export const creatorPolicyAcknowledgementRequestSchema = z
  .object({
    acknowledgements: z.array(creatorPolicyDocumentSchema).min(1).max(16),
  })
  .strict();
export type CreatorPolicyAcknowledgementRequest = z.infer<
  typeof creatorPolicyAcknowledgementRequestSchema
>;

/**
 * Canonical creator handle.
 *
 * Lower-case ASCII only, which is the whole of the V1 confusable policy: a
 * repertoire with no Unicode in it cannot carry a Cyrillic `а` that renders as
 * a Latin one. Uniqueness is therefore case-insensitive by construction — the
 * server canonicalizes before it stores, so there is no second form to compare.
 *
 * A handle starts and ends with a letter or digit, so no handle is a bare
 * separator, ends in punctuation, or reads differently with a trailing dash
 * trimmed by something downstream.
 */
export const minimumCreatorHandleLength = 3;
export const maximumCreatorHandleLength = 30;
export const creatorHandlePattern = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/u;

/**
 * Handles nobody may claim.
 *
 * Two kinds, deliberately in one list. Application and system path segments,
 * because the public creator page lives under a path prefix and a sibling route
 * added later must not be shadowed by somebody's handle. And identity-adjacent
 * words, because a handle is what a visitor reads to decide who they are
 * looking at, and `support` or `velora` reads as the platform speaking.
 *
 * The list is checked against the canonical form, so `Admin` and `ADMIN` are
 * refused by the same entry.
 */
export const reservedCreatorHandles = [
  'about',
  'account',
  'accounts',
  'admin',
  'administrator',
  'api',
  'app',
  'auth',
  'billing',
  'blog',
  'c',
  'club',
  'clubs',
  'contact',
  'creator',
  'creators',
  'dashboard',
  'discovery',
  'docs',
  'explore',
  'faq',
  'help',
  'home',
  'legal',
  'login',
  'logout',
  'me',
  'messages',
  'moderation',
  'new',
  'notifications',
  'null',
  'official',
  'payments',
  'payouts',
  'policy',
  'privacy',
  'profile',
  'register',
  'report',
  'root',
  'safety',
  'search',
  'security',
  'settings',
  'signin',
  'signout',
  'signup',
  'static',
  'status',
  'studio',
  'support',
  'system',
  'terms',
  'trust',
  'undefined',
  'user',
  'users',
  'velora',
  'www',
] as const;

const reservedHandleSet: ReadonlySet<string> = new Set(reservedCreatorHandles);

/** Whether a canonical handle is one the platform keeps for itself. */
export function isReservedCreatorHandle(handle: string): boolean {
  return reservedHandleSet.has(handle);
}

/**
 * Canonical form of a caller-supplied handle.
 *
 * Case folding and surrounding whitespace only. It deliberately does not strip,
 * substitute, or repair anything else: a handle that needs repairing is a
 * handle the caller did not mean, and silently storing a different one is worse
 * than refusing.
 */
export function canonicalCreatorHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export const creatorHandleSchema = z
  .string()
  .min(minimumCreatorHandleLength)
  .max(maximumCreatorHandleLength)
  .regex(creatorHandlePattern)
  .refine((handle) => !isReservedCreatorHandle(handle), {
    error: 'Handle is reserved',
  });

/**
 * A handle as a client may submit it.
 *
 * Case is accepted and folded by the server, because a person typing their own
 * name in the case they think of it is not making a mistake, and refusing
 * `Ember_Vale` while accepting `ember_vale` would teach clients to canonicalize
 * — which is exactly the decision that must stay on the server, where one rule
 * decides what two handles collide.
 *
 * Nothing else is repaired. Whitespace, punctuation outside the repertoire, and
 * any non-ASCII character are refused rather than stripped: a handle that needs
 * stripping is not the handle the caller meant, and storing a different one is
 * worse than saying no. Reserved names are checked against the canonical form,
 * so `Admin` and `ADMIN` are refused by the same entry.
 */
export const submittedCreatorHandlePattern =
  /^[A-Za-z0-9][A-Za-z0-9_-]{1,28}[A-Za-z0-9]$/u;

export const submittedCreatorHandleSchema = z
  .string()
  .min(minimumCreatorHandleLength)
  .max(maximumCreatorHandleLength)
  .regex(submittedCreatorHandlePattern)
  .refine(
    (handle) => !isReservedCreatorHandle(canonicalCreatorHandle(handle)),
    {
      error: 'Handle is reserved',
    },
  );

export const minimumCreatorDisplayNameLength = 2;
export const maximumCreatorDisplayNameLength = 60;
export const maximumCreatorBioLength = 600;
export const maximumCreatorLinks = 5;
export const maximumCreatorLinkLabelLength = 40;
export const maximumCreatorLinkUrlLength = 200;

/**
 * A public link a creator chose to show.
 *
 * `https` only, with no credentials in the URL and a bounded length. The server
 * never fetches it: [outbound networking](../../../docs/security/06-abuse-outbound-networking.md)
 * denies egress, and a link the platform resolved on a creator's behalf would
 * be exactly the request-forgery surface that document exists to prevent. It is
 * rendered for a person to click, and nothing else.
 */
export const creatorProfileLinkSchema = z
  .object({
    label: z.string().min(1).max(maximumCreatorLinkLabelLength).optional(),
    url: z
      .string()
      .max(maximumCreatorLinkUrlLength)
      .refine(
        (value) => {
          let parsed;
          try {
            parsed = new URL(value);
          } catch {
            return false;
          }
          return (
            parsed.protocol === 'https:' &&
            parsed.username.length === 0 &&
            parsed.password.length === 0 &&
            parsed.hostname.length > 0
          );
        },
        { error: 'Link must be an https URL without credentials' },
      ),
  })
  .strict();
export type CreatorProfileLink = z.infer<typeof creatorProfileLinkSchema>;

export const creatorProfilePublicationValues = ['draft', 'published'] as const;
export const creatorProfilePublicationSchema = z.enum(
  creatorProfilePublicationValues,
);
export type CreatorProfilePublicationValue = z.infer<
  typeof creatorProfilePublicationSchema
>;

/** The creator's own view of their profile, including what is not public yet. */
export const creatorProfileResponseSchema = z
  .object({
    bio: z.string().max(maximumCreatorBioLength).optional(),
    displayName: z
      .string()
      .min(minimumCreatorDisplayNameLength)
      .max(maximumCreatorDisplayNameLength),
    handle: creatorHandleSchema,
    links: z.array(creatorProfileLinkSchema).max(maximumCreatorLinks),
    publication: creatorProfilePublicationSchema,
    publishedAt: z.iso.datetime().optional(),
    /** The public address this profile has when it is published. */
    publicPath: z.string().min(2),
    updatedAt: z.iso.datetime(),
    /**
     * Optimistic concurrency token. A save that carries a stale one is refused
     * rather than applied, so a second tab cannot silently overwrite the first.
     */
    version: z.number().int().min(1),
  })
  .strict();
export type CreatorProfileResponse = z.infer<
  typeof creatorProfileResponseSchema
>;

/**
 * Creating or editing the creator's own profile.
 *
 * The handle is carried on every save and is immutable after the first: this
 * milestone has no self-service rename, and a save that names a different
 * handle is refused rather than quietly ignored. `version` is absent on the
 * first save and required on every later one, which is what makes "create" and
 * "overwrite something I have not seen" impossible to confuse.
 */
export const saveCreatorProfileRequestSchema = z
  .object({
    bio: z.string().max(maximumCreatorBioLength).optional(),
    displayName: z
      .string()
      .min(minimumCreatorDisplayNameLength)
      .max(maximumCreatorDisplayNameLength),
    handle: submittedCreatorHandleSchema,
    links: z
      .array(creatorProfileLinkSchema)
      .max(maximumCreatorLinks)
      .optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict();
export type SaveCreatorProfileRequest = z.infer<
  typeof saveCreatorProfileRequestSchema
>;

export const creatorProfilePublicationRequestSchema = z
  .object({
    publication: creatorProfilePublicationSchema,
    version: z.number().int().min(1),
  })
  .strict();
export type CreatorProfilePublicationRequest = z.infer<
  typeof creatorProfilePublicationRequestSchema
>;

/**
 * What a visitor with no session may see.
 *
 * An explicit allow-list rather than a filtered row. Nothing here is derived
 * from the stored record by omission, so a column added later is invisible
 * until somebody decides it should be public: there is no creator identifier,
 * no AUTH subject, no consumer identifier, no lifecycle state, no moderation
 * state, no counts, and nothing purchasable.
 */
export const publicCreatorResponseSchema = z
  .object({
    bio: z.string().max(maximumCreatorBioLength).optional(),
    displayName: z
      .string()
      .min(minimumCreatorDisplayNameLength)
      .max(maximumCreatorDisplayNameLength),
    handle: creatorHandleSchema,
    links: z.array(creatorProfileLinkSchema).max(maximumCreatorLinks),
    publishedAt: z.iso.datetime(),
  })
  .strict();
export type PublicCreatorResponse = z.infer<typeof publicCreatorResponseSchema>;

/** Public path a published creator profile is reachable at. */
export function creatorPublicPath(handle: string): string {
  return `/c/${handle}`;
}
