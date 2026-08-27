import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AdminGate } from '../src/app/gate';
import { Access } from '../src/product/access';
import { Appeals } from '../src/product/appeals';
import { CaseScreen } from '../src/product/case';
import { Creators } from '../src/product/creators';
import { Money } from '../src/product/money';
import {
  PlatformIdentity,
  PlatformMedia,
  PlatformNotifications,
  PlatformRtc,
} from '../src/product/platform';
import { Queues } from '../src/product/queues';
import {
  anonymousState,
  consumerSessionState,
  createAdminApiDouble,
  privilegedState,
  type AdminApiDoubleState,
} from './support/api-double';
import { navigations } from './support/navigation';
import { renderConsole } from './support/render';

/**
 * Platform Admin, driven through the real contract.
 *
 * Every assertion below goes through the generated client and a `fetch` that
 * answers the real paths with the real shapes, so what passes is evidence about
 * the product rather than about the test's own mocks.
 *
 * The suite is split the way the surface is: what a browser can actually reach
 * — the door and the refusal — and what only this harness can reach, because no
 * route in the contract issues a Platform Admin session and therefore no
 * browser gets past the gate in any environment.
 */

afterEach(cleanup);

/** The visible text of one element, for assertions about what an operator reads. */
function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent;
}

const openedAt = '2026-08-20T09:00:00.000Z';

function withCase(
  overrides: Partial<AdminApiDoubleState['cases'][number]> = {},
): AdminApiDoubleState {
  return {
    ...privilegedState(),
    cases: [
      {
        assigned: false,
        decisions: [],
        evidence: [
          {
            id: 'evidence-1',
            kind: 'message_excerpt',
            recordedAt: openedAt,
            stateLabel: 'captured',
          },
        ],
        id: 'case-1',
        openedAt,
        policyVersion: '0-unpublished',
        priority: 'high',
        queue: 'consumer_conduct',
        reports: [
          {
            createdAt: openedAt,
            detail: 'They kept messaging after I asked them to stop.',
            id: 'report-1',
            reasonCode: 'harassment',
            sourceSurface: 'consumer_web',
            state: 'received',
            targetType: 'consumer_account',
          },
        ],
        state: 'new',
        targetId: '11111111-1111-4111-8111-111111111111',
        targetType: 'consumer_account',
        version: 3,
        ...overrides,
      },
    ],
  };
}

/* ============================== The door ============================= */

