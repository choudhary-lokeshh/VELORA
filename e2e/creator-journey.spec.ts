import {
  cohortFor,
  consumerWebOrigin,
  creatorStudioOrigin,
} from './auth-environment.js';
import { fixturePhoto } from './consumer.js';
import {
  activateCreator,
  claimHandle,
  cookieSkipReason,
  createClub,
  declareAdult,
  publishPage,
  signInToStudio,
  skipWhenCookieRequiresHttps,
  uniqueHandle,
  uniqueSubject,
} from './creator.js';
import { expect, test } from './fixtures.js';

/**
 * The creator journey in a real browser, end to end.
 *
 * This is the only place that proves the two surfaces actually work together:
 * a person declares adult status on Consumer Web, becomes a creator in Studio
 * with a different cookie for a different audience, publishes, and then a
 * visitor with no session at all sees the result. Everything in between is the
 * server's decision; the browser only shows it.
 *
 * Nothing here sleeps. Every wait is for a piece of state the surface only
 * renders once the server has answered, so a slow machine makes the test slower
 * rather than flaky.
 */

test.describe('Creator Studio journey', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  /*
   * Longer than the default, because these are the only tests that drive two
   * surfaces. One of them signs a person in on Consumer Web, walks the whole
   * admission ladder, activates a creator on a second origin with a second
   * cookie, claims a handle, publishes, creates and publishes a club, issues an
   * invitation, opens a third browser context for a second person, and redeems
   * it. Thirty seconds is a bound on how busy the machine is rather than on
   * whether the product works, and a bound like that fails the suite for the
   * wrong reason.
   */
  test.describe.configure({ timeout: 120_000 });

  test('carries one person from adult declaration to a public creator page', async ({
    page,
  }) => {
    const subject = uniqueSubject('creator');
    const handle = uniqueHandle('c');

    await declareAdult(page, subject);
    await activateCreator(page, subject);

    // Creator access is a capability on the same person, not a second account:
    // the Studio session was established by signing in with the same identity.
    await claimHandle(page, handle);
    await expect(page.getByTestId('creator-publication')).toContainText(
      'Draft',
    );

    // A draft page is not reachable, and the visitor is told nothing else.
    const visitor = await page.context().browser()?.newContext();
    if (visitor === undefined) throw new Error('no browser for the visitor');
    try {
      const anonymous = await visitor.newPage();
      await anonymous.goto(`${consumerWebOrigin}/c/${handle}`);
      await expect(anonymous.getByRole('heading', { level: 1 })).toHaveText(
        'This page is not available',
      );

      await publishPage(page);

      await anonymous.reload();
      await expect(anonymous.getByRole('heading', { level: 1 })).toHaveText(
        'Ember Vale',
      );
      await expect(anonymous.getByTestId('creator-page-handle')).toHaveText(
        `@${handle}`,
      );
      // Nothing on a public page offers to sell anything, because nothing can
      // be sold.
      const body = await anonymous.locator('body').innerText();
      for (const forbidden of ['Subscribe', 'Buy', 'Price']) {
        expect(body).not.toContain(forbidden);
      }
    } finally {
      await visitor.close();
    }
  });

  /**
   * The preview reads the public addresses rather than local form state.
   *
   * That is the whole point of the screen: a preview assembled from what this
   * tab holds would show a creator their drafts and tell them nothing about
   * what they had actually published.
   */
  test('previews the public page as a visitor would find it', async ({
    page,
  }) => {
    const subject = uniqueSubject('preview');
    const handle = uniqueHandle('v');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    await page.goto(`${creatorStudioOrigin}/profile/preview`);
    await expect(page.getByTestId('preview-draft')).toContainText(
      'Nobody can open',
    );
    await expect(page.getByTestId('preview-empty')).toBeVisible();

    await page.goto(`${creatorStudioOrigin}/profile`);
    await publishPage(page);
    await page.goto(`${creatorStudioOrigin}/profile/preview`);
    await expect(page.getByTestId('preview-identity')).toContainText(
      'Ember Vale',
    );
    await expect(page.getByTestId('preview-catalog-empty')).toBeVisible();
  });

  test('publishes an item and a club, and shows both to a visitor', async ({
    page,
  }) => {
    const subject = uniqueSubject('publish');
    const handle = uniqueHandle('p');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);
    await publishPage(page);

    // Writing and publishing are two decisions, and the surface keeps them
    // apart: saving produces a draft nobody can see.
    await page.goto(`${creatorStudioOrigin}/catalog/new`);
    await page.getByTestId('content-title').fill('A first post');
    await page
      .getByTestId('content-summary')
      .fill('short form from the studio');
    await page.getByTestId('content-caption-ai-generate').click();
    const caption = page.getByTestId('content-caption-ai-suggestion');
    await expect(caption).toHaveValue('Short form from the studio.');
    await caption.fill('Short form, edited by the creator.');
    await page.getByTestId('content-caption-ai-replace').click();
    await expect(page.getByTestId('content-summary')).toHaveValue(
      'Short form, edited by the creator.',
    );
    await page.getByTestId('content-body').fill('The body of the thing.');
    await page.getByTestId('content-save').click();
    await page.waitForURL(/\/catalog\/[0-9a-f-]+$/u, { timeout: 30_000 });
    await expect(page.getByTestId('content-editor-lifecycle')).toContainText(
      'Draft',
    );
    await page.getByTestId('content-editor-publish').click();
    await page.waitForURL(/\/catalog$/u, { timeout: 30_000 });
    const item = page.locator('[data-testid^="content-item-"]').first();
    await expect(item).toContainText('Published');

    await createClub(page);
    await expect(page.getByTestId('club-lifecycle')).toContainText('Draft');
    await page.getByTestId('club-publish').click();
    await expect(page.getByTestId('club-lifecycle')).toContainText('Published');
    await expect(page.getByTestId('club-member-count')).toHaveText('0');

    const visitor = await page.context().browser()?.newContext();
    if (visitor === undefined) throw new Error('no browser for the visitor');
    try {
      const anonymous = await visitor.newPage();
      await anonymous.goto(`${consumerWebOrigin}/c/${handle}`);
      await expect(
        anonymous.getByTestId('creator-catalog').getByText('A first post'),
      ).toBeVisible();
      await expect(
        anonymous.getByTestId('creator-public-clubs').getByText('Inner Circle'),
      ).toBeVisible();
      // Club metadata and no more: nothing about who is inside.
      const body = await anonymous.locator('body').innerText();
      expect(body).not.toMatch(/\d+\s+members?/iu);
      expect(body).toContain('by invitation from this creator');
    } finally {
      await visitor.close();
    }
  });

  test('publishes creator and catalog imagery through the real media pipeline', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const subject = uniqueSubject('creator-media');
    const handle = uniqueHandle('i');
    const photo = await fixturePhoto();

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    await page.goto(`${creatorStudioOrigin}/profile`);
    await page.getByTestId('creator-image-input-cover').setInputFiles({
      buffer: photo,
      mimeType: 'image/jpeg',
      name: 'cover.jpg',
    });
    await expect(
      page.locator('[data-testid="creator-media-cover"][data-state]'),
    ).toHaveCount(1, { timeout: 60_000 });

    await page.goto(`${creatorStudioOrigin}/catalog/new`);
    await page.getByTestId('content-title').fill('A pictured studio note');
    await page.getByTestId('content-summary').fill('Glaze tests in daylight.');
    await page.getByTestId('content-save').click();
    await page.waitForURL(/\/catalog\/[0-9a-f-]+$/u, { timeout: 30_000 });
    await page.getByTestId('content-image-input').setInputFiles({
      buffer: photo,
      mimeType: 'image/jpeg',
      name: 'catalog.jpg',
    });
    await expect(
      page.locator('[data-testid^="content-media-"][data-state]'),
    ).toHaveCount(1, { timeout: 60_000 });
    await page.getByTestId('content-editor-publish').click();
    await page.waitForURL(/\/catalog$/u, { timeout: 30_000 });

    await page.goto(`${creatorStudioOrigin}/profile`);
    await publishPage(page);

    const visitor = await page.context().browser()?.newContext();
    if (visitor === undefined) throw new Error('no browser for the visitor');
    try {
      const anonymous = await visitor.newPage();
      await expect(async () => {
        await anonymous.goto(`${consumerWebOrigin}/c/${handle}`);
        await expect(anonymous.getByTestId('creator-page-cover')).toBeVisible({
          timeout: 2_000,
        });
        await expect(
          anonymous.locator('[data-testid^="creator-item-cover-"]'),
        ).toHaveCount(1, { timeout: 2_000 });
      }).toPass({ timeout: 180_000 });

      for (const image of [
        anonymous.getByTestId('creator-page-cover').locator('img'),
        anonymous.locator('[data-testid^="creator-item-cover-"] img'),
      ]) {
        await expect
          .poll(
            async () =>
              image.evaluate((node: HTMLImageElement) => node.naturalWidth),
            { timeout: 15_000 },
          )
          .toBeGreaterThan(0);
      }
    } finally {
      await visitor.close();
    }
  });

  /**
   * A members-only item with no club has nobody to admit.
   *
   * The surface says so rather than letting a creator believe their work is
   * behind a door somebody could be given a key to.
   */
  test('says a members-only item reaches nobody until it has a club', async ({
    page,
  }) => {
    const subject = uniqueSubject('members');
    const handle = uniqueHandle('m');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    await page.goto(`${creatorStudioOrigin}/catalog/new`);
    await page.getByTestId('content-title').fill('For the inner circle');
    await page.getByTestId('content-audience-members').click();
    await expect(page.getByTestId('content-no-clubs')).toContainText(
      'reachable by nobody',
    );
    await page.getByTestId('content-save').click();
    await page.waitForURL(/\/catalog\/[0-9a-f-]+$/u, { timeout: 30_000 });

    await page.goto(`${creatorStudioOrigin}/catalog`);
    const item = page.locator('[data-testid^="content-unreachable-"]').first();
    await expect(item).toContainText('Reaches nobody');

    // Give it a club and the warning goes away, because it is no longer true.
    await createClub(page);
    await page.goto(`${creatorStudioOrigin}/catalog`);
    await page.locator('[data-testid^="content-open-"]').first().click();
    await page.waitForURL(/\/catalog\/[0-9a-f-]+$/u, { timeout: 30_000 });
    await page.getByTestId('content-club').selectOption({ index: 1 });
    await page.getByTestId('content-save').click();
    // The save has landed when the surface stops offering to save again.
    await expect(page.getByTestId('content-unsaved')).toHaveCount(0);
    await page.goto(`${creatorStudioOrigin}/catalog`);
    await expect(
      page.locator('[data-testid^="content-unreachable-"]'),
    ).toHaveCount(0);
  });

  test('shows an invitation once, masked, and says it cannot be shown again', async ({
    page,
  }) => {
    const subject = uniqueSubject('invite');
    const handle = uniqueHandle('i');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);
    await createClub(page);

    // A draft club admits nobody, so no invitation is offered for one.
    await expect(page.getByTestId('club-invite-blocked')).toBeVisible();
    await expect(page.getByTestId('club-invite')).toHaveCount(0);

    await page.getByTestId('club-publish').click();
    await expect(page.getByTestId('club-invite')).toBeVisible();
    await page.getByTestId('club-invite').click();

    const shown = page.getByTestId('club-invite-secret');
    await expect(shown).toContainText('shown once');
    await expect(shown).toContainText('cannot show it to you again');

    // Masked until somebody asks, because the likeliest place an invitation
    // leaks is a shoulder or a screen share.
    const masked = await page
      .getByTestId('club-invite-secret-value')
      .innerText();
    expect(masked).toMatch(/^•+$/u);
    await page.getByTestId('club-invite-reveal').click();
    const secret = (
      await page.getByTestId('club-invite-secret-value').innerText()
    ).trim();
    expect(secret).not.toMatch(/^•+$/u);

    // Dismissing it takes it off the screen, and the listing never carried it.
    await page.getByTestId('club-invite-done').click();
    await expect(shown).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(secret);
  });

  /**
   * The whole invitation path, across both surfaces and two people.
   *
   * A creator issues a bearer secret in Studio; a consumer with a different
   * account and a different audience cookie presents it on Consumer Web and is
   * admitted. This is the only way anybody gets into a private club — no payment
   * path exists — so it is the one commercial-adjacent journey that can be
   * proved end to end today.
   */
  test('carries an invitation from Studio to a consumer who redeems it', async ({
    browser,
    page,
  }, testInfo) => {
    const subject = uniqueSubject('redeem');
    const handle = uniqueHandle('r');
    const [member] = cohortFor(testInfo.project.name).people;
    if (member === undefined) throw new Error('the cohort has nobody in it');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);
    // The public page is published too, and that matters to the member rather
    // than to the creator: an entitlement whose creator has no published page
    // is omitted from what the member is shown, because the listing carries the
    // handle CREATORS publishes and there is none to carry.
    await publishPage(page);

    await createClub(page);
    await page.getByTestId('club-publish').click();
    await expect(page.getByTestId('club-invite')).toBeVisible();
    await page.getByTestId('club-invite').click();
    await page.getByTestId('club-invite-reveal').click();
    const secret = (
      await page.getByTestId('club-invite-secret-value').innerText()
    ).trim();

    // A different person, a different account, a different audience cookie.
    const consumer = await browser.newContext({
      extraHTTPHeaders: { 'x-velora-device': `${subject}-member` },
    });
    try {
      const memberPage = await consumer.newPage();
      await memberPage.goto(`${consumerWebOrigin}/sign-in`);
      await memberPage.getByTestId('sign-in-subject').fill(member.subject);
      await memberPage.getByTestId('sign-in-subject').press('Enter');
      await memberPage.waitForURL(/\/discover$/u, { timeout: 30_000 });

      await memberPage.goto(`${consumerWebOrigin}/you/memberships`);
      await expect(memberPage.getByTestId('club-access-empty')).toBeVisible();
      await memberPage.getByTestId('club-invite-secret').fill(secret);
      await memberPage.getByTestId('club-invite-redeem').click();

      await expect(memberPage.getByTestId('club-access-list')).toContainText(
        'Inner Circle',
      );
      // Spent, and never rendered again.
      const rendered = await memberPage.locator('body').innerText();
      expect(rendered).not.toContain(secret);
      await expect(memberPage.getByTestId('club-invite-secret')).toHaveValue(
        '',
      );

      // And it works exactly once: presenting it again is the same answer as an
      // invitation that never existed.
      await memberPage.getByTestId('club-invite-secret').fill(secret);
      await memberPage.getByTestId('club-invite-redeem').click();
      await expect(
        memberPage.getByText('That is not possible right now.'),
      ).toBeVisible();

      // The creator now sees one live grant, and nothing about who holds it.
      await page.reload();
      await expect(page.getByTestId('club-member-count')).toHaveText('1');
      await expect(page.getByTestId('club-access')).toContainText(
        'Admitted by your invitation',
      );
      const access = await page.getByTestId('club-access').innerText();
      expect(access).not.toContain(member.subject);
    } finally {
      await consumer.close();
    }
  });

  test('refuses a stale edit rather than overwriting a newer one', async ({
    page,
  }) => {
    const subject = uniqueSubject('stale');
    const handle = uniqueHandle('s');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle, 'First');

    // A second tab, holding the version the first one is about to replace.
    //
    // Its reads are pinned to the first answer on purpose. Studio re-reads when
    // a tab becomes the one being looked at, which is the right behaviour and
    // would resolve the conflict before it happened; two tabs side by side in
    // one window do not both get focus, and that is the case this asserts.
    const second = await page.context().newPage();
    let pinned: string | undefined;
    await second.route('**/v1/creator/profile', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (pinned === undefined) {
        const response = await route.fetch();
        pinned = await response.text();
        await route.fulfill({ body: pinned, response });
        return;
      }
      await route.fulfill({
        body: pinned,
        contentType: 'application/json',
        status: 200,
      });
    });
    await second.goto(`${creatorStudioOrigin}/profile`);
    await expect(second.getByTestId('creator-handle-fixed')).toContainText(
      `@${handle}`,
    );

    await page.getByTestId('creator-display-name').fill('Second');
    await page.getByTestId('creator-save-profile').click();
    await expect(page.getByTestId('creator-profile-error')).toHaveCount(0);

    await second.getByTestId('creator-display-name').fill('Third');
    await second.getByTestId('creator-save-profile').click();
    await expect(second.getByTestId('creator-profile-error')).toContainText(
      'Reload and try again',
    );
    await second.close();
  });

  test('offers a retry rather than a blank screen when the API is unreachable', async ({
    page,
  }) => {
    const subject = uniqueSubject('offline');
    await declareAdult(page, subject);
    await signInToStudio(page, subject);
    await page.waitForURL(/\/start$/u, { timeout: 30_000 });

    // Every creator call fails from here. The surface has to say so and offer a
    // way forward rather than spinning.
    await page.route('**/v1/creator/**', async (route) => route.abort());
    await page.reload();

    const failure = page.getByTestId('creator-status-failed');
    await expect(failure).toContainText('could not be reached');
    await expect(
      failure.getByRole('button', { name: 'Try again' }),
    ).toBeVisible();
  });

  test('says a session that has ended has ended, and asks again', async ({
    page,
  }) => {
    const subject = uniqueSubject('expiry');
    await declareAdult(page, subject);
    await activateCreator(page, subject);

    await page.context().clearCookies();
    await page.goto(`${creatorStudioOrigin}/catalog`);
    await page.waitForURL(/\/sign-in\?next=%2Fcatalog$/u, { timeout: 30_000 });
    await expect(page.getByTestId('sign-in-subject')).toBeVisible();
  });

  test('can be driven from the keyboard alone', async ({ page }) => {
    const subject = uniqueSubject('keyboard');
    await declareAdult(page, subject);
    await signInToStudio(page, subject);
    await page.waitForURL(/\/start$/u, { timeout: 30_000 });

    const onboard = page.getByTestId('creator-onboard');
    await expect(onboard).toBeVisible();
    await onboard.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('creator-accept-policies')).toBeVisible();

    await page.getByTestId('creator-accept-policies').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/home$/u, { timeout: 30_000 });

    // The navigation is reachable and operable the same way.
    await page.getByTestId('nav-catalog').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/catalog$/u, { timeout: 30_000 });
  });

  /**
   * A dialog has to take focus, keep it, and give it back.
   *
   * All three are asserted here rather than in the unit suite because focus is
   * only real in a browser.
   */
  test('contains focus in a dialog and returns it on close', async ({
    page,
  }) => {
    const subject = uniqueSubject('dialog');
    const handle = uniqueHandle('d');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    await page.goto(`${creatorStudioOrigin}/clubs`);
    await page.getByTestId('club-new').click();
    const dialog = page.getByTestId('club-create-dialog');
    await expect(dialog).toBeVisible();

    // Focus is inside, and Tab keeps it there.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((node) =>
        node.contains(document.activeElement),
      );
      expect(inside).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('club-new')).toBeFocused();
  });

  test('exposes one document heading and named landmarks', async ({ page }) => {
    const subject = uniqueSubject('landmarks');
    await declareAdult(page, subject);
    await activateCreator(page, subject);

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    // One navigation model in three arrangements, and the stylesheet shows
    // exactly one of them: a second navigation reachable at the same width
    // would be two places to look for the same five destinations.
    await expect(page.getByRole('navigation', { name: 'Studio' })).toHaveCount(
      1,
    );
  });

  /**
   * Nothing on this surface states a figure the platform does not compute.
   *
   * Asserted against the rendered text of every destination rather than against
   * a component, because the failure this guards against is somebody adding a
   * plausible-looking number to a screen.
   */
  test('shows no fabricated figure anywhere in the workspace', async ({
    page,
  }) => {
    const subject = uniqueSubject('honest');
    const handle = uniqueHandle('h');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await claimHandle(page, handle);

    for (const route of [
      '/home',
      '/profile',
      '/catalog',
      '/clubs',
      '/money',
      '/money/payouts',
      '/money/selling',
      '/account',
    ]) {
      await page.goto(`${creatorStudioOrigin}${route}`);
      await expect(page.getByRole('main')).toBeVisible();
      const body = (await page.locator('body').innerText()).toLowerCase();
      for (const forbidden of [
        'followers',
        'subscribers',
        'impressions',
        'engagement',
        'conversion',
        'growth',
        'this month',
        'last 30 days',
        'trending',
      ]) {
        expect(body, `${route} says "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });
});
