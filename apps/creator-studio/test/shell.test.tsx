import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CreatorStudio } from '../src/product/studio';
import {
  activeCreatorState,
  createCreatorApiDouble,
  emptyCreatorState,
  requiredCreatorPolicies,
  type CreatorApiDouble,
  type CreatorApiDoubleState,
} from './support/api-double';

/**
 * The Creator Studio journey, driven through the generated client against a
 * stand-in API that answers the real contract.
 *
 * Nothing here reaches inside a component. Every assertion is about what a
 * creator using the surface would see and do, and every answer the surface gets
 * is one the server could actually give.
 */

const baseUrl = 'http://api.test';

// Vitest runs without global test APIs, so the automatic teardown React Testing
// Library installs when it can see them is registered here instead.
afterEach(cleanup);

function renderStudio(double: CreatorApiDouble) {
  return render(
    <CreatorStudio apiBaseUrl={baseUrl} fetchImplementation={double.fetch} />,
  );
}

function textOf(testId: string): string | null {
  return screen.getByTestId(testId).textContent;
}

async function press(testId: string): Promise<void> {
  const control = await screen.findByTestId(testId);
  fireEvent.click(control);
}

async function type(testId: string, value: string): Promise<void> {
  const field = await screen.findByTestId(testId);
  fireEvent.change(field, { target: { value } });
}

/**
 * Reaches a live session, whichever way this test's double starts.
 *
 * A double that already holds a session reports one on the first check, and
 * there is no sign-in control to press. Pressing one that is not there would be
 * testing the helper rather than the surface.
 */
async function signIn(): Promise<void> {
  await waitFor(() => {
    expect(textOf('auth-status')).not.toBe('Checking session');
  });
  const control = screen.queryByTestId('auth-sign-in');
  if (control !== null) fireEvent.click(control);
  await waitFor(() => {
    expect(textOf('auth-status')).toBe('Signed in');
  });
}

function doubleWith(state: CreatorApiDoubleState): CreatorApiDouble {
  return createCreatorApiDouble(state);
}

/**
 * Moves to one Studio area, the way a creator would.
 *
 * The areas are peers rather than a stack, so a test that wants the catalog
 * asks for the catalog instead of scrolling past everything else.
 */
async function goTo(area: 'home' | 'profile' | 'catalog' | 'clubs') {
  await press(`nav-${area}`);
}

describe('Creator Studio surface isolation', () => {
  it('identifies itself and carries nothing consumer or privileged', async () => {
    renderStudio(doubleWith(emptyCreatorState()));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Creator Studio' }),
    ).toBeDefined();
    for (const absent of [
      'Discovery',
      'Introductions',
      'Conversations',
      'Platform Admin',
    ]) {
      expect(screen.queryByText(absent), absent).toBeNull();
    }
  });

  it('offers no sign-in control until the session check has answered', () => {
    // The page is delivered before anybody knows whose it is. A control that is
    // visible and pressable in that window would discard the press silently.
    const double = createCreatorApiDouble(emptyCreatorState());
    renderStudio(double);

    expect(screen.queryByTestId('auth-sign-in')).toBeNull();
    expect(textOf('auth-status')).toBe('Checking session');
  });
});

