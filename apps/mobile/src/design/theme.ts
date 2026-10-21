import {
  color as baseline,
  layout as baselineLayout,
  shadow as baselineShadow,
} from './tokens';

export * from './tokens';

/** Explicit preview selection only; an undeclared native build keeps NIGHT CURRENT. */
export function nativePreviewEnabled(environment: unknown): boolean {
  return environment === 'local' || environment === 'test';
}

export const ivoryPreview = nativePreviewEnabled(
  process.env.EXPO_PUBLIC_APP_ENV,
);

/** Native preview targets meet the Android touch floor without changing deployed tokens. */
export const layout = ivoryPreview
  ? { ...baselineLayout, minimumTouchTarget: 48 }
  : baselineLayout;

/** ADR-0050. Kept local to this client; compared with Web by the preview test. */
export const ivoryColor: Readonly<Record<keyof typeof baseline, string>> = {
  canvas: '#ffffff',
  canvasDeep: '#f4f5f3',
  surface1: '#ffffff',
  surface2: '#f4f5f3',
  surface3: '#e9ece8',
  surfaceInset: '#f4f5f3',
  surfaceOverlay: 'rgba(23, 37, 26, 0.62)',
  textPrimary: '#242a26',
  textSecondary: '#566057',
  textTertiary: '#566057',
  textOnAccent: '#f7f5ee',
  borderHairline: 'rgba(36, 51, 41, 0.12)',
  borderSoft: 'rgba(36, 51, 41, 0.24)',
  borderStrong: 'rgba(36, 51, 41, 0.48)',
  ember: '#324d43',
  emberBright: '#263e35',
  emberDeep: '#263e35',
  emberWash: 'rgba(50, 77, 67, 0.08)',
  emberWashStrong: 'rgba(50, 77, 67, 0.14)',
  emberLine: 'rgba(50, 77, 67, 0.40)',
  statusPositive: '#236844',
  statusPositiveWash: 'rgba(35, 104, 68, 0.09)',
  statusCaution: '#80500b',
  statusCautionWash: 'rgba(128, 80, 11, 0.09)',
  statusCritical: '#a12a3b',
  statusCriticalWash: 'rgba(161, 42, 59, 0.08)',
  statusNeutral: '#345d8c',
  statusNeutralWash: 'rgba(52, 93, 140, 0.08)',
};

export const color: Readonly<Record<keyof typeof baseline, string>> =
  ivoryPreview ? ivoryColor : baseline;
export const shadow = ivoryPreview
  ? {
      1: { ...baselineShadow[1], elevation: 0, shadowOpacity: 0.04 },
      2: { ...baselineShadow[2], elevation: 3, shadowOpacity: 0.1 },
      3: { ...baselineShadow[3], elevation: 8, shadowOpacity: 0.24 },
    }
  : baselineShadow;

/** A photo or video never inherits the light theme's dark foreground. */
export const mediaInk = '#f7f5ee';
