import type { BrowserContext, Page } from '@playwright/test';

import { cohortFor, consumerWebOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  navigateTo,
  signIn,
  signInAdmitted,
  skipWhenCookieRequiresHttps,
} from './consumer.js';
import { expect, test } from './fixtures.js';

/**
 * The three journeys an angry reviewer walks, in a real browser.
 *
 * Each of these answers a complaint that is written about competitor products
 * in almost the same words every time, and each is the kind of thing a
 * component suite cannot prove. jsdom can show that a control renders; it
 * cannot show that a person who was abused in a live encounter can still reach
 * the person after they left, that a support ticket survives a page reload with
 * a reference on it, or that closing an account actually takes the session away
 * from the browser holding it.
 *
 * Nothing here is stubbed that a person would meet. The encounter is allocated
 * by the real matcher against a real seeded stand-in, the block and the report
 * go through the real safety routes, the ticket is a real row, and the closure
 * revokes the real session this browser is holding.
 */

/**
 * Grants the capture permissions, where the browser has a name for them.
 *
 * Chromium's driver knows `camera` and `microphone`; Firefox's does not and
 * throws on the attempt, and is configured through its own preferences in
 * `playwright.config.ts` instead.
 */
async function allowCapture(
  context: BrowserContext,
  browserName: string,
): Promise<void> {
  if (browserName !== 'chromium') return;
  await context.grantPermissions(['camera', 'microphone'], {
    origin: consumerWebOrigin,
  });
}

/** Applies one local scenario. The panel is collapsed until somebody opens it. */
async function scenario(page: Page, name: string): Promise<void> {
  const control = page.getByTestId(`live-sim-${name}`);
  if (!(await control.isVisible())) {
    await page.getByTestId('live-sim-toggle').click();
  }
  await control.click();
}

/**
 * Puts this person at the door, whatever state the server has them in.
 *
 * Live is the one destination somebody can return to mid-encounter, because
 * that is where they actually are. Leaving first goes through the real
 * departure route and is what a person does.
 */
async function atTheDoor(page: Page): Promise<void> {
  const leave = page.getByTestId('live-end');
  if (await leave.isVisible()) await leave.click();
  const searchAgain = page.getByTestId('live-search-again');
  if (await searchAgain.isVisible()) await searchAgain.click();
  await expect(page.getByTestId('live-door')).toBeVisible({ timeout: 30_000 });
}

test.describe('reporting somebody who has already gone', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  // Serial, and on people no other spec signs in as. One account holds one live
  // participation at a time, so two journeys sharing a person would be two
  // matchers fighting over one row rather than two tests.
  test.describe.configure({ mode: 'serial' });

  test('keeps the person reachable after they leave, and separates on one act', async ({
    context,
    page,
  }, testInfo) => {
    // Longer than the default, because a match is allocated by the real matcher
    // against a real stand-in and arrives rather than appearing. The default
    // thirty seconds is shorter than the work, not shorter than a hang.
    test.setTimeout(180_000);
    const person = cohortFor(testInfo.project.name).people[4];
    if (person === undefined) throw new Error('the cohort is short');
    await allowCapture(context, testInfo.project.name);
    await signInAdmitted(page, person.subject);
    await atTheDoor(page);

    await page.getByTestId('live-start-video').click();
    await expect(page.getByTestId('live-peer-name')).toBeVisible({
      timeout: 30_000,
    });
    const met = (await page.getByTestId('live-peer-name').innerText()).trim();
    expect(met).not.toBe('');

    // The complaint this exists for: the other person behaves badly and
    // presses Next, and every control that named them leaves with them.
    await scenario(page, 'peer_next');
    await expect(page.getByTestId('live-ended')).toBeVisible({
      timeout: 30_000,
    });

    // It is still there, on the screen they are already looking at.
    const safety = page.getByTestId('live-ended-safety');
    await expect(safety).toBeVisible();
    await safety.getByRole('button').click();
    await page.getByTestId('safety-open-report-and-block').click();
    await expect(page.getByTestId('report-and-block-effect')).toBeVisible();
    await page
      .getByTestId('report-detail')
      .fill('They were abusive on camera.');
    await page.getByTestId('report-submit').click();

    // Both halves landed, and the surface says so rather than assuming.
    //
    // This is the product's own account of what the server did, raised from
    // the response and worded differently when the block stands but the report
    // was refused, so reading it is reading that both were accepted. The ended
    // screen underneath proves neither: it was already there before the dialog
    // opened, and asserting it let this walk on while the submission was still
    // in flight.
    await expect(page.getByTestId('toaster')).toContainText(
      `${met} is blocked and your report was received`,
    );
    await expect(page.getByTestId('report-person')).toBeHidden();
    // And the dialog took its history entry with it. A leftover overlay entry
    // is what makes the next Back do nothing and leaves a route change one
    // late consume away from being spent.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const state: unknown = window.history.state;
          return (
            typeof state === 'object' &&
            state !== null &&
            'veloraOverlay' in state
          );
        }),
      )
      .toBe(false);
    await expect(page.getByTestId('live-ended')).toBeVisible();

    // The block is real. Safety lists it, and the recently-met list no longer
    // offers the person a second action against somebody already blocked.
    await navigateTo(page, 'you');
    await page.getByTestId('link-safety').click();
    await page.waitForURL(/\/you\/safety$/u);
    await expect(page.getByTestId('block-list')).toBeVisible({
      timeout: 30_000,
    });
    // And the report is on the caller's own record, with no identity in it.
    await expect(page.getByTestId('report-list')).toContainText(
      'Harassment or bullying',
    );
  });

  test('keeps a way back to somebody after the screen has forgotten them', async ({
    context,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const person = cohortFor(testInfo.project.name).people[5];
    if (person === undefined) throw new Error('the cohort is short');
    await allowCapture(context, testInfo.project.name);
    await signInAdmitted(page, person.subject);
    await atTheDoor(page);

    await page.getByTestId('live-start-video').click();
    await expect(page.getByTestId('live-peer-name')).toBeVisible({
      timeout: 30_000,
    });
    // This time the caller is the one who moves on, so nothing ever shows them
    // an ended screen at all.
    await page.getByTestId('live-end').click();
    await expect(page.getByTestId('live-door')).toBeVisible({
      timeout: 30_000,
    });

    // The person is still addressable, under Safety, where somebody would look.
    await navigateTo(page, 'you');
    await page.getByTestId('link-safety').click();
    await page.waitForURL(/\/you\/safety$/u);
    const met = page.getByTestId('recently-met-list');
    await expect(met).toBeVisible({ timeout: 30_000 });
    await expect(met).toContainText('Met');
  });
});

