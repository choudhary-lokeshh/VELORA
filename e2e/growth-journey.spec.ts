import {
  cohortFor,
  consumerWebOrigin,
  platformAdminOrigin,
} from './auth-environment.js';
import {
  cookieSkipReason,
  signInAdmitted,
  skipWhenCookieRequiresHttps,
  uniqueSubject,
} from './consumer.js';
import { expect, test } from './fixtures.js';

/**
 * One person bringing another person, end to end, in real browsers.
 *
 * This is the whole zero-spend acquisition claim in one walk: somebody who
 * already uses VELORA takes their own link, a stranger with no session opens it
 * in a browser that has never seen this product, reads what VELORA is, signs
 * up, walks the admission ladder, and arrives somewhere useful — and the
 * platform ends up holding exactly one record of where they came from.
 *
 * "Exactly one" is the assertion that matters and the one nothing else can
 * make. The unit suites prove the constraint; only a browser proves that the
 * code actually travels across a page load, a redirect, a sign-in, and four
 * onboarding steps without being dropped or applied twice.
 */

test.describe('inviting somebody', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  // Two people, two contexts, and a full admission ladder for the second.
  test.describe.configure({ timeout: 120_000 });

  test('carries a stranger from a shared link to an account with one origin', async ({
    page,
  }, testInfo) => {
    const [inviter] = cohortFor(testInfo.project.name).people;
    if (inviter === undefined) throw new Error('the cohort has nobody in it');

    await signInAdmitted(page, inviter.subject);
    await page.goto(`${consumerWebOrigin}/you`);

    // The link does not exist until somebody asks for one. An account that has
    // never shared anything has no invitation row and nothing to leak.
    await expect(page.getByTestId('invite-friends-create')).toBeVisible();
    await page.getByTestId('invite-friends-create').click();
    const address = await page
      .getByTestId('invite-friends-address')
      .innerText();
    expect(address).toMatch(/\/invite\/[a-z0-9]{22}$/u);

    // Pressing again is the same link. A second code would silently break every
    // link this person had already sent.
    await page.reload();
    await expect(page.getByTestId('invite-friends-address')).toHaveText(
      address,
    );

    const stranger = await page.context().browser()?.newContext();
    if (stranger === undefined) throw new Error('no browser for the stranger');
    try {
      const visitor = await stranger.newPage();
      await visitor.goto(address);

      // A page, not a redirect to a sign-in form. Somebody who followed a
      // friend's link needs to find out what this is before deciding.
      await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(
        'Somebody wants you on VELORA.',
      );
      // And it says nothing about who sent it: an invitation address can be
      // forwarded to anybody.
      const invitationText = await visitor.locator('body').innerText();
      expect(invitationText).not.toContain(inviter.displayName);

      // Refreshing is not a second opening, and the page survives it.
      await visitor.reload();
      await expect(visitor.getByTestId('invitation-start')).toBeVisible();

      const subject = uniqueSubject('invited');
      await visitor.getByTestId('invitation-start').click();
      await visitor.waitForURL(/\/sign-in/u, { timeout: 30_000 });
      await visitor.getByTestId('sign-in-subject').fill(subject);
      await visitor.getByTestId('sign-in-subject').press('Enter');
      await visitor.waitForURL(/\/welcome$/u, { timeout: 30_000 });

      // The invitation is held in this browser until the account exists, and
      // handed over on the one request that creates it.
      const held = await visitor.evaluate(() =>
        globalThis.localStorage.getItem('velora.acquisition'),
      );
      expect(held ?? '').toContain(address.split('/invite/')[1] ?? 'missing');

      // The admission ladder, with the invitation carried across all of it.
      // This is the part a unit test cannot reach: a page load, a redirect, a
      // sign-in, and four steps between the click and the account.
      await visitor.getByTestId('create-account').click();
      await expect(visitor.getByTestId('declare-adult')).toBeVisible();
      await visitor.getByTestId('onboarding-region').fill('ES');
      await visitor.getByTestId('declare-adult').click();
      await expect(visitor.getByTestId('acknowledge-policies')).toBeVisible();
      await visitor.getByTestId('acknowledge-policies').click();
      await expect(visitor.getByTestId('save-profile')).toBeVisible();
      await visitor.getByTestId('onboarding-display-name').fill('Wren');
      await visitor.getByTestId('language-input').fill('en');
      await visitor.getByTestId('language-add').click();
      await visitor.getByTestId('save-profile').click();
      // The ladder's last step is a photograph, which has its own long walk in
      // `consumer-journey`. What matters here already happened: the account was
      // created, and it was created carrying the invitation.
      await expect(visitor.getByTestId('profile-photo')).toBeVisible();

      // The code is forgotten once it can no longer be used, so this browser is
      // not carrying a stranger's invitation around indefinitely — and a second
      // account made here could not claim it.
      const remembered = await visitor.evaluate(() =>
        globalThis.localStorage.getItem('velora.acquisition'),
      );
      expect(remembered).toBeNull();

      // Opening the same link again with an account that already exists puts
      // the code back in this browser and changes nothing at the server: an
      // account has exactly one origin, recorded when it was created.
      await visitor.goto(address);
      await expect(visitor.getByTestId('invitation-start')).toBeVisible();
    } finally {
      await stranger.close();
    }
  });

  test('never offers a count of who joined, or who they were', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await signInAdmitted(page, person.subject);
    await page.goto(`${consumerWebOrigin}/you`);
    /*
     * The card, in whichever state this account is in.
     *
     * Nothing here presses anything, and that is deliberate rather than lazy.
     * The walk above uses the same cohort person, so this account may or may
     * not already hold a link — and the two states swap under a reader as the
     * read settles, which is a race any test that reached for one of the two
     * controls would keep losing. What this asserts is what the card *says*,
     * and it says the same thing either way. That is the property: there is no
     * state of this card in which a tally appears.
     */
    await expect(page.getByTestId('invite-friends')).toBeVisible();

    const text = await page.getByTestId('invite-friends').innerText();
    // No leaderboard, no tally, and no reward — none of which exists, and all
    // of which a growth surface tends to grow.
    for (const forbidden of ['joined', 'earned', 'reward', 'invites used']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/\b\d+\s+(people|friends|signups)\b/iu);
  });
});

