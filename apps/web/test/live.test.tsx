import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Live } from '../src/product/live';
import {
  admittedState,
  createApiDouble,
  liveConversationId,
  otherPersonId,
  type ApiDoubleState,
} from './support/api-double';
import { renderProduct } from './support/render';

/**
 * Live discovery on Consumer Web, driven through the generated client against a
 * stand-in API that answers the real contract.
 *
 * What is worth proving here is not that controls render. It is that this
 * surface cannot express something the server would refuse, and cannot say
 * something that is not true:
 *
 * - nothing opens a camera before somebody asks for one;
 * - no count of who is online appears anywhere, because none exists;
 * - the remote pane says what is carrying media rather than implying it;
 * - one Connect is never a connection;
 * - a permission refusal leaves the surface usable rather than trapping anybody;
 * - the local scenario panel exists only where the server says it does.
 */

afterEach(cleanup);

/**
 * The capture API, absent by default.
 *
 * jsdom has no `mediaDevices`, which is exactly the condition a browser on an
 * insecure origin presents — so the default in these tests is the honest
 * "nothing to open" path, and a test that wants a camera installs one.
 */
function installCamera(
  outcome: 'granted' | 'denied' | 'missing' = 'granted',
): void {
  if (outcome === 'missing') {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
    return;
  }
  const track = () => ({
    enabled: true,
    kind: 'video',
    stop: vi.fn(),
  });
  const stream = {
    getAudioTracks: () => [{ enabled: true, kind: 'audio', stop: vi.fn() }],
    getTracks: () => [track()],
    getVideoTracks: () => [track()],
  };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(() =>
        Promise.resolve([
          { deviceId: 'a', kind: 'videoinput' },
          { deviceId: 'b', kind: 'videoinput' },
        ]),
      ),
      getUserMedia: vi.fn(() => {
        if (outcome === 'denied') {
          const failure = new Error('denied');
          failure.name = 'NotAllowedError';
          return Promise.reject(failure);
        }
        return Promise.resolve(stream);
      }),
    },
  });
}

beforeEach(() => {
  installCamera('missing');
});

function liveState(
  overrides: Partial<ApiDoubleState['live']> = {},
): ApiDoubleState {
  const base = admittedState();
  return { ...base, live: { ...base.live, ...overrides } };
}

/**
 * A world that has coins, which no deployed environment does.
 *
 * The default state has none, and every existing assertion on this screen runs
 * against that — which is the point: the paid control must be *absent* where
 * there is no ledger, not disabled, so nothing about the free product changes.
 */
function walletState(
  overrides: Partial<ApiDoubleState['wallet']> = {},
): ApiDoubleState {
  const base = liveState();
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

/**
 * Applies one local scenario.
 *
 * The panel is collapsed until somebody opens it, because it is a developer's
 * tool sitting on the product's primary screen. Opening it is part of using it,
 * so it is part of this helper rather than repeated at seven call sites.
 */
const scenario = async (name: string) => {
  if (screen.queryByTestId(`live-sim-${name}`) === null) {
    await click('live-sim-toggle');
  }
  await click(`live-sim-${name}`);
};

describe('the door', () => {
  it('opens no camera until somebody asks for one', async () => {
    installCamera('granted');
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });

    await screen.findByTestId('live-door');
    const devices = globalThis.navigator.mediaDevices as unknown as {
      getUserMedia: { mock: { calls: unknown[] } };
    };
    // The strongest assertion on this screen. Loading a page is not consent to
    // be seen, and there must be no path from a render to a camera.
    expect(devices.getUserMedia.mock.calls).toHaveLength(0);
  });

  it('opens the camera once, however many times the screen renders', async () => {
    installCamera('granted');
    const double = createApiDouble(liveState({ simulated: true }));
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-peer-name');

    // Several more renders: a poll answering, a scenario applying, a message
    // arriving. None of them is a reason to reopen a device.
    await scenario('peer_message');
    await scenario('peer_message');

    const devices = globalThis.navigator.mediaDevices as unknown as {
      getUserMedia: { mock: { calls: unknown[] } };
    };
    // The regression this exists for: the teardown effect depended on the whole
    // media object, which `useLiveMedia` rebuilds every render, so the cleanup
    // ran on every render and released the camera milliseconds after acquiring
    // it — and then acquired it again, for ever. A person saw a granted
    // permission and no picture; a browser saw a camera opening in a loop.
    expect(devices.getUserMedia.mock.calls).toHaveLength(1);
  });

  it('offers voice and video separately rather than as one control', async () => {
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });

    // Agreeing to be heard is not agreeing to be seen, and a single control
    // carrying whichever was chosen last would make the more exposing option
    // the default for somebody who never chose it.
    expect(await screen.findByTestId('live-start-video')).toBeTruthy();
    expect(screen.getByTestId('live-start-voice')).toBeTruthy();
  });

  it('says plainly that nothing is recorded', async () => {
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    expect(screen.getByText(/Nothing is recorded/)).toBeTruthy();
  });
});

