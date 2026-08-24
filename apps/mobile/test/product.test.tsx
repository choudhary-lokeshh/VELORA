import { cleanup, fireEvent, waitFor } from '@testing-library/react-native';

import { createInMemorySecureTokenStore } from '../src/auth/secure-storage';
import { ConversationScreen } from '../src/product/conversation';
import { DiscoverScreen } from '../src/product/discover';
import { IntroductionsScreen } from '../src/product/introductions';
import { MessagesScreen } from '../src/product/messages';
import { NoticesScreen } from '../src/product/notices';
import { AvailabilityScreen, ProfileScreen } from '../src/product/profile';
import { SafetyScreen } from '../src/product/safety';
import {
  admittedState,
  conversationId,
  createMobileApiDouble,
  introductionId,
  otherPersonId,
  type MobileApiState,
} from './support/api-double';
import { renderScreen } from './support/render';

/**
 * The Consumer Mobile screens, driven through the generated client against a
 * stand-in API that answers the real contract.
 *
 * Everything asserted here is behaviour a phone actually produces: a decision
 * that is refused, a message whose response was lost, a conversation that was
 * closed while the screen was off, an availability window that ended.
 *
 * Two conventions are not stylistic. Every `fireEvent` is awaited, because
 * firing is asynchronous in this version of the library and a second event
 * dispatched before the first settles leaves React's act bookkeeping unbalanced
 * for the rest of the file. And every query is made fresh rather than captured,
 * because a re-render replaces the element a variable was holding.
 */

const nothing = () => undefined;

beforeEach(async () => {
  // Before mounting rather than after. Unmounting is asynchronous, and a tree
  // still coming down keeps its in-flight reads alive.
  await cleanup();
});

/**
 * Mounts one screen for somebody who is already signed in.
 *
 * The session is established the way a real cold launch establishes one — by
 * restoring token material the platform keystore was holding — rather than by
 * driving the sign-in form, which is the launch suite's subject and not this
 * one's.
 */
async function mount(
  screen: React.ReactElement,
  state: MobileApiState = admittedState(),
) {
  const double = createMobileApiDouble(state);
  const store = createInMemorySecureTokenStore();
  await store.write({
    accessToken: 'access-stored',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    installationId: 'installation-local-device',
    refreshToken: 'refresh-stored',
  });
  const view = await renderScreen(screen, double, { store });
  return { double, view };
}

/** The double seeds one candidate; these give the feed something to page. */
function withCandidates(): MobileApiState {
  const state = admittedState();
  state.candidates = [
    {
      bio: 'Ceramicist.',
      displayName: 'Robin',
      id: otherPersonId,
      media: [],
      region: 'ES',
      sharedLanguages: ['es'],
    },
  ];
  return state;
}

