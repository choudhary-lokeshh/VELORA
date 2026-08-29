import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Accounts } from '../src/product/accounts';
import { Audit } from '../src/product/audit';
import { Clubs, ClubScreen } from '../src/product/clubs';
import { Overview } from '../src/product/overview';
import { Payments, PaymentScreen } from '../src/product/payments';
import { Payouts } from '../src/product/payouts';
import { PlatformSecurity } from '../src/product/platform';
import {
  createAdminApiDouble,
  privilegedState,
  type AdminApiDoubleState,
} from './support/api-double';
import { renderConsole } from './support/render';

/**
 * The operator screens this phase added, driven through the real contract.
 *
 * Everything here goes through the generated client and a `fetch` that answers
 * the real paths with the real shapes, so what passes is evidence about the
 * product rather than about the test's own mocks.
 *
 * Two claims recur and are asserted rather than described. **Nothing on these
 * screens is a number the console made up** — every figure comes from a
 * response, and a screen with nothing to show says so instead of showing a
 * zero it invented. And **nothing publishes a person**: a payment has no payer,
 * a payout has no destination, a membership has no member, and a security event
 * has no account, on the screens as well as in the contract.
 */

afterEach(cleanup);

const at = '2026-08-20T09:00:00.000Z';

function withOverview(
  attention: Partial<AdminApiDoubleState['overview']['attention']> = {},
  extra: Partial<AdminApiDoubleState['overview']> = {},
): AdminApiDoubleState {
  const base = privilegedState();
  return {
    ...base,
    overview: {
      ...base.overview,
      attention: { ...base.overview.attention, ...attention },
      ...extra,
    },
  };
}

/* ============================== Overview ============================= */

