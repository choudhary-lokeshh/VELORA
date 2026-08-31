import { createVeloraApiClient } from '@velora/api-client';
import { resolveSurfaceConfig } from '@velora/config/client';

/**
 * The API base URL is resolved on the server at request time and handed to the
 * browser as a prop. A `NEXT_PUBLIC_` value would be inlined at build time,
 * which would bake one environment's endpoint into the artifact that every
 * environment is supposed to share.
 */
export interface ApiEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly VELORA_API_BASE_URL?: string | undefined;
  readonly VELORA_APP_ENV?: string | undefined;
  readonly VELORA_MEDIA_DELIVERY_ORIGIN?: string | undefined;
}

export function resolveApiBaseUrl(
  environment: ApiEnvironment = process.env,
): string {
  return resolveSurfaceConfig(environment).apiBaseUrl;
}

export function createSurfaceApiClient(baseUrl: string) {
  return createVeloraApiClient(baseUrl);
}
