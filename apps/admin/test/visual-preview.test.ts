import { expect, it } from 'vitest';
import { consolePreviewEnabled } from '../src/design/visual-preview';

it('limits the console review to validated local/test configuration', () => {
  for (const value of ['staging', 'production', 'invalid']) {
    expect(
      consolePreviewEnabled({
        NODE_ENV: 'development',
        VELORA_APP_ENV: value,
        VELORA_API_BASE_URL: 'https://api.example.com',
      }),
    ).toBe(false);
  }
  expect(consolePreviewEnabled({ NODE_ENV: 'production' })).toBe(false);
  // The resolver would infer `local` here; a missing value keeps the baseline.
  expect(consolePreviewEnabled({})).toBe(false);
  expect(consolePreviewEnabled({ NODE_ENV: 'development' })).toBe(false);
  // The browser suite runs a production build declared local; it proves the
  // deployed baseline, so the review stays on the development server.
  expect(
    consolePreviewEnabled({ NODE_ENV: 'production', VELORA_APP_ENV: 'local' }),
  ).toBe(false);
  expect(consolePreviewEnabled({ VELORA_APP_ENV: 'local' })).toBe(true);
  expect(consolePreviewEnabled({ VELORA_APP_ENV: 'test' })).toBe(true);
});
