import { describe, expect, it } from 'vitest';

import {
  accessPath,
  destinations,
  parentOf,
  platformAreas,
} from '../src/app/navigation';

/**
 * Leaving a record an operator opened.
 *
 * Same rule as the other two surfaces: every destination Back can produce is an
 * address the console actually serves. Platform's areas are the deliberate
 * exception and are asserted as one — they are peers reached from the tabs on
 * the screen, so offering "back" from Identity to Media would dress a sideways
 * move as a return.
 */

/** Every address Platform Admin serves, from `apps/admin/app`. */
const served: readonly string[] = [
  '/',
  '/access',
  '/creators',
  '/money',
  '/platform',
  '/platform/identity',
  '/platform/notifications',
  '/platform/rtc',
  '/queues',
  '/queues/[caseId]',
  '/queues/appeals',
];

const literalRoutes = served.filter((route) => !route.includes('['));

const concreteRoutes = served.map((route) =>
  route.replace('[caseId]', 'case-1'),
);

describe('where Back goes in the console', () => {
  it('offers nothing to go back to from a destination or the access page', () => {
    for (const destination of destinations) {
      expect(parentOf(destination.path)).toBeUndefined();
    }
    expect(parentOf(accessPath)).toBeUndefined();
    expect(parentOf('/')).toBeUndefined();
  });

  it('treats the platform areas as peers rather than as children', () => {
    for (const area of platformAreas) {
      expect(parentOf(area.path)).toBeUndefined();
    }
  });

  it('offers a way out of a case and of the appeals list', () => {
    expect(parentOf('/queues/case-1')).toBe('/queues');
    expect(parentOf('/queues/appeals')).toBe('/queues');
  });

  it('never points at an address this console does not serve', () => {
    for (const route of concreteRoutes) {
      const parent = parentOf(route);
      if (parent === undefined) continue;
      expect(literalRoutes).toContain(parent);
    }
  });

  it('says nothing about a page it has not been told about', () => {
    expect(parentOf('/queues/case-1/evidence')).toBeUndefined();
    expect(parentOf('/invented')).toBeUndefined();
  });
});