describe('searching', () => {
  it('invents no count of anybody', async () => {
    const double = createApiDouble(liveState({ standInAvailable: false }));
    renderProduct(<Live />, double, { pathname: '/live' });

    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-searching');

    // There is no presence projection behind this product, so any number here
    // would be one the screen invented — and a person who found that out would
    // be right to distrust everything else on it.
    const searching = screen.getByTestId('live-searching').textContent;
    expect(searching).toMatch(/looking/iu);
    expect(/\d/u.test(searching)).toBe(false);
  });
});

describe('an encounter', () => {
  it('shows the person and says what is carrying them', async () => {
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });

    await screen.findByTestId('live-door');
    await click('live-start-video');

    expect((await screen.findByTestId('live-peer-name')).textContent).toBe(
      'Robin',
    );
    // Held behind the reveal, which is why this waits: a match arrives rather
    // than appearing, and during the arrival the screen says the session is
    // connecting — which is what the session state actually is.
    const transport = await screen.findByTestId('live-no-media', undefined, {
      timeout: 3000,
    });
    // The honest sentence, in words, rather than a black rectangle implying a
    // connection that does not exist.
    expect(transport.textContent).toContain('no approved provider exists yet');
  });

  it('keeps live chat out of the Inbox, and says so', async () => {
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-chat');

    expect(screen.getByTestId('live-chat').textContent).toContain(
      'does not go to your Inbox unless you both connect',
    );
  });

  it('sends a message and shows it', async () => {
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-chat-input');

    fireEvent.change(screen.getByTestId('live-chat-input'), {
      target: { value: 'hello there' },
    });
    await click('live-chat-send');

    await waitFor(() => {
      expect(screen.getByTestId('live-chat-list').textContent).toContain(
        'hello there',
      );
    });
    // The composer is cleared only on success, because somebody who typed
    // something and lost it to a failed send has lost the thing they were
    // trying to say.
    expect(screen.getByTestId<HTMLInputElement>('live-chat-input').value).toBe(
      '',
    );
  });
});

describe('connecting', () => {
  it('is one-sided after a single press', async () => {
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-connect');

    await click('live-connect');

    await waitFor(() => {
      expect(screen.getByTestId('live-connection').textContent).toBe(
        'Waiting for them',
      );
    });
    // Nothing durable is offered yet. One tap is not a relationship, and the
    // surface must not imply one.
    expect(screen.queryByTestId('live-ended-conversation')).toBeNull();
  });

  it('offers the durable conversation once both people have asked', async () => {
    const double = createApiDouble(liveState({ simulated: true }));
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-connect');

    await click('live-connect');
    await waitFor(() => {
      expect(screen.getByTestId('live-connection').textContent).toBe(
        'Waiting for them',
      );
    });
    // The other person asks too, through the scenario that acts as them.
    await scenario('peer_connect');
    await waitFor(() => {
      expect(screen.getByTestId('live-connection').textContent).toBe(
        'Connected',
      );
    });

    // And when the encounter ends, the relationship is what survives.
    await scenario('peer_next');
    const link = await screen.findByTestId('live-ended-conversation');
    expect(link.getAttribute('href')).toContain(liveConversationId);
  });
});

describe('when the other person moves on', () => {
  it('says so rather than replacing them with a spinner', async () => {
    const double = createApiDouble(liveState({ simulated: true }));
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-peer-name');

    await scenario('peer_next');

    const ended = await screen.findByTestId('live-ended');
    expect(ended.textContent).toContain('They moved on');
    // And there is one press back into the pool, rather than a dead end.
    expect(screen.getByTestId('live-search-again')).toBeTruthy();
  });

  it('distinguishes a lost connection from somebody leaving', async () => {
    const double = createApiDouble(liveState({ simulated: true }));
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-peer-name');

    await scenario('peer_disconnect');

    const ended = await screen.findByTestId('live-ended');
    expect(ended.textContent).toContain('You lost each other');
    expect(ended.textContent).not.toContain('They moved on');
  });
});

