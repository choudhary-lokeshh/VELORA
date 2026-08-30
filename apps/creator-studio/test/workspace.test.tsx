import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Catalog } from '../src/product/catalog';
import { ReceivedGifts } from '../src/product/gifts';
import {
  activeCreatorState,
  createCreatorApiDouble,
  type CreatorApiDoubleState,
} from './support/api-double';
import { currentPath, navigations } from './support/navigation';
import { renderStudio } from './support/render';

/**
 * The workspace's own ergonomics, driven through the real contract.
 *
 * Each assertion here stands for a defect found by using Creator Studio rather
 * than by reading it: a filter that could not be linked to or returned to, a
 * strip that claimed a keyboard contract it did not keep, and a gift screen
 * that showed a letter where a gift was and painted a failure the same colour
 * as a success.
 */

afterEach(() => {
  cleanup();
});

function withProfile(
  overrides: Partial<CreatorApiDoubleState> = {},
): CreatorApiDoubleState {
  return {
    ...activeCreatorState(),
    profile: {
      bio: 'Ceramics, slowly.',
      displayName: 'Ember Vale',
      handle: 'embervale',
      links: [],
      publication: 'published',
      version: 1,
    },
    ...overrides,
  };
}

/** One of each lifecycle, so a filter has something to tell apart. */
function mixedCatalog(): Partial<CreatorApiDoubleState> {
  return {
    content: [
      {
        id: 'content-draft',
        lifecycle: 'draft',
        title: 'Half a thought',
        version: 1,
        visibility: 'public',
      },
      {
        id: 'content-live',
        lifecycle: 'published',
        title: 'A finished piece',
        version: 1,
        visibility: 'public',
      },
    ],
  };
}

/** The segment strip, in the order a creator moves through it. */
function segments(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.s-segmented__item')];
}

/** Which option the strip currently says is chosen. */
function selected(): string | undefined {
  return segments().find((tab) => tab.getAttribute('aria-selected') === 'true')
    ?.dataset.testid;
}

describe('which slice of the catalog is being read', () => {
  it('is an address, so it can be linked to and returned to', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    fireEvent.click(await screen.findByTestId('segment-draft'));

    await waitFor(() => {
      expect(currentPath()).toBe('/catalog');
    });
    // Replaced rather than pushed: choosing a filter is not a Back step.
    expect(navigations().at(-1)).toEqual({
      kind: 'replace',
      path: '/catalog?show=draft',
    });
    expect(selected()).toBe('segment-draft');
    expect(screen.queryByTestId('content-open-content-live')).toBeNull();
  });

  it('opens on the slice the address names', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, {
      pathname: '/catalog',
      search: 'show=published',
    });

    await screen.findByTestId('content-open-content-live');
    expect(screen.queryByTestId('content-open-content-draft')).toBeNull();
    expect(selected()).toBe('segment-published');
  });

  it('shows everything when the address names a slice that is not one', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, {
      pathname: '/catalog',
      search: 'show=banana',
    });

    await screen.findByTestId('content-open-content-live');
    screen.getByTestId('content-open-content-draft');
    expect(selected()).toBe('segment-all');
  });

  it('leaves the address alone when the whole catalog is chosen again', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, {
      pathname: '/catalog',
      search: 'show=draft',
    });

    fireEvent.click(await screen.findByTestId('segment-all'));

    await waitFor(() => {
      expect(navigations().at(-1)).toEqual({
        kind: 'replace',
        path: '/catalog',
      });
    });
  });

  it('names the region it changes', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    const list = await screen.findByTestId('creator-content-list');
    expect(list.id).not.toBe('');
    expect(segments().length).toBeGreaterThan(0);
    for (const tab of segments()) {
      expect(tab.getAttribute('aria-controls')).toBe(list.id);
    }
  });
});

