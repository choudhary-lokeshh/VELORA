/**
 * NIGHT CURRENT, on a phone.
 *
 * `docs/design/01-design-principles.md` approves exactly one Consumer visual
 * expression — tonal dark, media-first, intimate, socially alive — and
 * [ADR-0027] filled it in for `apps/web` as NIGHT CURRENT. Consumer Mobile is
 * the same product for the same person on a different device, so it uses the
 * same expression rather than a fourth one invented here. What changes is the
 * idiom, not the palette: native navigation, native lifecycle, native gestures,
 * a touch-first density, and no hover state anywhere.
 *
 * Every colour below is the value `apps/web/app/styles/tokens.css` publishes
 * under the same name, and `test/design.test.ts` parses that stylesheet and
 * fails if the two ever disagree. Two copies of a palette drift silently; a
 * copy with an assertion against its source does not. The duplication itself is
 * required rather than chosen — React Native cannot consume a CSS custom
 * property, and [ADR-0015](../../../../docs/decisions/ADR-0015-shared-design-token-boundary.md)
 * restricts `packages/design-tokens` to values an approved Figma handoff has
 * fixed, which these are not.
 *
 * What is *not* copied is layout. A sidebar width, a content maximum, and a
 * reading measure are answers to a question a phone does not ask.
 */

import { approvedMasterFoundation } from '@velora/design-tokens';

/* =============================== Rhythm ============================== */

/**
 * The approved 4 px rhythm. Every spacing value in the product is one of these
 * and nothing composes a number of its own.
 */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
} as const;

/* =============================== Colour ============================== */

export const color = {
  /* Surfaces. A tonal ladder, warm-neutral rather than blue-black. */
  canvas: '#0c0a0c',
  canvasDeep: '#070508',
  surface1: '#141115',
  surface2: '#1b171c',
  surface3: '#242028',
  surfaceInset: '#100d11',
  surfaceOverlay: 'rgba(7, 5, 8, 0.72)',

  /* Foreground. */
  textPrimary: '#f6f1f3',
  textSecondary: '#bab0b7',
  textTertiary: '#918691',
  textOnAccent: '#1b0f0c',

  /* Borders and dividers. */
  borderHairline: 'rgba(246, 241, 243, 0.08)',
  borderSoft: 'rgba(246, 241, 243, 0.14)',
  borderStrong: 'rgba(246, 241, 243, 0.26)',

  /*
   * Brand signal. `#B85645` is the approved Living Ember and `#E17A66` its
   * approved dark expression; a dark surface uses the dark expression, and the
   * base value is kept for pressed states, where a darker step is what a press
   * should look like.
   */
  ember: '#e17a66',
  emberBright: '#ee8f7a',
  emberDeep: '#b85645',
  emberWash: 'rgba(225, 122, 102, 0.14)',
  emberWashStrong: 'rgba(225, 122, 102, 0.22)',
  emberLine: 'rgba(225, 122, 102, 0.38)',

  /*
   * Semantic status, distinct in hue from the brand signal because a
   * destructive action that looks like the primary action is a trap. Colour is
   * never the only cue: every status in this product also carries a mark and
   * words.
   */
  statusPositive: '#5fc08a',
  statusPositiveWash: 'rgba(95, 192, 138, 0.14)',
  statusCaution: '#e4b04a',
  statusCautionWash: 'rgba(228, 176, 74, 0.14)',
  statusCritical: '#f2606a',
  statusCriticalWash: 'rgba(242, 96, 106, 0.14)',
  statusNeutral: '#82a9de',
  statusNeutralWash: 'rgba(130, 169, 222, 0.14)',
} as const;

export type ColorName = keyof typeof color;

/* ================================ Radii ============================== */

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/* ============================== Typography =========================== */

/**
 * The approved interface typeface, in the four weights the product uses.
 *
 * The names are the ones `@expo-google-fonts/ibm-plex-sans` registers, and
 * `src/design/typeface.ts` is the only place they are loaded. A screen that
 * renders before the files are ready falls back to the platform's own face
 * rather than to nothing, which is why every text style names a family and none
 * of them assumes one is present.
 */
