import { authApiBaseUrl, consumerWebOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  signIn,
  skipWhenCookieRequiresHttps,
  uniqueSubject,
} from './consumer.js';
import { expect, test } from './fixtures.js';

/**
 * Consumer Web AUTH in a real browser. This is the only place that proves the
 * cookie a browser actually accepts, the credentialed cross-origin request it
 * actually sends, and the state the surface actually shows.
 */

const sessionCookieName = '__Host-velora_consumer_web_session';
const csrfCookieName = '__Host-velora_consumer_web_csrf';

function cookieHeaderFor(response: {
  headersArray(): { name: string; value: string }[];
}): string {
  // An API request context does not resend a `Secure` cookie to an `http://`
  // loopback URL, so the cookie is carried explicitly.
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value.split(';')[0])
    .join('; ');
}

test.describe('Consumer Web session lifecycle', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('signs in, restores across reloads, and signs out', async ({ page }) => {
    await page.goto(`${consumerWebOrigin}/sign-in`);
    // No form until the session check has answered: the page is deliverable
    // before anybody knows whose it is.
    await expect(page.getByTestId('sign-in-subject')).toBeVisible();

    await signIn(page, uniqueSubject('web'));
    // A brand-new identity has no consumer account yet, so the server's own
    // admission ladder is where a session lands.
    await expect(page).toHaveURL(/\/welcome$/u);

    // Cookies are read unfiltered: a `Secure` cookie is not reported for an
    // `http://` URL filter even though loopback is a trustworthy origin, and the
    // point of this assertion is what the browser actually stored.
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === sessionCookieName);
    expect(
      session,
      'the browser accepted the __Host- session cookie',
    ).toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.secure).toBe(true);
    expect(session?.path).toBe('/');
    expect(session?.sameSite).toBe('Lax');

    const csrf = cookies.find((cookie) => cookie.name === csrfCookieName);
    expect(csrf?.httpOnly).toBe(false);

    // A reload has no client state at all, so staying on the ladder proves the
    // cookie alone restored the session.
    await page.reload();
    await expect(page).toHaveURL(/\/welcome$/u);

    await page.getByTestId('auth-sign-out').click();
    await page.waitForURL(/\/sign-in/u, { timeout: 30_000 });
    await expect(page.getByTestId('auth-cause')).toHaveText(
      'Signed out on this device',
    );

    // And it stays gone: a reload with no cookie cannot restore anything.
    await page.goto(`${consumerWebOrigin}/welcome`);
    await page.waitForURL(/\/sign-in/u, { timeout: 30_000 });
  });

  test('ends every session for the account on global sign-out', async ({
    browser,
  }) => {
    const subject = uniqueSubject('global');
    // Two devices, named as such: AUTH counts attempts per requester, and two
    // browser profiles sharing one bucket would be measuring the limiter.
    const first = await browser.newContext({
      extraHTTPHeaders: { 'x-velora-device': `${subject}-first` },
    });
    const second = await browser.newContext({
      extraHTTPHeaders: { 'x-velora-device': `${subject}-second` },
    });
    try {
      for (const context of [first, second]) {
        const page = await context.newPage();
        await page.goto(`${consumerWebOrigin}/sign-in`);
        // Submitted from the field rather than by clicking the button. These
        // two pages are driven within a few hundred milliseconds of being
        // created, and Firefox drops a synthesised mouse click aimed at a
        // control the page has only just painted: the event reaches no
        // listener at all, so nothing submits and the surface honestly stays
        // signed out. Enter goes to the focused field instead of to a
        // coordinate, and submits the same form through the same handler. The
        // pointer path is covered by the sign-in assertions above and below.
        await page.getByTestId('sign-in-subject').fill(subject);
        await page.getByTestId('sign-in-subject').press('Enter');
        await page.waitForURL(/\/welcome$/u, { timeout: 30_000 });
      }

      const closer = await first.newPage();
      await closer.goto(`${consumerWebOrigin}/welcome`);
      await expect(
        closer.getByTestId('auth-sign-out-everywhere'),
      ).toBeVisible();
      await closer.getByTestId('auth-sign-out-everywhere').click();
      await closer.waitForURL(/\/sign-in/u, { timeout: 30_000 });

      const other = await second.newPage();
      await other.goto(`${consumerWebOrigin}/welcome`);
      await other.waitForURL(/\/sign-in/u, { timeout: 30_000 });
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  test('reports a session that ended behind the browser back', async ({
    page,
    request,
  }) => {
    const subject = uniqueSubject('revoked');
    await signIn(page, subject);

    // Sign the same identity in from an unrelated client and revoke everything.
    const created = await request.post(
      `${authApiBaseUrl}/v1/auth/local/web-sessions`,
      {
        data: { audience: 'consumer_web', subject },
        headers: { origin: consumerWebOrigin },
      },
    );
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { csrfToken: string };
    const revoked = await request.post(`${authApiBaseUrl}/v1/auth/logout-all`, {
      headers: {
        cookie: cookieHeaderFor(created),
        origin: consumerWebOrigin,
        'x-velora-csrf': body.csrfToken,
      },
    });
    expect(revoked.status()).toBe(200);

    // Coming back to the tab is what makes it ask again, and this time fail.
    // A reload would prove less: a page that has just loaded has no memory of
    // having held a session, so the honest thing it could say is only that there
    // is not one now. Within a tab's life the surface knows the difference.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForURL(/\/sign-in/u, { timeout: 30_000 });
    await expect(page.getByTestId('auth-cause')).toHaveText(
      'Session ended. Sign in again.',
    );
  });

  test('never exposes a session token to page scripts', async ({ page }) => {
    await signIn(page, uniqueSubject('script'));

    const readable = await page.evaluate(() => document.cookie);
    expect(readable).not.toContain(sessionCookieName);
    expect(readable).toContain(csrfCookieName);
  });
});

test.describe('Consumer Web AUTH transport hardening', () => {
  test('refuses a credentialed request from a foreign origin', async ({
    request,
  }) => {
    const response = await request.post(
      `${authApiBaseUrl}/v1/auth/local/web-sessions`,
      {
        data: { audience: 'consumer_web', subject: uniqueSubject('origin') },
        headers: { origin: 'https://evil.test' },
      },
    );
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'AUTH_ORIGIN_REJECTED',
    });
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('refuses a state-changing cookie request with no CSRF evidence', async ({
    browserName,
    request,
  }) => {
    test.skip(skipWhenCookieRequiresHttps(browserName), cookieSkipReason);
    const created = await request.post(
      `${authApiBaseUrl}/v1/auth/local/web-sessions`,
      {
        data: { audience: 'consumer_web', subject: uniqueSubject('csrf') },
        headers: { origin: consumerWebOrigin },
      },
    );
    expect(created.status()).toBe(201);

    const refused = await request.post(`${authApiBaseUrl}/v1/auth/logout-all`, {
      headers: { cookie: cookieHeaderFor(created), origin: consumerWebOrigin },
    });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'AUTH_CSRF_REQUIRED' });
  });
});
