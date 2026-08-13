import { defineConfig, devices } from '@playwright/test';

import { authApiBaseUrl } from './e2e/auth-environment.js';

// The Next.js surfaces read their API endpoint from the server environment at
// request time, so one build artifact serves every environment. `VELORA_APP_ENV`
// is what allows a loopback endpoint at all.
const surfaceEnvironment = {
  VELORA_API_BASE_URL: authApiBaseUrl,
  VELORA_APP_ENV: 'local',
  VELORA_BIND_HOST: '127.0.0.1',
};

export default defineConfig({
  fullyParallel: true,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  reporter: 'list',
  testDir: './e2e',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @velora/web start',
      env: surfaceEnvironment,
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:3000',
    },
    {
      command: 'pnpm --filter @velora/creator-studio start',
      env: surfaceEnvironment,
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:3001',
    },
    {
      command: 'pnpm --filter @velora/admin start',
      env: surfaceEnvironment,
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:3002',
    },
  ],
});
