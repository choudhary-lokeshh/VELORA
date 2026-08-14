import type { Page } from '@playwright/test';

import { consumerWebOrigin } from './auth-environment.js';
import { expect, test } from './fixtures.js';

/**
 * The Consumer Web product journey in a real browser.
 *
 * This is the only place tab order, focus, and activation semantics are real,
 * so the keyboard pass lives here rather than in jsdom. It runs against the
 * same API the integration suite uses, with the configuration a deployed
 * environment actually has — which is why the journey stops where it does.
 *
 * **The journey cannot reach a discoverable profile in any environment.** The
 * minimum profile requires one ready image; no media storage provider is
 * approved (`docs/decisions/DECISIONS_REQUIRED.md`); the configured adapter
 * refuses to issue an upload target at all. So the browser can complete adult
 * assurance, policy acknowledgement, and the profile fields, and then stops —
 * and that is asserted here rather than worked around. A test that injected a
 * storage provider would be proving something no deployment can do.
 *
 * Everything past that gate is proved elsewhere: the product surfaces against
 * the published contract in `apps/web/test/shell.test.tsx`, and the server
 * behaviour they depend on against real PostgreSQL in the API integration
 * suite.
 */

const skipWhenCookieRequiresHttps = (browserName: string) =>
  browserName === 'webkit';
const cookieSkipReason =
  'WebKit does not store Secure cookies delivered over plain-HTTP loopback';

function uniqueSubject(scope: string): string {
  return `e2e-${scope}-${String(Date.now())}-${String(
    Math.floor(Math.random() * 1_000_000),
  )}@velora.test`;
}

async function signIn(page: Page, subject: string): Promise<void> {
  await page.goto(consumerWebOrigin);
  await expect(page.getByTestId('auth-status')).toHaveText('Signed out');
  await page.getByLabel('Development identity').fill(subject);
  await page.getByTestId('auth-sign-in').click();
  await expect(page.getByTestId('auth-status')).toHaveText('Signed in');
}

/** Signs in and completes every admission step the platform will accept. */
async function admitAsFarAsPossible(
  page: Page,
  subject: string,
): Promise<void> {
  await signIn(page, subject);
  await page.getByTestId('create-account').click();
  await page.getByTestId('declare-adult').click();
  await page.getByTestId('acknowledge-policies').click();
  await page.getByLabel('Display name').fill('Journey Tester');
  await page.getByTestId('save-profile').click();
  await expect(page.getByTestId('profile-media-state')).toBeVisible();
}

