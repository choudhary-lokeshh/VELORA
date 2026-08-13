import { createVeloraApiClient } from '@velora/api-client';
import { loadClientConfig } from '@velora/config/client';

function publicEnvironmentValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const config = loadClientConfig({
  apiBaseUrl: publicEnvironmentValue(process.env.EXPO_PUBLIC_API_BASE_URL),
  appEnvironment:
    publicEnvironmentValue(process.env.EXPO_PUBLIC_APP_ENV) ?? 'production',
  localDefaultApiBaseUrl: 'http://127.0.0.1:4000',
});

export const apiClient = createVeloraApiClient(config.apiBaseUrl);
