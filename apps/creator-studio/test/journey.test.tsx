import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StudioGate, PublicGate, ActivationGate } from '../src/app/gate';
import { Account } from '../src/product/account';
import { Activation } from '../src/product/activation';
import { Catalog } from '../src/product/catalog';
import { ClubScreen } from '../src/product/club';
import { Clubs } from '../src/product/clubs';
import { EditContent, NewContent } from '../src/product/content-editor';
import { Earnings } from '../src/product/earnings';
import { Home } from '../src/product/home';
import { Payouts } from '../src/product/payouts';
import { PublicPreview } from '../src/product/preview';
import { ProfileScreen } from '../src/product/profile';
import { Selling } from '../src/product/selling';
import { SignIn } from '../src/product/sign-in';
import {
  activeCreatorState,
  createCreatorApiDouble,
  emptyCreatorState,
  requiredCreatorPolicies,
  type CreatorApiDoubleState,
} from './support/api-double';
import { navigations } from './support/navigation';
import { renderStudio } from './support/render';

/**
 * Creator Studio, driven through the real contract.
 *
 * Every assertion below goes through the generated client and a `fetch` that
 * answers the real paths with the real shapes, so what passes is evidence about
 * the product rather than about the test's own mocks. Nothing in `src/` knows
 * the double exists.
 */

const clipboard = { writeText: vi.fn(() => Promise.resolve()) };

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
  clipboard.writeText.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A creator with a public page already claimed. */
function withProfile(
  overrides: Partial<CreatorApiDoubleState> = {},
): CreatorApiDoubleState {
  return {
    ...activeCreatorState(),
    profile: {
      bio: 'Ceramics, slowly.',
      displayName: 'Ember Vale',
      handle: 'embervale',
      links: [],
      publication: 'draft',
      version: 1,
    },
    ...overrides,
  };
}

/** The visible text of one element, for assertions about what a creator reads. */
function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('the door', () => {
  it('says what is behind the development sign-in rather than dressing it up', async () => {
    const double = createCreatorApiDouble(emptyCreatorState());
    renderStudio(
      <PublicGate>
        <SignIn />
      </PublicGate>,
      double,
      { pathname: '/sign-in' },
    );

    const notice = await screen.findByTestId('sign-in-development');
    expect(notice.textContent).toContain('no live sign-in provider');
    expect(notice.textContent).toContain('not checked');
  });

  it('refuses an empty identity without sending anything', async () => {
    const double = createCreatorApiDouble(emptyCreatorState());
    renderStudio(
      <PublicGate>
        <SignIn />
      </PublicGate>,
      double,
      { pathname: '/sign-in' },
    );

    fireEvent.click(await screen.findByTestId('auth-sign-in'));
    await settle();

    expect(screen.getByText('Enter an address to continue.')).toBeDefined();
    expect(
      double.calls.some((call) => call.path === '/v1/auth/local/web-sessions'),
    ).toBe(false);
  });

  it('sends somebody without a session to sign in, carrying where they were going', async () => {
    const double = createCreatorApiDouble(emptyCreatorState());
    renderStudio(
      <StudioGate title="Catalog">
        <Catalog />
      </StudioGate>,
      double,
      { pathname: '/catalog' },
    );

    await waitFor(() => {
      expect(navigations()).toContainEqual({
        kind: 'replace',
        path: '/sign-in?next=%2Fcatalog',
      });
    });
  });

  it('sends a signed-in creator with no capability to the activation ladder', async () => {
    const double = createCreatorApiDouble({
      ...emptyCreatorState(),
      session: {
        absoluteExpiresAt: '2026-08-15T20:00:00.000Z',
        accountId: 'a',
        assurance: 'single_factor',
        assuranceEstablishedAt: '2026-08-15T12:00:00.000Z',
        audience: 'creator_studio',
        authenticatedAt: '2026-08-15T12:00:00.000Z',
        idleExpiresAt: '2026-08-15T12:30:00.000Z',
      },
    });
    renderStudio(
      <StudioGate title="Home">
        <Home />
      </StudioGate>,
      double,
      { pathname: '/home' },
    );

    await waitFor(() => {
      expect(navigations()).toContainEqual({ kind: 'replace', path: '/start' });
    });
  });
});