describe('the operations overview', () => {
  it('shows what needs a person, as the platform counted it', async () => {
    const double = createAdminApiDouble(
      withOverview(
        { appealsAwaiting: 2, casesOpen: 7, casesUnclaimed: 3 },
        {
          casesByPriority: [{ count: 3, state: 'urgent' }],
          casesByQueue: [{ count: 7, state: 'consumer_conduct' }],
          oldestOpenCaseAt: '2026-08-19T09:00:00.000Z',
        },
      ),
    );
    renderConsole(<Overview />, double, { pathname: '/overview' });

    expect(
      (await screen.findByTestId('overview-cases-unclaimed')).textContent,
    ).toContain('3');
    expect(
      screen.getByTestId('overview-appeals-awaiting').textContent,
    ).toContain('2');
    expect(
      screen.getByTestId('overview-by-queue-consumer_conduct').textContent,
    ).toBe('7');
    expect(screen.getByTestId('overview-by-priority-urgent').textContent).toBe(
      '3',
    );
  });

  it('sends every count somewhere an operator can act', async () => {
    const double = createAdminApiDouble(withOverview({ casesUnclaimed: 1 }));
    renderConsole(<Overview />, double, { pathname: '/overview' });

    const tile = await screen.findByTestId('overview-cases-unclaimed');
    // A number an operator cannot act on is a number that decides nothing.
    expect(tile.closest('a')?.getAttribute('href')).toBe('/queues');
    expect(
      screen
        .getByTestId('overview-payouts-awaiting')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/money/payouts');
  });

  it('says nothing is open rather than showing an age of zero', async () => {
    const double = createAdminApiDouble(withOverview());
    renderConsole(<Overview />, double, { pathname: '/overview' });

    expect(await screen.findByTestId('overview-none-open')).toBeDefined();
    expect(screen.queryByTestId('overview-oldest-age')).toBeNull();
  });

  it('shows how old the oldest unsettled case is, not only when it opened', async () => {
    const double = createAdminApiDouble(
      withOverview({ casesOpen: 1 }, { oldestOpenCaseAt: at }),
    );
    // The overview's own `observedAt` is the clock, so the age is the
    // platform's arithmetic rather than the browser's.
    double.state.overview = {
      ...double.state.overview,
      observedAt: '2026-08-22T09:00:00.000Z',
    };
    renderConsole(<Overview />, double, { pathname: '/overview' });

    expect(
      (await screen.findByTestId('overview-oldest-age')).textContent,
    ).toContain('2d');
  });

  it('offers a retry when the platform could not be reached', async () => {
    const double = createAdminApiDouble(privilegedState());
    double.failNext('/v1/admin/overview');
    renderConsole(<Overview />, double, { pathname: '/overview' });

    const failure = await screen.findByTestId('overview-failed');
    expect(
      within(failure).getByRole('button', { name: 'Try again' }),
    ).toBeDefined();
  });
});

/* ============================== Accounts ============================= */

describe('consumer accounts', () => {
  function withAccounts(): AdminApiDoubleState {
    return {
      ...privilegedState(),
      accounts: [
        {
          createdAt: at,
          id: '11111111-1111-4111-8111-111111111111',
          region: 'ES',
          status: 'restricted',
          statusChangedAt: at,
          statusReason: 'safety_enforcement',
        },
        {
          createdAt: at,
          id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          statusChangedAt: at,
        },
      ],
    };
  }

  it('opens on the accounts the platform has decided about, not on everybody', async () => {
    const double = createAdminApiDouble(withAccounts());
    renderConsole(<Accounts />, double, { pathname: '/accounts' });

    await screen.findByTestId('account-11111111-1111-4111-8111-111111111111');
    // The active account exists and is deliberately not in the work list.
    expect(
      screen.queryByTestId('account-22222222-2222-4222-8222-222222222222'),
    ).toBeNull();
    // And the denominator is still on the screen, so an empty work list can
    // never read as an empty platform.
    expect(screen.getByTestId('accounts-count-active').textContent).toBe('1');
    expect(screen.getByTestId('accounts-count-restricted').textContent).toBe(
      '1',
    );
  });

  it('says why an account is restricted, in the platform’s own coarse words', async () => {
    const double = createAdminApiDouble(withAccounts());
    renderConsole(<Accounts />, double, { pathname: '/accounts' });

    const row = await screen.findByTestId(
      'account-11111111-1111-4111-8111-111111111111',
    );
    expect(row.textContent).toContain('Restricted');
    expect(row.textContent).toContain('Safety enforcement');
    expect(row.textContent).toContain('ES');
  });

  it('offers no operation on a consumer account anywhere', async () => {
    const double = createAdminApiDouble(withAccounts());
    renderConsole(<Accounts />, double, { pathname: '/accounts' });

    await screen.findByTestId('account-11111111-1111-4111-8111-111111111111');
    const list = screen.getByTestId('account-list');
    // Restricting somebody and letting them back in are decisions that carry a
    // case, a reason, and an appeal path. Neither has a button here.
    expect(
      within(list).queryByRole('button', { name: /restrict/iu }),
    ).toBeNull();
    expect(
      within(list).queryByRole('button', { name: /reinstate/iu }),
    ).toBeNull();
    expect(screen.getByTestId('accounts-no-actions')).toBeDefined();
  });

  it('says the work list is empty rather than showing nothing at all', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<Accounts />, double, { pathname: '/accounts' });

    expect(
      (await screen.findByTestId('account-list-empty')).textContent,
    ).toContain('No account is restricted');
  });
});

/* ============================== Payments ============================= */

const payment = {
  amountMinor: '1500',
  createdAt: at,
  currency: 'USD',
  id: '33333333-3333-4333-8333-333333333333',
  lastProviderSyncAt: at,
  provider: 'local-test',
  providerReference: 'lt_payment_reference',
  resourceType: 'club',
  state: 'succeeded',
  taxMinor: '0',
  updatedAt: at,
};

function withPayments(): AdminApiDoubleState {
  return { ...privilegedState(), payments: [payment] };
}

