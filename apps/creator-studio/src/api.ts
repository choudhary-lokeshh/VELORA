import { createVeloraApiClient } from '@velora/api-client';
import { loadClientConfig } from '@velora/config/client';

/**
 * The API base URL is resolved on the server at request time, exactly as the
 * other surfaces do, so one build artifact serves every environment and the
 * endpoint a surface calls is the one its Content-Security-Policy allows.
 */
export interface ApiEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly VELORA_API_BASE_URL?: string | undefined;
  readonly VELORA_APP_ENV?: string | undefined;
}

export function resolveApiBaseUrl(
  environment: ApiEnvironment = process.env,
): string {
  return loadClientConfig({
    apiBaseUrl: environment.VELORA_API_BASE_URL,
    appEnvironment:
      environment.VELORA_APP_ENV ??
      (environment.NODE_ENV === 'production' ? 'production' : 'local'),
    localDefaultApiBaseUrl: 'http://127.0.0.1:4000',
  }).apiBaseUrl;
}

export function createSurfaceApiClient(baseUrl: string) {
  return createVeloraApiClient(baseUrl);
}
