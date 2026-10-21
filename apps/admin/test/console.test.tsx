import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NotFound from '../app/not-found';
import { AdminGate, Bootstrap } from '../src/app/gate';
import { ConfirmDialog } from '../src/design/dialog';
import { Reference } from '../src/design/primitives';
import { Access } from '../src/product/access';
import { Appeals } from '../src/product/appeals';
import { CaseScreen } from '../src/product/case';
import { Creators } from '../src/product/creators';
import { formatDateTime } from '../src/product/format';
import { Disputes, Money } from '../src/product/money';
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
  type AdminApiDouble,
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

/**
 * The same double, with one path that can be told to wait.
 *
 * Nothing waits until `hold` is called, so a screen's first read arrives as it
 * always does; after it, every request to the path waits for `release`. That is
 * what lets a test look at the screen while an answer is still on its way.
 */
function holdable(
  double: AdminApiDouble,
  path: string,
): {
  readonly double: AdminApiDouble;
  readonly hold: () => void;
  readonly release: () => void;
} {
  let held: Promise<void> | undefined;
  let release: () => void = () => undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(input instanceof URL ? input.href : input, init);
    if (new URL(request.url).pathname === path && held !== undefined) {
      await held;
    }
    return double.fetch(request);
  };
  return {
    double: { ...double, fetch },
    hold: () => {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => {
      held = undefined;
      release();
    },
  };
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

  it('says a refused local sign-in once, as the platform said it', async () => {
    const double = createAdminApiDouble(anonymousState());
    renderConsole(<Access />, double, {
      appEnvironment: 'local',
      pathname: '/access',
    });

    fireEvent.change(await screen.findByTestId('local-admin-subject-input'), {
      target: { value: 'admin@velora.test' },
    });
    fireEvent.click(screen.getByTestId('local-admin-submit'));

    // The refusal is the platform's answer to the request rather than a fault
    // in what was typed, so it is said once, as an alert, and not again under
    // the field as though the subject were malformed.
    const error = await screen.findByTestId('local-admin-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(screen.getAllByText(error.textContent)).toHaveLength(1);
    expect(
      screen
        .getByTestId('local-admin-subject-input')
        .getAttribute('aria-invalid'),
    ).toBeNull();
  });

  it('says what it is doing while it waits, inside the announcement', () => {
    render(<Bootstrap />);

    expect(screen.getByRole('status').textContent).toContain(
      'Loading Platform Admin',
    );
  });

  it('offers the way back as the console’s own primary control', () => {
    render(<NotFound />);

    const back = screen.getByRole('link', { name: 'Back to the console' });
    expect(back.className).toContain('a-btn--primary');
    // The button's own ink, which a global link hover would otherwise repaint
    // in the signal colour on the signal colour.
    expect(back.getAttribute('style')).toContain('var(--text-on-accent)');
  });

  it.each(['staging', 'production'] as const)(
    'offers only the federated door in %s, and collects nothing',
    async (appEnvironment) => {
      const double = createAdminApiDouble(anonymousState());
      renderConsole(<Access />, double, {
        appEnvironment,
        pathname: '/access',
      });

      await screen.findByTestId('access-blocked');
      // The guarantee the browser suite cannot check, because it runs against
      // one environment and this is about the other. The development adapter
      // is absent, and what stands in its place asks for nothing: the console
      // never sees a credential, because the provider collects it and the
      // platform believes only what that provider signed.
      expect(screen.queryByTestId('local-dev-signin')).toBeNull();
      expect(screen.getByTestId('federated-signin')).toBeDefined();
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

  it('offers the queue filter as one pressed choice in a named group', async () => {
    const double = createAdminApiDouble(withCase());
    renderConsole(<Queues />, double, { pathname: '/queues' });
    await screen.findByTestId('case-case-1');

    // Each choice re-reads the same list rather than revealing a panel of its
    // own, so it is a pressed button in a group and not a tab.
    const group = screen.getByRole('group', { name: 'Filter by queue' });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(
      within(group).getByTestId('segment-all').getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(within(group).getByTestId('segment-creator_content'));
    expect(
      within(group)
        .getByTestId('segment-creator_content')
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(group).getByTestId('segment-all').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('never shows one queue’s cases under another while it reads', async () => {
    const gate = holdable(
      createAdminApiDouble(withCase()),
      '/v1/admin/safety/cases',
    );
    renderConsole(<Queues />, gate.double, { pathname: '/queues' });
    await screen.findByTestId('case-case-1');

    gate.hold();
    fireEvent.click(screen.getByTestId('segment-creator_content'));

    // The case belongs to consumer conduct. While the creator-content read is
    // on its way the list says it is loading, rather than showing that case
    // under a filter it is not in.
    await waitFor(() => {
      expect(screen.queryByTestId('case-case-1')).toBeNull();
    });
    expect(
      within(screen.getByTestId('case-list')).getByRole('status').textContent,
    ).toBe('Loading');

    gate.release();
    expect(await screen.findByTestId('case-list-empty')).toBeDefined();
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
    const accept = within(dialog).getByTestId<HTMLButtonElement>(
      'appeal-confirm-accept',
    );
    // Unavailable rather than silently ignored: a control that looks pressable
    // and does nothing is one an operator presses again.
    expect(accept.disabled).toBe(true);
    fireEvent.click(accept);

    expect(double.state.appeals[0]?.state).toBe('received');
    fireEvent.click(within(dialog).getByTestId('appeal-acknowledge'));
    expect(accept.disabled).toBe(false);
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

  it('will not apply an operation until a reason is chosen', async () => {
    const double = createAdminApiDouble(withCreator());
    renderConsole(<Creators selectedId="creator-1" />, double, {
      pathname: '/creators',
      search: 'selected=creator-1',
    });

    fireEvent.click(await screen.findByTestId('creator-suspend'));
    const dialog = await screen.findByTestId('operation-dialog');
    const submit =
      within(dialog).getByTestId<HTMLButtonElement>('operation-submit');
    fireEvent.click(within(dialog).getByTestId('operation-acknowledge'));

    // No reason is preselected: one the operator never chose would still be
    // recorded against this suspension as theirs.
    expect(
      within(dialog).getByTestId<HTMLSelectElement>('operation-reason').value,
    ).toBe('');
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByTestId('operation-reason'), {
      target: { value: 'spam_or_scam' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('keeps the rows it has and says when a re-read failed', async () => {
    const double = createAdminApiDouble(withCreator());
    renderConsole(<Creators selectedId="creator-1" />, double, {
      pathname: '/creators',
      search: 'selected=creator-1',
    });

    fireEvent.click(await screen.findByTestId('creator-suspend'));
    const dialog = await screen.findByTestId('operation-dialog');
    fireEvent.change(within(dialog).getByTestId('operation-reason'), {
      target: { value: 'harassment' },
    });
    fireEvent.click(within(dialog).getByTestId('operation-acknowledge'));
    // The suspension lands; the re-read after it does not.
    double.failNext('/v1/admin/creators');
    fireEvent.click(within(dialog).getByTestId('operation-submit'));

    expect(
      (await screen.findByTestId('creator-list-stale')).textContent,
    ).toContain('could not be reached');
    // The rows already read stay where the operator is working, and the detail
    // beside them with them.
    expect(screen.getByTestId('creator-creator-1')).toBeDefined();
    expect(screen.getByTestId('creator-detail')).toBeDefined();
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
    const gate = holdable(
      createAdminApiDouble(withCreator()),
      '/v1/admin/creators',
    );
    gate.hold();
    renderConsole(<Creators selectedId="creator-9" />, gate.double, {
      pathname: '/creators',
      search: 'selected=creator-9',
    });

    // Not before the directory has answered: until then nothing is known to be
    // outside it.
    expect(await screen.findByTestId('creator-detail-loading')).toBeDefined();
    expect(screen.queryByTestId('creator-not-loaded')).toBeNull();

    gate.release();
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

  /** One live claim and one that is over, as a provider event would leave them. */
  function withDisputes(): AdminApiDoubleState {
    return {
      ...withMoney(),
      disputeQueue: [
        {
          amount: { amountMinor: '1500', currency: 'USD' },
          createdAt: '2026-08-20T12:00:00.000Z',
          evidenceDueAt: '2026-09-01T12:00:00.000Z',
          id: 'dispute-1',
          openedAt: '2026-08-20T11:00:00.000Z',
          paymentId: '11111111-1111-4111-8111-111111111111',
          providerReference: 'lt_dispute_open',
          reasonCode: 'product_not_received',
          state: 'opened',
        },
        {
          amount: { amountMinor: '900', currency: 'USD' },
          createdAt: '2026-08-01T12:00:00.000Z',
          id: 'dispute-2',
          openedAt: '2026-08-01T11:00:00.000Z',
          paymentId: '22222222-2222-4222-8222-222222222222',
          providerReference: 'lt_dispute_done',
          reasonCode: 'duplicate',
          resolvedAt: '2026-08-10T12:00:00.000Z',
          state: 'won',
        },
      ],
    };
  }

  it('shows the claims an operator has to answer, and no way to answer them', async () => {
    const double = createAdminApiDouble(withDisputes());
    renderConsole(<Disputes />, double, { pathname: '/money/disputes' });

    // Live claims only, until somebody asks for the history.
    await screen.findByTestId('dispute-dispute-1');
    expect(screen.queryByTestId('dispute-dispute-2')).toBeNull();
    // The provider's own reference, because an operator who cannot name the
    // case cannot answer it.
    expect(textOf('dispute-dispute-1')).toContain('lt_dispute_open');
    expect(textOf('dispute-dispute-1')).toContain('15.00 USD');
    expect(textOf('dispute-dispute-1')).toContain('did not receive it');
    // No evidence submission anywhere, and the reason said plainly.
    expect(textOf('dispute-evidence-blocked')).toContain(
      'cannot submit evidence',
    );

    fireEvent.click(screen.getByTestId('dispute-queue-scope'));
    await screen.findByTestId('dispute-dispute-2');
  });

  it('says a deadline is unpublished rather than inventing one', async () => {
    const double = createAdminApiDouble(withDisputes());
    renderConsole(<Disputes />, double, { pathname: '/money/disputes' });

    // The scope control only exists once the first read has settled.
    await screen.findByTestId('dispute-dispute-1');
    fireEvent.click(screen.getByTestId('dispute-queue-scope'));
    // A provider that publishes no deadline gets none recorded, and a date
    // VELORA invented is a date an operator would plan around.
    expect(
      (await screen.findByTestId('dispute-dispute-2')).textContent,
    ).toContain('Not published');
  });

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

  /** Everything a refund asks for, filled in the order an operator would. */
  function fillRefund(dialog: HTMLElement): void {
    fireEvent.change(within(dialog).getByTestId('refund-payment'), {
      target: { value: 'payment-1' },
    });
    fireEvent.change(within(dialog).getByTestId('refund-amount'), {
      target: { value: '1050' },
    });
    fireEvent.change(within(dialog).getByTestId('refund-reason'), {
      target: { value: 'operator_correction' },
    });
    fireEvent.click(within(dialog).getByTestId('refund-acknowledge'));
  }

  function refundKeys(double: AdminApiDouble): (string | undefined)[] {
    return double.calls
      .filter((call) => call.path === '/v1/admin/billing/refunds')
      .map((call) => call.headers['x-velora-idempotency-key']);
  }

  it('carries one idempotency key through a retried refund', async () => {
    const double = createAdminApiDouble(withMoney());
    renderConsole(<Money />, double, { pathname: '/money' });

    fireEvent.click(await screen.findByTestId('money-refund'));
    const dialog = await screen.findByTestId('refund-dialog');
    fillRefund(dialog);

    double.failNext('/v1/admin/billing/refunds');
    fireEvent.click(within(dialog).getByTestId('refund-submit'));
    await screen.findByTestId('refund-error');

    fireEvent.click(within(dialog).getByTestId('refund-submit'));
    await waitFor(() => {
      expect(Object.keys(double.state.refunds)).toHaveLength(1);
    });

    expect(new Set(refundKeys(double)).size).toBe(1);
  });

  it('keeps the key across closing the dialog, and renews it only after a confirmed refund', async () => {
    const double = createAdminApiDouble(withMoney());
    renderConsole(<Money />, double, { pathname: '/money' });

    // The first attempt never gets an answer, and the operator closes the
    // dialog on it.
    fireEvent.click(await screen.findByTestId('money-refund'));
    const first = await screen.findByTestId('refund-dialog');
    fillRefund(first);
    double.failNext('/v1/admin/billing/refunds');
    fireEvent.click(within(first).getByTestId('refund-submit'));
    await within(first).findByTestId('refund-error');
    fireEvent.click(within(first).getByTestId('dialog-close'));
    expect(screen.queryByTestId('refund-dialog')).toBeNull();

    // Opening it again is the same attempt, so it carries the same key — had
    // the first one reached BILLING, this one is answered with that refund
    // rather than becoming a second.
    fireEvent.click(screen.getByTestId('money-refund'));
    const second = await screen.findByTestId('refund-dialog');
    fillRefund(second);
    fireEvent.click(within(second).getByTestId('refund-submit'));
    await waitFor(() => {
      expect(screen.queryByTestId('refund-dialog')).toBeNull();
    });

    // A refund BILLING confirmed is finished, and the next one is a new
    // instruction with a key of its own.
    fireEvent.click(screen.getByTestId('money-refund'));
    const third = await screen.findByTestId('refund-dialog');
    fillRefund(third);
    fireEvent.click(within(third).getByTestId('refund-submit'));
    await waitFor(() => {
      expect(Object.keys(double.state.refunds)).toHaveLength(2);
    });

    const [failed, retried, next] = refundKeys(double);
    expect(failed).toBeDefined();
    expect(retried).toBe(failed);
    expect(next).not.toBe(retried);
  });

  it('will not refund until a reason is chosen', async () => {
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

    const submit =
      within(dialog).getByTestId<HTMLButtonElement>('refund-submit');
    expect(
      within(dialog).getByTestId<HTMLSelectElement>('refund-reason').value,
    ).toBe('');
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByTestId('refund-reason'), {
      target: { value: 'operator_correction' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('cannot be dismissed while the refund is on its way', async () => {
    const gate = holdable(
      createAdminApiDouble(withMoney()),
      '/v1/admin/billing/refunds',
    );
    renderConsole(<Money />, gate.double, { pathname: '/money' });

    fireEvent.click(await screen.findByTestId('money-refund'));
    const dialog = await screen.findByTestId('refund-dialog');
    fillRefund(dialog);
    gate.hold();
    fireEvent.click(within(dialog).getByTestId('refund-submit'));

    // Escape, the scrim, and the close control all wait for the answer, because
    // an operator who closed the dialog now would never hear it.
    const close = within(dialog).getByTestId<HTMLButtonElement>('dialog-close');
    await waitFor(() => {
      expect(close.disabled).toBe(true);
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    const scrim = document.querySelector('.a-scrim');
    expect(scrim).not.toBeNull();
    if (scrim !== null) fireEvent.click(scrim);
    fireEvent.click(close);
    expect(screen.getByTestId('refund-dialog')).toBe(dialog);

    gate.release();
    await waitFor(() => {
      expect(screen.queryByTestId('refund-dialog')).toBeNull();
    });
    expect(Object.keys(gate.double.state.refunds)).toHaveLength(1);
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

/* ============================= Primitives ============================ */

describe('the shared primitives', () => {
  it('holds a confirmation open while the operation it confirms is busy', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        busy
        confirmLabel="Pause it"
        onCancel={onCancel}
        onConfirm={() => undefined}
        testId="busy-confirm"
        title="Pause live.search"
      >
        <p>This changes what the platform does for everybody.</p>
      </ConfirmDialog>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    const scrim = document.querySelector('.a-scrim');
    if (scrim !== null) fireEvent.click(scrim);
    expect(screen.getByTestId<HTMLButtonElement>('dialog-close').disabled).toBe(
      true,
    );
    expect(onCancel).not.toHaveBeenCalled();

    // Once the answer is in, every way out works again.
    rerender(
      <ConfirmDialog
        confirmLabel="Pause it"
        onCancel={onCancel}
        onConfirm={() => undefined}
        testId="busy-confirm"
        title="Pause live.search"
      >
        <p>This changes what the platform does for everybody.</p>
      </ConfirmDialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('says it copied, keeps its name, and becomes a copy control again', async () => {
    const writeText = vi.fn(async () => {
      await Promise.resolve();
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.useFakeTimers();
    try {
      render(<Reference testId="reference" value="lt_payment_1234" />);
      const control = screen.getByTestId('reference-copy');

      fireEvent.click(control);
      await act(async () => {
        await Promise.resolve();
      });
      expect(writeText).toHaveBeenCalledWith('lt_payment_1234');
      expect(screen.getByTestId('reference-copied').textContent).toBe('Copied');
      expect(screen.getByTestId('reference-copied').getAttribute('role')).toBe(
        'status',
      );
      // The control still says what pressing it does.
      expect(control.getAttribute('aria-label')).toBe('Copy lt_payment_1234');

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId('reference-copied').textContent).toBe('');
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('names the zone on every instant it prints', () => {
    const value = '2026-08-20T09:00:00.000Z';
    const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date(value))
      .find((part) => part.type === 'timeZoneName')?.value;

    expect(zone).toBeDefined();
    expect(formatDateTime(value)).toContain(zone ?? 'no zone');
  });
});
