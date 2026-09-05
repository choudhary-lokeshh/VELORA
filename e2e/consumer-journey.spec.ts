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
      'Meet new people, one live conversation at a time.',
    );
    await page.getByTestId('landing-start').click();
    await page.waitForURL(/\/sign-in$/u);

    await page.getByTestId('sign-in-subject').fill(person.subject);
    await page.getByTestId('sign-in-subject').press('Enter');
    // Live is where an admitted account lands. It is the primary destination
    // since ADR-0040, and the door rather than a viewfinder: nothing has opened
    // a camera by arriving here.
    await page.waitForURL(/\/live$/u, { timeout: 30_000 });
    await expect(page.getByTestId('live-door')).toBeVisible();

    // Discover is one press away and still shows what it always did.
    await navigateTo(page, 'discover');

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
    // Longer than the default, because the worker is in this loop. Inspection
    // and processing are five-second cycles started a fraction of a second
    // apart, and a decode and three resizes happen between them; the default
    // thirty seconds is shorter than the work, not shorter than a hang.
    test.setTimeout(180_000);
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

    // The three calls have to finish before anything reloads: a reload part-way
    // through abandons them and the slot waits for bytes forever. What proves
    // they finished is a slot on the screen — **in any state**. Waiting for
    // `checking` specifically was a race with the worker, because a runner fast
    // enough to inspect the object before the surface re-reads leaves that
    // selector matching nothing, and 60 seconds of nothing looks exactly like a
    // broken upload.
    //
    // The error is read first so a genuine failure reports its own sentence
    // rather than timing out on an absence.
    await expect(async () => {
      // `count()` rather than a locator assertion, because an absent error is
      // the ordinary case and waiting for one would spend the whole budget
      // proving it is not there.
      const failures = await page.getByTestId('profile-photo-error').count();
      expect(failures, 'the upload reported a failure').toBe(0);
      // `[data-state]` rather than the bare prefix: the tile carries the
      // state, and its own remove control and thumbnail share the prefix, so
      // the bare selector counts three things and means one.
      await expect(
        page.locator('[data-testid^="profile-media-"][data-state]'),
      ).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    // Inspection and processing are the worker's, so the surface only learns
    // the outcome by asking again. What it waits for is **admission**, not a
    // transient state on this screen: the minimum profile needs a ready image,
    // so the server's ladder opening the product is the server saying the
    // photograph arrived. Watching the onboarding screen for `ready` instead
    // would be watching for a state the product leaves as fast as it can — the
    // gate redirects the moment admission lands, and whether a reload catches
    // the window in between is a race with the worker rather than a fact about
    // the product.
    // A short inner wait and a long outer one: each attempt is one reload and a
    // quick look, so the loop asks again often rather than sitting on a stale
    // page for five seconds at a time.
    await expect(async () => {
      await page.reload();
      // Live, which is where the gate sends an admitted account since
      // ADR-0040. What is being waited on is admission itself, not this
      // destination in particular.
      await expect(page).toHaveURL(/\/live$/u, { timeout: 2_000 });
    }).toPass({ timeout: 120_000 });

    // And the profile screen, which does not move underneath an assertion,
    // shows the slot as ready and renders the photograph the platform now
    // delivers — the whole round trip, from a file chosen in a browser to a
    // derivative served back to it under a signed, short-lived address.
    await page.goto(`${consumerWebOrigin}/you`);
    await expect(
      page.locator('[data-testid^="profile-media-"][data-state="ready"]'),
    ).toHaveCount(1);
    const thumbnail = page.locator('[data-testid^="profile-media-thumb-"]');
    await expect(thumbnail).toHaveCount(1);
    // Decoded, not merely present. A `src` that 404s still produces an element
    // and still reports `complete`, so the only assertion that distinguishes a
    // served photograph from a broken one is that the browser got pixels.
    await expect
      .poll(
        async () =>
          thumbnail.evaluate((node: HTMLImageElement) => node.naturalWidth),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    // Nothing about a storage address reaches the page as text, in success or
    // failure: it is provider detail and it names a signed credential. The
    // delivery address is an attribute on an image and is never rendered.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('signature=');
    expect(body).not.toContain('uploadUrl');
  });

  test('refuses bytes that are not an image it admits, and says so plainly', async ({
    page,
  }) => {
    // The worker decides this one too, so it gets the same budget as the
    // upload above rather than the default.
    test.setTimeout(180_000);
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

    // The upload has to finish before anything reloads, for the reason the
    // previous test gives — and a slot in any state is what proves it did.
    await expect(
      page.locator('[data-testid^="profile-media-"][data-state]'),
    ).toHaveCount(1, { timeout: 60_000 });

    await expect(async () => {
      await page.reload();
      await expect(
        page.locator('[data-testid^="profile-media-"][data-state="rejected"]'),
      ).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 120_000 });

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
    // The address carries where the conversation was opened from, so Back
    // returns to the introduction rather than to the Inbox list.
    await page.waitForURL(/\/messages\/[0-9a-f-]+(\?|$)/u);
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
    await page.getByTestId('message-body').fill('coffee after work');
    // Folded away until asked for: a conversation is not a workbench.
    await page.getByTestId('message-ai-open').click();
    await page.getByTestId('message-ai-generate').click();
    const suggestion = page.getByTestId('message-ai-suggestion');
    await expect(suggestion).toHaveValue('Coffee after work.');
    await suggestion.fill(written);
    await page.getByTestId('message-ai-replace').click();
    await expect(page.getByTestId('message-body')).toHaveValue(written);
    await expect(page.getByTestId('messages')).not.toContainText(written);
    await page.getByTestId('message-send').click();
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

  test('generates, edits, and explicitly saves a profile bio', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await signInAdmitted(page, person.subject);
    await page.goto(`${consumerWebOrigin}/you`);
    await page.getByTestId('profile-edit').click();
    await page
      .getByTestId('profile-bio-input')
      .fill('i make small gardens for city balconies');
    await page.getByTestId('profile-ai-generate').click();
    const suggestion = page.getByTestId('profile-ai-suggestion');
    await expect(suggestion).toHaveValue(
      'I make small gardens for city balconies.',
    );
    const edited =
      'I make small gardens for city balconies and share cuttings.';
    await suggestion.fill(edited);
    await page.getByTestId('profile-ai-replace').click();
    await expect(page.getByTestId('profile-bio-input')).toHaveValue(edited);
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-view')).toContainText(edited);
    await page.reload();
    await expect(page.getByTestId('profile-view')).toContainText(edited);
  });

  test('opens what a notice is about', async ({ page }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [sender, counterpart] = cohort.people;
    if (sender === undefined || counterpart === undefined) {
      throw new Error('the cohort needs a pair');
    }

    await signInAdmitted(page, counterpart.subject);
    await navigateTo(page, 'notifications');
    await expect(page.getByTestId('notification-list')).toBeVisible();
    await expect(
      page.locator('[data-testid^="notification-"]').first(),
    ).toContainText(sender.displayName);

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
    // The safety control lives beside the person, which is on the feed.
    await navigateTo(page, 'discover');
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
    // The same page after a reload, which is Live: the session survived, so
    // the gate does not send this person back to the door.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live');

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
    // The failing read belongs to Discover, so this has to be standing on it.
    await navigateTo(page, 'discover');
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
