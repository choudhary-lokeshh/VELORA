import { defineConfig, devices } from '@playwright/test';

import {
  authApiBaseUrl,
  consumerWebOrigin,
  consumerWebPort,
  creatorStudioPort,
  platformAdminPort,
  surfaceRealtimeEndpoint,
} from './e2e/auth-environment.js';

// The Next.js surfaces read their API endpoint from the server environment at
// request time, so one build artifact serves every environment. `VELORA_APP_ENV`
// is what allows a loopback endpoint at all.
const surfaceEnvironment = {
  VELORA_API_BASE_URL: authApiBaseUrl,
  VELORA_APP_ENV: 'local',
  VELORA_BIND_HOST: '127.0.0.1',
  // Blank unless a real provider is configured for this run, which leaves the
  // policy exactly what it was. When one is, the socket has to be named here or
  // the browser refuses it after the person has already granted a camera.
  VELORA_REALTIME_ENDPOINT: surfaceRealtimeEndpoint,
  // The origin Consumer Web is actually answering at in this run, so a
  // canonical address and a social preview can be asserted against the address
  // the browser fetched rather than against whatever port `.env` names. It
  // makes nothing indexable: that needs a production environment, and
  // `VELORA_APP_ENV` above says this is not one.
  VELORA_WEB_PUBLIC_ORIGIN: consumerWebOrigin,
};

export default defineConfig({
  fullyParallel: true,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          /*
           * A camera, without hardware.
           *
           * Live discovery opens `getUserMedia`, and a headless browser on a
           * build machine has no device to open. These are Chromium's own
           * switches for exactly that: a synthetic capture device, and a
           * standing answer to the prompt that nobody is there to give. Both
           * are needed — with the device switch alone this Chromium answers
           * `NotSupportedError`, which was measured rather than assumed.
           *
           * They change nothing about what the product does. The surface still
           * asks at the moment it should and still has to bind what it is
           * handed; what they remove is a dialog no automation can answer. The
           * refusal paths are proved in the component suite, where a refusal
           * can be produced on demand.
           */
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.permission.disabled': true,
            'media.navigator.streams.fake': true,
          },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  reporter: 'list',
  testDir: './e2e',
  // Two browser journeys can each fan out several API reads while the real
  // worker is polling. Keeping this below the API's eight-unit database
  // admission ceiling proves the product instead of intentionally eliciting
  // capacity 503s from unrelated journeys running beside it.
  workers: 2,
  use: {
    trace: 'retain-on-failure',
  },
  // The ports come from `auth-environment`, which defaults them to the ones
  // every other part of the repository uses and lets a run move aside when a
  // machine already has something on 3000. `PORT` is passed rather than baked
  // into each surface's own script, so the server and the address the suite
  // visits cannot disagree.
  webServer: [
    {
      command: 'pnpm --filter @velora/web start',
      env: { ...surfaceEnvironment, PORT: String(consumerWebPort) },
      reuseExistingServer: !process.env.CI,
      url: `http://127.0.0.1:${String(consumerWebPort)}`,
    },
    {
      command: 'pnpm --filter @velora/creator-studio start',
      env: { ...surfaceEnvironment, PORT: String(creatorStudioPort) },
      reuseExistingServer: !process.env.CI,
      url: `http://127.0.0.1:${String(creatorStudioPort)}`,
    },
    {
      command: 'pnpm --filter @velora/admin start',
      env: { ...surfaceEnvironment, PORT: String(platformAdminPort) },
      reuseExistingServer: !process.env.CI,
      url: `http://127.0.0.1:${String(platformAdminPort)}`,
    },
  ],
});