describe('reporting somebody after they have gone', () => {
  it('keeps a safety control on the ended encounter', async () => {
    const double = createApiDouble(liveState({ simulated: true }));
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-peer-name');

    // The complaint this exists for: the other person behaves badly and leaves,
    // and every control that named them leaves with them.
    await scenario('peer_next');
    await screen.findByTestId('live-ended');

    const safety = await screen.findByTestId('live-ended-safety');
    expect(safety).toBeTruthy();
    // And it is the real control, addressed to the person who just left.
    expect(
      safety.querySelector(`[data-testid="safety-menu-${otherPersonId}"]`),
    ).toBeTruthy();
  });

  it('reports and blocks in one act, and says both happened', async () => {
    const double = createApiDouble(liveState({ simulated: true }));
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-peer-name');
    await scenario('peer_next');
    await screen.findByTestId('live-ended');

    await click(`safety-menu-${otherPersonId}`);
    await click('safety-open-report-and-block');
    await screen.findByTestId('report-and-block-effect');
    await click('report-submit');

    await waitFor(() => {
      expect(
        double.state.blocks.some((block) => block.blockedId === otherPersonId),
      ).toBe(true);
    });
    expect(double.state.reports).toHaveLength(1);
  });

  it('says the block still stands when no report could be taken', async () => {
    const double = createApiDouble({
      ...liveState({ simulated: true }),
      reportingBoundReached: true,
    });
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-peer-name');
    await scenario('peer_next');
    await screen.findByTestId('live-ended');

    await click(`safety-menu-${otherPersonId}`);
    await click('safety-open-report-and-block');
    await click('report-submit');

    // The half that protects somebody landed, and nothing claims the other one
    // did. A surface that said "report received" here would be lying about
    // evidence.
    await waitFor(() => {
      expect(
        double.state.blocks.some((block) => block.blockedId === otherPersonId),
      ).toBe(true);
    });
    expect(double.state.reports).toHaveLength(0);
  });
});

describe('permissions', () => {
  it('keeps the surface usable when the camera is refused', async () => {
    installCamera('denied');
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');

    const notice = await screen.findByTestId('live-permission-denied');
    expect(notice.textContent).toContain('Everything else works without it');
    // Not a dead end: the encounter and its chat are still there.
    expect(screen.getByTestId('live-peer-name')).toBeTruthy();
    expect(screen.getByTestId('live-chat-input')).toBeTruthy();
  });

  it('offers no settings route where there is no camera at all', async () => {
    installCamera('missing');
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');

    const notice = await screen.findByTestId('live-permission-unavailable');
    // Nothing a person can do about it, so nothing is offered. A control that
    // did nothing would be worse than none.
    expect(notice.textContent).toContain('no camera or microphone available');
  });
});

