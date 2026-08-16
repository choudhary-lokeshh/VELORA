import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConsumerShell } from '../src/product/shell';
import {
  admittedState,
  createApiDouble,
  emptyState,
  otherPersonId,
  ownAccountId,
  type ApiDouble,
  type ApiDoubleState,
} from './support/api-double';

/**
 * The Consumer Web journey, driven through the generated client against a
 * stand-in API that answers the real contract.
 *
 * Nothing here reaches inside a component. Every assertion is about what
 * somebody using the surface would see and do, and every answer the surface
 * gets is one the server could actually give — which is what makes a passing
 * test evidence about the product rather than about the test's own mocks.
 *
 * The keyboard-only journey is proved in Playwright rather than here. A real
 * browser is the only place tab order, focus rings, and activation semantics
 * are real; asserting them against jsdom would be asserting jsdom.
 */

const baseUrl = 'http://api.test';

// Vitest runs without global test APIs, so the automatic teardown React Testing
// Library installs when it can see them is registered here instead. Without it
// each test would render on top of the last one's DOM.
afterEach(cleanup);

function renderShell(double: ApiDouble) {
  return render(
    <ConsumerShell apiBaseUrl={baseUrl} fetchImplementation={double.fetch} />,
  );
}

function textOf(testId: string): string | null {
  return screen.getByTestId(testId).textContent;
}

/**
 * Waits for the control, then uses it.
 *
 * Every interaction below goes through these, so a test never races the surface
 * it is driving: the control has to exist before it can be typed into or
 * pressed, exactly as it does for a person.
 */
async function type(label: string, value: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
}

async function click(testId: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(testId));
}

async function signedIn(state: ApiDoubleState = admittedState()) {
  const double = createApiDouble(state);
  renderShell(double);
  await waitFor(() => {
    expect(textOf('auth-status')).toContain('Signed in');
  });
  return double;
}

describe('session lifecycle', () => {
  it('restores an existing session without anybody signing in', async () => {
    await signedIn();
    expect(textOf('auth-audience')).toBe('consumer_web');
  });

  it('reports being signed out rather than guessing why', async () => {
    renderShell(createApiDouble(emptyState()));
    await waitFor(() => {
      expect(textOf('auth-status')).toContain('Signed out');
    });
    // The server answers every failed session check identically, so the surface
    // says only what it can honestly observe.
    expect(textOf('auth-cause')).toBe('No active session');
  });

  it('offers nothing to press until the session check has answered', async () => {
    const double = createApiDouble(emptyState());
    let release: (() => void) | undefined;
    const held = new Promise<void>((settle) => {
      release = () => {
        settle();
      };
    });
    render(
      <ConsumerShell
        apiBaseUrl={baseUrl}
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
      />,
    );

    // The page is deliverable before anybody knows whose it is, so a sign-in
    // form in that window is visible and pressable while nothing is listening
    // yet. A press landing there is discarded silently — no request, no
    // navigation, no message — and the same markup would invite somebody who
    // is already signed in to sign in again.
    expect(textOf('auth-status')).toContain('Checking session');
    expect(screen.queryByTestId('auth-sign-in')).toBeNull();
    expect(screen.queryByLabelText('Development identity')).toBeNull();

    release?.();
    await waitFor(() => {
      expect(textOf('auth-status')).toContain('Signed out');
    });
    expect(screen.getByTestId('auth-sign-in')).toBeTruthy();
  });

  it('says the service is unavailable rather than that the user is signed out', async () => {
    const double = createApiDouble(admittedState());
    double.failNext('/v1/auth/session');
    renderShell(double);
    await waitFor(() => {
      expect(screen.getByTestId('auth-unavailable')).toBeTruthy();
    });
    expect(screen.queryByTestId('auth-cause')).toBeNull();
  });

  it('signs out and stops showing the product', async () => {
    await signedIn();
    await click('auth-sign-out');
    await waitFor(() => {
      expect(textOf('auth-status')).toContain('Signed out');
    });
    expect(screen.queryByTestId('nav-discovery')).toBeNull();
  });
});

