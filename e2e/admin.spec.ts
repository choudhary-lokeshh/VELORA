import { platformAdminOrigin } from './auth-environment.js';
import { expect, test } from './fixtures.js';
import { overflowingElements, viewportWidths } from './viewport.js';

/**
 * Platform Admin, at the only addresses a browser can reach.
 *
 * No route in the contract issues a Platform Admin session:
 * `/v1/auth/local/web-sessions` admits the consumer and Creator Studio
 * audiences and nothing else, and the one privileged verifier the platform
 * composes refuses every assertion because no phishing-resistant implementation
 * is approved. A browser therefore cannot get past the gate in any environment,
 * and pretending otherwise in a test would mean weakening the platform to prove
 * a screen.
 *
 * So this suite asserts what is actually true and what actually matters: that
 * the console refuses, that it refuses honestly, that it refuses without
 * reading anything privileged first, and that the page saying so is a finished
 * page at every width and on a keyboard. The screens behind the gate are proved
 * against the contract in the unit suite, which is the only place they can be.
 */

const reachable = ['/access', '/nowhere'] as const;

test.describe('Platform Admin', () => {
  test('sends every console address to the access page, carrying where it was going', async ({
    page,
  }) => {
    for (const [address, expected] of [
      ['/', /\/access/u],
      ['/money', /\/access\?next=%2Fmoney/u],
      ['/queues', /\/access\?next=%2Fqueues/u],
      ['/platform/identity', /\/access\?next=%2Fplatform%2Fidentity/u],
    ] as const) {
      await page.goto(`${platformAdminOrigin}${address}`);
      await page.waitForURL(expected, { timeout: 30_000 });
      await expect(page.getByTestId('access-blocked')).toBeVisible();
    }
  });

  /**
   * The two conditions are stated separately because they fail for different
   * reasons, and an operator whose audience is wrong has a different problem
   * from one whose assurance is stale.
   */
  test('says why privileged access is refused, in the operator’s terms', async ({
    page,
  }) => {
    await page.goto(`${platformAdminOrigin}/access`);
    const blocked = page.getByTestId('access-blocked');
    await expect(blocked).toContainText('audience must be');
    await expect(blocked).toContainText('phishing-resistant');
    await expect(blocked).toContainText('no route can issue one');

    // The browser holds nothing, and the console says exactly that rather than
    // reporting a failure — the origin is admitted, so the question was asked
    // and answered.
    await expect(page.getByTestId('access-no-session')).toBeVisible();
    await expect(page.getByTestId('access-unreachable')).toHaveCount(0);
  });

  /**
   * A form that always fails is worse than an explanation, and on this surface
   * it would also be a control inviting somebody to try to get in.
   */
  test('offers no way to sign in, and nothing to type', async ({ page }) => {
    await page.goto(`${platformAdminOrigin}/access`);
    await expect(page.getByTestId('access-blocked')).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);
    const body = await page.locator('body').innerText();
    for (const forbidden of ['Sign in', 'Password', 'Continue with']) {
      expect(body).not.toContain(forbidden);
    }
  });

  /**
   * The gate decides what is worth rendering and nothing else, so it must not
   * read anything privileged on the way to deciding.
   */
  test('reads nothing privileged before it refuses', async ({ page }) => {
    const privileged: string[] = [];
    await page.route('**/v1/admin/**', async (route) => {
      privileged.push(route.request().url());
      await route.continue();
    });

    await page.goto(`${platformAdminOrigin}/money`);
    await page.waitForURL(/\/access/u, { timeout: 30_000 });
    await expect(page.getByTestId('access-blocked')).toBeVisible();
    expect(privileged).toEqual([]);
  });

  test('carries no consumer or creator product, and nothing that acts', async ({
    page,
  }) => {
    await page.goto(`${platformAdminOrigin}/access`);
    await expect(page.getByTestId('access-blocked')).toBeVisible();
    const body = await page.locator('body').innerText();
    // Naming the audiences the authentication contract admits is the honest
    // explanation of the refusal, so "Creator Studio" appearing as a word is
    // correct. What must not appear is any capability from another surface, or
    // any control that acts on somebody.
    for (const forbidden of [
      'Discover',
      'Introductions',
      'Conversations',
      'Suspend',
      'Refund',
      'Decision',
      'Queue',
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  test('says an unknown address is unknown and offers the way back', async ({
    page,
  }) => {
    await page.goto(`${platformAdminOrigin}/nowhere`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'That page is not here',
    );
    await expect(
      page.getByRole('link', { name: 'Back to the console' }),
    ).toBeVisible();
  });

  test('exposes one document heading and a named main landmark', async ({
    page,
  }) => {
    await page.goto(`${platformAdminOrigin}/access`);
    await expect(page.getByTestId('access-blocked')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    // No navigation, because there is nowhere to navigate to.
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('can be driven from the keyboard alone', async ({ page }) => {
    await page.goto(`${platformAdminOrigin}/nowhere`);
    const back = page.getByRole('link', { name: 'Back to the console' });
    await back.focus();
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/access/u, { timeout: 30_000 });
  });

  test('fits every screen at every width', async ({ browserName, page }) => {
    // One engine for the matrix. What it asserts is a property of the
    // stylesheet rather than of an engine.
    test.skip(
      browserName !== 'chromium',
      'the width matrix asserts the stylesheet, and runs once',
    );

    for (const width of viewportWidths) {
      await page.setViewportSize({ height: width < 768 ? 740 : 900, width });
      for (const route of reachable) {
        await page.goto(`${platformAdminOrigin}${route}`);
        await expect(page.getByRole('main')).toBeVisible();
        expect(
          await overflowingElements(page),
          `${route} at ${String(width)}px`,
        ).toEqual([]);
      }
    }
  });

  test('survives a page zoomed to twice its text size', async ({ page }) => {
    await page.setViewportSize({ height: 740, width: 390 });
    await page.goto(`${platformAdminOrigin}/access`);
    await expect(page.getByTestId('access-blocked')).toBeVisible();
    // Text scaling rather than page zoom: it is the case that breaks fixed
    // heights, and it is what somebody with low vision actually turns on.
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    expect(await overflowingElements(page)).toEqual([]);
  });
});
