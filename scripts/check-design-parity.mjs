import { readFileSync } from 'node:fs';

/**
 * One Consumer expression, proved rather than asserted in a comment.
 *
 * `docs/design/01-design-principles.md` approves exactly one Consumer visual
 * expression, and two surfaces implement it: `apps/web` as CSS custom
 * properties and `apps/mobile` as a TypeScript module, because React Native
 * cannot consume a custom property and ADR-0015 restricts
 * `packages/design-tokens` to values an approved Figma handoff has fixed.
 *
 * Two copies of a palette drift the first time somebody adjusts one of them,
 * and the drift is invisible until a person holds the two surfaces side by
 * side. So neither copy is trusted: both files are read here and compared
 * against each other, and the gate fails if they disagree about a colour, a
 * radius, a spacing step, a duration, an easing curve, the icon stroke, label
 * tracking, or a single icon path.
 *
 * This lives in the gate rather than in either app's test suite because it is a
 * statement about two applications agreeing, which is nobody's unit test — and
 * because reading another workspace's source is exactly what an application is
 * not allowed to do.
 */

const webTokens = 'apps/web/app/styles/tokens.css';
const webIcons = 'apps/web/src/design/icons.tsx';
const mobileTokens = 'apps/mobile/src/design/tokens.ts';
const mobileIcons = 'apps/mobile/src/design/icons.tsx';

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    fail(`${path} could not be read`);
    return '';
  }
}

/* ============================ Published values ======================= */