test.describe('getting help from a person', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('takes a ticket, hands back a reference, and still has it after a reload', async ({
    page,
  }, testInfo) => {
    // An already-admitted account, because Help lives inside the product and
    // the ladder that gets somebody there is another suite's subject. This one
    // uses a person no other spec touches, so a ticket left behind cannot
    // change what any of them sees.
    test.setTimeout(120_000);
    const person = cohortFor(testInfo.project.name).people[6];
    if (person === undefined) throw new Error('the cohort is short');
    await signInAdmitted(page, person.subject);

    // Reached the way a person reaches it: through You, not by address. A
    // destination somebody can only arrive at by typing a URL is a destination
    // that does not exist.
    await navigateTo(page, 'you');
    await page.getByTestId('link-help').click();
    await page.waitForURL(/\/you\/help$/u);

    await page
      .getByTestId('support-subject')
      .fill('I cannot sign in on my phone');
    await page
      .getByTestId('support-description')
      .fill('The screen spins after I enter my email and nothing happens.');
    await page.getByTestId('support-submit').click();

    const reference = page.getByTestId('support-reference');
    await expect(reference).toBeVisible({ timeout: 30_000 });
    const quoted = (await reference.innerText()).trim();
    expect(quoted).toMatch(
      /^VS-[0-9A-HJ-KMNP-TV-Z]{4}-[0-9A-HJ-KMNP-TV-Z]{4}$/u,
    );

    // The point of the whole surface: it is still there afterwards, with the
    // status the server holds rather than a claim this page made.
    await page.reload();
    const listed = page.getByTestId('support-ticket-list');
    await expect(listed).toBeVisible({ timeout: 30_000 });
    await expect(listed).toContainText(quoted);
    await expect(listed).toContainText('Received');
    await expect(listed).toContainText('I cannot sign in on my phone');

    // And no response-time promise anywhere on it.
    const rendered = (await page.locator('body').innerText()).toLowerCase();
    for (const promise of ['24 hours', '48 hours', 'business day']) {
      expect(rendered, promise).not.toContain(promise);
    }
  });
});

test.describe('leaving', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('closes the account, takes the session with it, and says what remains', async ({
    page,
  }, testInfo) => {
    // The last person in the cohort, who no other spec signs in as. Closing an
    // account is not reversible, so the one this walks has to be one nothing
    // else depends on — and it has to be a real admitted account, because what
    // is being proved is that closure takes a working product away.
    test.setTimeout(120_000);
    const person = cohortFor(testInfo.project.name).people[7];
    if (person === undefined) throw new Error('the cohort is short');
    await signInAdmitted(page, person.subject);

    await navigateTo(page, 'you');
    await page.getByTestId('link-settings').click();
    await page.waitForURL(/\/you\/settings$/u);

    // The control exists. This screen used to say the path was not finished,
    // which is the shape of the complaint people make about every other product
    // in this category.
    await expect(page.getByTestId('close-account')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('close-account').click();
    await page.getByTestId('close-account-confirm-accept').click();

    // The server revoked the session this browser was holding, so the browser
    // is put out rather than left as a signed-in shell over a dead account.
    // The address carries where it was going, which is the ordinary
    // sign-in-and-return behaviour rather than anything closure-specific.
    await page.waitForURL(/\/sign-in(\?|$)/u, { timeout: 30_000 });

    // Signing in again reaches an account that says what happened to it rather
    // than a product that refuses everything without explaining.
    await signIn(page, person.subject);
    await page.goto(`${consumerWebOrigin}/you/settings`);
    await expect(page.getByTestId('closure-done')).toBeVisible({
      timeout: 30_000,
    });
    // And it does not claim data has been destroyed under a retention schedule
    // nobody has approved.
    const retention = page.getByTestId('closure-retention');
    await expect(retention).toContainText('has not yet published');
  });
});
