import {
  resolveSurfaceConfig,
  publicIndexingAllowed,
} from '@velora/config/client';

/**
 * What this deployment of Consumer Web is, as far as the outside world knows.
 *
 * Two facts and they are decided together, because either one alone produces a
 * wrong answer. The origin is what an absolute address is built from — a
 * canonical tag, a sitemap entry, a social preview, the link a creator copies
 * — and indexability is whether any of those should be offered to a crawler at
 * all. An environment with no declared origin has no public identity, and the
 * honest consequence is that it publishes no absolute address and refuses to be
 * indexed rather than inventing a hostname it happens to be reachable at.
 *
 * `docs/engineering/07-configuration-environments.md` owns the variable. This
 * owns what the surface does with it, and it does nothing clever: absent means
 * absent, everywhere, in the same direction.
 */
export interface PublicSite {
  /** True only where a crawler is welcome: production, with an origin. */
  readonly indexable: boolean;
  /** The public origin, when this environment has one. */
  readonly origin?: string | undefined;
}

export interface SiteEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly VELORA_API_BASE_URL?: string | undefined;
  readonly VELORA_APP_ENV?: string | undefined;
  readonly VELORA_WEB_PUBLIC_ORIGIN?: string | undefined;
}

/**
 * Resolved on the server at request time, never at build.
 *
 * The same reasoning as the API endpoint next door: a value inlined at build
 * would bake one environment's public identity into the artifact every
 * environment shares, and the artifact that serves a preview would then claim
 * to be production.
 *
 * A configuration mistake must not take the surface down. Every page reads
 * this, including pages that have nothing to do with search, so an origin that
 * fails validation degrades to "no public identity" rather than throwing a 500
 * on every route — which is the same direction absence already points.
 */
export function resolvePublicSite(
  environment: SiteEnvironment = process.env,
): PublicSite {
  let config;
  try {
    config = resolveSurfaceConfig(environment);
  } catch {
    return { indexable: false };
  }
  const origin = config.publicWebOrigin;
  return {
    indexable: publicIndexingAllowed(config),
    ...(origin === undefined ? {} : { origin }),
  };
}

/**
 * A path as an address somebody can paste somewhere else.
 *
 * Falls back to the path itself when this environment has no public origin. A
 * relative canonical is resolved by every crawler against the address it
 * fetched, which is exactly right for a surface with no declared identity, and
 * it keeps a share control working locally instead of producing `undefined` in
 * the middle of a URL.
 */
export function absoluteUrl(site: PublicSite, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return site.origin === undefined ? suffix : `${site.origin}${suffix}`;
}
