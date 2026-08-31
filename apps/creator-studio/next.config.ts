import type { NextConfig } from 'next';

// Security headers are set by `middleware.ts` at request time; see
// `browserSecurityHeaders` in @velora/config/client.

/**
 * `next dev` refuses a development request whose `Host` it was not told about.
 *
 * Local development can serve this surface at its own hostname behind a TLS
 * proxy, and the hostnames come from the command that starts that topology
 * rather than being restated in each of the three surfaces — one list, not
 * four. Unset means loopback development, which needs no allowance, and no
 * production build reads this at all.
 */
const developmentOrigins = (process.env.VELORA_DEV_ORIGIN_HOSTS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const config: NextConfig = {
  // `next dev` otherwise writes an AGENTS.md and CLAUDE.md into this directory
  // on every start. The repository's implementation authority is the root
  // AGENTS.md, and a vendor-generated per-app copy appearing in the working
  // tree after any local run is a stray file the hygiene and secret scans then
  // have to reason about.
  agentRules: false,
  ...(developmentOrigins.length === 0
    ? {}
    : { allowedDevOrigins: developmentOrigins }),
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
