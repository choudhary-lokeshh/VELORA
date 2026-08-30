import type { GiftCatalogItem } from '@velora/consumer-client';
import Svg, { Path } from 'react-native-svg';

/**
 * One silhouette per gift, on the same 24-unit grid every other mark uses.
 *
 * The same eight shapes Consumer Web and Creator Studio draw, written out
 * again rather than imported, because `AGENTS.md` holds the surfaces apart and
 * an application may not read another application's source. What keeps three
 * copies honest is not discipline: `pnpm design:parity` reads all of them and
 * fails if any character of any path disagrees, the same way it already holds
 * the two icon sets together.
 *
 * A gift somebody paid for and the first letter of its name are not the same
 * thing to look at, which is what the history would otherwise show.
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
 * Decorative wherever it is drawn — the gift is named in words beside it — so
 * it is hidden from assistive technology rather than given a name a screen
 * reader would then say twice.
 */
export function GiftArt({
  color,
  size,
  visual,
}: {
  readonly color: string;
  readonly size: number;
  readonly visual: GiftCatalogItem['visual'];
}) {
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 24 24"
      width={size}
    >
      <Path d={giftShapes[visual]} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
