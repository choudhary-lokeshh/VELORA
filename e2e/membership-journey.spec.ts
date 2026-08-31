import {
  cohortFor,
  consumerWebOrigin,
  creatorStudioOrigin,
} from './auth-environment.js';
import {
  activateCreator,
  claimHandle,
  cookieSkipReason,
  createClub,
  declareAdult,
  publishPage,
  skipWhenCookieRequiresHttps,
  uniqueHandle,
  uniqueSubject,
} from './creator.js';
import { expect, test } from './fixtures.js';

/**
 * Buying a membership, in a real browser, from both ends.
 *
 * The property this exists to prove is the one nothing else can: that **access
 * follows a settlement rather than an intention**. A person reaches the club
 * before paying and reads nothing; they pay on the payment provider's own page;
 * they come back and read it. Every step is a navigation and a control, and the
 * only thing that changes what they may read is the signed event the provider
 * delivers in between.
 *
 * The provider's page is the local-test adapter's own, served on the API's
 * origin because that adapter has no origin of its own. It is outside `/v1`,
 * carries no session, and settles nothing by being visited — exactly like the
 * real one it stands in for. Configuration refuses that adapter in every
 * deployed environment, so nothing here is evidence about a live provider.
 */

test.describe('Buying a membership', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  test.describe.configure({ mode: 'serial' });

  test('carries somebody from a price on a page to reading what it admits them to', async ({
    page,
  }, testInfo) => {
    // The whole chain in one test on purpose: a creator publishing, a price
    // going on sale, somebody buying it, and the club opening are one product
    // claim, and splitting them would leave each half proving less than the
    // whole. It is long because it is real.
    test.setTimeout(300_000);
    const creatorSubject = uniqueSubject('seller');
    const handle = uniqueHandle('m');

    /* ------------------------------ the creator ----------------------- */

    await declareAdult(page, creatorSubject);
    await activateCreator(page, creatorSubject);
    await claimHandle(page, handle);
    await publishPage(page);

    // The club comes first. A members-only item with no club has nobody to
    // admit, so the surface will not let one be written before there is one.
    await createClub(page);
    await page.getByTestId('club-publish').click();
    await expect(page.getByTestId('club-lifecycle')).toContainText('Published');

    // What a member is told they get. Presentation, written by the creator,
    // and never a commercial term.
    await page.getByTestId('club-benefit-add').click();
    await page.getByTestId('club-benefit-0').fill('A letter every week');
    await page.getByTestId('club-save').click();
    await expect(page.getByTestId('club-benefit-0')).toHaveValue(
      'A letter every week',
    );

    await page.goto(`${creatorStudioOrigin}/catalog/new`);
    await page.getByTestId('content-title').fill('The first letter');
    await page.getByTestId('content-summary').fill('For members only.');
    await page.getByTestId('content-body').fill('Only members read this.');
    await page.getByTestId('content-audience-members').click();
    await page
      .getByTestId('content-club')
      .selectOption({ label: 'Inner Circle' });
    await page.getByTestId('content-save').click();
    await page.waitForURL(/\/catalog\/[0-9a-f-]+$/u, { timeout: 30_000 });
    await page.getByTestId('content-editor-publish').click();
    await page.waitForURL(/\/catalog$/u, { timeout: 30_000 });

    /* ------------------------------- the price ------------------------ */

    await page.goto(`${creatorStudioOrigin}/money/selling`);
    await page.getByTestId('offer-create-club').selectOption({
      label: 'Inner Circle',
    });
    await page.getByTestId('offer-create-submit').click();
    const offerRow = page.locator('[data-testid^="offer-manage-"]').first();
    await expect(offerRow).toBeVisible({ timeout: 30_000 });
    await offerRow.click();

    const amount = page.locator('[data-testid^="offer-price-amount-"]').first();
    await amount.fill('12.00');
    // The currency is named rather than left to whichever the policy listed
    // first, so the figure this test asserts is the figure it published.
    await page
      .locator('[data-testid^="offer-price-currency-"]')
      .first()
      .selectOption('USD');
    await page.locator('[data-testid^="offer-price-publish-"]').first().click();
    const activate = page.locator('[data-testid^="offer-activate-"]').first();
    await expect(activate).toBeEnabled({ timeout: 30_000 });
    await activate.click();
    await expect(
      page.locator('[data-testid^="offer-retire-"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    /* ------------------------------ the buyer ------------------------- */

    const [buyer] = cohortFor(testInfo.project.name).people;
    if (buyer === undefined) throw new Error('the cohort has nobody in it');

    const shopper = await page.context().browser()?.newContext();
    if (shopper === undefined) throw new Error('no browser for the buyer');
    try {
      /* ------------------ the visitor who is not signed in -------------- */

      // Before the buyer, the stranger. A creator's page is public, so the
      // sign-in control on it is the first step of the purchase for anybody who
      // arrived from the creator's own link -- and it has to come back here,
      // because a stranger dropped on Discover has lost the creator they came
      // for and the product has no way to offer them back.
      //
      // Asserted through the control rather than through an address written
      // here: the parameter carrying the destination had two names for a while,
      // only one of which anything read, and a test naming either would have
      // agreed with whichever half was wrong.
      //
      // Its own context, because signing in is the thing being measured and a
      // session shared with the buyer below would decide the outcome first.
      for (const address of [`/c/${handle}`, `/c/${handle}/club/inner`]) {
        const strangers = await page.context().browser()?.newContext();
        if (strangers === undefined)
          throw new Error('no browser for a visitor');
        try {
          const stranger = await strangers.newPage();
          await stranger.goto(`${consumerWebOrigin}${address}`);
          const control = stranger.locator('a[href^="/sign-in"]').first();
          await expect(control).toBeVisible({ timeout: 30_000 });
          await control.click();
          await stranger.waitForURL(/\/sign-in/u, { timeout: 30_000 });
          await stranger.getByTestId('sign-in-subject').fill(buyer.subject);
          await stranger.getByTestId('sign-in-subject').press('Enter');
          await stranger.waitForURL(
            (url) => !url.pathname.startsWith('/sign-in'),
            { timeout: 30_000 },
          );
          expect(new URL(stranger.url()).pathname).toBe(address);
        } finally {
          await strangers.close();
        }
      }

      const visitor = await shopper.newPage();
      await visitor.goto(`${consumerWebOrigin}/sign-in`);
      await visitor.getByTestId('sign-in-subject').fill(buyer.subject);
      await visitor.getByTestId('sign-in-subject').press('Enter');
      await visitor.waitForURL(/\/discover$/u, { timeout: 30_000 });

      await visitor.goto(`${consumerWebOrigin}/c/${handle}`);
      const card = visitor.getByTestId('creator-public-clubs');
      await expect(card).toContainText('12.00 USD');
      await expect(card).toContainText('A letter every week');

      // Reaching the club before paying. Nothing a member reads is in the
      // answer, so there is nothing to hide and nothing to reveal.
      await visitor.goto(`${consumerWebOrigin}/c/${handle}/club/inner`);
      await expect(visitor.getByTestId('club-locked')).toBeVisible();
      expect(await visitor.locator('body').innerText()).not.toContain(
        'Only members read this.',
      );

      await visitor.getByTestId('club-join').click();
      await visitor.waitForURL(/\/join$/u, { timeout: 30_000 });
      await expect(visitor.getByTestId('join-terms')).toContainText(
        '12.00 USD',
      );
      // The disclosures somebody would otherwise discover afterwards.
      const terms = await visitor.getByTestId('join-disclosures').innerText();
      expect(terms).toContain('never sees a card number');
      expect(terms).toContain('not a refund');

      await visitor.getByTestId('join-confirm').click();
      // The provider's own page, on the provider's own origin.
      //
      await visitor.waitForURL(/\/local-test\/checkout/u, { timeout: 30_000 });
      await visitor.getByRole('button', { name: 'Pay' }).click();

      await visitor.waitForURL(/\/checkout\/return/u, { timeout: 30_000 });
      await expect(visitor.getByTestId('checkout-state')).toContainText(
        'Paid',
        { timeout: 60_000 },
      );

      // The entitlement arrives through the outbox, so the club opens on a
      // later read rather than on the redirect.
      await expect(async () => {
        await visitor.goto(`${consumerWebOrigin}/c/${handle}/club/inner`);
        await expect(visitor.getByTestId('club-feed')).toContainText(
          'Only members read this.',
        );
      }).toPass({ timeout: 60_000 });

      /* --------------------------- and stopping ----------------------- */

      await visitor.goto(`${consumerWebOrigin}/you/memberships`);
      const membership = visitor
        .locator('[data-testid^="membership-cancel-"]')
        .first();
      await expect(membership).toBeVisible({ timeout: 30_000 });
      await membership.click();
      await expect(visitor.locator('body')).toContainText(
        'This is not a refund',
      );
      await visitor.locator('[data-testid$="-accept"]').first().click();

      // Scheduled, not taken: the paid period is still theirs.
      await expect(visitor.getByTestId('paid-memberships')).toContainText(
        'Ends when the period does',
        { timeout: 30_000 },
      );
      await visitor.goto(`${consumerWebOrigin}/c/${handle}/club/inner`);
      await expect(visitor.getByTestId('club-feed')).toContainText(
        'Only members read this.',
      );
    } finally {
      await shopper.close();
    }
  });
});
