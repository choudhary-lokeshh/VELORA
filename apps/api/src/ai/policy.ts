import type { AiCapability, AuthAudience } from '@velora/validation';

export const aiRunStates = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type AiRunState = (typeof aiRunStates)[number];

export const aiProviderIds = ['local-test'] as const;
export const aiModelId = 'velora-local-deterministic-v1';
export const aiPromptVersion = '2026-08-26.1';
export const aiOutputSchemaVersion = 'suggestion.v1';
export const aiSafetyVersion = 'draft-safety.1';
export const aiDailyRunLimit = 50;
export const aiTimeoutMilliseconds = 8_000;

export const audiencesByAiCapability = {
  admin_case_summary: ['platform_admin'],
  consumer_chat_reply: ['consumer_web', 'consumer_mobile'],
  consumer_profile_bio: ['consumer_web', 'consumer_mobile'],
  creator_club_announcement: ['creator_studio'],
  creator_content_caption: ['creator_studio'],
  creator_content_description: ['creator_studio'],
  creator_content_idea: ['creator_studio'],
  creator_content_title: ['creator_studio'],
  creator_profile_bio: ['creator_studio'],
} as const satisfies Record<AiCapability, readonly AuthAudience[]>;

export function aiAudienceAllowed(
  capability: AiCapability,
  audience: AuthAudience,
): boolean {
  return (audiencesByAiCapability[capability] as readonly string[]).includes(
    audience,
  );
}
