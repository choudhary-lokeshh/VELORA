import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Introductions } from '../src/product/introductions';
import { SentGifts } from '../src/product/gifts';
import { ClubDestination } from '../src/product/club';
import { Welcome } from '../src/product/onboarding';
import { Segmented } from '../src/design/primitives';
import {
  admittedState,
  createApiDouble,
  emptyState,
  otherPersonId,
} from './support/api-double';
import { navigations, resetNavigation } from './support/navigation';
import { renderProduct, testApiBaseUrl } from './support/render';

/**
 * The refinements this surface got when it was driven rather than read.
 *
 * Each of these was a real thing somebody using the product would have hit: a
 * group that could not be linked to and opened empty while work waited beside
 * it, a gift history that lost the gift, a refusal with the reason removed, a
 * tab strip that promised keyboard behaviour it did not have, and a progress
 * indicator that said which step you were on in colour alone.
 */

afterEach(cleanup);

const anyRender = (
  ui: Parameters<typeof renderProduct>[0],
  state = admittedState(),
) => renderProduct(ui, createApiDouble(state), { pathname: '/introductions' });

describe('introductions keep the group in the address', () => {
  it('opens the group with something in it rather than the first one', async () => {
    const state = admittedState();
    state.introductions = [
      {
        counterpart: {
          displayName: 'Rae Adeyemi',
          id: otherPersonId,
          media: [],
          sharedLanguages: ['en'],
        },
        createdAt: new Date().toISOString(),
        id: '33333333-3333-4333-8333-333333333333',
        role: 'initiator',
        state: 'pending',
      },
    ];
    anyRender(<Introductions />, state);

    // Nobody is waiting on this person, so opening "Waiting on you" would be
    // opening an empty page with the only row one tab away.
    await waitFor(() => {
      expect(screen.getByTestId('introductions-you-reached-out')).toBeTruthy();
    });
    expect(
      screen
        .getByTestId('segment-you-reached-out')
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('does not present a page of counts as a total', async () => {
    const state = admittedState();
    state.moreIntroductions = true;
    state.introductions = [
      {
        counterpart: {
          displayName: 'Rae Adeyemi',
          id: otherPersonId,
          media: [],
          sharedLanguages: ['en'],
        },
        createdAt: new Date().toISOString(),
        id: '33333333-3333-4333-8333-333333333333',
        role: 'initiator',
        state: 'pending',
      },
    ];
    anyRender(<Introductions />, state);

    // The three numbers beside the group names are counted from one page. A
    // count is the one thing on a partial list that reads as a total, so the
    // page says which it is rather than leaving somebody to assume.
    await waitFor(() => {
      expect(
        screen.getByText(/These counts describe what has been loaded so far/u),
      ).toBeTruthy();
    });
  });

  it('says nothing about loading when the server sent everything', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    await waitFor(() => {
      expect(screen.getByTestId('segment-mutual')).toBeTruthy();
    });
    expect(
      screen.queryByText(/These counts describe what has been loaded so far/u),
    ).toBeNull();
  });

  it('puts the chosen group in the address, and reads it back', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    fireEvent.click(await screen.findByTestId('segment-mutual'));

    await waitFor(() => {
      expect(screen.getByTestId('introductions-empty-mutual')).toBeTruthy();
    });
    // `replace`, so Back leaves the page rather than walking every group tried.
    expect(navigations().at(-1)).toEqual({
      kind: 'replace',
      path: '/introductions?show=mutual',
    });
  });

  it('opens the group a link named', async () => {
    resetNavigation('/introductions', 'show=mutual');
    const double = createApiDouble(admittedState());
    renderProduct(<Introductions />, double, {
      pathname: '/introductions',
      search: 'show=mutual',
    });

    await waitFor(() => {
      expect(screen.getByTestId('introductions-empty-mutual')).toBeTruthy();
    });
  });
});

describe('a tab strip behaves the way its role promises', () => {
  const options = [
    { label: 'One', value: 'one' as const },
    { label: 'Two', value: 'two' as const },
    { label: 'Three', value: 'three' as const },
  ];

  function strip(value: 'one' | 'two' | 'three') {
    const chosen: string[] = [];
    renderProduct(
      <Segmented
        label="Which"
        onChange={(next) => {
          chosen.push(next);
        }}
        options={options}
        value={value}
      />,
      createApiDouble(emptyState()),
    );
    return chosen;
  }

  it('is one stop on the Tab key rather than one per option', () => {
    strip('two');
    expect(screen.getByTestId('segment-one').tabIndex).toBe(-1);
    expect(screen.getByTestId('segment-two').tabIndex).toBe(0);
    expect(screen.getByTestId('segment-three').tabIndex).toBe(-1);
  });

  it('moves with the arrow keys, and wraps', () => {
    const forward = strip('one');
    fireEvent.keyDown(screen.getByTestId('segment-one'), {
      key: 'ArrowRight',
    });
    expect(forward).toEqual(['two']);
    cleanup();

    const back = strip('one');
    fireEvent.keyDown(screen.getByTestId('segment-one'), { key: 'ArrowLeft' });
    expect(back).toEqual(['three']);
  });

  it('goes to the ends with Home and End', () => {
    const chosen = strip('two');
    fireEvent.keyDown(screen.getByTestId('segment-two'), { key: 'End' });
    fireEvent.keyDown(screen.getByTestId('segment-two'), { key: 'Home' });
    expect(chosen).toEqual(['three', 'one']);
  });
});

describe('sent gifts say what was sent, and what happened to it', () => {
  function withGifts(state: ReturnType<typeof admittedState>) {
    state.sentGifts = [
      {
        createdAt: '2026-08-01T10:00:00.000Z',
        creator: { displayName: 'Ember Vale Ceramics', handle: 'embervale' },
        gift: { id: 'g1', name: 'Rose', visual: 'rose' },
        id: 'gift-sent',
        price: { amountMinor: '150', currency: 'USD' },
        sentAt: '2026-08-01T10:00:02.000Z',
        state: 'sent',
      },
      {
        createdAt: '2026-08-02T10:00:00.000Z',
        creator: { displayName: 'North Sound', handle: 'northsound' },
        gift: { id: 'g2', name: 'Crown', visual: 'crown' },
        id: 'gift-failed',
        price: { amountMinor: '2500', currency: 'USD' },
        state: 'failed',
      },
    ];
    return state;
  }

  it('draws the gift somebody chose and links the creator it went to', async () => {
    const double = createApiDouble(withGifts(admittedState()));
    renderProduct(<SentGifts />, double, { pathname: '/you/gifts' });

    const row = await screen.findByTestId('sent-gift-gift-sent');
    // The silhouette itself, not the first letter of its name.
    expect(row.querySelector('svg path')?.getAttribute('d')).toContain(
      'M12 4a',
    );
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/c/embervale');
    // Through the product's own money formatter rather than assembled here.
    expect(row.textContent).toContain('1.50 USD');
  });

  it('does not let a failed gift look like a quiet one', async () => {
    const double = createApiDouble(withGifts(admittedState()));
    renderProduct(<SentGifts />, double, { pathname: '/you/gifts' });

    const row = await screen.findByTestId('sent-gift-gift-failed');
    expect(row.querySelector('.v-badge')?.className).toContain(
      'v-badge--critical',
    );
    // And says what it means, because "Did not go through" does not say
    // whether anything was charged.
    expect(
      screen.getByTestId('sent-gift-meaning-gift-failed').textContent,
    ).toContain('Nothing was charged');
  });

  it('says where a gift comes from when there are none', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<SentGifts />, double, { pathname: '/you/gifts' });
    expect(await screen.findByTestId('sent-gifts-empty')).toBeTruthy();
  });
});

