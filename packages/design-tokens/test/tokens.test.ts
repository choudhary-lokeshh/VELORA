import { describe, expect, it } from 'vitest';

import {
  approvedMasterFoundation,
  designTokenStatus,
  semanticColorRoles,
  surfaceThemeNames,
} from '../src/index.js';

describe('approved Master Visual Language contract', () => {
  it('pins only approved foundation values', () => {
    expect(approvedMasterFoundation.color).toEqual({
      livingEmber: '#B85645',
      livingEmberDark: '#E17A66',
    });
    expect(approvedMasterFoundation.rhythm.base).toBe(4);
    expect(approvedMasterFoundation.icon.strokeWidth).toBe(1.75);
    expect(approvedMasterFoundation.focus.width).toBe(2);
    expect(approvedMasterFoundation.typography).toEqual({
      creatorEditorial: 'Source Serif 4',
      globalScriptFallbacks: ['Noto Sans'],
      interface: 'IBM Plex Sans',
    });
  });

  it('defines semantic contracts without inventing theme values', () => {
    expect(surfaceThemeNames).toEqual([
      'consumer-dark',
      'consumer-light',
      'creator',
      'admin',
    ]);
    expect(semanticColorRoles).toContain('status.danger');
    expect(designTokenStatus.exactThemeValues).toBe('DESIGN REQUIRED');
  });
});
