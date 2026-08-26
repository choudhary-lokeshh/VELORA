import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppGate, PublicGate, WelcomeGate } from '../src/app/gate';
import { AppShell } from '../src/app/shell';
import { ToastProvider, VeloraProviders } from '../src/app/providers';
import {
  ConversationThread,
  MessagesLayout,
} from '../src/product/conversations';
import { Discover } from '../src/product/discover';
import { PersonPage } from '../src/product/person';
import { Discovery } from '../src/product/discovery';
import { Introductions } from '../src/product/introductions';
import { Memberships } from '../src/product/memberships';
import { Notifications } from '../src/product/notifications';
import { Welcome } from '../src/product/onboarding';
import { You } from '../src/product/profile';
import { Safety } from '../src/product/safety';
import { Settings } from '../src/product/settings';
import { SignIn } from '../src/product/sign-in';
import {
  admittedState,
  createApiDouble,
  emptyState,
  otherPersonId,
  ownAccountId,
  type ApiDouble,
  type ApiDoubleState,
} from './support/api-double';
import { navigations, resetNavigation } from './support/navigation';
import { renderProduct, testApiBaseUrl } from './support/render';

/**
 * The Consumer Web product, driven through the generated client against a
 * stand-in API that answers the real contract.
 *
 * Nothing here reaches inside a component. Every assertion is about what
 * somebody using the surface would see and do, and every answer the surface gets
 * is one the server could actually give — which is what makes a passing test
 * evidence about the product rather than about the test's own mocks.
 *
 * Keyboard order, focus rings, real navigation, and layout at a given width are
 * proved in Playwright rather than here. A real browser is the only place any of
 * them is real; asserting them against jsdom would be asserting jsdom.
 */

// Vitest runs without global test APIs, so the automatic teardown React Testing
// Library installs when it can see them is registered here instead.
afterEach(cleanup);

async function click(testId: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(testId));
}

async function type(label: string | RegExp, value: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
}

function textOf(testId: string): string | null {
  return screen.getByTestId(testId).textContent;
}

/* ============================== session ============================== */

describe('session', () => {
  it('offers nothing to press until the session check has answered', async () => {
    const double = createApiDouble(emptyState());
    let release: (() => void) | undefined;
    const held = new Promise<void>((settle) => {
      release = () => {
        settle();
      };
    });
    resetNavigation('/sign-in');
    render(
      <ToastProvider>
        <VeloraProviders
          apiBaseUrl={testApiBaseUrl}
          fetchImplementation={async (input, init) => {
            const target =
              input instanceof Request
                ? input.url
                : input instanceof URL
                  ? input.href
                  : input;
            if (target.includes('/v1/auth/session')) await held;
            return double.fetch(input, init);
          }}
        >
          <PublicGate>
            <SignIn />
          </PublicGate>
        </VeloraProviders>
      </ToastProvider>,
    );

    // The page is deliverable before anybody knows whose it is, so a sign-in
    // form in that window is visible and pressable while nothing is listening
    // yet. A press landing there is discarded silently.
    expect(screen.getByTestId('bootstrap')).toBeTruthy();
    expect(screen.queryByTestId('auth-sign-in')).toBeNull();

    release?.();
    await screen.findByTestId('auth-sign-in');
  });

  it('signs somebody in and moves them into the product', async () => {
    const double = createApiDouble(emptyState());
    renderProduct(
      <PublicGate>
        <SignIn />
      </PublicGate>,
      double,
      { pathname: '/sign-in' },
    );

    await type('Development identity', 'person@velora.test');
    await click('auth-sign-in');

    await waitFor(() => {
      expect(navigations().some((entry) => entry.path === '/discover')).toBe(
        true,
      );
    });
  });

  it('refuses to submit an empty identity rather than sending one', async () => {
    const double = createApiDouble(emptyState());
    renderProduct(
      <PublicGate>
        <SignIn />
      </PublicGate>,
      double,
      { pathname: '/sign-in' },
    );

    await click('auth-sign-in');
    await screen.findByText('Enter an address to continue.');
    expect(
      double.calls.some((call) => call.path === '/v1/auth/local/web-sessions'),
    ).toBe(false);
  });

  it('reports an unreachable service rather than claiming the person is signed out', async () => {
    const double = createApiDouble(admittedState());
    double.failNext('/v1/auth/session', 'GET');
    renderProduct(
      <PublicGate>
        <SignIn />
      </PublicGate>,
      double,
      { pathname: '/sign-in' },
    );

    await screen.findByTestId('auth-unavailable');
    expect(screen.queryByTestId('auth-cause')).toBeNull();
  });

  it('sends somebody without a session to sign in, carrying where they were going', async () => {
    const double = createApiDouble(emptyState());
    renderProduct(
      <AppGate title="Discover">
        <Discovery />
      </AppGate>,
      double,
      { pathname: '/messages/abc' },
    );

    await waitFor(() => {
      expect(
        navigations().some(
          (entry) => entry.path === '/sign-in?next=%2Fmessages%2Fabc',
        ),
      ).toBe(true);
    });
    expect(screen.queryByTestId('discovery-candidates')).toBeNull();
  });

  it('sends an unadmitted account to the admission ladder', async () => {
    const double = createApiDouble({
      ...emptyState(),
      session: admittedState().session,
    });
    renderProduct(
      <AppGate title="Discover">
        <Discovery />
      </AppGate>,
      double,
      { pathname: '/discover' },
    );

    await waitFor(() => {
      expect(navigations().some((entry) => entry.path === '/welcome')).toBe(
        true,
      );
    });
  });

  it('ends the session and stops showing the product', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Settings />, double, { pathname: '/you/settings' });

    await click('auth-sign-out');
    await waitFor(() => {
      expect(double.state.session).toBeNull();
    });
  });

  it('treats a session that ended elsewhere as ended, on its next question', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(
      <AppGate title="Discover">
        <Discovery />
      </AppGate>,
      double,
      { pathname: '/discover' },
    );
    await screen.findByTestId('discovery-candidates');

    double.state.session = null;
    fireEvent(window, new Event('focus'));

    await waitFor(() => {
      expect(
        navigations().some((entry) => entry.path.startsWith('/sign-in')),
      ).toBe(true);
    });
  });
});

