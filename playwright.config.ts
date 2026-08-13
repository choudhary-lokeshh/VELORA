import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
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
      env: { VELORA_BIND_HOST: '127.0.0.1' },
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:3000',
    },
    {
      command: 'pnpm --filter @velora/creator-studio start',
      env: { VELORA_BIND_HOST: '127.0.0.1' },
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:3001',
    },
    {
      command: 'pnpm --filter @velora/admin start',
      env: { VELORA_BIND_HOST: '127.0.0.1' },
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:3002',
    },
  ],
});
