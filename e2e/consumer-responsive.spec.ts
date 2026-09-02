import { cohortFor, consumerWebOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  signInAdmitted,
  skipWhenCookieRequiresHttps,
} from './consumer.js';
import { expect, test } from './fixtures.js';
import { overflowingElements, viewportWidths } from './viewport.js';

/**
 * Consumer Web at the widths people actually use.
 *
 * The measurement itself lives in `viewport.ts`, because Creator Studio asserts
 * the same property about its own screens and two copies of one measurement is
 * two things to keep true.
 */

const widths = viewportWidths;

const routes = [
  /*
   * Live's door, which is the immersive layout and the one that escapes the
   * reading column. It claws its gutter back from the shell, and when the two
   * disagreed the stage was four pixels wider than the viewport at every phone
   * width — a page that rocks sideways under a thumb, on the screen this
   * product is arranged around.
   */
  '/live',
  '/discover',
  // The creator section is its own layout — a grid of cards whose names and
  // handles do not wrap — and it was the one that pushed the document sideways
  // once the reader scaled their text up.
  '/discover?show=creators',
  '/introductions',
  '/messages',
  '/notifications',
  '/you',
  '/you/settings',
  '/you/safety',
  '/you/memberships',
  '/you/gifts',
  // The coin screen: a balance, a running window, a list of packs, and a
  // history whose rows carry an amount and a reason side by side. The history
  // row is the one that fails first — at 200% text on a 320 px phone the
  // amount and the reason do not fit on one line, and a row that truncated the
  // amount would be a history nobody can use.
  '/you/wallet',
] as const;

test.describe('Consumer Web responsive behaviour', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  test.describe.configure({ mode: 'serial' });

  for (const width of widths) {
    test(`fits every screen at ${String(width)}px`, async ({
      browserName,
      page,
    }, testInfo) => {
      // One engine for the full matrix. What this asserts is a property of the
      // stylesheet rather than of an engine, and ten widths across eleven
      // addresses on every project is two hundred page loads for one answer.
      // The arrangements below — which navigation, which pane, which target
      // size — still run everywhere a browser can hold a session.
      test.skip(
        browserName !== 'chromium',
        'the width matrix asserts the stylesheet, and runs once',
      );
      const [person] = cohortFor(testInfo.project.name).people;
      if (person === undefined) throw new Error('the cohort has nobody in it');

      await page.setViewportSize({ height: width < 768 ? 740 : 900, width });

      // Public pages first, while there is no session. Visiting the entry page
      // with one sends the browser into the product, and a measurement taken
      // during that redirect is a measurement of whichever page won the race.
      for (const route of ['/', '/sign-in', '/c/nobody-here']) {
        await page.goto(`${consumerWebOrigin}${route}`);
        await expect(page.getByRole('main')).toBeVisible();
        expect(
          await overflowingElements(page),
          `${route} at ${String(width)}px`,
        ).toEqual([]);
      }

      await signInAdmitted(page, person.subject);
      for (const route of routes) {
        await page.goto(`${consumerWebOrigin}${route}`);
        await expect(page.getByRole('main')).toBeVisible();
        const offenders = await overflowingElements(page);
        expect(offenders, `${route} at ${String(width)}px`).toEqual([]);
      }

      /*
       * The two screens that are one navigation deeper than the list they are
       * reached from, with the seed's own hostile content on them: the
       * conversation carries the composer whose textarea has a min-content of
       * its own, and the person page carries the longest name and the
       * unbroken bio token. Neither was measured before, and one of them hid
       * a composer that pushed Send off a narrow phone.
       */
      const cohort = cohortFor(testInfo.project.name);
      const someone = cohort.people[1] ?? person;
      for (const route of [
        `/messages/${cohort.conversationId}`,
        `/people/${someone.id}`,
      ]) {
        await page.goto(`${consumerWebOrigin}${route}`);
        await expect(page.getByRole('main')).toBeVisible();
        const offenders = await overflowingElements(page);
        expect(offenders, `${route} at ${String(width)}px`).toEqual([]);
      }
    });
  }

  test('gives a phone a bottom bar and a desktop a sidebar', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await page.setViewportSize({ height: 740, width: 390 });
    await signInAdmitted(page, person.subject);
    await expect(page.getByTestId('tab-discover')).toBeVisible();
    await expect(page.getByTestId('nav-discover')).toBeHidden();

    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(page.getByTestId('nav-discover')).toBeVisible();
    await expect(page.getByTestId('tab-discover')).toBeHidden();
  });

  test('keeps a phone conversation on its own screen and a desktop one beside the list', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person] = cohort.people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await page.setViewportSize({ height: 740, width: 390 });
    await signInAdmitted(page, person.subject);
    await page.goto(`${consumerWebOrigin}/messages/${cohort.conversationId}`);
    // One task on screen at a time: the list is not competing for the width.
    await expect(page.getByTestId('conversation-view')).toBeVisible();
    await expect(page.getByTestId('conversation-list')).toBeHidden();

    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await expect(page.getByTestId('conversation-view')).toBeVisible();
  });

  test('gives every primary control a comfortable target on a phone', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await page.setViewportSize({ height: 740, width: 390 });
    await signInAdmitted(page, person.subject);

    const controls = page.locator(
      'main button:visible, main a[href]:visible, nav a[href]:visible',
    );
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const box = await controls.nth(index).boundingBox();
      if (box === null) continue;
      // Inline links inside a sentence are text rather than targets, and giving
      // them a 44px box would put gaps in the paragraph they live in.
      const inline = await controls
        .nth(index)
        .evaluate((node) => node.closest('p') !== null);
      if (inline) continue;
      expect(
        Math.min(box.height, box.width),
        await controls.nth(index).innerText(),
      ).toBeGreaterThanOrEqual(36);
    }
  });

  test('survives a page zoomed to twice its text size', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    // The narrowest width this product supports, not a comfortable one. A
    // status pill that pushed the page sideways cleared 390 px on one machine's
    // font metrics and failed on another's by two pixels; at 320 px the margin
    // is wide enough that the assertion answers the same on both.
    await page.setViewportSize({ height: 740, width: 320 });
    await signInAdmitted(page, person.subject);
    // Text scaling rather than page zoom: it is the case that breaks fixed
    // heights, and it is what somebody with low vision actually turns on.
    await page.addStyleTag({ content: 'html { font-size: 200% }' });

    // Every screen, not one. Two of these overflowed at this size while `/you`
    // was clean: a card grid whose track had no floor, and a row whose status
    // pill could not shrink and could not wrap.
    const cohort = cohortFor(testInfo.project.name);
    const someone = cohort.people[1] ?? person;
    for (const route of [
      ...routes,
      `/messages/${cohort.conversationId}`,
      `/people/${someone.id}`,
    ]) {
      await page.goto(`${consumerWebOrigin}${route}`);
      await page.addStyleTag({ content: 'html { font-size: 200% }' });
      await expect(page.getByRole('main')).toBeVisible();
      expect(await overflowingElements(page), `${route} at 200% text`).toEqual(
        [],
      );
    }

    // The profile in its editing arrangement: a field beside a button is the
    // classic row that cannot shrink, and the language picker inside it was
    // the one place left where an input's min-content set the page's width.
    await page.goto(`${consumerWebOrigin}/you`);
    await page.addStyleTag({ content: 'html { font-size: 200% }' });
    await page.getByTestId('profile-edit').click();
    await expect(page.getByTestId('profile-save')).toBeVisible();
    expect(
      await overflowingElements(page),
      '/you editing at 200% text',
    ).toEqual([]);
  });
});