describe('admission', () => {
  it('walks a new person through the ladder the server publishes', async () => {
    await signedIn({ ...emptyState(), session: admittedState().session });

    await waitFor(() => {
      expect(screen.getByTestId('account-required')).toBeTruthy();
    });
    await click('create-account');

    await waitFor(() => {
      expect(screen.getByTestId('declare-adult')).toBeTruthy();
    });
    // A declaration, said to be a declaration. Nothing here calls it verified.
    expect(screen.getByText(/not a verified age check/)).toBeTruthy();
    await click('declare-adult');

    await waitFor(() => {
      expect(screen.getByTestId('acknowledge-policies')).toBeTruthy();
    });
    expect(textOf('outstanding-policies')).toContain('terms_of_service');
    await click('acknowledge-policies');

    await waitFor(() => {
      expect(screen.getByTestId('save-profile')).toBeTruthy();
    });
    await type('Display name', 'Alex');
    await click('save-profile');

    await waitFor(() => {
      expect(screen.getByTestId('nav-discovery')).toBeTruthy();
    });
    expect(textOf('journey-stage')).toBe('Ready');
  });

  it('does not offer the product before the server admits the account', async () => {
    await signedIn({ ...emptyState(), session: admittedState().session });
    expect(screen.queryByTestId('nav-discovery')).toBeNull();
    expect(screen.queryByTestId('nav-conversations')).toBeNull();
  });
});

describe('discovery', () => {
  it('removes a candidate only once the server accepts the decision', async () => {
    const double = await signedIn();
    await waitFor(() => {
      expect(
        screen.getByTestId(`discovery-pass-${otherPersonId}`),
      ).toBeTruthy();
    });

    double.refuseNext('/v1/discovery/passes', 409, 'ACCOUNT_NOT_ELIGIBLE');
    await click(`discovery-pass-${otherPersonId}`);

    await waitFor(() => {
      expect(textOf('discovery-notice')).toBe(
        'Your account cannot do that in its current state.',
      );
    });
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
    await signedIn({ ...admittedState(), candidates: [] });
    await click('nav-discovery');
    await waitFor(() => {
      expect(screen.getByTestId('discovery-empty')).toBeTruthy();
    });
  });

  it('offers a retry when the feed could not be reached', async () => {
    const double = createApiDouble(admittedState());
    double.failNext('/v1/discovery/candidates');
    renderShell(double);
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
    await signedIn({ ...state, candidates: [duplicated, { ...duplicated }] });
    // The list element is in the markup before the feed has answered, so
    // waiting for it says nothing about what came back. A row for the
    // duplicated candidate is the authoritative signal: rows exist only once a
    // page has been applied, and a dedupe that failed would put both copies in
    // that same commit rather than one after the other.
    await screen.findAllByTestId(`discovery-pass-${duplicated.id}`);
    expect(
      within(screen.getByTestId('discovery-candidates')).getAllByRole(
        'heading',
        { level: 3 },
      ),
    ).toHaveLength(1);
  });
});

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
        state: 'active',
      },
    ],
  };
}

async function openConversation(state = withConversation()) {
  const double = await signedIn(state);
  await click('nav-conversations');
  await waitFor(() => {
    expect(screen.getByTestId(`conversation-${conversationId}`)).toBeTruthy();
  });
  await click(`conversation-${conversationId}`);
  await waitFor(() => {
    expect(screen.getByTestId('conversation-view')).toBeTruthy();
  });
  return double;
}

