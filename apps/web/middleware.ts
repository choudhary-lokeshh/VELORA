import {
  browserSecurityHeaders,
  resolveSurfaceConfig,
} from '@velora/config/client';
import { NextResponse, type NextRequest } from 'next/server';

import { pathIsIndexable } from './src/seo/routes';
import { resolvePublicSite } from './src/seo/site';

/**
 * Resolved, not read raw. The origin named in `connect-src` has to be the
 * origin the pages of this same process will actually call, and reading the
 * two variables here while `src/api.ts` resolved them meant a local surface
 * advertised `connect-src 'self'` and then served a page calling the loopback
 * API, which the browser refused.
 *
 * A surface that cannot resolve an endpoint at all gets `'self'` and the
 * deployed upgrade directive: refusing is correct, and a thrown header
 * computation would turn a configuration mistake into a 500 on every route.
 */
function surfaceConfig() {
  try {
    return resolveSurfaceConfig(process.env);
  } catch {
    return undefined;
  }
}

// Applied at request time so the API origin the browser may reach comes from
// the environment rather than from whatever value happened to be set at build.
const headers = () => {
  const config = surfaceConfig();
  return browserSecurityHeaders({
    apiBaseUrl: config?.apiBaseUrl,
    appEnvironment: config?.appEnvironment,
    developmentRuntime: process.env.NODE_ENV === 'development',
    // Consumer Web is the one surface that opens a camera: live discovery is
    // its primary destination, and `Permissions-Policy` refuses capture before
    // any permission prompt is reached — a refusal no amount of consent can
    // override. `self` permits it on this origin and never in a frame, which
    // with `frame-ancestors 'none'` means nowhere else at all.
    mediaCapture: 'self',
    mediaDeliveryOrigin: config?.mediaDeliveryOrigin,
    // The media project a live encounter is carried by, when one is
    // configured. Without it `connect-src` would refuse the provider's socket
    // *after* somebody had already granted a camera, which is the worst
    // possible place for a policy to say no.
    realtimeEndpoint: config?.realtimeEndpoint,
    referrerPolicy: 'same-origin',
  });
};

/**
 * Whether this address may be kept by a search engine, decided before routing.
 *
 * A header rather than only a meta tag, and set here rather than in each page,
 * because the two places a page can say this are read at different moments and
 * only one of them survives everything. A crawler that fetches an address and
 * abandons the response before scripts run never sees a document; a route that
 * answers something other than HTML — an image, a sitemap, a redirect — has no
 * document to put a tag in at all. The header covers every one of those, and
 * the pages that can also carry the tag carry it too.
 *
 * The default is refusal in both directions. An address the route policy does
 * not name is `noindex`, so a page added tomorrow is private until somebody
 * says otherwise, and an environment with no public identity is `noindex`
 * everywhere however many public pages it serves.
 */
function indexingDirective(pathname: string): string | undefined {
  if (!resolvePublicSite().indexable) return 'noindex, nofollow';
  return pathIsIndexable(pathname) ? undefined : 'noindex, nofollow';
}

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(headers())) {
    response.headers.set(name, value);
  }
  const directive = indexingDirective(request.nextUrl.pathname);
  if (directive !== undefined) response.headers.set('X-Robots-Tag', directive);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
