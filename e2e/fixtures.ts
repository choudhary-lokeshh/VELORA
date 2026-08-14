import {
  test as base,
  type BrowserContext,
  type APIRequestContext,
} from '@playwright/test';

/**
 * Browser tests, each attributed to its own device.
 *
 * AUTH counts authentication attempts per requester, and a caller that sends no
 * `x-velora-device` header falls into one shared bucket. Three browser projects
 * running in parallel would then share one ceiling between them, and the suite
 * would start failing on the limiter rather than on the product — which proves
 * nothing about either.
 *
 * Giving every test its own device is not a weakening. It is what the header is
 * for, it is what three browsers on three machines would look like, and the
 * limit itself is untouched: `consumer-auth.spec.ts` still asserts that the
 * ceiling exists and is enforced.
 *
 * The header is applied to the browser context and to the API request context,
 * because a test uses both and they are attributed separately.
 */
export const test = base.extend<{
  context: BrowserContext;
  request: APIRequestContext;
}>({
  context: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { 'x-velora-device': deviceFor(testInfo) },
    });
    await use(context);
    await context.close();
  },

  request: async ({ playwright }, use, testInfo) => {
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { 'x-velora-device': deviceFor(testInfo) },
    });
    await use(request);
    await request.dispose();
  },
});

function deviceFor(testInfo: {
  readonly project: { readonly name: string };
  readonly testId: string;
}): string {
  return `e2e-${testInfo.project.name}-${testInfo.testId}`;
}

export { expect } from '@playwright/test';
