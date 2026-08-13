import type { NextConfig } from 'next';

// Security headers are set by `middleware.ts` at request time; see
// `browserSecurityHeaders` in @velora/config/client.
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