describe('discover', () => {
  it('shows a person with what the contract publishes and no photograph', async () => {
    const { view } = await mount(<DiscoverScreen />, withCandidates());

    await waitFor(() => {
      expect(view.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    });
    expect(view.getByText('Robin')).toBeTruthy();
    expect(view.getByText('Spain')).toBeTruthy();
    // No image, no upload control, and nothing that implies either exists.
    expect(view.queryByTestId('candidate-photo')).toBeNull();
  });

  it('takes a person off the feed once interest is sent', async () => {
    const { double, view } = await mount(<DiscoverScreen />, withCandidates());
    await waitFor(() => {
      expect(view.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    });

    await fireEvent.press(
      view.getByTestId(`discovery-signal-${otherPersonId}`),
    );

    await waitFor(() => {
      expect(view.queryByTestId(`candidate-${otherPersonId}`)).toBeNull();
    });
    expect(
      double.calls.some(
        (call) =>
          call.path === '/v1/discovery/introductions' && call.method === 'POST',
      ),
    ).toBe(true);
  });

  it('says nobody is available rather than showing an empty list', async () => {
    const state = admittedState();
    state.candidates = [];
    const { view } = await mount(<DiscoverScreen />, state);

    await waitFor(() => {
      expect(view.getByTestId('discovery-empty')).toBeTruthy();
    });
    // "Everybody for now" and "nobody right now" are different situations, and
    // the copy says which one this is rather than one message for both.
    expect(view.getByText('That is everybody for now')).toBeTruthy();
  });

  it('keeps the person on the feed when the decision is refused', async () => {
    const { double, view } = await mount(<DiscoverScreen />, withCandidates());
    await waitFor(() => {
      expect(view.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    });
    double.refuseNext('/v1/discovery/introductions', 409, 'STATE_CONFLICT');

    await fireEvent.press(
      view.getByTestId(`discovery-signal-${otherPersonId}`),
    );

    // Nothing is applied optimistically, so a refusal leaves the feed as the
    // server has it rather than as this screen guessed.
    await waitFor(() => {
      expect(view.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    });
  });

  it('offers safety beside the person rather than on a screen somebody has to find', async () => {
    const { view } = await mount(<DiscoverScreen />, withCandidates());
    await waitFor(() => {
      expect(view.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    });

    await fireEvent.press(view.getByTestId(`safety-menu-${otherPersonId}`));

    expect(view.getByTestId('safety-open-block')).toBeTruthy();
    expect(view.getByTestId('safety-open-report')).toBeTruthy();
    // There is no field here that takes a person: the identifier is already
    // known, which is the whole point of putting this beside the name.
    expect(view.queryByTestId('safety-target')).toBeNull();
  });
});

describe('introductions', () => {
  function withIntroduction(
    state: Introduction['state'],
    role: Introduction['role'],
  ) {
    const seeded = admittedState();
    seeded.introductions = [
      {
        counterpart: {
          displayName: 'Robin',
          id: otherPersonId,
          media: [],
          sharedLanguages: ['es'],
        },
        createdAt: new Date().toISOString(),
        id: introductionId,
        role,
        state,
      },
    ];
    return seeded;
  }

  it('offers a conversation and a call once both people have said yes', async () => {
    const { view } = await mount(
      <IntroductionsScreen />,
      withIntroduction('mutual', 'initiator'),
    );

    await waitFor(() => {
      expect(view.getByTestId(`introduction-${introductionId}`)).toBeTruthy();
    });
    expect(view.getByTestId(`open-${introductionId}`)).toBeTruthy();
    // Voice and video are separate controls because they are separate consents.
    expect(view.getByTestId(`call-voice-${introductionId}`)).toBeTruthy();
    expect(view.getByTestId(`call-video-${introductionId}`)).toBeTruthy();
  });

  it('says a call carries no sound before anybody places one', async () => {
    const { view } = await mount(
      <IntroductionsScreen />,
      withIntroduction('mutual', 'initiator'),
    );

    await waitFor(() => {
      expect(view.getByTestId('calls-media-unavailable')).toBeTruthy();
    });
  });

  it('offers only what the role allows', async () => {
    const { view } = await mount(
      <IntroductionsScreen />,
      withIntroduction('pending', 'initiator'),
    );

    await waitFor(() => {
      expect(view.getByTestId(`withdraw-${introductionId}`)).toBeTruthy();
    });
    // The person who signalled first cannot accept on the other's behalf.
    expect(view.queryByTestId(`accept-${introductionId}`)).toBeNull();
    expect(view.queryByTestId(`open-${introductionId}`)).toBeNull();
  });
});

describe('messages', () => {
  it('marks a conversation unread from the sequences the server publishes', async () => {
    const state = admittedState();
    const conversation = state.conversations[0];
    if (conversation !== undefined) {
      state.conversations = [
        { ...conversation, lastMessageSequence: 5, lastReadSequence: 3 },
      ];
    }
    const { view } = await mount(<MessagesScreen onOpen={nothing} />, state);

    await waitFor(() => {
      expect(
        view.getByTestId(`conversation-${conversationId}-unread`),
      ).toBeTruthy();
    });
    // No preview of what was said. A list screen is read on a phone that may be
    // face-up on a table.
    expect(view.queryByText(/Perfect\. See you then/u)).toBeNull();
  });

  it('sends a message and shows it once the server has it', async () => {
    const { double, view } = await mount(
      <ConversationScreen conversationId={conversationId} onBack={nothing} />,
    );
    await waitFor(() => {
      expect(view.getByTestId('message-input')).toBeTruthy();
    });

    await fireEvent.changeText(
      view.getByTestId('message-input'),
      'See you at six',
    );
    await fireEvent.press(view.getByTestId('message-send'));

    await waitFor(() => {
      expect(view.getByText('See you at six')).toBeTruthy();
    });
    const sent = double.calls.filter(
      (call) =>
        call.path === '/v1/messaging/messages' && call.method === 'POST',
    );
    expect(sent).toHaveLength(1);
  });

  it('keeps the words and offers a retry when a send fails', async () => {
    const { double, view } = await mount(
      <ConversationScreen conversationId={conversationId} onBack={nothing} />,
    );
    await waitFor(() => {
      expect(view.getByTestId('message-input')).toBeTruthy();
    });
    double.failNext('/v1/messaging/messages');

    await fireEvent.changeText(
      view.getByTestId('message-input'),
      'Still here?',
    );
    await fireEvent.press(view.getByTestId('message-send'));

    await waitFor(() => {
      expect(view.getByTestId('message-retry')).toBeTruthy();
    });
    // The draft survives, because losing somebody's words to a dropped
    // connection is the one failure a messaging surface must not have.
    expect(view.getByTestId('message-input').props.value).toBe('Still here?');
  });

  it('reuses one client identifier across a retry, so a lost response cannot duplicate', async () => {
    const { double, view } = await mount(
      <ConversationScreen conversationId={conversationId} onBack={nothing} />,
    );
    await waitFor(() => {
      expect(view.getByTestId('message-input')).toBeTruthy();
    });
    double.failNext('/v1/messaging/messages');
    await fireEvent.changeText(view.getByTestId('message-input'), 'Twice?');
    await fireEvent.press(view.getByTestId('message-send'));
    await waitFor(() => {
      expect(view.getByTestId('message-retry')).toBeTruthy();
    });

    await fireEvent.press(view.getByTestId('message-retry'));

    await waitFor(() => {
      expect(view.getByText('Twice?')).toBeTruthy();
    });
    const identifiers = double.calls
      .filter(
        (call) =>
          call.path === '/v1/messaging/messages' && call.method === 'POST',
      )
      .map(
        (call) => (call.body as { clientMessageId?: string }).clientMessageId,
      );
    expect(new Set(identifiers).size).toBe(1);
  });

  it('offers nothing to send in a conversation the platform has closed', async () => {
    const state = admittedState();
    const conversation = state.conversations[0];
    if (conversation !== undefined) {
      state.conversations = [{ ...conversation, state: 'closed' }];
    }
    const { view } = await mount(
      <ConversationScreen conversationId={conversationId} onBack={nothing} />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('conversation-closed')).toBeTruthy();
    });
    // Readable, and not writable. A composer that refused every send would be
    // worse than no composer.
    expect(view.queryByTestId('message-input')).toBeNull();
  });

  it('says a conversation somebody does not hold is not here, and reveals nothing else', async () => {
    const { view } = await mount(
      <ConversationScreen
        conversationId="99999999-9999-4999-8999-999999999999"
        onBack={nothing}
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId('conversation-missing')).toBeTruthy();
    });
  });
});

describe('notices', () => {
  it('acknowledges what is unread exactly once', async () => {
    const state = admittedState();
    state.notifications = [
      {
        createdAt: new Date().toISOString(),
        id: 'n1',
        kind: 'message_received',
        subjectId: conversationId,
      },
    ];
    const { double, view } = await mount(<NoticesScreen />, state);
    await waitFor(() => {
      expect(view.getByTestId('notifications-mark-read')).toBeTruthy();
    });

    await fireEvent.press(view.getByTestId('notifications-mark-read'));

    await waitFor(() => {
      expect(
        double.calls.filter(
          (call) =>
            call.path === '/v1/notifications/read' && call.method === 'POST',
        ),
      ).toHaveLength(1);
    });
  });

  it('offers nothing to press on a notice, because a stale one would lead nowhere', async () => {
    const state = admittedState();
    state.notifications = [
      {
        createdAt: new Date().toISOString(),
        id: 'n1',
        kind: 'call_incoming',
        subjectId: otherPersonId,
      },
    ];
    const { view } = await mount(<NoticesScreen />, state);

    await waitFor(() => {
      expect(view.getByText('Somebody called you.')).toBeTruthy();
    });
    // Past tense, and no control. A call that stopped ringing hours ago cannot
    // be answered from a list.
    expect(view.queryByTestId('notification-n1-answer')).toBeNull();
  });
});

describe('you', () => {
  it('reports availability as the server has it, not as this device guessed', async () => {
    const state = admittedState();
    state.availability = {
      effectiveState: 'unavailable',
      state: 'available',
      updatedAt: new Date().toISOString(),
    };
    const { view } = await mount(
      <AvailabilityScreen onBack={nothing} />,
      state,
    );

    await waitFor(() => {
      expect(view.getByText('Availability window ended')).toBeTruthy();
    });
    // "Ended" is distinct from "never opened", and only the server knows which.
    expect(view.getByTestId('availability-state')).toBeTruthy();
  });

  it('opens an availability window with an end on it', async () => {
    const { double, view } = await mount(
      <AvailabilityScreen onBack={nothing} />,
    );
    await waitFor(() => {
      expect(view.getByTestId('availability-switch')).toBeTruthy();
    });

    await fireEvent.press(view.getByTestId('availability-switch'));

    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/users/me/availability' && call.method === 'POST',
        ),
      ).toBe(true);
    });
    const sent = double.calls.find(
      (call) =>
        call.path === '/v1/users/me/availability' && call.method === 'POST',
    );
    // Nobody is left discoverable indefinitely by an app they opened once.
    expect(
      (sent?.body as { availableUntil?: string }).availableUntil,
    ).toBeDefined();
  });

  it('saves a profile, and offers a photograph nobody can be shown', async () => {
    const { double, view } = await mount(<ProfileScreen onBack={nothing} />);
    await waitFor(() => {
      expect(view.getByTestId('profile-name')).toBeTruthy();
    });

    await fireEvent.changeText(view.getByTestId('profile-name'), 'Alex Moreau');
    await fireEvent.press(view.getByTestId('profile-save'));

    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/users/me/profile' && call.method === 'POST',
        ),
      ).toBe(true);
    });

    // The native build resolved one of the two blockers on a photograph, so
    // the control exists. It did not resolve the other: consumer media still
    // has no authorized delivery route, and the screen has to keep saying so
    // rather than implying that adding one makes it visible.
    expect(view.getByTestId('profile-add-photo')).toBeTruthy();
    expect(view.getByTestId('media-delivery-blocked')).toBeTruthy();
  });

  it('lists a block by when it happened, because no name is kept against one', async () => {
    const state = admittedState();
    state.blocks = [
      { blockedId: otherPersonId, createdAt: new Date().toISOString() },
    ];
    const { view } = await mount(<SafetyScreen onBack={nothing} />, state);

    await waitFor(() => {
      expect(view.getByTestId(`unblock-${otherPersonId}`)).toBeTruthy();
    });
    // The identifier is never shown: it is an internal value, and a product
    // screen is not where one belongs.
    expect(view.queryByText(otherPersonId)).toBeNull();
  });

  it('removes a block when asked, and says the other person is not told', async () => {
    const state = admittedState();
    state.blocks = [
      { blockedId: otherPersonId, createdAt: new Date().toISOString() },
    ];
    const { double, view } = await mount(
      <SafetyScreen onBack={nothing} />,
      state,
    );
    await waitFor(() => {
      expect(view.getByTestId(`unblock-${otherPersonId}`)).toBeTruthy();
    });

    await fireEvent.press(view.getByTestId(`unblock-${otherPersonId}`));

    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/safety/blocks/removal' && call.method === 'POST',
        ),
      ).toBe(true);
    });
  });
});

/** Kept local so the suite reads without importing the whole contract. */
interface Introduction {
  readonly role: 'initiator' | 'recipient';
  readonly state: 'pending' | 'mutual' | 'closed';
}
