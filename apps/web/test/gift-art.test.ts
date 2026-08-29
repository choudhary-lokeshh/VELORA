import { describe, expect, it } from 'vitest';

import { giftShapes } from '../src/product/gift-art';

/**
 * The gift silhouettes, checked as geometry rather than as strings.
 *
 * A malformed `d` is the quietest defect a surface can carry: React renders it
 * without complaint, the request succeeds, no test fails, and the browser draws
 * nothing while writing one line to the console. A `rose` whose curve commands
 * were four numbers short shipped exactly that way. So each shape is parsed
 * here against the SVG path grammar's arity, which is the rule the browser
 * itself applies before it gives up on a path.
 */

/** How many numbers each path command takes, per the SVG path grammar. */
const arity: Readonly<Record<string, number>> = {
  a: 7,
  c: 6,
  h: 1,
  l: 2,
  m: 2,
  q: 4,
  s: 4,
  t: 2,
  v: 1,
  z: 0,
};

/**
 * One arc's seven arguments.
 *
 * Arcs cannot be checked by counting numbers, because the two flags are single
 * digits that the grammar allows to be written with no separator at all —
 * `0 018-2` is a rotation, two flags, and a point, not three numbers. Reading
 * them in order is the only way to know whether a group is complete.
 */
const arcArguments =
  /^[,\s]*(?:-?[\d.]+)[,\s]*(?:-?[\d.]+)[,\s]*(?:-?[\d.]+)[,\s]*[01][,\s]*[01][,\s]*(?:-?[\d.]+)[,\s]*(?:-?[\d.]+)/u;

/**
 * Whatever a browser would refuse about this path, or nothing.
 *
 * The rules applied are the two that a hand-written path gets wrong: a command
 * nothing understands, and a command given a number of arguments that is not a
 * whole multiple of what it takes.
 */
function pathFault(d: string): string | undefined {
  const segments = [...d.matchAll(/([A-Za-z])([^A-Za-z]*)/gu)];
  if (segments.length === 0) return 'no commands';
  if (!/^[Mm]/u.test(d.trim())) return 'does not begin with a move';

  for (const segment of segments) {
    const command = segment[1];
    const rest = segment[2];
    if (command === undefined || rest === undefined) return 'unreadable path';
    const takes = arity[command.toLowerCase()];
    if (takes === undefined) return `unknown command ${command}`;

    if (takes === 0) {
      if (rest.trim() !== '') return `${command} takes no arguments`;
      continue;
    }

    if (takes === 7) {
      let remaining = rest;
      let groups = 0;
      while (remaining.trim() !== '') {
        const found = arcArguments.exec(remaining);
        if (found === null) return `${command} has an incomplete arc`;
        remaining = remaining.slice(found[0].length);
        groups += 1;
      }
      if (groups === 0) return `${command} has no arc`;
      continue;
    }

    const numbers = rest.match(/-?\d*\.?\d+/gu) ?? [];
    if (numbers.length === 0 || numbers.length % takes !== 0) {
      return `${command} takes ${String(takes)} arguments at a time, got ${String(
        numbers.length,
      )}`;
    }
  }
  return undefined;
}

describe('gift silhouettes', () => {
  it('publishes one shape per gift the catalogue can carry', () => {
    expect(Object.keys(giftShapes).sort()).toEqual([
      'celebration',
      'crown',
      'diamond',
      'heart',
      'ribbon',
      'rose',
      'spark',
      'star',
    ]);
  });

  it('draws every gift as a path a browser will accept', () => {
    const faults = Object.entries(giftShapes)
      .map(([visual, shape]) => ({ fault: pathFault(shape), visual }))
      .filter((one) => one.fault !== undefined);
    expect(faults).toEqual([]);
  });

  it('refuses the malformed rose that shipped', () => {
    // The exact string the browser refused, kept as this check's own proof: 34
    // numbers across curve segments that take six at a time.
    expect(
      pathFault(
        'M12 7c3-5 8 0 4 3 5 1 2 7-2 4-1 5-7 3-5-1-6-6-2-4-3-4-1-9 3-7 4-5 8 0 4 3z',
      ),
    ).toBe('c takes 6 arguments at a time, got 34');
  });
});
