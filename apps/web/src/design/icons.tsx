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
 * An icon is never the only carrier of meaning. Every caller supplies words as
 * well, and an icon that is purely decorative is hidden from assistive
 * technology by the `aria-hidden` default here rather than by each caller
 * remembering.
 */

export const iconNames = [
  'alert',
  'appeal',
  'arrowLeft',
  'ban',
  'bell',
  'calendar',
  'camera',
  'cameraOff',
  'cameraSwitch',
  'check',
  'chevronDown',
  'chevronRight',
  'clock',
  'compass',
  'flag',
  'globe',
  'help',
  'heart',
  'info',
  'languages',
  'link',
  'live',
  'lock',
  'logOut',
  'membership',
  'message',
  'mic',
  'micOff',
  'moreHorizontal',
  'phone',
  'phoneOff',
  'plus',
  'refresh',
  'send',
  'settings',
  'shield',
  'sparkle',
  'trash',
  'user',
  'video',
  'x',
] as const;

export type IconName = (typeof iconNames)[number];

/** One path list per mark, on a 24-unit grid. */
const paths: Readonly<Record<IconName, readonly string[]>> = {
  alert: ['M12 3 2.5 20h19L12 3Z', 'M12 10v4', 'M12 17.2v.1'],
  appeal: ['M4 6h16', 'M4 12h10', 'M4 18h6', 'M15 19l3-3 3 3', 'M18 16v6'],
  arrowLeft: ['M19 12H5', 'M11 18l-6-6 6-6'],
  ban: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M5.6 5.6l12.8 12.8'],
  bell: [
    'M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z',
    'M13.7 20a2 2 0 0 1-3.4 0',
  ],
  calendar: [
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    'M4 10h16',
    'M8 3v4',
    'M16 3v4',
  ],
  camera: [
    'M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
    'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  ],
  cameraOff: [
    'M4 8h2.2',
    'M9.4 5.6h6l1.6 2.4h3a1 1 0 0 1 1 1v7.6',
    'M19.2 19H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1',
    'M9.9 11.2a3.5 3.5 0 0 0 4.7 4.7',
    'M3.5 3.5l17 17',
  ],
  cameraSwitch: [
    'M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
    'M9.4 13.4a2.8 2.8 0 0 1 4.6-2.2',
    'M14.6 13.4a2.8 2.8 0 0 1-4.6 2.2',
    'M14 9.4h1.6V11',
    'M10 17.4H8.4V15.8',
  ],
  check: ['M20 6.5 9.5 17 4 11.5'],
  chevronDown: ['M6 9.5l6 6 6-6'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5.2l3.4 2'],
  compass: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M15.6 8.4 13.8 14 8.4 15.6 10.2 10Z',
  ],
  flag: ['M5 21V4', 'M5 5h11l-1.6 3.5L16 12H5'],
  globe: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M3.5 9.5h17',
    'M3.5 14.5h17',
    'M12 3c-2.4 2.6-3.6 5.6-3.6 9s1.2 6.4 3.6 9c2.4-2.6 3.6-5.6 3.6-9S14.4 5.6 12 3Z',
  ],
  // A question inside the same circle `info` uses, so the two read as the same
  // family: one tells somebody something, the other asks on their behalf.
  help: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2-2.5 3.6',
    'M12 17.2v.1',
  ],
  heart: [
    'M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.6 12 20 12 20Z',
  ],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5.5', 'M12 7.6v.1'],
  languages: [
    'M3 6h9',
    'M7.5 4v2',
    'M10 6c0 4-3 7-7 7',
    'M6 10.5c1.4 2 3.2 3.2 5 3.8',
    'M13 20l4-9 4 9',
    'M14.4 17h5.2',
  ],
  link: [
    'M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.9 6.4',
    'M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.2-1.2',
  ],
  live: [
    'M12 14.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z',
    'M7.8 16.2a5.9 5.9 0 0 1 0-8.4',
    'M16.2 7.8a5.9 5.9 0 0 1 0 8.4',
    'M4.9 19.1a10 10 0 0 1 0-14.2',
    'M19.1 4.9a10 10 0 0 1 0 14.2',
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
  membership: [
    'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
    'M3 10h18',
    'M7 14.5h4',
  ],
  message: [
    'M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v4l4.5-4H20a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z',
  ],
  mic: [
    'M12 3.8a2.8 2.8 0 0 1 2.8 2.8v5a2.8 2.8 0 0 1-5.6 0v-5A2.8 2.8 0 0 1 12 3.8Z',
    'M5.5 11.2a6.5 6.5 0 0 0 13 0',
    'M12 17.7V21',
    'M8.5 21h7',
  ],
  micOff: [
    'M14.8 6.4a2.8 2.8 0 0 0-5.6.2v4.6',
    'M14.8 11.9a2.8 2.8 0 0 1-3.6 2.7',
    'M5.5 11.2a6.5 6.5 0 0 0 9.7 5.6',
    'M18.5 11.2a6.5 6.5 0 0 1-.5 2.5',
    'M12 17.7V21',
    'M8.5 21h7',
    'M3.5 3.5l17 17',
  ],
  moreHorizontal: ['M6 12v.1', 'M12 12v.1', 'M18 12v.1'],
  phone: [
    'M7.2 4h3l1.3 3.4-2 1.4a11 11 0 0 0 5.7 5.7l1.4-2L20 13.8v3A3.2 3.2 0 0 1 16.5 20 13.5 13.5 0 0 1 4 7.5 3.2 3.2 0 0 1 7.2 4Z',
  ],
  phoneOff: [
    'M9.6 4h-2.4A3.2 3.2 0 0 0 4 7.5c0 1.5.2 2.9.7 4.2',
    'M11.2 16.4A11 11 0 0 1 8 13.2',
    'M13.5 19.8a13.4 13.4 0 0 0 3 .2A3.2 3.2 0 0 0 20 16.8v-3l-3.4-1.3-1.4 2',
    'M3.5 3.5l17 17',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4.5h-4.5'],
  send: ['M21 3 3 10.4l7.2 2.9L13.4 21 21 3Z', 'M10.2 13.3 21 3'],
  settings: [
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
    'M4.6 14.4A1.4 1.4 0 0 0 4.3 16l.5.9a1.4 1.4 0 0 0 1.5.6l1-.2a6.6 6.6 0 0 0 1.7 1l.3 1c.1.7.7 1.2 1.4 1.2h1a1.4 1.4 0 0 0 1.4-1.1l.3-1a6.6 6.6 0 0 0 1.7-1l1 .2a1.4 1.4 0 0 0 1.5-.6l.5-.9a1.4 1.4 0 0 0-.3-1.7l-.7-.7a6.7 6.7 0 0 0 0-2l.7-.7a1.4 1.4 0 0 0 .3-1.7l-.5-.9a1.4 1.4 0 0 0-1.5-.6l-1 .2a6.6 6.6 0 0 0-1.7-1l-.3-1A1.4 1.4 0 0 0 12.5 3h-1a1.4 1.4 0 0 0-1.4 1.1l-.3 1a6.6 6.6 0 0 0-1.7 1l-1-.2a1.4 1.4 0 0 0-1.5.6l-.5.9a1.4 1.4 0 0 0 .3 1.7l.7.7a6.7 6.7 0 0 0 0 2l-.5.6Z',
  ],
  shield: [
    'M12 3.5 5 6.2v5.4c0 4 2.9 7.3 7 8.9 4.1-1.6 7-4.9 7-8.9V6.2L12 3.5Z',
    'M9.2 12.2 11.3 14.4 15 10.6',
  ],
  sparkle: [
    'M12 3.5 13.7 9 19 10.8 13.7 12.6 12 18l-1.7-5.4L5 10.8 10.3 9 12 3.5Z',
    'M18.5 16.5 19.2 18.6 21.2 19.3 19.2 20 18.5 22 17.8 20 15.8 19.3 17.8 18.6 18.5 16.5Z',
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
  video: [
    'M4 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
    'M15 10.5 21 7v10l-6-3.5v-3Z',
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
