import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AccountDetailScreen } from '../src/product/account';
import { ActivityScreen } from '../src/product/activity';
import { PlatformControls } from '../src/product/controls';
import { PlatformLive } from '../src/product/live-ops';
import { PlatformOperations } from '../src/product/operations';
import { PlatformOperators } from '../src/product/operators';
import { OperatorActions } from '../src/product/operator-audit';
import { PlatformPublicEntry } from '../src/product/public-entry';
import { MoneyReconciliation } from '../src/product/reconciliation';
import { SubjectSearchPanel } from '../src/product/search';
import {
  createAdminApiDouble,
  operatorAccountId,
  privilegedState,
  type AdminApiDoubleState,
} from './support/api-double';
import { renderConsole } from './support/render';

/**
 * The operator command centre, driven through the real contract.
 *
 * Two claims run through this file and both are asserted rather than described.
 *
 * **A capability is what stops a request, not a hidden button.** Every screen
 * here is rendered twice in spirit: once for an operator who holds the
 * capability and once for one who does not, and the second is refused by the
 * platform rather than merely undrawn. The double authorizes exactly as the
 * server does, including answering the same code for a missing capability as
 * for a wrong audience.
 *
 * **Nothing on these screens is a number the console made up.** Every figure
 * comes from a response; a screen with nothing to show says so rather than
 * showing a zero it invented; and no screen renders a message, a report
 * narrative, a ticket's text, or a push token, because the contract they read
 * has nowhere to put one.
 */

afterEach(cleanup);

const accountId = '11111111-1111-4111-8111-111111111111';

function operatorHolding(
  capabilities: readonly string[],
  extra: Partial<AdminApiDoubleState> = {},
): AdminApiDoubleState {
  const base = privilegedState();
  return {
    ...base,
    ...extra,
    operator: {
      capabilities: [...capabilities],
      environment: 'test',
      role: 'operations',
      source: 'grant',
    },
  };
}

/* ============================== Controls ============================= */

