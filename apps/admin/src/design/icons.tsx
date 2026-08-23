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
 * This is Platform Admin's own set. `AGENTS.md` keeps the surfaces separate,
 * and the three do not want the same marks: nothing on a consumer feed draws a
 * scale, and nothing in a creator's workspace draws a queue.
 *
 * An icon is never the only carrier of meaning. Every caller supplies words as
 * well, and an icon that is purely decorative is hidden from assistive
 * technology by the `aria-hidden` default here rather than by each caller
 * remembering.
 */

export const iconNames = [
  'alert',
  'arrowLeft',
  'ban',
  'bell',
  'check',
  'chevronDown',
  'chevronRight',
  'clock',
  'filter',
  'flag',
  'gauge',
  'identity',
  'image',
  'info',
  'ledger',
  'lock',
  'logOut',
  'phone',
  'queue',
  'refresh',
  'scale',
  'search',
  'shield',
  'sparkle',
  'undo',
  'users',
  'x',
] as const;

export type IconName = (typeof iconNames)[number];

/** One path list per mark, on a 24-unit grid. */
const paths: Readonly<Record<IconName, readonly string[]>> = {
  alert: ['M12 3 2.5 20h19L12 3Z', 'M12 10v4', 'M12 17.2v.1'],
  arrowLeft: ['M19 12H5', 'M11 18l-6-6 6-6'],
  ban: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M5.6 5.6l12.8 12.8'],
  bell: [
    'M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z',
    'M13.7 20a2 2 0 0 1-3.4 0',
  ],
  check: ['M20 6.5 9.5 17 4 11.5'],
  chevronDown: ['M6 9.5l6 6 6-6'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5.2l3.4 2'],
  filter: ['M3.5 5.5h17', 'M6.5 12h11', 'M10 18.5h4'],
  flag: ['M5 21V4', 'M5 5h11l-1.6 3.5L16 12H5'],
  gauge: ['M4 18a9 9 0 1 1 16 0', 'M12 18l4.2-5.4', 'M12 18.1v.1'],
  identity: [
    'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z',
    'M9 12.2a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z',
    'M5.6 16.4a3.7 3.7 0 0 1 6.8 0',
    'M14.5 9.5h4',
    'M14.5 13h3',
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
  lock: [
    'M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z',
    'M8.5 11V7.8a3.5 3.5 0 0 1 7 0V11',
  ],
  logOut: [
    'M15 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3',
    'M11 16l4-4-4-4',
    'M15 12H4',
  ],
  phone: [
    'M7.2 4h3l1.3 3.4-2 1.4a11 11 0 0 0 5.7 5.7l1.4-2L20 13.8v3A3.2 3.2 0 0 1 16.5 20 13.5 13.5 0 0 1 4 7.5 3.2 3.2 0 0 1 7.2 4Z',
  ],
  queue: ['M4 6h10', 'M4 12h16', 'M4 18h7', 'M17.5 4.5v3.2', 'M16 6h3'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4.5h-4.5'],
  scale: [
    'M12 4v16',
    'M7 20h10',
    'M4 8h16',
    'M4 8 1.8 13.2a2.6 2.6 0 0 0 4.4 0Z',
    'M20 8l2.2 5.2a2.6 2.6 0 0 1-4.4 0Z',
  ],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'M16.2 16.2 21 21'],
  shield: [
    'M12 3.5 5 6.2v5.4c0 4 2.9 7.3 7 8.9 4.1-1.6 7-4.9 7-8.9V6.2L12 3.5Z',
    'M9.2 12.2 11.3 14.4 15 10.6',
  ],
  sparkle: [
    'M12 3.5 13.7 9 19 10.8 13.7 12.6 12 18l-1.7-5.4L5 10.8 10.3 9 12 3.5Z',
    'M18.5 16.5 19.2 18.6 21.2 19.3 19.2 20 18.5 22 17.8 20 15.8 19.3 17.8 18.6 18.5 16.5Z',
  ],
  undo: ['M4 10.5h8.5a5 5 0 1 1 0 10H8', 'M8 6 3.5 10.5 8 15'],
  users: [
    'M9.5 11.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z',
    'M3 20a6.6 6.6 0 0 1 13 0',
    'M16 4.8a3.6 3.6 0 0 1 0 6.9',
    'M17.4 14.2A6.6 6.6 0 0 1 21 20',
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
