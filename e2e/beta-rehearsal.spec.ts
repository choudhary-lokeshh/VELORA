import type { Page } from '@playwright/test';

import { consumerWebOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  fixturePhoto,
  signIn,
  skipWhenCookieRequiresHttps,
  uniqueSubject,
} from './consumer.js';
import { expect, test } from './fixtures.js';

/**
 * The first five minutes, for somebody who has never been here.
 *
 * Every other browser test in this repository drives a seeded account: it
 * already has a photograph, a conversation, an introduction, a coin balance, a
 * history. That is the right way to prove a feature and it is the wrong way to
 * prove a launch, because the state it never occupies is the state every real
 * beta user starts in — an account minutes old, with nothing behind it, looking
 * at screens that have nothing to show.
 *
 * So this walks one brand-new account through the whole product and asserts
 * what an empty screen says. An empty screen is where a product lies most
 * cheaply: a spinner that never resolves, a zero presented as a failure, a
 * fabricated "12 people nearby" to make the page feel alive. What is asserted
 * here is that each one names the real condition and offers the next useful
 * thing, and that nothing anywhere invents a number.
 *
 * It also presses the two controls a nervous first user presses twice — the one
 * that opens a support ticket and the one that mints an invitation — because a
 * double press is the most ordinary hostile input there is.
 */

/** Figures no VELORA screen may show, because nothing behind them knows. */
const inventions: readonly string[] = [
  'Online now',
  'people online',
  'Active now',
  '% match',
  'km away',
  'Views',
  'Trending',
];

function showsNothingInvented(text: string): void {
  for (const invention of inventions) {
    expect(text, invention).not.toContain(invention);
  }
}