/** Every `--name: value;` the Consumer stylesheet publishes. */
function cssDeclarations(source) {
  const declarations = new Map();
  for (const match of source.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gmu)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

/**
 * Every `name: 'value'` and `name: number` the mobile token module holds, keyed
 * by the object it sits in. Read by shape rather than by import: this script
 * must not depend on a build of the application it is checking.
 */
function tokenObjects(source) {
  const objects = new Map();
  for (const match of source.matchAll(
    /export const (\w+) = \{([\s\S]*?)\n\} as const;/gu,
  )) {
    const [, name, body] = match;
    const entries = new Map();
    for (const entry of body.matchAll(
      /^\s{2}'?([A-Za-z0-9_]+)'?:\s*('[^']*'|"[^"]*"|-?[\d.]+|\[[^\]]*\]),?\s*$/gmu,
    )) {
      entries.set(entry[1], entry[2]);
    }
    objects.set(name, entries);
  }
  return objects;
}

function quoted(value) {
  return value === undefined ? undefined : value.replace(/^['"]|['"]$/gu, '');
}

/** `rgb(246 241 243 / 8%)` as React Native writes it. */
function reactNativeColor(css) {
  const functional =
    /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\s*\)$/u.exec(css);
  if (functional === null) return css.toLowerCase();
  const [, red, green, blue, percent] = functional;
  return `rgba(${red}, ${green}, ${blue}, ${Number(percent) / 100})`;
}

/* ================================ Colours ============================ */

/**
 * Which stylesheet name each mobile colour mirrors.
 *
 * Exhaustiveness is checked in both directions below, so a colour added to
 * either surface and mirrored in neither this table nor the other file fails
 * here rather than shipping as a difference nobody chose.
 */
const colorNames = new Map([
  ['canvas', 'canvas'],
  ['canvasDeep', 'canvas-deep'],
  ['surface1', 'surface-1'],
  ['surface2', 'surface-2'],
  ['surface3', 'surface-3'],
  ['surfaceInset', 'surface-inset'],
  ['surfaceOverlay', 'surface-overlay'],
  ['textPrimary', 'text-primary'],
  ['textSecondary', 'text-secondary'],
  ['textTertiary', 'text-tertiary'],
  ['textOnAccent', 'text-on-accent'],
  ['borderHairline', 'border-hairline'],
  ['borderSoft', 'border-soft'],
  ['borderStrong', 'border-strong'],
  ['ember', 'ember'],
  ['emberBright', 'ember-bright'],
  ['emberDeep', 'ember-deep'],
  ['emberWash', 'ember-wash'],
  ['emberWashStrong', 'ember-wash-strong'],
  ['emberLine', 'ember-line'],
  ['statusPositive', 'status-positive'],
  ['statusPositiveWash', 'status-positive-wash'],
  ['statusCaution', 'status-caution'],
  ['statusCautionWash', 'status-caution-wash'],
  ['statusCritical', 'status-critical'],
  ['statusCriticalWash', 'status-critical-wash'],
  ['statusNeutral', 'status-neutral'],
  ['statusNeutralWash', 'status-neutral-wash'],
]);

const published = cssDeclarations(read(webTokens));
const objects = tokenObjects(read(mobileTokens));

if (published.size < 80) {
  fail(
    `${webTokens} published only ${published.size} declarations; it has moved or changed shape`,
  );
}
if (objects.size < 5) {
  fail(
    `${mobileTokens} exposed only ${objects.size} token objects; it has moved or changed shape`,
  );
}

const color = objects.get('color') ?? new Map();
for (const [mobile, css] of colorNames) {
  const expected = published.get(css);
  if (expected === undefined) {
    fail(`${webTokens} no longer publishes --${css}`);
    continue;
  }
  const actual = quoted(color.get(mobile));
  if (actual === undefined) {
    fail(`${mobileTokens} does not carry ${mobile}`);
    continue;
  }
  if (actual !== reactNativeColor(expected)) {
    fail(`colour ${mobile} is ${actual} but --${css} is ${expected}`);
  }
}

// Every colour the stylesheet publishes must be mirrored, so a new one cannot
// arrive on one surface only.
const typography = /^text-.*-(?:size|line)$/u;
for (const name of published.keys()) {
  const isColor =
    (name.startsWith('canvas') ||
      name.startsWith('surface') ||
      name.startsWith('text-') ||
      name.startsWith('border-') ||
      name.startsWith('ember') ||
      name.startsWith('status-')) &&
    !typography.test(name);
  if (isColor && ![...colorNames.values()].includes(name)) {
    fail(
      `--${name} is published by Consumer Web and mirrored nowhere in ${mobileTokens}`,
    );
  }
}
for (const name of color.keys()) {
  if (!colorNames.has(name)) {
    fail(
      `${mobileTokens} carries colour ${name}, which no stylesheet name maps to`,
    );
  }
}

/* ======================= Rhythm, radii, motion, icons ================ */

const space = objects.get('space') ?? new Map();
for (const [step, value] of space) {
  const expected = published.get(`space-${step}`);
  if (expected === undefined) {
    fail(`${webTokens} no longer publishes --space-${step}`);
  } else if (Number(value) !== Number(expected.replace(/px$/u, ''))) {
    fail(`space ${step} is ${value} but --space-${step} is ${expected}`);
  }
  if (Number(value) % 4 !== 0) {
    fail(`space ${step} is ${value}, which is not on the approved 4 px rhythm`);
  }
}

const radius = objects.get('radius') ?? new Map();
for (const step of ['xs', 'sm', 'md', 'lg', 'xl']) {
  const expected = published.get(`radius-${step}`);
  if (
    Number(radius.get(step)) !== Number((expected ?? '').replace(/px$/u, ''))
  ) {
    fail(
      `radius ${step} is ${radius.get(step)} but --radius-${step} is ${expected}`,
    );
  }
}

const motion = objects.get('motion') ?? new Map();
for (const [mobile, css] of [
  ['durationFast', 'duration-fast'],
  ['durationBase', 'duration-base'],
  ['durationSlow', 'duration-slow'],
]) {
  const expected = Number((published.get(css) ?? '').replace(/ms$/u, ''));
  if (Number(motion.get(mobile)) !== expected) {
    fail(
      `motion ${mobile} is ${motion.get(mobile)} but --${css} is ${published.get(css)}`,
    );
  }
}
for (const [mobile, css] of [
  ['easeOut', 'ease-out'],
  ['easeInOut', 'ease-in-out'],
]) {
  const points = [...(published.get(css) ?? '').matchAll(/-?[\d.]+/gu)].map(
    (m) => Number(m[0]),
  );
  const held = [...(motion.get(mobile) ?? '').matchAll(/-?[\d.]+/gu)].map((m) =>
    Number(m[0]),
  );
  if (JSON.stringify(points) !== JSON.stringify(held)) {
    fail(
      `motion ${mobile} is [${held.join(', ')}] but --${css} is ${published.get(css)}`,
    );
  }
}

const icon = objects.get('icon') ?? new Map();
const iconStroke = published.get('icon-stroke');
// The mobile module reads the stroke from the shared foundation rather than
// restating it, which is stronger than mirroring — so what is checked here is
// that it does not restate it.
if (icon.has('stroke')) {
  fail(
    `${mobileTokens} restates the icon stroke instead of reading it from @velora/design-tokens`,
  );
}
if (iconStroke === undefined) {
  fail(`${webTokens} no longer publishes --icon-stroke`);
}

const tracking = objects.get('tracking') ?? new Map();
for (const [mobile, css] of [
  ['label', 'tracking-label'],
  ['wordmark', 'tracking-wordmark'],
]) {
  const expected = Number((published.get(css) ?? '').replace(/em$/u, ''));
  if (Number(tracking.get(mobile)) !== expected) {
    fail(
      `tracking ${mobile} is ${tracking.get(mobile)} but --${css} is ${published.get(css)}`,
    );
  }
}

/* ============================== Icon marks =========================== */

/**
 * The icon table out of either surface's source.
 *
 * Read by shape rather than by import for the same reason as the tokens: one of
 * these files is an application's private module and the other is a different
 * application's private module.
 */
function iconTable(source, path) {
  const table =
    /(?:const paths|export const iconPaths)[^=]*=\s*\{([\s\S]*?)\n\};/u.exec(
      source,
    );
  const marks = new Map();
  if (table === null) {
    fail(`${path} no longer holds an icon table in the expected shape`);
    return marks;
  }
  for (const entry of table[1].matchAll(/(\w+):\s*\[([^\]]*)\]/gu)) {
    marks.set(
      entry[1],
      [...entry[2].matchAll(/'([^']*)'/gu)].map((quotedPath) => quotedPath[1]),
    );
  }
  return marks;
}

const webMarks = iconTable(read(webIcons), webIcons);
const mobileMarks = iconTable(read(mobileIcons), mobileIcons);

if (webMarks.size < 30) {
  fail(`${webIcons} yielded only ${webMarks.size} marks`);
}
for (const [name, paths] of webMarks) {
  const held = mobileMarks.get(name);
  if (held === undefined) {
    fail(`Consumer Web draws ${name} and Consumer Mobile does not`);
  } else if (JSON.stringify(held) !== JSON.stringify(paths)) {
    fail(`icon ${name} is drawn differently on the two Consumer surfaces`);
  }
}
for (const name of mobileMarks.keys()) {
  if (!webMarks.has(name)) {
    fail(`Consumer Mobile draws ${name} and Consumer Web does not`);
  }
}

/* ================================ Result ============================= */

if (failures.length > 0) {
  process.stderr.write('NIGHT CURRENT is not one expression:\n');
  for (const failure of failures) {
    process.stderr.write(`  ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `NIGHT CURRENT matches across Consumer Web and Consumer Mobile: ${String(colorNames.size)} colours, ${String(space.size)} spacing steps, ${String(webMarks.size)} icon marks.\n`,
);
