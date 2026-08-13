import { expect, test } from '@playwright/test';

const shells = [
  { heading: 'Consumer Web', url: 'http://127.0.0.1:3000' },
  { heading: 'Creator Studio', url: 'http://127.0.0.1:3001' },
  { heading: 'Platform Admin', url: 'http://127.0.0.1:3002' },
] as const;

for (const shell of shells) {
  test(`${shell.heading} remains an isolated neutral shell`, async ({
    page,
  }) => {
    await page.goto(shell.url);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      shell.heading,
    );
    await expect(page.getByText(/Foundation shell/)).toBeVisible();
  });
}
