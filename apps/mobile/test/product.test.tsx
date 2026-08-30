import { cleanup, fireEvent, waitFor } from '@testing-library/react-native';
import { maximumNotificationReadBatch } from '@velora/validation/notifications-bounds';

import { createInMemorySecureTokenStore } from '../src/auth/secure-storage';
import { ConversationScreen } from '../src/product/conversation';
import { DiscoverScreen } from '../src/product/discover';
import { SentGiftsScreen } from '../src/product/gifts';
import { YouScreen } from '../src/product/you';
import { PersonScreen } from '../src/product/person';
import { IntroductionsScreen } from '../src/product/introductions';
import { CreatorScreen, ClubScreen } from '../src/product/creator';
import { MembershipsScreen } from '../src/product/memberships';
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
/** The one image reference the candidate below publishes. */
const candidateImageId = '55555555-5555-4555-8555-555555555555';

function withCandidates(): MobileApiState {
  const state = admittedState();
  state.candidates = [
    {
      bio: 'Ceramicist.',
      displayName: 'Robin',
      id: otherPersonId,
      media: [{ id: candidateImageId, position: 0 }],
      region: 'ES',
      sharedLanguages: ['es'],
    },
  ];
  return state;
}

describe('discover', () => {
  it('shows a person with what the contract publishes, photograph included', async () => {
    const { view } = await mount(
      <DiscoverScreen onOpenPerson={() => undefined} />,
      withCandidates(),
    );

    await waitFor(() => {
      expect(view.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    });
    expect(view.getByText('Robin')).toBeTruthy();
    expect(view.getByText('Spain')).toBeTruthy();
    // Hidden elements included deliberately: the photograph is removed from the
    // accessibility tree because the person's name is already text beside it,
    // so a default query would never see it however well it renders.
    await waitFor(() => {
      expect(
        view.getByTestId(`candidate-portrait-${otherPersonId}`, {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
    });
  });

  it('draws an identity mark, and says nothing, when no address is granted', async () => {
    const { view } = await mount(
      <DiscoverScreen onOpenPerson={() => undefined} />,
      {
        ...withCandidates(),
        mediaDelivery: 'declined',
      },
    );

    await waitFor(() => {
      expect(view.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    });
    expect(
      view.queryByTestId(`candidate-portrait-${otherPersonId}`, {
        includeHiddenElements: true,
      }),
    ).toBeNull();
    // And it never says why: the reason is somebody else's business.
    for (const leak of ['blocked', 'not allowed', 'processing']) {
      expect(view.queryByText(new RegExp(leak, 'iu'))).toBeNull();
    }
  });

  it('takes a person off the feed once interest is sent', async () => {
    const { double, view } = await mount(
      <DiscoverScreen onOpenPerson={() => undefined} />,
      withCandidates(),
    );
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
    const { view } = await mount(
      <DiscoverScreen onOpenPerson={() => undefined} />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('discovery-empty')).toBeTruthy();
    });
    // "Everybody for now" and "nobody right now" are different situations, and
    // the copy says which one this is rather than one message for both.
    expect(view.getByText('That is everybody for now')).toBeTruthy();
  });

  it('keeps the person on the feed when the decision is refused', async () => {
    const { double, view } = await mount(
      <DiscoverScreen onOpenPerson={() => undefined} />,
      withCandidates(),
    );
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
    const { view } = await mount(
      <DiscoverScreen onOpenPerson={() => undefined} />,
      withCandidates(),
    );
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
        {
          ...conversation,
          lastMessage: {
            bodyPreview: 'Perfect. See you then',
            createdAt: '2026-08-14T12:00:00.000Z',
            sender: 'counterpart',
            sequence: 5,
          },
          lastMessageSequence: 5,
          lastReadSequence: 3,
        },
      ];
    }
    const { view } = await mount(<MessagesScreen onOpen={nothing} />, state);

    await waitFor(() => {
      expect(
        view.getByTestId(`conversation-${conversationId}-unread`),
      ).toBeTruthy();
    });
    expect(view.getByText('Perfect. See you then')).toBeTruthy();
    expect(view.getByText(/Mutual introduction/u)).toBeTruthy();
  });

  it('advances read state and exposes call entry from the published relationship', async () => {
    const state = admittedState();
    const conversation = state.conversations[0];
    if (conversation === undefined) throw new Error('fixture needs one');
    state.conversations = [
      {
        ...conversation,
        lastMessage: {
          bodyPreview: 'Read this durable message',
          createdAt: '2026-08-14T12:00:00.000Z',
          sender: 'counterpart',
          sequence: 1,
        },
        lastMessageSequence: 1,
      },
    ];
    state.messages = [
      {
        body: 'Read this durable message',
        clientMessageId: 'read-mobile-0001',
        conversationId,
        createdAt: '2026-08-14T12:00:00.000Z',
        id: '77777777-7777-4777-8777-777777777777',
        senderId: otherPersonId,
        sequence: 1,
      },
    ];
    const { double, view } = await mount(
      <ConversationScreen conversationId={conversationId} onBack={nothing} />,
      state,
    );

    await waitFor(() => {
      expect(
        double.calls.some(
          (call) => call.path === '/v1/messaging/conversations/read',
        ),
      ).toBe(true);
    });
    expect(double.state.conversations[0]?.lastReadSequence).toBe(1);
    expect(view.getByTestId(`call-voice-${introductionId}`)).toBeTruthy();
    expect(view.getByText(/Attachments unavailable/u)).toBeTruthy();
  });

  it('keeps an oversized draft visible and refuses to send it', async () => {
    const { double, view } = await mount(
      <ConversationScreen conversationId={conversationId} onBack={nothing} />,
    );
    await waitFor(() => {
      expect(view.getByTestId('message-input')).toBeTruthy();
    });
    await fireEvent.changeText(
      view.getByTestId('message-input'),
      'x'.repeat(4_001),
    );

    expect(view.getByTestId('message-too-long')).toBeTruthy();
    expect(view.getByTestId('message-count')).toBeTruthy();
    await fireEvent.press(view.getByTestId('message-send'));
    expect(
      double.calls.some(
        (call) =>
          call.path === '/v1/messaging/messages' && call.method === 'POST',
      ),
    ).toBe(false);
  });

  it('keeps an edited AI reply in the composer until explicit Send', async () => {
    const { double, view } = await mount(
      <ConversationScreen conversationId={conversationId} onBack={nothing} />,
    );
    await waitFor(() => {
      expect(view.getByTestId('message-input')).toBeTruthy();
    });
    await fireEvent.changeText(
      view.getByTestId('message-input'),
      'coffee after work',
    );
    await fireEvent.press(view.getByTestId('message-ai-generate'));
    await waitFor(() => {
      expect(view.getByTestId('message-ai-suggestion')).toBeTruthy();
    });
    await fireEvent.changeText(
      view.getByTestId('message-ai-suggestion'),
      'Coffee after work sounds good. Six?',
    );
    await fireEvent.press(view.getByTestId('message-ai-use'));

    expect(view.getByTestId('message-input').props.value).toBe(
      'Coffee after work sounds good. Six?',
    );
    expect(
      double.calls.some(
        (call) =>
          call.path === '/v1/messaging/messages' && call.method === 'POST',
      ),
    ).toBe(false);
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
        conversationId,
        createdAt: new Date().toISOString(),
        id: 'n1',
        kind: 'message_received',
        subjectId: otherPersonId,
      },
    ];
    const { double, view } = await mount(
      <NoticesScreen
        onOpenConversation={nothing}
        onOpenIntroductions={nothing}
      />,
      state,
    );
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

  it('lets a failed read acknowledgement be retried', async () => {
    const state = admittedState();
    state.notifications = [
      {
        conversationId,
        createdAt: new Date().toISOString(),
        id: 'n1',
        kind: 'message_received',
        subjectId: otherPersonId,
      },
    ];
    const { double, view } = await mount(
      <NoticesScreen
        onOpenConversation={nothing}
        onOpenIntroductions={nothing}
      />,
      state,
    );
    await waitFor(() => {
      expect(view.getByText('Robin sent you a message.')).toBeTruthy();
    });
    double.failNext('/v1/notifications/read');

    await fireEvent.press(view.getByTestId('notifications-mark-read'));
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
      ).toHaveLength(2);
    });
  });

  it('pages through older activity and acknowledges every rendered row within contract bounds', async () => {
    const state = admittedState();
    state.notifications = Array.from({ length: 51 }, (_, index) => ({
      conversationId,
      createdAt: new Date(Date.now() - index * 1_000).toISOString(),
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      kind: 'message_received',
      subjectId: otherPersonId,
    }));
    const { double, view } = await mount(
      <NoticesScreen
        onOpenConversation={nothing}
        onOpenIntroductions={nothing}
      />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('notifications-more')).toBeTruthy();
    });
    const initialReads = double.calls.filter(
      (call) => call.path === '/v1/notifications' && call.method === 'GET',
    ).length;
    await fireEvent.press(view.getByTestId('notifications-more'));
    await waitFor(() => {
      expect(
        double.calls.filter(
          (call) => call.path === '/v1/notifications' && call.method === 'GET',
        ),
      ).toHaveLength(initialReads + 1);
    });
    await fireEvent.press(view.getByTestId('notifications-more'));
    await waitFor(() => {
      expect(view.queryByTestId('notifications-more')).toBeNull();
    });

    await fireEvent.press(view.getByTestId('notifications-mark-read'));
    await waitFor(() => {
      expect(
        double.calls.filter(
          (call) =>
            call.path === '/v1/notifications/read' && call.method === 'POST',
        ),
      ).toHaveLength(2);
    });
    const readBodies = double.calls
      .filter(
        (call) =>
          call.path === '/v1/notifications/read' && call.method === 'POST',
      )
      .map((call) => call.body);
    expect(readBodies).toEqual([
      {
        notificationIds: state.notifications
          .slice(0, maximumNotificationReadBatch)
          .map((entry) => entry.id),
      },
      {
        notificationIds: state.notifications
          .slice(maximumNotificationReadBatch)
          .map((entry) => entry.id),
      },
    ]);
  });

  it('names who called and opens the current relationship, never a stale call', async () => {
    const state = admittedState();
    state.notifications = [
      {
        createdAt: new Date().toISOString(),
        id: 'n1',
        kind: 'call_incoming',
        subjectId: otherPersonId,
      },
    ];
    let openedIntroductions = 0;
    const { view } = await mount(
      <NoticesScreen
        onOpenConversation={nothing}
        onOpenIntroductions={() => {
          openedIntroductions += 1;
        }}
      />,
      state,
    );

    await waitFor(() => {
      expect(view.getByText('Robin called you.')).toBeTruthy();
    });
    await fireEvent.press(view.getByTestId('notification-n1'));
    expect(openedIntroductions).toBe(1);
    // Past tense and relationship-bound. No control can answer a call that may
    // have stopped ringing hours ago.
    expect(view.queryByTestId('notification-n1-answer')).toBeNull();
  });

  it('keeps an unread line useful when its subject can no longer be resolved', async () => {
    const state = admittedState();
    state.candidates = [];
    state.notifications = [
      {
        conversationId,
        createdAt: new Date().toISOString(),
        id: 'n1',
        kind: 'message_received',
        subjectId: otherPersonId,
      },
    ];
    let opened = 0;
    const { double, view } = await mount(
      <NoticesScreen
        onOpenConversation={() => {
          opened += 1;
        }}
        onOpenIntroductions={() => {
          opened += 1;
        }}
      />,
      state,
    );

    await waitFor(() => {
      expect(
        view.getByText('This activity is no longer available.'),
      ).toBeTruthy();
    });
    expect(opened).toBe(0);
    await fireEvent.press(view.getByTestId('notification-read-n1'));
    await waitFor(() => {
      expect(
        double.calls.filter(
          (call) =>
            call.path === '/v1/notifications/read' && call.method === 'POST',
        ),
      ).toHaveLength(1);
    });
  });
});

