import { z } from 'zod';

import { profileLanguageSchema } from './profile.js';
import { regionSchema } from './users.js';

/**
 * Discovery contract.
 *
 * The approved V1 policy is deliberately small and explainable. A candidate
 * appears only when every eligibility condition holds, ordering is a fixed
 * deterministic rule over authorized signals, and nothing purchasable
 * participates in either. There is no model, no attractiveness score, no
 * popularity signal, and no paid rank, so there is no schema here for one.
 */

/**
 * A candidate as another consumer may see it.
 *
 * Minimized on purpose. Languages are the ones the two people actually share
 * rather than everything the candidate speaks, availability is not published as
 * a time — that a person appears at all already means they are currently
 * available, and publishing when their window closes would leak presence — and
 * nothing here describes why anybody else is absent.
 */
export const discoveryCandidateSchema = z
  .object({
    bio: z.string().optional(),
    displayName: z.string(),
    id: z.uuid(),
    /**
     * References to the candidate's ready images, newest slot order first.
     *
     * Each one is a media asset reference and nothing else: it carries no
     * address, and it is worth nothing on its own. A surface exchanges it at
     * `/v1/media/deliveries` for a short-lived address, and that exchange
     * re-decides the whole question — so holding one of these after the pair
     * stops being eligible buys nothing.
     */
    media: z
      .array(
        z.object({ id: z.uuid(), position: z.number().int().min(0) }).strict(),
      )
      .max(8),
    region: regionSchema.optional(),
    sharedLanguages: z.array(profileLanguageSchema).max(8),
  })
  .strict();

export const discoveryFeedResponseSchema = z
  .object({
    candidates: z.array(discoveryCandidateSchema),
    /**
     * Position in this feed, opaque and forward-only. It is not a credential:
     * every candidate is re-evaluated against the full eligibility rules for
     * the calling account, so a tampered cursor can only move the caller around
     * their own results.
     */
    nextCursor: z.string().optional(),
    /**
     * Which ranking rule produced this page, so a result can be explained and
     * measured later without guessing what the rule was at the time.
     */
    rankingVersion: z.string(),
  })
  .strict();

/** A private, non-notifying decline of one candidate. */
export const discoveryPassRequestSchema = z
  .object({ candidateId: z.uuid() })
  .strict();

export const discoveryPassResponseSchema = z
  .object({
    /** When this pair becomes eligible for ordinary discovery again. */
    suppressedUntil: z.iso.datetime(),
  })
  .strict();

export type DiscoveryCandidate = z.infer<typeof discoveryCandidateSchema>;
export type DiscoveryFeedResponse = z.infer<typeof discoveryFeedResponseSchema>;

/**
 * Introductions.
 *
 * A mutual introduction means both people deliberately opted in. Nothing else
 * produces one: not a payment, not a popularity signal, not an automated match,
 * and not one side acting twice.
 */
export const introductionStateSchema = z.enum(['pending', 'mutual', 'closed']);

/** Which side of the pair the caller is. Never disclosed to the other side. */
export const introductionRoleSchema = z.enum(['initiator', 'recipient']);

export const introductionSchema = z
  .object({
    /** The other person, in the same minimized shape discovery uses. */
    counterpart: discoveryCandidateSchema,
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    mutualAt: z.iso.datetime().optional(),
    role: introductionRoleSchema,
    state: introductionStateSchema,
  })
  .strict();

export const introductionListResponseSchema = z
  .object({
    introductions: z.array(introductionSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

export const createIntroductionRequestSchema = z
  .object({ candidateId: z.uuid() })
  .strict();

export const introductionReferenceRequestSchema = z
  .object({ introductionId: z.uuid() })
  .strict();

export type Introduction = z.infer<typeof introductionSchema>;
