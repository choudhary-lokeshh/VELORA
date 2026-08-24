import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

/**
 * Draws Consumer Mobile's Android launcher, notification, and splash assets
 * from the marks the product already publishes.
 *
 * Android will not accept a drawn React component for a launcher icon, a
 * themed icon, a notification silhouette, or a splash image; it wants raster
 * files in the binary. That is the only reason these files exist. Nothing here
 * invents a visual: the mark is the `sparkle` path from
 * `apps/mobile/src/design/icons.tsx`, the tone is `color.ember`, the ground is
 * `color.canvas`, and the stroke is the approved 1.75 units on the same
 * 24-unit grid every other icon in the product is drawn on. The values are read
 * out of those two files rather than restated here, so a token change fails
 * this script instead of silently shipping a stale icon.
 *
 * Run it with `pnpm mobile:assets`. The outputs are committed, because a build
 * that regenerates its own icons is a build whose icons nobody has looked at.
 */

const iconsFile = 'apps/mobile/src/design/icons.tsx';
const tokensFile = 'apps/mobile/src/design/tokens.ts';
const outputDirectory = 'apps/mobile/assets/android';

/** The approved stroke, in grid units. */
const strokeUnits = 1.75;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * The `sparkle` mark, read from the table the application renders.
 *
 * Reading it means this script cannot draw a different star than the one the
 * welcome screen draws. A parse failure is fatal: an icon generated from a
 * guess is worse than no icon.
 */