describe('the filter strip and the keyboard', () => {
  it('is one stop, not one stop per option', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    await screen.findByTestId('segment-all');
    expect(segments().map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('moves with the arrows and wraps at both ends', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    const strip = await screen.findByTestId('segment-all');
    fireEvent.keyDown(strip, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(selected()).toBe('segment-draft');
    });

    // Left from the first option wraps to the last rather than stopping.
    fireEvent.keyDown(strip, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(selected()).toBe('segment-all');
    });
    fireEvent.keyDown(strip, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(selected()).toBe('segment-archived');
    });
  });

  it('goes to either end with Home and End', async () => {
    const double = createCreatorApiDouble(withProfile(mixedCatalog()));
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    const strip = await screen.findByTestId('segment-all');
    fireEvent.keyDown(strip, { key: 'End' });
    await waitFor(() => {
      expect(selected()).toBe('segment-archived');
    });
    fireEvent.keyDown(strip, { key: 'Home' });
    await waitFor(() => {
      expect(selected()).toBe('segment-all');
    });
  });
});

describe('the gifts a creator received', () => {
  const rose = {
    createdAt: '2026-08-20T10:00:00.000Z',
    earning: { amountMinor: '80', currency: 'USD' },
    gift: { id: 'gift-1', name: 'Rose', visual: 'rose' as const },
    gross: { amountMinor: '100', currency: 'USD' },
    id: 'received-1',
    senderVisibility: 'withheld' as const,
    sentAt: '2026-08-21T10:00:00.000Z',
    state: 'sent' as const,
  };

  it('draws the gift somebody chose rather than the first letter of its name', async () => {
    const double = createCreatorApiDouble(
      withProfile({ receivedGifts: [rose] }),
    );
    const view = renderStudio(<ReceivedGifts />, double, {
      pathname: '/money/gifts',
    });

    await screen.findByTestId('received-gifts-list');
    const mark = view.container.querySelector('.s-gift-mark');
    expect(mark).not.toBeNull();
    // A drawn shape, not a character: the letter is what stood here before.
    expect(mark?.querySelector('svg path')?.getAttribute('d')).toBeTruthy();
    expect(mark?.textContent).toBe('');
  });

  it('tells a failure apart from a settlement, in words and in tone', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        receivedGifts: [
          rose,
          // A failed gift never settled, so it carries no settlement instant.
          {
            createdAt: rose.createdAt,
            earning: rose.earning,
            gift: { id: 'gift-2', name: 'Spark', visual: 'spark' as const },
            gross: rose.gross,
            id: 'received-2',
            senderVisibility: 'withheld' as const,
            state: 'failed' as const,
          },
        ],
      }),
    );
    renderStudio(<ReceivedGifts />, double, { pathname: '/money/gifts' });

    const settled = await screen.findByTestId('received-gift-state-received-1');
    const failed = screen.getByTestId('received-gift-state-received-2');
    expect(settled.className).toContain('s-badge--positive');
    expect(failed.className).toContain('s-badge--critical');
    expect(failed.textContent).toContain('Did not go through');

    // And what that means for the money, not only what it is called.
    expect(screen.getByTestId('received-gifts-list').textContent).toContain(
      'Nothing was posted to your ledger',
    );
  });

  it('writes a date the way every other date in the workspace is written', async () => {
    const double = createCreatorApiDouble(
      withProfile({ receivedGifts: [rose] }),
    );
    const view = renderStudio(<ReceivedGifts />, double, {
      pathname: '/money/gifts',
    });

    await screen.findByTestId('received-gifts-list');
    const when = view.container.querySelector('time');
    // The settled instant, and a month somebody reads rather than "8/21/2026".
    expect(when?.getAttribute('dateTime')).toBe(rose.sentAt);
    expect(when?.textContent).toMatch(/[A-Za-z]{3}/u);
  });

  it('says there are none rather than showing an empty table', async () => {
    const double = createCreatorApiDouble(withProfile({ receivedGifts: [] }));
    renderStudio(<ReceivedGifts />, double, { pathname: '/money/gifts' });

    await screen.findByTestId('received-gifts-empty');
    expect(screen.queryByTestId('received-gifts-list')).toBeNull();
  });
});
