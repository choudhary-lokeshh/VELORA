import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { BackHandler } from 'react-native';

import { createInMemorySecureTokenStore } from '../src/auth/secure-storage';
import { LiveScreen } from '../src/product/live';
import {
  admittedState,
  createMobileApiDouble,
  liveConversationId,
  type MobileApiState,
} from './support/api-double';
import { renderScreen } from './support/render';

/**
 * Live discovery on Consumer Mobile.
 *
 * The same properties the web suite proves, asserted against the phone surface
 * because they are properties of the product rather than of one renderer:
 * nothing opens a camera before somebody asks, no count of anybody is invented,
 * the remote pane says what is carrying media rather than implying it, one
 * Connect is never a connection, and the local scenario panel exists only where
 * the server says it does.
 *
 * `expo-camera` is exercised through `jest-expo`'s own module stubs, so what is
 * asserted here is when the preview is *mounted* — which is the decision this
 * surface actually owns. Whether a real camera then produces frames is a device
 * question, and ADR-0039 records it as one.
 */

const noop = () => undefined;

function liveState(
  overrides: Partial<MobileApiState['live']> = {},
): MobileApiState {
  const base = admittedState();
  return { ...base, live: { ...base.live, ...overrides } };
}

/**
 * A world that has coins, which no deployed environment does.
 *
 * The default state has none, and every other assertion on this screen runs
 * against that — which is the point: the paid control must be *absent* where
 * there is no ledger, not disabled, so nothing about the free product changes.
 */
function walletState(
  overrides: Partial<MobileApiState['wallet']> = {},
): MobileApiState {
  const base = liveState();
  return { ...base, wallet: { ...base.wallet, enabled: true, ...overrides } };
}

/**
 * Mounts the screen for somebody who is already signed in.
 *
 * The session is established the way a real cold launch establishes one — by
 * restoring token material the platform keystore was holding — because every
 * product route is bearer-authenticated and a screen mounted without one would
 * be asserting the 401 path.
 */
async function mountLive(
  state: MobileApiState,
  handlers: {
    readonly onOpenConversation?: (conversationId: string) => void;
    readonly onOpenPerson?: (personId: string) => void;
  } = {},
): Promise<void> {
  const double = createMobileApiDouble(state);
  const store = createInMemorySecureTokenStore();
  await store.write({
    accessToken: 'access-stored',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    installationId: 'installation-local-device',
    refreshToken: 'refresh-stored',
  });
  const element: ReactElement = (
    <LiveScreen
      onOpenConversation={handlers.onOpenConversation ?? noop}
      onOpenPerson={handlers.onOpenPerson ?? noop}
    />
  );
  await renderScreen(element, double, { store });
}

async function press(testID: string): Promise<void> {
  // Every event is awaited. `fireEvent` from `@testing-library/react-native` v14
  // is asynchronous, and dispatching a second before the first settles leaves
  // React's act bookkeeping unbalanced and times out every later mount in the
  // file.
  await fireEvent.press(screen.getByTestId(testID));
}

/**
 * Applies one local scenario.
 *
 * The panel is collapsed until somebody opens it, because it is a developer's
 * tool sitting on the product's primary screen. Opening it is part of using it.
 */
async function scenario(name: string): Promise<void> {
  if (screen.queryByTestId(`live-sim-${name}`) === null) {
    await press('live-sim-toggle');
  }
  await press(`live-sim-${name}`);
}

describe('the door', () => {
  it('shows a door rather than a viewfinder', async () => {
    await mountLive(liveState());

    await screen.findByTestId('live-door');
    // No preview, no room, nothing bound. Opening the tab is not consent to be
    // seen.
    expect(screen.queryByTestId('live-local-camera')).toBeNull();
    expect(screen.queryByTestId('live-room')).toBeNull();
  });

  it('offers voice and video separately', async () => {
    await mountLive(liveState());

    expect(await screen.findByTestId('live-start-video')).toBeTruthy();
    expect(screen.getByTestId('live-start-voice')).toBeTruthy();
  });
});

