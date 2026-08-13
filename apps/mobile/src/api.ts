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