describe('payments', () => {
  it('shows the amount against its own currency and what was sold', async () => {
    const double = createAdminApiDouble(withPayments());
    renderConsole(<Payments />, double, { pathname: '/money/payments' });

    const row = await screen.findByTestId(`payment-${payment.id}`);
    expect(row.textContent).toContain('15.00 USD');
    expect(row.textContent).toContain('Club membership');
    expect(row.textContent).toContain('Succeeded');
  });

  it('never says who paid', async () => {
    const double = createAdminApiDouble(withPayments());
    renderConsole(<Payments />, double, { pathname: '/money/payments' });

    await screen.findByTestId(`payment-${payment.id}`);
    const list = screen.getByTestId('payment-list');
    // Not a field that happens to be blank: there is no column for a payer,
    // because a payments list keyed by one is a purchase history.
    for (const forbidden of ['Payer', 'Consumer', 'Buyer', 'Customer']) {
      expect(list.textContent).not.toContain(forbidden);
    }
  });

  it('asks the platform for a filtered page rather than filtering what arrived', async () => {
    const double = createAdminApiDouble(withPayments());
    renderConsole(<Payments />, double, { pathname: '/money/payments' });
    await screen.findByTestId(`payment-${payment.id}`);

    screen.getByTestId('segment-failed').click();

    // The list is keyset-paged, so a filter applied to one page would quietly
    // hide the rest of the platform's own record.
    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/admin/billing/payments' &&
            call.query.state === 'failed',
        ),
      ).toBe(true);
    });
  });

  it('carries the reversals and the claims against one payment', async () => {
    const state = withPayments();
    const double = createAdminApiDouble({
      ...state,
      disputeQueue: [
        {
          amount: { amountMinor: '1500', currency: 'USD' },
          createdAt: at,
          id: 'dispute-1',
          openedAt: at,
          paymentId: payment.id,
          providerReference: 'lt_dispute',
          reasonCode: 'product_not_received',
          state: 'opened',
        },
      ],
      paymentRefunds: {
        [payment.id]: [
          {
            amountMinor: '500',
            createdAt: at,
            currency: 'USD',
            id: 'refund-1',
            paymentId: payment.id,
            provider: 'local-test',
            reasonCode: 'operator_correction',
            state: 'succeeded',
            updatedAt: at,
          },
        ],
      },
    });
    renderConsole(<PaymentScreen paymentId={payment.id} />, double, {
      params: { paymentId: payment.id },
      pathname: `/money/payments/${payment.id}`,
    });

    await screen.findByTestId('payment-record');
    expect(screen.getByTestId('refund-refund-1').textContent).toContain(
      '5.00 USD',
    );
    expect(screen.getByTestId('claim-dispute-1').textContent).toContain(
      'lt_disp',
    );
  });

  it('offers no way to move money from a payment', async () => {
    const double = createAdminApiDouble(withPayments());
    renderConsole(<PaymentScreen paymentId={payment.id} />, double, {
      params: { paymentId: payment.id },
      pathname: `/money/payments/${payment.id}`,
    });

    await screen.findByTestId('payment-record');
    expect(screen.queryByRole('button', { name: /refund/iu })).toBeNull();
    expect(screen.getByTestId('payment-no-actions')).toBeDefined();
  });

  it('says a payment that is not there is not there', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(
      <PaymentScreen paymentId="44444444-4444-4444-8444-444444444444" />,
      double,
      { pathname: '/money/payments/44444444-4444-4444-8444-444444444444' },
    );

    // A skeleton that never resolves is what an operator sees when a screen
    // treats "there is no such record" as "still loading".
    expect(await screen.findByTestId('payment-not-found')).toBeDefined();
  });
});

/* =============================== Payouts ============================= */

