import { z } from 'zod';

/** Product AI is suggestion-only. Capabilities encode the allowed surface. */
export const aiCapabilities = [
  'consumer_profile_bio',
  'consumer_chat_reply',
  'creator_profile_bio',
  'creator_content_caption',
  'creator_content_title',
  'creator_content_description',
  'creator_content_idea',
  'creator_club_announcement',
  'admin_case_summary',
] as const;

export const aiCapabilitySchema = z.enum(aiCapabilities);
export type AiCapability = z.infer<typeof aiCapabilitySchema>;

export const aiTones = [
  'clear',
  'warm',
  'confident',
  'playful',
  'flirtatious',
  'concise',
] as const;
export const aiToneSchema = z.enum(aiTones);

/**
 * The caller supplies only the draft and a small, already-authorized context
 * projection. Provider/model/prompt selection and actor identity are absent by
 * construction. The server treats both strings as untrusted.
 */
export const aiSuggestionRequestSchema = z
  .object({
    capability: aiCapabilitySchema,
    context: z.string().trim().max(2_000).optional(),
    draft: z.string().trim().max(2_000).default(''),
    /** Client-created opaque run identity enables a true in-flight cancel. */
    runId: z.uuid(),
    tone: aiToneSchema.default('warm'),
  })
  .strict();

export const aiSuggestionResponseSchema = z
  .object({
    capability: aiCapabilitySchema,
    modelId: z.string().min(1).max(80),
    outputSchemaVersion: z.string().min(1).max(40),
    promptVersion: z.string().min(1).max(40),
    providerId: z.string().min(1).max(80),
    runId: z.uuid(),
    suggestedText: z.string().min(1).max(2_000),
    usage: z
      .object({
        estimatedCostMicrounits: z.number().int().min(0),
        inputCharacters: z.number().int().min(0),
        outputCharacters: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

export const aiRunCancellationRequestSchema = z
  .object({ runId: z.uuid() })
  .strict();

export const aiRunCancellationResponseSchema = z
  .object({ cancelled: z.boolean(), runId: z.uuid() })
  .strict();

export type AiSuggestionRequest = z.infer<typeof aiSuggestionRequestSchema>;
export type AiSuggestionResponse = z.infer<typeof aiSuggestionResponseSchema>;
