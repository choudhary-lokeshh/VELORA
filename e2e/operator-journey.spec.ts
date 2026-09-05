import type { Browser, Page } from '@playwright/test';

import { platformAdminOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  signIn as consumerSignIn,
  skipWhenCookieRequiresHttps,
  uniqueSubject,
} from './consumer.js';
import { expect, test } from './fixtures.js';

/**
 * The operator command centre, walked the way an operator walks it.
 *
 * Every journey starts from an address a person can type and asserts what only
 * a browser can answer: that the screen exists, renders the platform's own
 * values, states its own freshness, names the effect of a command exactly, and
 * refuses to send one without a reason.
 *
 * **This suite deliberately changes nothing shared.** It runs beside the live,
 * growth, and safety journeys on two workers, and a browser test that paused
 * matchmaking or ended somebody's sessions for two seconds would fail one of
 * those for a reason that has nothing to do with either — a flake that looks
 * exactly like a product defect. Every mutation an operator can make is proved
 * against real PostgreSQL in `apps/api/test/integration/operations.test.ts`,
 * where the suite owns the database and pausing the platform costs nobody
 * anything: the capability refusals, the compare-and-set on a control, the
 * server actually obeying a paused control, the append-only audit that records
 * refusals as well as changes, and a consumer losing their authority on the
 * very next request after an operator ends their sessions.
 */

/**
 * Puts one ordinary consumer account into the platform, in its own browser.
 *
 * Its own context rather than the operator's page, and not only for realism.
 * Signing a consumer in and then navigating the same page to the console is a
 * cross-origin navigation on top of one Next.js has not finished, and Firefox
 * aborts it with `NS_BINDING_ABORTED` — a failure that says nothing about the
 * product and everything about driving two surfaces through one tab. An
 * operator and a consumer are two people on two machines; the test now says so.
 */
async function aConsumerExists(browser: Browser, scope: string): Promise<void> {
  const context = await browser.newContext();
  try {
    await consumerSignIn(await context.newPage(), uniqueSubject(scope));
  } finally {
    await context.close();
  }
}

async function signInOperator(page: Page): Promise<void> {
  await page.goto(`${platformAdminOrigin}/access`);
  await expect(page.getByTestId('local-dev-signin')).toBeVisible();
  await page.getByTestId('local-admin-submit').click();
  await page.waitForURL(/\/overview/u, { timeout: 30_000 });
}

/**
 * Opens the newest consumer account the console can reach.
 *
 * The accounts list defaults to accounts the platform has itself decided are
 * not in good standing, which on a freshly seeded run can legitimately be
 * empty. Choosing `active` widens it to accounts an operator can otherwise only
 * reach by holding an identifier — which is exactly what a journey that has
 * just created one is doing.
 */
async function openAnAccount(page: Page): Promise<string> {
  await page.goto(`${platformAdminOrigin}/accounts`);
  await page.getByTestId('segment-active').click();
  const opener = page.locator('a[href^="/accounts/"]').first();
  await expect(opener).toBeVisible();
  const href = await opener.getAttribute('href');
  return (href ?? '').replace('/accounts/', '');
}