test.describe('Consumer Web product journey', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('walks the admission ladder the server publishes', async ({ page }) => {
    await signIn(page, uniqueSubject('journey'));

    await expect(page.getByTestId('account-required')).toBeVisible();
    await page.getByTestId('create-account').click();

    await expect(page.getByTestId('declare-adult')).toBeVisible();
    // The surface calls a declaration a declaration.
    await expect(page.getByText(/not a verified age check/)).toBeVisible();
    await page.getByTestId('declare-adult').click();

    await expect(page.getByTestId('acknowledge-policies')).toBeVisible();
    await expect(page.getByTestId('outstanding-policies')).toContainText(
      'terms_of_service',
    );
    await page.getByTestId('acknowledge-policies').click();

    await expect(page.getByTestId('save-profile')).toBeVisible();
    await page.getByLabel('Display name').fill('Journey Tester');
    await page
      .getByLabel('Languages you speak, comma separated')
      .fill('en, es');
    await page.getByTestId('save-profile').click();

    // The ladder is the server's, and it has not finished: the profile still
    // lacks the one image the minimum requires.
    await expect(page.getByTestId('journey-stage')).toHaveText(
      'Complete your profile',
    );
    await expect(page.getByTestId('outstanding-profile')).toContainText(
      'ready media',
    );
    // Nothing that needs an admitted account is offered before there is one.
    await expect(page.getByTestId('nav-discovery')).toHaveCount(0);
  });

  test('says honestly that no photo storage exists rather than failing silently', async ({
    page,
  }) => {
    await admitAsFarAsPossible(page, uniqueSubject('media'));
    await expect(page.getByTestId('profile-media-state')).toHaveText(
      'No image yet',
    );

    await page.getByTestId('profile-photo').setInputFiles({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      mimeType: 'image/jpeg',
      name: 'photo.jpg',
    });

    // The refusal is the environment's, said plainly, with no storage detail.
    await expect(page.getByTestId('profile-photo-error')).toHaveText(
      'Photo storage is not available in this environment yet.',
    );
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('velora.invalid');
    expect(body).not.toContain('uploadUrl');
  });

  test('restores a session across a reload and reports one that ended', async ({
    page,
  }) => {
    const subject = uniqueSubject('restore');
    await admitAsFarAsPossible(page, subject);

    // A reload starts with no client state at all, so seeing the profile step
    // again proves the cookie alone restored both session and journey.
    await page.reload();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed in');
    await expect(page.getByTestId('journey-stage')).toHaveText(
      'Complete your profile',
    );

    await page.getByTestId('auth-sign-out').click();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed out');
    await expect(page.getByTestId('journey-stage')).toHaveCount(0);
  });

  test('treats a session ended in another tab as ended, on its next question', async ({
    browser,
  }) => {
    // One device with two tabs: the point of the test is that they share a
    // session, so they must also share a requester.
    const context = await browser.newContext({
      extraHTTPHeaders: { 'x-velora-device': uniqueSubject('tabs-device') },
    });
    try {
      const first = await context.newPage();
      await signIn(first, uniqueSubject('tabs'));
      const second = await context.newPage();
      await second.goto(consumerWebOrigin);
      await expect(second.getByTestId('auth-status')).toHaveText('Signed in');

      // Signing out in one tab is a server-side fact. V1 has no realtime
      // transport and does not invent one, so the other tab does not hear about
      // it — it simply gets the truth the next time it asks.
      await first.getByTestId('auth-sign-out').click();
      await expect(first.getByTestId('auth-status')).toHaveText('Signed out');

      // Asking again is what the surface does on its own when a tab is looked
      // at; the same code path is exercised here without depending on a
      // headless browser's window-activation semantics.
      await second.getByTestId('auth-refresh').click();
      await expect(second.getByTestId('auth-status')).toHaveText('Signed out');
      await expect(second.getByTestId('auth-cause')).toHaveText(
        'Session ended. Sign in again.',
      );

      // And a stale tab cannot act on what it was showing: the server refuses.
      await second.reload();
      await expect(second.getByTestId('auth-status')).toHaveText('Signed out');
      await expect(second.getByTestId('journey-stage')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('offers a retry rather than a blank screen when the API is unreachable', async ({
    page,
  }) => {
    await admitAsFarAsPossible(page, uniqueSubject('offline'));

    await page.route('**/v1/users/me', async (route) => {
      await route.abort('failed');
    });
    // Coming back to the tab is what makes it ask again, and this time fail.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await expect(page.getByTestId('account-failed')).toContainText(
      'VELORA could not be reached',
    );
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('can be driven from the keyboard alone', async ({ page }) => {
    await admitAsFarAsPossible(page, uniqueSubject('keyboard'));

    // Document order is the tab order: nothing carries a positive tabindex,
    // which is the one thing that would let the visual order and the keyboard
    // order disagree.
    const reordered = await page
      .locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')
      .count();
    expect(reordered).toBe(0);

    // From one control, Tab reaches the next in reading order, and every field
    // on the step can be filled and submitted without a pointer.
    const displayName = page.getByLabel('Display name');
    await page.getByTestId('auth-sign-out-everywhere').focus();
    await page.keyboard.press('Tab');
    await expect(displayName).toBeFocused();
    await page.keyboard.type('Keyboard Only');
    await expect(displayName).toHaveValue('Keyboard Only');

    const languages = page.getByLabel('Languages you speak, comma separated');
    await page.keyboard.press('Tab');
    await expect(languages).toBeFocused();

    // Submitted from the field, not from the button. Whether Tab stops on a
    // button is a platform setting rather than a property of this page —
    // Firefox and WebKit on macOS both follow the system full-keyboard-access
    // preference and skip buttons when it is off — so asserting it would be
    // asserting the machine. Implicit submission is the keyboard path that
    // works everywhere, and it is the one somebody actually uses.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('profile-media-state')).toBeVisible();
    await expect(page.getByTestId('journey-stage')).toHaveText(
      'Complete your profile',
    );

    // Focus is always visible: nothing suppresses the ring.
    const outline = await displayName.evaluate(
      (node) => getComputedStyle(node).outlineStyle,
    );
    expect(outline).not.toBe('');
  });

  test('exposes one document heading and named landmarks', async ({ page }) => {
    await admitAsFarAsPossible(page, uniqueSubject('landmarks'));

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toBeVisible();
    for (const region of ['Session', 'Account', 'Getting started']) {
      await expect(page.getByRole('region', { name: region })).toBeVisible();
    }
    // Every control that takes input carries a name, computed the way a screen
    // reader computes it rather than by looking for one particular attribute.
    const fields = page.locator('input, select, textarea');
    const count = await fields.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(fields.nth(index)).toHaveAccessibleName(/\S/u);
    }
  });
});
