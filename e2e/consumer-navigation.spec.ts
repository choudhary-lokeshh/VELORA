import { cohortFor, consumerWebOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  navigateTo,
  signInAdmitted,
  skipWhenCookieRequiresHttps,
} from './consumer.js';
import { expect, test } from './fixtures.js';

/**
 * Leaving a page, in a real browser.
 *
 * A Back is only worth anything if the address it points at is a page. That is
 * exactly what a unit test cannot tell you: `parentOf` returning `/people` is a
 * perfectly good string, and it took a browser to see that following it landed
 * on "There is nothing at this address". So every assertion here follows the
 * control and then checks what actually rendered, rather than checking where a
 * link claimed it would go.
 *
 * The direct-entry cases matter as much as the walked ones. A nested address is
 * reachable from a notification, a shared link, a bookmark, and a second tab,
 * and in none of those is there anything behind the page to go back to.
 */

const notFoundHeading = 'There is nothing at this address';

test.describe('Consumer Web navigation', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('leaves a person for the feed they were opened from', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort needs a person');

    await signInAdmitted(page, person.subject);

    const candidate = page.locator('[data-testid^="candidate-open-"]').first();
    await expect(candidate).toBeVisible();
    await candidate.click();
    await page.waitForURL(/\/people\/[^/?]+/u);

    const back = page.getByTestId('topbar-back');
    await expect(back).toBeVisible();
    await back.click();

    // The defect was a Back that resolved to `/people`, which is not a route:
    // the click succeeded and the not-found page rendered. Both halves are
    // asserted, because either alone would have passed before the fix.
    await page.waitForURL(/\/discover(\?|$)/u);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Discover',
    );
    await expect(page.getByText(notFoundHeading)).toHaveCount(0);
  });

  test('leaves a creator page for the section of Discover it was opened from', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort needs a person');

    // Driven at the address rather than through the directory, because this
    // cohort seeds people and no creators — the creator journey publishes its
    // own. The address is what carries the behaviour under test, and the bar is
    // rendered before the creator is loaded, so a handle nobody published still
    // exercises it. That is worth having on its own: a page about a creator who
    // is gone is exactly where somebody must not be stranded.
    await signInAdmitted(page, person.subject);
    await page.goto(
      `${consumerWebOrigin}/c/nobody-published-this?from=%2Fdiscover%3Fshow%3Dcreators`,
    );

    const back = page.getByTestId('topbar-back');
    await expect(back).toBeVisible();
    await back.click();

    // Back to Creators rather than to People: the section is in the address,
    // and returning to the bare parent would silently change what is on screen.
    await page.waitForURL(/\/discover\?show=creators/u);
    // The section, not the listing: this cohort publishes no creator, so the
    // Creators section is legitimately empty and shows its empty state.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Discover',
    );
    await expect(page.getByTestId('segment-creators')).toBeVisible();
  });

  test('offers a public visitor no way "back" into a product they did not come from', async ({
    page,
  }) => {
    // The creator page is public and sits outside the shell. Somebody who
    // followed a creator's own link has no VELORA page behind them, so there is
    // nothing to return to and the bar carries the wordmark alone.
    await page.goto(`${consumerWebOrigin}/c/nobody-published-this`);
    await expect(page.getByTestId('topbar-back')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'VELORA' })).toBeVisible();
  });

  test('leaves a conversation for the message list', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person] = cohort.people;
    if (person === undefined) throw new Error('the cohort needs a person');

    await signInAdmitted(page, person.subject);
    await navigateTo(page, 'messages');
    await page.getByTestId(`conversation-${cohort.conversationId}`).click();
    await expect(page.getByTestId('conversation-view')).toBeVisible();

    await page.getByTestId('topbar-back').click();
    await page.waitForURL(/\/messages$/u);
    await expect(page.getByText(notFoundHeading)).toHaveCount(0);
  });

  test('leaves a settings page for You', async ({ page }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort needs a person');

    await signInAdmitted(page, person.subject);
    await page.goto(`${consumerWebOrigin}/you/settings`);

    const back = page.getByTestId('topbar-back');
    await expect(back).toBeVisible();
    await back.click();
    await page.waitForURL(/\/you$/u);
    await expect(page.getByText(notFoundHeading)).toHaveCount(0);
  });

  test('leaves a page that was opened directly, with nothing behind it', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort needs a person');

    // Signed in, then sent straight to a nested address the way a notification
    // or a shared link would. There is no feed behind this page to pop back to.
    await signInAdmitted(page, person.subject);
    const candidate = page.locator('[data-testid^="candidate-open-"]').first();
    await expect(candidate).toBeVisible();
    const href = await candidate.getAttribute('href');
    const personPath = (href ?? '').split('?')[0] ?? '';
    expect(personPath).toMatch(/^\/people\//u);

    await page.goto(`${consumerWebOrigin}${personPath}`);
    const back = page.getByTestId('topbar-back');
    await expect(back).toBeVisible();
    await back.click();

    await page.waitForURL(/\/discover(\?|$)/u);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Discover',
    );
  });

  test('offers no way back from a destination somebody arrives at', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort needs a person');

    await signInAdmitted(page, person.subject);
    for (const destination of [
      'discover',
      'introductions',
      'messages',
      'notifications',
      'you',
    ] as const) {
      await navigateTo(page, destination);
      await expect(page.getByTestId('topbar-back')).toHaveCount(0);
    }
  });

  test('keeps the way back visible on a desktop window, not only on a phone', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort needs a person');

    // The bar used to be hidden outright above 768px, so a nested page had no
    // visible way out at any desktop width — the one place the sidebar offers
    // no help, because it lists destinations rather than ancestors.
    await page.setViewportSize({ height: 900, width: 1440 });
    await signInAdmitted(page, person.subject);
    await page.goto(`${consumerWebOrigin}/you/settings`);

    await expect(page.getByTestId('topbar-back')).toBeVisible();
    await page.getByTestId('topbar-back').click();
    await page.waitForURL(/\/you$/u);
  });
});