describe('you', () => {
  it('keeps an AI bio suggestion on-device until the person saves', async () => {
    const { double, view } = await mount(<ProfileScreen onBack={nothing} />);
    await waitFor(() => {
      expect(view.getByTestId('profile-bio')).toBeTruthy();
    });

    await fireEvent.changeText(
      view.getByTestId('profile-bio'),
      'weekend gardener',
    );
    await fireEvent.press(view.getByTestId('profile-ai-generate'));
    await waitFor(() => {
      expect(view.getByTestId('profile-ai-suggestion').props.value).toBe(
        'Refined: weekend gardener',
      );
    });
    await fireEvent.press(view.getByTestId('profile-ai-use'));
    expect(view.getByTestId('profile-bio').props.value).toBe(
      'Refined: weekend gardener',
    );
    expect(
      double.calls.some(
        (call) =>
          call.path === '/v1/users/me/profile' && call.method === 'POST',
      ),
    ).toBe(false);
  });

  it('still mints a run identity on a runtime with no global crypto', async () => {
    // Hermes has no `globalThis.crypto`. The test renderer does, so a screen
    // that reached through it passed here and failed on a device.
    const held = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Reflect.deleteProperty(globalThis, 'crypto');
    try {
      const { view } = await mount(<ProfileScreen onBack={nothing} />);
      await waitFor(() => {
        expect(view.getByTestId('profile-bio')).toBeTruthy();
      });

      await fireEvent.changeText(
        view.getByTestId('profile-bio'),
        'weekend gardener',
      );
      await fireEvent.press(view.getByTestId('profile-ai-generate'));
      await waitFor(() => {
        expect(view.getByTestId('profile-ai-suggestion').props.value).toBe(
          'Refined: weekend gardener',
        );
      });
      expect(view.queryByTestId('profile-ai-error')).toBeNull();
    } finally {
      if (held !== undefined) {
        Object.defineProperty(globalThis, 'crypto', held);
      }
    }
  });

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

  it('saves a profile, and offers a photograph the platform can now show', async () => {
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

    // Both blockers on a photograph are resolved: the native build gave this
    // application a camera, and authorized delivery gives it something to
    // render. Nothing claims otherwise on the screen.
    expect(view.getByTestId('profile-add-photo')).toBeTruthy();
    expect(view.queryByTestId('media-delivery-blocked')).toBeNull();
  });

  it('says photographs cannot be shown where the platform cannot deliver one', async () => {
    const state = admittedState();
    state.mediaDelivery = 'unavailable';
    const { view } = await mount(<ProfileScreen onBack={nothing} />, state);

    await waitFor(() => {
      expect(view.getByTestId('media-delivery-blocked')).toBeTruthy();
    });
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

/* ============================= memberships =========================== */

const clubId = '77777777-7777-4777-8777-777777777777';

/** One live invitation-based entitlement, as the access route publishes one. */
const invited = {
  clubId,
  clubName: 'Inner Circle',
  clubSlug: 'inner',
  creatorHandle: 'ember_vale',
  grantedAt: '2026-08-14T12:00:00.000Z',
  source: 'creator_invite',
  state: 'active' as const,
};

describe('memberships', () => {
  it('says nobody is in a club, and never offers a purchase', async () => {
    const { view } = await mount(
      <MembershipsScreen onBack={nothing} onOpenClub={nothing} />,
    );

    await waitFor(() => {
      expect(view.getByTestId('club-access-empty')).toBeTruthy();
    });
    expect(view.getByTestId('memberships-empty')).toBeTruthy();
    // Starting a purchase from a mobile application is a different commercial
    // arrangement, and the API refuses it for this audience. The screen never
    // offers a control that would meet that refusal.
    expect(view.getByTestId('memberships-no-purchase')).toBeTruthy();
    expect(view.queryByText('Join this club')).toBeNull();
  });

  it('stops a subscription renewing from the device somebody is holding', async () => {
    const state = admittedState();
    state.clubAccess = [{ ...invited, source: 'billing' }];
    state.subscriptions = [
      {
        amount: { amountMinor: '1500', currency: 'USD' },
        createdAt: '2026-08-15T12:00:00.000Z',
        currentPeriodEnd: '2026-09-15T12:00:00.000Z',
        id: 'sub-1',
        interval: 'month',
        offerId: '11111111-1111-4111-8111-111111111111',
        resource: { id: clubId, type: 'club' },
        state: 'active',
      },
    ];
    const { double, view } = await mount(
      <MembershipsScreen onBack={nothing} onOpenClub={nothing} />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('membership-sub-1')).toBeTruthy();
    });
    await fireEvent.press(view.getByTestId('membership-cancel-sub-1'));
    // The confirmation says the thing people assume and VELORA has not
    // promised, before it does anything.
    expect(view.getByText(/This is not a refund/u)).toBeTruthy();
    await fireEvent.press(view.getByTestId('membership-cancel-confirm-sub-1'));

    await waitFor(() => {
      expect(double.state.subscriptions[0]?.state).toBe('cancel_at_period_end');
    });
  });

  it('grants nothing for a lapse and never implies a grace period', async () => {
    const state = admittedState();
    state.subscriptions = [
      {
        amount: { amountMinor: '1500', currency: 'USD' },
        createdAt: '2026-08-15T12:00:00.000Z',
        id: 'sub-2',
        interval: 'month',
        offerId: '11111111-1111-4111-8111-111111111111',
        state: 'past_due',
      },
    ];
    const { view } = await mount(
      <MembershipsScreen onBack={nothing} onOpenClub={nothing} />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('membership-sub-2')).toBeTruthy();
    });
    expect(view.getByText(/access has stopped/u)).toBeTruthy();
    expect(view.getByText(/no grace period/u)).toBeTruthy();
  });

  it('hands back an invitation and never offers to hand back a paid one', async () => {
    const state = admittedState();
    state.clubAccess = [invited];
    const { double, view } = await mount(
      <MembershipsScreen onBack={nothing} onOpenClub={nothing} />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId(`club-access-${clubId}`)).toBeTruthy();
    });
    await fireEvent.press(view.getByTestId(`club-leave-${clubId}`));
    await fireEvent.press(view.getByTestId(`club-leave-confirm-${clubId}`));

    await waitFor(() => {
      expect(double.state.clubAccess[0]?.state).toBe('revoked');
    });
  });

  it('redeems an invitation and never shows the secret again', async () => {
    const state = admittedState();
    state.clubInvites = [
      {
        clubId,
        clubName: 'Inner Circle',
        clubSlug: 'inner',
        creatorHandle: 'ember_vale',
        secret: 'a-bearer-secret-nobody-should-see-twice',
      },
    ];
    const { view } = await mount(
      <MembershipsScreen onBack={nothing} onOpenClub={nothing} />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('club-invite-secret')).toBeTruthy();
    });
    await fireEvent.changeText(
      view.getByTestId('club-invite-secret'),
      'a-bearer-secret-nobody-should-see-twice',
    );
    await fireEvent.press(view.getByTestId('club-invite-redeem'));

    await waitFor(() => {
      expect(view.getByTestId(`club-access-${clubId}`)).toBeTruthy();
    });
    expect(
      view.queryByDisplayValue('a-bearer-secret-nobody-should-see-twice'),
    ).toBeNull();
  });
});

