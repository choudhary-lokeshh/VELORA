import type { GiftCatalogItem } from '@velora/consumer-client';

/**
 * One silhouette per gift, on the same 24-unit grid every other mark uses.
 *
 * Held at module scope rather than rebuilt inside a component, and in a module
 * of its own because two screens draw the same eight shapes: the picker on a
 * creator's page, where somebody chooses one, and the history under You, where
 * they read back what they sent. A gift somebody paid for and a letter of its
 * name are not the same thing to look at, and the second is what the history
 * showed before this file existed.
 *
 * The geometry is checked without a browser. A malformed `d` is not a React
 * error and not a failed request: the browser refuses to draw the shape and
 * writes one line to the console, which is exactly how a broken rose survived
 * here unnoticed.
 */
export const giftShapes: Readonly<Record<GiftCatalogItem['visual'], string>> = {
  celebration: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  crown: 'M4 8l4 4 4-7 4 7 4-4-2 11H6L4 8z',
  diamond: 'M7 4h10l4 6-9 10-9-10 4-6z',
  heart: 'M12 20S4 15 4 9a4 4 0 018-2 4 4 0 018 2c0 6-8 11-8 11z',
  ribbon: 'M8 3h8v9l-4 3-4-3V3zm2 12l-2 6 4-2 4 2-2-6',
  // A bloom seen face on: an outer petal ring, an off-centre whorl, and the
  // eye at its middle, over a stem and one leaf.
  rose:
    'M12 4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 1 0 0-9.2z' +
    'M11.6 5.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 1 0 0-5.2z' +
    'M12.6 8.2a1 1 0 1 0 0 2 1 1 0 1 0 0-2z' +
    'M11.2 13.2h1.6V21h-1.6z' +
    'M12.8 16c1.4-1.6 3.2-2.2 5-1.9-.1 1.9-1.2 3.3-2.9 3.8-.8.2-1.5.2-2.1 0z',
  spark: 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2z',
  star: 'M12 2l3 7 7 .6-5.3 4.6 1.7 7-6.4-3.7-6.4 3.7 1.7-7L2 9.6 9 9l3-7z',
};

/**
 * The mark itself.
 *
 * Decorative in every place it is drawn — the gift is named in words beside it
 * — so it is hidden from assistive technology rather than given a name that
 * would be read out twice.
 */
export function GiftArt({
  className = 'v-gift-art',
  visual,
}: {
  readonly className?: string;
  readonly visual: GiftCatalogItem['visual'];
}) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path d={giftShapes[visual]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