describe('becoming a creator', () => {
  it('says what creator access is and, just as plainly, what it is not', async () => {
    const double = createCreatorApiDouble({
      ...emptyCreatorState(),
      session: activeCreatorState().session,
    });
    renderStudio(
      <ActivationGate>
        <Activation />
      </ActivationGate>,
      double,
      { pathname: '/start' },
    );

    expect(await screen.findByTestId('creator-what-you-get')).toBeDefined();
    const excluded = screen.getByTestId('creator-not-included');
    expect(excluded.textContent).toContain('not payment approval');
    expect(excluded.textContent).toContain('identity verification');
    expect(excluded.textContent).toContain('mature content');
  });

  it('walks activation, then policy acceptance, from server answers alone', async () => {
    const double = createCreatorApiDouble({
      ...emptyCreatorState(),
      session: activeCreatorState().session,
    });
    renderStudio(
      <ActivationGate>
        <Activation />
      </ActivationGate>,
      double,
      { pathname: '/start' },
    );

    fireEvent.click(await screen.findByTestId('creator-onboard'));

    const policies = await screen.findByTestId('creator-outstanding-policies');
    expect(policies.textContent).toContain('Creator terms');
    expect(policies.textContent).toContain('Creator content policy');
    // The version travels back, so an acceptance is of what was on the screen.
    fireEvent.click(screen.getByTestId('creator-accept-policies'));

    await waitFor(() => {
      expect(navigations()).toContainEqual({ kind: 'replace', path: '/home' });
    });
    const acknowledgement = double.calls.find(
      (call) => call.path === '/v1/creator/onboarding/acknowledgements',
    );
    expect(acknowledgement?.body).toEqual({
      acknowledgements: requiredCreatorPolicies,
    });
  });

  it('offers no control at all when the next step belongs to another surface', async () => {
    const double = createCreatorApiDouble({
      ...emptyCreatorState(),
      account: {
        createdAt: '2026-08-15T12:00:00.000Z',
        id: 'creator',
        status: 'applicant',
      },
      adultGateReason: 'adult_declaration_missing',
      adultGateSatisfied: false,
      outstandingPolicies: [...requiredCreatorPolicies],
      session: activeCreatorState().session,
    });
    renderStudio(
      <ActivationGate>
        <Activation />
      </ActivationGate>,
      double,
      { pathname: '/start' },
    );

    const gate = await screen.findByTestId('creator-adult-gate');
    expect(gate.textContent).toContain(
      'Confirm on VELORA that you are an adult',
    );
    expect(screen.queryByTestId('creator-accept-policies')).toBeNull();
    expect(screen.queryByRole('button', { name: /adult/iu })).toBeNull();
  });

  it('tells a suspended creator that the decision is not theirs to undo', async () => {
    const double = createCreatorApiDouble({
      ...emptyCreatorState(),
      account: {
        createdAt: '2026-08-15T12:00:00.000Z',
        id: 'creator',
        status: 'suspended',
        statusReason: 'safety_enforcement',
      },
      outstandingPolicies: [...requiredCreatorPolicies],
      session: activeCreatorState().session,
    });
    renderStudio(
      <ActivationGate>
        <Activation />
      </ActivationGate>,
      double,
      { pathname: '/start' },
    );

    const blocked = await screen.findByTestId('creator-standing-blocked');
    expect(blocked.textContent).toContain('following a safety decision');
    expect(blocked.textContent).toContain('still yours');
  });
});

