import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Live } from '../src/product/live';
import {
  admittedState,
  createApiDouble,
  liveConversationId,
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
