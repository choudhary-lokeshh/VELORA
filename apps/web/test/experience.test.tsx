import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { maximumProfileLanguages } from '@velora/validation';

import { ConversationThread } from '../src/product/conversations';
import { Discovery } from '../src/product/discovery';
import { Introductions } from '../src/product/introductions';
import { LanguagePicker } from '../src/product/language-picker';
import { SentGifts } from '../src/product/gifts';
import { ClubDestination } from '../src/product/club';
import { Welcome } from '../src/product/onboarding';
import { Wallet } from '../src/product/wallet';
import { Segmented, TabPanel } from '../src/design/primitives';
import {
  admittedState,
  createApiDouble,
  emptyState,
  otherPersonId,
} from './support/api-double';
import { navigations, resetNavigation } from './support/navigation';
import { renderProduct, testApiBaseUrl } from './support/render';

/**
 * The refinements this surface got when it was driven rather than read.
 *
 * Each of these was a real thing somebody using the product would have hit: a
 * group that could not be linked to and opened empty while work waited beside
 * it, a gift history that lost the gift, a refusal with the reason removed, a
 * tab strip that promised keyboard behaviour it did not have, and a progress
 * indicator that said which step you were on in colour alone.
 */

afterEach(cleanup);

const anyRender = (
  ui: Parameters<typeof renderProduct>[0],
  state = admittedState(),
) => renderProduct(ui, createApiDouble(state), { pathname: '/introductions' });

describe('introductions keep the group in the address', () => {
  it('opens the group with something in it rather than the first one', async () => {
    const state = admittedState();
    state.introductions = [
      {
        counterpart: {
          displayName: 'Rae Adeyemi',
          id: otherPersonId,
          media: [],
          sharedLanguages: ['en'],
        },
        createdAt: new Date().toISOString(),
        id: '33333333-3333-4333-8333-333333333333',
        role: 'initiator',
        state: 'pending',
      },
    ];
    anyRender(<Introductions />, state);

    // Nobody is waiting on this person, so opening "Waiting on you" would be
    // opening an empty page with the only row one tab away.
    await waitFor(() => {
      expect(screen.getByTestId('introductions-you-reached-out')).toBeTruthy();
    });
    expect(
      screen
        .getByTestId('segment-you-reached-out')
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('does not present a page of counts as a total', async () => {
    const state = admittedState();
    state.moreIntroductions = true;
    state.introductions = [
      {
        counterpart: {
          displayName: 'Rae Adeyemi',
          id: otherPersonId,
          media: [],
          sharedLanguages: ['en'],
        },
        createdAt: new Date().toISOString(),
        id: '33333333-3333-4333-8333-333333333333',
        role: 'initiator',
        state: 'pending',
      },
    ];
    anyRender(<Introductions />, state);

    // The three numbers beside the group names are counted from one page. A
    // count is the one thing on a partial list that reads as a total, so the
    // page says which it is rather than leaving somebody to assume.
    await waitFor(() => {
      expect(
        screen.getByText(/These counts describe what has been loaded so far/u),
      ).toBeTruthy();
    });
  });

  it('says nothing about loading when the server sent everything', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    await waitFor(() => {
      expect(screen.getByTestId('segment-mutual')).toBeTruthy();
    });
    expect(
      screen.queryByText(/These counts describe what has been loaded so far/u),
    ).toBeNull();
  });

  it('puts the chosen group in the address, and reads it back', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    fireEvent.click(await screen.findByTestId('segment-mutual'));

    await waitFor(() => {
      expect(screen.getByTestId('introductions-empty-mutual')).toBeTruthy();
    });
    // `replace`, so Back leaves the page rather than walking every group tried.
    expect(navigations().at(-1)).toEqual({
      kind: 'replace',
      path: '/introductions?show=mutual',
    });
  });

  it('opens the group a link named', async () => {
    resetNavigation('/introductions', 'show=mutual');
    const double = createApiDouble(admittedState());
    renderProduct(<Introductions />, double, {
      pathname: '/introductions',
      search: 'show=mutual',
    });

    await waitFor(() => {
      expect(screen.getByTestId('introductions-empty-mutual')).toBeTruthy();
    });
  });
});

describe('a tab strip behaves the way its role promises', () => {
  const options = [
    { label: 'One', value: 'one' as const },
    { label: 'Two', value: 'two' as const },
    { label: 'Three', value: 'three' as const },
  ];

  function strip(value: 'one' | 'two' | 'three') {
    const chosen: string[] = [];
    renderProduct(
      <Segmented
        label="Which"
        onChange={(next) => {
          chosen.push(next);
        }}
        options={options}
        value={value}
      />,
      createApiDouble(emptyState()),
    );
    return chosen;
  }

  it('is one stop on the Tab key rather than one per option', () => {
    strip('two');
    expect(screen.getByTestId('segment-one').tabIndex).toBe(-1);
    expect(screen.getByTestId('segment-two').tabIndex).toBe(0);
    expect(screen.getByTestId('segment-three').tabIndex).toBe(-1);
  });

  it('moves with the arrow keys, and wraps', () => {
    const forward = strip('one');
    fireEvent.keyDown(screen.getByTestId('segment-one'), {
      key: 'ArrowRight',
    });
    expect(forward).toEqual(['two']);
    cleanup();

    const back = strip('one');
    fireEvent.keyDown(screen.getByTestId('segment-one'), { key: 'ArrowLeft' });
    expect(back).toEqual(['three']);
  });

  it('goes to the ends with Home and End', () => {
    const chosen = strip('two');
    fireEvent.keyDown(screen.getByTestId('segment-two'), { key: 'End' });
    fireEvent.keyDown(screen.getByTestId('segment-two'), { key: 'Home' });
    expect(chosen).toEqual(['three', 'one']);
  });

  it('says which panel each tab controls, and the panel says which tab it is', () => {
    render(
      <>
        <Segmented
          id="browse"
          label="Which"
          onChange={() => undefined}
          options={[
            { label: 'One', value: 'one' },
            { count: 2, label: 'Two', value: 'two' },
          ]}
          value="two"
        />
        <TabPanel group="browse" value="two">
          <p>What two shows</p>
        </TabPanel>
      </>,
    );

    const panel = screen.getByRole('tabpanel');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    }
    // Named by the selected tab, and that tab's name keeps its count apart
    // from its label rather than reading "Two2". jsdom's name computation
    // trims the space a browser keeps after the comma, so only the comma is
    // insisted on.
    const named = /^Two, ?2$/u;
    expect(screen.getByRole('tabpanel', { name: named })).toBe(panel);
    expect(screen.getByRole('tab', { name: named, selected: true })).toBe(
      screen.getByTestId('segment-two'),
    );
  });
});

