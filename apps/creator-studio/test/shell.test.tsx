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
