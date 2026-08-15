import { expect, test } from './fixtures.js';

/**
 * Surface isolation.
 *
 * Consumer Web carries the consumer product, Creator Studio the creator one,
 * and Platform Admin the operator one. `AGENTS.md` forbids consumer
 * functionality appearing in Studio or Admin, and creator functionality
 * appearing in the consumer product. These assertions are about which surface
 * is which, not about what any of them can do.
 */

test('Platform Admin carries the operator product and nothing else', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3002');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Platform Admin',
  );
  // The one operator surface: financial operations, and it reads. With no API
  // reachable from the browser here the panel reports that rather than
  // rendering an empty screen, which is itself the property under test.
  await expect(
    page.getByRole('heading', { name: 'Financial operations' }),
  ).toBeVisible();
  // No consumer or creator product reaches this surface, and nothing on it
  // writes: an operator's one financial action goes through BILLING's service.
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.locator('input')).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
  for (const forbidden of ['Discovery', 'Creator access', 'Public profile']) {
    await expect(page.getByText(forbidden)).toHaveCount(0);
  }
});

test('Creator Studio carries the creator product and nothing consumer', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3001');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Creator Studio',
  );
  await expect(page.getByRole('heading', { name: 'Session' })).toBeVisible();
  // Consumer discovery, introductions, and messaging never appear here, and
  // neither does anything privileged.
  for (const forbidden of [
    'Discovery',
    'Introductions',
    'Conversations',
    'Platform Admin',
    'Moderation',
  ]) {
    await expect(page.getByText(forbidden)).toHaveCount(0);
  }
});

test('Consumer Web carries the consumer product and nothing privileged', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3000');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Consumer');
  await expect(page.getByRole('heading', { name: 'Session' })).toBeVisible();
  for (const forbidden of ['Creator Studio', 'Platform Admin', 'Moderation']) {
    await expect(page.getByText(forbidden)).toHaveCount(0);
  }
});

/**
 * The public creator address exists and is honest about an unknown handle.
 *
 * It is asserted here rather than in a creator journey because this is a
 * property of the surface itself: `/c/{handle}` is reachable with no session at
 * all, and an address nobody holds must say nothing beyond that there is
 * nothing to show.
 */
test('an unknown public creator address says only that there is nothing there', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3000/c/nobody-here');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'This page is not available',
  );
  const body = await page.locator('body').innerText();
  for (const forbidden of ['draft', 'suspended', 'unpublished']) {
    expect(body.toLowerCase()).not.toContain(forbidden);
  }
});
