import { z } from 'zod';

import { creatorAccountStatusSchema, creatorHandleSchema } from './creator.js';
import { currencyCodeSchema, minorUnitsSchema } from './money.js';

/**
 * ADMIN wire vocabulary for creator operations.
 *
 * `docs/domains/admin.md` makes ADMIN an operations layer rather than an owner
 * of business truth: every route here invokes a domain's own service with a
 * privileged actor and a reason, and none of them reads or writes another
 * domain's tables directly.
 *
 * Nothing here carries a bank account, a tax identifier, a payout credential,
 * or a raw identity document. `docs/product/04-platform-admin.md` keeps Admin
 * from becoming a creator's financial vault, and a field that exists is a field
 * something eventually fills.
 */

/** Why an operator acted. A closed vocabulary, never free text. */
export const adminCreatorReasonCodeValues = [
  'underage_risk',
  'harassment',
  'sexual_content_violation',
  'impersonation',
  'spam_or_scam',
  'platform_integrity',
] as const;
export const adminCreatorReasonCodeSchema = z.enum(
  adminCreatorReasonCodeValues,
);
export type AdminCreatorReasonCodeValue = z.infer<
  typeof adminCreatorReasonCodeSchema
>;

/**
 * One creator as an operator sees them.
 *
 * Operational state and nothing else: no AUTH subject, no consumer identifier,
 * no email, no address, no financial detail, and no moderation narrative. An
 * operator learns what a creator's capability is doing and can act on it.
 */
export const adminCreatorSchema = z
  .object({
    activatedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    handle: creatorHandleSchema.optional(),
    id: z.uuid(),
    profilePublished: z.boolean(),
    status: creatorAccountStatusSchema,
    statusReason: z.string().max(64).optional(),
    suspendedAt: z.iso.datetime().optional(),
  })
  .strict();
export type AdminCreator = z.infer<typeof adminCreatorSchema>;

export const adminCreatorListResponseSchema = z
  .object({
    creators: z.array(adminCreatorSchema).max(50),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type AdminCreatorListResponse = z.infer<
  typeof adminCreatorListResponseSchema
>;

export const adminSuspendCreatorRequestSchema = z
  .object({
    creatorId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminSuspendCreatorRequest = z.infer<
  typeof adminSuspendCreatorRequestSchema
>;

export const adminReinstateCreatorRequestSchema = z
  .object({
    creatorId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminReinstateCreatorRequest = z.infer<
  typeof adminReinstateCreatorRequestSchema
>;

/** What an operator may take down, named by a closed vocabulary. */
export const adminRemovableObjectValues = [
  'creator_profile',
  'creator_content',
  'club',
] as const;
export const adminRemovableObjectSchema = z.enum(adminRemovableObjectValues);
export type AdminRemovableObjectValue = z.infer<
  typeof adminRemovableObjectSchema
>;

export const adminRemoveObjectRequestSchema = z
  .object({
    creatorId: z.uuid(),
    /** Omitted for a profile, which is identified by its creator. */
    objectId: z.uuid().optional(),
    objectType: adminRemovableObjectSchema,
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminRemoveObjectRequest = z.infer<
  typeof adminRemoveObjectRequestSchema
>;

export const adminRevokeMembershipRequestSchema = z
  .object({
    creatorId: z.uuid(),
    membershipId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminRevokeMembershipRequest = z.infer<
  typeof adminRevokeMembershipRequestSchema
>;

/**
 * The record of one operation, returned so an operator sees what was written
 * rather than being told it worked.
 */
export const adminOperationResponseSchema = z
  .object({
    creator: adminCreatorSchema,
    enforcementId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
    recordedAt: z.iso.datetime(),
    scope: z.string().min(1).max(64),
  })
  .strict();
export type AdminOperationResponse = z.infer<
  typeof adminOperationResponseSchema
>;

/** Bounded free-text search over the public handle only. */
export const adminCreatorSearchSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/u);

/**
 * What an operator may see of the platform's money.
 *
 * Counts and per-currency totals, and nothing that identifies anybody. No
 * provider reference, no provider idempotency key, no payout recipient
 * reference, no bank detail, no identity document, and no consumer contact
 * detail: an operator needs to know what state the platform's money is in and
 * be able to act on it, and none of those help with that.
 *
 * There is no cross-currency total anywhere, because adding a euro to a yen
 * produces a number with no meaning that somebody would act on.
 */
export const adminFinancialStateSchema = z
  .object({ count: z.number().int().min(0), state: z.string().min(1).max(64) })
  .strict();

export const adminFinancialTotalSchema = z
  .object({ amountMinor: minorUnitsSchema, currency: currencyCodeSchema })
  .strict();

/**
 * Which capability seams are open, reported as the names of the configured
 * adapters.
 *
 * An operator seeing `unavailable` across the row is seeing the truth: no
 * payment provider, no payout provider, no published commercial terms, no
 * approved launch country, and no tax authority. Reporting the adapter name
 * rather than a boolean is what makes the difference between "off" and "off
 * because nobody has approved one" visible without a second screen.
 */
export const adminCapabilityStateSchema = z
  .object({
    commerceEligibility: z.string().min(1).max(64),
    commercePolicy: z.string().min(1).max(64),
    paymentProvider: z.string().min(1).max(64),
    payoutPolicy: z.string().min(1).max(64),
    payoutProvider: z.string().min(1).max(64),
    taxAuthority: z.string().min(1).max(64),
  })
  .strict();

export const adminFinancialStateResponseSchema = z
  .object({
    capabilities: adminCapabilityStateSchema,
    disputes: z.array(adminFinancialStateSchema),
    openDisputeTotals: z.array(adminFinancialTotalSchema),
    payableTotals: z.array(adminFinancialTotalSchema),
    payments: z.array(adminFinancialStateSchema),
    payouts: z.array(adminFinancialStateSchema),
    reconciliation: z.array(adminFinancialStateSchema),
    refunds: z.array(adminFinancialStateSchema),
    subscriptions: z.array(adminFinancialStateSchema),
  })
  .strict();
export type AdminFinancialStateResponse = z.infer<
  typeof adminFinancialStateResponseSchema
>;
