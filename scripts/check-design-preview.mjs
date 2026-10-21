import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Cross-client evidence belongs to repository tooling, never to a client import.
const css = readFileSync(
  new URL('../apps/web/app/styles/ivory-preview.css', import.meta.url),
  'utf8',
);
const native = readFileSync(
  new URL('../apps/mobile/src/design/theme.ts', import.meta.url),
  'utf8',
);
const baseline = readFileSync(
  new URL('../apps/mobile/src/design/tokens.ts', import.meta.url),
  'utf8',
);
const block = /export const ivoryColor:[\s\S]*?= \{([\s\S]*?)\n\};/u.exec(
  native,
)?.[1];
assert.ok(block, 'Native preview palette must be present');
const palette = [...block.matchAll(/^\s+(\w+): '([^']+)'/gmu)];
const baselineBlock = /export const color = \{([\s\S]*?)\n\} as const;/u.exec(
  baseline,
)?.[1];
assert.ok(baselineBlock);
const keys = [...baselineBlock.matchAll(/^\s+(\w+): '/gmu)].map(
  (match) => match[1],
);
assert.deepEqual(
  palette.map((match) => match[1]).sort(),
  keys.sort(),
  'Every baseline role needs a preview counterpart',
);
const declarations = new Map(
  [...css.split('\n}')[0].matchAll(/--([\w-]+):\s*([^;]+);/gu)].map((match) => [
    match[1],
    match[2],
  ]),
);
function channels(value) {
  if (value.startsWith('#')) return value.toLowerCase();
  const values = value
    .match(/[\d.]+%?/gu)
    ?.map((part) =>
      part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part),
    );
  return JSON.stringify(values);
}
for (const [, name, value] of palette) {
  const cssName = name
    .replace(/[A-Z]/gu, (part) => `-${part.toLowerCase()}`)
    .replace(/surface(\d)/u, 'surface-$1');
  assert.equal(
    channels(value),
    channels(declarations.get(cssName) ?? ''),
    `Preview drift: ${name}`,
  );
}
console.log(
  `Ivory Consumer preview agrees across Web and native: ${palette.length} color roles.`,
);