/* ============================= admission ============================= */

describe('admission', () => {
  it('walks a new person through the ladder the server publishes', async () => {
    const double = createApiDouble({
      ...emptyState(),
      session: admittedState().session,
    });
    renderProduct(
      <WelcomeGate>
        <Welcome />
      </WelcomeGate>,
      double,
      { pathname: '/welcome' },
    );

    await click('create-account');

    await screen.findByTestId('declare-adult');
    // A declaration, said to be a declaration. Nothing here calls it verified.
    expect(screen.getByText(/not an identity or age check/)).toBeTruthy();
    await type('Where you are', 'ES');
    await click('declare-adult');

    await screen.findByTestId('acknowledge-policies');
    expect(textOf('outstanding-policies')).toContain('Terms of service');
    await click('acknowledge-policies');

    await screen.findByTestId('save-profile');
    await type('Display name', 'Alex');
    fireEvent.change(screen.getByTestId('language-input'), {
      target: { value: 'es' },
    });
    await click('language-add');
    await click('save-profile');

    await waitFor(() => {
      expect(navigations().some((entry) => entry.path === '/discover')).toBe(
        true,
      );
    });
  });

  it('will not send a malformed region', async () => {
    const double = createApiDouble({
      ...emptyState(),
      account: {
        createdAt: '2026-08-14T12:00:00.000Z',
        id: ownAccountId,
        status: 'pending_profile',
      },
      onboarding: {
        adultAssurance: 'none',
        adultAssuranceRefused: false,
        outstandingPolicies: [],
        outstandingProfile: [],
        step: 'adult_declaration',
      },
      session: admittedState().session,
    });
    renderProduct(<Welcome />, double, { pathname: '/welcome' });

    await click('declare-adult');
    await screen.findByText('Enter a two-letter country code, such as ES.');
    expect(
      double.calls.some(
        (call) => call.path === '/v1/users/me/onboarding/adult-declaration',
      ),
    ).toBe(false);
  });

  it('saves an existing profile on reload with expectedVersion and completes onboarding', async () => {
    const double = createApiDouble({
      ...emptyState(),
      account: {
        createdAt: '2026-08-14T12:00:00.000Z',
        id: ownAccountId,
        status: 'pending_profile',
      },
      onboarding: {
        adultAssurance: 'self_declared',
        adultAssuranceRefused: false,
        outstandingPolicies: [],
        outstandingProfile: ['ready_media'],
        step: 'profile',
      },
      profile: {
        complete: false,
        discoverable: false,
        displayName: 'Alex Initial',
        languages: ['en'],
        media: [],
        outstandingRequirements: ['ready_media'],
        preferencesVersion: 1,
        version: 1,
      },
      session: admittedState().session,
    });

    renderProduct(
      <WelcomeGate>
        <Welcome />
      </WelcomeGate>,
      double,
      { pathname: '/welcome' },
    );

    await screen.findByTestId('save-profile');
    expect(screen.getByTestId('onboarding-display-name')).toHaveProperty(
      'value',
      'Alex Initial',
    );

    await click('save-profile');

    await waitFor(() => {
      const saveCalls = double.calls.filter(
        (call) =>
          call.path === '/v1/users/me/profile' && call.method === 'POST',
      );
      expect(saveCalls).toHaveLength(1);
      expect(
        (saveCalls[0]?.body as { expectedVersion?: number }).expectedVersion,
      ).toBe(1);
    });
  });

  it('renders conflict error when a stale profile edit is submitted', async () => {
    const double = createApiDouble({
      ...emptyState(),
      account: {
        createdAt: '2026-08-14T12:00:00.000Z',
        id: ownAccountId,
        status: 'pending_profile',
      },
      onboarding: {
        adultAssurance: 'self_declared',
        adultAssuranceRefused: false,
        outstandingPolicies: [],
        outstandingProfile: ['ready_media'],
        step: 'profile',
      },
      profile: {
        complete: false,
        discoverable: false,
        displayName: 'Alex Initial',
        languages: ['en'],
        media: [],
        outstandingRequirements: ['ready_media'],
        preferencesVersion: 1,
        version: 1,
      },
      session: admittedState().session,
    });

    renderProduct(
      <WelcomeGate>
        <Welcome />
      </WelcomeGate>,
      double,
      { pathname: '/welcome' },
    );

    await screen.findByTestId('save-profile');
    // Stale version conflict: state.profile was bumped elsewhere to version 2
    if (double.state.profile) {
      double.state.profile.version = 2;
    }

    await click('save-profile');

    await screen.findByText(
      'Something changed while you were editing. Reload and retry.',
    );
  });
});

/* ============================= discovery ============================= */