describe('Creator Studio activation ladder', () => {
  it('walks the ladder the server publishes and never grants access on its own', async () => {
    const double = doubleWith(emptyCreatorState());
    renderStudio(double);
    await signIn();

    // Signed in with no creator capability: the surface offers to ask for one
    // and says plainly that it is not automatic.
    await waitFor(() => {
      expect(screen.getByTestId('creator-onboard')).toBeDefined();
    });
    expect(screen.queryByTestId('creator-save-profile')).toBeNull();

    await press('creator-onboard');
    await waitFor(() => {
      expect(textOf('creator-stage')).toBe('Accept the creator policies');
    });
    expect(
      screen.getByTestId('creator-outstanding-policies').textContent,
    ).toContain('creator_terms');
    // Still no profile editor: an applicant has not finished the ladder.
    expect(screen.queryByTestId('creator-save-profile')).toBeNull();

    await press('creator-accept-policies');
    await waitFor(() => {
      expect(textOf('creator-standing')).toBe('Creator access active');
    });
    // The workspace appears only once the ladder is finished.
    await goTo('profile');
    expect(await screen.findByTestId('creator-save-profile')).toBeDefined();
    expect(double.state.account?.status).toBe('active');
  });

  it('says where to finish adult eligibility rather than offering a control that cannot work', async () => {
    const double = doubleWith({
      ...emptyCreatorState(),
      account: {
        createdAt: '2026-08-15T12:00:00.000Z',
        id: 'x',
        status: 'applicant',
        statusReason: 'eligibility_failed',
      },
      adultGateReason: 'adult_declaration_missing',
      adultGateSatisfied: false,
      outstandingPolicies: [...requiredCreatorPolicies],
    });
    renderStudio(double);
    await signIn();

    await waitFor(() => {
      expect(textOf('creator-adult-gate')).toBe(
        'Confirm on VELORA that you are an adult, then come back.',
      );
    });
    // Creator Studio cannot declare somebody an adult; that is a consumer
    // decision USERS owns, so no control here pretends to take it.
    expect(screen.queryByTestId('creator-accept-policies')).toBeNull();
    expect(screen.queryByTestId('creator-save-profile')).toBeNull();
  });

  it('reports a suspended capability and offers no way to publish', async () => {
    const double = doubleWith({
      ...activeCreatorState(),
      account: {
        createdAt: '2026-08-15T12:00:00.000Z',
        id: 'x',
        status: 'suspended',
        statusReason: 'safety_enforcement',
      },
      profile: {
        displayName: 'Ember Vale',
        handle: 'ember',
        links: [],
        publication: 'draft',
        version: 1,
      },
    });
    renderStudio(double);
    await signIn();

    await waitFor(() => {
      expect(textOf('creator-standing')).toBe('Creator access is suspended');
    });
    await goTo('profile');
    await press('creator-toggle-publication');
    const refused = await screen.findByTestId('creator-profile-error');
    expect(refused.textContent).toContain('unavailable');
    expect(double.state.profile?.publication).toBe('draft');
  });
});