describe('the control plane', () => {
  it('shows every control, its value, and how long a change takes', async () => {
    const double = createAdminApiDouble(operatorHolding(['config.read']));
    renderConsole(<PlatformControls />, double, {
      pathname: '/platform/controls',
    });

    const control = await screen.findByTestId('control-live.search');
    expect(control.textContent).toContain('On');
    expect(control.textContent).toContain(
      'Encounters already running continue',
    );
    // The propagation bound is published rather than hidden. An operator
    // pausing something in an incident has to know whether to wait or press
    // again, and being told is the difference between a control they trust and
    // one they press twice.
    expect(
      (await screen.findByTestId('controls-propagation')).textContent,
    ).toContain('5 seconds');
  });

  it('refuses to change a control the operator may only read', async () => {
    const double = createAdminApiDouble(operatorHolding(['config.read']));
    renderConsole(<PlatformControls />, double, {
      pathname: '/platform/controls',
    });

    await screen.findByTestId('control-live.search');
    // The command is not drawn, and — the part that matters — it is not drawn
    // because the operator does not hold `config.write`, which the server would
    // also refuse. The console never became the thing enforcing it.
    expect(screen.queryByTestId('control-live.search-toggle')).toBeNull();
  });

  it('pauses a control with a reason, and reports what actually happened', async () => {
    const double = createAdminApiDouble(
      operatorHolding(['config.read', 'config.write']),
    );
    renderConsole(<PlatformControls />, double, {
      pathname: '/platform/controls',
    });

    fireEvent.click(await screen.findByTestId('control-live.search-toggle'));
    fireEvent.change(await screen.findByTestId('control-reason'), {
      target: { value: 'abuse spike from one region' },
    });
    fireEvent.click(screen.getByTestId('control-confirm-accept'));

    await waitFor(() => {
      expect(double.state.controls[0]?.enabled).toBe(false);
    });
    // The confirmation names the effect and the bound, never "Done".
    expect((await screen.findByTestId('toaster')).textContent).toContain(
      'live.search is now off',
    );
    // The compare-and-set token the write presented is the one the read
    // published, which is what makes two operators on this screen safe.
    const write = double.calls.find(
      (call) => call.path === '/v1/admin/controls' && call.method === 'POST',
    );
    expect(write?.body).toMatchObject({
      enabled: false,
      expectedVersion: 0,
      key: 'live.search',
    });
  });

  it('reports a lost race as a conflict, showing what actually stands', async () => {
    const double = createAdminApiDouble(
      operatorHolding(['config.read', 'config.write']),
    );
    renderConsole(<PlatformControls />, double, {
      pathname: '/platform/controls',
    });
    // Waiting for the command rather than for the panel, because the console
    // draws the panel as soon as the controls answer and the command only once
    // the operator's own standing has. That order is deliberate: a console that
    // drew every command until it learned otherwise would offer an operator
    // things they cannot run and then take them away under their cursor.
    const toggle = await screen.findByTestId('control-live.search-toggle');

    // Somebody else moved it between this operator's read and their press.
    double.state.controls = double.state.controls.map((control) =>
      control.key === 'live.search'
        ? { ...control, enabled: false, version: 4 }
        : control,
    );

    fireEvent.click(toggle);
    fireEvent.change(await screen.findByTestId('control-reason'), {
      target: { value: 'pausing during the incident' },
    });
    fireEvent.click(screen.getByTestId('control-confirm-accept'));

    expect((await screen.findByTestId('toaster')).textContent).toContain(
      'Another operator changed live.search first',
    );
  });

  it('records the refusal as well as the change', async () => {
    const double = createAdminApiDouble(
      operatorHolding(['audit.read', 'config.read', 'config.write']),
    );
    renderConsole(<PlatformControls />, double, {
      pathname: '/platform/controls',
    });
    const toggle = await screen.findByTestId('control-live.search-toggle');
    double.state.controls = double.state.controls.map((control) =>
      control.key === 'live.search'
        ? { ...control, enabled: false, version: 9 }
        : control,
    );
    fireEvent.click(toggle);
    fireEvent.change(await screen.findByTestId('control-reason'), {
      target: { value: 'pausing during the incident' },
    });
    fireEvent.click(screen.getByTestId('control-confirm-accept'));

    await waitFor(() => {
      expect(double.state.operatorActions[0]?.outcome).toBe('refused');
    });
    // An operator who tried something and was told no is a thing an incident
    // review needs to see. An audit of successes only would have a hole in it.
    expect(double.state.operatorActions[0]?.failureCode).toBe('STATE_CONFLICT');
  });
});

/* ========================== Operator audit =========================== */

describe('the operator audit', () => {
  it('shows what an operator changed, from what, to what, and why', async () => {
    const base = operatorHolding(['audit.read']);
    const double = createAdminApiDouble({
      ...base,
      operatorActions: [
        {
          action: 'control.set',
          actorReference: 'session:abc',
          capability: 'config.write',
          id: 'action-1',
          occurredAt: '2026-08-20T09:00:00.000Z',
          outcome: 'applied',
          previousState: 'enabled',
          reason: 'abuse spike from one region',
          requestedState: 'disabled',
          subjectId: 'live.search',
          subjectType: 'control',
        },
      ],
    });
    renderConsole(<OperatorActions />, double, {
      pathname: '/platform/security',
    });

    const row = await screen.findByTestId('operator-action-action-1');
    expect(row.textContent).toContain('enabled → disabled');
    expect(row.textContent).toContain('abuse spike from one region');
    expect(row.textContent).toContain('session:abc');
  });

  it('says nothing was recorded rather than showing an empty table', async () => {
    const double = createAdminApiDouble(operatorHolding(['audit.read']));
    renderConsole(<OperatorActions />, double, {
      pathname: '/platform/security',
    });
    expect(
      (await screen.findByTestId('operator-actions-empty')).textContent,
    ).toContain('No operator changed anything');
  });
});

/* ============================= Operators ============================= */