describe('a club that cannot be sold says which gate is shut', () => {
  it('names the reason rather than only refusing', async () => {
    const state = admittedState();
    state.clubDetails['embervale/kiln'] = {
      club: {
        benefits: ['Kiln notes'],
        description: 'Work in progress.',
        id: 'club-1',
        name: 'The Kiln Room',
        slug: 'kiln',
      },
      content: [],
      creatorHandle: 'embervale',
    };
    state.membershipOffers.embervale = {
      gates: ['consumer_country'],
      offers: [
        {
          id: 'offer-1',
          mode: 'subscription',
          prices: [
            {
              amount: { amountMinor: '1200', currency: 'USD' },
              id: 'price-1',
              interval: 'month',
            },
          ],
          resource: { id: 'club-1', type: 'club' },
        },
      ],
      readiness: {
        currencies: ['USD'],
        enabled: true,
        intervals: ['month'],
        modes: ['subscription'],
        source: 'local-test',
      },
    };
    const double = createApiDouble(state);
    renderProduct(
      <ClubDestination
        apiBaseUrl={testApiBaseUrl}
        fetchImplementation={double.fetch}
        handle="embervale"
        signedIn
        slug="kiln"
      />,
      double,
      { pathname: '/c/embervale/club/kiln' },
    );

    const blocked = await screen.findByTestId('club-join-blocked');
    expect(blocked.textContent).toContain(
      'VELORA has not been approved to sell in your country',
    );
    // And no control that would refuse when pressed.
    expect(screen.queryByTestId('club-join')).toBeNull();
  });
});

describe('admission says which step somebody is on', () => {
  it('marks the current step and writes the count out', async () => {
    const state = emptyState();
    state.account = null;
    const double = createApiDouble(state);
    renderProduct(<Welcome />, double, { pathname: '/welcome' });

    const progress = await screen.findByTestId('welcome-progress');
    // Named, so a screen reader says what the list is before reading it.
    expect(progress.getAttribute('aria-label')).toBe('Setting up your account');
    // Exactly one step is the current one, and it says so in the markup rather
    // than only in a fill colour.
    expect(progress.querySelectorAll('[aria-current="step"]').length).toBe(1);
    expect(screen.getByTestId('welcome-step-count').textContent).toBe(
      'Step 1 of 4',
    );
  });
});
