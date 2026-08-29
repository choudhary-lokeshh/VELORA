import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  addressOf,
  backTarget,
  destinations,
  nestedHref,
  parentOf,
} from '../src/app/navigation';
import { AppShell } from '../src/app/shell';
import { admittedState, createApiDouble } from './support/api-double';
import { renderProduct } from './support/render';

/**
 * Leaving a page somebody navigated into.
 *
 * The defect this suite exists for was a Back that pointed at an address the
 * product does not serve. `parentOf` used to remove the last segment of the
 * path, which is right for `/you/settings` and wrong for `/people/<id>`: there
 * is no `/people` listing, so the only visible way out of a person on a phone
 * led to the not-found page. Nothing failed — a link to a 404 is a perfectly
 * valid link — so the rule asserted here is the one that was missing: every
 * destination Back can produce is an address this application actually serves.
 */

/** Every address Consumer Web serves, from `apps/web/app`. */
const served: readonly string[] = [
  '/',
  '/c/[handle]',
  '/c/[handle]/club/[clubSlug]',
  '/c/[handle]/club/[clubSlug]/join',
  '/checkout/cancelled',
  '/checkout/return',
  '/discover',
  '/introductions',
  '/messages',
  '/messages/[conversationId]',
  '/notifications',
  '/people/[personId]',
  '/sign-in',
  '/welcome',
  '/you',
  '/you/gifts',
  '/you/memberships',
  '/you/safety',
  '/you/settings',
];

/** One concrete address per served route, with parameters filled in. */
const concreteRoutes = served.map((route) =>
  route
    .replace('[handle]', 'aurora')
    .replace('[clubSlug]', 'inner')
    .replace('[conversationId]', 'conversation-1')
    .replace('[personId]', 'person-1'),
);

/**
 * Whether an address is one of the served routes.
 *
 * Matched against the route patterns rather than against a list of literals,
 * because a parent may legitimately carry a parameter: a club's way out is its
 * own creator's page, and `/c/aurora` is served even though it is not a
 * literal.
 */
function isServed(address: string): boolean {
  return served.some((route) =>
    new RegExp(
      `^${route.replaceAll(/\[[^\]]+\]/gu, '[^/]+').replaceAll('/', '\\/')}$`,
      'u',
    ).test(address),
  );
}

const nestedRoutes = [
  '/c/aurora',
  '/c/aurora/club/inner',
  '/c/aurora/club/inner/join',
  '/checkout/return',
  '/checkout/cancelled',
  '/messages/conversation-1',
  '/people/person-1',
  '/you/gifts',
  '/you/memberships',
  '/you/safety',
  '/you/settings',
];

const rootRoutes = [
  '/',
  '/discover',
  '/introductions',
  '/messages',
  '/notifications',
  '/sign-in',
  '/welcome',
  '/you',
];

afterEach(cleanup);

describe('where Back goes', () => {
  it('offers nothing to go back to from a destination somebody arrives at', () => {
    for (const destination of destinations) {
      expect(parentOf(destination.path)).toBeUndefined();
    }
    for (const route of rootRoutes) {
      expect(parentOf(route)).toBeUndefined();
    }
  });

  it('offers a way out of every page that can be navigated into', () => {
    for (const route of nestedRoutes) {
      expect(parentOf(route)).toBeDefined();
    }
  });

  it('never points at an address this application does not serve', () => {
    // The whole defect, stated as a rule. `/people/<id>` truncated to
    // `/people`, which is not in `served` and rendered the not-found page.
    for (const route of concreteRoutes) {
      const parent = parentOf(route);
      if (parent === undefined) continue;
      expect(isServed(parent), `${route} -> ${parent}`).toBe(true);
    }
  });

  it('sends a person and a creator page back to Discover rather than to a listing that does not exist', () => {
    expect(parentOf('/people/person-1')).toBe('/discover');
    expect(parentOf('/c/aurora')).toBe('/discover');
    expect(parentOf('/messages/conversation-1')).toBe('/messages');
    expect(parentOf('/you/settings')).toBe('/you');
  });

  it('leaves a club for the creator whose club it is, not for a listing', () => {
    // Truncation would give `/c/aurora/club`, which nothing serves. The parent
    // is built from the match instead, so a club's way out is the page it is
    // reached from.
    expect(parentOf('/c/aurora/club/inner')).toBe('/c/aurora');
    expect(parentOf('/c/aurora/club/inner/join')).toBe('/c/aurora/club/inner');
  });

  it('sends somebody returning from a payment provider to what they were paying for', () => {
    expect(parentOf('/checkout/return')).toBe('/you/memberships');
    expect(parentOf('/checkout/cancelled')).toBe('/you/memberships');
  });
});