describe('the door', () => {
  it('states both conditions separately and offers no sign-in form', async () => {
    const double = createAdminApiDouble(anonymousState());
    renderConsole(<Access />, double, { pathname: '/access' });

    const blocked = await screen.findByTestId('access-blocked');
    expect(blocked.textContent).toContain('Platform Admin');
    expect(blocked.textContent).toContain('phishing-resistant');
    // A form that always fails is worse than an explanation.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /sign in/iu })).toBeNull();
  });

  it('offers local development sign-in panel in local environment (ADR-0034)', async () => {
    const double = createAdminApiDouble(anonymousState());
    renderConsole(<Access />, double, {
      appEnvironment: 'local',
      pathname: '/access',
    });

    const signin = await screen.findByTestId('local-dev-signin');
    expect(signin.textContent).toContain('Local Development Access');
    expect(screen.getByTestId('local-admin-subject-input')).toBeDefined();
    expect(
      screen.getByRole('button', { name: /sign in as local platform admin/iu }),
    ).toBeDefined();
  });

  it.each(['staging', 'production'] as const)(
    'offers no sign-in at all in %s',
    async (appEnvironment) => {
      const double = createAdminApiDouble(anonymousState());
      renderConsole(<Access />, double, {
        appEnvironment,
        pathname: '/access',
      });

      await screen.findByTestId('access-blocked');
      // The guarantee the browser suite cannot check, because it runs against
      // one environment and this is about the other. A form that always fails
      // is worse than an explanation, and on this surface it would also be a
      // control inviting somebody to try to get in.
      expect(screen.queryByTestId('local-dev-signin')).toBeNull();
      expect(document.querySelectorAll('form')).toHaveLength(0);
      expect(document.querySelectorAll('input')).toHaveLength(0);
    },
  );

  it('says plainly when the browser holds nothing', async () => {
    const double = createAdminApiDouble(anonymousState());
    renderConsole(<Access />, double, { pathname: '/access' });

    expect(
      (await screen.findByTestId('access-no-session')).textContent,
    ).toContain('no session at all');
    expect(screen.queryByTestId('access-sign-out')).toBeNull();
  });

  /**
   * The realistic wrong-audience case: somebody signed in to VELORA and then
   * opened the console.
   */
  it('reports the audience and assurance a consumer session actually carries', async () => {
    const double = createAdminApiDouble(consumerSessionState());
    renderConsole(<Access />, double, { pathname: '/access' });

    expect(
      (await screen.findByTestId('access-audience')).textContent,
    ).toContain('Consumer web');
    expect(textOf('access-assurance')).toContain('Single factor');
    expect(screen.getByTestId('access-sign-out')).toBeDefined();
  });

  it('signs a session out without claiming to sign it out of anywhere else', async () => {
    const double = createAdminApiDouble(consumerSessionState());
    renderConsole(<Access />, double, { pathname: '/access' });

    fireEvent.click(await screen.findByTestId('access-sign-out'));
    await waitFor(() => {
      expect(double.state.session).toBeNull();
    });
    expect(
      double.calls.some((call) => call.path === '/v1/auth/logout-all'),
    ).toBe(false);
  });

  /**
   * The likeliest state on this origin, and the one the console must not
   * misreport: the platform is not configured to admit this origin at all, so
   * the request never arrives.
   */
  it('says it could not ask, rather than claiming there is no session', async () => {
    const double = createAdminApiDouble(consumerSessionState());
    double.failNext('/v1/auth/session');
    renderConsole(<Access />, double, { pathname: '/access' });

    const failure = await screen.findByTestId('access-unreachable');
    expect(failure.textContent).toContain('could not reach the platform');
    expect(screen.queryByTestId('access-no-session')).toBeNull();
    expect(
      within(failure).getByRole('button', { name: 'Try again' }),
    ).toBeDefined();
  });

  it('sends an unprivileged browser to the door, carrying where it was going', async () => {
    const double = createAdminApiDouble(consumerSessionState());
    renderConsole(
      <AdminGate title="Money">
        <Money />
      </AdminGate>,
      double,
      { pathname: '/money' },
    );

    await waitFor(() => {
      expect(navigations()).toContainEqual({
        kind: 'replace',
        path: '/access?next=%2Fmoney',
      });
    });
    // And nothing privileged was read on the way.
    expect(
      double.calls.some((call) => call.path.startsWith('/v1/admin/')),
    ).toBe(false);
  });
});

/* =============================== Queues ============================== */

describe('the queues', () => {
  it('reads the cases the platform holds and names nobody', async () => {
    const double = createAdminApiDouble(withCase());
    const { container } = renderConsole(<Queues />, double, {
      pathname: '/queues',
    });

    expect(await screen.findByTestId('case-case-1')).toBeDefined();
    expect(textOf('case-priority-case-1')).toContain('High');
    // The target is a type and an opaque reference, never a person.
    expect(container.textContent).toContain('Consumer account');
    expect(container.textContent).not.toContain('@');
  });

  it('filters at the server rather than filtering what has arrived', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<Queues />, double, { pathname: '/queues' });
    await screen.findByTestId('case-case-1');

    fireEvent.click(screen.getByTestId('segment-creator_content'));
    await waitFor(() => {
      expect(screen.getByTestId('case-list-empty')).toBeDefined();
    });
    const filtered = double.calls.filter(
      (call) => call.path === '/v1/admin/safety/cases',
    );
    expect(filtered.at(-1)?.query).toMatchObject({
      moderationQueue: 'creator_content',
    });
  });

  it('says nothing is waiting rather than showing an empty table', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<Queues />, double, { pathname: '/queues' });

    expect(
      (await screen.findByTestId('case-list-empty')).textContent,
    ).toContain('Nothing waiting');
  });
});

