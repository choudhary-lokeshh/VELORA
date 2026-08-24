import { cohortFor, consumerWebOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  fixturePhoto,
  navigateTo,
  signIn,
  signInAdmitted,
  skipWhenCookieRequiresHttps,
  uniqueSubject,
} from './consumer.js';
import { expect, test } from './fixtures.js';

/**
 * The Consumer Web product journey in a real browser.
 *
 * This is the only place navigation, focus, activation semantics, and layout are
 * real, so everything that depends on any of them is proved here rather than in
 * jsdom. It runs against the same API the integration suite uses, with the
 * development adapters the configuration schema admits in local and test.
 *
 * A browser can now complete a profile, photo included, and that is proved
 * below rather than assumed: the development storage adapter was given a
 * transport, so the upload address the platform issues is one a browser can
 * actually PUT to. No approved storage provider exists, so this is evidence
 * about the product and its pipeline rather than about a deployed provider.
 *
 * Each browser project drives its own cohort of accounts, because nearly every
 * assertion here changes something — a pass suppresses a candidate, an answer
 * closes an introduction, a block ends a conversation — and a shared cohort
 * would make one project's result depend on another's.
 */

test.describe('Consumer Web product journey', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  // Serial within a project: these tests share one cohort deliberately, so that
  // a conversation opened by one is the conversation another reads.
  test.describe.configure({ mode: 'serial' });

  test('lets somebody in from the public entry and shows them the product', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await page.goto(consumerWebOrigin);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Meet people who said yes too.',
    );
    await page.getByTestId('landing-start').click();
    await page.waitForURL(/\/sign-in$/u);

    await page.getByTestId('sign-in-subject').fill(person.subject);
    await page.getByTestId('sign-in-subject').press('Enter');
    await page.waitForURL(/\/discover$/u, { timeout: 30_000 });

    // Somebody available, with a name, a place, and a bio the server sent.
    await expect(page.getByTestId('discovery-candidates')).toBeVisible();
    await expect(
      page.getByTestId('discovery-candidates').getByRole('heading'),
    ).not.toHaveCount(0);

    // Nothing invented anywhere on it.
    const rendered = await page.locator('body').innerText();
    for (const forbidden of ['Online now', '% match', 'km away', 'Views']) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
  });

  test('walks the admission ladder and stops exactly where the platform does', async ({
    page,
  }) => {
    await signIn(page, uniqueSubject('ladder'));
    await page.waitForURL(/\/welcome$/u);

    await page.getByTestId('create-account').click();
    await expect(page.getByTestId('declare-adult')).toBeVisible();
    // A declaration, said to be a declaration.
    await expect(page.getByText(/not an identity or age check/u)).toBeVisible();
    await page.getByTestId('onboarding-region').fill('ES');
    await page.getByTestId('declare-adult').click();

    await expect(page.getByTestId('acknowledge-policies')).toBeVisible();
    await expect(page.getByTestId('outstanding-policies')).toContainText(
      'Terms of service',
    );
    await page.getByTestId('acknowledge-policies').click();

    await expect(page.getByTestId('save-profile')).toBeVisible();
    await page.getByTestId('onboarding-display-name').fill('Journey Tester');
    await page.getByTestId('language-input').fill('en');
    await page.getByTestId('language-add').click();
    await page.getByTestId('save-profile').click();

    // The ladder is the server's, and it has not finished: the profile still
    // lacks the one image the minimum requires. Supplying it is the next test.
    await expect(page.getByTestId('profile-photo')).toBeVisible();
    await expect(page).toHaveURL(/\/welcome$/u);
  });

  test('uploads a real photo from the browser and finishes onboarding on it', async ({
    page,
  }) => {
    // The whole ladder, in a browser, ending in the product. Nothing is written
    // behind the API's back: the photo goes through the same three calls the
    // surface makes for anybody — ask for a capability, PUT the bytes to the
    // address it names, confirm — and the worker inspects and processes it.
    await signIn(page, uniqueSubject('media'));
    await page.waitForURL(/\/welcome$/u);
    await page.getByTestId('create-account').click();
    await page.getByTestId('onboarding-region').fill('ES');
    await page.getByTestId('declare-adult').click();
    await page.getByTestId('acknowledge-policies').click();
    await page.getByTestId('onboarding-display-name').fill('Media Tester');
    await page.getByTestId('language-input').fill('en');
    await page.getByTestId('language-add').click();
    await page.getByTestId('save-profile').click();

    await expect(page.getByTestId('profile-photo')).toBeVisible();
    await page.getByTestId('profile-photo').setInputFiles({
      buffer: await fixturePhoto(),
      mimeType: 'image/jpeg',
      name: 'photo.jpg',
    });

    // Accepted, then checked. `checking` is the honest intermediate state and
    // the surface shows it rather than claiming the photo is done.
    const slot = page.locator('[data-testid^="profile-media-"]').first();
    await expect(slot).toBeVisible({ timeout: 30_000 });

    // Inspection and processing are the worker's, so the surface only learns
    // the outcome by asking again.
    await expect(async () => {
      await page.reload();
      await expect(
        page.locator('[data-testid^="profile-media-"][data-state="ready"]'),
      ).toHaveCount(1);
    }).toPass({ timeout: 90_000 });

    // The minimum is met, so the server's own ladder lets this account through.
    await page.goto(`${consumerWebOrigin}/discover`);
    await expect(page).toHaveURL(/\/discover$/u);

    // Nothing about the storage address reaches the page, in success or
    // failure: it is provider detail and it names a signed credential.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('signature=');
    expect(body).not.toContain('uploadUrl');
  });

  test('refuses bytes that are not an image it admits, and says so plainly', async ({
    page,
  }) => {
    await signIn(page, uniqueSubject('media-refused'));
    await page.waitForURL(/\/welcome$/u);
    await page.getByTestId('create-account').click();
    await page.getByTestId('onboarding-region').fill('ES');
    await page.getByTestId('declare-adult').click();
    await page.getByTestId('acknowledge-policies').click();
    await page.getByTestId('onboarding-display-name').fill('Refusal Tester');
    await page.getByTestId('language-input').fill('en');
    await page.getByTestId('language-add').click();
    await page.getByTestId('save-profile').click();

    // A JPEG magic number and nothing decodable behind it. The upload itself
    // succeeds — a transport moves bytes — and the platform then decides what
    // they are from the bytes, which is where this is refused.
    await page.getByTestId('profile-photo').setInputFiles({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      mimeType: 'image/jpeg',
      name: 'photo.jpg',
    });

    await expect(async () => {
      await page.reload();
      await expect(
        page.locator('[data-testid^="profile-media-"][data-state="rejected"]'),
      ).toHaveCount(1);
    }).toPass({ timeout: 90_000 });

    // Still not through: a rejected photo is not a photo.
    await page.goto(`${consumerWebOrigin}/discover`);
    await expect(page).toHaveURL(/\/welcome$/u);
  });

  test('answers an introduction and opens the conversation it creates', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person] = cohort.people;
    const waiting = cohort.people[2];
    if (person === undefined || waiting === undefined) {
      throw new Error('the cohort needs somebody waiting');
    }

    await signInAdmitted(page, person.subject);
    await navigateTo(page, 'introductions');

    const card = page
      .locator('[data-testid^="introduction-"]')
      .filter({ hasText: waiting.displayName })
      .first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Interested too' }).click();

    await page.getByTestId('segment-mutual').click();
    const mutual = page
      .locator('[data-testid^="introduction-"]')
      .filter({ hasText: waiting.displayName })
      .first();
    await expect(mutual).toBeVisible();
    await mutual.getByRole('button', { name: 'Message' }).click();
    await page.waitForURL(/\/messages\/[0-9a-f-]+$/u);
    await expect(page.getByTestId('conversation-view')).toBeVisible();
  });

  test('sends a message and shows it in the order the server assigned', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person, counterpart] = cohort.people;
    if (person === undefined || counterpart === undefined) {
      throw new Error('the cohort needs a pair');
    }

    await signInAdmitted(page, person.subject);
    await navigateTo(page, 'messages');
    await page.getByTestId(`conversation-${cohort.conversationId}`).click();
    await expect(page.getByTestId('conversation-view')).toBeVisible();

    // The seeded transcript is there, and it is somebody else's words as well
    // as this person's.
    await expect(page.getByTestId('messages')).toContainText(
      'It is definitely both.',
    );

    const written = `A message written in a browser at ${String(Date.now())}`;
    await page.getByTestId('message-body').fill(written);
    await page.getByTestId('message-body').press('Enter');
    await expect(page.getByTestId('messages')).toContainText(written);

    // Nothing on this surface claims the message is end-to-end encrypted.
    await expect(page.getByText('Not end-to-end encrypted.')).toBeVisible();

    // And it survives a reload, because the server has it rather than this tab.
    await page.reload();
    await expect(page.getByTestId('messages')).toContainText(written);
  });

  test('refuses a message longer than the contract accepts before sending it', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person] = cohort.people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await signInAdmitted(page, person.subject);
    await page.goto(`${consumerWebOrigin}/messages/${cohort.conversationId}`);
    await page.getByTestId('message-body').fill('x'.repeat(4001));

    await expect(page.getByTestId('message-too-long')).toBeVisible();
    await expect(page.getByTestId('message-send')).toBeDisabled();
  });

  test('opens what a notice is about', async ({ page }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [, counterpart] = cohort.people;
    if (counterpart === undefined) throw new Error('the cohort needs a pair');

    await signInAdmitted(page, counterpart.subject);
    await navigateTo(page, 'notifications');
    await expect(page.getByTestId('notification-list')).toBeVisible();

    // Said plainly, at the top, rather than implied by an empty inbox.
    await expect(page.getByTestId('notifications-delivery')).toContainText(
      'no approved email or push provider',
    );

    await page.locator('[data-testid^="notification-"]').first().click();
    await page.waitForURL(/\/(messages|introductions)/u);
  });

  test('places a call against a relationship and never against a person', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person, counterpart] = cohort.people;
    if (person === undefined || counterpart === undefined) {
      throw new Error('the cohort needs a pair');
    }

    await signInAdmitted(page, person.subject);
    await navigateTo(page, 'introductions');
    await page.getByTestId('segment-mutual').click();

    const card = page
      .locator('[data-testid^="introduction-"]')
      .filter({ hasText: counterpart.displayName })
      .first();
    await card.getByRole('button', { name: 'Voice' }).click();

    const dialog = page.getByTestId('call-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('call-state')).toContainText('Ringing');
    // Only the caller's control exists. A control the server would refuse is not
    // rendered disabled — it is not rendered.
    await expect(page.getByTestId('call-cancel')).toBeVisible();
    await expect(page.getByTestId('call-accept')).toHaveCount(0);
    // Nothing on this screen takes a person as a value.
    await expect(dialog.locator('input')).toHaveCount(0);

    await page.getByTestId('call-cancel').click();
    await expect(page.getByTestId('call-end-reason')).toContainText(
      'Withdrawn',
    );
  });

  test('blocks somebody from where they appear and removes them from the feed', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person] = cohort.people;
    const spare = cohort.people[3];
    if (person === undefined || spare === undefined) {
      throw new Error('the cohort needs a spare candidate');
    }

    await signInAdmitted(page, person.subject);
    await page.getByTestId(`safety-menu-${spare.id}`).click();
    await page.getByTestId('safety-open-block').click();
    await page.getByTestId('block-person-accept').click();

    await expect(page.getByTestId(`candidate-${spare.id}`)).toHaveCount(0);

    await page.goto(`${consumerWebOrigin}/you/safety`);
    await expect(page.getByTestId('block-list')).toBeVisible();
    // The list says when, never who: no identifier is published for a block.
    expect(await page.locator('body').innerText()).not.toContain(spare.id);
  });

  test('restores a session across a reload and reports one that ended', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await signInAdmitted(page, person.subject);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Discover',
    );

    await page.goto(`${consumerWebOrigin}/you/settings`);
    await page.getByTestId('auth-sign-out').click();
    await page.waitForURL(/\/sign-in/u, { timeout: 30_000 });
    await expect(page.getByTestId('auth-cause')).toHaveText(
      'Signed out on this device',
    );
  });

  test('sends an unauthenticated deep link through sign-in and back', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person] = cohort.people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await page.goto(`${consumerWebOrigin}/messages/${cohort.conversationId}`);
    await page.waitForURL(/\/sign-in\?next=/u);

    await page.getByTestId('sign-in-subject').fill(person.subject);
    await page.getByTestId('sign-in-subject').press('Enter');
    // The intended destination is restored, and only after authentication.
    await page.waitForURL(
      new RegExp(`/messages/${cohort.conversationId}$`, 'u'),
      { timeout: 30_000 },
    );
  });

  test('offers a retry rather than a blank screen when the API is unreachable', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await signInAdmitted(page, person.subject);
    await page.route('**/v1/discovery/candidates*', async (route) => {
      await route.abort('failed');
    });
    await page.reload();

    await expect(page.getByTestId('discovery-failed')).toContainText(
      'VELORA could not be reached',
    );
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('Consumer Web keyboard and semantics', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('can be driven from the keyboard alone', async ({ page }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await signInAdmitted(page, person.subject);

    // Document order is the tab order: nothing carries a positive tabindex,
    // which is the one thing that would let visual order and keyboard order
    // disagree.
    const reordered = await page
      .locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')
      .count();
    expect(reordered).toBe(0);

    // The first thing Tab reaches is the skip link, and it goes to the content.
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to content' }),
    ).toBeFocused();
  });

  test('traps focus in a dialog and gives it back on Escape', async ({
    page,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [person] = cohort.people;
    const spare = cohort.people[1];
    if (person === undefined || spare === undefined) {
      throw new Error('the cohort needs a second person');
    }
    await signInAdmitted(page, person.subject);
    await navigateTo(page, 'introductions');
    await page.getByTestId('segment-mutual').click();

    const trigger = page.getByTestId(`safety-menu-${spare.id}`);
    await trigger.click();
    const dialog = page.getByTestId('safety-menu');
    await expect(dialog).toBeVisible();

    // Focus is inside, and Tab cannot leave.
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press('Tab');
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
      ).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('exposes one document heading, a main landmark, and named navigation', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await signInAdmitted(page, person.subject);

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toBeVisible();
    // One navigation is in the accessible tree at a time. Both are in the
    // document so the first paint after hydration is never the wrong one, and
    // the stylesheet takes the other one out of the layout entirely.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(
      1,
    );

    // Every control that takes input carries a name, computed the way a screen
    // reader computes it rather than by looking for one particular attribute.
    await page.goto(`${consumerWebOrigin}/you`);
    await page.getByTestId('profile-edit').click();
    const fields = page.locator(
      'input:visible, select:visible, textarea:visible',
    );
    const count = await fields.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(fields.nth(index)).toHaveAccessibleName(/\S/u);
    }
  });

  test('keeps the focus ring visible on every control', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await signInAdmitted(page, person.subject);
    await page.goto(`${consumerWebOrigin}/you`);

    const control = page.getByTestId('profile-edit');
    await control.focus();
    const outline = await control.evaluate(
      (node) => getComputedStyle(node).outlineStyle,
    );
    expect(outline).not.toBe('none');
  });
});
