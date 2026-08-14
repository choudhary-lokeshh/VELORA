import { authApiBaseUrl, consumerWebOrigin } from './auth-environment.js';
import { expect, test } from './fixtures.js';

/**
 * Consumer Web AUTH in a real browser. This is the only place that proves the
 * cookie a browser actually accepts, the credentialed cross-origin request it
 * actually sends, and the state the surface actually shows.
 */

const sessionCookieName = '__Host-velora_consumer_web_session';
const csrfCookieName = '__Host-velora_consumer_web_csrf';

function uniqueSubject(scope: string): string {
  return `e2e-${scope}-${String(Date.now())}-${String(
    Math.floor(Math.random() * 1_000_000),
  )}@velora.test`;
}

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

/**
 * WebKit will not store a `Secure` cookie delivered over plain-HTTP loopback,
 * where Chromium and Firefox both do. That is measured, not assumed: the local
 * API answers WebKit with `201` and both `Set-Cookie` headers, and the cookie
 * jar stays empty. The cookie attributes are locked by ADR-0017 and are not
 * relaxed to make a local browser cooperate, so every assertion that depends on
 * the browser holding a session runs where a browser will hold one. WebKit still
 * runs the transport, security-header, and surface-isolation assertions below
 * and in the sibling specs, and it can now reach the local API at all, which it
 * could not before `upgrade-insecure-requests` was scoped to deployed
 * environments.
 */
const skipWhenCookieRequiresHttps = (browserName: string) =>
  browserName === 'webkit';
const cookieSkipReason =
  'WebKit does not store Secure cookies delivered over plain-HTTP loopback';

test.describe('Consumer Web session lifecycle', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );

  test('signs in, restores across reloads, and signs out', async ({ page }) => {
    await page.goto(consumerWebOrigin);
    await expect(page.getByTestId('auth-status')).toHaveText('Signed out');
    await expect(page.getByTestId('auth-cause')).toHaveText(
      'No active session',
    );

    await page.getByLabel('Development identity').fill(uniqueSubject('web'));
    await page.getByTestId('auth-sign-in').click();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed in');
    await expect(page.getByTestId('auth-audience')).toHaveText('consumer_web');
    await expect(page.getByTestId('auth-assurance')).toHaveText(
      'single_factor',
    );

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

    // A reload has no client state at all, so an authenticated result proves the
    // cookie alone restored the session.
    await page.reload();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed in');

    await page.getByTestId('auth-sign-out').click();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed out');
    await expect(page.getByTestId('auth-cause')).toHaveText(
      'Signed out on this device',
    );

    await page.reload();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed out');
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
        await page.goto(consumerWebOrigin);
        // Submitted from the field rather than by clicking the button. These
        // two pages are driven within a few hundred milliseconds of being
        // created, and Firefox drops a synthesised mouse click aimed at a
        // control the page has only just painted: the event reaches no
        // listener at all, so nothing submits and the surface honestly stays
        // signed out. Enter goes to the focused field instead of to a
        // coordinate, and submits the same form through the same handler. The
        // pointer path is covered by the sign-in assertions above and below.
        await page.getByLabel('Development identity').fill(subject);
        await page.getByLabel('Development identity').press('Enter');
        await expect(page.getByTestId('auth-status')).toHaveText('Signed in');
      }

      const closer = await first.newPage();
      await closer.goto(consumerWebOrigin);
      await expect(closer.getByTestId('auth-status')).toHaveText('Signed in');
      await closer.getByTestId('auth-sign-out-everywhere').click();
      await expect(closer.getByTestId('auth-status')).toHaveText('Signed out');

      const other = await second.newPage();
      await other.goto(consumerWebOrigin);
      await expect(other.getByTestId('auth-status')).toHaveText('Signed out');
      await expect(other.getByTestId('auth-cause')).toHaveText(
        'No active session',
      );
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  test('reports a session that ended behind the browser back', async ({
    page,
    request,
  }) => {
    const subject = uniqueSubject('revoked');
    await page.goto(consumerWebOrigin);
    await page.getByLabel('Development identity').fill(subject);
    await page.getByTestId('auth-sign-in').click();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed in');

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

    await page.getByTestId('auth-refresh').click();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed out');
    await expect(page.getByTestId('auth-cause')).toHaveText(
      'Session ended. Sign in again.',
    );
  });

  test('never exposes a session token to page scripts', async ({ page }) => {
    await page.goto(consumerWebOrigin);
    await page.getByLabel('Development identity').fill(uniqueSubject('script'));
    await page.getByTestId('auth-sign-in').click();
    await expect(page.getByTestId('auth-status')).toHaveText('Signed in');

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