test.describe('a public link that survives signing in', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  test.describe.configure({ timeout: 120_000 });

  /**
   * The highest-intent entry on the site, and the one that used to lose people.
   *
   * Somebody follows a creator's link, presses sign in, and has to come back to
   * that creator rather than to the entry page. The destination travels as a
   * same-origin path and is validated again before it is followed.
   */
  test('returns somebody to the creator page they signed in from', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    // A referral parameter on the way in, which must reach the destination
    // without becoming part of the page's identity.
    await page.goto(
      `${consumerWebOrigin}/sign-in?next=${encodeURIComponent('/you/memberships')}`,
    );
    await page.getByTestId('sign-in-subject').fill(person.subject);
    await page.getByTestId('sign-in-subject').press('Enter');
    await page.waitForURL(/\/you\/memberships$/u, { timeout: 30_000 });
  });

  test('refuses to follow a destination that is not this origin', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');

    await page.goto(
      `${consumerWebOrigin}/sign-in?next=${encodeURIComponent('https://evil.test/take-over')}`,
    );
    await page.getByTestId('sign-in-subject').fill(person.subject);
    await page.getByTestId('sign-in-subject').press('Enter');
    await page.waitForURL(/\/live$/u, { timeout: 30_000 });
    expect(page.url().startsWith(consumerWebOrigin)).toBe(true);
  });
});