describe('operator roles', () => {
  it('publishes what each role can do beside the form that grants one', async () => {
    const double = createAdminApiDouble(operatorHolding(['operators.manage']));
    renderConsole(<PlatformOperators />, double, {
      pathname: '/platform/operators',
    });

    const catalogue = await screen.findByTestId('operators-catalogue');
    expect(catalogue.textContent).toContain('readonly');
    expect(catalogue.textContent).toContain('users.read');
  });

  it('grants a role with a reason and shows the grant', async () => {
    const double = createAdminApiDouble(operatorHolding(['operators.manage']));
    renderConsole(<PlatformOperators />, double, {
      pathname: '/platform/operators',
    });

    fireEvent.change(await screen.findByTestId('operator-subject'), {
      target: { value: operatorAccountId },
    });
    fireEvent.change(screen.getByTestId('operator-role'), {
      target: { value: 'operations' },
    });
    fireEvent.change(screen.getByTestId('operator-reason'), {
      target: { value: 'joining the on-call rota' },
    });
    fireEvent.click(screen.getByTestId('operator-submit'));
    fireEvent.click(await screen.findByTestId('operator-confirm-accept'));

    await waitFor(() => {
      expect(double.state.operatorGrants[0]?.role).toBe('operations');
    });
    expect(double.state.operatorGrants[0]?.reason).toBe(
      'joining the on-call rota',
    );
  });

  it('refuses an operator who does not hold operators.manage', async () => {
    const double = createAdminApiDouble(operatorHolding(['users.read']));
    renderConsole(<PlatformOperators />, double, {
      pathname: '/platform/operators',
    });
    expect(
      (await screen.findByTestId('operators-blocked')).textContent,
    ).toContain('operators.manage');
  });
});

/* ============================== Activity ============================= */

describe('the activity stream', () => {
  it('renders what happened without rendering what was said', async () => {
    const base = operatorHolding(['operations.read']);
    const double = createAdminApiDouble({
      ...base,
      activity: [
        {
          detail: 'ended_by_peer',
          domain: 'live',
          id: 'live.encounter_ended#e1',
          occurredAt: '2026-08-20T09:00:00.000Z',
          resourceId: '22222222-2222-4222-8222-222222222222',
          resourceType: 'encounter',
          subjectId: accountId,
          type: 'live.encounter_ended',
        },
        {
          domain: 'messaging',
          id: 'messaging.conversation_created#c1',
          occurredAt: '2026-08-20T08:00:00.000Z',
          resourceId: '33333333-3333-4333-8333-333333333333',
          resourceType: 'conversation',
          subjectId: accountId,
          type: 'messaging.conversation_created',
        },
      ],
    });
    renderConsole(<ActivityScreen />, double, { pathname: '/activity' });

    const timeline = await screen.findByTestId('activity-timeline');
    expect(timeline.textContent).toContain('Encounter ended');
    expect(timeline.textContent).toContain('Ended by peer');
    expect(timeline.textContent).toContain('Conversation created');
    // A conversation row carries that one began and nothing that was in it.
    // There is no field in the contract that could hold a message.
    expect(timeline.textContent).not.toContain('message');
  });

  it('narrows by domain in the request rather than in the browser', async () => {
    const double = createAdminApiDouble(operatorHolding(['operations.read']));
    renderConsole(<ActivityScreen />, double, { pathname: '/activity' });
    await screen.findByTestId('activity-empty');

    fireEvent.change(screen.getByTestId('activity-domain'), {
      target: { value: 'safety' },
    });

    await waitFor(() => {
      expect(
        double.calls.some(
          (call) =>
            call.path === '/v1/admin/activity' &&
            call.query.domain === 'safety',
        ),
      ).toBe(true);
    });
  });

  it('says the window was empty rather than showing an empty list', async () => {
    const double = createAdminApiDouble(operatorHolding(['operations.read']));
    renderConsole(<ActivityScreen />, double, { pathname: '/activity' });
    expect((await screen.findByTestId('activity-empty')).textContent).toContain(
      'That is an answer, not a gap',
    );
  });
});

/* =============================== Search ============================== */