describe('discovery', () => {
  it('removes a candidate only once the server accepts the decision', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Discovery />, double, { pathname: '/discover' });
    await screen.findByTestId(`discovery-pass-${otherPersonId}`);

    double.refuseNext(
      '/v1/discovery/passes',
      'POST',
      409,
      'ACCOUNT_NOT_ELIGIBLE',
    );
    await click(`discovery-pass-${otherPersonId}`);

    await screen.findByText(
      'Your account cannot do that in its current state.',
    );
    // Refused, so the candidate is still there. Optimism never overrides the
    // server's answer.
    expect(screen.getByTestId(`discovery-pass-${otherPersonId}`)).toBeTruthy();

    await click(`discovery-pass-${otherPersonId}`);
    await waitFor(() => {
      expect(
        screen.queryByTestId(`discovery-pass-${otherPersonId}`),
      ).toBeNull();
    });
  });

  it('says the feed is empty rather than spinning forever', async () => {
    const double = createApiDouble({ ...admittedState(), candidates: [] });
    renderProduct(<Discovery />, double, { pathname: '/discover' });
    await screen.findByTestId('discovery-empty');
  });

  it('offers a retry when the feed could not be reached', async () => {
    const double = createApiDouble(admittedState());
    double.failNext('/v1/discovery/candidates', 'GET');
    renderProduct(<Discovery />, double, { pathname: '/discover' });

    await waitFor(() => {
      expect(textOf('discovery-failed')).toContain(
        'VELORA could not be reached',
      );
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('never renders the same candidate twice', async () => {
    const state = admittedState();
    const duplicated = state.candidates[0];
    if (duplicated === undefined) throw new Error('fixture needs a candidate');
    const double = createApiDouble({
      ...state,
      candidates: [duplicated, { ...duplicated }],
    });
    renderProduct(<Discovery />, double, { pathname: '/discover' });

    await screen.findAllByTestId(`discovery-pass-${duplicated.id}`);
    expect(
      within(screen.getByTestId('discovery-candidates')).getAllByRole(
        'heading',
        { level: 2 },
      ),
    ).toHaveLength(1);
  });

  it('offers people and creators as sections of one destination', async () => {
    const double = createApiDouble({
      ...admittedState(),
      creatorDirectory: [
        {
          avatar: { id: '77777777-7777-4777-8777-777777777777' },
          bio: 'Wheel-thrown stoneware in small runs.',
          displayName: 'Ember Vale Ceramics',
          handle: 'embervale',
        },
      ],
    });
    renderProduct(
      <Discover
        apiBaseUrl="http://api.test"
        fetchImplementation={double.fetch}
      />,
      double,
      { pathname: '/discover' },
    );

    // People first, because Discover is Social Discovery before it is anything
    // else.
    await screen.findByTestId(`candidate-${otherPersonId}`);
    expect(screen.queryByTestId('creator-directory')).toBeNull();

    fireEvent.click(screen.getByTestId('segment-creators'));
    renderProduct(
      <Discover
        apiBaseUrl="http://api.test"
        fetchImplementation={double.fetch}
      />,
      double,
      { pathname: '/discover', search: '?show=creators' },
    );

    const listing = await screen.findByTestId('creator-directory');
    expect(within(listing).getByText('Ember Vale Ceramics')).toBeTruthy();
    expect(within(listing).getByText('@embervale')).toBeTruthy();
    // A creator is never a candidate, and the section switch does not turn one
    // into the other.
    expect(
      within(listing).queryByRole('button', { name: /interested/iu }),
    ).toBeNull();
  });

  it('shows a candidate photograph once the platform grants an address', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Discovery />, double, { pathname: '/discover' });

    const portrait = await screen.findByTestId(
      `candidate-portrait-${otherPersonId}`,
    );
    expect(portrait.getAttribute('src')).toContain('https://media.test/');
  });

  it('draws an identity mark, not a broken frame, when nothing may be served', async () => {
    const double = createApiDouble({
      ...admittedState(),
      mediaDelivery: 'declined',
    });
    renderProduct(<Discovery />, double, { pathname: '/discover' });
    await screen.findByTestId(`candidate-${otherPersonId}`);

    expect(
      screen.queryByTestId(`candidate-portrait-${otherPersonId}`),
    ).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(0);
    // And it never says why, because the reason is somebody else's business.
    for (const leak of ['blocked', 'not allowed', 'processing']) {
      expect(document.body.textContent.toLowerCase()).not.toContain(leak);
    }
  });

  it('opens one person and shows every photograph they added', async () => {
    const state = admittedState();
    const candidate = state.candidates[0];
    if (candidate === undefined) throw new Error('the state needs a candidate');
    state.candidates = [
      {
        ...candidate,
        media: [
          { id: '81111111-1111-4111-8111-111111111111', position: 0 },
          { id: '82222222-2222-4222-8222-222222222222', position: 1 },
        ],
      },
    ];
    const double = createApiDouble(state);
    renderProduct(<PersonPage personId={otherPersonId} />, double, {
      pathname: `/people/${otherPersonId}`,
    });

    await screen.findByTestId(`person-${otherPersonId}`);
    // Awaited rather than read: the identity mark is on screen first and the
    // photographs replace it when their addresses arrive, which is the whole
    // point of not blocking the paint on them.
    await screen.findByTestId('person-portrait');
    // The first photograph is the hero and the rest are the gallery, so a
    // person with one image gets no empty shelf under them.
    await waitFor(() => {
      expect(document.querySelectorAll('img')).toHaveLength(2);
    });
    expect(screen.getByTestId('person-gallery')).toBeTruthy();
  });

  it('says there is nothing to show without saying which nothing it is', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(
      <PersonPage personId="99999999-9999-4999-8999-999999999999" />,
      double,
      { pathname: '/people/99999999-9999-4999-8999-999999999999' },
    );

    const empty = await screen.findByTestId('person-missing');
    for (const leak of [
      'blocked',
      'not allowed',
      'does not exist',
      'deleted',
    ]) {
      expect(empty.textContent.toLowerCase()).not.toContain(leak);
    }
  });

  it('invents no distance, score, or presence', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Discovery />, double, { pathname: '/discover' });
    await screen.findByTestId(`candidate-${otherPersonId}`);

    const rendered = document.body.textContent;
    for (const forbidden of [
      'Online',
      'online now',
      'km',
      'miles',
      '% match',
      'views',
      'popular',
    ]) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
  });

  it('nudges somebody who is not visible rather than silently showing nothing', async () => {
    const double = createApiDouble({ ...admittedState(), candidates: [] });
    renderProduct(<Discovery />, double, { pathname: '/discover' });
    await screen.findByTestId('discovery-availability');
  });
});

