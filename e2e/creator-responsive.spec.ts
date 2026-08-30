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
import { overflowingElements, viewportWidths } from './viewport.js';

/**
 * Creator Studio at the widths people actually use.
 *
 * The approved responsive rules make Studio desktop-first, which is a statement
 * about where the density goes rather than permission to break the phone. What
 * is asserted here is that the same workspace is usable at every width: nothing
 * pushes the page sideways, the navigation takes the arrangement its input
 * deserves, and every control a thumb has to hit is big enough to hit.
 */

const routes = [
  '/home',
  '/profile',
  '/profile/preview',
  '/catalog',
  '/catalog/new',
  '/clubs',
  '/money',
  '/money/gifts',
  '/money/payouts',
  '/money/selling',
  '/account',
] as const;

test.describe('Creator Studio responsive behaviour', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  test.describe.configure({ mode: 'serial' });

  /**
   * One creator, every width.
   *
   * Deliberately one test rather than one per width. Each width needs a
   * workspace with something in it, and seeding a creator ten times is ten
   * admissions, ten activations, and ten clubs for an answer that is a property
   * of the stylesheet. The loop is the cheap part.
   */
  test('fits every screen at every width', async ({ browserName, page }) => {
    // One engine for the full matrix. What this asserts is a property of the
    // stylesheet rather than of an engine, and ten widths across a dozen
    // addresses on every project is hundreds of page loads for one answer.
    test.skip(
      browserName !== 'chromium',
      'the width matrix asserts the stylesheet, and runs once',
    );
    test.setTimeout(180_000);

    const subject = uniqueSubject('widths');
    const handle = uniqueHandle('w');

    // The signed-out door first, while there is no session to redirect on.
    await page.setViewportSize({ height: 740, width: 390 });
    await page.goto(`${creatorStudioOrigin}/sign-in`);
    await expect(page.getByTestId('sign-in-subject')).toBeVisible();
    expect(await overflowingElements(page), '/sign-in at 390px').toEqual([]);

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);
    // A club gives the club screen something to lay out rather than an empty
    // state, which is the arrangement most likely to overflow.
    await createClub(page);
    const clubAddress = page.url();

    for (const width of viewportWidths) {
      await page.setViewportSize({ height: width < 768 ? 740 : 900, width });
      for (const route of [...routes, clubAddress]) {
        await page.goto(
          route.startsWith('http') ? route : `${creatorStudioOrigin}${route}`,
        );
        await expect(page.getByRole('main')).toBeVisible();
        expect(
          await overflowingElements(page),
          `${route} at ${String(width)}px`,
        ).toEqual([]);
      }
    }
  });

  test('gives a phone a bottom bar, a tablet a rail, and a desktop a sidebar', async ({
    page,
  }) => {
    const subject = uniqueSubject('arrangement');
    await declareAdult(page, subject);
    await page.setViewportSize({ height: 740, width: 390 });
    await activateCreator(page, subject);

    await expect(page.getByTestId('tab-home')).toBeVisible();
    await expect(page.getByTestId('nav-home')).toBeHidden();

    // From the tablet the rail replaces the bar, and the labels come with it.
    await page.setViewportSize({ height: 900, width: 820 });
    await expect(page.getByTestId('nav-home')).toBeVisible();
    await expect(page.getByTestId('tab-home')).toBeHidden();

    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(page.getByTestId('nav-home')).toBeVisible();
    await expect(page.getByTestId('nav-account')).toBeVisible();
  });

  test('gives every primary control a comfortable target on a phone', async ({
    page,
  }) => {
    const subject = uniqueSubject('targets');
    const handle = uniqueHandle('t');
    await declareAdult(page, subject);
    await page.setViewportSize({ height: 740, width: 390 });
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    for (const route of ['/home', '/catalog', '/clubs', '/account']) {
      await page.goto(`${creatorStudioOrigin}${route}`);
      await expect(page.getByRole('main')).toBeVisible();
      const controls = page.locator(
        'main button:visible, main a[href]:visible, nav a[href]:visible',
      );
      const count = await controls.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const box = await controls.nth(index).boundingBox();
        if (box === null) continue;
        // Inline links inside a sentence are text rather than targets, and
        // giving them a 44px box would put gaps in the paragraph they live in.
        const inline = await controls
          .nth(index)
          .evaluate((node) => node.closest('p') !== null);
        if (inline) continue;
        expect(
          Math.min(box.height, box.width),
          `${route}: ${await controls.nth(index).innerText()}`,
        ).toBeGreaterThanOrEqual(36);
      }
    }
  });

  test('survives a page zoomed to twice its text size', async ({ page }) => {
    test.setTimeout(180_000);
    const subject = uniqueSubject('zoom');
    const handle = uniqueHandle('z');
    await declareAdult(page, subject);
    // The narrowest width the workspace supports rather than a typical one:
    // this is where a control that cannot shrink runs out of room first, and a
    // margin measured at 390 px on one machine's font metrics is not a margin.
    await page.setViewportSize({ height: 740, width: 320 });
    await activateCreator(page, subject);
    await claimHandle(page, handle);
    await createClub(page);
    const clubAddress = page.url();

    // Every screen, not four. The style tag has to be re-applied after each
    // navigation, because a `goto` discards it — which is how this assertion
    // measured ordinary 16 px text on every route it claimed to zoom, and how
    // a tab bar that lost its last destination at 200% text got past it.
    for (const route of [...routes, clubAddress]) {
      await page.goto(
        route.startsWith('http') ? route : `${creatorStudioOrigin}${route}`,
      );
      // Text scaling rather than page zoom: it is the case that breaks fixed
      // heights, and it is what somebody with low vision actually turns on.
      await page.addStyleTag({ content: 'html { font-size: 200% }' });
      await expect(page.getByRole('main')).toBeVisible();
      expect(await overflowingElements(page), `${route} at 200% text`).toEqual(
        [],
      );
    }
  });

  /**
   * The navigation is the last thing allowed to break at a large text size.
   *
   * Five columns sized by their own content came to 399 px on a 320 px phone,
   * which put Money entirely off the screen and clipped Clubs: the workspace
   * lost a destination to a font size, on every route, with nothing else on the
   * page overflowing to give it away.
   */
  test('keeps every destination on the screen at twice the text size', async ({
    page,
  }) => {
    const subject = uniqueSubject('tabbar');
    await declareAdult(page, subject);
    await page.setViewportSize({ height: 740, width: 320 });
    await activateCreator(page, subject);

    await page.goto(`${creatorStudioOrigin}/home`);
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await expect(page.getByTestId('tab-money')).toBeVisible();

    const limit = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    for (const id of ['home', 'profile', 'catalog', 'clubs', 'money']) {
      const box = await page.getByTestId(`tab-${id}`).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box?.x ?? -1, `${id} starts on screen`).toBeGreaterThanOrEqual(
        -0.5,
      );
      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `${id} ends on screen`,
      ).toBeLessThanOrEqual(limit + 0.5);
    }
  });
});
