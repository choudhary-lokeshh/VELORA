import type { NextConfig } from 'next';

const securityHeaders = [
  // Baseline application-level policy. No deployment edge owns headers yet:
  // ADR-0014 leaves the CDN/DNS vendor deferred, so the application is the only
  // layer that can set them. `script-src 'unsafe-inline'` is required by
  // Next.js hydration payloads; a nonce-based policy needs request-time
  // middleware and is deferred with the edge decision.
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; upgrade-insecure-requests",
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), microphone=()',
  },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