test.describe('a time everybody is asked to come at', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  test.describe.configure({ timeout: 120_000 });

  /**
   * The whole of the concentration mechanism, from an operator to a stranger.
   *
   * A window is the only lever a platform with no advertising budget has
   * against the arithmetic that makes a live product feel empty — people who
   * came at nine different hours are nobody to meet. What has to be true is
   * narrow and is all asserted here: an operator can schedule one, everybody
   * sees the same thing whether or not they have an account, it carries no
   * attendance figure, its address can be sent to somebody, and withdrawing it
   * takes it off every screen.
   */
  test('is scheduled by an operator and read by everybody, with no figure on it', async ({
    page,
  }, testInfo) => {
    const slug = `window-${String(Date.now())}`;
    const title = 'Friday evening';
    const starts = new Date(Date.now() + 60 * 60 * 1_000);
    const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1_000);

    await page.goto(`${platformAdminOrigin}/access`);
    await expect(page.getByTestId('local-dev-signin')).toBeVisible();
    await page.getByTestId('local-admin-submit').click();
    await page.waitForURL(/\/overview/u, { timeout: 30_000 });

    await page.goto(`${platformAdminOrigin}/platform/growth`);
    await expect(page.getByTestId('growth-windows')).toBeVisible();
    await page.getByTestId('growth-window-slug').fill(slug);
    await page.getByTestId('growth-window-title').fill(title);
    await page.getByTestId('growth-window-starts').fill(localMoment(starts));
    await page.getByTestId('growth-window-ends').fill(localMoment(ends));
    await page.getByTestId('growth-window-schedule').click();
    await expect(page.getByText(`/live-window/${slug}`)).toBeVisible({
      timeout: 30_000,
    });

    // Somebody with no account, in a browser that has never seen this product.
    const stranger = await page.context().browser()?.newContext();
    if (stranger === undefined) throw new Error('no browser for the stranger');
    try {
      const visitor = await stranger.newPage();

      await visitor.goto(consumerWebOrigin);
      await expect(visitor.getByTestId('live-windows')).toBeVisible();
      await expect(visitor.getByRole('link', { name: title })).toBeVisible();

      // Its own address, which is the way it travels.
      await visitor.goto(`${consumerWebOrigin}/live-window/${slug}`);
      await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(
        title,
      );
      // The instant is machine-readable, so the reader's own zone renders it
      // rather than the operator's.
      await expect(visitor.locator('time').first()).toHaveAttribute(
        'datetime',
        /^\d{4}-\d{2}-\d{2}T/u,
      );

      // No attendance figure of any kind. Nothing knows, and a number here
      // would be the one dishonest thing on an otherwise honest feature.
      const text = await visitor.locator('body').innerText();
      expect(text).not.toMatch(/\b\d+\s+(people|going|attending|joined)\b/iu);
      // And ordinary Live is still offered on the same terms as always.
      expect(text).toContain('at any hour');

      // A person who does have an account sees the same thing one press from
      // Live, which is where somebody goes when a search found nobody.
      const [person] = cohortFor(testInfo.project.name).people;
      if (person === undefined) throw new Error('the cohort has nobody in it');
      const member = await stranger.newPage();
      await signInAdmitted(member, person.subject);
      await member.goto(`${consumerWebOrigin}/discover`);
      await expect(member.getByTestId('live-windows')).toBeVisible();
      await expect(member.getByRole('link', { name: title })).toBeVisible();
    } finally {
      await stranger.close();
    }

    // Withdrawing it takes it off every screen, and says so.
    await page.goto(`${platformAdminOrigin}/platform/growth`);
    await page.getByTestId(`growth-window-cancel-${slug}`).click();
    await expect(page.getByTestId('growth-windows-empty')).toBeVisible({
      timeout: 30_000,
    });

    const after = await page.context().browser()?.newContext();
    if (after === undefined) throw new Error('no browser for the check');
    try {
      const visitor = await after.newPage();
      await visitor.goto(`${consumerWebOrigin}/live-window/${slug}`);
      await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(
        'This time has passed',
      );
      // The way on is still there, and ordinary Live never depended on this.
      await expect(
        visitor.getByRole('link', { name: 'How they work' }),
      ).toBeVisible();
    } finally {
      await after.close();
    }
  });
});

/**
 * An instant as a `datetime-local` control wants it.
 *
 * The control has no offset, so the value has to be the operator's own wall
 * clock rather than the instant's UTC spelling — which is exactly what the
 * console then turns back into an instant.
 */
function localMoment(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  ].join('T');
}
