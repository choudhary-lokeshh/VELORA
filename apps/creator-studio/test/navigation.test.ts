import { describe, expect, it } from 'vitest';

import {
  accountPath,
  destinationName,
  destinations,
  parentOf,
} from '../src/app/navigation';

/**
 * Leaving a page a creator navigated into.
 *
 * The rule asserted here is the one Consumer Web was missing when a Back built
 * by removing the last path segment pointed at `/people`, an address nothing
 * serves. Studio's addresses happened to survive that treatment, which is not
 * the same as being safe from it: the next nested page added under something
 * with no listing of its own would have had the same defect. So the parents are
 * declared, and this checks the declaration against the routes the workspace
 * actually serves.
 */

/** Every address Creator Studio serves, from `apps/creator-studio/app`. */
const served: readonly string[] = [
  '/',
  '/account',
  '/catalog',
  '/catalog/[contentId]',
  '/catalog/new',
  '/clubs',
  '/clubs/[clubId]',
  '/home',
  '/money',
  '/money/gifts',
  '/money/payouts',
  '/money/selling',
  '/profile',
  '/profile/preview',
  '/sign-in',
  '/start',
];

const literalRoutes = served.filter((route) => !route.includes('['));

const concreteRoutes = served.map((route) =>
  route.replace('[contentId]', 'content-1').replace('[clubId]', 'club-1'),
);

const nestedRoutes = [
  '/catalog/content-1',
  '/catalog/new',
  '/clubs/club-1',
  '/money/gifts',
  '/money/payouts',
  '/money/selling',
  '/profile/preview',
];

describe('where Back goes in the workspace', () => {
  it('offers nothing to go back to from a destination or the account area', () => {
    for (const destination of destinations) {
      expect(parentOf(destination.path)).toBeUndefined();
    }
    expect(parentOf(accountPath)).toBeUndefined();
    expect(parentOf('/')).toBeUndefined();
    expect(parentOf('/sign-in')).toBeUndefined();
    expect(parentOf('/start')).toBeUndefined();
  });

  it('offers a way out of every page that can be navigated into', () => {
    for (const route of nestedRoutes) {
      expect(parentOf(route)).toBeDefined();
    }
  });

  it('never points at an address this workspace does not serve', () => {
    for (const route of concreteRoutes) {
      const parent = parentOf(route);
      if (parent === undefined) continue;
      expect(literalRoutes).toContain(parent);
    }
  });

  it('returns each page to the listing it was opened from', () => {
    expect(parentOf('/catalog/content-1')).toBe('/catalog');
    expect(parentOf('/catalog/new')).toBe('/catalog');
    expect(parentOf('/clubs/club-1')).toBe('/clubs');
    expect(parentOf('/money/payouts')).toBe('/money');
    expect(parentOf('/profile/preview')).toBe('/profile');
  });

  it('says nothing about a page it has not been told about', () => {
    // A nested route added without an entry gets no Back, which is a visible
    // gap somebody fixes. The alternative — guessing — is what produced a Back
    // into the not-found page on Consumer Web.
    expect(parentOf('/catalog/content-1/media')).toBeUndefined();
    expect(parentOf('/invented')).toBeUndefined();
  });
});

/**
 * A Back with a word beside it.
 *
 * From the tablet up the bar carries nothing else — the wordmark, the title and
 * the account control are all hidden there — so the arrow was the only thing on
 * screen saying how to leave a club, and it did not say where to. The word is
 * taken from the navigation's own table and never invented, because a Back
 * labelled with a guess is worse than an unlabelled one.
 */
describe('what a Back is called', () => {
  it("uses the destination's own name for every parent it points at", () => {
    for (const route of nestedRoutes) {
      const parent = parentOf(route);
      expect(parent).toBeDefined();
      const name = destinationName(parent ?? '');
      expect(name).toBeDefined();
      expect(destinations.some((one) => one.label === name)).toBe(true);
    }
  });

  it('says nothing about an address the navigation has no word for', () => {
    expect(destinationName('/account')).toBeUndefined();
    expect(destinationName('/catalog/content-1')).toBeUndefined();
    expect(destinationName('/start')).toBeUndefined();
    expect(destinationName('/nowhere')).toBeUndefined();
  });

  it('reads the address rather than the query attached to it', () => {
    expect(destinationName('/catalog?show=draft')).toBe('Catalog');
  });
});