/* =========================== introductions =========================== */

function withPendingIntroduction(): ApiDoubleState {
  return {
    ...admittedState(),
    candidates: [],
    introductions: [
      {
        counterpart: {
          displayName: 'Robin',
          id: otherPersonId,
          media: [],
          sharedLanguages: ['es'],
        },
        createdAt: '2026-08-14T12:00:00.000Z',
        id: '55555555-5555-4555-8555-555555555555',
        role: 'recipient',
        state: 'pending',
      },
    ],
  };
}

describe('introductions', () => {
  it('turns a signal that is answered into a mutual introduction', async () => {
    const double = createApiDouble(withPendingIntroduction());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    await click('introduction-accept-55555555-5555-4555-8555-555555555555');
    await waitFor(() => {
      expect(double.state.introductions[0]?.state).toBe('mutual');
    });
  });

  it('removes a declined introduction and tells nobody', async () => {
    const double = createApiDouble(withPendingIntroduction());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    await click('introduction-decline-55555555-5555-4555-8555-555555555555');
    await waitFor(() => {
      expect(double.state.introductions).toHaveLength(0);
    });
    expect(document.body.textContent).not.toContain('declined you');
  });

  it('opens a conversation from a mutual introduction', async () => {
    const state = withPendingIntroduction();
    const introduction = state.introductions[0];
    if (introduction === undefined) throw new Error('fixture needs one');
    const double = createApiDouble({
      ...state,
      conversations: [
        {
          counterpart: { displayName: 'Robin', id: otherPersonId, media: [] },
          createdAt: '2026-08-14T12:00:00.000Z',
          id: '88888888-8888-4888-8888-888888888888',
          lastActivityAt: '2026-08-14T12:00:00.000Z',
          lastMessageSequence: 0,
          lastReadSequence: 0,
          relationship: {
            introductionId: introduction.id,
            kind: 'mutual_introduction',
          },
          state: 'active',
        },
      ],
      introductions: [{ ...introduction, state: 'mutual' }],
    });
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    await click('segment-mutual');
    await click(`introduction-open-${introduction.id}`);

    await waitFor(() => {
      expect(
        navigations().some(
          (entry) =>
            entry.path === '/messages/88888888-8888-4888-8888-888888888888',
        ),
      ).toBe(true);
    });
  });

  it('counts down nothing and applies no pressure', async () => {
    const double = createApiDouble(withPendingIntroduction());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });
    await screen.findByTestId(
      'introduction-55555555-5555-4555-8555-555555555555',
    );

    const rendered = document.body.textContent;
    for (const forbidden of ['expires in', 'Hurry', 'left to', 'Act now']) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
  });
});

/* ============================== messaging ============================ */

const conversationId = '88888888-8888-4888-8888-888888888888';

function withConversation(): ApiDoubleState {
  return {
    ...admittedState(),
    conversations: [
      {
        counterpart: { displayName: 'Robin', id: otherPersonId, media: [] },
        createdAt: '2026-08-14T12:00:00.000Z',
        id: conversationId,
        lastActivityAt: '2026-08-14T12:00:00.000Z',
        lastMessageSequence: 0,
        lastReadSequence: 0,
        relationship: {
          introductionId: '55555555-5555-4555-8555-555555555555',
          kind: 'mutual_introduction',
        },
        state: 'active',
      },
    ],
  };
}

async function openConversation(
  state = withConversation(),
): Promise<ApiDouble> {
  const double = createApiDouble(state);
  renderProduct(
    <MessagesLayout selectedId={conversationId}>
      <ConversationThread conversationId={conversationId} />
    </MessagesLayout>,
    double,
    { pathname: `/messages/${conversationId}` },
  );
  await screen.findByTestId('conversation-view');
  return double;
}

