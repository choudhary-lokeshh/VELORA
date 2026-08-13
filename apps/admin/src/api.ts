import { createVeloraApiClient } from '@velora/api-client';
import { loadClientConfig } from '@velora/config/client';

const config = loadClientConfig({
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  appEnvironment:
    process.env.NEXT_PUBLIC_APP_ENV ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'local'),
  localDefaultApiBaseUrl: 'http://127.0.0.1:4000',
});

export const apiClient = createVeloraApiClient(config.apiBaseUrl);
