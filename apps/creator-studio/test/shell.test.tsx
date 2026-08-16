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
async function goTo(
  area:
    | 'home'
    | 'profile'
    | 'catalog'
    | 'clubs'
    | 'earnings'
    | 'payouts'
    | 'selling',
) {
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

    // Scoped to the panel rather than the document: `Earnings` is now the name
    // of a real area in the navigation, backed by figures the server derives
    // from its own ledger. What must not appear here is a number the catalog
    // itself does not have — a price, a purchase control, or a view count.
    const markup = screen.getByTestId('content-item-content-1').textContent;
    for (const forbidden of ['Price', 'Buy', 'Views', 'Sales']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
    expect(document.body.textContent, 'Revenue').not.toContain('Revenue');
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
    const markup = screen.getByTestId('club-item-club-1').textContent;
    for (const forbidden of ['Price', 'Subscribe', 'Buy', 'per month']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
    // Nothing anywhere claims a club can be paid for: no payment provider is
    // approved, so a purchase control would be a lie in a button.
    for (const forbidden of ['Revenue', 'Subscribe']) {
      expect(document.body.textContent, forbidden).not.toContain(forbidden);
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

  it('says mature content is unavailable and why, with no control to try', async () => {
    renderStudio(doubleWith(busyCreator()));
    await signIn();

    await waitFor(() => {
      expect(textOf('mature-readiness-state')).toContain('not available');
    });
    // Each blocker is somebody else's to clear, and the surface says which.
    const blockers = textOf('mature-blockers');
    expect(blockers).toContain('capability itself is switched off');
    expect(blockers).toContain('No approved provider');
    expect(blockers).toContain('Nobody has approved the wording');
    // Store ineligibility is stated separately: it is permanent rather than
    // something anybody is working through.
    expect(textOf('mature-ineligible-surfaces')).toContain('prohibit it');
    // And there is nothing to press. A control that could not succeed would be
    // a promise in a button.
    expect(screen.queryByTestId('mature-enable')).toBeNull();
  });

  it('shows no metric the platform does not compute', async () => {
    renderStudio(doubleWith(busyCreator()));
    await signIn();
    await screen.findByTestId('dashboard-members');

    // `Earnings` is excluded from this list deliberately: it names an area the
    // server backs with ledger-derived figures. Every word that remains names a
    // metric Velora does not compute at all, and one of those appearing would
    // mean a surface invented it.
    const markup = document.body.textContent;
    for (const forbidden of [
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

describe('Creator Studio earnings', () => {
  /** A creator who has been paid in two currencies, per the server. */
  function paidCreator() {
    return {
      ...activeCreatorState(),
      earnings: [
        {
          currency: 'JPY',
          disputed: '0',
          gross: '5000',
          payable: '4000',
          platform: '1000',
          reversed: '0',
          tax: '0',
        },
        {
          currency: 'USD',
          disputed: '250',
          gross: '1500',
          payable: '800',
          platform: '200',
          reversed: '500',
          tax: '0',
        },
      ],
      earningsHistory: [
        {
          amount: { amountMinor: '500', currency: 'USD' },
          id: 'refund-1',
          kind: 'refund' as const,
          occurredAt: '2026-08-15T12:30:00.000Z',
          offerId: '11111111-1111-4111-8111-111111111111',
          state: 'succeeded',
        },
        {
          amount: { amountMinor: '1500', currency: 'USD' },
          id: 'capture-1',
          kind: 'capture' as const,
          occurredAt: '2026-08-15T12:00:00.000Z',
          offerId: '11111111-1111-4111-8111-111111111111',
          state: 'succeeded',
        },
      ],
      profile: {
        displayName: 'Ember Vale',
        handle: 'ember',
        links: [],
        publication: 'published' as const,
        publishedAt: '2026-08-15T12:00:00.000Z',
        version: 2,
      },
    };
  }

  it('shows each currency separately and never a total across them', async () => {
    renderStudio(doubleWith(paidCreator()));
    await signIn();
    await goTo('earnings');
    await screen.findByTestId('earnings-currency-USD');

    // Two blocks, and every figure rendered against its own currency's
    // published exponent: a yen divides into no minor units, so 5000 JPY is
    // five thousand yen and not fifty.
    expect(textOf('earnings-USD-payable')).toBe('8.00 USD');
    expect(textOf('earnings-USD-gross')).toBe('15.00 USD');
    expect(textOf('earnings-USD-reversed')).toBe('5.00 USD');
    expect(textOf('earnings-USD-disputed')).toBe('2.50 USD');
    expect(textOf('earnings-JPY-payable')).toBe('4000 JPY');
    expect(textOf('earnings-JPY-gross')).toBe('5000 JPY');

    // No total, because the sum of a dollar and a yen is not an amount.
    const markup = document.body.textContent;
    for (const forbidden of ['Total', 'Overall', 'Combined']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('says plainly that selling is not enabled rather than showing nothing', async () => {
    renderStudio(doubleWith({ ...activeCreatorState() }));
    await signIn();
    await goTo('earnings');

    // The readiness statement is the honest alternative to an empty screen that
    // looks like a failure of the creator's.
    expect(await screen.findByTestId('earnings-readiness')).toBeDefined();
    expect(textOf('earnings-readiness')).toContain('not enabled');
    expect(textOf('earnings-empty')).toContain('Nothing has been paid to you');
  });

  it('shows one sequence of what happened, and no chart of any kind', async () => {
    renderStudio(doubleWith(paidCreator()));
    await signIn();
    await goTo('earnings');
    await press('earnings-history-select-USD');
    await screen.findByTestId('earnings-entry-refund-1');

    // Newest first, purchases and reversals in one list, and each described by
    // what it is rather than by who was on the other side of it.
    const history = screen.getByTestId('earnings-history').textContent;
    expect(history).toContain('Refund');
    expect(history).toContain('Purchase');
    expect(history.indexOf('Refund')).toBeLessThan(history.indexOf('Purchase'));
    for (const forbidden of ['Chart', 'Graph', 'Forecast', 'Projected']) {
      expect(history, forbidden).not.toContain(forbidden);
    }
    // A creator learns what was bought, never who bought it.
    expect(document.body.textContent, 'consumer').not.toContain('consumer');
  });
});

describe('Creator Studio payouts', () => {
  it('says which of the two things is stopping a payout, and shows the money anyway', async () => {
    renderStudio(
      doubleWith({
        ...activeCreatorState(),
        payoutReadiness: {
          balances: [
            {
              available: '1200',
              currency: 'USD',
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
    await signIn();
    await goTo('payouts');
    await screen.findByTestId('payouts-balance-USD');

    // The provider is the first thing in the way, so that is what it says —
    // sending a creator to finish onboarding they cannot complete would be
    // worse than telling them the platform is not ready.
    expect(textOf('payouts-blocked')).toContain(
      'no payout provider is approved',
    );
    // The money is real whatever the platform can do with it.
    expect(textOf('payouts-USD-available')).toBe('12.00 USD');
    // And no control that cannot succeed.
    expect(screen.queryByTestId('payouts-withdraw-USD')).toBeNull();
    expect(screen.queryByTestId('payouts-onboard')).toBeNull();
  });

  it('offers no bank field, no document upload, and no identity form', async () => {
    renderStudio(
      doubleWith({
        ...activeCreatorState(),
        payoutReadiness: {
          balances: [],
          enabled: false,
          policySource: 'unpublished',
          providerSource: 'local-test',
          recipientStatus: 'absent',
        },
      }),
    );
    await signIn();
    await goTo('payouts');
    await screen.findByTestId('payouts-onboard');

    // Not disabled: absent. Onboarding is a link into the provider's own flow,
    // and Velora has nowhere to put a bank detail even if somebody typed one.
    const markup = document.body.textContent;
    for (const forbidden of [
      'Account number',
      'Routing',
      'IBAN',
      'Sort code',
      'Tax ID',
      'Passport',
      'Upload',
    ]) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it('offers a withdrawal only for what the server says is releasable', async () => {
    renderStudio(
      doubleWith({
        ...activeCreatorState(),
        payoutReadiness: {
          balances: [
            {
              available: '1200',
              currency: 'USD',
              held: '0',
              releasable: '1200',
              reserved: '0',
            },
            {
              available: '500',
              currency: 'EUR',
              held: '500',
              releasable: '0',
              reserved: '0',
            },
          ],
          enabled: true,
          policySource: 'local-test',
          providerSource: 'local-test',
          recipientStatus: 'ready',
        },
      }),
    );
    await signIn();
    await goTo('payouts');
    await screen.findByTestId('payouts-balance-USD');

    // One currency has something releasable and one does not, and the control
    // follows the server's answer rather than the surface's arithmetic.
    expect(textOf('payouts-withdraw-USD')).toContain('12.00 USD');
    expect(screen.queryByTestId('payouts-withdraw-EUR')).toBeNull();
    expect(textOf('payouts-EUR-held')).toBe('5.00 EUR');
  });
});

describe('Creator Studio selling', () => {
  it('says selling is not enabled rather than offering a price field', async () => {
    renderStudio(doubleWith({ ...activeCreatorState() }));
    await signIn();
    await goTo('selling');
    await screen.findByTestId('offers-readiness');

    expect(textOf('offers-readiness')).toContain('not enabled');
    expect(textOf('offers-empty')).toContain('no commercial offers');
    // No form that always fails. Both operations exist in the API and both
    // refuse in every deployed environment, so a control here would be one
    // that cannot succeed.
    expect(document.querySelectorAll('input')).toHaveLength(0);
    const markup = document.body.textContent;
    for (const forbidden of ['Set price', 'Publish price', 'Create offer']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('shows the exact frozen price a purchase would reference', async () => {
    renderStudio(
      doubleWith({
        ...activeCreatorState(),
        offers: [
          {
            createdAt: '2026-08-15T12:00:00.000Z',
            id: 'offer-1',
            mode: 'subscription' as const,
            prices: [
              {
                amount: { amountMinor: '1500', currency: 'USD' },
                createdAt: '2026-08-15T12:00:00.000Z',
                effectiveFrom: '2026-08-15T12:00:00.000Z',
                id: 'price-1',
                interval: 'month' as const,
                state: 'active' as const,
              },
            ],
            resourceId: '11111111-1111-4111-8111-111111111111',
            resourceType: 'club' as const,
            state: 'draft' as const,
            updatedAt: '2026-08-15T12:00:00.000Z',
            version: 1,
          },
        ],
      }),
    );
    await signIn();
    await goTo('selling');
    const price = await screen.findByTestId('price-price-1');

    // The frozen row itself, not a suggestion or an estimate.
    expect(price.textContent).toContain('15.00 USD');
    expect(price.textContent).toContain('per month');
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
