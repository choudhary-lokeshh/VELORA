import createClient from 'openapi-fetch';

import type { paths } from './generated/schema.js';

export function createVeloraApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export type { paths } from './generated/schema.js';
