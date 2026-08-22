import { resolveApiBaseUrl } from '../src/api';

/**
 * The loopback endpoint is a development affordance, and the mobile bundle is
 * the surface where getting that wrong is least recoverable: a shipped build
 * carries whatever it was compiled with, to every device, until the next
 * release. So the default when nobody says otherwise is `production`, which
 * refuses a loopback address outright rather than pointing a released app at a
 * host it will never reach.
 */

const originalEnvironment = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
};

afterEach(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = originalEnvironment.apiBaseUrl;
  process.env.EXPO_PUBLIC_APP_ENV = originalEnvironment.appEnvironment;
});

describe('Consumer Mobile API endpoint resolution', () => {
  it('falls back to the local API only when the build says it is local', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    process.env.EXPO_PUBLIC_APP_ENV = 'local';

    expect(resolveApiBaseUrl()).toBe('http://127.0.0.1:4000');
  });

  it('treats an unlabelled build as production and refuses to resolve one', () => {
    // Not an oversight in the build pipeline: a bundle with no declared
    // environment is the one most likely to be a release, so it gets the
    // strictest treatment rather than the most convenient.
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_APP_ENV;

    expect(() => resolveApiBaseUrl()).toThrow();
  });

  it('refuses a loopback endpoint in a production build', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:4000';
    process.env.EXPO_PUBLIC_APP_ENV = 'production';

    expect(() => resolveApiBaseUrl()).toThrow();
  });

  it('uses an explicit endpoint, which is how a device reaches a real API', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.velora.test';
    process.env.EXPO_PUBLIC_APP_ENV = 'production';

    expect(resolveApiBaseUrl()).toBe('https://api.velora.test');
  });

  it('ignores a blank value rather than treating it as configuration', () => {
    // Build pipelines inject absent variables as empty strings routinely, and
    // an empty endpoint accepted as configured is how a release points at
    // nothing at all.
    process.env.EXPO_PUBLIC_API_BASE_URL = '';
    process.env.EXPO_PUBLIC_APP_ENV = 'local';

    expect(resolveApiBaseUrl()).toBe('http://127.0.0.1:4000');
  });
});