/* ================================ Case =============================== */

describe('one case', () => {
  it('summarises only bounded case metadata and cannot act on the case', async () => {
    const state = withCase();
    const privateReportDetail = state.cases[0]?.reports[0]?.detail;
    const privateEvidenceReference = state.cases[0]?.evidence[0]?.referenceId;
    const double = createAdminApiDouble(state);
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    fireEvent.click(await screen.findByTestId('case-ai-generate'));
    await screen.findByTestId('case-ai-draft');
    const request = double.calls.find(
      (call) => call.path === '/v1/ai/suggestions',
    );
    const context = (request?.body as { context?: string } | undefined)
      ?.context;
    expect(context).toBeDefined();
    if (privateReportDetail !== undefined) {
      expect(context).not.toContain(privateReportDetail);
    }
    if (privateEvidenceReference !== undefined) {
      expect(context).not.toContain(privateEvidenceReference);
    }
    expect(
      double.calls.some((call) =>
        [
          '/v1/admin/safety/cases/claim',
          '/v1/admin/safety/cases/triage',
          '/v1/admin/safety/cases/decisions',
        ].includes(call.path),
      ),
    ).toBe(false);
  });

  it('shows what was filed, what was recorded, and what was decided', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    expect(await screen.findByTestId('report-report-1')).toBeDefined();
    expect(screen.getByTestId('evidence-evidence-1')).toBeDefined();
    expect(textOf('case-decisions-empty')).toContain('No decisions');
    // A report is somebody's account, kept visually and textually apart.
    expect(screen.getByTestId('case-reports').textContent).toContain(
      'never a finding',
    );
  });

  it('claims a case and reports that somebody now holds it', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    fireEvent.click(await screen.findByTestId('case-claim'));
    await waitFor(() => {
      expect(textOf('case-assignment')).toContain('Claimed');
    });
  });

  it('carries the version and the evidence into a decision', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    fireEvent.click(await screen.findByTestId('case-decide'));
    const dialog = await screen.findByTestId('decision-dialog');
    fireEvent.click(within(dialog).getByTestId('decision-evidence-evidence-1'));
    // The acknowledgement is the sentence being confirmed, and it is required.
    expect(
      within(dialog).getByTestId<HTMLButtonElement>('decision-submit').disabled,
    ).toBe(true);
    fireEvent.change(within(dialog).getByTestId('decision-reason'), {
      target: { value: 'no_violation_found' },
    });
    fireEvent.click(within(dialog).getByTestId('decision-acknowledge'));
    fireEvent.click(within(dialog).getByTestId('decision-submit'));

    await waitFor(() => {
      expect(double.state.cases[0]?.decisions).toHaveLength(1);
    });
    const sent = double.calls.find(
      (call) => call.path === '/v1/admin/safety/cases/decisions',
    );
    expect(sent?.body).toMatchObject({
      caseId: 'case-1',
      evidenceIds: ['evidence-1'],
      expectedVersion: 3,
    });
  });

  /**
   * The predicate that settles two moderators reaching the same case at the
   * same moment: one decision, one refusal, and no second enforcement.
   */
  it('refuses a decision made against a version the platform has replaced', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    fireEvent.click(await screen.findByTestId('case-decide'));
    const dialog = await screen.findByTestId('decision-dialog');
    double.refuseNext(
      '/v1/admin/safety/cases/decisions',
      409,
      'STATE_CONFLICT',
    );
    fireEvent.change(within(dialog).getByTestId('decision-reason'), {
      target: { value: 'harassment' },
    });
    fireEvent.click(within(dialog).getByTestId('decision-acknowledge'));
    fireEvent.click(within(dialog).getByTestId('decision-submit'));

    expect((await screen.findByTestId('decision-error')).textContent).toContain(
      'Nothing was decided',
    );
  });

  /**
   * The trap this form is most likely to spring: an operator changes the action
   * and never touches the reason, and the record keeps a reason that contradicts
   * the enforcement it sits beside.
   */
  it('will not record a decision until a reason is chosen', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    fireEvent.click(await screen.findByTestId('case-decide'));
    const dialog = await screen.findByTestId('decision-dialog');
    expect(
      within(dialog).getByTestId<HTMLSelectElement>('decision-reason').value,
    ).toBe('');

    fireEvent.click(within(dialog).getByTestId('decision-acknowledge'));
    expect(
      within(dialog).getByTestId<HTMLButtonElement>('decision-submit').disabled,
    ).toBe(true);

    fireEvent.change(within(dialog).getByTestId('decision-reason'), {
      target: { value: 'no_violation_found' },
    });
    expect(
      within(dialog).getByTestId<HTMLButtonElement>('decision-submit').disabled,
    ).toBe(false);
  });

  it('asks for a scope only when the action enforces something', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    fireEvent.click(await screen.findByTestId('case-decide'));
    const dialog = await screen.findByTestId('decision-dialog');
    // "No action" enforces nothing, so it asks for nothing.
    expect(within(dialog).queryByTestId('decision-scope')).toBeNull();

    fireEvent.change(within(dialog).getByTestId('decision-action'), {
      target: { value: 'temporary_hold' },
    });
    expect(within(dialog).getByTestId('decision-scope')).toBeDefined();
    expect(within(dialog).getByTestId('decision-expires')).toBeDefined();
  });

  it('offers nothing to decide on a case that is closed', async () => {
    const double = createAdminApiDouble(withCase({ state: 'closed' }));
    renderConsole(<CaseScreen caseId="case-1" />, double, {
      params: { caseId: 'case-1' },
      pathname: '/queues/case-1',
    });

    expect((await screen.findByTestId('case-closed')).textContent).toContain(
      'Nothing further can be decided',
    );
    expect(screen.queryByTestId('case-decide')).toBeNull();
  });

  it('says a case is not here rather than reporting a failure', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<CaseScreen caseId="case-9" />, double, {
      params: { caseId: 'case-9' },
      pathname: '/queues/case-9',
    });

    expect((await screen.findByTestId('case-not-found')).textContent).toContain(
      'not here',
    );
  });
});