describe('home', () => {
  it('counts only what the server returned, and offers one next step', async () => {
    const double = createCreatorApiDouble({
      ...withProfile(),
      clubs: [
        {
          id: 'club-1',
          lifecycle: 'published',
          memberCount: 3,
          name: 'Inner Circle',
          slug: 'inner',
          version: 1,
        },
      ],
      content: [
        {
          id: 'content-1',
          lifecycle: 'draft',
          title: 'A first post',
          version: 1,
          visibility: 'public',
        },
        {
          id: 'content-2',
          lifecycle: 'published',
          title: 'A second post',
          version: 1,
          visibility: 'public',
        },
      ],
    });
    renderStudio(<Home />, double, { pathname: '/home' });

    expect((await screen.findByTestId('home-drafts')).textContent).toContain(
      '1',
    );
    expect(textOf('home-published')).toContain('1');
    expect(textOf('home-clubs')).toContain('1');
    expect(textOf('home-members')).toContain('3');
    // The page is a draft, which is the most useful thing to say next. It
    // appears once both reads have answered, which is a moment after the counts.
    await waitFor(() => {
      expect(textOf('home-next-step')).toContain(
        'Your page is not visible yet',
      );
    });
  });

  it('shows no figure the platform does not compute', async () => {
    const double = createCreatorApiDouble(withProfile());
    const { container } = renderStudio(<Home />, double, { pathname: '/home' });
    await screen.findByTestId('home-counts');

    const text = container.textContent;
    for (const forbidden of [
      'followers',
      'Followers',
      'views',
      'Views',
      'revenue',
      'Revenue',
      'engagement',
      'subscribers',
      'Subscribers',
      'this month',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('shows ledger money and recent real activity without exposing a gift sender', async () => {
    const double = createCreatorApiDouble({
      ...withProfile(),
      content: [
        {
          id: 'content-1',
          lifecycle: 'published',
          title: 'Kiln notes',
          version: 1,
          visibility: 'public',
        },
      ],
      earnings: [
        {
          currency: 'USD',
          disputed: '0',
          gross: '5000',
          payable: '3450',
          platform: '1550',
          reversed: '0',
          tax: '0',
        },
      ],
      receivedGifts: [
        {
          createdAt: '2026-08-16T12:00:00.000Z',
          earning: { amountMinor: '700', currency: 'USD' },
          gift: {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Golden Spark',
            visual: 'spark',
          },
          gross: { amountMinor: '1000', currency: 'USD' },
          id: '22222222-2222-4222-8222-222222222222',
          senderVisibility: 'withheld',
          sentAt: '2026-08-16T12:00:01.000Z',
          state: 'sent',
        },
      ],
    });
    renderStudio(<Home />, double, { pathname: '/home' });

    expect(
      (await screen.findByTestId('home-money-USD-payable')).textContent,
    ).toContain('34.50 USD');
    const recent = await screen.findByTestId('home-recent-list');
    expect(recent.textContent).toContain('Received Golden Spark');
    expect(recent.textContent).toContain('7.00 USD');
    expect(recent.textContent).toContain('sender identity withheld');
    expect(recent.textContent).not.toContain('consumer');
  });
});

describe('the public page', () => {
  it('keeps an AI bio as an editable Studio draft until Save', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    fireEvent.change(await screen.findByTestId('creator-bio'), {
      target: { value: 'wheel-thrown pieces' },
    });
    fireEvent.click(screen.getByTestId('creator-profile-ai-generate'));
    expect(
      (
        await screen.findByTestId<HTMLTextAreaElement>(
          'creator-profile-ai-suggestion',
        )
      ).value,
    ).toBe('Studio draft: wheel-thrown pieces');
    fireEvent.click(screen.getByTestId('creator-profile-ai-replace'));
    expect(screen.getByTestId<HTMLTextAreaElement>('creator-bio').value).toBe(
      'Studio draft: wheel-thrown pieces',
    );
    expect(
      double.calls.some(
        (call) => call.path === '/v1/creator/profile' && call.method === 'POST',
      ),
    ).toBe(false);
  });

  it('claims a handle and keeps publishing a separate decision', async () => {
    const double = createCreatorApiDouble(activeCreatorState());
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    fireEvent.change(await screen.findByTestId('creator-handle'), {
      target: { value: 'embervale' },
    });
    fireEvent.change(screen.getByTestId('creator-display-name'), {
      target: { value: 'Ember Vale' },
    });
    fireEvent.click(screen.getByTestId('creator-save-profile'));

    expect(
      (await screen.findByTestId('creator-handle-fixed')).textContent,
    ).toContain('@embervale');
    // Saving published nothing.
    expect(textOf('creator-publication')).toContain('Draft');
    expect(
      double.calls.some(
        (call) => call.path === '/v1/creator/profile/publication',
      ),
    ).toBe(false);
  });

  it('refuses a handle the contract would refuse, before sending it', async () => {
    const double = createCreatorApiDouble(activeCreatorState());
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    fireEvent.change(await screen.findByTestId('creator-handle'), {
      target: { value: '-nope-' },
    });
    fireEvent.change(screen.getByTestId('creator-display-name'), {
      target: { value: 'Ember Vale' },
    });
    fireEvent.click(screen.getByTestId('creator-save-profile'));
    await settle();

    expect(screen.getByText(/Use 3 to 30 letters/u)).toBeDefined();
    expect(
      double.calls.some(
        (call) => call.path === '/v1/creator/profile' && call.method === 'POST',
      ),
    ).toBe(false);
  });

  it('carries existing links through a save that did not touch them', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        profile: {
          displayName: 'Ember Vale',
          handle: 'embervale',
          links: [{ label: 'Shop', url: 'https://example.com/shop' }],
          publication: 'draft',
          version: 1,
        },
      }),
    );
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    fireEvent.change(await screen.findByTestId('creator-bio'), {
      target: { value: 'Wheel-thrown, wood-fired.' },
    });
    fireEvent.click(screen.getByTestId('creator-save-profile'));
    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/creator/profile' && call.method === 'POST',
        ),
      ).toBe(true);
    });

    const save = double.calls.find(
      (call) => call.path === '/v1/creator/profile' && call.method === 'POST',
    );
    expect(save?.body).toMatchObject({
      links: [{ label: 'Shop', url: 'https://example.com/shop' }],
    });
  });

  it('adds and removes a link', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    fireEvent.click(await screen.findByTestId('creator-link-add'));
    fireEvent.change(screen.getByTestId('creator-link-label-0'), {
      target: { value: 'Shop' },
    });
    fireEvent.change(screen.getByTestId('creator-link-url-0'), {
      target: { value: 'https://example.com/shop' },
    });
    fireEvent.click(screen.getByTestId('creator-save-profile'));
    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/creator/profile' && call.method === 'POST',
        ),
      ).toBe(true);
    });

    expect(
      double.calls.find(
        (call) => call.path === '/v1/creator/profile' && call.method === 'POST',
      )?.body,
    ).toMatchObject({
      links: [{ label: 'Shop', url: 'https://example.com/shop' }],
    });
  });

  it('refuses a stale edit rather than overwriting a newer one', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });
    await screen.findByTestId('creator-handle-fixed');

    double.refuseNext('/v1/creator/profile', 'POST', 409, 'STATE_CONFLICT');
    fireEvent.change(screen.getByTestId('creator-display-name'), {
      target: { value: 'Ember V' },
    });
    const save = screen.getByTestId('creator-save-profile');
    await waitFor(() => {
      expect((save as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(save);

    expect(
      (await screen.findByTestId('creator-profile-error')).textContent,
    ).toContain('Reload and try again');
  });

  /**
   * A refused save is exactly when somebody most needs to still be looking at
   * what they wrote.
   */
  it('keeps what was typed, and says why, when a handle is already taken', async () => {
    const double = createCreatorApiDouble({
      ...activeCreatorState(),
      takenHandles: ['embervale'],
    });
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    fireEvent.change(await screen.findByTestId('creator-handle'), {
      target: { value: 'embervale' },
    });
    fireEvent.change(screen.getByTestId('creator-display-name'), {
      target: { value: 'Ember Vale' },
    });
    fireEvent.change(screen.getByTestId('creator-bio'), {
      target: { value: 'Ceramics, slowly.' },
    });
    fireEvent.click(screen.getByTestId('creator-save-profile'));

    expect(
      (await screen.findByTestId('creator-profile-error')).textContent,
    ).toContain('already taken');
    // The re-read that follows a refusal must not take the form with it.
    expect(screen.getByTestId<HTMLInputElement>('creator-handle').value).toBe(
      'embervale',
    );
    expect(
      screen.getByTestId<HTMLInputElement>('creator-display-name').value,
    ).toBe('Ember Vale');
    expect(screen.getByTestId<HTMLTextAreaElement>('creator-bio').value).toBe(
      'Ceramics, slowly.',
    );
  });

  it('offers a control for each page image slot', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    expect(
      await screen.findByTestId('creator-image-input-avatar'),
    ).toBeTruthy();
    expect(screen.getByTestId('creator-image-input-cover')).toBeTruthy();
    // Nothing claims the platform cannot store an image any more, because it
    // can — the storage *provider* decision is a different question and this
    // screen was never the place that answered it.
    expect(screen.queryByTestId('creator-media-blocked')).toBeNull();
  });

  it('shows an image its creator added, and offers to replace it', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        profile: {
          ...(withProfile().profile ?? {
            displayName: '',
            handle: '',
            links: [],
            publication: 'draft' as const,
            version: 1,
          }),
          media: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              slot: 'avatar' as const,
              state: 'ready',
            },
          ],
        },
      }),
    );
    renderStudio(<ProfileScreen />, double, { pathname: '/profile' });

    const tile = await screen.findByTestId('creator-media-avatar');
    expect(tile.getAttribute('data-state')).toBe('ready');
    expect(
      screen.getByTestId('creator-image-input-avatar').closest('label')
        ?.textContent,
    ).toContain('Replace');
  });
});

