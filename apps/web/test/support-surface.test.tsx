import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Support } from '../src/product/support';
import { admittedState, createApiDouble } from './support/api-double';
import { renderProduct } from './support/render';

/**
 * Getting help, on Consumer Web.
 *
 * The complaint this surface exists for is that there is no way to reach
 * anybody, so what is asserted here is not that a form renders. It is the three
 * things that make a support path something a person can rely on:
 *
 * - submitting hands back a reference they can quote;
 * - what they sent stays visible with the status the server holds;
 * - a refusal says so rather than pretending the message went.
 *
 * And one thing that is not here: no response-time promise appears anywhere,
 * because VELORA has nobody on a rota.
 */

afterEach(cleanup);

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function click(testId: string): void {
  fireEvent.click(screen.getByTestId(testId));
}

async function fillAndSend(): Promise<void> {
  await screen.findByTestId('support-form-card');
  type('support-subject', 'Cannot sign in on my phone');
  type(
    'support-description',
    'The screen just spins after I put my email in and nothing happens.',
  );
  click('support-submit');
}

describe('somebody can reach a person', () => {
  it('hands back a reference to quote', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Support />, double, { pathname: '/you/help' });

    await fillAndSend();

    const reference = await screen.findByTestId('support-reference');
    expect(reference.textContent).toMatch(/^VS-/u);
    expect(double.state.supportTickets).toHaveLength(1);
    expect(double.state.supportTickets[0]?.subject).toBe(
      'Cannot sign in on my phone',
    );
  });

  it('shows what was sent, with the status the server holds', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Support />, double, { pathname: '/you/help' });
    await fillAndSend();
    await screen.findByTestId('support-reference');

    const list = await screen.findByTestId('support-ticket-list');
    expect(list.textContent).toContain('Cannot sign in on my phone');
    // The plain word for "nobody has looked yet". Anything warmer while nobody
    // is looking is the lie that makes every later status untrustworthy.
    expect(list.textContent).toContain('Received');
  });

  it('promises no response time anywhere on the screen', async () => {
    const double = createApiDouble(admittedState());
    const { container } = renderProduct(<Support />, double, {
      pathname: '/you/help',
    });
    await screen.findByTestId('support-form-card');

    const words = container.textContent;
    for (const promise of [
      'within 24',
      'within 48',
      '24 hours',
      '48 hours',
      'business day',
      'as soon as possible',
    ]) {
      expect(words.toLowerCase(), promise).not.toContain(promise);
    }
  });

  it('points somebody being harassed at reporting instead', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Support />, double, { pathname: '/you/help' });

    const hint = await screen.findByTestId('support-safety-hint');
    // Reporting reaches moderation, carries evidence, and can block in the same
    // act. A ticket about it is the slowest possible route to safety.
    expect(hint.textContent).toContain('report');
  });

  it('says a refusal happened rather than pretending it sent', async () => {
    const state = admittedState();
    state.supportBoundReached = true;
    const double = createApiDouble(state);
    renderProduct(<Support />, double, { pathname: '/you/help' });

    await fillAndSend();

    await waitFor(() => {
      expect(screen.getByTestId('support-error')).toBeTruthy();
    });
    expect(screen.queryByTestId('support-reference')).toBeNull();
    expect(double.state.supportTickets).toHaveLength(0);
  });

  it('does not open a second ticket when the same submission is retried', async () => {
    const double = createApiDouble(admittedState());
    renderProduct(<Support />, double, { pathname: '/you/help' });
    await fillAndSend();
    await screen.findByTestId('support-reference');

    // Writing again is a different submission and gets its own identifier, but
    // the double is keyed the way the server is: the same key is one ticket.
    click('support-write-another');
    await fillAndSend();
    await screen.findByTestId('support-reference');

    expect(double.state.supportTickets).toHaveLength(2);
    const identifiers = new Set(
      double.state.supportTickets.map((ticket) => ticket.clientTicketId),
    );
    expect(identifiers.size).toBe(2);
  });
});