describe('payouts', () => {
  it('explains an empty queue by what the platform is missing', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<Payouts />, double, { pathname: '/money/payouts' });

    const empty = await screen.findByTestId('payout-list-empty');
    // Honest emptiness rather than a blank panel: the reason is a provider and
    // a policy decision, not a fault in this screen.
    expect(empty.textContent).toContain('No payout provider is approved');
  });

  it('shows the provider reference and the failure, and no destination', async () => {
    const double = createAdminApiDouble({
      ...privilegedState(),
      payouts: [
        {
          amountMinor: '9000',
          createdAt: at,
          creatorId: '55555555-5555-4555-8555-555555555555',
          currency: 'EUR',
          failureReason: 'recipient_not_ready',
          id: '66666666-6666-4666-8666-666666666666',
          provider: 'local-test',
          providerReference: 'lt_payout_reference',
          requestedBy: 'session:abc',
          state: 'failed',
          updatedAt: at,
        },
      ],
    });
    renderConsole(<Payouts />, double, { pathname: '/money/payouts' });

    const row = await screen.findByTestId(
      'payout-66666666-6666-4666-8666-666666666666',
    );
    expect(row.textContent).toContain('90.00 EUR');
    expect(row.textContent).toContain('Recipient not ready');
    expect(
      screen.getByTestId('payout-66666666-6666-4666-8666-666666666666-provider')
        .textContent,
    ).toContain('lt_payo');
    for (const forbidden of ['IBAN', 'Bank', 'Account name', 'Destination']) {
      expect(screen.getByTestId('payout-list').textContent).not.toContain(
        forbidden,
      );
    }
  });

  it('offers no release, no retry, and no cancellation', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<Payouts />, double, { pathname: '/money/payouts' });

    await screen.findByTestId('payout-list-empty');
    for (const absent of [/release/iu, /retry/iu, /cancel/iu]) {
      expect(screen.queryByRole('button', { name: absent })).toBeNull();
    }
    expect(screen.getByTestId('payouts-no-actions')).toBeDefined();
  });
});

/* ================================ Clubs ============================== */

const club = {
  createdAt: at,
  creatorId: '77777777-7777-4777-8777-777777777777',
  handle: 'embervale',
  id: '88888888-8888-4888-8888-888888888888',
  lifecycle: 'published',
  memberships: [
    { count: 4, state: 'active' },
    { count: 1, state: 'revoked' },
  ],
  name: 'Inner circle',
  publishedAt: at,
  slug: 'inner-circle',
};

describe('clubs and memberships', () => {
  it('counts a club’s members without listing them', async () => {
    const double = createAdminApiDouble({
      ...privilegedState(),
      clubs: [club],
    });
    renderConsole(<Clubs />, double, { pathname: '/creators/clubs' });

    const row = await screen.findByTestId(`club-${club.id}`);
    expect(within(row).getByTestId(`club-${club.id}-active`).textContent).toBe(
      '4',
    );
    expect(row.textContent).toContain('@embervale');
  });

  it('gives the membership operation a target an operator can find', async () => {
    const double = createAdminApiDouble({
      ...privilegedState(),
      clubMemberships: {
        [club.id]: [
          {
            grantedAt: at,
            id: '99999999-9999-4999-8999-999999999998',
            source: 'billing',
            state: 'active',
          },
        ],
      },
      clubs: [club],
    });
    renderConsole(<ClubScreen clubId={club.id} />, double, {
      params: { clubId: club.id },
      pathname: `/creators/clubs/${club.id}`,
    });

    const row = await screen.findByTestId(
      'membership-99999999-9999-4999-8999-999999999998',
    );
    // Before this screen the console asked an operator to paste an identifier
    // it could not show them.
    expect(row.textContent).toContain('Bought');
    expect(
      screen.getByTestId(
        'membership-99999999-9999-4999-8999-999999999998-reference',
      ).textContent,
    ).toContain('99999999');
  });

  it('never says who holds a membership', async () => {
    const double = createAdminApiDouble({
      ...privilegedState(),
      clubMemberships: {
        [club.id]: [
          {
            grantedAt: at,
            id: '99999999-9999-4999-8999-999999999998',
            source: 'billing',
            state: 'active',
          },
        ],
      },
      clubs: [club],
    });
    renderConsole(<ClubScreen clubId={club.id} />, double, {
      params: { clubId: club.id },
      pathname: `/creators/clubs/${club.id}`,
    });

    await screen.findByTestId('club-memberships');
    const panel = screen.getByTestId('club-memberships');
    // The column that would name somebody, and every word a console would use
    // to head one. "Membership" is the record; "member" is the person.
    for (const forbidden of [
      'Member ',
      'Held by',
      'Holder',
      'Consumer',
      'Account',
    ]) {
      expect(panel.textContent).not.toContain(forbidden);
    }
  });

  it('says a club that is not there is not there', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<ClubScreen clubId={club.id} />, double, {
      params: { clubId: club.id },
      pathname: `/creators/clubs/${club.id}`,
    });

    expect(await screen.findByTestId('club-missing')).toBeDefined();
  });
});