/* =============================== Appeals ============================= */

describe('appeals', () => {
  function withAppeal(): AdminApiDoubleState {
    return {
      ...privilegedState(),
      appeals: [
        {
          appellantKind: 'subject',
          decisionId: 'decision-1',
          id: 'appeal-1',
          state: 'received',
          submittedAt: openedAt,
          version: 2,
        },
      ],
    };
  }

  it('names which side of a decision the appellant was on, and nothing else', async () => {
    const double = createAdminApiDouble(withAppeal());
    const { container } = renderConsole(<Appeals />, double, {
      pathname: '/queues/appeals',
    });

    expect(await screen.findByTestId('appeal-appeal-1')).toBeDefined();
    expect(container.textContent).toContain('The subject');
    expect(container.textContent).not.toContain('appellant@');
  });

  it('carries the version into an outcome, behind an acknowledgement', async () => {
    const double = createAdminApiDouble(withAppeal());
    renderConsole(<Appeals />, double, { pathname: '/queues/appeals' });

    fireEvent.click(await screen.findByTestId('appeal-uphold-appeal-1'));
    const dialog = await screen.findByTestId('appeal-confirm');
    fireEvent.click(within(dialog).getByTestId('appeal-acknowledge'));
    fireEvent.click(within(dialog).getByTestId('appeal-confirm-accept'));

    await waitFor(() => {
      expect(double.state.appeals[0]?.state).toBe('upheld');
    });
    expect(
      double.calls.find(
        (call) => call.path === '/v1/admin/safety/appeals/outcome',
      )?.body,
    ).toMatchObject({ appealId: 'appeal-1', expectedVersion: 2 });
  });

  it('will not record an outcome until the operator has acknowledged it', async () => {
    const double = createAdminApiDouble(withAppeal());
    renderConsole(<Appeals />, double, { pathname: '/queues/appeals' });

    fireEvent.click(await screen.findByTestId('appeal-refuse-appeal-1'));
    const dialog = await screen.findByTestId('appeal-confirm');
    fireEvent.click(within(dialog).getByTestId('appeal-confirm-accept'));

    expect(double.state.appeals[0]?.state).toBe('received');
  });
});

