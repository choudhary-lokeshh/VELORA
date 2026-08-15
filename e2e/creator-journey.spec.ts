import { consumerWebOrigin, creatorStudioOrigin } from './auth-environment.js';
import type { Page } from '@playwright/test';

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

const skipWhenCookieRequiresHttps = (browserName: string) =>
  browserName === 'webkit';
const cookieSkipReason =
  'WebKit does not store Secure cookies delivered over plain-HTTP loopback';

function uniqueSubject(scope: string): string {
  return `e2e-${scope}-${String(Date.now())}-${String(
    Math.floor(Math.random() * 1_000_000),
  )}@velora.test`;
}

/** A handle nobody else in this run will claim. */
function uniqueHandle(scope: string): string {
  return `e2e-${scope}-${String(Date.now() % 100_000_000)}`.toLowerCase();
}

/**
 * Signs in on a surface by submitting the identity field.
 *
 * Enter rather than a click, for the reason recorded in `consumer-auth.spec.ts`:
 * Firefox drops a synthesised mouse click aimed at a control the page has only
 * just painted, and this journey drives a page within a few hundred
 * milliseconds of opening it. Enter goes to the focused field and submits the
 * same form through the same handler.
 */
async function signIn(page: Page, subject: string): Promise<void> {
  await page.getByLabel('Development identity').fill(subject);
  await page.getByLabel('Development identity').press('Enter');
  await expect(page.getByTestId('auth-status')).toHaveText('Signed in');
}

/** Declares adult status on Consumer Web, which is where that decision lives. */
async function declareAdult(page: Page, subject: string): Promise<void> {
  await page.goto(consumerWebOrigin);
  await signIn(page, subject);
  await page.getByTestId('create-account').click();
  await expect(page.getByTestId('journey-stage')).toHaveText(
    'Confirm you are an adult',
  );
  await page.getByTestId('declare-adult').click();
  await expect(page.getByTestId('journey-stage')).toHaveText(
    'Accept the policies',
  );
}

/** Takes a signed-in Studio session all the way to an active capability. */
async function activateCreator(page: Page, subject: string): Promise<void> {
  await page.goto(creatorStudioOrigin);
  await signIn(page, subject);
  await expect(page.getByTestId('creator-onboard')).toBeVisible();
  await page.getByTestId('creator-onboard').click();
  await expect(page.getByTestId('creator-stage')).toHaveText(
    'Accept the creator policies',
  );
  await page.getByTestId('creator-accept-policies').click();
  await expect(page.getByTestId('creator-standing')).toHaveText(
    'Creator access active',
  );
}

