import type { Page } from '@playwright/test';

import { consumerWebOrigin } from './auth-environment.js';
import { expect } from './fixtures.js';

/**
 * The moves every Consumer Web browser test makes.
 *
 * Each one goes through the surface the way a person does — an address, a
 * field, a control — rather than through an injected state, so a test that
 * passes is evidence the product works rather than evidence the harness does.
 */

/**
 * WebKit will not store a `Secure` cookie delivered over plain-HTTP loopback,
 * where Chromium and Firefox both do. The cookie attributes are locked by
 * ADR-0017 and are not relaxed to make a local browser cooperate, so every
 * assertion that needs the browser to hold a session runs where a browser will
 * hold one. WebKit still runs the transport, security-header, and
 * surface-isolation assertions.
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

/** Signs in and waits for wherever the server's admission ladder puts them. */
export async function signIn(page: Page, subject: string): Promise<void> {
  await page.goto(`${consumerWebOrigin}/sign-in`);
  await page.getByTestId('sign-in-subject').fill(subject);
  // Submitted from the field rather than by clicking the button. A page driven
  // within a few hundred milliseconds of being created can drop a synthesised
  // click aimed at a control it has only just painted; Enter goes to the focused
  // field and submits the same form through the same handler.
  await page.getByTestId('sign-in-subject').press('Enter');
  await page.waitForURL(/\/(discover|welcome)$/u, { timeout: 30_000 });
}

/** Signs in an account the fixtures already admitted, landing in discovery. */
export async function signInAdmitted(
  page: Page,
  subject: string,
): Promise<void> {
  await signIn(page, subject);
  await page.waitForURL(/\/discover$/u, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Discover');
}

/** Moves to a destination through the navigation rather than the address bar. */
export async function navigateTo(
  page: Page,
  destination:
    'discover' | 'introductions' | 'messages' | 'notifications' | 'you',
): Promise<void> {
  const viewport = page.viewportSize();
  const compact = (viewport?.width ?? 1280) < 768;
  await page
    .getByTestId(compact ? `tab-${destination}` : `nav-${destination}`)
    .click();
  await page.waitForURL(new RegExp(`/${destination}$`, 'u'));
}

/**
 * A real photograph, small enough that a browser suite can afford one.
 *
 * Generated rather than committed: a binary fixture in the repository is one
 * more thing nobody can read in a diff, and the platform decides what an image
 * is from its bytes, so the bytes have to be a real encode rather than a header
 * with nothing behind it. Large enough that every derivative the platform makes
 * is an actual resize.
 */
export async function fixturePhoto(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({
    create: {
      background: { b: 82, g: 44, r: 60 },
      channels: 3,
      height: 600,
      width: 480,
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}