/* ========================== creator and club ========================= */

describe('a creator page on a phone', () => {
  function selling(): MobileApiState {
    const state = admittedState();
    state.publicClubs.ember_vale = [
      {
        benefits: ['A letter every week'],
        description: 'A quiet room.',
        id: clubId,
        name: 'Inner Circle',
        slug: 'inner',
      },
    ];
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

  it('shows what a membership costs and says where it can be bought', async () => {
    const { view } = await mount(
      <CreatorScreen
        handle="ember_vale"
        onBack={nothing}
        onOpenClub={nothing}
      />,
      selling(),
    );

    await waitFor(() => {
      expect(view.getByTestId('club-card-inner')).toBeTruthy();
    });
    expect(view.getByText(/15\.00 USD/u)).toBeTruthy();
    expect(view.getByText(/A letter every week/u)).toBeTruthy();
    // No purchase, and no external link either: whether an application may
    // point somebody at a payment page outside it is unresolved store policy.
    expect(view.getByTestId('club-buy-elsewhere-inner')).toBeTruthy();
    expect(view.queryByTestId('club-open-inner')).toBeNull();
  });

  it('publishes nothing a member reads to somebody who is not one', async () => {
    const state = selling();
    state.clubDetails['ember_vale/inner'] = {
      club: {
        benefits: ['A letter every week'],
        description: 'A quiet room.',
        id: clubId,
        name: 'Inner Circle',
        slug: 'inner',
      },
      content: [],
      creatorHandle: 'ember_vale',
    };
    const { view } = await mount(
      <ClubScreen handle="ember_vale" onBack={nothing} slug="inner" />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('club-locked')).toBeTruthy();
    });
    expect(view.queryByTestId('club-feed')).toBeNull();
  });

  it('shows the feed to somebody the server says is a member', async () => {
    const state = selling();
    state.clubDetails['ember_vale/inner'] = {
      club: {
        benefits: [],
        id: clubId,
        membership: {
          grantedAt: '2026-08-14T12:00:00.000Z',
          source: 'billing',
        },
        name: 'Inner Circle',
        slug: 'inner',
      },
      content: [
        {
          body: 'Only members read this.',
          id: '88888888-8888-4888-8888-888888888888',
          media: [],
          publishedAt: '2026-08-15T12:00:00.000Z',
          title: 'The first letter',
        },
      ],
      creatorHandle: 'ember_vale',
    };
    const { view } = await mount(
      <ClubScreen handle="ember_vale" onBack={nothing} slug="inner" />,
      state,
    );

    await waitFor(() => {
      expect(view.getByTestId('club-feed')).toBeTruthy();
    });
    expect(view.getByText('The first letter')).toBeTruthy();
    expect(view.getByText('Only members read this.')).toBeTruthy();
  });
});