describe('messaging', () => {
  it('shows the server preview and relationship call entry without inventing presence', async () => {
    const state = withConversation();
    const conversation = state.conversations[0];
    if (conversation === undefined) throw new Error('fixture needs one');
    state.conversations = [
      {
        ...conversation,
        lastMessage: {
          bodyPreview: 'The durable newest message',
          createdAt: conversation.lastActivityAt,
          sender: 'counterpart',
          sequence: 1,
        },
        lastMessageSequence: 1,
      },
    ];
    const double = createApiDouble(state);
    renderProduct(
      <MessagesLayout>
        <div />
      </MessagesLayout>,
      double,
      { pathname: '/messages' },
    );

    await screen.findByText('The durable newest message');
    expect(document.body.textContent).not.toContain('online');

    await openConversation(state);
    expect(
      screen.getByTestId('call-voice-55555555-5555-4555-8555-555555555555'),
    ).toBeTruthy();
    expect(document.body.textContent).toContain('Attachments unavailable');
  });

  it('shows messages in the order the server assigned', async () => {
    const double = await openConversation();

    await type('Message Robin', 'first');
    await click('message-send');
    await waitFor(() => {
      expect(textOf('messages')).toContain('first');
    });

    await type('Message Robin', 'second');
    await click('message-send');
    await waitFor(() => {
      expect(textOf('messages')).toContain('second');
    });

    const rendered = [
      ...screen.getByTestId('messages').querySelectorAll('[data-sequence]'),
    ].map((item) => item.getAttribute('data-sequence'));
    expect(rendered).toEqual(['1', '2']);
    expect(double.state.messages).toHaveLength(2);
  });

  it('retries a lost send with the same identifier and creates one message', async () => {
    const double = await openConversation();

    double.failNext('/v1/messaging/messages', 'POST');
    await type('Message Robin', 'only once');
    await click('message-send');
    await screen.findByTestId('message-send-failed');

    await click('message-retry');
    await waitFor(() => {
      expect(double.state.messages).toHaveLength(1);
      expect(textOf('messages')).toContain('only once');
    });

    const sends = double.calls.filter(
      (call) =>
        call.path === '/v1/messaging/messages' && call.method === 'POST',
    );
    expect(sends).toHaveLength(2);
    // Two attempts, one identifier. That is what makes the retry safe.
    expect(
      new Set(
        sends.map(
          (call) => (call.body as { clientMessageId: string }).clientMessageId,
        ),
      ).size,
    ).toBe(1);
  });

  it('does not offer a retry for a refusal that will refuse again', async () => {
    const double = await openConversation();

    // The pair stopped being eligible while the composer was open.
    double.refuseNext(
      '/v1/messaging/messages',
      'POST',
      409,
      'ACTION_NOT_PERMITTED',
    );
    await type('Message Robin', 'too late');
    await click('message-send');

    await waitFor(() => {
      expect(textOf('message-send-failed')).toBe(
        'That is not possible right now.',
      );
    });
    expect(screen.queryByTestId('message-retry')).toBeNull();
    expect(screen.getByTestId('message-discard')).toBeTruthy();
  });

  it('closes the composer when the conversation is closed', async () => {
    const state = withConversation();
    const conversation = state.conversations[0];
    if (conversation === undefined) throw new Error('fixture needs one');
    await openConversation({
      ...state,
      conversations: [{ ...conversation, state: 'closed' }],
    });

    await screen.findByTestId('conversation-closed');
    expect(screen.queryByTestId('message-send')).toBeNull();
  });

  it('refuses to send a message longer than the contract allows', async () => {
    const double = await openConversation();
    await type('Message Robin', 'x'.repeat(4001));

    await screen.findByTestId('message-too-long');
    expect(screen.getByTestId('message-send').hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      double.calls.some(
        (call) =>
          call.path === '/v1/messaging/messages' && call.method === 'POST',
      ),
    ).toBe(false);
  });

  it('says a conversation is unavailable rather than showing an empty frame', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(
      <MessagesLayout selectedId="not-a-conversation">
        <ConversationThread conversationId="not-a-conversation" />
      </MessagesLayout>,
      double,
      { pathname: '/messages/not-a-conversation' },
    );
    await screen.findByTestId('conversation-missing');
  });

  it('never claims a message is encrypted end to end', async () => {
    await openConversation();
    expect(document.body.textContent).toContain('Not end-to-end encrypted.');
  });
});

/* =========================== notifications =========================== */

function withNotification(): ApiDoubleState {
  return {
    ...admittedState(),
    notifications: [
      {
        conversationId,
        createdAt: '2026-08-14T12:00:00.000Z',
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'message_received',
        subjectId: otherPersonId,
      },
    ],
  };
}