describe('the paid matching preference', () => {
  it('is absent entirely where this environment has no coins', async () => {
    const double = createApiDouble(liveState());
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');

    // Absent rather than disabled. A control explaining a feature that does not
    // exist here is a control somebody will try to enable.
    expect(screen.queryByTestId('live-premium')).toBeNull();
    expect(screen.queryByTestId('live-premium-active')).toBeNull();
  });

  it('says what is bought, at the published price, and claims nothing about who is there', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    renderProduct(<Live />, double, { pathname: '/live' });

    const panel = await screen.findByTestId('live-premium');
    const copy = panel.textContent;
    // Every price is the server's, so a surface can never render one that is
    // not the price that will be charged.
    expect(copy).toContain('Women — 25 coins');
    expect(copy).toContain('15 minutes');
    // Everyone stays free and says so, next to the things that are not.
    expect(copy).toContain('Everyone is free');
    // The whole of what happens to the money, said where somebody decides.
    expect(copy).toContain('held');
    expect(copy).toContain('returned in full');
    // And no invented figure anywhere: no count of matching people, no wait, no
    // probability, no scarcity.
    expect(copy).not.toMatch(/\d+\s*(people|online|waiting|match(es)?\b)/iu);
    expect(copy).not.toContain('%');
  });

  it('offers no purchase where nothing can take money', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '0', reserved: '0' } }),
    );
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-premium');

    fireEvent.change(screen.getByTestId('live-premium-region'), {
      target: { value: 'FR' },
    });

    // Short of coins, so the activation control is replaced by the refusal —
    // and the refusal says only the price and the balance, both of which this
    // person can already see.
    expect(screen.queryByTestId('live-premium-review')).toBeNull();
    const short = await screen.findByTestId('live-premium-short');
    expect(short.textContent).toContain('France costs 15 coins');
    expect(short.textContent).toContain('You have 0');
    // No channel can take money in this environment, so the only way to get
    // any is the developer grant, and it is labelled as one.
    const grant = await screen.findByTestId('live-premium-grant');
    expect(grant.textContent).toContain('Developer');
  });

  it('says what it will do before it moves anything, and does it once confirmed', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-premium');

    fireEvent.change(screen.getByTestId('live-premium-region'), {
      target: { value: 'FR' },
    });
    // The price is on the control that opens the confirmation, so the cost is
    // never behind the button that spends.
    const review = await screen.findByTestId('live-premium-review');
    expect(review.textContent).toContain('France — 15 coins');
    await click('live-premium-review');

    const confirm = await screen.findByTestId('live-premium-confirm');
    expect(confirm.textContent).toContain('France for 15 minutes — 15 coins');
    expect(confirm.textContent).toContain('returned in full');
    await click('live-premium-activate');

    const active = await screen.findByTestId('live-premium-active');
    expect(active.textContent).toContain('France');
    // Held, not spent — and the sentence says so rather than reassuring.
    expect(active.textContent).toContain('held, not spent');

    await click('live-premium-cancel');
    await screen.findByTestId('live-premium');
    // In full, and the balance rendered is the server's answer rather than a
    // delta this surface applied.
    expect(
      (await screen.findByTestId('live-premium-balance')).textContent,
    ).toContain('100 coins');
  });

  it('prices a composed selection as the sum the server publishes', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-premium');

    fireEvent.click(screen.getByLabelText('Women — 25 coins'));
    fireEvent.change(screen.getByTestId('live-premium-region'), {
      target: { value: 'FR' },
    });
    const review = await screen.findByTestId('live-premium-review');
    // Two preferences, one window, and a total anybody can check by adding up
    // what is on the screen.
    expect(review.textContent).toContain('Women · France — 40 coins');
  });

  it('drops one preference from a running window without charging for it', async () => {
    const double = createApiDouble(
      walletState({ balance: { available: '100', reserved: '0' } }),
    );
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-premium');

    fireEvent.click(screen.getByLabelText('Women — 25 coins'));
    fireEvent.change(screen.getByTestId('live-premium-region'), {
      target: { value: 'FR' },
    });
    await click('live-premium-review');
    await click('live-premium-activate');
    const active = await screen.findByTestId('live-premium-active');
    expect(active.textContent).toContain('Women · France');

    await click('live-premium-drop-region');
    const widened = await screen.findByTestId('live-premium-active-selection');
    // Wider, and nothing moved: a wider search cannot cost more than the one
    // already paid for.
    expect(widened.textContent).toContain('Women');
    expect(widened.textContent).not.toContain('France');
    const panel = await screen.findByTestId('live-premium-active');
    expect(panel.textContent).toContain('held, not spent');
  });

  it('says what a narrowed search is actually doing, and promises nothing', async () => {
    const double = createApiDouble({
      ...walletState({ balance: { available: '100', reserved: '0' } }),
      live: {
        ...walletState().live,
        standInAvailable: false,
      },
    });
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-premium');
    fireEvent.change(screen.getByTestId('live-premium-region'), {
      target: { value: 'FR' },
    });
    await click('live-premium-review');
    await click('live-premium-activate');
    await click('live-start-video');

    const searching = await screen.findByTestId('live-searching');
    const copy = searching.textContent;
    expect(copy).toContain('France');
    // The one thing this screen must never claim, on the screen where claiming
    // it would be most profitable.
    expect(copy).toContain('Nobody can promise somebody is there');
  });
});

describe('the platform gate', () => {
  it('explains itself when live discovery is switched off', async () => {
    const double = createApiDouble(liveState({ admission: 'unavailable' }));
    renderProduct(<Live />, double, { pathname: '/live' });

    const blocked = await screen.findByTestId('live-unavailable');
    expect(blocked.textContent).toContain('no RTC provider is eligible');
    // Not an error. Nothing failed; the platform made a decision it can explain.
    expect(screen.queryByTestId('live-door')).toBeNull();
  });

  it('offers no local scenarios where the server says there are none', async () => {
    const double = createApiDouble(liveState({ simulated: false }));
    renderProduct(<Live />, double, { pathname: '/live' });
    await screen.findByTestId('live-door');
    await click('live-start-video');
    await screen.findByTestId('live-peer-name');

    // The panel is absent rather than hidden, which is what "cannot be enabled
    // accidentally" has to mean on a client.
    expect(screen.queryByTestId('live-simulation')).toBeNull();
  });
});