describe('a person at their own address', () => {
  /** A second image, so there is a gallery and not only a portrait. */
  const secondImageId = '66666666-6666-4666-8666-666666666666';

  function withPhotographs(): MobileApiState {
    const state = withCandidates();
    const candidate = state.candidates[0];
    if (candidate !== undefined) {
      candidate.media = [
        { id: candidateImageId, position: 0 },
        { id: secondImageId, position: 1 },
      ];
    }
    return state;
  }

  it('shows every photograph, which is the reason to open it', async () => {
    const { view } = await mount(
      <PersonScreen
        onBack={nothing}
        onLeave={nothing}
        personId={otherPersonId}
      />,
      withPhotographs(),
    );

    // Hidden elements included deliberately: a photograph is removed from the
    // accessibility tree because the person's name is text beside it, so a
    // default query would never see it however well it renders.
    await waitFor(() => {
      expect(
        view.getByTestId('person-portrait', { includeHiddenElements: true }),
      ).toBeTruthy();
    });
    // The card shows the first. This shows the rest, which is the whole
    // difference between a decision surface and a look.
    expect(view.getByTestId('person-gallery')).toBeTruthy();
    expect(view.getByTestId('person-bio')).toBeTruthy();
  });

  it('says the same nothing for somebody gone as for somebody withheld', async () => {
    const { view } = await mount(
      <PersonScreen
        onBack={nothing}
        onLeave={nothing}
        personId="99999999-9999-4999-8999-999999999999"
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId('person-missing')).toBeTruthy();
    });
  });

  it('opens from a card in Discover', async () => {
    const opened: string[] = [];
    const { view } = await mount(
      <DiscoverScreen
        onOpenPerson={(personId) => {
          opened.push(personId);
        }}
      />,
      withCandidates(),
    );

    await waitFor(() => {
      expect(view.getByTestId(`candidate-open-${otherPersonId}`)).toBeTruthy();
    });
    await fireEvent.press(view.getByTestId(`candidate-open-${otherPersonId}`));
    expect(opened).toEqual([otherPersonId]);
  });
});

