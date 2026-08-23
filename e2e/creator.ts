import type { Page } from '@playwright/test';

import { consumerWebOrigin, creatorStudioOrigin } from './auth-environment.js';
import { expect } from './fixtures.js';

/**
 * The moves every Creator Studio browser test makes.
 *
 * Each one goes through the surface the way a creator does — an address, a
 * field, a control — rather than through an injected state, so a test that
 * passes is evidence the product works rather than evidence the harness does.
 */

/**
 * WebKit will not store a `Secure` cookie delivered over plain-HTTP loopback,
 * where Chromium and Firefox both do. The cookie attributes are locked by
 * ADR-0017 and are not relaxed to make a local browser cooperate, so every
 * assertion that needs the browser to hold a session runs where a browser will
 * hold one.
 */
export const skipWhenCookieRequiresHttps = (browserName: string) =>
  browserName === 'webkit';
export const cookieSkipReason =
  'WebKit does not store Secure cookies delivered over plain-HTTP loopback';

export function uniqueSubject(scope: string): string {
  return `e2e-${scope}-${String(Date.now())}-${String(
    Math.floor(Math.random() * 1_000_000),
  )}@velora.test`;
}

/** A handle nobody else in this run will claim. */
export function uniqueHandle(scope: string): string {
  return `e2e-${scope}-${String(Date.now() % 100_000_000)}`.toLowerCase();
}

/**
 * Declares adult status on Consumer Web, which is where that decision lives.
 *
 * Studio cannot make it and does not offer to. The consumer surface has its own
 * address, its own session, and its own admission ladder, which is exactly the
 * separation this step exists to respect.
 */
export async function declareAdult(page: Page, subject: string): Promise<void> {
  await page.goto(`${consumerWebOrigin}/sign-in`);
  await page.getByTestId('sign-in-subject').fill(subject);
  await page.getByTestId('sign-in-subject').press('Enter');
  await page.waitForURL(/\/welcome$/u, { timeout: 30_000 });

  await page.getByTestId('create-account').click();
  await expect(page.getByTestId('declare-adult')).toBeVisible();
  await page.getByTestId('onboarding-region').fill('ES');
  await page.getByTestId('declare-adult').click();
  await expect(page.getByTestId('acknowledge-policies')).toBeVisible();
}

/**
 * Signs in to Studio.
 *
 * Enter rather than a click, for the reason recorded in `consumer.ts`: a page
 * driven within a few hundred milliseconds of being created can drop a
 * synthesised click aimed at a control it has only just painted, and Enter goes
 * to the focused field and submits the same form through the same handler.
 */
export async function signInToStudio(
  page: Page,
  subject: string,
): Promise<void> {
  await page.goto(creatorStudioOrigin);
  await page.waitForURL(/\/sign-in/u, { timeout: 30_000 });
  await page.getByTestId('sign-in-subject').fill(subject);
  await page.getByTestId('sign-in-subject').press('Enter');
}

/** Takes a signed-in Studio session all the way to an active capability. */
export async function activateCreator(
  page: Page,
  subject: string,
): Promise<void> {
  await signInToStudio(page, subject);
  await page.waitForURL(/\/start$/u, { timeout: 30_000 });
  await page.getByTestId('creator-onboard').click();
  await expect(page.getByTestId('creator-outstanding-policies')).toBeVisible();
  await page.getByTestId('creator-accept-policies').click();
  await page.waitForURL(/\/home$/u, { timeout: 30_000 });
}

/** Claims a handle and fills in the public identity. */
export async function claimHandle(
  page: Page,
  handle: string,
  displayName = 'Ember Vale',
): Promise<void> {
  await page.goto(`${creatorStudioOrigin}/profile`);
  await page.getByTestId('creator-handle').fill(handle);
  await page.getByTestId('creator-display-name').fill(displayName);
  await page.getByTestId('creator-save-profile').click();
  await expect(page.getByTestId('creator-handle-fixed')).toContainText(
    `@${handle}`,
  );
}

/** Publishes the public page and waits for the server to say so. */
export async function publishPage(page: Page): Promise<void> {
  await page.getByTestId('creator-toggle-publication').click();
  await expect(page.getByTestId('creator-publication')).toContainText(
    'Published',
  );
}

/** Creates a club and lands on its own address. */
export async function createClub(
  page: Page,
  name = 'Inner Circle',
  slug = 'inner',
): Promise<void> {
  await page.goto(`${creatorStudioOrigin}/clubs`);
  await page.getByTestId('club-new').click();
  await expect(page.getByTestId('club-create-dialog')).toBeVisible();
  await page.getByTestId('club-name').fill(name);
  await page.getByTestId('club-slug').fill(slug);
  await page.getByTestId('club-create').click();
  await page.waitForURL(/\/clubs\/[0-9a-f-]+$/u, { timeout: 30_000 });
}