describe('messaging', () => {
  it('shows messages in the order the server assigned', async () => {
    const double = await openConversation();

    await type('Message', 'first');
    await click('message-send');
    await waitFor(() => {
      expect(textOf('messages')).toContain('first');
    });

    await type('Message', 'second');
    await click('message-send');
    await waitFor(() => {
      expect(textOf('messages')).toContain('second');
    });

    const rendered = [
      ...screen.getByTestId('messages').querySelectorAll('li'),
    ].map((item) => item.getAttribute('data-sequence'));
    expect(rendered).toEqual(['1', '2']);
    expect(double.state.messages).toHaveLength(2);
  });

  it('retries a lost send with the same identifier and creates one message', async () => {
    const double = await openConversation();

    double.failNext('/v1/messaging/messages');
    await type('Message', 'only once');
    await click('message-send');
    await waitFor(() => {
      expect(screen.getByTestId('message-send-failed')).toBeTruthy();
    });

    await click('message-retry');
    await waitFor(() => {
      expect(double.state.messages).toHaveLength(1);
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
    double.refuseNext('/v1/messaging/messages', 409, 'ACTION_NOT_PERMITTED');
    await type('Message', 'too late');
    await click('message-send');

    await waitFor(() => {
      expect(textOf('message-send-failed')).toBe(
        'That is not possible right now.',
      );
    });
    expect(screen.queryByTestId('message-retry')).toBeNull();
    expect(screen.getByTestId('message-discard')).toBeTruthy();
  });

  it('closes the composer when a block closed the conversation', async () => {
    await signedIn(withConversation());
    await click('nav-safety');
    await type('Block someone by their identifier', otherPersonId);
    await click('block-submit');
    await waitFor(() => {
      expect(textOf('safety-notice')).toContain('Blocked.');
    });

    await click('nav-conversations');
    await click(`conversation-${conversationId}`);
    await waitFor(() => {
      expect(screen.getByTestId('conversation-closed')).toBeTruthy();
    });
    expect(screen.getByTestId('message-send').hasAttribute('disabled')).toBe(
      true,
    );
  });
});

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
    await signedIn(withNotification());
    await click('nav-notifications');

    await waitFor(() => {
      expect(textOf('notifications-unread')).toBe('1 unread');
    });
    await click('notifications-mark-read');
    await waitFor(() => {
      expect(textOf('notifications-unread')).toBe('Nothing unread.');
    });
  });

  it('publishes nothing about external delivery', async () => {
    await signedIn(withNotification());
    await click('nav-notifications');
    // The same rule as the discovery list: the element is there while the page
    // is still loading, so what is waited for is the notice itself. Scanning
    // the markup before anything arrived would be scanning a loading screen.
    await waitFor(() => {
      expect(textOf('notifications-unread')).toBe('1 unread');
    });
    const rendered = document.body.textContent;
    for (const forbidden of [
      'safety_block',
      'suppressed',
      'attempts',
      'push',
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it('stops showing a notice about somebody who has been blocked', async () => {
    await signedIn(withNotification());
    await click('nav-safety');
    await type('Block someone by their identifier', otherPersonId);
    await click('block-submit');
    await waitFor(() => {
      expect(screen.getByTestId('safety-notice')).toBeTruthy();
    });

    await click('nav-notifications');
    await waitFor(() => {
      expect(screen.getByTestId('notifications-empty')).toBeTruthy();
    });
  });
});

describe('safety', () => {
  it('reports somebody without echoing what was written back', async () => {
    const double = await signedIn();
    await click('nav-safety');
    await click('report-open');

    // Focus follows the disclosure, so a keyboard user lands in the form.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByLabelText('Who are you reporting?'),
      );
    });
    await type('Who are you reporting?', otherPersonId);
    await type('Anything you want to add', 'private narrative');
    await click('report-submit');

    await waitFor(() => {
      expect(textOf('report-message')).toContain('Report received');
    });
    // Sent once, never shown again: the reporter's narrative is evidence, not a
    // record the surface may read back.
    expect(document.body.textContent).not.toContain('private narrative');
    expect(double.state.reports).toHaveLength(1);
    // And focus returns to the control that opened the form.
    expect(document.activeElement).toBe(screen.getByTestId('report-open'));
  });

  it('says nothing is restricted when nothing is', async () => {
    await signedIn();
    await click('nav-safety');

    await waitFor(() => {
      expect(screen.getByTestId('standing-empty')).toBeTruthy();
    });
    // An ordinary account is the ordinary case. A screen that rendered it as a
    // failed lookup would make everybody think something had gone wrong.
    expect(textOf('standing-empty')).toContain('Nothing is currently');
  });

  it('tells somebody the category and offers to look again', async () => {
    const double = await signedIn();
    double.state.statements = [
      {
        appealable: true,
        decidedAt: new Date().toISOString(),
        decisionId: '99999999-9999-4999-8999-999999999999',
        reasonCode: 'account_restricted',
        scope: 'account_restriction',
      },
    ];
    await click('nav-safety');

    await waitFor(() => {
      expect(textOf('standing-list')).toContain('Your account is restricted');
    });
    // The scope, so somebody knows what it reaches. Never the finding behind
    // it, which the contract has no field for in any case.
    expect(textOf('standing-list')).toContain('account restriction');
    expect(document.body.textContent).not.toContain('harassment');

    await click('appeal-99999999-9999-4999-8999-999999999999');
    await waitFor(() => {
      expect(textOf('standing-notice')).toContain('A person will look at it');
    });
    expect(double.state.appeals).toHaveLength(1);
  });

  it('never shows who has blocked the person using it', async () => {
    await signedIn();
    await click('nav-safety');
    await waitFor(() => {
      expect(screen.getByTestId('blocks-empty')).toBeTruthy();
    });
    // The contract has no field for it and the surface asks for none.
    expect(document.body.textContent).not.toContain('blocked you');
  });
});

