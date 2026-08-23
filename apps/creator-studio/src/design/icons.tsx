import type { CSSProperties } from 'react';

/**
 * The icon set, drawn rather than depended on.
 *
 * `docs/design/01-design-principles.md` fixes a coherent 1.75 px icon stroke as
 * part of the approved visual DNA. Every icon library worth adding draws at 2 px
 * and would have to be overridden shape by shape, so the marks below are drawn
 * on one 24-unit grid with one stroke width, which is both the approved value
 * and a value that only exists in one place.
 *
 * This is Creator Studio's own set rather than a shared one. `AGENTS.md` keeps
 * the surfaces separate, and the two do not want the same marks: nothing here
 * draws a heart or a compass, and nothing on the consumer surface draws a
 * ledger.
 *
 * An icon is never the only carrier of meaning. Every caller supplies words as
 * well, and an icon that is purely decorative is hidden from assistive
 * technology by the `aria-hidden` default here rather than by each caller
 * remembering.
 */

export const iconNames = [
  'alert',
  'archive',
  'arrowLeft',
  'arrowUpRight',
  'check',
  'chevronDown',
  'chevronRight',
  'clock',
  'copy',
  'draft',
  'eye',
  'eyeOff',
  'globe',
  'grid',
  'home',
  'image',
  'info',
  'ledger',
  'link',
  'lock',
  'logOut',
  'menu',
  'moreHorizontal',
  'pencil',
  'plus',
  'refresh',
  'shield',
  'sparkle',
  'ticket',
  'trash',
  'user',
  'users',
  'wallet',
  'x',
] as const;

export type IconName = (typeof iconNames)[number];