describe('the preview', () => {
  it('shows a draft page as what a visitor actually gets: nothing', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<PublicPreview />, double, { pathname: '/profile/preview' });

    expect((await screen.findByTestId('preview-draft')).textContent).toContain(
      'Nobody can open',
    );
    expect((await screen.findByTestId('preview-empty')).textContent).toContain(
      'A visitor sees nothing',
    );
  });

  it('shows a published page as a visitor sees it, without drafts', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        profile: {
          bio: 'Ceramics, slowly.',
          displayName: 'Ember Vale',
          handle: 'embervale',
          links: [],
          media: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              slot: 'avatar',
              state: 'ready',
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              slot: 'cover',
              state: 'ready',
            },
          ],
          publication: 'published',
          publishedAt: '2026-08-15T12:00:00.000Z',
          version: 2,
        },
        content: [
          {
            id: 'content-1',
            lifecycle: 'published',
            media: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                position: 0,
                state: 'ready',
              },
            ],
            title: 'Visible post',
            version: 1,
            visibility: 'public',
          },
          {
            id: 'content-2',
            lifecycle: 'draft',
            title: 'Hidden draft',
            version: 1,
            visibility: 'public',
          },
        ],
      }),
    );
    renderStudio(<PublicPreview />, double, { pathname: '/profile/preview' });

    const catalog = await screen.findByTestId('preview-catalog');
    expect(catalog.textContent).toContain('Visible post');
    expect(catalog.textContent).not.toContain('Hidden draft');
    expect(
      (await screen.findByTestId('preview-cover')).getAttribute('src'),
    ).toBe('https://media.test/22222222-2222-4222-8222-222222222222');
    expect(
      (
        await screen.findByTestId('preview-content-image-content-1')
      ).getAttribute('src'),
    ).toBe('https://media.test/33333333-3333-4333-8333-333333333333');
  });
});