describe('Creator Studio public profile', () => {
  it('claims a handle, keeps the page private until asked, then publishes it', async () => {
    const double = doubleWith(activeCreatorState());
    renderStudio(double);
    await signIn();

    await goTo('profile');
    await waitFor(() => {
      expect(textOf('creator-publication')).toBe('No public profile yet');
    });
    await type('creator-handle', 'Ember_Vale');
    await type('creator-display-name', 'Ember Vale');
    await type('creator-bio', 'Ceramics, slowly.');
    await press('creator-save-profile');

    await waitFor(() => {
      expect(textOf('creator-publication')).toBe(
        'Draft. Only you can see this.',
      );
    });
    expect(textOf('creator-public-path')).toBe('/c/ember_vale');
    // Saving never publishes. The page is not reachable until the separate
    // decision is taken.
    expect(double.state.profile?.publication).toBe('draft');

    await press('creator-toggle-publication');
    await waitFor(() => {
      expect(textOf('creator-publication')).toBe(
        'Published. Anyone with the link can see this.',
      );
    });
    expect(double.state.profile?.publication).toBe('published');
  });

  it('stops offering the handle field once a handle exists', async () => {
    const double = doubleWith({
      ...activeCreatorState(),
      profile: {
        displayName: 'Ember Vale',
        handle: 'ember',
        links: [],
        publication: 'draft',
        version: 3,
      },
    });
    renderStudio(double);
    await signIn();

    await goTo('profile');
    await waitFor(() => {
      expect(textOf('creator-handle-fixed')).toBe('ember');
    });
    // No rename exists in this milestone, so no field offers one.
    expect(screen.queryByTestId('creator-handle')).toBeNull();
  });

  it('reports a conflicting save honestly and keeps what the server holds', async () => {
    const double = doubleWith({
      ...activeCreatorState(),
      profile: {
        displayName: 'Ember Vale',
        handle: 'ember',
        links: [],
        publication: 'draft',
        version: 2,
      },
    });
    renderStudio(double);
    await signIn();
    await goTo('profile');
    await waitFor(() => {
      expect(textOf('creator-handle-fixed')).toBe('ember');
    });

    double.refuseNext('/v1/creator/profile', 409, 'STATE_CONFLICT');
    await type('creator-display-name', 'Renamed');
    await press('creator-save-profile');

    const error = await screen.findByTestId('creator-profile-error');
    expect(error.textContent).toContain('Reload and try again');
    expect(double.state.profile?.displayName).toBe('Ember Vale');
  });

  it('sends exactly one save when the control is pressed twice in a frame', async () => {
    const double = doubleWith(activeCreatorState());
    renderStudio(double);
    await signIn();
    await goTo('profile');
    await waitFor(() => {
      expect(screen.getByTestId('creator-save-profile')).toBeDefined();
    });
    await type('creator-handle', 'ember');
    await type('creator-display-name', 'Ember Vale');

    const control = screen.getByTestId('creator-save-profile');
    fireEvent.click(control);
    fireEvent.click(control);
    await waitFor(() => {
      expect(textOf('creator-publication')).toBe(
        'Draft. Only you can see this.',
      );
    });

    const saves = double.calls.filter(
      (call) => call.path === '/v1/creator/profile' && call.method === 'POST',
    );
    expect(saves).toHaveLength(1);
  });

  it('offers a retry rather than a blank panel when the API cannot be reached', async () => {
    const double = doubleWith(activeCreatorState());
    double.failNext('/v1/creator/onboarding');
    renderStudio(double);
    await signIn();

    const failure = await screen.findByTestId('creator-status-failed');
    expect(failure.textContent).toContain('could not be reached');
    expect(
      within(failure).getByRole('button', { name: 'Try again' }),
    ).toBeDefined();
  });
});

