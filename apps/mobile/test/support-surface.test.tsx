import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { createInMemorySecureTokenStore } from '../src/auth/secure-storage';
import { SupportScreen } from '../src/product/support';
import { AccountScreen } from '../src/product/you';
import {
  admittedState,
  createMobileApiDouble,
  type MobileApiState,
} from './support/api-double';
import { renderScreen } from './support/render';

/**
 * Getting help, on a phone.
 *
 * The same three properties the web suite proves, asserted here because they
 * are properties of the product rather than of one renderer: submitting hands
 * back a reference, what was sent stays visible with the server's status, and a
 * refusal says so rather than pretending the message went.
 *
 * And one absence: no response-time promise, because VELORA has nobody on a
 * rota and a deadline it cannot keep is worse than no deadline.
 */

beforeEach(async () => {
  await cleanup();
});

async function mount(state: MobileApiState = admittedState()) {
  const double = createMobileApiDouble(state);
  const store = createInMemorySecureTokenStore();
  await store.write({
    accessToken: 'access-stored',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    installationId: 'installation-local-device',
    refreshToken: 'refresh-stored',
  });
  const view = await renderScreen(
    <SupportScreen onBack={() => undefined} />,
    double,
    { store },
  );
  return { double, view };
}

async function press(testID: string): Promise<void> {
  // Every event is awaited: firing is asynchronous in this version of the
  // library, and a second event before the first settles leaves act bookkeeping
  // unbalanced for the rest of the file.
  await fireEvent.press(screen.getByTestId(testID));
}

async function fillAndSend(): Promise<void> {
  await screen.findByTestId('support-form-card');
  await fireEvent.changeText(
    screen.getByTestId('support-subject'),
    'Cannot sign in on my phone',
  );
  await fireEvent.changeText(
    screen.getByTestId('support-description'),
    'The screen just spins after I put my email in and nothing happens.',
  );
  await press('support-submit');
}

describe('help on a phone', () => {
  it('hands back a reference to quote', async () => {
    const { double } = await mount();

    await fillAndSend();

    const reference = await screen.findByTestId('support-reference');
    expect(reference).toHaveTextContent(/VS-/u);
    expect(double.state.supportTickets).toHaveLength(1);
  });

  it('shows what was sent, with the status the server holds', async () => {
    await mount();
    await fillAndSend();
    await screen.findByTestId('support-reference');

    const list = await screen.findByTestId('support-ticket-list');
    expect(list).toHaveTextContent(/Cannot sign in on my phone/u);
    // The plain word for "nobody has looked yet".
    expect(list).toHaveTextContent(/Received/u);
  });

  it('points somebody being harassed at reporting instead', async () => {
    await mount();
    const hint = await screen.findByTestId('support-safety-hint');
    expect(hint).toHaveTextContent(/[Rr]eport/u);
  });

  it('says a refusal happened rather than pretending it sent', async () => {
    const state = admittedState();
    state.supportBoundReached = true;
    const { double } = await mount(state);

    await fillAndSend();

    await waitFor(() => {
      expect(screen.getByTestId('support-error')).toBeTruthy();
    });
    expect(screen.queryByTestId('support-reference')).toBeNull();
    expect(double.state.supportTickets).toHaveLength(0);
  });
});

/**
 * Leaving, on a phone.
 *
 * The control used to be absent and the screen said the path was not finished,
 * which is the exact shape of the complaint people make about every other
 * product in this category. What is asserted here is that the control does what
 * it says and that the copy claims only what actually happened.
 */
describe('closing an account', () => {
  it('closes for real, and does not claim data has been erased', async () => {
    const double = createMobileApiDouble(admittedState());
    const store = createInMemorySecureTokenStore();
    await store.write({
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      installationId: 'installation-local-device',
      refreshToken: 'refresh-stored',
    });
    await renderScreen(<AccountScreen onBack={() => undefined} />, double, {
      store,
    });

    await press('close-account');
    await screen.findByTestId('close-account-confirm');
    await press('close-account-do');

    await waitFor(() => {
      expect(double.state.closure?.status).toBe('deletion_pending');
    });

    const retention = await screen.findByTestId('closure-retention');
    // Destroying what remains depends on retention schedules nobody has
    // approved. Saying it has happened would be the one claim on this screen
    // that could not be walked back.
    expect(retention).not.toHaveTextContent(/erased/u);
    expect(retention).toHaveTextContent(/has not yet published/u);
  });

  it('lets somebody change their mind at the confirmation', async () => {
    const double = createMobileApiDouble(admittedState());
    const store = createInMemorySecureTokenStore();
    await store.write({
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      installationId: 'installation-local-device',
      refreshToken: 'refresh-stored',
    });
    await renderScreen(<AccountScreen onBack={() => undefined} />, double, {
      store,
    });

    await press('close-account');
    await press('close-account-keep');

    // The confirmation is where the caution lives, because there is no undo
    // once it is answered.
    await waitFor(() => {
      expect(screen.queryByTestId('close-account-confirm')).toBeNull();
    });
    expect(double.state.closure).toBeNull();
  });
});
