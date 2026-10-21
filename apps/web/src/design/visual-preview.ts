import { resolveSurfaceConfig } from '@velora/config/client';

import type { ApiEnvironment } from '../api';

/** Owner-selected localhost exploration; deployed visual authority is unchanged. */
export function ivoryPreviewEnabled(
  environment: ApiEnvironment = process.env,
): boolean {
  // Only a declared environment counts. The resolver infers `local` when
  // `VELORA_APP_ENV` is absent on a development runtime, and ADR-0050 keeps
  // the original expression for a missing value.
  const declared = environment.VELORA_APP_ENV;
  if (declared !== 'local' && declared !== 'test') return false;
  // A production build is what deploys and what the browser suite proves, so
  // it always serves the baseline; the review lives on the development server.
  if (environment.NODE_ENV === 'production') return false;
  try {
    return resolveSurfaceConfig(environment).appEnvironment === declared;
  } catch {
    return false;
  }
}
