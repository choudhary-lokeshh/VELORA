import {
  consumerWebOrigin,
  creatorStudioOrigin,
  platformAdminOrigin,
} from './auth-environment.js';
import { expect, test } from './fixtures.js';

// The application layer owns these headers until a deployment edge exists.
// ADR-0014 leaves the CDN/DNS vendor deferred, so nothing in front of Next.js
// can set them today.
const surfaces = [
  {
    name: 'Consumer Web',
    referrerPolicy: 'same-origin',
    url: consumerWebOrigin,
  },
  {
    name: 'Creator Studio',
    referrerPolicy: 'same-origin',
    url: creatorStudioOrigin,
  },
  {
    name: 'Platform Admin',
    referrerPolicy: 'no-referrer',
    url: platformAdminOrigin,
  },
] as const;

const requiredCspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "connect-src 'self'",
];

for (const surface of surfaces) {
  test(`${surface.name} serves the baseline security headers`, async ({
    request,
  }) => {
    const response = await request.get(surface.url);
    expect(response.status()).toBe(200);
    const headers = response.headers();

    const csp = headers['content-security-policy'];
    expect(csp, 'Content-Security-Policy must be present').toBeTruthy();
    for (const directive of requiredCspDirectives) {
      expect(csp).toContain(directive);
    }
    // A nonce-based policy is deferred, but script execution must still be
    // origin-bound rather than open to arbitrary hosts.
    expect(csp).toContain("script-src 'self'");
    // The harness runs local surfaces against a plain-HTTP loopback API, the one
    // combination where `upgrade-insecure-requests` is omitted. Every deployed
    // combination is asserted in the @velora/config unit tests, which is where
    // the directive is decided.
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('*');
    expect(csp).not.toContain("'unsafe-eval'");

    expect(headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe(surface.referrerPolicy);
    // Capture is opt-in per surface. Consumer Web opens a camera for live
    // discovery and says so on this origin only; the two operator surfaces have
    // no reason to and stay unable to. Geolocation is refused everywhere,
    // because nothing in this product asks for a location.
    expect(headers['permissions-policy']).toBe(
      surface.name === 'Consumer Web'
        ? 'camera=(self), geolocation=(), microphone=(self)'
        : 'camera=(), geolocation=(), microphone=()',
    );
    expect(headers['x-powered-by']).toBeUndefined();
  });
}

test('Platform Admin is never weaker than Consumer Web', async ({
  request,
}) => {
  const [consumer, admin] = await Promise.all([
    request.get(consumerWebOrigin),
    request.get(platformAdminOrigin),
  ]);

  expect(admin.headers()['content-security-policy']).toBe(
    consumer.headers()['content-security-policy'],
  );
  expect(admin.headers()['strict-transport-security']).toBe(
    consumer.headers()['strict-transport-security'],
  );
  /*
   * Admin refuses indexing unconditionally and permanently; Consumer Web
   * refuses it in this environment.
   *
   * Both carry a directive now, and the assertion is the one the test is named
   * for: whatever Consumer Web says, Admin says at least as much. Admin adds
   * `noarchive` on top, which is the difference that matters — an operations
   * console must not be kept in a cache even by something that ignored the
   * rest.
   *
   * Consumer Web's directive is a property of *this* environment rather than of
   * the surface: `VELORA_APP_ENV` is `local` here, and nothing outside
   * production with a declared public origin may be indexed. The production
   * shape — where the public pages carry `index, follow` and every private one
   * still carries `noindex` — is asserted in `e2e/seo.spec.ts` and in
   * `apps/web/test/seo.test.ts`, which can set an environment this suite cannot.
   */
  expect(admin.headers()['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  expect(consumer.headers()['x-robots-tag']).toBe('noindex, nofollow');
});