test.describe('an operator working the console', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(skipWhenCookieRequiresHttps(browserName), cookieSkipReason);
  });

  test('is told which environment they are operating, on every screen', async ({
    page,
  }) => {
    await signInOperator(page);
    // Stated permanently rather than on a settings page. An operator with three
    // tabs open is one wrong tab away from pausing production, and no
    // confirmation dialog fixes that — a dialog says what will happen, not
    // where.
    await expect(page.getByTestId('environment')).toContainText('test');
    await page.goto(`${platformAdminOrigin}/platform/controls`);
    await expect(page.getByTestId('environment')).toContainText('test');
  });

  test('finds an account by pasting its identifier and opens its record', async ({
    browser,
    page,
  }) => {
    await aConsumerExists(browser, 'operator-search');

    await signInOperator(page);
    const accountId = await openAnAccount(page);

    await page.goto(`${platformAdminOrigin}/overview`);
    await page.getByTestId('subject-search-term').fill(accountId);
    await page.getByTestId('subject-search-submit').click();

    const match = page.getByTestId('subject-match-account');
    await expect(match).toBeVisible();
    await match.click();
    await page.waitForURL(new RegExp(`/accounts/${accountId}$`, 'u'));
    await expect(page.getByTestId('account-identity')).toBeVisible();
  });

  test('reads one account without reading anything the person wrote', async ({
    browser,
    page,
  }) => {
    await aConsumerExists(browser, 'operator-record');

    await signInOperator(page);
    await openAnAccount(page);
    // Followed rather than typed, because a record reached only by typing its
    // address is a record nobody finds from the list they were working.
    const opener = page.locator('a[href^="/accounts/"]').first();
    await opener.click();
    await page.waitForURL(/\/accounts\/[0-9a-f-]+$/u);

    await expect(page.getByTestId('account-safety')).toBeVisible();
    await expect(page.getByTestId('account-sessions')).toBeVisible();
    const body = await page.locator('main').innerText();
    // Column headings a console would use if it had decided to publish
    // somebody. Their absence is the design rather than an omission.
    for (const forbidden of ['Email', 'Phone', 'Full name', 'Push token']) {
      expect(
        body,
        `an account record must not carry "${forbidden}"`,
      ).not.toContain(forbidden);
    }

    // The area it was found in, not the destination root.
    const back = page.getByTestId('topbar-back');
    await expect(back).toHaveAttribute('href', '/accounts');
  });

  /**
   * The control plane, without mutating a control.
   *
   * Flipping `live.search` here would be the strongest possible assertion and
   * the wrong test to write. This suite runs beside `live-journey.spec.ts` and
   * `consumer-safety-support.spec.ts` on two workers, and a browser test that
   * paused matchmaking for two seconds would fail one of those for a reason
   * that has nothing to do with either — a flake that looks exactly like a
   * product defect.
   *
   * So the browser proves the seam it is uniquely able to prove: that the
   * console renders the platform's own control values, states the propagation
   * bound rather than calling a change instant, and refuses to send a change
   * without a reason. **That a control write is a compare-and-set, that the
   * server obeys the value, that pausing admits nobody new while leaving every
   * running encounter alone, and that every press writes an audit row including
   * the refused ones are proved in `apps/api/test/integration/operations.test.ts`
   * against a database that suite owns** — where pausing the platform costs
   * nobody anything.
   */
  test('shows the controls the server obeys, and will not change one without a reason', async ({
    page,
  }) => {
    await signInOperator(page);
    await page.goto(`${platformAdminOrigin}/platform/controls`);

    const control = page.getByTestId('control-live.search');
    await expect(control).toBeVisible();
    await expect(control).toContainText('Encounters already running continue');
    // Published rather than described as instant. An operator pausing something
    // during an incident has to know whether to wait or press again.
    await expect(page.getByTestId('controls-propagation')).toContainText(
      'seconds',
    );

    await page.getByTestId('control-live.search-toggle').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('written to the operator audit');

    // Confirmed with no reason: refused by the form, and nothing is sent.
    await page.getByTestId('control-confirm-accept').click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('at least eight characters');

    await page.getByTestId('control-confirm-cancel').click();
    await expect(dialog).toHaveCount(0);
    // Still on, because nothing was sent.
    await expect(control).toContainText('On');
  });

  /**
   * The command that ends somebody's sessions, offered but not fired.
   *
   * Revoking here would end the sessions of whichever account this run happened
   * to open, and on a seeded local stack that account is shared with every other
   * journey running beside this one. The integration suite revokes against its
   * own database and asserts the thing that actually matters — that the consumer
   * loses their authority on the very next request — which is a stronger claim
   * than a browser can make anyway.
   *
   * What the browser owns is that the command exists, is reachable, names its
   * effect exactly, and asks for a reason before it will do anything.
   */
  test('offers to sign an account out everywhere, and asks why first', async ({
    browser,
    page,
  }) => {
    await aConsumerExists(browser, 'operator-revoke');

    await signInOperator(page);
    const accountId = await openAnAccount(page);
    await page.goto(`${platformAdminOrigin}/accounts/${accountId}`);

    await page.getByTestId('account-revoke-sessions').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      'signed-in device for this account ends',
    );
    await page.getByTestId('account-revoke-confirm-accept').click();
    // Refused by the form until a reason is typed, so nothing is sent.
    await expect(dialog).toContainText('at least eight characters');
    await page.getByTestId('account-revoke-confirm-cancel').click();
    await expect(dialog).toHaveCount(0);
  });

  test('shows what the platform has been doing, and links each row somewhere', async ({
    browser,
    page,
  }) => {
    await aConsumerExists(browser, 'operator-activity');

    await signInOperator(page);
    await page.goto(`${platformAdminOrigin}/activity`);
    const timeline = page.getByTestId('activity-timeline');
    await expect(timeline).toBeVisible();
    // Unfiltered, the newest fifty facts on a stack this busy are all AUTH
    // events — which is the stream working rather than failing, and is exactly
    // why the filter exists. Narrowing to accounts asks USERS instead, and the
    // account this journey created a moment ago is the newest row there.
    await page.getByTestId('activity-domain').selectOption('users');
    await expect(timeline).toContainText('Account created');
    // The row leads somewhere. A stream of facts an operator cannot open is a
    // log with better typography.
    await expect(
      timeline.locator('a[href^="/accounts/"]').first(),
    ).toBeVisible();
  });

  test('reports what is stuck and what is merely switched off', async ({
    page,
  }) => {
    await signInOperator(page);
    await page.goto(`${platformAdminOrigin}/platform/operations`);

    await expect(page.getByTestId('dependency-database')).toContainText(
      'Healthy',
    );
    // Unconfigured, not unavailable. Most of VELORA's provider seams are off on
    // purpose, and an operations screen that called those failures would be
    // unreadable on the day one genuinely fails.
    await expect(page.getByTestId('dependency-payment-provider')).toBeVisible();
    await expect(page.getByTestId('operations-outboxes')).toBeVisible();
  });

  test('says whether anything is indexable, and which condition is missing', async ({
    page,
  }) => {
    await signInOperator(page);
    await page.goto(`${platformAdminOrigin}/platform/public-entry`);

    await expect(page.getByTestId('public-entry-not-indexable')).toContainText(
      'test environment',
    );
    await expect(page.getByTestId('public-entry-creators-count')).toHaveText(
      /^\d+$/u,
    );
  });

  test('publishes what each operator role can do', async ({ page }) => {
    await signInOperator(page);
    await page.goto(`${platformAdminOrigin}/platform/operators`);

    const catalogue = page.getByTestId('operators-catalogue');
    await expect(catalogue).toBeVisible();
    // An operator granting a role should be able to read what they are handing
    // over without opening a document.
    await expect(catalogue).toContainText('readonly');
    await expect(catalogue).toContainText('operators.manage');
  });
});