describe('an encounter', () => {
  it('names the person and says what is carrying them', async () => {
    await mountLive(liveState());
    await screen.findByTestId('live-door');
    await press('live-start-video');

    await screen.findByTestId('live-peer-name');
    expect(screen.getByTestId('live-peer-name')).toHaveTextContent(/Robin/u);
    // Awaited, because a match arrives rather than appearing: during the
    // reveal the screen says the session is connecting, which is what the
    // session state actually is.
    expect(await screen.findByTestId('live-no-media')).toHaveTextContent(
      /no approved provider exists yet/u,
    );
  });

  it('keeps Next and End reachable while an encounter is running', async () => {
    await mountLive(liveState());
    await screen.findByTestId('live-door');
    await press('live-start-video');

    // The two controls that must never be hard to reach, present in the same
    // fixed row whatever else the screen is showing.
    expect(await screen.findByTestId('live-next')).toBeTruthy();
    expect(screen.getByTestId('live-end')).toBeTruthy();
  });

  it('says the live chat is not the Inbox', async () => {
    await mountLive(liveState());
    await screen.findByTestId('live-door');
    await press('live-start-video');

    // The chat is a sheet rather than a panel in a column, so it is opened
    // the way a person opens it.
    await screen.findByTestId('live-toggle-chat');
    await press('live-toggle-chat');
    const chat = await screen.findByTestId('live-chat');
    expect(chat).toHaveTextContent(
      /does not go to your Inbox unless you both connect/u,
    );
  });
});

describe('searching', () => {
  it('invents no count of anybody', async () => {
    await mountLive(liveState({ standInAvailable: false }));
    await screen.findByTestId('live-door');
    await press('live-start-video');

    const searching = await screen.findByTestId('live-searching');
    expect(searching).toHaveTextContent(/looking/iu);
    // There is no presence projection behind this product, so a number here
    // would be one this screen invented.
    expect(searching).not.toHaveTextContent(/\d/u);
  });
});

describe('connecting', () => {
  it('is one-sided after a single press', async () => {
    await mountLive(liveState());
    await screen.findByTestId('live-door');
    await press('live-start-video');
    await screen.findByTestId('live-connect');

    await press('live-connect');

    await waitFor(() => {
      expect(screen.getByTestId('live-connection')).toHaveTextContent(
        /Waiting for them/u,
      );
    });
  });

  it('opens the durable conversation once both people have asked', async () => {
    const opened: string[] = [];
    await mountLive(liveState({ simulated: true }), {
      onOpenConversation: (conversationId) => {
        opened.push(conversationId);
      },
    });
    await screen.findByTestId('live-door');
    await press('live-start-video');
    await screen.findByTestId('live-connect');

    await press('live-connect');
    await waitFor(() => {
      expect(screen.getByTestId('live-connection')).toHaveTextContent(
        /Waiting for them/u,
      );
    });
    await scenario('peer_connect');
    await waitFor(() => {
      expect(screen.getByTestId('live-connection')).toHaveTextContent(
        /Connected/u,
      );
    });

    await scenario('peer_next');
    await screen.findByTestId('live-ended-conversation');
    await press('live-ended-conversation');
    expect(opened).toEqual([liveConversationId]);
  });
});

describe('when the other person moves on', () => {
  it('says so rather than replacing them with a spinner', async () => {
    await mountLive(liveState({ simulated: true }));
    await screen.findByTestId('live-door');
    await press('live-start-video');
    await screen.findByTestId('live-peer-name');

    await scenario('peer_next');

    const ended = await screen.findByTestId('live-ended');
    expect(ended).toHaveTextContent(/They moved on/u);
    expect(screen.getByTestId('live-search-again')).toBeTruthy();
  });
});

describe('the platform gate', () => {
  it('explains itself when live discovery is switched off', async () => {
    await mountLive(liveState({ admission: 'unavailable' }));

    const blocked = await screen.findByTestId('live-unavailable');
    expect(blocked).toHaveTextContent(/no RTC provider is eligible/u);
    expect(screen.queryByTestId('live-door')).toBeNull();
  });

  it('offers no local scenarios where the server says there are none', async () => {
    await mountLive(liveState({ simulated: false }));
    await screen.findByTestId('live-door');
    await press('live-start-video');
    await screen.findByTestId('live-peer-name');

    expect(screen.queryByTestId('live-simulation')).toBeNull();
  });
});