describe('the catalog', () => {
  it('keeps an edited AI caption in the draft until the creator saves', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<NewContent />, double, { pathname: '/catalog/new' });

    fireEvent.change(await screen.findByTestId('content-summary'), {
      target: { value: 'morning light on clay' },
    });
    fireEvent.click(screen.getByTestId('content-caption-ai-generate'));
    const suggestion = await screen.findByTestId<HTMLTextAreaElement>(
      'content-caption-ai-suggestion',
    );
    fireEvent.change(suggestion, {
      target: { value: 'Morning light, shaped slowly by hand.' },
    });
    fireEvent.click(screen.getByTestId('content-caption-ai-replace'));

    expect(
      screen.getByTestId<HTMLTextAreaElement>('content-summary').value,
    ).toBe('Morning light, shaped slowly by hand.');
    expect(
      double.calls.some(
        (call) =>
          (call.path === '/v1/creator/content' ||
            call.path === '/v1/creator/content/lifecycle') &&
          call.method === 'POST',
      ),
    ).toBe(false);
  });

  it('saves a draft and does not publish it', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<NewContent />, double, { pathname: '/catalog/new' });

    fireEvent.change(await screen.findByTestId('content-title'), {
      target: { value: 'A first post' },
    });
    fireEvent.change(screen.getByTestId('content-body'), {
      target: { value: 'The body of the thing.' },
    });
    await waitFor(() => {
      expect(
        screen.getByTestId<HTMLButtonElement>('content-save').disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId('content-save'));
    await waitFor(() => {
      expect(double.state.content).toHaveLength(1);
    });

    const save = double.calls.find(
      (call) => call.path === '/v1/creator/content' && call.method === 'POST',
    );
    expect(save?.body).toMatchObject({
      body: 'The body of the thing.',
      title: 'A first post',
      visibility: 'public',
    });
    expect(double.state.content[0]?.lifecycle).toBe('draft');
  });

  it('warns that a members-only item with no club reaches nobody', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        content: [
          {
            id: 'content-1',
            lifecycle: 'draft',
            title: 'Members thing',
            version: 1,
            visibility: 'members_only',
          },
        ],
      }),
    );
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    expect(
      (await screen.findByTestId('content-unreachable-content-1')).textContent,
    ).toContain('Reaches nobody');
  });

  it('shows a ready item image in the catalog from the media exchange', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        content: [
          {
            id: 'content-1',
            lifecycle: 'draft',
            media: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                position: 0,
                state: 'ready',
              },
            ],
            title: 'Illustrated draft',
            version: 1,
            visibility: 'public',
          },
        ],
      }),
    );
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    expect(
      (await screen.findByTestId('content-image-content-1')).getAttribute(
        'src',
      ),
    ).toBe('https://media.test/44444444-4444-4444-8444-444444444444');
  });

  it('publishes from the list and reports the new state', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        content: [
          {
            id: 'content-1',
            lifecycle: 'draft',
            title: 'A first post',
            version: 1,
            visibility: 'public',
          },
        ],
      }),
    );
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    fireEvent.click(await screen.findByTestId('content-publish-content-1'));

    await waitFor(() => {
      expect(textOf('content-lifecycle-content-1')).toContain('Published');
    });
  });

  it('asks before archiving, and names what is being archived', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        content: [
          {
            id: 'content-1',
            lifecycle: 'published',
            title: 'A first post',
            version: 1,
            visibility: 'public',
          },
        ],
      }),
    );
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    fireEvent.click(await screen.findByTestId('content-archive-content-1'));
    const dialog = await screen.findByTestId('content-archive-confirm');
    expect(dialog.textContent).toContain('A first post');
    expect(
      double.calls.some(
        (call) => call.path === '/v1/creator/content/lifecycle',
      ),
    ).toBe(false);

    fireEvent.click(
      within(dialog).getByTestId('content-archive-confirm-accept'),
    );
    await waitFor(() => {
      expect(textOf('content-lifecycle-content-1')).toContain('Archived');
    });
  });

  /**
   * A list that blanked while it re-read would punish somebody for the app
   * being careful, and would move the row under a finger already on its way to
   * the next control.
   */
  it('keeps the list on the screen while it re-reads after a change', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        content: [
          {
            id: 'content-1',
            lifecycle: 'draft',
            title: 'A first post',
            version: 1,
            visibility: 'public',
          },
        ],
      }),
    );
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    fireEvent.click(await screen.findByTestId('content-publish-content-1'));
    // Still there, mid-flight, rather than replaced by placeholders.
    expect(screen.getByTestId('content-item-content-1')).toBeDefined();
    await waitFor(() => {
      expect(textOf('content-lifecycle-content-1')).toContain('Published');
    });
  });

  it('says how far its filter counts while there is more to load', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        content: Array.from({ length: 30 }, (_, index) => ({
          id: `content-${String(index + 1)}`,
          lifecycle: 'draft' as const,
          title: `Item ${String(index + 1)}`,
          version: 1,
          visibility: 'public' as const,
        })),
      }),
    );
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    expect(
      (await screen.findByTestId('catalog-partial')).textContent,
    ).toContain('25 items loaded so far');
    fireEvent.click(screen.getByTestId('catalog-load-more'));
    await waitFor(() => {
      expect(screen.queryByTestId('catalog-partial')).toBeNull();
    });
  });

  it('edits an existing item with its version', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        content: [
          {
            body: 'Original body.',
            id: 'content-1',
            lifecycle: 'draft',
            title: 'A first post',
            version: 3,
            visibility: 'public',
          },
        ],
      }),
    );
    renderStudio(<EditContent contentId="content-1" />, double, {
      params: { contentId: 'content-1' },
      pathname: '/catalog/content-1',
    });

    const body = await screen.findByTestId<HTMLTextAreaElement>('content-body');
    expect(body.value).toBe('Original body.');
    fireEvent.change(body, { target: { value: 'A revised body.' } });
    await waitFor(() => {
      expect(
        screen.getByTestId<HTMLButtonElement>('content-save').disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId('content-save'));
    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/creator/content' && call.method === 'POST',
        ),
      ).toBe(true);
    });

    expect(
      double.calls.find(
        (call) => call.path === '/v1/creator/content' && call.method === 'POST',
      )?.body,
    ).toMatchObject({
      body: 'A revised body.',
      contentId: 'content-1',
      version: 3,
    });
  });

  it('attaches an item to a club when its audience is that club', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        clubs: [
          {
            id: 'club-1',
            lifecycle: 'published',
            memberCount: 0,
            name: 'Inner Circle',
            slug: 'inner',
            version: 1,
          },
        ],
      }),
    );
    renderStudio(<NewContent />, double, { pathname: '/catalog/new' });

    fireEvent.change(await screen.findByTestId('content-title'), {
      target: { value: 'For members' },
    });
    fireEvent.click(screen.getByTestId('content-audience-members'));
    const select = await screen.findByTestId('content-club');
    fireEvent.change(select, { target: { value: 'club-1' } });
    await waitFor(() => {
      expect(
        screen.getByTestId<HTMLButtonElement>('content-save').disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId('content-save'));
    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/creator/content' && call.method === 'POST',
        ),
      ).toBe(true);
    });

    expect(
      double.calls.find(
        (call) => call.path === '/v1/creator/content' && call.method === 'POST',
      )?.body,
    ).toMatchObject({ clubId: 'club-1', visibility: 'members_only' });
  });

  it('says a members-only item has nobody to admit when there is no club', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<NewContent />, double, { pathname: '/catalog/new' });

    fireEvent.click(await screen.findByTestId('content-audience-members'));
    expect(
      (await screen.findByTestId('content-no-clubs')).textContent,
    ).toContain('reachable by nobody');
  });
});

