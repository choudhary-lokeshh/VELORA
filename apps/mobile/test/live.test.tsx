import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

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
    expect(screen.queryByTestId('live-premium-activate')).toBeNull();
    expect(await screen.findByTestId('live-premium-short')).toHaveTextContent(
      /You need 25 coins/u,
    );
    // The only way to hold any coins here is the control that says it is a
    // developer's, and the server refuses it outside local and test.
    expect(await screen.findByTestId('live-premium-grant')).toHaveTextContent(
      /Developer/u,
    );
  });
});