describe('the paid matching preference', () => {
  it('is absent entirely where this environment has no coins', async () => {
    await mountLive(liveState());
    await screen.findByTestId('live-door');
    // Absent rather than disabled. A control explaining a feature that does not
    // exist here is a control somebody will try to enable.
    expect(screen.queryByTestId('live-premium')).toBeNull();
    expect(screen.queryByTestId('live-premium-active')).toBeNull();
  });

  it('says what is bought and claims nothing about who is there', async () => {
    await mountLive(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    const panel = await screen.findByTestId('live-premium');
    // The price and the duration are the server's, so this can never render a
    // price that is not the price that will be charged.
    expect(panel).toHaveTextContent(/25 coins/u);
    expect(panel).toHaveTextContent(/15 minutes/u);
    expect(panel).toHaveTextContent(/returned in full/u);
    // And no invented figure anywhere. This is the screen where one would be
    // most profitable and it carries none.
    expect(panel).not.toHaveTextContent(/\d+\s*(people|online|waiting)/iu);
    expect(panel).not.toHaveTextContent(/%/u);
  });

  it('offers no purchase where nothing can take money', async () => {
    await mountLive(
      walletState({ balance: { available: '0', reserved: '0' } }),
    );
    await screen.findByTestId('live-premium');
    await press('live-premium-gender-woman');

    // Short of coins, so the control that opens a confirmation is replaced by
    // the refusal — and the refusal says only the price and the balance, both
    // of which this person can already see.
    expect(screen.queryByTestId('live-premium-review')).toBeNull();
    expect(await screen.findByTestId('live-premium-short')).toHaveTextContent(
      /Women costs 25 coins\. You have 0\./u,
    );
    // The only way to hold any coins here is the control that says it is a
    // developer's, and the server refuses it outside local and test.
    expect(await screen.findByTestId('live-premium-grant')).toHaveTextContent(
      /Developer/u,
    );
  });

  it('says what it will do before it moves anything, and does it once confirmed', async () => {
    await mountLive(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    await screen.findByTestId('live-premium');
    await press('live-premium-gender-woman');

    // The price is on the control that opens the confirmation, so the cost is
    // never behind the button that spends.
    expect(await screen.findByTestId('live-premium-review')).toHaveTextContent(
      /Women — 25 coins/u,
    );
    await press('live-premium-review');
    expect(await screen.findByTestId('live-premium-confirm')).toHaveTextContent(
      /Women for 15 minutes — 25 coins held/u,
    );

    await press('live-premium-activate');
    const active = await screen.findByTestId('live-premium-active');
    expect(active).toHaveTextContent(/Women/u);
    // Held, not spent — and the sentence says so rather than reassuring.
    expect(active).toHaveTextContent(/held, not spent/u);

    await press('live-premium-cancel');
    await screen.findByTestId('live-premium');
    // In full, and the balance rendered is the server's answer rather than a
    // delta this surface applied.
    expect(await screen.findByTestId('live-premium-balance')).toHaveTextContent(
      /You have 100 coins/u,
    );
  });

  it('renders the catalogue the backend returns rather than a price of its own', async () => {
    await mountLive(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    const panel = await screen.findByTestId('live-premium');
    // Every price on this screen came from the wallet read. There is no
    // constant in the mobile bundle a surface could disagree with the server
    // about, which is what this asserts by naming all three.
    expect(panel).toHaveTextContent(/Women — 25 coins/u);
    expect(panel).toHaveTextContent(/15 coins/u);
    expect(panel).toHaveTextContent(/10 coins/u);
  });
});

/**
 * What the hardware Back does inside an encounter.
 *
 * A phone's Back is an accidental press waiting to happen, and the thing on
 * the other side of this screen is a person. Back therefore asks — with the
 * same End the dock offers — instead of silently abandoning them, and asks
 * only once: the sheet's own Back closes the sheet.
 */
describe('the hardware Back in an encounter', () => {
  const backHandlers: (() => boolean)[] = [];

  beforeEach(() => {
    backHandlers.length = 0;
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        const pressed = handler as () => boolean;
        backHandlers.push(pressed);
        return {
          remove: () => {
            const index = backHandlers.indexOf(pressed);
            if (index >= 0) backHandlers.splice(index, 1);
          },
        };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function pressBack(): Promise<boolean> {
    // Registered handlers answer most-recent-first, the way the platform does.
    let handled = false;
    await act(async () => {
      for (const handler of [...backHandlers].reverse()) {
        if (handler()) {
          handled = true;
          break;
        }
      }
      await Promise.resolve();
    });
    return handled;
  }

  it('asks before leaving, and stays when told to stay', async () => {
    await mountLive(liveState());
    await screen.findByTestId('live-door');
    await press('live-start-video');
    await screen.findByTestId('live-peer-name');

    expect(await pressBack()).toBe(true);
    await screen.findByTestId('live-leave-confirm');

    await press('live-leave-confirm-stay');
    await waitFor(() => {
      expect(screen.queryByTestId('live-leave-confirm')).toBeNull();
    });
    // Still with them: nothing ended because somebody said stay.
    expect(screen.getByTestId('live-peer-name')).toBeTruthy();
  });

  it('ends through the same leave the dock uses when told to end', async () => {
    await mountLive(liveState());
    await screen.findByTestId('live-door');
    await press('live-start-video');
    await screen.findByTestId('live-peer-name');

    await pressBack();
    await screen.findByTestId('live-leave-confirm');
    await press('live-leave-confirm-end');

    // The door again, the way End reaches it: the server was told, and the
    // stage did not simply unmount around a running session.
    await screen.findByTestId('live-door');
  });
});