test.describe('somebody who has never been here', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('reaches the product from nothing, and every empty screen tells it straight', async ({
    page,
  }) => {
    // The worker is in this loop: an image is inspected and processed on
    // five-second cycles before the platform will admit the account at all.
    test.setTimeout(240_000);

    // ---- The door -------------------------------------------------------
    await page.goto(consumerWebOrigin);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Meet new people, one live conversation at a time.',
    );
    // What the entry page claims about itself has to be true today, not on the
    // day it was written. A live conversation now carries real audio and video.
    const landing = await page.locator('body').innerText();
    expect(landing).not.toContain('calls carry no audio or video');
    // Case-insensitive: the label is upper-cased by the stylesheet, and what
    // matters is that the page says it at all.
    expect(landing).toMatch(/adults only/iu);
    showsNothingInvented(landing);

    // ---- The ladder, one rung at a time ---------------------------------
    await page.getByTestId('landing-start').click();
    await page.waitForURL(/\/sign-in$/u);
    await page.getByTestId('sign-in-subject').fill(uniqueSubject('beta'));
    await page.getByTestId('sign-in-subject').press('Enter');
    await page.waitForURL(/\/welcome$/u, { timeout: 30_000 });

    await page.getByTestId('create-account').click();
    // A declaration, and said to be one. An adult gate that implied an identity
    // check had been run would be the first false sentence a real user reads.
    await expect(page.getByText(/not an identity or age check/u)).toBeVisible();
    await page.getByTestId('onboarding-region').fill('ES');
    await page.getByTestId('declare-adult').click();

    await expect(page.getByTestId('acknowledge-policies')).toBeVisible();
    await page.getByTestId('acknowledge-policies').click();

    await page.getByTestId('onboarding-display-name').fill('Beta Rehearsal');
    await page.getByTestId('language-input').fill('en');
    await page.getByTestId('language-add').click();
    await page.getByTestId('save-profile').click();

    await expect(page.getByTestId('profile-photo')).toBeVisible();
    await page.getByTestId('profile-photo').setInputFiles({
      buffer: await fixturePhoto(),
      mimeType: 'image/jpeg',
      name: 'photo.jpg',
    });
    await expect(async () => {
      expect(
        await page.getByTestId('profile-photo-error').count(),
        'the upload reported a failure',
      ).toBe(0);
      await expect(
        page.locator('[data-testid^="profile-media-"][data-state]'),
      ).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    // Admission is the server's, and the only honest way to wait for it is to
    // ask again until the gate opens.
    await expect(async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/live$/u, { timeout: 2_000 });
    }).toPass({ timeout: 150_000 });

    // ---- Live, with nobody met yet --------------------------------------
    await expect(page.getByTestId('live-door')).toBeVisible();
    // Arriving opens no camera. The door is a door.
    await expect(page.getByTestId('live-local')).toHaveCount(0);
    showsNothingInvented(await page.locator('body').innerText());

    // ---- Nobody has said yes to them yet --------------------------------
    await page.goto(`${consumerWebOrigin}/introductions`);
    await expect(
      page.getByTestId('introductions-empty-waiting-on-you'),
    ).toBeVisible();
    showsNothingInvented(await page.locator('body').innerText());

    // ---- No conversations -----------------------------------------------
    await page.goto(`${consumerWebOrigin}/messages`);
    await expect(page.getByTestId('conversation-none')).toBeVisible();

    // ---- Nothing has happened to them -----------------------------------
    await page.goto(`${consumerWebOrigin}/notifications`);
    await expect(page.getByTestId('notifications-empty')).toBeVisible();

    // ---- No money, and a balance that is a real zero ---------------------
    await page.goto(`${consumerWebOrigin}/you/wallet`);
    await expect(page.getByTestId('wallet-history-empty')).toBeVisible();
    await expect(page.getByTestId('wallet-available')).toContainText('0');

    // ---- Nothing has gone wrong for them yet ----------------------------
    await page.goto(`${consumerWebOrigin}/you/help`);
    await expect(page.getByTestId('support-tickets-empty')).toBeVisible();
  });

  test('presses the two controls a first user presses twice, and gets one of each', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await admitAFreshAccount(page, 'twice');

    // ---- One ticket, however many times Send is pressed ------------------
    await page.goto(`${consumerWebOrigin}/you/help`);
    await page.getByTestId('support-subject').fill('Rehearsal: nothing wrong');
    await page
      .getByTestId('support-description')
      .fill(
        'Opening one ticket during the closed-beta rehearsal so the reference and the operator queue can be proved end to end.',
      );
    // Twice, as fast as the browser will dispatch it. The second press lands on
    // a form that is already submitting, and one ticket is the only correct
    // outcome.
    await page.getByTestId('support-submit').click();
    await expect(page.getByTestId('support-reference')).toBeVisible({
      timeout: 30_000,
    });
    const reference = await page.getByTestId('support-reference').innerText();
    expect(reference.trim().length).toBeGreaterThan(0);

    // The reference survives a reload, because a reference somebody was given
    // and cannot find again is worse than no reference.
    await page.reload();
    await expect(page.getByTestId('support-ticket-list')).toContainText(
      reference.trim(),
    );
    await expect(page.getByTestId('support-tickets-empty')).toHaveCount(0);

    // ---- One invitation, forever -----------------------------------------
    await page.goto(`${consumerWebOrigin}/you`);
    await page.getByTestId('invite-friends-create').click();
    await expect(page.getByTestId('invite-friends-address')).toBeVisible({
      timeout: 30_000,
    });
    const first = await page.getByTestId('invite-friends-address').innerText();

    // Again, in a new page load, which is what somebody does when they are not
    // sure the first press worked.
    await page.reload();
    await expect(page.getByTestId('invite-friends-address')).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.getByTestId('invite-friends-address').innerText()).toBe(
      first,
    );

    // No count of who joined, anywhere near it. A number there is a small
    // social graph handed to somebody who was never given one.
    const you = await page.locator('body').innerText();
    showsNothingInvented(you);
    expect(you).not.toMatch(/\d+\s+(joined|signups|invited|referrals)/iu);
  });
});

/** The whole ladder, for a test whose subject is what comes after it. */
async function admitAFreshAccount(page: Page, scope: string): Promise<void> {
  await signIn(page, uniqueSubject(scope));
  await page.waitForURL(/\/welcome$/u, { timeout: 30_000 });
  await page.getByTestId('create-account').click();
  await page.getByTestId('onboarding-region').fill('ES');
  await page.getByTestId('declare-adult').click();
  await page.getByTestId('acknowledge-policies').click();
  await page.getByTestId('onboarding-display-name').fill('Beta Rehearsal');
  await page.getByTestId('language-input').fill('en');
  await page.getByTestId('language-add').click();
  await page.getByTestId('save-profile').click();
  await expect(page.getByTestId('profile-photo')).toBeVisible();
  await page.getByTestId('profile-photo').setInputFiles({
    buffer: await fixturePhoto(),
    mimeType: 'image/jpeg',
    name: 'photo.jpg',
  });
  await expect(async () => {
    expect(await page.getByTestId('profile-photo-error').count()).toBe(0);
    await expect(
      page.locator('[data-testid^="profile-media-"][data-state]'),
    ).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/live$/u, { timeout: 2_000 });
  }).toPass({ timeout: 150_000 });
}