/* ================================ Audit ============================== */

describe('the two audit records', () => {
  it('reads AUTH’s events without reading whose they are', async () => {
    const double = createAdminApiDouble({
      ...privilegedState(),
      audit: [
        {
          audience: 'platform_admin',
          correlationId: 'correlation-1',
          id: '900',
          occurredAt: at,
          outcome: 'password_incorrect',
          stream: 'security',
          what: 'authentication_failed',
        },
      ],
    });
    renderConsole(<PlatformSecurity />, double, {
      pathname: '/platform/security',
    });

    const entry = await screen.findByTestId('audit-security-entries-900');
    expect(entry.textContent).toContain('Authentication failed');
    expect(entry.textContent).toContain('Password incorrect');
    expect(entry.textContent).toContain('Platform admin');
    // No account, and no field for one to arrive in.
    expect(screen.getByTestId('audit-security-scope').textContent).toContain(
      'No account',
    );
  });

  it('reads a settled decision as what was done, under which reason', async () => {
    const double = createAdminApiDouble({
      ...privilegedState(),
      audit: [
        {
          actorReference: 'session:2c9f',
          id: 'decision-1',
          occurredAt: at,
          outcome: 'harassment',
          stream: 'decision',
          subjectType: 'consumer_account',
          what: 'restrict_capability',
        },
      ],
    });
    renderConsole(
      <Audit
        emptyBody="No case has been decided on this platform."
        emptyTitle="Nothing decided"
        lede="What was done, under which reason, against which kind of target."
        stream="decision"
        title="Settled decisions"
      />,
      double,
      { pathname: '/queues/decisions' },
    );

    const entry = await screen.findByTestId(
      'audit-decision-entries-decision-1',
    );
    expect(entry.textContent).toContain('Restrict a capability');
    expect(entry.textContent).toContain('Harassment');
    expect(entry.textContent).toContain('consumer account');
  });

  it('says a record is empty rather than showing an empty list', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<PlatformSecurity />, double, {
      pathname: '/platform/security',
    });

    expect(await screen.findByTestId('audit-security-empty')).toBeDefined();
  });

  it('tones nothing, because an event log publishes no judgement', async () => {
    const double = createAdminApiDouble({
      ...privilegedState(),
      audit: [
        {
          audience: 'consumer_web',
          correlationId: 'correlation-2',
          id: '901',
          occurredAt: at,
          outcome: 'session_revoked',
          stream: 'security',
          what: 'session_terminated',
        },
      ],
    });
    renderConsole(<PlatformSecurity />, double, {
      pathname: '/platform/security',
    });

    const entry = await screen.findByTestId('audit-security-entries-901');
    // One domain's "terminated" is another's ordinary logout. Colouring it
    // would be this console deciding which of the platform's records is bad.
    expect(entry.querySelector('.a-badge')).toBeNull();
  });
});
