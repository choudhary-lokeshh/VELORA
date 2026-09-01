import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Wallet } from '../src/product/wallet';
import {
  admittedState,
  createApiDouble,
  type ApiDoubleState,
} from './support/api-double';
import { renderProduct } from './support/render';

/**
 * The coin screen on Consumer Web.
 *
 * What is worth proving here is not that a number renders. It is that this
 * surface cannot say anything the server did not: that a balance is never
 * computed from a delta, that held coins are never presented as spendable, that
 * a history line says which window it belongs to, that no purchase is offered
 * where nothing can take money, and that an environment with no coin ledger is
 * told apart from somebody with no coins.
 */

afterEach(cleanup);

function walletState(
  overrides: Partial<ApiDoubleState['wallet']> = {},
): ApiDoubleState {
  const base = admittedState();
  return {
    ...base,
    wallet: { ...base.wallet, enabled: true, ...overrides },
  };
}

const click = async (testId: string) => {
  fireEvent.click(screen.getByTestId(testId));
  await waitFor(() => {
    expect(true).toBe(true);
  });
};

describe('the coin screen', () => {
  it('tells an environment with no ledger apart from somebody with no coins', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });

    const empty = await screen.findByTestId('wallet-unavailable');
    // Never zero, and never a purchase control: an environment with no coin
    // ledger cannot complete one.
    expect(empty.textContent).toContain('not available here');
    expect(empty.textContent).toContain('free');
    expect(screen.queryByTestId('wallet-grant')).toBeNull();
  });

  it('renders the balance the server holds and never one it worked out', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '75', reserved: '25' } }),
    );
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });

    expect(
      (await screen.findByTestId('wallet-available')).textContent,
    ).toContain('75 coins');
    // Held coins are never presented as spendable. "You have 100" while 25 are
    // committed is a true sentence that makes somebody think they can spend it.
    const reserved = await screen.findByTestId('wallet-reserved');
    expect(reserved.textContent).toContain('25 more are held');
    expect(reserved.textContent).toContain('come back');
  });

  it('says plainly that nothing can take money here, rather than offering a control that fails', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '0', reserved: '0' } }),
    );
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });

    const section = await screen.findByTestId('wallet-acquisition');
    expect(section.textContent).toContain('no way to buy coins');
    expect(section.textContent).toContain('free');
    // The one control that exists here is labelled for what it is, and the
    // server refuses it outside local and test.
    expect((await screen.findByTestId('wallet-grant')).textContent).toContain(
      'Developer',
    );
  });

  it('tells the story of a grant and a hold, in words rather than in ledger terms', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '0', reserved: '0' } }),
    );
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });
    await screen.findByTestId('wallet-acquisition');
    await click('wallet-grant');

    const history = await screen.findByTestId('wallet-history');
    expect(history.textContent).toContain('Development grant');
    expect(history.textContent).toContain('100 coins added');
    // Nothing from the book behind it reaches this screen.
    for (const leak of ['debit', 'credit', 'consumer_balance', 'capture']) {
      expect(history.textContent, leak).not.toContain(leak);
    }
  });

  it('shows a running window, what it cost, and what happens to the coins', async () => {
    const double = createApiDouble(
      walletState({
        balance: { available: '75', reserved: '25' },
        livePreference: {
          charged: false,
          coins: '25',
          expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
          gender: 'woman',
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          region: 'FR',
        },
      }),
    );
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });

    const window = await screen.findByTestId('wallet-window-selection');
    expect(window.textContent).toContain('Women · France');
    // Minutes, never a ticking countdown: an unused window loses nobody
    // anything when it ends, so a clock would manufacture urgency.
    expect(window.textContent).toMatch(/\d+ min left/u);
    // And never more than the window is long. The clock this renders on is the
    // reader's and the expiry is the server's, so a device running behind would
    // otherwise promise more time than was sold.
    const [, minutes] = /(\d+) min left/u.exec(window.textContent) ?? [];
    expect(Number(minutes)).toBeLessThanOrEqual(15);
    const panel = await screen.findByTestId('wallet-window');
    expect(panel.textContent).toContain('held, not spent');
    expect(panel.textContent).toContain('returned in full');
  });

  it('says the opposite, and correctly, once a window has been charged', async () => {
    const double = createApiDouble(
      walletState({
        balance: { available: '75', reserved: '0' },
        livePreference: {
          charged: true,
          coins: '25',
          expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          region: 'FR',
        },
      }),
    );
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });

    const panel = await screen.findByTestId('wallet-window');
    // A charged window and an uncharged one make opposite promises. One
    // sentence for both would promise a refund that is not coming.
    expect(panel.textContent).toContain('were used');
    expect(panel.textContent).toContain('nothing more is charged');
    expect(panel.textContent).not.toContain('returned in full');
  });

  it('sells the packs the server publishes, at the prices it published', async () => {
    const base = walletState({ balance: { available: '0', reserved: '0' } });
    const double = createApiDouble({
      ...base,
      wallet: {
        ...base.wallet,
        acquisition: { android: 'unavailable', web: 'local-test' },
      },
    });
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });

    const packs = await screen.findByTestId('wallet-packs');
    // Both the coin count and the money price are the server's. Nothing on
    // this screen computes one from the other.
    expect(packs.textContent).toContain('100 coins');
    expect(packs.textContent).toContain('5.00 EUR');
    expect(packs.textContent).toContain('500 coins');
    expect(packs.textContent).toContain('25.00 EUR');
    // And no comparison between them, because none is published.
    for (const claim of ['best', 'save', 'popular', 'bonus']) {
      expect(packs.textContent.toLowerCase(), claim).not.toContain(claim);
    }
    // A channel exists, so the developer grant is gone: it is the stand-in for
    // a purchase, not a second way to buy.
    expect(screen.queryByTestId('wallet-grant')).toBeNull();
    expect(screen.getByTestId('wallet-buy-100')).toBeTruthy();
  });

  it('says why nothing is on sale, rather than offering a purchase that fails', async () => {
    const base = walletState({ balance: { available: '0', reserved: '0' } });
    const double = createApiDouble({
      ...base,
      wallet: {
        ...base.wallet,
        acquisition: { android: 'unavailable', web: 'local-test' },
        coinPackGates: ['consumer_country'],
      },
    });
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });

    const gated = await screen.findByTestId('wallet-packs-gated');
    // Names the reason, and never implies the person did something to their
    // account. A generic refusal reads as "your account cannot do that in its
    // current state", which would send them after the wrong thing.
    expect(gated.textContent).toContain('not on sale where you are');
    expect(gated.textContent).toContain('free');
    expect(gated.textContent).not.toContain('account');
    expect(screen.queryByTestId('wallet-packs')).toBeNull();
  });

  it('carries no casino anywhere on it', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    const { container } = renderProduct(<Wallet />, double, {
      pathname: '/you/wallet',
    });
    await screen.findByTestId('wallet-balance');

    const copy = container.textContent;
    for (const forbidden of [
      'jackpot',
      'bonus',
      'streak',
      'lucky',
      'top up now',
      'best value',
      'limited',
      'only',
      'hurry',
    ]) {
      expect(copy.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // And no invented figure: no count of people, no wait, no probability.
    expect(copy).not.toMatch(/\d+\s*(people|online|waiting)/iu);
    expect(copy).not.toContain('%');
  });
});
