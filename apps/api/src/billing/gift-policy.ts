export const giftCatalogStates = ['active', 'inactive'] as const;
export type GiftCatalogState = (typeof giftCatalogStates)[number];

export const giftTiers = ['small', 'medium', 'large', 'signature'] as const;
export type GiftTier = (typeof giftTiers)[number];

export const giftVisuals = [
  'rose',
  'spark',
  'heart',
  'crown',
  'celebration',
  'diamond',
  'star',
  'ribbon',
] as const;
export type GiftVisual = (typeof giftVisuals)[number];

export const giftStates = [
  'pending',
  'sent',
  'failed',
  'partially_reversed',
  'reversed',
] as const;
export type GiftState = (typeof giftStates)[number];

export const giftContextTypes = ['creator_profile'] as const;
export type GiftContextType = (typeof giftContextTypes)[number];

export const maximumGiftHistoryPageSize = 50;