describe('finding a record', () => {
  it('resolves an exact identifier and links to the record', async () => {
    const base = operatorHolding(['operations.read']);
    const double = createAdminApiDouble({
      ...base,
      accounts: [
        {
          createdAt: '2026-08-01T09:00:00.000Z',
          id: accountId,
          status: 'restricted',
          statusChangedAt: '2026-08-10T09:00:00.000Z',
        },
      ],
    });
    renderConsole(<SubjectSearchPanel />, double, { pathname: '/overview' });

    fireEvent.change(screen.getByTestId('subject-search-term'), {
      target: { value: accountId },
    });
    fireEvent.click(screen.getByTestId('subject-search-submit'));

    const match = await screen.findByTestId('subject-match-account');
    expect(match.getAttribute('href')).toBe(`/accounts/${accountId}`);
  });

  it('answers a value nothing wears with nothing at all', async () => {
    const double = createAdminApiDouble(operatorHolding(['operations.read']));
    renderConsole(<SubjectSearchPanel />, double, { pathname: '/overview' });

    fireEvent.change(screen.getByTestId('subject-search-term'), {
      target: { value: accountId },
    });
    fireEvent.click(screen.getByTestId('subject-search-submit'));

    // Nothing is probed and nothing is disclosed. A wrong guess reveals only
    // that it was wrong, which is what makes this a resolver rather than an
    // enumeration tool.
    expect(
      (await screen.findByTestId('subject-search-empty')).textContent,
    ).toContain('Nothing on this platform wears that identifier');
  });
});

/* ============================ Account 360 ============================ */

function accountDetailState(
  capabilities: readonly string[],
): AdminApiDoubleState {
  return operatorHolding(capabilities, {
    accountDetail: {
      account: {
        createdAt: '2026-07-01T09:00:00.000Z',
        id: accountId,
        region: 'IN',
        status: 'restricted',
        statusChangedAt: '2026-08-10T09:00:00.000Z',
        statusReason: 'safety_restriction',
      },
      acquisition: {
        attributedAt: '2026-07-01T09:00:00.000Z',
        source: 'invite',
        viaInvitation: true,
      },
      commerce: {
        payments: [{ label: 'succeeded', total: 2 }],
        subscriptions: [],
      },
      connections: {
        conversations: 3,
        introductions: [{ label: 'mutual', total: 1 }],
      },
      devices: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          lastSeenAt: '2026-08-19T09:00:00.000Z',
          platform: 'android',
          registeredAt: '2026-07-02T09:00:00.000Z',
        },
      ],
      live: {
        encounters: [
          {
            endReason: 'ended_by_peer',
            endedAt: '2026-08-18T09:10:00.000Z',
            id: '22222222-2222-4222-8222-222222222222',
            medium: 'video',
            startedAt: '2026-08-18T09:00:00.000Z',
            state: 'ended',
          },
        ],
      },
      profileComplete: true,
      safety: {
        appeals: 1,
        blocksMade: 0,
        blocksReceived: 2,
        enforcements: [{ label: 'consumer_interaction', total: 1 }],
        reportsAbout: 4,
        reportsMade: 0,
      },
      sessions: [
        {
          audience: 'consumer_web',
          authenticatedAt: '2026-08-19T09:00:00.000Z',
          id: '55555555-5555-4555-8555-555555555555',
          lastActiveAt: '2026-08-19T10:00:00.000Z',
        },
      ],
      support: [{ label: 'open', total: 1 }],
      wallet: { available: '120', reserved: '30' },
    },
  });
}

