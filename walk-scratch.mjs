import { chromium } from '@playwright/test';

const web = 'http://127.0.0.1:3000';
const shots = process.argv[2] ?? '.';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { height: 900, width: 1280 } });
const page = await context.newPage();
const shot = async (name) =>
  page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

// person-05 is seeded with less than one preference costs.
await page.goto(`${web}/sign-in`);
await page.getByTestId('sign-in-subject').fill('person-05@velora.seed');
await page.getByTestId('auth-sign-in').click();
await page.waitForURL(/\/live$/u, { timeout: 30_000 });
await page.waitForTimeout(1500);
await page.getByLabel(/^Women/u).click();
await page.waitForTimeout(500);
await shot('40-insufficient');

// Buying a pack, through ordinary checkout against a platform-owned offer.
await page.getByTestId('live-premium-get').click();
await page.waitForURL(/\/you\/wallet$/u);
await page.waitForTimeout(1500);
await shot('41-wallet-short');
await page.getByTestId('wallet-buy-100').click();
await page.waitForTimeout(2500);
await shot('42-provider-page');

// The local provider's own page. Pressing its button delivers a signed event.
const settle = page.getByRole('button', { name: /succe|pay|confirm/iu }).first();
if (await settle.isVisible()) {
  await settle.click();
  await page.waitForTimeout(3000);
}
await shot('43-after-payment');
await browser.close();
console.log('walked');