describe('sent gifts say what was sent, and what happened to it', () => {
  function withGifts(state: ReturnType<typeof admittedState>) {
    state.sentGifts = [
      {
        createdAt: '2026-08-01T10:00:00.000Z',
        creator: { displayName: 'Ember Vale Ceramics', handle: 'embervale' },
        gift: { id: 'g1', name: 'Rose', visual: 'rose' },
        id: 'gift-sent',
        price: { amountMinor: '150', currency: 'USD' },
        sentAt: '2026-08-01T10:00:02.000Z',
        state: 'sent',
      },
      {
        createdAt: '2026-08-02T10:00:00.000Z',
        creator: { displayName: 'North Sound', handle: 'northsound' },
        gift: { id: 'g2', name: 'Crown', visual: 'crown' },
        id: 'gift-failed',
        price: { amountMinor: '2500', currency: 'USD' },
        state: 'failed',
      },
    ];
    return state;
  }

  it('draws the gift somebody chose and links the creator it went to', async () => {
    const double = createApiDouble(withGifts(admittedState()));
    renderProduct(<SentGifts />, double, { pathname: '/you/gifts' });

    const row = await screen.findByTestId('sent-gift-gift-sent');
    // The silhouette itself, not the first letter of its name.
    expect(row.querySelector('svg path')?.getAttribute('d')).toContain(
      'M12 4a',
    );
    expect(row.querySelector('a')?.getAttribute('href')).toBe(
      '/c/embervale?from=%2Fyou%2Fgifts',
    );
    // Through the product's own money formatter rather than assembled here.
    expect(row.textContent).toContain('1.50 USD');
  });

  it('does not let a failed gift look like a quiet one', async () => {
    const double = createApiDouble(withGifts(admittedState()));
    renderProduct(<SentGifts />, double, { pathname: '/you/gifts' });

    const row = await screen.findByTestId('sent-gift-gift-failed');
    expect(row.querySelector('.v-badge')?.className).toContain(
      'v-badge--critical',
    );
    // And says what it means, because "Did not go through" does not say
    // whether anything was charged.
    expect(
      screen.getByTestId('sent-gift-meaning-gift-failed').textContent,
    ).toContain('Nothing was charged');
  });

  it('says where a gift comes from when there are none', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<SentGifts />, double, { pathname: '/you/gifts' });
    expect(await screen.findByTestId('sent-gifts-empty')).toBeTruthy();
  });
});