/* ============================== Creators ============================= */

describe('the creator directory', () => {
  function withCreator(
    overrides: Partial<AdminApiDoubleState['creators'][number]> = {},
  ): AdminApiDoubleState {
    return {
      ...privilegedState(),
      creators: [
        {
          activatedAt: openedAt,
          createdAt: openedAt,
          handle: 'embervale',
          id: 'creator-1',
          profilePublished: true,
          status: 'active',
          ...overrides,
        },
      ],
    };
  }

  it('searches by handle prefix at the server and says so', async () => {
    const double = createAdminApiDouble(withCreator());
    renderConsole(<Creators selectedId={undefined} />, double, {
      pathname: '/creators',
    });
    await screen.findByTestId('creator-creator-1');

    fireEvent.change(screen.getByTestId('creator-search'), {
      target: { value: 'ember' },
    });
    fireEvent.click(screen.getByTestId('creator-search-submit'));

    await waitFor(() => {
      expect(
        double.calls.filter((call) => call.path === '/v1/admin/creators').at(-1)
          ?.query,
      ).toMatchObject({ adminSearch: 'ember' });
    });
    expect(screen.getByText(/beginning of a public handle/u)).toBeDefined();
  });

  it('shows what the platform publishes about a creator and no more', async () => {
    const double = createAdminApiDouble(withCreator());
    const { container } = renderConsole(
      <Creators selectedId="creator-1" />,
      double,
      { pathname: '/creators', search: 'selected=creator-1' },
    );

    expect(await screen.findByTestId('creator-detail')).toBeDefined();
    expect(textOf('creator-detail-status')).toContain('Active');
    // No consumer account, no email, no catalog, no member.
    for (const forbidden of ['@velora.test', 'email', 'Members', 'Catalog']) {
      expect(container.textContent).not.toContain(forbidden);
    }
  });

  it('suspends behind an acknowledgement and a published reason', async () => {
    const double = createAdminApiDouble(withCreator());
    renderConsole(<Creators selectedId="creator-1" />, double, {
      pathname: '/creators',
      search: 'selected=creator-1',
    });

    fireEvent.click(await screen.findByTestId('creator-suspend'));
    const dialog = await screen.findByTestId('operation-dialog');
    // The exact effect is on the screen at the moment of confirming.
    expect(dialog.textContent).toContain('public page comes down');
    expect(
      within(dialog).getByTestId<HTMLButtonElement>('operation-submit')
        .disabled,
    ).toBe(true);

    fireEvent.change(within(dialog).getByTestId('operation-reason'), {
      target: { value: 'harassment' },
    });
    fireEvent.click(within(dialog).getByTestId('operation-acknowledge'));
    fireEvent.click(within(dialog).getByTestId('operation-submit'));

    await waitFor(() => {
      expect(double.state.creators[0]?.status).toBe('suspended');
    });
    expect(
      double.calls.find((call) => call.path === '/v1/admin/creators/suspension')
        ?.body,
    ).toMatchObject({ creatorId: 'creator-1', reasonCode: 'harassment' });
  });

  it('offers a lift rather than a second suspension once somebody is suspended', async () => {
    const double = createAdminApiDouble(
      withCreator({ status: 'suspended', suspendedAt: openedAt }),
    );
    renderConsole(<Creators selectedId="creator-1" />, double, {
      pathname: '/creators',
      search: 'selected=creator-1',
    });

    expect(await screen.findByTestId('creator-reinstate')).toBeDefined();
    expect(screen.queryByTestId('creator-suspend')).toBeNull();
  });

  it('says a deep link names somebody outside the pages loaded', async () => {
    const double = createAdminApiDouble(withCreator());
    renderConsole(<Creators selectedId="creator-9" />, double, {
      pathname: '/creators',
      search: 'selected=creator-9',
    });

    expect(
      (await screen.findByTestId('creator-not-loaded')).textContent,
    ).toContain('not among the creators loaded');
  });

  it('offers no control that edits a creator’s own work', async () => {
    const double = createAdminApiDouble(withCreator());
    renderConsole(<Creators selectedId="creator-1" />, double, {
      pathname: '/creators',
      search: 'selected=creator-1',
    });

    expect(
      (await screen.findByTestId('creator-operations-note')).textContent,
    ).toContain('only the creator writes');
  });
});

