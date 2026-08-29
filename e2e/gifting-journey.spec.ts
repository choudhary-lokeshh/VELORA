import {
  cohortFor,
  consumerWebOrigin,
  creatorStudioOrigin,
} from './auth-environment.js';
import {
  activateCreator,
  claimHandle,
  cookieSkipReason,
  declareAdult,
  provisionGiftCatalog,
  publishPage,
  skipWhenCookieRequiresHttps,
  uniqueHandle,
  uniqueSubject,
} from './creator.js';
import { expect, test } from './fixtures.js';

/**
 * Sending a virtual gift, in a real browser, from both ends.
 *
 * The property nothing else proves is that **a browser can send one at all**.
 * A gift carries `x-velora-idempotency-key`, a custom header makes a
 * cross-origin POST preflighted, and a header missing from the CORS allowlist
 * is not a degraded request — it is a request the browser never sends, which
 * the surface then reports as VELORA being unreachable. That header was absent
 * for exactly as long as nothing here drove the flow: every jsdom suite passed,
 * because a fetch double has no preflight. The unit assertion added afterwards
 * keeps the allowlist honest against the published contract; this keeps the
 * product honest against a browser.
 *
 * The second property is the one gifting is most likely to get wrong: a gift is
 * money that buys **no access**. The confirmation says so, the ledger posts the
 * creator's share, and the creator's own history says who sent it — which is
 * nobody, because sender identity is withheld until somebody decides otherwise.
 *
 * Settlement is the `local-test` adapter's, which configuration refuses in every
 * deployed environment. Nothing here is evidence about a live provider.
 */

test.describe('Sending a virtual gift', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  test.describe.configure({ mode: 'serial' });

  test('carries a gesture from a creator page to a settled ledger share', async ({
    page,
  }, testInfo) => {
    // One test on purpose: a creator being giftable, somebody sending one, and
    // both sides seeing the same settled row are one product claim, and each
    // half alone proves less than the whole.
    test.setTimeout(300_000);
    const creatorSubject = uniqueSubject('giftee');
    const handle = uniqueHandle('g');

    /* ------------------------------ the creator ----------------------- */

    await declareAdult(page, creatorSubject);
    await activateCreator(page, creatorSubject);
    await claimHandle(page, handle, 'Rowan Ash');
    await publishPage(page);
    await provisionGiftCatalog(page);

    // Nothing has been sent, and the surface says exactly that rather than
    // showing an empty table somebody has to interpret.
    await page.goto(`${creatorStudioOrigin}/money/gifts`);
    await expect(page.getByTestId('received-gifts-empty')).toBeVisible({
      timeout: 30_000,
    });

    /* ------------------------------- the sender ----------------------- */

    const [sender] = cohortFor(testInfo.project.name).people;
    if (sender === undefined) throw new Error('the cohort has nobody in it');

    const supporter = await page.context().browser()?.newContext();
    if (supporter === undefined) throw new Error('no browser for the sender');
    try {
      const visitor = await supporter.newPage();
      await visitor.goto(`${consumerWebOrigin}/sign-in`);
      await visitor.getByTestId('sign-in-subject').fill(sender.subject);
      await visitor.getByTestId('sign-in-subject').press('Enter');
      await visitor.waitForURL(/\/discover$/u, { timeout: 30_000 });

      // Reloaded rather than waited on. The catalog is one read, and a read
      // that fails leaves the card offering "Try again" rather than retrying
      // itself — so waiting longer on a page that already answered proves
      // nothing. This is the same move the button is.
      const choice = visitor.locator('[data-testid^="gift-choice-"]').first();
      await expect(async () => {
        await visitor.goto(`${consumerWebOrigin}/c/${handle}`);
        await expect(choice).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 60_000 });
      await choice.click();

      await visitor.getByRole('button', { name: /^Send / }).click();
      // What somebody is agreeing to, before they agree to it: an amount, and
      // the fact that it unlocks nothing.
      await expect(visitor.getByTestId('gift-confirm')).toContainText(
        'unlocks no content',
      );
      await visitor.getByTestId('gift-confirm-accept').click();

      // The preflighted POST completed and the adapter settled it. A gift that
      // had not settled would say so instead, which is the honest answer and
      // not this one.
      await expect(
        visitor.getByText('Gift sent. Thank you for supporting this creator.'),
      ).toBeVisible({
        timeout: 60_000,
      });

      await visitor.goto(`${consumerWebOrigin}/you/gifts`);
      const sentRow = visitor.getByTestId('sent-gifts-list');
      await expect(sentRow).toContainText('Rowan Ash', { timeout: 30_000 });
      // Settled truth, not the optimistic echo of a submitted form: a gift that
      // had only been attempted reads "Sending", and one that failed reads
      // "Failed".
      await expect(sentRow).toContainText('Sent');
    } finally {
      await supporter.close();
    }

    /* ------------------------- and what it earned --------------------- */

    // The creator's side is the ledger's, not the sender's: the gross payment,
    // the share posted to the creator's payable account, and no identity.
    await expect(async () => {
      await page.goto(`${creatorStudioOrigin}/money/gifts`);
      await expect(page.getByTestId('received-gifts-list')).toContainText(
        'Settled',
      );
    }).toPass({ timeout: 60_000 });
    const receivedRow = page.getByTestId('received-gifts-list');
    await expect(receivedRow).toContainText('Your ledger share');
    await expect(receivedRow).toContainText('Sender identity withheld');
  });
});
