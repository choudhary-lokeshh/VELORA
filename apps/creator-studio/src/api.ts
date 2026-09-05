import { createVeloraApiClient } from '@velora/api-client';
import { resolveSurfaceConfig } from '@velora/config/client';

/**
 * The API base URL is resolved on the server at request time, exactly as the
 * other surfaces do, so one build artifact serves every environment and the
 * endpoint a surface calls is the one its Content-Security-Policy allows.
 */
export interface ApiEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly VELORA_API_BASE_URL?: string | undefined;
  readonly VELORA_APP_ENV?: string | undefined;
  readonly VELORA_MEDIA_DELIVERY_ORIGIN?: string | undefined;
  readonly VELORA_WEB_PUBLIC_ORIGIN?: string | undefined;
}

export function resolveApiBaseUrl(
  environment: ApiEnvironment = process.env,
): string {
  return resolveSurfaceConfig(environment).apiBaseUrl;
}

export function createSurfaceApiClient(baseUrl: string) {
  return createVeloraApiClient(baseUrl);
}

/**
 * The origin a creator's public page is actually reached at, when one exists.
 *
 * It is Consumer Web's origin rather than this surface's, and it is read here
 * for one reason: a creator's page lives on that surface, so the address this
 * console tells them to share has to name it. A misconfigured value degrades to
 * absent rather than throwing — a wrong address on this screen would be worse
 * than no address, and a crash would be worse than both.
 */
export function resolvePublicWebOrigin(
  environment: ApiEnvironment = process.env,
): string | undefined {
  try {
    return resolveSurfaceConfig(environment).publicWebOrigin;
  } catch {
    return undefined;
  }
}
