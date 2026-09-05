import { loadClientConfig } from '@velora/config/client';

function publicEnvironmentValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Resolved on demand rather than at module load, so importing this module can
 * never crash a screen. A build with no explicit environment is treated as
 * production, which refuses a localhost endpoint.
 */
export function resolveApiBaseUrl(): string {
  return loadClientConfig({
    apiBaseUrl: publicEnvironmentValue(process.env.EXPO_PUBLIC_API_BASE_URL),
    appEnvironment:
      publicEnvironmentValue(process.env.EXPO_PUBLIC_APP_ENV) ?? 'production',
    localDefaultApiBaseUrl: 'http://127.0.0.1:4000',
  }).apiBaseUrl;
}

/**
 * The web address an invitation is written against, when this build has one.
 *
 * Absent is a real state and the app behaves accordingly: it offers no share
 * control rather than handing somebody a `velora://` address, which is worth
 * nothing to the person being invited — they do not have the app, which is the
 * entire reason they are being invited.
 *
 * Resolved through the same schema the web surfaces use, so a value with a path
 * or a trailing slash is refused here rather than producing an address that is
 * one character away from working. A refusal degrades to absent, because a
 * misconfigured build must not be a crash on the account screen.
 */
export function resolvePublicWebOrigin(): string | undefined {
  const declared = publicEnvironmentValue(process.env.EXPO_PUBLIC_WEB_ORIGIN);
  if (declared === undefined) return undefined;
  try {
    return loadClientConfig({
      apiBaseUrl: publicEnvironmentValue(process.env.EXPO_PUBLIC_API_BASE_URL),
      appEnvironment:
        publicEnvironmentValue(process.env.EXPO_PUBLIC_APP_ENV) ?? 'production',
      localDefaultApiBaseUrl: 'http://127.0.0.1:4000',
      publicWebOrigin: declared,
    }).publicWebOrigin;
  } catch {
    return undefined;
  }
}