/* ================================ Money ============================== */

describe('money', () => {
  function withMoney(): AdminApiDoubleState {
    const base = privilegedState();
    return {
      ...base,
      financial: {
        ...base.financial,
        payableTotals: [
          { amountMinor: '4000', currency: 'EUR' },
          { amountMinor: '5000', currency: 'JPY' },
        ],
        payments: [{ count: 3, state: 'captured' }],
      },
    };
  }

  it('reports adapter names rather than a boolean', async () => {
    const double = createAdminApiDouble(withMoney());
    renderConsole(<Money />, double, { pathname: '/money' });

    expect(
      (await screen.findByTestId('money-capabilities-paymentProvider'))
        .textContent,
    ).toContain('unavailable');
    expect(textOf('money-capabilities-commercePolicy')).toContain(
      'unpublished',
    );
  });

  it('keeps currencies apart and never adds them together', async () => {
    const double = createAdminApiDouble(withMoney());
    renderConsole(<Money />, double, { pathname: '/money' });

    // A euro shows two decimal places and a yen shows none, from the published
    // minor-unit exponent rather than from a division by a hundred.
    expect(
      (await screen.findByTestId('money-payable-EUR')).textContent,
    ).toContain('40.00 EUR');
    expect(textOf('money-payable-JPY')).toContain('5000 JPY');
    expect(textOf('money-payable-no-total')).toContain('never added together');
  });

  it('carries one idempotency key through a retried refund', async () => {
    const double = createAdminApiDouble(withMoney());
    renderConsole(<Money />, double, { pathname: '/money' });

    fireEvent.click(await screen.findByTestId('money-refund'));
    const dialog = await screen.findByTestId('refund-dialog');
    fireEvent.change(within(dialog).getByTestId('refund-payment'), {
      target: { value: 'payment-1' },
    });
    fireEvent.change(within(dialog).getByTestId('refund-amount'), {
      target: { value: '1050' },
    });
    fireEvent.click(within(dialog).getByTestId('refund-acknowledge'));

    double.failNext('/v1/admin/billing/refunds');
    fireEvent.click(within(dialog).getByTestId('refund-submit'));
    await screen.findByTestId('refund-error');

    fireEvent.click(within(dialog).getByTestId('refund-submit'));
    await waitFor(() => {
      expect(Object.keys(double.state.refunds)).toHaveLength(1);
    });

    const keys = double.calls
      .filter((call) => call.path === '/v1/admin/billing/refunds')
      .map((call) => call.headers['x-velora-idempotency-key']);
    expect(new Set(keys).size).toBe(1);
  });

  it('refuses an amount that is not whole minor units', async () => {
    const double = createAdminApiDouble(withMoney());
    renderConsole(<Money />, double, { pathname: '/money' });

    fireEvent.click(await screen.findByTestId('money-refund'));
    const dialog = await screen.findByTestId('refund-dialog');
    fireEvent.change(within(dialog).getByTestId('refund-amount'), {
      target: { value: '10.50' },
    });

    expect(dialog.textContent).toContain('Whole minor units only');
    expect(
      within(dialog).getByTestId<HTMLButtonElement>('refund-submit').disabled,
    ).toBe(true);
  });
});

/* ============================== Platform ============================= */