test.describe('Creator Studio journey', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('carries one person from adult declaration to a public creator page', async ({
    page,
  }) => {
    const subject = uniqueSubject('creator');
    const handle = uniqueHandle('c');

    await declareAdult(page, subject);
    await activateCreator(page, subject);

    // Creator access is a capability on the same person, not a second account:
    // the Studio session was established by signing in with the same identity.
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('creator-handle').fill(handle);
    await page.getByTestId('creator-display-name').fill('Ember Vale');
    await page.getByTestId('creator-bio').fill('Ceramics, slowly.');
    await page.getByTestId('creator-save-profile').click();
    await expect(page.getByTestId('creator-publication')).toHaveText(
      'Draft. Only you can see this.',
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

      await page.getByTestId('creator-toggle-publication').click();
      await expect(page.getByTestId('creator-publication')).toHaveText(
        'Published. Anyone with the link can see this.',
      );

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

  test('publishes an item and a club, and shows both to a visitor', async ({
    page,
  }) => {
    const subject = uniqueSubject('publish');
    const handle = uniqueHandle('p');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('creator-handle').fill(handle);
    await page.getByTestId('creator-display-name').fill('Ember Vale');
    await page.getByTestId('creator-save-profile').click();
    await page.getByTestId('creator-toggle-publication').click();
    await expect(page.getByTestId('creator-publication')).toHaveText(
      'Published. Anyone with the link can see this.',
    );

    await page.getByTestId('nav-catalog').click();
    await page.getByTestId('content-title').fill('A first post');
    await page.getByTestId('content-summary').fill('Short form.');
    await page.getByTestId('content-create').click();
    // The row for the item is the authoritative signal that the server
    // answered; the list element exists while the read is still in flight.
    const item = page.locator('[data-testid^="content-item-"]').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText('Draft. Only you can see this.');
    await item.getByRole('button', { name: 'Publish' }).click();
    await expect(item).toContainText('Published.');

    await page.getByTestId('nav-clubs').click();
    await page.getByTestId('club-name').fill('Inner Circle');
    await page.getByTestId('club-slug').fill('inner');
    await page.getByTestId('club-description').fill('A quiet room.');
    await page.getByTestId('club-create').click();
    const club = page.locator('[data-testid^="club-item-"]').first();
    await expect(club).toContainText('Draft. Nobody can see this');
    await club.getByRole('button', { name: 'Publish' }).click();
    await expect(club).toContainText('Published. Visible on your public page.');
    await expect(club).toContainText('0 members');

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

  test('shows an invitation once and says it cannot be shown again', async ({
    page,
  }) => {
    const subject = uniqueSubject('invite');
    const handle = uniqueHandle('i');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('creator-handle').fill(handle);
    await page.getByTestId('creator-display-name').fill('Ember Vale');
    await page.getByTestId('creator-save-profile').click();

    await page.getByTestId('nav-clubs').click();
    await page.getByTestId('club-name').fill('Inner Circle');
    await page.getByTestId('club-slug').fill('inner');
    await page.getByTestId('club-create').click();
    const club = page.locator('[data-testid^="club-item-"]').first();
    await club.getByRole('button', { name: 'Publish' }).click();
    await expect(club).toContainText('Published.');

    await club
      .getByRole('button', { name: 'Create a complimentary invitation' })
      .click();
    const shown = page.getByTestId('club-invite-secret');
    await expect(shown).toContainText('shown once');
    await expect(shown).toContainText('cannot be shown again');

    // The listing of invitations never carries the secret.
    await club.getByRole('button', { name: 'Manage access' }).click();
    const secret = (await shown.locator('code').innerText()).trim();
    const panel = page.locator('[data-testid^="club-access-panel-"]').first();
    await expect(panel).toBeVisible();
    expect(await panel.innerText()).not.toContain(secret);
  });

  test('refuses a stale edit rather than overwriting a newer one', async ({
    page,
  }) => {
    const subject = uniqueSubject('stale');
    const handle = uniqueHandle('s');

    await declareAdult(page, subject);
    await activateCreator(page, subject);
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('creator-handle').fill(handle);
    await page.getByTestId('creator-display-name').fill('First');
    await page.getByTestId('creator-save-profile').click();
    await expect(page.getByTestId('creator-handle-fixed')).toHaveText(handle);

    // A second tab, holding the version the first one has already replaced.
    const second = await page.context().newPage();
    await second.goto(creatorStudioOrigin);
    await expect(second.getByTestId('auth-status')).toHaveText('Signed in');
    await second.getByTestId('nav-profile').click();
    await expect(second.getByTestId('creator-handle-fixed')).toHaveText(handle);

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
    await page.goto(creatorStudioOrigin);
    await signIn(page, subject);
    await expect(page.getByTestId('creator-onboard')).toBeVisible();

    // Every API call fails from here. The surface has to say so and offer a
    // way forward rather than spinning.
    await page.route('**/v1/creator/**', async (route) => route.abort());
    await page.reload();

    const failure = page.getByTestId('creator-status-failed');
    await expect(failure).toContainText('could not be reached');
    await expect(
      failure.getByRole('button', { name: 'Try again' }),
    ).toBeVisible();
  });

  test('can be driven from the keyboard alone', async ({ page }) => {
    const subject = uniqueSubject('keyboard');
    await declareAdult(page, subject);
    await page.goto(creatorStudioOrigin);
    await signIn(page, subject);

    const onboard = page.getByTestId('creator-onboard');
    await expect(onboard).toBeVisible();
    await onboard.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('creator-accept-policies')).toBeVisible();

    await page.getByTestId('creator-accept-policies').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('creator-standing')).toHaveText(
      'Creator access active',
    );

    // The area navigation is reachable and operable the same way.
    await page.getByTestId('nav-catalog').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('content-title')).toBeVisible();
  });

  test('exposes one document heading and named landmarks', async ({ page }) => {
    const subject = uniqueSubject('landmarks');
    await declareAdult(page, subject);
    await activateCreator(page, subject);

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(
      page.getByRole('navigation', { name: 'Creator Studio areas' }),
    ).toHaveCount(1);
  });
});
