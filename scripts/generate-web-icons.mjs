import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

/**
 * Draws Consumer Web's browser icons from the mark the product already
 * publishes.
 *
 * A browser asks for an icon on every page load whether or not one exists, and
 * the answer to `GET /favicon.ico` was a 404 on every navigation. Next's App
 * Router serves `app/icon.svg` and `app/favicon.ico` as the two files that fix
 * that: modern browsers take the vector, and everything that only ever learned
 * to ask for `/favicon.ico` — including a browser restoring a pinned tab — gets
 * a real icon rather than an error in the console.
 *
 * Nothing here invents a visual, on the same reasoning as the Android asset
 * script: the mark is the `sparkle` path from `apps/web/src/design/icons.tsx`,
 * the ground is `--canvas`, the tone is `--ember`, and the stroke is
 * `--icon-stroke`, all read out of `apps/web/app/styles/tokens.css` rather than
 * restated here. A token or path change therefore fails this script or changes
 * its output, instead of silently leaving a stale icon in the tab.
 *
 * Run it with `pnpm web:assets`. The outputs are committed, because a build
 * that regenerates its own icons is a build whose icons nobody has looked at.
 */

const iconsFile = 'apps/web/src/design/icons.tsx';
const tokensFile = 'apps/web/app/styles/tokens.css';
const outputDirectory = 'apps/web/app';

/** The sizes a `.ico` carries, smallest first, as browsers still ask for all three. */
const icoSizes = [16, 32, 48];

/**
 * How much of the square the mark's own extent fills.
 *
 * A favicon is read at 16 px in a strip of other favicons, so it is drawn
 * larger in its box than a launcher icon, which has a mask and a margin to
 * respect. The remainder is the breathing room that keeps the star from
 * touching the edge of a rounded tab.
 */
const coverage = 0.76;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * The `sparkle` mark, read from the table the application renders.
 *
 * Reading it means this script cannot draw a different star than the one the
 * sidebar draws. A parse failure is fatal: an icon generated from a guess is
 * worse than no icon.
 */
function readSparklePaths() {
  const source = readFileSync(iconsFile, 'utf8');
  const block = /\n {2}sparkle: \[\n([\s\S]*?)\n {2}\],\n/u.exec(source);
  if (block === null) fail(`No sparkle mark found in ${iconsFile}`);
  const paths = [...block[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  if (paths.length === 0) fail(`sparkle in ${iconsFile} declares no paths`);
  return paths;
}

/** One custom property out of the Consumer stylesheet. */
function readToken(name, shape) {
  const source = readFileSync(tokensFile, 'utf8');
  const found = new RegExp(`\\n {2}--${name}: (${shape});`, 'u').exec(source);
  if (found === null) fail(`No --${name} value found in ${tokensFile}`);
  return found[1];
}

/**
 * Where the ink in a set of paths actually is, on the 24-unit grid.
 *
 * The marks are drawn for a 24-unit box but none of them fills it, and
 * `sparkle` is deliberately lopsided — a large star up and left, a small one
 * down and right. Centring the *box* therefore leaves the mark visibly off
 * centre in a tab strip. Centring the ink is what a person means by centred.
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

/** The mark, centred on a `size`-unit square over the product's own ground. */
function markSvg({ ground, paths, size, stroke, tone }) {
  const bounds = inkBounds(paths);
  // A stroke is centred on its path, so half of it lies outside the geometry.
  const bleed = stroke / 2;
  const inkWidth = bounds.maximumX - bounds.minimumX + stroke;
  const inkHeight = bounds.maximumY - bounds.minimumY + stroke;
  const scale = (size * coverage) / Math.max(inkWidth, inkHeight);
  const offsetX =
    (size - inkWidth * scale) / 2 - (bounds.minimumX - bleed) * scale;
  const offsetY =
    (size - inkHeight * scale) / 2 - (bounds.minimumY - bleed) * scale;
  const marks = paths.map((path) => `<path d="${path}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">` +
    `<rect width="${String(size)}" height="${String(size)}" rx="${(size * 0.22).toFixed(4)}" fill="${ground}"/>` +
    `<g transform="translate(${offsetX.toFixed(4)} ${offsetY.toFixed(4)}) scale(${scale.toFixed(6)})" ` +
    `fill="none" stroke="${tone}" stroke-width="${String(stroke)}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${marks}</g></svg>`
  );
}

/**
 * A `.ico` holding one PNG per size.
 *
 * The format is a six-byte directory, a sixteen-byte entry per image, and then
 * the images themselves. PNG-compressed entries have been read by every browser
 * since Windows Vista, so there is no BMP path here — a bitmap entry would be
 * four times the bytes for an icon nothing in support still asks for.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // an icon rather than a cursor
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const directory = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    // 0 means 256 in this field, which is why nothing larger fits in a `.ico`.
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // not a palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    directory.push(entry);
  }

  return Buffer.concat([
    header,
    ...directory,
    ...images.map((image) => image.png),
  ]);
}

async function main() {
  const paths = readSparklePaths();
  const ground = readToken('canvas', '#[0-9a-fA-F]{6}');
  const tone = readToken('ember', '#[0-9a-fA-F]{6}');
  const stroke = Number(readToken('icon-stroke', '[0-9.]+'));
  process.stdout.write('Drawing Consumer Web icons from the product mark:\n');

  // The vector every current browser prefers. Drawn on the same 24-unit grid
  // the mark is authored on, so it stays sharp at any size a tab, a bookmark
  // bar, or an installed shortcut asks for.
  const vector = markSvg({ ground, paths, size: 24, stroke, tone });
  const svgFile = join(outputDirectory, 'icon.svg');
  writeFileSync(
    svgFile,
    `<!-- Generated by \`pnpm web:assets\` from the sparkle mark in ${iconsFile}. Do not edit by hand. -->\n${vector}\n`,
  );
  process.stdout.write(`  ${svgFile}\n`);

  // The compatibility file. A browser asks for this address whether or not the
  // document links an icon, so it exists to make that request a 200.
  const images = await Promise.all(
    icoSizes.map(async (size) => ({
      // Rasterised straight out of the same vector at the size asked for. The
      // density is what decides the resolution the SVG is drawn at, so it is
      // derived from the target rather than left at the 72 dpi default, which
      // would draw a 24 px image and then enlarge it.
      png: await sharp(Buffer.from(vector), { density: (72 * size) / 24 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer(),
      size,
    })),
  );
  const icoFile = join(outputDirectory, 'favicon.ico');
  writeFileSync(icoFile, ico(images));
  process.stdout.write(`  ${icoFile}\n`);
}

await main();
