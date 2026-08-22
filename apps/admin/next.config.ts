import type { NextConfig } from 'next';

// Security headers are set by `middleware.ts` at request time; see
// `browserSecurityHeaders` in @velora/config/client.
const config: NextConfig = {
  // `next dev` otherwise writes an AGENTS.md and CLAUDE.md into this directory
  // on every start. The repository's implementation authority is the root
  // AGENTS.md, and a vendor-generated per-app copy appearing in the working
  // tree after any local run is a stray file the hygiene and secret scans then
  // have to reason about.
  agentRules: false,
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