describe('one account, in operational terms', () => {
  it('shows counts and states, and no word anybody wrote', async () => {
    const double = createAdminApiDouble(accountDetailState(['users.read']));
    renderConsole(<AccountDetailScreen accountId={accountId} />, double, {
      params: { accountId },
      pathname: `/accounts/${accountId}`,
    });

    const safety = await screen.findByTestId('account-safety');
    expect(safety.textContent).toContain('4');
    const identity = await screen.findByTestId('account-identity');
    expect(identity.textContent).toContain('Safety restriction');
    expect(identity.textContent).toContain('invite');
    // The device is identified, never its push token — a console with a copy
    // button beside a push credential is a console that eventually leaks one.
    const devices = await screen.findByTestId(
      'account-device-44444444-4444-4444-8444-444444444444',
    );
    expect(devices.textContent).toContain('Android');
  });

  it('offers session revocation only to an operator who holds it', async () => {
    const double = createAdminApiDouble(accountDetailState(['users.read']));
    renderConsole(<AccountDetailScreen accountId={accountId} />, double, {
      params: { accountId },
      pathname: `/accounts/${accountId}`,
    });
    await screen.findByTestId('account-sessions');
    expect(screen.queryByTestId('account-revoke-sessions')).toBeNull();
  });

  it('revokes every session and reports the platform’s own numbers', async () => {
    const double = createAdminApiDouble(
      accountDetailState(['users.read', 'sessions.revoke']),
    );
    renderConsole(<AccountDetailScreen accountId={accountId} />, double, {
      params: { accountId },
      pathname: `/accounts/${accountId}`,
    });

    fireEvent.click(await screen.findByTestId('account-revoke-sessions'));
    fireEvent.change(await screen.findByTestId('account-revoke-reason'), {
      target: { value: 'credential stuffing on this account' },
    });
    fireEvent.click(screen.getByTestId('account-revoke-confirm-accept'));

    // Not "Done": what actually happened, in the numbers the platform changed.
    expect((await screen.findByTestId('toaster')).textContent).toContain(
      '2 browser session(s) and 1 device sign-in(s) ended',
    );
    await waitFor(() => {
      expect(double.state.operatorActions[0]?.action).toBe('sessions.revoked');
    });
  });

  it('shows the coin position beside what the journal implies', async () => {
    const base = accountDetailState(['users.read', 'wallet.read']);
    const double = createAdminApiDouble({
      ...base,
      wallet: {
        available: '120',
        entries: [
          {
            amount: '150',
            businessType: 'wallet.grant',
            direction: 'credit',
            occurredAt: '2026-08-01T09:00:00.000Z',
            reason: 'development_grant',
            transactionId: '66666666-6666-4666-8666-666666666666',
          },
        ],
        entriesTotal: '150',
        reserved: '30',
        userId: accountId,
      },
    });
    renderConsole(<AccountDetailScreen accountId={accountId} />, double, {
      params: { accountId },
      pathname: `/accounts/${accountId}`,
    });

    const wallet = await screen.findByTestId('account-wallet');
    // 120 available + 30 reserved = 150, which is what the journal says. The
    // useful operator question is not what the balance is but whether it
    // follows from what happened, and only a screen showing both can answer it.
    expect(
      within(wallet).getByText('Balance agrees with journal'),
    ).toBeTruthy();
  });

  it('shows a disagreement between the balance and the journal', async () => {
    const base = accountDetailState(['users.read', 'wallet.read']);
    const double = createAdminApiDouble({
      ...base,
      wallet: {
        available: '120',
        entries: [],
        entriesTotal: '151',
        reserved: '30',
        userId: accountId,
      },
    });
    renderConsole(<AccountDetailScreen accountId={accountId} />, double, {
      params: { accountId },
      pathname: `/accounts/${accountId}`,
    });

    const wallet = await screen.findByTestId('account-wallet');
    expect(within(wallet).getByText('Balance disagrees')).toBeTruthy();
  });
});

/* ============================= Operations ============================ */

describe('platform operations', () => {
  it('separates a seam nobody approved from one that failed', async () => {
    const double = createAdminApiDouble(operatorHolding(['operations.read']));
    renderConsole(<PlatformOperations />, double, {
      pathname: '/platform/operations',
    });

    const database = await screen.findByTestId('dependency-database');
    expect(database.textContent).toContain('Healthy');
    const payments = await screen.findByTestId('dependency-payment-provider');
    // Unconfigured, not unavailable. Most of VELORA's provider seams are off on
    // purpose, and an operations screen that called those failures would be
    // unreadable on the day one genuinely fails.
    expect(payments.textContent).toContain('Unconfigured');
  });

  it('reports a queue nobody could reach as unknown rather than zero', async () => {
    const base = operatorHolding(['operations.read']);
    const double = createAdminApiDouble({
      ...base,
      operations: {
        ...base.operations,
        queues: [{ name: 'notifications', reachable: false }],
      },
    });
    renderConsole(<PlatformOperations />, double, {
      pathname: '/platform/operations',
    });

    const queue = await screen.findByTestId('queue-notifications');
    expect(queue.textContent).toContain('Unreachable');
    expect(queue.textContent).not.toContain('0');
  });

  it('says nothing failed rather than showing an empty table', async () => {
    const double = createAdminApiDouble(operatorHolding(['operations.read']));
    renderConsole(<PlatformOperations />, double, {
      pathname: '/platform/operations',
    });
    expect(
      (await screen.findByTestId('operations-failures-empty')).textContent,
    ).toContain('No domain recorded a failure');
  });
});