describe('Creator Studio session lifecycle', () => {
  it('reports a session that ended rather than pretending nobody signed in', async () => {
    const double = doubleWith(activeCreatorState());
    renderStudio(double);
    await signIn();
    await waitFor(() => {
      expect(textOf('creator-standing')).toBe('Creator access active');
    });

    await press('auth-sign-out');
    await waitFor(() => {
      expect(textOf('auth-status')).toBe('Signed out');
    });
    expect(textOf('auth-cause')).toBe('Signed out on this device');
    expect(screen.queryByTestId('creator-standing')).toBeNull();
  });

  it('never stores a credential anywhere a script can read it', async () => {
    const double = doubleWith(activeCreatorState());
    renderStudio(double);
    await signIn();
    await waitFor(() => {
      expect(textOf('creator-standing')).toBe('Creator access active');
    });

    // The session is an HttpOnly cookie. Nothing on this surface may keep a
    // token, and ADR-0017 forbids browser storage for one.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('Creator Studio catalog', () => {
  it('adds a draft that is private until published, and says so', async () => {
    const double = doubleWith(activeCreatorState());
    renderStudio(double);
    await signIn();
    await goTo('catalog');
    await waitFor(() => {
      expect(screen.getByTestId('creator-content-empty')).toBeDefined();
    });

    await type('content-title', 'A first post');
    await press('content-create');

    const item = await screen.findByTestId('content-lifecycle-content-1');
    expect(item.textContent).toBe('Draft. Only you can see this.');
    expect(double.state.content[0]?.lifecycle).toBe('draft');
    // Creating never publishes.
    expect(
      double.calls.filter(
        (call) => call.path === '/v1/creator/content/lifecycle',
      ),
    ).toHaveLength(0);

    await press('content-publish-content-1');
    await waitFor(() => {
      expect(textOf('content-lifecycle-content-1')).toBe(
        'Published. Anyone with your link can see this.',
      );
    });
  });

  it('says plainly that a members-only item is reachable by nobody yet', async () => {
    renderStudio(doubleWith(activeCreatorState()));
    await signIn();
    await goTo('catalog');
    await waitFor(() => {
      expect(screen.getByTestId('content-visibility')).toBeDefined();
    });

    fireEvent.change(screen.getByTestId('content-visibility'), {
      target: { value: 'members_only' },
    });

    const note = await screen.findByTestId('content-members-note');
    expect(note.textContent).toContain('do not exist yet');
  });

  it('shows a suspended creator their catalog and no way to change it', async () => {
    const double = doubleWith({
      ...activeCreatorState(),
      account: {
        createdAt: '2026-08-15T12:00:00.000Z',
        id: 'x',
        status: 'suspended',
        statusReason: 'safety_enforcement',
      },
      content: [
        {
          id: 'content-1',
          lifecycle: 'published',
          title: 'Already out there',
          version: 2,
          visibility: 'public',
        },
      ],
    });
    renderStudio(double);
    await signIn();
    await goTo('catalog');

    await waitFor(() => {
      expect(screen.getByTestId('content-item-content-1')).toBeDefined();
    });
    // The catalog is theirs to see. The controls the server would refuse are
    // simply not offered.
    expect(screen.queryByTestId('content-create')).toBeNull();
    expect(screen.queryByTestId('content-unpublish-content-1')).toBeNull();
    expect(screen.queryByTestId('content-archive-content-1')).toBeNull();
  });

  it('shows no price, purchase, or fabricated number anywhere in the catalog', async () => {
    renderStudio(
      doubleWith({
        ...activeCreatorState(),
        content: [
          {
            id: 'content-1',
            lifecycle: 'published',
            summary: 'A summary.',
            title: 'An item',
            version: 1,
            visibility: 'public',
          },
        ],
      }),
    );
    await signIn();
    await goTo('catalog');
    await screen.findByTestId('content-item-content-1');

    const markup = document.body.textContent;
    for (const forbidden of ['Price', 'Buy', 'Earnings', 'Views', 'Sales']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('sends exactly one publish when the control is pressed twice in a frame', async () => {
    const double = doubleWith({
      ...activeCreatorState(),
      content: [
        {
          id: 'content-1',
          lifecycle: 'draft',
          title: 'Draft',
          version: 1,
          visibility: 'public',
        },
      ],
    });
    renderStudio(double);
    await signIn();
    await goTo('catalog');
    const control = await screen.findByTestId('content-publish-content-1');

    fireEvent.click(control);
    fireEvent.click(control);
    await waitFor(() => {
      expect(textOf('content-lifecycle-content-1')).toBe(
        'Published. Anyone with your link can see this.',
      );
    });

    expect(
      double.calls.filter(
        (call) => call.path === '/v1/creator/content/lifecycle',
      ),
    ).toHaveLength(1);
  });
});

describe('Creator Studio private clubs', () => {
  it('creates a club with nobody in it and publishes on a separate decision', async () => {
    const double = doubleWith(activeCreatorState());
    renderStudio(double);
    await signIn();
    await goTo('clubs');
    await waitFor(() => {
      expect(screen.getByTestId('creator-clubs-empty')).toBeDefined();
    });

    await type('club-name', 'Inner Circle');
    await type('club-slug', 'Inner_Circle');
    await press('club-create');

    await waitFor(() => {
      expect(textOf('club-lifecycle-club-1')).toBe(
        'Draft. Nobody can see this or be admitted to it.',
      );
    });
    expect(textOf('club-members-club-1')).toBe('0 members');
    // A draft club cannot hand out a key to itself, so no invitation control
    // is offered for one.
    expect(screen.queryByTestId('club-invite-club-1')).toBeNull();

    await press('club-publish-club-1');
    await waitFor(() => {
      expect(textOf('club-lifecycle-club-1')).toBe(
        'Published. Visible on your public page.',
      );
    });
    expect(await screen.findByTestId('club-invite-club-1')).toBeDefined();
  });

  it('shows an invitation once and says it will not be shown again', async () => {
    const double = doubleWith({
      ...activeCreatorState(),
      clubs: [
        {
          id: 'club-1',
          lifecycle: 'published',
          memberCount: 2,
          name: 'Inner Circle',
          slug: 'inner',
          version: 2,
        },
      ],
    });
    renderStudio(double);
    await signIn();
    await goTo('clubs');

    await press('club-invite-club-1');

    const shown = await screen.findByTestId('club-invite-secret');
    expect(shown.textContent).toContain('shown once');
    expect(shown.textContent).toContain('invitation-secret-value-shown-once');
  });

  it('shows a real member count and nothing purchasable', async () => {
    renderStudio(
      doubleWith({
        ...activeCreatorState(),
        clubs: [
          {
            description: 'A quiet room.',
            id: 'club-1',
            lifecycle: 'published',
            memberCount: 1,
            name: 'Inner Circle',
            slug: 'inner',
            version: 2,
          },
        ],
      }),
    );
    await signIn();
    await goTo('clubs');
    await screen.findByTestId('club-item-club-1');

    expect(textOf('club-members-club-1')).toBe('1 member');
    const markup = document.body.textContent;
    for (const forbidden of [
      'Price',
      'Subscribe',
      'Buy',
      'Revenue',
      'Earnings',
      'per month',
    ]) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('offers a suspended creator no way to change a club', async () => {
    renderStudio(
      doubleWith({
        ...activeCreatorState(),
        account: {
          createdAt: '2026-08-15T12:00:00.000Z',
          id: 'x',
          status: 'suspended',
          statusReason: 'safety_enforcement',
        },
        clubs: [
          {
            id: 'club-1',
            lifecycle: 'published',
            memberCount: 3,
            name: 'Inner Circle',
            slug: 'inner',
            version: 2,
          },
        ],
      }),
    );
    await signIn();
    await goTo('clubs');
    await screen.findByTestId('club-item-club-1');

    expect(screen.queryByTestId('club-create')).toBeNull();
    expect(screen.queryByTestId('club-invite-club-1')).toBeNull();
    expect(screen.queryByTestId('club-unpublish-club-1')).toBeNull();
  });
});

describe('Creator Studio home', () => {
  const busyCreator = () => ({
    ...activeCreatorState(),
    clubs: [
      {
        id: 'club-1',
        lifecycle: 'published' as const,
        memberCount: 2,
        name: 'Inner Circle',
        slug: 'inner',
        version: 2,
      },
      {
        id: 'club-2',
        lifecycle: 'draft' as const,
        memberCount: 0,
        name: 'Quiet',
        slug: 'quiet',
        version: 1,
      },
    ],
    content: [
      {
        id: 'content-1',
        lifecycle: 'published' as const,
        title: 'Out there',
        version: 2,
        visibility: 'public' as const,
      },
      {
        id: 'content-2',
        lifecycle: 'draft' as const,
        title: 'Not yet',
        version: 1,
        visibility: 'public' as const,
      },
    ],
    profile: {
      displayName: 'Ember Vale',
      handle: 'ember',
      links: [],
      publication: 'published' as const,
      publishedAt: '2026-08-15T12:00:00.000Z',
      version: 3,
    },
  });

  it('counts only what the server actually returned', async () => {
    renderStudio(doubleWith(busyCreator()));
    await signIn();

    await waitFor(() => {
      expect(textOf('dashboard-drafts')).toBe('1');
    });
    expect(textOf('dashboard-published')).toBe('1');
    expect(textOf('dashboard-clubs-count')).toBe('1');
    // Summed from live entitlements the server counted, not invented.
    expect(textOf('dashboard-members')).toBe('2');
    expect(textOf('dashboard-public-path')).toContain('/c/ember');
  });

  it('shows no metric the platform does not compute', async () => {
    renderStudio(doubleWith(busyCreator()));
    await signIn();
    await screen.findByTestId('dashboard-members');

    const markup = document.body.textContent;
    for (const forbidden of [
      'Earnings',
      'Revenue',
      'Views',
      'Followers',
      'Growth',
      'Conversion',
      'Sales',
      'Trend',
    ]) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });
});

describe('Creator Studio club access', () => {
  const withAccess = () => ({
    ...activeCreatorState(),
    clubs: [
      {
        id: 'club-1',
        lifecycle: 'published' as const,
        memberCount: 1,
        name: 'Inner Circle',
        slug: 'inner',
        version: 2,
      },
    ],
    invites: [
      {
        clubId: 'club-1',
        createdAt: '2026-08-15T12:00:00.000Z',
        expiresAt: '2026-08-22T12:00:00.000Z',
        id: 'invite-1',
      },
    ],
    memberships: [
      {
        clubId: 'club-1',
        grantedAt: '2026-08-15T12:00:00.000Z',
        id: 'membership-1',
        source: 'creator_invite' as const,
        state: 'active' as const,
      },
    ],
  });

  it('says how somebody was admitted and never who they are', async () => {
    renderStudio(doubleWith(withAccess()));
    await signIn();
    await goTo('clubs');
    await press('club-access-club-1');

    const source = await screen.findByTestId('club-member-source-membership-1');
    expect(source.textContent).toBe('Admitted by your invitation');
    const panel = screen.getByTestId('club-access-panel-club-1');
    const markup = panel.textContent;
    // A creator learns that somebody has access and nothing about them.
    for (const forbidden of ['@', 'member-', 'user', 'email']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('withdraws access and withdraws an unused invitation', async () => {
    const double = doubleWith(withAccess());
    renderStudio(double);
    await signIn();
    await goTo('clubs');
    await press('club-access-club-1');

    await press('club-revoke-membership-1');
    await waitFor(() => {
      expect(double.state.memberships[0]?.state).toBe('revoked');
    });

    await press('club-revoke-invite-invite-1');
    await waitFor(() => {
      expect(double.state.invites[0]?.revokedAt).toBeDefined();
    });
  });

  it('offers a suspended creator no way to withdraw anything', async () => {
    renderStudio(
      doubleWith({
        ...withAccess(),
        account: {
          createdAt: '2026-08-15T12:00:00.000Z',
          id: 'x',
          status: 'suspended',
          statusReason: 'safety_enforcement',
        },
      }),
    );
    await signIn();
    await goTo('clubs');
    await press('club-access-club-1');

    await screen.findByTestId('club-member-source-membership-1');
    expect(screen.queryByTestId('club-revoke-membership-1')).toBeNull();
    expect(screen.queryByTestId('club-revoke-invite-invite-1')).toBeNull();
  });
});

describe('Creator Studio accessibility', () => {
  it('exposes one document heading, named landmarks, and current-page state', async () => {
    renderStudio(doubleWith(activeCreatorState()));
    await signIn();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('main')).toBeDefined();
    const navigation = await screen.findByRole('navigation', {
      name: 'Creator Studio areas',
    });
    expect(navigation).toBeDefined();
    // Which area is open is announced rather than only coloured.
    expect(
      within(navigation).getByRole('button', { current: 'page' }).textContent,
    ).toBe('Home');
  });

  it('labels every field it asks a creator to fill in', async () => {
    renderStudio(doubleWith(activeCreatorState()));
    await signIn();
    await goTo('profile');

    for (const label of ['Public handle', 'Display name', 'Bio']) {
      expect(screen.getByLabelText(label), label).toBeDefined();
    }
    await goTo('clubs');
    for (const label of ['Name', 'Address', 'Description']) {
      expect(screen.getByLabelText(label), label).toBeDefined();
    }
  });

  it('announces a failure assertively and progress politely', async () => {
    const double = doubleWith(activeCreatorState());
    double.failNext('/v1/creator/onboarding');
    renderStudio(double);
    await signIn();

    const failure = await screen.findByTestId('creator-status-failed');
    expect(within(failure).getByRole('alert')).toBeDefined();
    expect(screen.getByTestId('auth-status').getAttribute('role')).toBe(
      'status',
    );
  });
});