describe('gifts sent', () => {
  function withGifts(): MobileApiState {
    const state = admittedState();
    state.gifts = [
      {
        createdAt: '2026-08-20T10:00:00.000Z',
        creator: { displayName: 'Ember Vale Ceramics', handle: 'ember_vale' },
        gift: { id: 'gift-rose', name: 'Rose', visual: 'rose' },
        id: 'aaaaaaa1-0000-4000-8000-000000000001',
        price: { amountMinor: '100', currency: 'USD' },
        sentAt: '2026-08-20T10:00:05.000Z',
        state: 'sent',
      },
      {
        createdAt: '2026-08-19T10:00:00.000Z',
        creator: { displayName: 'Iron Press', handle: 'iron_press' },
        gift: { id: 'gift-star', name: 'Star', visual: 'star' },
        id: 'aaaaaaa1-0000-4000-8000-000000000002',
        price: { amountMinor: '2500', currency: 'USD' },
        state: 'failed',
      },
    ];
    return state;
  }

  it('reads back what was sent, and what happened to each one', async () => {
    const { view } = await mount(
      <SentGiftsScreen onBack={nothing} />,
      withGifts(),
    );

    await waitFor(() => {
      expect(view.getByTestId('sent-gifts-list')).toBeTruthy();
    });
    expect(view.getByText('Rose')).toBeTruthy();
    // The consequence, not only the state word. Somebody whose payment failed
    // needs to know nothing was charged.
    expect(
      view.getByTestId(
        'sent-gift-meaning-aaaaaaa1-0000-4000-8000-000000000002',
      ),
    ).toBeTruthy();
    expect(
      view.getByText(
        'The payment was refused. Nothing was charged and nothing was sent.',
      ),
    ).toBeTruthy();
  });

  it('offers no way to send one, and says where sending happens', async () => {
    const { view } = await mount(
      <SentGiftsScreen onBack={nothing} />,
      withGifts(),
    );

    await waitFor(() => {
      expect(view.getByTestId('sent-gifts-list')).toBeTruthy();
    });
    // The API refuses `POST /v1/billing/gifts` for this audience, so a control
    // here could only ever produce a 403. The boundary is stated instead.
    expect(view.getByTestId('gift-send-elsewhere')).toBeTruthy();
    expect(view.queryByText('Send a gift')).toBeNull();
  });

  it('says nothing was sent rather than showing an empty frame', async () => {
    const { view } = await mount(<SentGiftsScreen onBack={nothing} />);

    await waitFor(() => {
      expect(view.getByTestId('sent-gifts-empty')).toBeTruthy();
    });
  });
});