export const fontFamily = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
} as const;

export type FontWeightName = keyof typeof fontFamily;

/**
 * The type scale, in points rather than in `rem`.
 *
 * The web scale fluidly interpolates its two largest steps against the
 * viewport. A phone sits at the narrow end of that range in every orientation,
 * so those two steps take their narrow value here — the same number a 320 px
 * browser would compute — rather than a size no phone would ever have shown.
 *
 * `lineHeight` is absolute because React Native has no unitless multiplier. Each
 * one is its web multiplier applied to its own size and rounded, so the vertical
 * rhythm of a paragraph is the rhythm the other surface has.
 */
export const text = {
  display: { lineHeight: 33, size: 30 },
  title: { lineHeight: 29, size: 24 },
  heading: { lineHeight: 28, size: 22 },
  subheading: { lineHeight: 24, size: 17 },
  body: { lineHeight: 25, size: 16 },
  small: { lineHeight: 20, size: 14 },
  caption: { lineHeight: 18, size: 13 },
  micro: { lineHeight: 16, size: 12 },
} as const;

export type TextStyleName = keyof typeof text;

/**
 * Tracking, held as the `em` fraction the other surface uses.
 *
 * React Native's `letterSpacing` is absolute, so a fraction has to be resolved
 * against the size it is applied to. Keeping the fraction and resolving late is
 * what makes a label at 12 pt and the same label at 13 pt look like one
 * decision rather than two.
 */
export const tracking = {
  label: 0.08,
  wordmark: 0.24,
} as const;

export function letterSpacing(size: number, em: number): number {
  return Math.round(size * em * 100) / 100;
}

/* ============================== Elevation ============================ */

/**
 * Depth as shadow rather than as a lighter fill, so it survives on a dark
 * surface. Android reads `elevation` and ignores the rest; iOS reads the rest
 * and ignores `elevation`. Both are given, because a card that is flat on one
 * platform is a different product on that platform.
 */
export const shadow = {
  1: {
    elevation: 1,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
  },
  2: {
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
  },
  3: {
    elevation: 16,
    shadowColor: '#000000',
    shadowOffset: { height: 24, width: 0 },
    shadowOpacity: 0.78,
    shadowRadius: 60,
  },
} as const;

/* =============================== Motion ============================== */

/**
 * Short, eased, and never in the way of an action.
 *
 * The curves are the other surface's, as bezier control points rather than as a
 * CSS function. Every animation in the product asks
 * `useReducedMotion()` first, and a person who has turned motion down gets the
 * end state immediately rather than a shorter version of the same movement.
 */
export const motion = {
  easeOut: [0.22, 0.8, 0.28, 1],
  easeInOut: [0.5, 0, 0.2, 1],
  durationFast: 120,
  durationBase: 200,
  durationSlow: 320,
} as const;

/* =============================== Layout ============================== */

/**
 * The touch-first measurements, which is where a phone genuinely differs.
 *
 * `minimumTouchTarget` is 44, the smallest comfortable target both platform
 * guidelines agree on and the same value the other surfaces use for a control
 * height. Nothing tappable in this product is smaller, including a control
 * whose visible box is smaller — those carry a hit slop instead.
 */
export const layout = {
  minimumTouchTarget: 44,
  controlHeight: 48,
  controlHeightSmall: 40,
  controlHeightLarge: 56,
  tabBarHeight: 56,
  headerHeight: 52,
  avatarSmall: 36,
  avatarMedium: 48,
  avatarLarge: 88,
  hairline: 1,
} as const;

/* ================================ Icons ============================== */

/** The approved 1.75 px stroke, published by the shared foundation. */
export const icon = {
  stroke: approvedMasterFoundation.icon.strokeWidth,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

/* =============================== Layering ============================ */

/** Named because a bare number tells a reader nothing. */
export const layer = {
  sticky: 20,
  navigation: 30,
  overlay: 40,
  dialog: 50,
  toast: 60,
} as const;