describe('private clubs', () => {
  it('creates a draft club and goes to it', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<Clubs />, double, { pathname: '/clubs' });

    fireEvent.click(await screen.findByTestId('club-new'));
    fireEvent.change(await screen.findByTestId('club-name'), {
      target: { value: 'Inner Circle' },
    });
    fireEvent.change(screen.getByTestId('club-slug'), {
      target: { value: 'inner' },
    });
    fireEvent.click(screen.getByTestId('club-create'));

    await waitFor(() => {
      expect(navigations()).toContainEqual({
        kind: 'push',
        path: '/clubs/club-1',
      });
    });
    expect(double.state.clubs[0]?.lifecycle).toBe('draft');
  });

  it('refuses an address the contract would refuse, before sending it', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<Clubs />, double, { pathname: '/clubs' });

    fireEvent.click(await screen.findByTestId('club-new'));
    fireEvent.change(await screen.findByTestId('club-name'), {
      target: { value: 'Inner Circle' },
    });
    fireEvent.change(screen.getByTestId('club-slug'), {
      target: { value: 'no' },
    });
    fireEvent.click(screen.getByTestId('club-create'));
    await settle();

    expect(screen.getByText(/Use 3 to 40 letters/u)).toBeDefined();
    expect(
      double.calls.some(
        (call) => call.path === '/v1/creator/clubs' && call.method === 'POST',
      ),
    ).toBe(false);
  });

  it('will not offer an invitation for a club nobody can open', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        clubs: [
          {
            id: 'club-1',
            lifecycle: 'draft',
            memberCount: 0,
            name: 'Inner Circle',
            slug: 'inner',
            version: 1,
          },
        ],
      }),
    );
    renderStudio(<ClubScreen clubId="club-1" />, double, {
      params: { clubId: 'club-1' },
      pathname: '/clubs/club-1',
    });

    expect(
      (await screen.findByTestId('club-invite-blocked')).textContent,
    ).toContain('Publish the club before inviting anybody');
    expect(screen.queryByTestId('club-invite')).toBeNull();
  });

  it('shows an invitation once, masked, and never in the listing', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        clubs: [
          {
            id: 'club-1',
            lifecycle: 'published',
            memberCount: 0,
            name: 'Inner Circle',
            slug: 'inner',
            version: 1,
          },
        ],
      }),
    );
    renderStudio(<ClubScreen clubId="club-1" />, double, {
      params: { clubId: 'club-1' },
      pathname: '/clubs/club-1',
    });

    fireEvent.click(await screen.findByTestId('club-invite'));
    const panel = await screen.findByTestId('club-invite-secret');
    expect(panel.textContent).toContain('shown once');
    expect(panel.textContent).toContain('cannot show it to you again');

    // Masked until asked for.
    const value = screen.getByTestId('club-invite-secret-value');
    expect(value.textContent).not.toContain('invitation-secret-value');
    fireEvent.click(screen.getByTestId('club-invite-reveal'));
    expect(
      screen.getByTestId('club-invite-secret-value').textContent,
    ).toContain('invitation-secret-value-shown-once-0001');

    fireEvent.click(screen.getByTestId('club-invite-copy'));
    expect(clipboard.writeText).toHaveBeenCalledWith(
      'invitation-secret-value-shown-once-0001',
    );

    fireEvent.click(screen.getByTestId('club-invite-done'));
    await waitFor(() => {
      expect(screen.queryByTestId('club-invite-secret')).toBeNull();
    });
    // The listing carries no secret at any point.
    expect(document.body.textContent).not.toContain(
      'invitation-secret-value-shown-once-0001',
    );
  });

  it('shows how many people hold access and where each grant came from, and nothing else', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        clubs: [
          {
            id: 'club-1',
            lifecycle: 'published',
            memberCount: 1,
            name: 'Inner Circle',
            slug: 'inner',
            version: 1,
          },
        ],
        memberships: [
          {
            clubId: 'club-1',
            grantedAt: '2026-08-15T12:00:00.000Z',
            id: 'membership-1',
            source: 'creator_invite',
            state: 'active',
          },
        ],
      }),
    );
    renderStudio(<ClubScreen clubId="club-1" />, double, {
      params: { clubId: 'club-1' },
      pathname: '/clubs/club-1',
    });

    expect(
      (await screen.findByTestId('club-member-count')).textContent,
    ).toContain('1');
    expect(
      (await screen.findByTestId('club-member-source-membership-1'))
        .textContent,
    ).toContain('Admitted by your invitation');
    // Nothing identifies the member.
    const access = screen.getByTestId('club-access');
    expect(access.textContent).not.toContain('membership-1');
  });

  it('asks before withdrawing access, then withdraws it', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        clubs: [
          {
            id: 'club-1',
            lifecycle: 'published',
            memberCount: 1,
            name: 'Inner Circle',
            slug: 'inner',
            version: 1,
          },
        ],
        memberships: [
          {
            clubId: 'club-1',
            grantedAt: '2026-08-15T12:00:00.000Z',
            id: 'membership-1',
            source: 'creator_invite',
            state: 'active',
          },
        ],
      }),
    );
    renderStudio(<ClubScreen clubId="club-1" />, double, {
      params: { clubId: 'club-1' },
      pathname: '/clubs/club-1',
    });

    fireEvent.click(await screen.findByTestId('club-revoke-membership-1'));
    const dialog = await screen.findByTestId('club-revoke-confirm');
    fireEvent.click(within(dialog).getByTestId('club-revoke-confirm-accept'));

    await waitFor(() => {
      expect(screen.getByTestId('club-no-members')).toBeDefined();
    });
  });

  it('closes a club only after saying it cannot be undone', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        clubs: [
          {
            id: 'club-1',
            lifecycle: 'published',
            memberCount: 2,
            name: 'Inner Circle',
            slug: 'inner',
            version: 1,
          },
        ],
      }),
    );
    renderStudio(<ClubScreen clubId="club-1" />, double, {
      params: { clubId: 'club-1' },
      pathname: '/clubs/club-1',
    });

    fireEvent.click(await screen.findByTestId('club-close'));
    const dialog = await screen.findByTestId('club-close-confirm');
    expect(dialog.textContent).toContain('cannot be undone');
    expect(dialog.textContent).toContain('2 people currently hold access');
  });
});