describe('what Back remembers', () => {
  it('returns to the section of Discover that was being browsed', () => {
    expect(backTarget('/c/aurora', '/discover?show=creators')).toBe(
      '/discover?show=creators',
    );
    expect(backTarget('/people/person-1', '/discover')).toBe('/discover');
  });

  it('falls back to the parent when the page was opened directly', () => {
    // A deep link, a bookmark, a second tab, a notification: none of them
    // carry a return address, and none of them may strand somebody.
    expect(backTarget('/c/aurora', null)).toBe('/discover');
    expect(backTarget('/messages/conversation-1', null)).toBe('/messages');
    expect(backTarget('/you/settings', null)).toBe('/you');
  });

  it('refuses a return address that is not the parent it belongs to', () => {
    // `from` arrives on the address, so it is somebody else's string. The worst
    // a crafted one may do is send somebody one level up, which is where Back
    // was going anyway.
    for (const hostile of [
      'https://example.test/phish',
      '//example.test/phish',
      '/you/settings',
      '/messages',
      '\\\\example.test',
      'javascript:alert(1)',
    ]) {
      expect(backTarget('/c/aurora', hostile)).toBe('/discover');
    }
  });

  it('offers nothing at all from a page nobody navigated into', () => {
    expect(backTarget('/discover', '/messages')).toBeUndefined();
    expect(backTarget('/you', '/discover?show=creators')).toBeUndefined();
  });
});

describe('the address a link carries', () => {
  it('remembers the query the page was showing', () => {
    expect(addressOf('/discover', new URLSearchParams('show=creators'))).toBe(
      '/discover?show=creators',
    );
    expect(addressOf('/discover', new URLSearchParams())).toBe('/discover');
  });

  it('round-trips through the link and back out again', () => {
    const from = addressOf('/discover', new URLSearchParams('show=creators'));
    const href = nestedHref('/c/aurora', from);
    const carried = new URL(href, 'http://web.test').searchParams.get('from');
    expect(backTarget('/c/aurora', carried)).toBe('/discover?show=creators');
  });
});

describe('the shell', () => {
  const shellAt = (pathname: string, search = '') =>
    renderProduct(
      <AppShell title="Test">
        <p>content</p>
      </AppShell>,
      createApiDouble(admittedState()),
      { pathname, search },
    );

  it('shows no way back from a destination somebody arrives at', async () => {
    shellAt('/discover');
    await waitFor(() => {
      expect(screen.getByTestId('tab-discover')).toBeTruthy();
    });
    expect(screen.queryByTestId('topbar-back')).toBeNull();
  });

  it('shows a way back from a person, pointing at Discover and naming it', async () => {
    shellAt('/people/person-1');
    await waitFor(() => {
      expect(screen.getByTestId('topbar-back')).toBeTruthy();
    });
    const back = screen.getByTestId('topbar-back');
    expect(back.getAttribute('href')).toBe('/discover');
    // The destination is one the navigation names, so the control says which
    // one it is rather than leaving an arrow to be interpreted.
    expect(back.getAttribute('aria-label')).toBe('Back to Discover');
    expect(back.textContent).toContain('Discover');
  });

  it('says only "Back" when the parent is not a named destination', async () => {
    // A club's way out is its creator's page, which the navigation has no word
    // for. Inventing one here is how a Back ends up labelled with a guess.
    shellAt('/you/gifts');
    await waitFor(() => {
      expect(screen.getByTestId('topbar-back')).toBeTruthy();
    });
    expect(screen.getByTestId('topbar-back').getAttribute('aria-label')).toBe(
      'Back to You',
    );

    cleanup();
    shellAt('/checkout/return');
    await waitFor(() => {
      expect(screen.getByTestId('topbar-back')).toBeTruthy();
    });
    const unnamed = screen.getByTestId('topbar-back');
    expect(unnamed.getAttribute('href')).toBe('/you/memberships');
    expect(unnamed.getAttribute('aria-label')).toBe('Back');
  });

  it('returns to the section that was being browsed when the link carried one', async () => {
    shellAt('/people/person-1', 'from=%2Fdiscover%3Fshow%3Dcreators');
    await waitFor(() => {
      expect(screen.getByTestId('topbar-back')).toBeTruthy();
    });
    expect(screen.getByTestId('topbar-back').getAttribute('href')).toBe(
      '/discover?show=creators',
    );
  });

  it('keeps the bar out of the way only where there is nothing to go back to', async () => {
    // The wide-window rule hides `--bare` and keeps the rest, so the class is
    // what decides whether a desktop reader can leave the page at all.
    const bare = shellAt('/discover');
    await waitFor(() => {
      expect(screen.getByTestId('tab-discover')).toBeTruthy();
    });
    expect(bare.container.querySelector('.v-topbar')?.className).toContain(
      'v-topbar--bare',
    );
    cleanup();

    shellAt('/you/settings');
    await waitFor(() => {
      expect(screen.getByTestId('topbar-back')).toBeTruthy();
    });
    expect(
      screen.getByTestId('topbar-back').closest('.v-topbar')?.className,
    ).not.toContain('v-topbar--bare');
  });
});
