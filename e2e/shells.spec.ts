import { expect, test } from './fixtures.js';

/**
 * Surface isolation.
 *
 * Consumer Web now carries the consumer product; Creator Studio and Platform
 * Admin are still bootstrap shells, and `AGENTS.md` forbids consumer
 * functionality appearing in either. These assertions are about which surface
 * is which, not about what any of them can do.
 */

const foundationShells = [
  { heading: 'Creator Studio', url: 'http://127.0.0.1:3001' },
  { heading: 'Platform Admin', url: 'http://127.0.0.1:3002' },
] as const;

for (const shell of foundationShells) {
  test(`${shell.heading} remains an isolated neutral shell`, async ({
    page,
  }) => {
    await page.goto(shell.url);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      shell.heading,
    );
    await expect(page.getByText(/Foundation shell/)).toBeVisible();
    // No consumer product reaches these surfaces.
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });
}

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