describe('a creator whose capability may not operate', () => {
  /** Active in every respect except the one the server refuses. */
  function suspended(): CreatorApiDoubleState {
    const base = withProfile();
    return {
      ...base,
      account: {
        activatedAt: '2026-08-15T12:00:00.000Z',
        createdAt: '2026-08-15T12:00:00.000Z',
        id: 'creator',
        status: 'suspended',
        statusReason: 'safety_enforcement',
      },
      content: [
        {
          id: 'content-1',
          lifecycle: 'published',
          title: 'A first post',
          version: 1,
          visibility: 'public',
        },
      ],
    };
  }

  it('still shows the catalog, and offers none of the controls the server would refuse', async () => {
    const double = createCreatorApiDouble(suspended());
    renderStudio(<Catalog />, double, { pathname: '/catalog' });

    // Theirs, and still listed.
    expect(await screen.findByTestId('content-item-content-1')).toBeDefined();
    expect(screen.queryByTestId('content-new')).toBeNull();
    expect(screen.queryByTestId('content-unpublish-content-1')).toBeNull();
    expect(screen.queryByTestId('content-archive-content-1')).toBeNull();
    expect(
      (await screen.findByTestId('catalog-read-only')).textContent,
    ).toContain('Read only');
  });

  it('says what happened on Home without explaining a safety decision', async () => {
    const double = createCreatorApiDouble(suspended());
    renderStudio(<Home />, double, { pathname: '/home' });

    const notice = await screen.findByTestId('home-standing');
    expect(notice.textContent).toContain('following a safety decision');
    expect(notice.textContent).toContain('still yours');
    // No case, no score, no reviewer, no evidence.
    for (const forbidden of ['case', 'score', 'reviewer', 'report']) {
      expect(notice.textContent.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('keeps the money readouts, because the money is still owed', async () => {
    const double = createCreatorApiDouble({
      ...suspended(),
      earnings: [
        {
          currency: 'EUR',
          disputed: '0',
          gross: '5000',
          payable: '4000',
          platform: '1000',
          reversed: '0',
          tax: '0',
        },
      ],
    });
    renderStudio(<Earnings />, double, { pathname: '/money' });

    expect(
      (await screen.findByTestId('earnings-EUR-gross')).textContent,
    ).toContain('50.00 EUR');
  });
});

describe('money', () => {
  it('keeps currencies apart and never adds them together', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        earnings: [
          {
            currency: 'EUR',
            disputed: '0',
            gross: '5000',
            payable: '4000',
            platform: '1000',
            reversed: '0',
            tax: '0',
          },
          {
            currency: 'JPY',
            disputed: '0',
            gross: '5000',
            payable: '4000',
            platform: '1000',
            reversed: '0',
            tax: '0',
          },
        ],
      }),
    );
    renderStudio(<Earnings />, double, { pathname: '/money' });

    expect(
      (await screen.findByTestId('earnings-no-total')).textContent,
    ).toContain('does not add them together');
    // A euro shows two decimal places and a yen shows none, from the published
    // minor-unit exponent rather than from a division by a hundred.
    expect(textOf('earnings-EUR-gross')).toContain('50.00 EUR');
    fireEvent.click(screen.getByTestId('segment-JPY'));
    expect(
      (await screen.findByTestId('earnings-JPY-gross')).textContent,
    ).toContain('5000 JPY');
  });

  it('says selling is unavailable and offers no price field', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<Selling />, double, { pathname: '/money/selling' });

    const blocked = await screen.findByTestId('offers-readiness');
    expect(blocked.textContent).toContain('No payment provider is approved');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /price/iu })).toBeNull();
  });

  it('separates a missing provider from a missing recipient record', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<Payouts />, double, { pathname: '/money/payouts' });

    const blocked = await screen.findByTestId('payouts-blocked');
    expect(blocked.textContent).toContain('No payout provider is approved');
    // No provider means no onboarding control, rather than one that fails.
    expect(screen.queryByTestId('payouts-onboard')).toBeNull();
  });

  it('shows balances even when nothing can be withdrawn, and offers no control', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        payoutReadiness: {
          balances: [
            {
              available: '4000',
              currency: 'EUR',
              held: '0',
              releasable: '0',
              reserved: '0',
            },
          ],
          enabled: false,
          policySource: 'unpublished',
          providerSource: 'unavailable',
          recipientStatus: 'absent',
        },
      }),
    );
    renderStudio(<Payouts />, double, { pathname: '/money/payouts' });

    expect(
      (await screen.findByTestId('payouts-EUR-available')).textContent,
    ).toContain('40.00 EUR');
    expect(screen.queryByTestId('payouts-withdraw-EUR')).toBeNull();
  });

  it('carries one idempotency key through a retried payout', async () => {
    const double = createCreatorApiDouble(
      withProfile({
        payoutReadiness: {
          balances: [
            {
              available: '4000',
              currency: 'EUR',
              held: '0',
              releasable: '4000',
              reserved: '0',
            },
          ],
          enabled: true,
          policySource: 'published',
          providerSource: 'test',
          recipientStatus: 'ready',
        },
      }),
    );
    renderStudio(<Payouts />, double, { pathname: '/money/payouts' });

    fireEvent.click(await screen.findByTestId('payouts-withdraw-EUR'));
    const dialog = await screen.findByTestId('payouts-withdraw-confirm');

    double.failNext('/v1/creator/payouts', 'POST');
    fireEvent.click(
      within(dialog).getByTestId('payouts-withdraw-confirm-accept'),
    );
    await screen.findByTestId('payouts-failed');

    fireEvent.click(
      within(dialog).getByTestId('payouts-withdraw-confirm-accept'),
    );
    await waitFor(() => {
      expect(screen.queryByTestId('payouts-withdraw-confirm')).toBeNull();
    });
    expect(double.state.payouts).toHaveLength(1);
  });
});

describe('the account', () => {
  it('lists what stands in the way of mature content, and attributes none of it to the creator', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<Account />, double, { pathname: '/account' });

    const blockers = await screen.findByTestId('mature-blockers');
    expect(blockers.textContent).toContain('switched off');
    expect(blockers.textContent).toContain('No approved provider');
    expect(textOf('mature-ineligible-surfaces')).toContain(
      'both stores prohibit it outright',
    );
  });

  it('keeps the creator identity and the VELORA identity distinct', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<Account />, double, { pathname: '/account' });

    expect(
      (await screen.findByTestId('account-separate')).textContent,
    ).toContain('separate things');
  });

  it('signs out without claiming to sign out of VELORA', async () => {
    const double = createCreatorApiDouble(withProfile());
    renderStudio(<Account />, double, { pathname: '/account' });

    fireEvent.click(await screen.findByTestId('auth-sign-out'));
    await waitFor(() => {
      expect(double.calls.some((call) => call.path === '/v1/auth/logout')).toBe(
        true,
      );
    });
    expect(
      double.calls.some((call) => call.path === '/v1/auth/logout-all'),
    ).toBe(false);
  });
});