describe('a club that cannot be sold says which gate is shut', () => {
  it('names the reason rather than only refusing', async () => {
    const state = admittedState();
    state.clubDetails['embervale/kiln'] = {
      club: {
        benefits: ['Kiln notes'],
        description: 'Work in progress.',
        id: 'club-1',
        name: 'The Kiln Room',
        slug: 'kiln',
      },
      content: [],
      creatorHandle: 'embervale',
    };
    state.membershipOffers.embervale = {
      gates: ['consumer_country'],
      offers: [
        {
          id: 'offer-1',
          mode: 'subscription',
          prices: [
            {
              amount: { amountMinor: '1200', currency: 'USD' },
              id: 'price-1',
              interval: 'month',
            },
          ],
          resource: { id: 'club-1', type: 'club' },
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
    const double = createApiDouble(state);
    renderProduct(
      <ClubDestination
        apiBaseUrl={testApiBaseUrl}
        fetchImplementation={double.fetch}
        handle="embervale"
        signedIn
        slug="kiln"
      />,
      double,
      { pathname: '/c/embervale/club/kiln' },
    );

    const blocked = await screen.findByTestId('club-join-blocked');
    expect(blocked.textContent).toContain(
      'VELORA has not been approved to sell in your country',
    );
    // And no control that would refuse when pressed.
    expect(screen.queryByTestId('club-join')).toBeNull();
  });
});

describe('admission says which step somebody is on', () => {
  it('marks the current step and writes the count out', async () => {
    const state = emptyState();
    state.account = null;
    const double = createApiDouble(state);
    renderProduct(<Welcome />, double, { pathname: '/welcome' });

    const progress = await screen.findByTestId('welcome-progress');
    // Named, so a screen reader says what the list is before reading it.
    expect(progress.getAttribute('aria-label')).toBe('Setting up your account');
    // Exactly one step is the current one, and it says so in the markup rather
    // than only in a fill colour.
    expect(progress.querySelectorAll('[aria-current="step"]').length).toBe(1);
    expect(screen.getByTestId('welcome-step-count').textContent).toBe(
      'Step 1 of 4',
    );
  });
});

/**
 * The things a screen reader is told, which are not the things a screen shows.
 *
 * Each of these was silent: a region announced by nothing because it was
 * inserted at the same moment as its content, a thread whose two voices were
 * separated only by which edge they sat against, and a message that failed
 * with the retry sitting quietly underneath it.
 */
describe('a control says what kind of choice it is', () => {
  it('is a radio group when the choice lives inside a form', () => {
    // The same strip picks which half of Discover is being read — a tab, and
    // announced as one — and how often somebody pays on a join form, which is
    // not. Telling a reader the page is about to change when it is not is a
    // description of something that does not happen.
    const view = render(
      <Segmented
        as="radiogroup"
        label="How often you pay"
        onChange={() => undefined}
        options={[
          { label: 'Monthly', value: 'month' },
          { label: 'Yearly', value: 'year' },
        ]}
        value="month"
      />,
    );

    expect(view.container.querySelector('[role="radiogroup"]')).not.toBeNull();
    const chosen = view.container.querySelector('[role="radio"]');
    expect(chosen?.getAttribute('aria-checked')).toBe('true');
    expect(view.container.querySelector('[role="tab"]')).toBeNull();
  });
});

describe('what somebody who cannot see the screen is told', () => {
  it('keeps the toast region in the document before there is a toast', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Introductions />, double, { pathname: '/introductions' });

    // A reader announces changes *inside* a region it is already watching.
    // Inserting the region together with its first toast is a change to the
    // document instead, and it is dropped — which made every confirmation and
    // every failure in the product unannounced.
    const [region] = await screen.findAllByTestId('toaster');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toBe('');
  });

  it('says who said each message rather than which side it is on', async () => {
    const conversationId = '88888888-8888-4888-8888-888888888888';
    const double = createApiDouble({
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
      messages: [
        {
          body: 'Hello there',
          clientMessageId: 'seed-1',
          conversationId,
          createdAt: '2026-08-14T12:00:00.000Z',
          id: '99999999-9999-4999-8999-999999999901',
          senderId: otherPersonId,
          sequence: 1,
        },
      ],
    });
    renderProduct(
      <ConversationThread conversationId={conversationId} />,
      double,
      {
        pathname: `/messages/${conversationId}`,
      },
    );

    const thread = await screen.findByTestId('messages');
    // A log region, because a message arrives rather than being asked for.
    expect(thread.getAttribute('role')).toBe('log');
    expect(thread.getAttribute('aria-live')).toBe('polite');

    // And each bubble carries its author in words. Alignment and colour were
    // the only things that did, and neither is read out. Sent rather than
    // seeded, so the assertion does not depend on what a fixture happens to
    // have put in the thread.
    fireEvent.change(screen.getByTestId('message-body'), {
      target: { value: 'who said it' },
    });
    fireEvent.click(screen.getByTestId('message-send'));
    await waitFor(() => {
      expect(screen.getByTestId('messages').textContent).toContain(
        'You said: ',
      );
    });
  });
});

/**
 * Where focus goes when the thing holding it is taken away.
 *
 * The control somebody pressed was inside the row it removed, so focus was left
 * on nothing and the next Tab started again from the top of the document.
 */
describe('focus has somewhere to go after a removal', () => {
  it('lands on the people still listed after a pass', async () => {
    const state = admittedState();
    const [first] = state.candidates;
    if (first === undefined) throw new Error('fixture needs a candidate');
    state.candidates = [
      first,
      {
        ...first,
        displayName: 'Sam',
        id: '77777777-7777-4777-8777-777777777777',
      },
    ];
    renderProduct(<Discovery />, createApiDouble(state), {
      pathname: '/discover',
    });

    fireEvent.click(await screen.findByTestId(`discovery-pass-${first.id}`));

    await waitFor(() => {
      expect(screen.queryByTestId(`candidate-${first.id}`)).toBeNull();
    });
    expect(document.activeElement).toBe(
      screen.getByTestId('discovery-candidates'),
    );
  });

  it('lands on what replaced the list when the last person leaves it', async () => {
    renderProduct(<Discovery />, createApiDouble(admittedState()), {
      pathname: '/discover',
    });

    fireEvent.click(
      await screen.findByTestId(`discovery-pass-${otherPersonId}`),
    );

    const empty = await screen.findByTestId('discovery-empty');
    expect(document.activeElement).toBe(empty);
  });

  function Languages({ initial }: { readonly initial: readonly string[] }) {
    const [value, setValue] = useState(initial);
    return <LanguagePicker onChange={setValue} value={value} />;
  }

  it('returns to the language field when a language is removed', () => {
    render(<Languages initial={['en', 'es']} />);

    fireEvent.click(screen.getByTestId('language-remove-es'));

    expect(screen.queryByTestId('language-remove-es')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('language-input'));
  });

  it('returns to the field even when a full list had disabled it', () => {
    const full = ['en', 'es', 'fr', 'de', 'it'].slice(
      0,
      maximumProfileLanguages,
    );
    render(<Languages initial={full} />);
    const field = screen.getByTestId<HTMLInputElement>('language-input');
    expect(field.disabled).toBe(true);

    fireEvent.click(screen.getByTestId(`language-remove-${full[0] ?? ''}`));

    expect(field.disabled).toBe(false);
    expect(document.activeElement).toBe(field);
  });
});

describe('a session ended everywhere is ended on purpose', () => {
  it('asks first on Welcome, the same way Settings does', async () => {
    const state = emptyState();
    state.account = null;
    const double = createApiDouble(state);
    renderProduct(<Welcome />, double, { pathname: '/welcome' });

    fireEvent.click(await screen.findByTestId('auth-sign-out-everywhere'));

    const dialog = await screen.findByTestId('sign-out-everywhere');
    expect(dialog.textContent).toContain('Sign out on every device?');
    // Nothing has ended yet: every other device is still signed in.
    expect(
      double.calls.some((call) => call.path === '/v1/auth/logout-all'),
    ).toBe(false);

    fireEvent.click(screen.getByTestId('sign-out-everywhere-accept'));
    await waitFor(() => {
      expect(
        double.calls.some((call) => call.path === '/v1/auth/logout-all'),
      ).toBe(true);
    });
  });
});

describe('a history that could not be read again says so where it is', () => {
  it('shows the failure inside the history with a retry beside it', async () => {
    const state = admittedState();
    state.wallet = { ...state.wallet, enabled: true };
    const double = createApiDouble(state);
    renderProduct(<Wallet />, double, { pathname: '/you/wallet' });
    await screen.findByTestId('wallet-history-empty');

    // The grant succeeds and the history read after it does not.
    double.failNext('/v1/wallet/activity', 'GET');
    fireEvent.click(screen.getByTestId('wallet-grant'));

    const history = screen.getByTestId('wallet-history');
    const failure = await within(history).findByTestId('wallet-message');
    expect(failure.getAttribute('role')).toBe('alert');

    fireEvent.click(within(history).getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(history.textContent).toContain('Development grant');
    });
    expect(within(history).queryByTestId('wallet-message')).toBeNull();
  });
});