describe('notifications', () => {
  it('shows what happened and lets it be acknowledged', async () => {
    const double = createApiDouble(withNotification());
    renderProduct(<Notifications />, double, { pathname: '/notifications' });

    await screen.findByText('1 unread.');
    await screen.findByText('Robin sent you a message.');
    await click('notifications-mark-read');
    await screen.findByText('Everything here has been read.');
  });

  it('acknowledges a long rendered activity list within contract batch bounds', async () => {
    const state = admittedState();
    state.notifications = Array.from({ length: 51 }, (_, index) => ({
      conversationId,
      createdAt: new Date(Date.now() - index * 1_000).toISOString(),
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      kind: 'message_received',
      subjectId: otherPersonId,
    }));
    const double = createApiDouble(state);
    renderProduct(<Notifications />, double, { pathname: '/notifications' });

    await screen.findByText('51 unread.');
    await click('notifications-mark-read');
    await screen.findByText('Everything here has been read.');

    const reads = double.calls.filter(
      (call) =>
        call.path === '/v1/notifications/read' && call.method === 'POST',
    );
    expect(reads).toHaveLength(2);
    expect(reads.map((call) => call.body)).toEqual([
      {
        notificationIds: state.notifications
          .slice(0, 50)
          .map((entry) => entry.id),
      },
      {
        notificationIds: state.notifications.slice(50).map((entry) => entry.id),
      },
    ]);
  });

  it('publishes nothing about external delivery attempts', async () => {
    const double = createApiDouble(withNotification());
    renderProduct(<Notifications />, double, { pathname: '/notifications' });
    await screen.findByText('1 unread.');

    const rendered = document.body.textContent;
    for (const forbidden of ['safety_block', 'suppressed', 'attempts']) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
  });

  it('opens the thing a notice is about', async () => {
    const double = createApiDouble(withNotification());
    renderProduct(<Notifications />, double, { pathname: '/notifications' });

    await click('notification-99999999-9999-4999-8999-999999999999');
    await waitFor(() => {
      expect(
        navigations().some(
          (entry) => entry.path === `/messages/${conversationId}`,
        ),
      ).toBe(true);
    });
  });

  it('keeps a deleted or revoked activity readable without a broken link', async () => {
    const state = withNotification();
    state.candidates = [];
    const double = createApiDouble(state);
    renderProduct(<Notifications />, double, { pathname: '/notifications' });

    await screen.findByText('This activity is no longer available.');
    const row = screen.getByTestId(
      'notification-99999999-9999-4999-8999-999999999999',
    );
    expect(row.tagName).toBe('DIV');
    await click('notification-read-99999999-9999-4999-8999-999999999999');
    await screen.findByText('Everything here has been read.');
  });

  it('says plainly that nothing is delivered outside VELORA', async () => {
    const double = createApiDouble(withNotification());
    renderProduct(<Notifications />, double, { pathname: '/notifications' });
    await screen.findByTestId('notifications-delivery');
    expect(textOf('notifications-delivery')).toContain(
      'no approved email or push provider',
    );
  });
});

/* =============================== safety ============================== */

describe('safety', () => {
  it('reports somebody from where they appear, without echoing what was written', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Discovery />, double, { pathname: '/discover' });

    await click(`safety-menu-${otherPersonId}`);
    await click('safety-open-report');
    await type(/Anything you want to add/u, 'private narrative');
    await click('report-submit');

    await waitFor(() => {
      expect(double.state.reports).toHaveLength(1);
    });
    // Sent once, never shown again: the reporter's narrative is evidence, not a
    // record the surface may read back.
    expect(document.body.textContent).not.toContain('private narrative');
  });

  it('blocks from where somebody appears and removes them from the feed', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Discovery />, double, { pathname: '/discover' });

    await click(`safety-menu-${otherPersonId}`);
    await click('safety-open-block');
    await click('block-person-accept');

    await waitFor(() => {
      expect(double.state.blocks).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`candidate-${otherPersonId}`)).toBeNull();
    });
  });

  it('says nothing is restricted when nothing is', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Safety />, double, { pathname: '/you/safety' });

    await screen.findByTestId('standing-empty');
    expect(textOf('standing-empty')).toContain('Nothing is restricted');
  });

  it('tells somebody the category and offers to look again', async () => {
    const double = createApiDouble({
      ...admittedState(),
      statements: [
        {
          appealable: true,
          decidedAt: '2026-08-14T12:00:00.000Z',
          decisionId: '99999999-9999-4999-8999-999999999999',
          reasonCode: 'account_restricted',
          scope: 'account_restriction',
        },
      ],
    });
    renderProduct(<Safety />, double, { pathname: '/you/safety' });

    await waitFor(() => {
      expect(textOf('standing-list')).toContain('Your account is restricted');
    });
    // The scope, so somebody knows what it reaches. Never the finding behind
    // it, which the contract has no field for in any case.
    expect(textOf('standing-list')).toContain('your whole account');
    expect(document.body.textContent).not.toContain('harassment');

    await click('appeal-99999999-9999-4999-8999-999999999999');
    await click('appeal-submit');
    await waitFor(() => {
      expect(double.state.appeals).toHaveLength(1);
    });
  });

  it('never shows who has blocked the person using it', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Safety />, double, { pathname: '/you/safety' });

    await screen.findByTestId('blocks-empty');
    // The contract has no field for it and the surface asks for none.
    expect(document.body.textContent).not.toContain('blocked you');
  });

  it('shows no raw identifier for somebody who has been blocked', async () => {
    const double = createApiDouble({
      ...admittedState(),
      blocks: [
        { blockedId: otherPersonId, createdAt: '2026-08-14T12:00:00.000Z' },
      ],
    });
    renderProduct(<Safety />, double, { pathname: '/you/safety' });

    await screen.findByTestId('block-list');
    expect(document.body.textContent).not.toContain(otherPersonId);
  });
});

/* ========================== profile and you ========================== */

