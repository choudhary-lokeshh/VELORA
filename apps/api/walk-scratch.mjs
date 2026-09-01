import { chromium } from '@playwright/test';

const web = 'http://127.0.0.1:3000';
const shots = process.argv[2] ?? '.';

const browser = await chromium.launch();

async function open(subject) {
  const context = await browser.newContext({
    viewport: { height: 900, width: 1280 },
  });
  const page = await context.newPage();
  await page.goto(`${web}/sign-in`);
  await page.getByTestId('sign-in-subject').fill(subject);
  await page.getByTestId('auth-sign-in').click();
  await page.waitForURL(/\/live$/u, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.getByTestId('nav-you').click();
  await page.waitForURL(/\/you$/u);
  await page.getByTestId('link-wallet').click();
  await page.waitForURL(/\/you\/wallet$/u);
  await page.waitForTimeout(1800);
  return page;
}
const shot = async (page, name) =>
  page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

// Ireland: a country the local commerce authority has not approved.
const gated = await open('person-05@velora.seed');
await shot(gated, '50-wallet-gated');

// Spain: approved, so the packs are buyable.
const buyer = await open('person-02@velora.seed');
await shot(buyer, '51-wallet-buyable');
await buyer.getByTestId('wallet-buy-100').click();
await buyer.waitForTimeout(3000);
await shot(buyer, '52-provider-page');
const settle = buyer.getByRole('button').first();
if (await settle.isVisible()) {
  await settle.click();
  await buyer.waitForTimeout(4000);
}
await shot(buyer, '53-after-payment');
await browser.close();
console.log('walked');