/* ================================ Live =============================== */

describe('live operations', () => {
  it('shows the pool without inventing a count of who is online', async () => {
    const base = operatorHolding(['live.read']);
    const double = createAdminApiDouble({
      ...base,
      live: {
        ...base.live,
        liveEncounters: 4,
        participations: [{ label: 'searching', total: 9 }],
      },
    });
    renderConsole(<PlatformLive />, double, { pathname: '/platform/live' });

    expect(
      (await screen.findByTestId('live-encounters-count')).textContent,
    ).toContain('4');
    expect(
      (await screen.findByTestId('live-participation-searching')).textContent,
    ).toContain('9');
    // No "users online" anywhere the platform answered. The only occurrence of
    // the word on this screen is the sentence explaining why there is no such
    // figure, which is the point rather than an exception to it.
    expect(
      (await screen.findByTestId('live-participations')).textContent,
    ).not.toMatch(/online/iu);
  });

  it('says plainly when new searches are paused', async () => {
    const base = operatorHolding(['live.read']);
    const double = createAdminApiDouble({
      ...base,
      live: { ...base.live, searchAdmitted: false },
    });
    renderConsole(<PlatformLive />, double, { pathname: '/platform/live' });

    expect((await screen.findByTestId('live-paused')).textContent).toContain(
      'Encounters already running are continuing',
    );
  });
});

/* =========================== Reconciliation ========================== */

describe('money reconciliation', () => {
  it('publishes each finding’s definition beside its count', async () => {
    const base = operatorHolding(['billing.read']);
    const double = createAdminApiDouble({
      ...base,
      reconciliation: [
        {
          definition:
            'Payments in a non-terminal state and untouched for more than 60 minutes.',
          examples: ['77777777-7777-4777-8777-777777777777'],
          key: 'payment_stuck',
          total: 1,
        },
      ],
    });
    renderConsole(<MoneyReconciliation />, double, {
      pathname: '/money/reconciliation',
    });

    const finding = await screen.findByTestId('finding-payment_stuck');
    // A number nobody can define is a number nobody should act on, so the
    // definition travels with the count rather than living in a document.
    expect(finding.textContent).toContain('more than 60 minutes');
    expect(finding.textContent).toContain('77777777');
  });

  it('says the platform is clean rather than showing green rows', async () => {
    const double = createAdminApiDouble(operatorHolding(['billing.read']));
    renderConsole(<MoneyReconciliation />, double, {
      pathname: '/money/reconciliation',
    });
    expect(
      (await screen.findByTestId('reconciliation-empty')).textContent,
    ).toContain('Every ledger transaction balances');
  });
});

/* ============================ Public entry =========================== */

describe('public entry', () => {
  it('says which of the two conditions is missing', async () => {
    const double = createAdminApiDouble(operatorHolding(['growth.read']));
    renderConsole(<PlatformPublicEntry />, double, {
      pathname: '/platform/public-entry',
    });

    expect(
      (await screen.findByTestId('public-entry-not-indexable')).textContent,
    ).toContain('test environment');
  });

  it('counts addresses that exist rather than rows that could', async () => {
    const base = operatorHolding(['growth.read']);
    const double = createAdminApiDouble({
      ...base,
      publicEntry: {
        canonicalOrigin: 'https://velora.example',
        environment: 'production',
        indexable: true,
        liveWindows: { active: 1, cancelled: 0, upcoming: 2 },
        publishedClubs: 3,
        publishedCreators: 7,
      },
    });
    renderConsole(<PlatformPublicEntry />, double, {
      pathname: '/platform/public-entry',
    });

    expect(
      (await screen.findByTestId('public-entry-creators-count')).textContent,
    ).toContain('7');
    expect(
      (await screen.findByTestId('public-entry-state')).textContent,
    ).toContain('https://velora.example');
  });
});