describe('profile', () => {
  it('reports honestly that no photo storage exists yet', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<You />, double, { pathname: '/you' });

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(await screen.findByTestId('profile-photo'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(textOf('profile-photo-error')).toContain(
        'Photo storage is not available in this environment yet.',
      );
    });
  });

  it('shows a ready photo once the platform grants an address for it', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<You />, double, { pathname: '/you' });

    const thumbnail = await screen.findByTestId(
      `profile-media-thumb-${admittedState().profile?.media[0]?.id ?? ''}`,
    );
    expect(thumbnail.getAttribute('src')).toContain('https://media.test/');
    // Decorative: the person's own name and the slot's state are already text
    // beside it, so announcing the picture as well would repeat them.
    expect(thumbnail.getAttribute('alt')).toBe('');
    expect(screen.queryByTestId('media-delivery-blocked')).toBeNull();
  });

  it('says no photo can be shown rather than showing a broken frame', async () => {
    const double = createApiDouble({
      ...admittedState(),
      mediaDelivery: 'unavailable',
    });
    renderProduct(<You />, double, { pathname: '/you' });

    await screen.findByTestId('media-delivery-blocked');
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('shows an availability window that ended as ended', async () => {
    const double = createApiDouble({
      ...admittedState(),
      availability: {
        availableUntil: '2026-08-14T11:00:00.000Z',
        // What the person chose, and what the server now acts on.
        effectiveState: 'unavailable',
        state: 'available',
        updatedAt: '2026-08-14T10:00:00.000Z',
      },
    });
    renderProduct(<You />, double, { pathname: '/you' });

    await waitFor(() => {
      expect(textOf('availability-state')).toContain('Window ended');
    });
    expect(screen.getByTestId('availability-expired')).toBeTruthy();
  });

  it('carries the version it read so a concurrent edit loses explicitly', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<You />, double, { pathname: '/you' });

    await click('profile-edit');
    // The form is seeded from the server, so the version it will carry only
    // exists once that answer has arrived.
    await waitFor(() => {
      expect(
        screen.getByTestId<HTMLInputElement>('profile-display-name').value,
      ).toBe('Alex');
    });

    double.refuseNext('/v1/users/me/profile', 'POST', 409, 'STATE_CONFLICT');
    await click('profile-save');

    await waitFor(() => {
      expect(textOf('profile-error')).toContain(
        'Something changed while you were editing.',
      );
    });
    const save = double.calls.find(
      (call) => call.path === '/v1/users/me/profile' && call.method === 'POST',
    );
    expect((save?.body as { expectedVersion?: number }).expectedVersion).toBe(
      1,
    );
  });

  it('does not offer discovery to a profile the server would refuse', async () => {
    const state = admittedState();
    const profile = state.profile;
    if (profile === null) throw new Error('fixture needs a profile');
    const double = createApiDouble({
      ...state,
      profile: {
        ...profile,
        complete: false,
        discoverable: false,
        outstandingRequirements: ['ready_media'],
      },
    });
    renderProduct(<You />, double, { pathname: '/you' });

    await screen.findByTestId('profile-requirements');
    expect(textOf('profile-requirements')).toContain(
      'one photo that has been checked',
    );
    expect(
      screen.getByTestId('profile-discoverable').hasAttribute('disabled'),
    ).toBe(true);
  });
});

/* ============================== settings ============================= */

describe('settings', () => {
  it('records a delivery choice without claiming anything will arrive', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Settings />, double, { pathname: '/you/settings' });

    await screen.findByTestId('notice-delivery-blocked');
    expect(textOf('notice-delivery-blocked')).toContain(
      'No email or push provider is approved',
    );

    fireEvent.click(screen.getByTestId('notice-direct_message:push'));
    await waitFor(() => {
      expect(
        double.state.notificationPreferences.find(
          (preference) => preference.category === 'direct_message',
        )?.enabled,
      ).toBe(false);
    });
  });

  it('offers no switch the server did not publish', async () => {
    const double = createApiDouble({
      ...admittedState(),
      notificationPreferences: [],
    });
    renderProduct(<Settings />, double, { pathname: '/you/settings' });

    await screen.findByTestId('notice-preferences-empty');
    // No pair, no switch. A control the server did not publish is a control
    // that would do nothing.
    expect(document.querySelectorAll('.v-switch')).toHaveLength(0);
  });
});

/* ============================ memberships ============================ */

describe('memberships', () => {
  it('says nothing can be bought and offers no way to buy', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Memberships />, double, { pathname: '/you/memberships' });

    await screen.findByTestId('memberships-commerce');
    expect(textOf('memberships-commerce')).toContain('can be bought yet');
    await screen.findByTestId('memberships-empty');

    const markup = document.body.textContent;
    for (const forbidden of ['Subscribe', 'Buy', 'Upgrade', 'Checkout']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('says nobody is in a club, and how somebody gets into one', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Memberships />, double, { pathname: '/you/memberships' });

    await screen.findByTestId('club-access-empty');
    expect(textOf('club-access-empty')).toContain(
      'no way to ask for one and nothing to buy',
    );
  });

  it('redeems an invitation and never shows the secret again', async () => {
    const double = createApiDouble({
      ...admittedState(),
      clubInvites: [
        {
          clubId: '77777777-7777-4777-8777-777777777777',
          clubName: 'Inner Circle',
          creatorHandle: 'ember_vale',
          secret: 'a-bearer-secret-nobody-should-see-twice',
        },
      ],
    });
    renderProduct(<Memberships />, double, { pathname: '/you/memberships' });

    fireEvent.change(await screen.findByTestId('club-invite-secret'), {
      target: { value: 'a-bearer-secret-nobody-should-see-twice' },
    });
    await click('club-invite-redeem');

    await screen.findByTestId(
      'club-access-77777777-7777-4777-8777-777777777777',
    );
    expect(textOf('club-access-list')).toContain('Inner Circle');
    // Sent once and settled by the server. A surface that echoed it back would
    // put a live credential in a screenshot and a browser history.
    expect(document.body.textContent).not.toContain(
      'a-bearer-secret-nobody-should-see-twice',
    );
    expect(
      screen.getByTestId<HTMLInputElement>('club-invite-secret').value,
    ).toBe('');
  });

  it('says an invitation that will not work did not work, and nothing more', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Memberships />, double, { pathname: '/you/memberships' });

    fireEvent.change(await screen.findByTestId('club-invite-secret'), {
      target: { value: 'never-issued' },
    });
    await click('club-invite-redeem');

    // A spent invitation and one that never existed are one answer, so the
    // screen has no vocabulary that could tell them apart.
    await screen.findByText('That is not possible right now.');
    expect(double.state.clubAccess).toHaveLength(0);
  });

  it('does not pretend a club can be opened from here', async () => {
    const double = createApiDouble({
      ...admittedState(),
      clubAccess: [
        {
          clubId: '77777777-7777-4777-8777-777777777777',
          clubName: 'Inner Circle',
          creatorHandle: 'ember_vale',
          grantedAt: '2026-08-14T12:00:00.000Z',
          source: 'creator_invite',
        },
      ],
    });
    renderProduct(<Memberships />, double, { pathname: '/you/memberships' });

    await screen.findByTestId('club-content-blocked');
    expect(textOf('club-content-blocked')).toContain(
      'nothing publishes a member',
    );
  });

  it('shows what the server says is being paid for, and grants nothing for a lapse', async () => {
    const double = createApiDouble({
      ...admittedState(),
      subscriptions: [
        {
          amount: { amountMinor: '1500', currency: 'USD' },
          createdAt: '2026-08-15T12:00:00.000Z',
          currentPeriodEnd: '2026-09-15T12:00:00.000Z',
          id: 'sub-1',
          offerId: '11111111-1111-4111-8111-111111111111',
          state: 'past_due',
        },
      ],
    });
    renderProduct(<Memberships />, double, { pathname: '/you/memberships' });

    const row = await screen.findByTestId('membership-sub-1');
    expect(row.textContent).toContain('15.00 USD');
    expect(row.textContent).toContain('access is not active');
  });
});