describe('profile and availability', () => {
  it('reports honestly that no photo storage exists yet', async () => {
    await signedIn();
    await click('nav-profile');
    await waitFor(() => {
      expect(screen.getByTestId('profile-photo')).toBeTruthy();
    });

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(screen.getByTestId('profile-photo'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(textOf('profile-photo-error')).toBe(
        'Photo storage is not available in this environment yet.',
      );
    });
  });

  it('shows an availability window that ended as ended', async () => {
    await signedIn({
      ...admittedState(),
      availability: {
        availableUntil: '2026-08-14T11:00:00.000Z',
        // What the person chose, and what the server now acts on.
        effectiveState: 'unavailable',
        state: 'available',
        updatedAt: '2026-08-14T10:00:00.000Z',
      },
    });
    await click('nav-profile');
    await waitFor(() => {
      expect(textOf('availability-state')).toBe('Availability window ended');
    });
    expect(screen.getByTestId('availability-expired')).toBeTruthy();
  });

  it('carries the version it read so a concurrent edit loses explicitly', async () => {
    const double = await signedIn();
    await click('nav-profile');
    await waitFor(() => {
      expect(screen.getByTestId('profile-save')).toBeTruthy();
    });

    double.refuseNext('/v1/users/me/profile', 409, 'STATE_CONFLICT');
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
});

describe('accessibility structure', () => {
  it('exposes one first-level heading and named regions', async () => {
    await signedIn();
    await screen.findByTestId('nav-discovery');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Session' })).toBeTruthy();
    expect(
      screen.getByRole('navigation', { name: 'Product areas' }),
    ).toBeTruthy();
  });

  it('names every control that takes input', async () => {
    await signedIn();
    await click('nav-profile');
    await waitFor(() => {
      expect(screen.getByLabelText('Display name')).toBeTruthy();
    });
    for (const field of document.querySelectorAll('input, select, textarea')) {
      const labelled =
        field.getAttribute('aria-label') !== null ||
        field.getAttribute('aria-labelledby') !== null ||
        document.querySelector(`label[for="${field.id}"]`) !== null;
      expect(labelled, `${field.id || field.outerHTML} has a name`).toBe(true);
    }
  });

  it('announces progress and failure to assistive technology', async () => {
    const double = createApiDouble(admittedState());
    double.failNext('/v1/discovery/candidates');
    renderShell(double);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'VELORA could not be reached',
      );
    });
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('marks the section a person is in', async () => {
    await signedIn();
    await click('nav-profile');
    expect(screen.getByTestId('nav-profile').getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

describe('stale state', () => {
  it('re-reads from the server when the tab comes back into view', async () => {
    const double = await signedIn();
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

  it('treats a session that ended elsewhere as a signed-out session', async () => {
    const double = await signedIn();
    double.state.session = null;

    fireEvent(window, new Event('focus'));

    await waitFor(() => {
      expect(textOf('auth-status')).toContain('Signed out');
    });
    expect(textOf('auth-cause')).toBe('Session ended. Sign in again.');
  });

  it('never names an account the server did not choose', async () => {
    const double = await signedIn();
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

describe('Consumer Web memberships', () => {
  it('says paid memberships are unavailable and offers no way to buy', async () => {
    await signedIn();
    await click('nav-memberships');
    await screen.findByTestId('memberships-commerce');

    // Said once, plainly, instead of a control that refuses. No payment
    // provider is approved and no commercial terms are published, so a
    // Subscribe button would describe a product that does not exist.
    expect(textOf('memberships-commerce')).toContain('not available');
    expect(textOf('memberships-empty')).toContain('not paying for anything');
    const markup = document.body.textContent;
    for (const forbidden of [
      'Subscribe',
      'Buy',
      'Upgrade',
      'Checkout',
      'Pay',
    ]) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('shows what the server says is being paid for, and grants nothing for a lapse', async () => {
    await signedIn({
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
    await click('nav-memberships');
    const row = await screen.findByTestId('membership-sub-1');

    // `past_due` grants nothing, and the surface says so rather than implying a
    // grace period nobody has approved.
    expect(row.textContent).toContain('15.00 USD');
    expect(row.textContent).toContain('access is not active');
  });
});
