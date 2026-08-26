const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Refuse every seed target except a plain-HTTP loopback API in local mode.
 *
 * Kept separate from the executable seed so CI can prove the refusal without
 * starting a server or importing a script whose final statement seeds data.
 */
export function assertLocalSeedTarget({ apiBaseUrl, appEnvironment }) {
  if (appEnvironment !== 'local') {
    throw new Error(
      `dev:seed is local only; VELORA_APP_ENV is ${appEnvironment}`,
    );
  }

  const target = new URL(apiBaseUrl);
  if (
    target.protocol !== 'http:' ||
    !loopbackHosts.has(target.hostname) ||
    target.username.length > 0 ||
    target.password.length > 0
  ) {
    throw new Error(`dev:seed refuses a non-loopback API at ${apiBaseUrl}`);
  }
}
