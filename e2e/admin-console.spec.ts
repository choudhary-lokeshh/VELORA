import type { Page } from '@playwright/test';

import { platformAdminOrigin } from './auth-environment.js';
import {
  activateCreator,
  claimHandle,
  cookieSkipReason,
  createClub,
  declareAdult,
  publishPage,
  skipWhenCookieRequiresHttps,
  uniqueHandle,
  uniqueSubject,
} from './creator.js';
import { expect, test } from './fixtures.js';
import { overflowingElements, viewportWidths } from './viewport.js';

/**
 * The operations console itself, in a real browser, for the first time.
 *
 * Until ADR-0034 no route in the contract could issue a Platform Admin session,
 * so no browser reached any screen behind the gate and the whole console was
 * proved only against a `fetch`-level contract double. The freeze report says
 * so and calls it a weaker guarantee than the other two surfaces have. This
 * suite is what closes that: the deterministic `local-test-privileged` adapter
 * is composed in this stack exactly as the local-test payment, media, RTC, and
 * notification adapters already are, and configuration refuses every one of
 * them in staging and production at schema parse time.
 *
 * What is asserted here is what only a browser can answer. That every
 * destination is a real address a person can type, bookmark, reload, and leave
 * with Back. That a record opened from a list returns to that list rather than
 * to the top of the section. That the honest empty states are the ones that
 * actually render when the platform has nothing to show. That nothing on any
 * screen publishes a person. And that the whole console fits every width and
 * survives text at twice its size.
 *
 * The refusal a deployed browser meets is proved separately in `admin.spec.ts`,
 * which runs against the same stack and still passes: this adapter changes what
 * a local browser can reach and changes nothing about what a deployed one can.
 */

const destinations = [
  { heading: 'Overview', path: '/overview', tab: 'overview' },
  { heading: 'Queues', path: '/queues', tab: 'queues' },
  { heading: 'Creators', path: '/creators', tab: 'creators' },
  { heading: 'Accounts', path: '/accounts', tab: 'accounts' },
  { heading: 'Money', path: '/money', tab: 'money' },
  { heading: 'Platform', path: '/platform', tab: 'platform' },
] as const;

const areas = [
  '/queues/appeals',
  '/queues/decisions',
  '/creators/clubs',
  '/money/payments',
  '/money/payouts',
  '/money/disputes',
  '/platform/notifications',
  '/platform/rtc',
  '/platform/identity',
  '/platform/security',
] as const;