function readSparklePaths() {
  const source = readFileSync(iconsFile, 'utf8');
  const block = /\n {2}sparkle: \[\n([\s\S]*?)\n {2}\],\n/u.exec(source);
  if (block === null) fail(`No sparkle mark found in ${iconsFile}`);
  const paths = [...block[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  if (paths.length === 0) fail(`sparkle in ${iconsFile} declares no paths`);
  return paths;
}

function readColor(name) {
  const source = readFileSync(tokensFile, 'utf8');
  const found = new RegExp(`\\n {2}${name}: '(#[0-9a-fA-F]{6})',`, 'u').exec(
    source,
  );
  if (found === null) fail(`No ${name} colour found in ${tokensFile}`);
  return found[1];
}

/**
 * Where the ink in a set of paths actually is, on the 24-unit grid.
 *
 * The marks are drawn for a 24-unit box but none of them fills it, and
 * `sparkle` is deliberately lopsided — a large star up and left, a small one
 * down and right. Centring the *box* therefore leaves the mark visibly off
 * centre in a launcher circle, which is what the first generated icon did.
 * Centring the ink is what a person means by centred.
 *
 * Only the commands these marks use are supported — absolute and relative
 * move, line, and close — and anything else is fatal rather than approximated,
 * because an arc silently treated as a line would move the centre by an amount
 * nobody could see in the source.
 */
function inkBounds(paths) {
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  for (const path of paths) {
    let cursorX = 0;
    let cursorY = 0;
    let command = '';
    const tokens = path.match(/[MmLlZz]|-?\d*\.?\d+/gu) ?? [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (/^[MmLlZz]$/u.test(token)) {
        command = token;
        continue;
      }
      if (command === '' || /^[Zz]$/u.test(command)) {
        fail(`Unsupported path data in ${iconsFile}: ${path}`);
      }
      const nextToken = tokens[index + 1];
      if (nextToken === undefined || /^[MmLlZz]$/u.test(nextToken)) {
        fail(`Odd coordinate count in ${iconsFile}: ${path}`);
      }
      const x = Number(token);
      const y = Number(nextToken);
      index += 1;
      const relative = command === 'm' || command === 'l';
      cursorX = relative ? cursorX + x : x;
      cursorY = relative ? cursorY + y : y;
      // A second coordinate pair after a move is a line, per the SVG grammar.
      if (command === 'M') command = 'L';
      if (command === 'm') command = 'l';
      minimumX = Math.min(minimumX, cursorX);
      minimumY = Math.min(minimumY, cursorY);
      maximumX = Math.max(maximumX, cursorX);
      maximumY = Math.max(maximumY, cursorY);
    }
  }
  if (!Number.isFinite(minimumX)) fail(`No drawable points in ${iconsFile}`);
  return { maximumX, maximumY, minimumX, minimumY };
}

/**
 * One mark, centred on a square of `size` units, occupying `coverage` of it.
 *
 * `coverage` is what keeps a launcher icon out of the region Android masks
 * away: an adaptive foreground is cropped to the inner 66 %, so anything drawn
 * outside that is a corner somebody's launcher will cut off. It is measured
 * against the mark's own extent including its stroke, not against the grid, so
 * the number means the same thing at every size.
 */
function markSvg({ coverage, ground, size, stroke, tone }) {
  const paths = readSparklePaths();
  const bounds = inkBounds(paths);
  // A stroke is centred on its path, so half of it lies outside the geometry.
  const bleed = strokeUnits / 2;
  const inkWidth = bounds.maximumX - bounds.minimumX + strokeUnits;
  const inkHeight = bounds.maximumY - bounds.minimumY + strokeUnits;
  const scale = (size * coverage) / Math.max(inkWidth, inkHeight);
  const offsetX =
    (size - inkWidth * scale) / 2 - (bounds.minimumX - bleed) * scale;
  const offsetY =
    (size - inkHeight * scale) / 2 - (bounds.minimumY - bleed) * scale;
  const background =
    ground === undefined
      ? ''
      : `<rect width="${String(size)}" height="${String(size)}" fill="${ground}"/>`;
  const marks = paths.map((path) => `<path d="${path}"/>`).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">` +
      background +
      `<g transform="translate(${offsetX.toFixed(4)} ${offsetY.toFixed(4)}) scale(${scale.toFixed(6)})" ` +
      `fill="none" stroke="${tone}" stroke-width="${String(stroke)}" ` +
      `stroke-linecap="round" stroke-linejoin="round">${marks}</g></svg>`,
  );
}

async function write(name, svg) {
  const file = join(outputDirectory, name);
  await sharp(svg, { density: 512 }).png({ compressionLevel: 9 }).toFile(file);
  process.stdout.write(`  ${file}\n`);
}

async function main() {
  const canvas = readColor('canvas');
  const ember = readColor('ember');
  mkdirSync(outputDirectory, { recursive: true });
  process.stdout.write('Drawing Android assets from the product marks:\n');

  // Legacy square launcher icon: the whole square is Velora's, so the mark can
  // use more of it than an adaptive foreground can.
  await write(
    'icon.png',
    markSvg({
      coverage: 0.5,
      ground: canvas,
      size: 1024,
      stroke: strokeUnits,
      tone: ember,
    }),
  );

  // Adaptive foreground. The mask keeps the inner 66 %, and a launcher may
  // animate the layers apart, so the mark is smaller and the ground is a
  // separate flat colour rather than part of this file.
  await write(
    'adaptive-icon-foreground.png',
    markSvg({
      coverage: 0.38,
      size: 1024,
      stroke: strokeUnits,
      tone: ember,
    }),
  );

  // Themed icon. Android tints this from the wallpaper, so it must be a
  // single-colour silhouette on transparency; any colour here is discarded.
  await write(
    'adaptive-icon-monochrome.png',
    markSvg({
      coverage: 0.38,
      size: 1024,
      stroke: strokeUnits,
      tone: '#ffffff',
    }),
  );

  // Notification icon. Android draws the alpha channel only and throws the
  // colours away, so this is white on transparency by necessity rather than by
  // choice, and the accent is applied by the notification's colour instead.
  await write(
    'notification-icon.png',
    markSvg({
      coverage: 0.8,
      size: 96,
      stroke: strokeUnits,
      tone: '#ffffff',
    }),
  );

  // Splash. It sits on the same canvas the first screen paints, so it carries
  // no ground of its own and cannot show a seam against it.
  await write(
    'splash-icon.png',
    markSvg({
      coverage: 0.7,
      size: 512,
      stroke: strokeUnits,
      tone: ember,
    }),
  );

  writeFileSync(
    join(outputDirectory, 'README.md'),
    '# Generated Android assets\n\n' +
      'Every file in this directory is written by `pnpm mobile:assets` from the\n' +
      '`sparkle` mark in `apps/mobile/src/design/icons.tsx` and the `canvas` and\n' +
      '`ember` tokens in `apps/mobile/src/design/tokens.ts`. Do not edit them by\n' +
      'hand: the next run overwrites them, and a hand-edited icon is a visual\n' +
      'nobody approved. Change the mark or the token and run the script again.\n',
  );
  process.stdout.write(`  ${join(outputDirectory, 'README.md')}\n`);
}

await main();
