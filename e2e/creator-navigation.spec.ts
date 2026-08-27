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
});