/** One path list per mark, on a 24-unit grid. */
const paths: Readonly<Record<IconName, readonly string[]>> = {
  alert: ['M12 3 2.5 20h19L12 3Z', 'M12 10v4', 'M12 17.2v.1'],
  archive: [
    'M3.5 4.5h17v4h-17v-4Z',
    'M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10',
    'M9.8 12.5h4.4',
  ],
  arrowLeft: ['M19 12H5', 'M11 18l-6-6 6-6'],
  arrowUpRight: ['M8 16 16 8', 'M9.5 8H16v6.5'],
  check: ['M20 6.5 9.5 17 4 11.5'],
  chevronDown: ['M6 9.5l6 6 6-6'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5.2l3.4 2'],
  copy: [
    'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z',
    'M5.5 15.5A1.5 1.5 0 0 1 4 14V5.5A1.5 1.5 0 0 1 5.5 4H14a1.5 1.5 0 0 1 1.5 1.5',
  ],
  draft: [
    'M13.5 3.5H7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-4.5-4.5Z',
    'M13.5 3.5V8H18',
    'M9 13h6',
    'M9 16.5h4',
  ],
  eye: [
    'M2.8 12S6.4 6 12 6s9.2 6 9.2 6-3.6 6-9.2 6-9.2-6-9.2-6Z',
    'M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  ],
  eyeOff: [
    'M4 4.5 20 20.5',
    'M9.8 6.4A8.6 8.6 0 0 1 12 6c5.6 0 9.2 6 9.2 6a15.6 15.6 0 0 1-3 3.6',
    'M6.6 8.4A15.6 15.6 0 0 0 2.8 12S6.4 18 12 18a8.7 8.7 0 0 0 3.3-.65',
    'M10.2 10.3a2.6 2.6 0 0 0 3.5 3.5',
  ],
  globe: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M3.5 9.5h17',
    'M3.5 14.5h17',
    'M12 3c-2.4 2.6-3.6 5.6-3.6 9s1.2 6.4 3.6 9c2.4-2.6 3.6-5.6 3.6-9S14.4 5.6 12 3Z',
  ],
  grid: [
    'M4.5 4.5h6v6h-6v-6Z',
    'M13.5 4.5h6v6h-6v-6Z',
    'M4.5 13.5h6v6h-6v-6Z',
    'M13.5 13.5h6v6h-6v-6Z',
  ],
  home: [
    'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8.5Z',
    'M9.5 20v-6h5v6',
  ],
  image: [
    'M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z',
    'M8.3 10.4a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z',
    'M3.5 16.3 8.8 11.7l4.4 3.9 3-2.6 4.3 3.7',
  ],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5.5', 'M12 7.6v.1'],
  ledger: [
    'M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z',
    'M5 8h14',
    'M9 12h6',
    'M9 15.5h4',
  ],
  link: [
    'M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.9 6.4',
    'M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.2-1.2',
  ],
  lock: [
    'M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z',
    'M8.5 11V7.8a3.5 3.5 0 0 1 7 0V11',
  ],
  logOut: [
    'M15 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3',
    'M11 16l4-4-4-4',
    'M15 12H4',
  ],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  moreHorizontal: ['M6 12v.1', 'M12 12v.1', 'M18 12v.1'],
  pencil: [
    'M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L4.5 17.5v2Z',
    'M14.8 7.2 17.8 10.2',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4.5h-4.5'],
  shield: [
    'M12 3.5 5 6.2v5.4c0 4 2.9 7.3 7 8.9 4.1-1.6 7-4.9 7-8.9V6.2L12 3.5Z',
    'M9.2 12.2 11.3 14.4 15 10.6',
  ],
  sparkle: [
    'M12 3.5 13.7 9 19 10.8 13.7 12.6 12 18l-1.7-5.4L5 10.8 10.3 9 12 3.5Z',
    'M18.5 16.5 19.2 18.6 21.2 19.3 19.2 20 18.5 22 17.8 20 15.8 19.3 17.8 18.6 18.5 16.5Z',
  ],
  ticket: [
    'M4 8.5V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2.5a2.2 2.2 0 0 0 0 7V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2.5a2.2 2.2 0 0 0 0-7Z',
    'M14 6.5v2',
    'M14 11v2',
    'M14 15.5v2',
  ],
  trash: [
    'M4.5 7h15',
    'M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7',
    'M6.5 7l.8 12a1.2 1.2 0 0 0 1.2 1.1h7a1.2 1.2 0 0 0 1.2-1.1l.8-12',
  ],
  user: [
    'M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Z',
    'M4.6 20.5a7.6 7.6 0 0 1 14.8 0',
  ],
  users: [
    'M9.5 11.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z',
    'M3 20a6.6 6.6 0 0 1 13 0',
    'M16 4.8a3.6 3.6 0 0 1 0 6.9',
    'M17.4 14.2A6.6 6.6 0 0 1 21 20',
  ],
  wallet: [
    'M4 7.5A1.5 1.5 0 0 1 5.5 6h12A1.5 1.5 0 0 1 19 7.5V9',
    'M4 7.5v10A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8a.5.5 0 0 0-.5-.5H5.5A1.5 1.5 0 0 1 4 7.5Z',
    'M16.4 13.6v.1',
  ],
  x: ['M6 6l12 12', 'M18 6 6 18'],
};

export interface IconProps {
  readonly className?: string;
  /**
   * An accessible name turns the mark into an image with meaning. Left absent —
   * the usual case, because the words are next to it — the mark is hidden from
   * assistive technology instead of being read out twice.
   */
  readonly label?: string;
  readonly name: IconName;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly style?: CSSProperties;
}

const sizes: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  lg: 'var(--icon-lg)',
  md: 'var(--icon-md)',
  sm: 'var(--icon-sm)',
};

export function Icon({
  className,
  label,
  name,
  size = 'md',
  style,
}: IconProps) {
  const dimension = sizes[size];
  return (
    <svg
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className={className}
      fill="none"
      focusable="false"
      height={dimension}
      role={label === undefined ? undefined : 'img'}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="var(--icon-stroke)"
      style={{ flex: 'none', ...style }}
      viewBox="0 0 24 24"
      width={dimension}
    >
      {paths[name].map((definition) => (
        <path d={definition} key={definition} />
      ))}
    </svg>
  );
}