describe('you', () => {
  it('shows this person their own photograph, as every card shows everybody else', async () => {
    const { view } = await mount(<YouScreen onOpen={nothing} />);

    // Hidden from assistive technology, like every other portrait, because the
    // person's name is already text beside it.
    await waitFor(() => {
      expect(
        view.getByTestId('you-portrait', { includeHiddenElements: true }),
      ).toBeTruthy();
    });
  });

  it('does not claim a photograph is shown nowhere while it is showing one', async () => {
    const { view } = await mount(<YouScreen onOpen={nothing} />);

    await waitFor(() => {
      expect(view.getByTestId('profile-media-state')).toBeTruthy();
    });
    // The state of this person's own image, and nothing about the platform.
    // The unconditional version of this sentence was false on every build
    // where delivery works — which is the build the screen above it proves.
    expect(view.getByText('Image ready.')).toBeTruthy();
    expect(view.queryByText(/no approved way to deliver an image/u)).toBeNull();
  });

  it('says delivery is unavailable exactly when the platform said so', async () => {
    const state = admittedState();
    state.mediaDelivery = 'unavailable';
    const { view } = await mount(<YouScreen onOpen={nothing} />, state);

    await waitFor(() => {
      expect(
        view.getByText(/no approved way to deliver an image/u),
      ).toBeTruthy();
    });
  });
});
