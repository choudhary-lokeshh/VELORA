import { creatorStudioOrigin } from './auth-environment.js';
import {
  activateCreator,
  claimHandle,
  cookieSkipReason,
  createClub,
  declareAdult,
  skipWhenCookieRequiresHttps,
  uniqueHandle,
  uniqueSubject,
} from './creator.js';
import { expect, test } from './fixtures.js';

/**
 * Leaving a page in the workspace, in a real browser.
 *
 * Studio's Back was already correct and this proves it stays correct now that
 * the parents are declared rather than derived from the shape of the address.
 * The assertions follow the control and check what rendered, because the defect
 * this pass exists for — a Back pointing at an address nothing serves — looks
 * exactly like a working link until somebody follows it.
 */

test.describe('Creator Studio navigation', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  test.describe.configure({ mode: 'serial' });

  test('leaves each page a creator opens for the listing it came from', async ({
    page,
  }, testInfo) => {
    const subject = uniqueSubject(`nav-${testInfo.project.name}`);
    const handle = uniqueHandle(`nav-${testInfo.project.name}`);

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    // Home is a destination, so there is nothing above it to offer.
    await page.goto(`${creatorStudioOrigin}/home`);
    await expect(page.getByTestId('topbar-back')).toHaveCount(0);

    // Catalog -> the draft editor -> Catalog.
    await page.goto(`${creatorStudioOrigin}/catalog/new`);
    const fromCatalog = page.getByTestId('topbar-back');
    await expect(fromCatalog).toBeVisible();
    await fromCatalog.click();
    await page.waitForURL(/\/catalog$/u);

    // Clubs -> one club -> Clubs.
    await createClub(page, 'Back Test', `back-${testInfo.project.name}`);
    const fromClub = page.getByTestId('topbar-back');
    await expect(fromClub).toBeVisible();
    await fromClub.click();
    await page.waitForURL(/\/clubs$/u);

    // Profile -> the public preview -> Profile.
    await page.goto(`${creatorStudioOrigin}/profile/preview`);
    const fromPreview = page.getByTestId('topbar-back');
    await expect(fromPreview).toBeVisible();
    await fromPreview.click();
    await page.waitForURL(/\/profile$/u);

    // Money -> payouts -> Money.
    await page.goto(`${creatorStudioOrigin}/money/payouts`);
    const fromPayouts = page.getByTestId('topbar-back');
    await expect(fromPayouts).toBeVisible();
    await fromPayouts.click();
    await page.waitForURL(/\/money$/u);
  });

  test('offers no way back from a destination a creator arrives at', async ({
    page,
  }, testInfo) => {
    const subject = uniqueSubject(`roots-${testInfo.project.name}`);
    await declareAdult(page, subject);
    await activateCreator(page, subject);

    for (const destination of [
      '/home',
      '/profile',
      '/catalog',
      '/clubs',
      '/money',
      '/account',
    ]) {
      await page.goto(`${creatorStudioOrigin}${destination}`);
      await expect(page.getByTestId('topbar-back')).toHaveCount(0);
    }
  });

  /**
   * A Back that says where it goes.
   *
   * From the tablet up this bar carries nothing else, so the arrow alone was
   * the whole of what a creator had to read before leaving a page.
   */
  test('names the destination a Back leads to', async ({ page }, testInfo) => {
    const subject = uniqueSubject(`named-${testInfo.project.name}`);
    const handle = uniqueHandle(`nm-${testInfo.project.name}`);
    await declareAdult(page, subject);
    await page.setViewportSize({ height: 900, width: 1280 });
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    await page.goto(`${creatorStudioOrigin}/catalog/new`);
    const back = page.getByTestId('topbar-back');
    await expect(back).toHaveAttribute('aria-label', 'Back to Catalog');
    await expect(back).toContainText('Catalog');

    await page.goto(`${creatorStudioOrigin}/money/payouts`);
    await expect(page.getByTestId('topbar-back')).toHaveAttribute(
      'aria-label',
      'Back to Money',
    );
  });

  /**
   * A page says its name once.
   *
   * A phone keeps the bar and the heading sits directly beneath it, so eight of
   * eleven screens printed the same word twice a few pixels apart. The name now
   * moves into the bar exactly as the heading leaves the screen.
   */
  test('says a page name once, and says it in the bar only once the heading has gone', async ({
    page,
  }, testInfo) => {
    const subject = uniqueSubject(`title-${testInfo.project.name}`);
    const handle = uniqueHandle(`ti-${testInfo.project.name}`);
    await declareAdult(page, subject);
    await page.setViewportSize({ height: 740, width: 390 });
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    await page.goto(`${creatorStudioOrigin}/profile`);
    const bar = page.locator('.s-topbar__title');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The heading is on screen, so the bar is not repeating it.
    await expect(bar).toHaveAttribute('data-shown', 'false');

    // `page.mouse.wheel` is not reliable in Firefox under Playwright.
    await page.evaluate(() => {
      window.scrollTo(0, 900);
    });
    await expect(bar).toHaveAttribute('data-shown', 'true');
    await expect(bar).toBeVisible();

    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect(bar).toHaveAttribute('data-shown', 'false');
  });

  /**
   * Which slice of the catalog is being read is an address.
   *
   * A creator works through drafts one at a time, and the filter used to live
   * in component state: a reload, a bookmark, and a second tab all lost it.
   */
  test('keeps the catalog slice in the address, through a reload', async ({
    page,
  }, testInfo) => {
    const subject = uniqueSubject(`slice-${testInfo.project.name}`);
    const handle = uniqueHandle(`sl-${testInfo.project.name}`);
    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    await page.goto(`${creatorStudioOrigin}/catalog`);
    await page.getByTestId('segment-draft').click();
    await page.waitForURL(/\/catalog\?show=draft$/u);

    await page.reload();
    await expect(page.getByTestId('segment-draft')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // A value the product does not serve falls back rather than showing
    // nothing at all.
    await page.goto(`${creatorStudioOrigin}/catalog?show=banana`);
    await expect(page.getByTestId('segment-all')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