/* =========================== accessibility =========================== */

describe('accessibility structure', () => {
  it('exposes one first-level heading, a main landmark, and named navigation', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(
      <AppShell title="Discover">
        <Discover
          apiBaseUrl="http://api.test"
          fetchImplementation={double.fetch}
        />
      </AppShell>,
      double,
      { pathname: '/discover' },
    );

    await screen.findByTestId('discovery-candidates');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('main')).toBeTruthy();
    // Both navigations are in the document; the stylesheet takes one out of the
    // layout at each width, and this environment applies no stylesheet. Which
    // one a viewport actually gets is proved in the browser suite.
    expect(screen.getAllByRole('navigation', { name: 'Primary' }).length).toBe(
      2,
    );
  });

  it('marks the destination somebody is in', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(
      <AppShell title="Discover">
        <Discovery />
      </AppShell>,
      double,
      { pathname: '/discover' },
    );

    const current = await screen.findByTestId('nav-discover');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByTestId('nav-messages').getAttribute('aria-current'),
    ).toBeNull();
  });

  it('names every control that takes input', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<You />, double, { pathname: '/you' });
    await screen.findByTestId('profile-view');
    await click('profile-edit');
    await screen.findByLabelText('Display name');

    for (const field of document.querySelectorAll('input, select, textarea')) {
      const labelled =
        field.getAttribute('aria-label') !== null ||
        field.getAttribute('aria-labelledby') !== null ||
        field.closest('label') !== null ||
        document.querySelector(`label[for="${field.id}"]`) !== null;
      expect(labelled, `${field.id || field.outerHTML} has a name`).toBe(true);
    }
  });

  it('names every icon-only control', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Discovery />, double, { pathname: '/discover' });
    await screen.findByTestId(`candidate-${otherPersonId}`);

    for (const control of document.querySelectorAll('button')) {
      const named =
        control.textContent.trim().length > 0 ||
        control.getAttribute('aria-label') !== null;
      expect(named, control.outerHTML).toBe(true);
    }
  });

  it('announces progress and failure to assistive technology', async () => {
    const double = createApiDouble(admittedState());
    double.failNext('/v1/discovery/candidates', 'GET');
    renderProduct(<Discovery />, double, { pathname: '/discover' });

    await waitFor(() => {
      expect(
        screen
          .getAllByRole('alert')
          .some((node) =>
            node.textContent.includes('VELORA could not be reached'),
          ),
      ).toBe(true);
    });
  });
});

/* =============================== dialogs ============================= */

describe('dialogs', () => {
  it('moves focus in, keeps it in, and gives it back', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Discovery />, double, { pathname: '/discover' });

    const trigger = await screen.findByTestId(`safety-menu-${otherPersonId}`);
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByTestId('safety-menu');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('safety-menu')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});

/* ============================= stale state =========================== */

describe('stale state', () => {
  it('re-reads from the server when the tab comes back into view', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<You />, double, { pathname: '/you' });
    await screen.findByTestId('profile-view');

    const before = double.calls.filter(
      (call) => call.path === '/v1/users/me',
    ).length;

    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('focus'));

    await waitFor(() => {
      expect(
        double.calls.filter((call) => call.path === '/v1/users/me').length,
      ).toBeGreaterThan(before);
    });
  });

  it('never names an account the server did not choose', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<You />, double, { pathname: '/you' });
    await screen.findByTestId('profile-view');

    expect(double.state.account?.id).toBe(ownAccountId);
    const identified = double.calls.filter(
      (call) =>
        typeof call.body === 'object' &&
        call.body !== null &&
        'accountId' in call.body,
    );
    expect(identified).toHaveLength(0);
  });
});
