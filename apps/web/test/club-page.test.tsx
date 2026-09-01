import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CheckoutReturn } from '../src/product/checkout';
import { ClubDestination } from '../src/product/club';
import {
  admittedState,
  createApiDouble,
  type ApiDoubleState,
} from './support/api-double';
import { renderProduct, testApiBaseUrl } from './support/render';

/**
 * The club destination and the page a payment provider returns to.
 *
 * The property both are here to prove is the same one: **nothing a client does
 * decides anything**. A club a person may not read answers with an empty feed
 * rather than a filtered one, so there is no protected text in the response to
 * hide; and a return URL reads server state rather than announcing a success,
 * so arriving at it by hand tells somebody exactly what the platform already
 * believed.
 */

afterEach(cleanup);

const clubId = '77777777-7777-4777-8777-777777777777';

function withClub(membership?: { grantedAt: string; source: string }) {
  const state: ApiDoubleState = admittedState();
  state.clubDetails['ember_vale/inner'] = {
    club: {
      benefits: ['A letter every week'],
      description: 'A quiet room.',
      id: clubId,
      ...(membership === undefined ? {} : { membership }),
      name: 'Inner Circle',
      slug: 'inner',
    },
    content:
      membership === undefined
        ? []
        : [
            {
              body: 'Only members read this.',
              id: '88888888-8888-4888-8888-888888888888',
              media: [],
              publishedAt: '2026-08-15T12:00:00.000Z',
              summary: 'A members-only letter',
              title: 'The first letter',
            },
          ],
    creatorHandle: 'ember_vale',
  };
  state.membershipOffers.ember_vale = {
    gates: [],
    offers: [
      {
        id: 'offer-1',
        mode: 'subscription',
        prices: [
          {
            amount: { amountMinor: '1500', currency: 'USD' },
            id: 'price-1',
            interval: 'month',
          },
        ],
        resource: { id: clubId, type: 'club' },
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
  return state;
}

function renderClub(state: ApiDoubleState, signedIn = true) {
  const double = createApiDouble(state);
  renderProduct(
    <ClubDestination
      apiBaseUrl={testApiBaseUrl}
      fetchImplementation={double.fetch}
      handle="ember_vale"
      signedIn={signedIn}
      slug="inner"
    />,
    double,
    { pathname: '/c/ember_vale/club/inner' },
  );
  return double;
}

describe('a club somebody is not in', () => {
  it('publishes what it is and nothing a member reads', async () => {
    renderClub(withClub());

    await screen.findByTestId('club-locked');
    expect(screen.getByTestId('club-benefits').textContent).toContain(
      'A letter every week',
    );
    // The whole document, not a query. Nothing about the members-only item is
    // anywhere in the answer, so there is nothing to reveal.
    expect(document.body.textContent).not.toContain('Only members read this.');
    expect(screen.queryByTestId('club-feed')).toBeNull();
  });

  it('offers the price and a way in when somebody could buy it', async () => {
    renderClub(withClub());

    const locked = await screen.findByTestId('club-locked');
    expect(locked.textContent).toContain('15.00 USD');
    expect(locked.textContent).toContain('a month');
    expect(screen.getByTestId('club-join').getAttribute('href')).toBe(
      '/c/ember_vale/club/inner/join',
    );
  });

  it('sends somebody with no session to sign in rather than to a refusal', async () => {
    renderClub(withClub(), false);

    await screen.findByTestId('club-join-signin');
    expect(screen.queryByTestId('club-join')).toBeNull();
  });

  it('says a club nobody priced is by invitation and offers nothing to buy', async () => {
    const state = withClub();
    state.membershipOffers.ember_vale = {
      gates: [],
      offers: [],
      readiness: {
        currencies: [],
        enabled: false,
        intervals: [],
        modes: [],
        source: 'unpublished',
      },
    };
    renderClub(state);

    const locked = await screen.findByTestId('club-locked');
    expect(locked.textContent).toContain('by invitation from its creator');
    expect(screen.queryByTestId('club-join')).toBeNull();
  });
});

describe('a club somebody is in', () => {
  it('shows the feed the server admitted them to', async () => {
    renderClub(
      withClub({ grantedAt: '2026-08-14T12:00:00.000Z', source: 'billing' }),
    );

    const feed = await screen.findByTestId('club-feed');
    expect(feed.textContent).toContain('The first letter');
    expect(feed.textContent).toContain('Only members read this.');
    expect(screen.getByTestId('club-membership').textContent).toContain(
      'Paid membership',
    );
    expect(screen.queryByTestId('club-locked')).toBeNull();
  });

  it('says a club with nothing in it is empty rather than broken', async () => {
    const state = withClub({
      grantedAt: '2026-08-14T12:00:00.000Z',
      source: 'creator_invite',
    });
    const detail = state.clubDetails['ember_vale/inner'];
    if (detail === undefined) throw new Error('the club was not seeded');
    state.clubDetails['ember_vale/inner'] = { ...detail, content: [] };
    renderClub(state);

    await screen.findByTestId('club-feed-empty');
  });
});

describe('coming back from a payment provider', () => {
  function withPayment(state: string) {
    const base = admittedState();
    base.payments = [
      {
        amount: { amountMinor: '1500', currency: 'USD' },
        createdAt: '2026-08-27T12:00:00.000Z',
        id: 'payment-1',
        offerId: 'offer-1',
        state,
        updatedAt: '2026-08-27T12:00:00.000Z',
      },
    ];
    return base;
  }

  it('reports what the platform already believed rather than a success', async () => {
    const double = createApiDouble(withPayment('succeeded'));
    renderProduct(<CheckoutReturn />, double, {
      pathname: '/checkout/return',
      search: '?payment=payment-1',
    });

    const state = await screen.findByTestId('checkout-state');
    expect(state.textContent).toContain('Paid');
    expect(state.textContent).toContain('15.00 USD');
  });

  it('sends somebody where what they bought actually landed', async () => {
    const base = withPayment('succeeded');
    const coins = {
      ...base,
      payments: base.payments.map((payment) => ({
        ...payment,
        resource: {
          id: '20000000-0000-4000-8000-000000000001',
          type: 'coins' as const,
        },
      })),
    };
    renderProduct(<CheckoutReturn />, createApiDouble(coins), {
      pathname: '/checkout/return',
      search: '?payment=payment-1',
    });

    // Coins and a club membership settle through one checkout and land
    // somewhere different. A page that sent everybody to Memberships would
    // send half of them to a screen with nothing on it.
    await screen.findByTestId('checkout-state');
    expect(document.body.textContent).toContain('Coins added');
    const onward = screen.getByRole('link', { name: 'Go to Coins' });
    expect(onward.getAttribute('href')).toBe('/you/wallet');
  });

  it('says it is waiting rather than claiming a payment that has not settled', async () => {
    const double = createApiDouble(withPayment('provider_pending'));
    renderProduct(<CheckoutReturn />, double, {
      pathname: '/checkout/return',
      search: '?payment=payment-1',
    });

    await screen.findByTestId('checkout-waiting');
    // A browser navigation is not evidence that money moved, so the page never
    // says it did.
    expect(document.body.textContent).not.toContain('You are in');
  });

  it('explains a lost provider answer without guessing which way it went', async () => {
    const double = createApiDouble(withPayment('reconciliation_pending'));
    renderProduct(<CheckoutReturn />, double, {
      pathname: '/checkout/return',
      search: '?payment=payment-1',
    });

    const state = await screen.findByTestId('checkout-state');
    expect(state.textContent).toContain('Being confirmed');
    expect(state.textContent).toContain('does not know yet');
    expect(state.textContent).toContain('nothing is charged twice');
  });

  it('says a failure failed, and says nothing was charged', async () => {
    const double = createApiDouble(withPayment('failed'));
    renderProduct(<CheckoutReturn />, double, {
      pathname: '/checkout/return',
      search: '?payment=payment-1',
    });

    const state = await screen.findByTestId('checkout-state');
    expect(state.textContent).toContain('Did not go through');
    expect(state.textContent).toContain('Nothing was charged');
  });
});