describe('platform health', () => {
  function withMedia(): AdminApiDoubleState {
    const base = privilegedState();
    return {
      ...base,
      media: {
        ...base.media,
        backlogs: [
          {
            breached: true,
            count: 4,
            oldestAgeSeconds: 7200,
            state: 'purge_owed',
            thresholdSeconds: 3600,
          },
          {
            breached: false,
            count: 0,
            state: 'inspection_owed',
            thresholdSeconds: 900,
          },
        ],
      },
    };
  }

  it('separates a stuck backlog from a busy one, using the domain’s own threshold', async () => {
    const double = createAdminApiDouble(withMedia());
    renderConsole(<PlatformMedia />, double, { pathname: '/platform' });

    const late = await screen.findByTestId('media-backlogs-purge_owed');
    expect(late.textContent).toContain('2h');
    expect(late.textContent).toContain('Late');
    expect(textOf('media-backlogs-breached')).toContain('1 class late');
  });

  /**
   * A class with nothing in it has no oldest member. Reporting an age of zero
   * would read as "one item, brand new", which is the opposite situation.
   */
  it('says a class with nothing in it has no oldest item', async () => {
    const double = createAdminApiDouble(withMedia());
    renderConsole(<PlatformMedia />, double, { pathname: '/platform' });

    const healthy = await screen.findByTestId('media-backlogs-inspection_owed');
    expect(healthy.textContent).toContain('—');
    expect(healthy.textContent).not.toContain('0s');
  });

  it('says the environment accepts no media rather than looking idle', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<PlatformMedia />, double, { pathname: '/platform' });

    expect(
      (await screen.findByTestId('media-availability')).textContent,
    ).toContain('accepts no media');
  });

  it('offers no media lookup, and says why', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<PlatformMedia />, double, { pathname: '/platform' });

    expect(
      (await screen.findByTestId('media-no-lookup')).textContent,
    ).toContain('where a search over everybody');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('reports notification delivery without naming a recipient', async () => {
    const double = createAdminApiDouble(privilegedState());
    const { container } = renderConsole(<PlatformNotifications />, double, {
      pathname: '/platform/notifications',
    });

    expect(
      (await screen.findByTestId('notifications-adapters-deliveryChannel'))
        .textContent,
    ).toContain('unavailable');
    expect(container.textContent).not.toContain('@');
  });

  it('says calling carries nothing while the lifecycle is still real', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<PlatformRtc />, double, { pathname: '/platform/rtc' });

    expect(
      (await screen.findByTestId('rtc-availability')).textContent,
    ).toContain('carries no call audio');
    expect(textOf('rtc-undischarged-count')).toContain('0');
  });

  it('offers no identity lookup, search, export, or override', async () => {
    const double = createAdminApiDouble(privilegedState());
    renderConsole(<PlatformIdentity />, double, {
      pathname: '/platform/identity',
    });

    const note = await screen.findByTestId('identity-no-lookup');
    expect(note.textContent).toContain('no identity search');
    expect(note.textContent).toContain('override');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

/* ============================== Refusals ============================= */

describe('what a refusal looks like', () => {
  it('tells an operator that privileged access was refused, without saying which condition failed', async () => {
    const double = createAdminApiDouble(privilegedState());
    double.refuseNext('/v1/admin/billing/state', 403, 'ACTION_NOT_PERMITTED');
    renderConsole(<Money />, double, { pathname: '/money' });

    const failure = await screen.findByTestId('money-failed');
    expect(failure.textContent).toContain('Privileged access was refused');
    expect(failure.textContent).toContain('phishing-resistant');
    // A refusal is a decision. Repeating it changes nothing, so nothing offers.
    expect(
      within(failure).queryByRole('button', { name: 'Try again' }),
    ).toBeNull();
  });

  it('offers a retry when the platform could not be reached at all', async () => {
    const double = createAdminApiDouble(privilegedState());
    double.failNext('/v1/admin/media/state');
    renderConsole(<PlatformMedia />, double, { pathname: '/platform' });

    const failure = await screen.findByTestId('media-failed');
    expect(failure.textContent).toContain('could not be reached');
    expect(
      within(failure).getByRole('button', { name: 'Try again' }),
    ).toBeDefined();
  });
});
