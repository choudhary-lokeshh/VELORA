export const approvedMasterFoundation = {
  color: {
    livingEmber: '#B85645',
    livingEmberDark: '#E17A66',
  },
  focus: {
    width: 2,
  },
  icon: {
    strokeWidth: 1.75,
  },
  rhythm: {
    base: 4,
  },
  typography: {
    creatorEditorial: 'Source Serif 4',
    globalScriptFallbacks: ['Noto Sans'],
    interface: 'IBM Plex Sans',
  },
} as const;

export const surfaceThemeNames = [
  'consumer-dark',
  'consumer-light',
  'creator',
  'admin',
] as const;

export type SurfaceThemeName = (typeof surfaceThemeNames)[number];

export const semanticColorRoles = [
  'brand.signal',
  'text.primary',
  'text.secondary',
  'surface.canvas',
  'surface.primary',
  'border.default',
  'status.success',
  'status.warning',
  'status.danger',
  'focus.ring',
] as const;

export type SemanticColorRole = (typeof semanticColorRoles)[number];

export type SurfaceThemeContract = Readonly<Record<SemanticColorRole, string>>;

export const designTokenStatus = {
  exactThemeValues: 'DESIGN REQUIRED',
  figmaModeImplementation: 'FIGMA STARTER LIMITED',
  visualAuthority:
    'VELORA — Master Visual Language / 00 — Master Visual Language',
} as const;
