import { describe, expect, it } from 'vitest';

import {
  accessPath,
  creatorAreas,
  destinations,
  homePath,
  moneyAreas,
  parentOf,
  platformAreas,
  queueAreas,
  safeReturnPath,
} from '../src/app/navigation';

/**
 * Leaving a record an operator opened.
 *
 * Same rule as the other two surfaces: every destination Back can produce is an
 * address the console actually serves. The areas of a destination are the
 * deliberate exception and are asserted as one — they are peers reached from
 * the tabs on the screen, so offering "back" from Payouts to Payments would
 * dress a sideways move as a return.
 *
 * The second rule is that a record returns to the area it was found in rather
 * than to the destination root. A payment opened from the payments list goes
 * back to the payments list, where the operator's filter and position still
 * are, and not to the money summary they were never on.
 */

/** Every address Platform Admin serves, from `apps/admin/app`. */
const served: readonly string[] = [
  '/',
  '/access',
  '/accounts',
  '/accounts/[accountId]',
  '/activity',
  '/creators',
  '/creators/clubs',
  '/creators/clubs/[clubId]',
  '/money',
  '/money/disputes',
  '/money/payments',
  '/money/payments/[paymentId]',
  '/money/payouts',
  '/money/reconciliation',
  '/overview',
  '/platform',
  '/platform/controls',
  '/platform/growth',
  '/platform/identity',
  '/platform/live',
  '/platform/live/[encounterId]',
  '/platform/notifications',
  '/platform/operations',
  '/platform/operators',
  '/platform/public-entry',
  '/platform/rtc',
  '/platform/security',
  '/queues',
  '/queues/[caseId]',
  '/queues/appeals',
  '/queues/decisions',
  '/queues/support',
];

const literalRoutes = served.filter((route) => !route.includes('['));

const concreteRoutes = served.map((route) =>
  route
    .replace('[accountId]', 'account-1')
    .replace('[caseId]', 'case-1')
    .replace('[clubId]', 'club-1')
    .replace('[encounterId]', 'encounter-1')
    .replace('[paymentId]', 'payment-1'),
);

const everyArea = [
  ...queueAreas,
  ...creatorAreas,
  ...moneyAreas,
  ...platformAreas,
];

describe('the map of the console', () => {
  it('lands an authenticated operator on the overview', () => {
    expect(homePath).toBe('/overview');
    expect(destinations.map((destination) => destination.path)).toContain(
      homePath,
    );
  });

  it('serves every destination and every area it names', () => {
    for (const destination of destinations) {
      expect(literalRoutes).toContain(destination.path);
    }
    for (const area of everyArea) {
      expect(literalRoutes).toContain(area.path);
    }
  });

  it('gives every area a destination that owns it', () => {
    // An area under no destination would be an address the navigation could
    // never light up, which is how a screen becomes unreachable without
    // anybody deleting it.
    for (const area of everyArea) {
      expect(
        destinations.some(
          (destination) =>
            area.path === destination.path ||
            area.path.startsWith(`${destination.path}/`),
        ),
      ).toBe(true);
    }
  });
});

describe('where Back goes in the console', () => {
  it('offers nothing to go back to from a destination or the access page', () => {
    for (const destination of destinations) {
      expect(parentOf(destination.path)).toBeUndefined();
    }
    expect(parentOf(accessPath)).toBeUndefined();
    expect(parentOf('/')).toBeUndefined();
  });

  it('treats the areas of a destination as peers rather than as children', () => {
    for (const area of everyArea) {
      expect(parentOf(area.path)).toBeUndefined();
    }
  });

  it('returns a record to the area it was found in', () => {
    expect(parentOf('/queues/case-1')).toBe('/queues');
    expect(parentOf('/money/payments/payment-1')).toBe('/money/payments');
    expect(parentOf('/creators/clubs/club-1')).toBe('/creators/clubs');
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

describe('following somebody back to where they were going', () => {
  it('follows a path on this origin', () => {
    expect(safeReturnPath('/money/payouts')).toBe('/money/payouts');
  });

  it('refuses an address somebody else chose', () => {
    // The one surface in this product where an open redirect would hand
    // somebody a privileged destination.
    for (const hostile of [
      '//evil.example/steal',
      'https://evil.example/steal',
      'javascript:alert(1)',
      '/\\evil.example',
    ]) {
      expect(safeReturnPath(hostile)).toBeUndefined();
    }
    expect(safeReturnPath(null)).toBeUndefined();
  });
});
