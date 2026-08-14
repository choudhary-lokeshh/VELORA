import createClient from 'openapi-fetch';

import type { paths } from './generated/schema.js';

export interface VeloraApiClientOptions {
  /** Injectable transport, so a caller can test without patching a global. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createVeloraApiClient(
  baseUrl: string,
  options: VeloraApiClientOptions = {},
) {
  return createClient<paths>({
    baseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

export type { paths } from './generated/schema.js';
export * from './result.js';

type JsonResponse<
  TPath extends keyof paths,
  TMethod extends keyof paths[TPath],
  TStatus extends number,
> = paths[TPath][TMethod] extends {
  responses: Record<TStatus, { content: { 'application/json': infer TBody } }>;
}
  ? TBody
  : never;

/**
 * Response shapes clients consume by name rather than by re-deriving the path
 * indexing at every call site. They come from the generated document, so a
 * contract change is a type error in every client that uses them.
 */
export type AuthSessionResponse = JsonResponse<'/v1/auth/session', 'get', 200>;
export type MobileTokenResponse = JsonResponse<
  '/v1/auth/mobile/refresh',
  'post',
  200
>;
export type AuthAcknowledgement = JsonResponse<'/v1/auth/logout', 'post', 200>;