/**
 * Signs in with the development adapter and lands on the overview.
 *
 * The panel is the only thing on this surface that takes any input, and it
 * takes an identity subject rather than a credential — which is asserted in
 * `admin.spec.ts` and is the reason this helper can be this short.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${platformAdminOrigin}/access`);
  await expect(page.getByTestId('local-dev-signin')).toBeVisible();
  await page.getByTestId('local-admin-submit').click();
  await page.waitForURL(/\/overview/u, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
}

test.describe('the operations console', () => {
  test.beforeEach(({ browserName }) => {
    // The console session is an `HttpOnly`, `Secure`, `__Host-` cookie issued
    // by the API. WebKit will not store one over plain-HTTP loopback, so it
    // cannot get past the door here — the same reason every other product
    // suite skips it, and not a property of this console.
    test.skip(skipWhenCookieRequiresHttps(browserName), cookieSkipReason);
  });

  test('lands an operator on what needs a person', async ({ page }) => {
    await signIn(page);

    // Every figure on this screen is a total the platform computed over a whole
    // table, which is the reason the route exists. The console adds nothing.
    const attention = page.getByTestId('overview-attention');
    await expect(attention).toBeVisible();
    for (const tile of [
      'overview-cases-unclaimed',
      'overview-appeals-awaiting',
      'overview-disputes-open',
      'overview-payouts-awaiting',
      'overview-accounts-restricted',
    ]) {
      // A zero is published rather than omitted: "nothing is waiting" and "the
      // signal stopped arriving" are different answers.
      await expect(page.getByTestId(tile)).toBeVisible();
      await expect(page.getByTestId(`${tile}-count`)).toHaveText(/^\d+$/u);
    }
  });

  test('serves every destination as its own address', async ({ page }) => {
    await signIn(page);

    for (const destination of destinations) {
      await page.goto(`${platformAdminOrigin}${destination.path}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        destination.heading,
      );
      // One document heading and one named main landmark on every one of them.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
    }
  });

  test('serves every area of every destination', async ({ page }) => {
    await signIn(page);

    for (const area of areas) {
      await page.goto(`${platformAdminOrigin}${area}`);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      // An area is a peer, not a child: nothing offers a way "back" from one
      // to the first of its siblings, because that is a sideways move.
      await expect(page.getByTestId('topbar-back')).toHaveCount(0);
    }
  });

  test('keeps an operator where they were when the page is reloaded', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`${platformAdminOrigin}/money/payments`);
    await expect(page.getByTestId('payment-list')).toBeVisible();

    await page.reload();

    // The session is an HttpOnly cookie the script cannot read, so a reload is
    // the case that proves the console is not holding it in memory.
    await expect(page).toHaveURL(/\/money\/payments$/u);
    await expect(page.getByTestId('payment-list')).toBeVisible();
  });

  /**
   * A record made on one surface and read on another, end to end.
   *
   * The club is created by a creator in Studio, through the same controls a
   * person uses, and then found in the console — which is the only way to prove
   * that what an operator reads is the platform's own record rather than a
   * shape a test arranged. It is also the case that closes a real dead end:
   * before this screen the console could revoke a club membership and asked an
   * operator to paste an identifier it could not show them.
   */
  test('finds a club a creator has just made, and leaves it the way it came', async ({
    browserName,
    page,
  }) => {
    test.skip(skipWhenCookieRequiresHttps(browserName), cookieSkipReason);
    const subject = uniqueSubject('admin-console');
    const handle = uniqueHandle('adminconsole');
    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);
    await publishPage(page);
    await createClub(page, 'Operator Visible', 'operator-visible');

    await signIn(page);
    await page.goto(`${platformAdminOrigin}/creators/clubs`);
    const row = page.locator('a[href^="/creators/clubs/"]').first();
    await expect(row).toBeVisible();
    const href = await row.getAttribute('href');

    // A fresh navigation rather than a click, because a record reached only by
    // clicking is a record nobody can send to a colleague.
    await page.goto(`${platformAdminOrigin}${href ?? ''}`);
    await expect(page.getByTestId('club-record')).toBeVisible();
    await expect(page.getByTestId('club-memberships')).toBeVisible();

    const back = page.getByTestId('topbar-back');
    // The area it was found in, not the destination root: that is where the
    // operator's filter and position still are.
    await expect(back).toHaveAttribute('href', '/creators/clubs');
    await back.click();
    await page.waitForURL(/\/creators\/clubs$/u);
  });

  test('says a record that is not there is not there', async ({ page }) => {
    await signIn(page);

    await page.goto(
      `${platformAdminOrigin}/money/payments/00000000-0000-4000-8000-000000000000`,
    );

    // Not a skeleton that never resolves: "there is no such record" and "still
    // loading" are different answers and an operator has to be able to tell.
    await expect(page.getByTestId('payment-not-found')).toBeVisible();
    await expect(page.getByTestId('payment-loading')).toHaveCount(0);
  });

  test('says an empty queue is empty and why', async ({ page }) => {
    await signIn(page);

    await page.goto(`${platformAdminOrigin}/money/payouts`);

    // No payout provider is approved and no settlement terms are published, so
    // no creator can have asked for one. The screen says that rather than
    // showing a blank panel that reads as a fault.
    await expect(page.getByTestId('payout-list-empty')).toContainText(
      'No payout provider is approved',
    );
  });

  test('offers no operation the platform does not publish', async ({
    page,
  }) => {
    await signIn(page);

    await page.goto(`${platformAdminOrigin}/money/payouts`);
    await expect(page.getByTestId('payouts-no-actions')).toBeVisible();
    for (const forbidden of ['Release', 'Retry payout', 'Cancel payout']) {
      await expect(page.getByRole('button', { name: forbidden })).toHaveCount(
        0,
      );
    }

    await page.goto(`${platformAdminOrigin}/accounts`);
    await expect(page.getByTestId('accounts-no-actions')).toBeVisible();
    for (const forbidden of ['Restrict', 'Reinstate', 'Delete account']) {
      await expect(page.getByRole('button', { name: forbidden })).toHaveCount(
        0,
      );
    }
  });

  test('publishes no person on any screen', async ({ page }) => {
    await signIn(page);

    for (const address of [
      '/accounts',
      '/money/payments',
      '/money/payouts',
      '/creators/clubs',
      '/platform/security',
    ]) {
      await page.goto(`${platformAdminOrigin}${address}`);
      await expect(page.getByRole('main')).toBeVisible();
      const body = await page.locator('main').innerText();
      // Column headings a console would use if it had decided to publish
      // somebody. Their absence is the design rather than an omission.
      for (const forbidden of [
        'Email',
        'Phone',
        'Full name',
        'Payer',
        'Recipient',
        'Bank',
        'IBAN',
        'Held by',
      ]) {
        expect(body, `${address} must not carry "${forbidden}"`).not.toContain(
          forbidden,
        );
      }
    }
  });

  test('can be moved through from the keyboard alone', async ({ page }) => {
    await signIn(page);

    const accounts = page.getByTestId('nav-accounts');
    await accounts.focus();
    await expect(accounts).toBeFocused();
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/accounts$/u, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Accounts',
    );
  });

  test('marks where an operator is in the navigation', async ({ page }) => {
    await signIn(page);

    for (const destination of destinations) {
      await page.goto(`${platformAdminOrigin}${destination.path}`);
      // Both navigations are rendered and the stylesheet shows one, so the
      // current mark has to be right on both.
      await expect(page.getByTestId(`nav-${destination.tab}`)).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByTestId(`tab-${destination.tab}`)).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  test('fits every screen at every width', async ({ browserName, page }) => {
    // One engine for the matrix. What it asserts is a property of the
    // stylesheet rather than of an engine.
    test.skip(
      browserName !== 'chromium',
      'the width matrix asserts the stylesheet, and runs once',
    );

    await signIn(page);
    for (const width of viewportWidths) {
      await page.setViewportSize({ height: width < 768 ? 740 : 900, width });
      for (const destination of destinations) {
        await page.goto(`${platformAdminOrigin}${destination.path}`);
        await expect(page.getByRole('main')).toBeVisible();
        expect(
          await overflowingElements(page),
          `${destination.path} at ${String(width)}px`,
        ).toEqual([]);
      }
    }
  });

  test('survives a console zoomed to twice its text size', async ({
    browserName,
    page,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'text scaling asserts the stylesheet, and runs once',
    );

    await signIn(page);
    await page.setViewportSize({ height: 740, width: 390 });
    for (const address of ['/overview', '/money/payments', '/accounts']) {
      await page.goto(`${platformAdminOrigin}${address}`);
      await expect(page.getByRole('main')).toBeVisible();
      // Text scaling rather than page zoom: it is the case that breaks fixed
      // heights, and it is what somebody with low vision actually turns on.
      await page.addStyleTag({ content: 'html { font-size: 200% }' });
      expect(await overflowingElements(page), address).toEqual([]);
    }
  });
});
