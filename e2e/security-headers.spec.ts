import { expect, test } from '@playwright/test';

// The application layer owns these headers until a deployment edge exists.
// ADR-0014 leaves the CDN/DNS vendor deferred, so nothing in front of Next.js
// can set them today.
const surfaces = [
  {
    name: 'Consumer Web',
    referrerPolicy: 'same-origin',
    url: 'http://127.0.0.1:3000',
  },
  {
    name: 'Creator Studio',
    referrerPolicy: 'same-origin',
    url: 'http://127.0.0.1:3001',
  },
  {
    name: 'Platform Admin',
    referrerPolicy: 'no-referrer',
    url: 'http://127.0.0.1:3002',
  },
] as const;

const requiredCspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "connect-src 'self'",
  'upgrade-insecure-requests',
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
    expect(csp).not.toContain('*');
    expect(csp).not.toContain("'unsafe-eval'");

    expect(headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe(surface.referrerPolicy);
    expect(headers['permissions-policy']).toBe(
      'camera=(), geolocation=(), microphone=()',
    );
    expect(headers['x-powered-by']).toBeUndefined();
  });
}

test('Platform Admin is never weaker than Consumer Web', async ({
  request,
}) => {
  const [consumer, admin] = await Promise.all([
    request.get('http://127.0.0.1:3000'),
    request.get('http://127.0.0.1:3002'),
  ]);

  expect(admin.headers()['content-security-policy']).toBe(
    consumer.headers()['content-security-policy'],
  );
  expect(admin.headers()['strict-transport-security']).toBe(
    consumer.headers()['strict-transport-security'],
  );
  // Admin additionally refuses indexing; consumer surfaces do not.
  expect(admin.headers()['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  expect(consumer.headers()['x-robots-tag']).toBeUndefined();
});
